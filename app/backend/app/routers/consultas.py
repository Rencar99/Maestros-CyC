"""Constructor de consultas: explorar la base y armar SELECTs sin escribir SQL.

Diseño de seguridad (importante): **el cliente nunca envía SQL**. Envía la
consulta *estructurada* (tabla, campos, filtros, orden, límite) y este módulo
arma el SQL en el servidor:

* Todo identificador (tabla/campo) se valida contra el catálogo real de la base
  y se cita con comillas dobles; nunca se concatena texto libre del usuario.
* Todos los valores viajan como parámetros vinculados (``:p0``, ``:p1``…).
* Solo ``SELECT``, dentro de una transacción **READ ONLY** y con
  ``statement_timeout``.
* Columnas sensibles (claves cifradas, hashes) quedan ocultas: no se listan ni
  se pueden seleccionar ni filtrar.
* Solo el esquema propio de la app (``maestros``) y solo Super Usuario.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlmodel import Session, select

from ..config import DB_SCHEMA
from ..db import engine, DB_URL, get_session
from ..deps import require_perm
from ..models import ConsultaGuardada, ConsultaRol, Usuario

router = APIRouter(prefix="/api/consultas", tags=["consultas"])

ES_SQLITE = DB_URL.startswith("sqlite")

# Tope de filas: por defecto y máximo absoluto que acepta el endpoint.
LIMITE_DEF = 500
LIMITE_MAX = 5000
TIMEOUT_MS = 20000

# --- Columnas que NUNCA se exponen -------------------------------------------
# Secretos (aunque estén cifrados o hasheados) y blobs que no aportan en grilla.
COLUMNAS_OCULTAS = {
    "password_hash",   # hash Argon2 del usuario interno
    "password_enc",    # clave de portal DIAN cifrada (Fernet)
    "clave_enc",       # clave de portal cifrada (tabla clienteclave)
    "foto",            # imagen en base64: pesa y no se lee en una grilla
    "logo",            # ídem (logo del cliente)
}

# Solo estas tablas se pueden consultar (por ahora Clientes y Responsables).
# Restringe la lista visible, la validación de campos y la ejecución (todo pasa
# por _catalogo). Ampliar aquí si en el futuro se habilitan más tablas.
TABLAS_PERMITIDAS = {"cliente", "usuario", "clienteclave"}

# Nombre técnico de la tabla -> nombre que ve el usuario.
ETIQUETAS_TABLA = {
    "cliente": "Clientes",
    "usuario": "Responsables",
    "clienteservicio": "Servicios del cliente",
    "clientemunicipioica": "Municipios ICA del cliente",
    "clienteobligacion": "Obligaciones del cliente",
    "clienteclave": "Claves del cliente en portales",
    "rolservicio": "Roles de servicio",
    "software": "Software",
    "cargo": "Cargos",
    "grupoeconomico": "Grupos económicos",
    "portal": "Portales",
    "tipodocumento": "Tipos de documento",
    "responsabilidad": "Responsabilidades (RUT)",
    "municipio": "Municipios",
    "ciiu": "Actividades CIIU",
    "obligaciontipo": "Tipos de obligación",
    "plazovencimiento": "Plazos de vencimiento",
    "obligacioncumplimiento": "Cumplimiento de obligaciones",
    "facturacion": "Facturación (cabecera)",
    "facturacionitem": "Facturación (detalle)",
}

# Relaciones N:1 unibles (JOIN) por tabla base: (columna FK, tabla destino, etiqueta).
# Solo lecturas: LEFT JOIN por la PK "id" de la tabla destino → 1 fila por registro base.
RELACIONES: dict[str, list[tuple[str, str, str]]] = {
    "cliente": [
        ("responsable_impuestos_id", "usuario", "Responsable Impuestos"),
        ("coordinador_impuestos_id", "usuario", "Coordinador Impuestos"),
        ("responsable_financiero_id", "usuario", "Responsable Financiero"),
        ("coordinador_financiero_id", "usuario", "Coordinador Financiero"),
        ("firma_contador_id", "usuario", "Contador (firma)"),
        ("firma_revisor_id", "usuario", "Revisor Fiscal (firma)"),
        ("software_id", "software", "Software"),
    ],
    "clienteclave": [
        ("cliente_id", "cliente", "Cliente"),
        ("portal_id", "portal", "Portal"),
    ],
}

# Abreviaturas que el "Título Capitalizado" automático no acierta.
ETIQUETAS_CAMPO = {
    "id": "Id", "nit": "NIT", "dv": "DV", "num_id": "Número de identificación",
    "ciiu_id": "CIIU", "ciiu2_id": "CIIU secundario", "iva": "IVA",
    "reteiva": "ReteIVA", "ica": "ICA", "rut": "RUT", "dian": "DIAN",
    "creado_at": "Creado", "actualizado_at": "Actualizado",
    "cliente_id": "Cliente", "usuario_id": "Responsable", "portal_id": "Portal",
}

_TIPOS = [
    (("BOOL",), "booleano"),
    (("TIMESTAMP", "DATETIME"), "fecha y hora"),
    (("DATE",), "fecha"),
    (("TIME",), "hora"),
    (("INT", "SERIAL"), "entero"),
    (("NUMERIC", "DECIMAL", "FLOAT", "REAL", "DOUBLE"), "decimal"),
    (("CHAR", "TEXT", "STRING", "UUID", "ENUM"), "texto"),
]

# Familias para saber qué operadores ofrecer y cómo convertir el valor.
NUMERICOS = {"entero", "decimal"}
FECHAS = {"fecha", "fecha y hora"}

_IDENT_OK = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _tipo_simple(sqltype) -> str:
    t = str(sqltype).upper()
    for claves, nombre in _TIPOS:
        if any(k in t for k in claves):
            return nombre
    return "texto"


def _etiqueta_campo(nombre: str) -> str:
    if nombre in ETIQUETAS_CAMPO:
        return ETIQUETAS_CAMPO[nombre]
    limpio = nombre[:-3] if nombre.endswith("_id") else nombre
    return limpio.replace("_", " ").capitalize()


def _cita(ident: str) -> str:
    """Identificador citado. Se llama SOLO con nombres ya validados contra el
    catálogo; la comprobación de forma es un cinturón de seguridad extra."""
    if not _IDENT_OK.match(ident):
        raise HTTPException(400, f"Nombre no válido: {ident}")
    return '"' + ident.replace('"', '""') + '"'


# ============================================================ Catálogo de la base
_cache: dict | None = None
_cols_cache: dict[str, list[dict]] = {}


def _cols_de(tabla: str) -> list[dict]:
    """Columnas visibles de UNA tabla (para bases y para destinos de JOIN), sin
    las columnas ocultas. Se cachea (el esquema no cambia mientras corre la app)."""
    if tabla in _cols_cache:
        return _cols_cache[tabla]
    insp = inspect(engine)
    esquema = None if ES_SQLITE else DB_SCHEMA
    if not _IDENT_OK.match(tabla) or tabla not in insp.get_table_names(schema=esquema):
        return []
    pks = set(insp.get_pk_constraint(tabla, schema=esquema).get("constrained_columns") or [])
    cols = []
    for c in insp.get_columns(tabla, schema=esquema):
        nombre = c["name"]
        if nombre in COLUMNAS_OCULTAS or not _IDENT_OK.match(nombre):
            continue
        cols.append({
            "nombre": nombre,
            "etiqueta": _etiqueta_campo(nombre),
            "tipo": _tipo_simple(c["type"]),
            "nulo": bool(c.get("nullable", True)),
            "pk": nombre in pks,
        })
    _cols_cache[tabla] = cols
    return cols


def _catalogo(refrescar: bool = False) -> dict[str, list[dict]]:
    """{tabla: [columna…]} de las tablas HABILITADAS (Clientes / Responsables)."""
    global _cache
    if refrescar:
        _cache = None
        _cols_cache.clear()
    if _cache is not None:
        return _cache
    cat: dict[str, list[dict]] = {}
    for tabla in sorted(TABLAS_PERMITIDAS):
        cols = _cols_de(tabla)
        if cols:
            cat[tabla] = cols
    _cache = cat
    return cat


def _tabla_valida(nombre: str) -> list[dict]:
    cols = _catalogo().get(nombre)
    if cols is None:
        raise HTTPException(404, f"La tabla «{nombre}» no existe o no está disponible")
    return cols


def _relaciones_de(tabla: str) -> list[dict]:
    """Relaciones N:1 disponibles para la tabla base (solo si la FK existe en la
    base y la tabla destino es legible)."""
    base_cols = {x["nombre"] for x in _cols_de(tabla)}
    out = []
    for clave, destino, etq in RELACIONES.get(tabla, []):
        if clave in base_cols and _cols_de(destino):
            out.append({"clave": clave, "tabla": destino,
                        "tabla_etiqueta": ETIQUETAS_TABLA.get(destino, destino),
                        "etiqueta": etq})
    return out


def _ref(tabla: str) -> str:
    """Referencia completa de la tabla (con esquema en Postgres)."""
    return _cita(tabla) if ES_SQLITE else f"{_cita(DB_SCHEMA)}.{_cita(tabla)}"


# ============================================================ Modelos de entrada
OPERADORES = {
    "=": "es igual a", "!=": "es distinto de",
    "contiene": "contiene", "empieza": "empieza por", "termina": "termina en",
    ">": "mayor que", ">=": "mayor o igual que",
    "<": "menor que", "<=": "menor o igual que",
    "entre": "está entre", "vacio": "está vacío", "novacio": "tiene dato",
}
SIN_VALOR = {"vacio", "novacio"}
SOLO_TEXTO = {"contiene", "empieza", "termina"}


class Filtro(BaseModel):
    campo: str
    op: str = "="
    valor: str = ""
    valor2: str = ""       # solo para "entre"


class ConsultaIn(BaseModel):
    tabla: str
    joins: list[str] = []           # claves de relación N:1 a incluir (LEFT JOIN)
    campos: list[str] = []          # "campo" (base) o "relacion.campo" (join)
    alias: dict[str, str] = {}      # referencia -> nombre de columna a mostrar (opcional)
    filtros: list[Filtro] = []
    union: str = "y"                # "y" (AND) | "o" (OR)
    orden: str = ""
    orden_desc: bool = False
    limite: int = LIMITE_DEF


def _valor_tipado(tipo: str, crudo: str, campo: str):
    """Convierte el texto del formulario al tipo de la columna (o falla claro)."""
    v = (crudo or "").strip()
    try:
        if tipo == "entero":
            return int(v)
        if tipo == "decimal":
            return float(v.replace(",", "."))
        if tipo == "booleano":
            return v.lower() in ("1", "true", "si", "sí", "verdadero", "v", "x")
        if tipo == "fecha":
            return date.fromisoformat(v)
        if tipo == "fecha y hora":
            return datetime.fromisoformat(v) if len(v) > 10 else datetime.combine(
                date.fromisoformat(v), time.min)
    except (TypeError, ValueError):
        raise HTTPException(400, f"«{v}» no es un valor válido de tipo {tipo} para el campo {campo}")
    return v


def _escapar_like(v: str) -> str:
    return v.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _armar(c: ConsultaIn, restringir_ids: set[int] | None = None,
           confid_ocultos: set[int] | None = None) -> tuple[str, dict, list[dict]]:
    """Devuelve (sql, parámetros, columnas de salida) para una consulta válida.
    Soporta relaciones N:1: la referencia "relacion.campo" apunta a una tabla unida
    por LEFT JOIN (alias jN); "campo" a secas es de la tabla base (alias b).

    ``restringir_ids`` (alcance por asignación): si es un conjunto y la tabla base es
    ``cliente``, se agrega ``b."id" IN (...)`` en AND con los filtros del usuario
    (conjunto vacío = ninguna fila). ``None`` = sin restricción (Admin/Super)."""
    cols = _tabla_valida(c.tabla)
    por_nombre = {x["nombre"]: x for x in cols}

    relaciones = {r["clave"]: r for r in _relaciones_de(c.tabla)}
    joins_pedidos = [j for j in (c.joins or []) if j in relaciones]
    rel_cols = {j: {x["nombre"]: x for x in _cols_de(relaciones[j]["tabla"])} for j in joins_pedidos}
    join_alias = {j: f"j{i}" for i, j in enumerate(joins_pedidos)}
    BASE = "b"

    def resolver(ref: str) -> tuple[str, str, dict]:
        """ref -> (expresión SQL citada, nombre de salida único, metadatos de la columna)."""
        if "." in ref:
            rk, campo = ref.split(".", 1)
            if rk not in join_alias:
                raise HTTPException(400, f"Relación no incluida en la consulta: {rk}")
            meta = rel_cols[rk].get(campo)
            if not meta:
                raise HTTPException(400, f"Campo «{campo}» no disponible en {relaciones[rk]['etiqueta']}")
            expr = f'{_cita(join_alias[rk])}.{_cita(campo)}'
            m = dict(meta)
            m["etiqueta"] = f"{relaciones[rk]['etiqueta']} · {meta['etiqueta']}"
            return expr, f"{rk}__{campo}", m
        meta = por_nombre.get(ref)
        if not meta:
            raise HTTPException(400, f"Campo no disponible: {ref}")
        return f'{_cita(BASE)}.{_cita(ref)}', ref, dict(meta)

    refs = list(c.campos) or [x["nombre"] for x in cols]   # sin selección: base completa
    seleccion, salida, vistos = [], [], set()
    for ref in refs:
        expr, out, meta = resolver(ref)
        if out in vistos:
            continue
        vistos.add(out)
        a = (c.alias or {}).get(ref, "").strip()
        if a:
            meta["etiqueta"] = a
        meta["nombre"] = out
        meta["ref"] = ref
        seleccion.append(f'{expr} AS {_cita(out)}')
        salida.append(meta)

    sql = "SELECT " + ", ".join(seleccion) + f"\nFROM {_ref(c.tabla)} AS {_cita(BASE)}"
    for j in joins_pedidos:
        rel, ja = relaciones[j], join_alias[j]
        sql += (f'\nLEFT JOIN {_ref(rel["tabla"])} AS {_cita(ja)}'
                f' ON {_cita(ja)}."id" = {_cita(BASE)}.{_cita(j)}')

    params: dict = {}
    trozos: list[str] = []
    for i, f in enumerate(c.filtros):
        col, _out, meta = resolver(f.campo)
        if f.op not in OPERADORES:
            raise HTTPException(400, f"Operador no válido: {f.op}")
        if f.op == "vacio":
            trozos.append(f"({col} IS NULL OR CAST({col} AS TEXT) = '')")
            continue
        if f.op == "novacio":
            trozos.append(f"({col} IS NOT NULL AND CAST({col} AS TEXT) <> '')")
            continue
        if f.op in SOLO_TEXTO:
            patron = _escapar_like((f.valor or "").strip().lower())
            molde = {"contiene": f"%{patron}%", "empieza": f"{patron}%",
                     "termina": f"%{patron}"}[f.op]
            params[f"p{i}"] = molde
            trozos.append(f"LOWER(CAST({col} AS TEXT)) LIKE :p{i} ESCAPE '\\'")
            continue
        if f.op == "entre":
            params[f"p{i}a"] = _valor_tipado(meta["tipo"], f.valor, f.campo)
            params[f"p{i}b"] = _valor_tipado(meta["tipo"], f.valor2, f.campo)
            trozos.append(f"{col} BETWEEN :p{i}a AND :p{i}b")
            continue
        params[f"p{i}"] = _valor_tipado(meta["tipo"], f.valor, f.campo)
        trozos.append(f"{col} {f.op} :p{i}")

    where_parts: list[str] = []
    if trozos:
        union = " OR " if (c.union or "y").lower() == "o" else " AND "
        where_parts.append("(" + union.join(trozos) + ")")
    # Alcance por asignación: solo aplica a la tabla base Clientes.
    if restringir_ids is not None and c.tabla == "cliente":
        if restringir_ids:
            marcas = ", ".join(f":rid{k}" for k in range(len(restringir_ids)))
            for k, idv in enumerate(sorted(restringir_ids)):
                params[f"rid{k}"] = int(idv)
            where_parts.append(f'{_cita(BASE)}."id" IN ({marcas})')
        else:
            where_parts.append("1 = 0")   # sin clientes asignados -> ninguna fila
    # Clientes confidenciales: ocultar los que este usuario no puede ver (ni supervisor ni asignado).
    if confid_ocultos and c.tabla == "cliente":
        marcas = ", ".join(f":cfo{k}" for k in range(len(confid_ocultos)))
        for k, idv in enumerate(sorted(confid_ocultos)):
            params[f"cfo{k}"] = int(idv)
        where_parts.append(f'{_cita(BASE)}."id" NOT IN ({marcas})')
    if where_parts:
        sql += "\nWHERE " + " AND ".join(where_parts)

    if c.orden:
        expr, _o, _m = resolver(c.orden)
        sql += f"\nORDER BY {expr}" + (" DESC" if c.orden_desc else " ASC")

    limite = max(1, min(int(c.limite or LIMITE_DEF), LIMITE_MAX))
    sql += f"\nLIMIT {limite}"
    return sql, params, salida


def _literal(v) -> str:
    """Valor escrito como literal — SOLO para mostrar el SQL en pantalla."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _sql_legible(sql: str, params: dict) -> str:
    """El mismo SQL con los valores puestos, para que el usuario lo lea.
    Nunca se ejecuta: lo que corre es la versión parametrizada."""
    salida = sql
    for k in sorted(params, key=len, reverse=True):
        salida = salida.replace(f":{k}", _literal(params[k]))
    return salida


def _jsonable(v):
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, memoryview)):
        return "(binario)"
    return v


def _correr(sql: str, params: dict) -> list[dict]:
    """Ejecuta en una transacción de SOLO LECTURA y con tiempo máximo."""
    with engine.connect() as conn:
        if not ES_SQLITE:
            conn = conn.execution_options(postgresql_readonly=True)
            conn.execute(text(f"SET LOCAL statement_timeout = {TIMEOUT_MS}"))
        try:
            filas = conn.execute(text(sql), params).mappings().all()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, "La consulta falló: "
                                     + (str(exc).splitlines() or [""])[0][:250])
        return [{k: _jsonable(v) for k, v in f.items()} for f in filas]


# ==================================================================== Endpoints
@router.get("/tablas")
def listar_tablas(refrescar: bool = False, _u=Depends(require_perm("consultas.generar"))):
    """Tablas disponibles, con su etiqueta y el número de filas."""
    cat = _catalogo(refrescar)
    if not cat:
        return []
    partes = [f"SELECT '{t}' AS t, COUNT(*) AS n FROM {_ref(t)}" for t in cat]
    conteos: dict[str, int] = {}
    try:
        for f in _correr(" UNION ALL ".join(partes), {}):
            conteos[str(f["t"])] = int(f["n"])
    except HTTPException:
        pass          # si el conteo falla, la lista de tablas se muestra igual
    return sorted(
        ({"nombre": t,
          "etiqueta": ETIQUETAS_TABLA.get(t, t.replace("_", " ").capitalize()),
          "campos": len(cols),
          "filas": conteos.get(t)} for t, cols in cat.items()),
        key=lambda x: x["etiqueta"].lower())


def _con_operadores(cols: list[dict]) -> list[dict]:
    """Anexa a cada columna los operadores que admite según su tipo."""
    ops = {"texto": ["=", "!=", "contiene", "empieza", "termina", "vacio", "novacio"],
           "numero": ["=", "!=", ">", ">=", "<", "<=", "entre", "vacio", "novacio"],
           "fecha": ["=", "!=", ">", ">=", "<", "<=", "entre", "vacio", "novacio"],
           "booleano": ["=", "!="]}
    salida = []
    for c in cols:
        familia = ("numero" if c["tipo"] in NUMERICOS else
                   "fecha" if c["tipo"] in FECHAS else
                   "booleano" if c["tipo"] == "booleano" else "texto")
        salida.append({**c, "operadores": ops[familia]})
    return salida


@router.get("/tablas/{tabla}/campos")
def listar_campos(tabla: str, _u=Depends(require_perm("consultas.generar"))):
    """Campos de una tabla, con el tipo y los operadores que admite."""
    return _con_operadores(_tabla_valida(tabla))


@router.get("/tablas/{tabla}/relaciones")
def listar_relaciones(tabla: str, _u=Depends(require_perm("consultas.generar"))):
    """Relaciones N:1 unibles a la tabla base, cada una con sus campos disponibles.
    Cada campo se referencia luego como «clave_relacion.campo»."""
    _tabla_valida(tabla)
    return [{**r, "campos": _con_operadores(_cols_de(r["tabla"]))}
            for r in _relaciones_de(tabla)]


@router.get("/operadores")
def listar_operadores(_u=Depends(require_perm("consultas.generar"))):
    return [{"op": k, "etiqueta": v, "sin_valor": k in SIN_VALOR,
             "dos_valores": k == "entre"} for k, v in OPERADORES.items()]


@router.post("/ejecutar")
def ejecutar(c: ConsultaIn, session: Session = Depends(get_session),
             user: Usuario = Depends(require_perm("consultas.generar"))):
    """Arma la consulta, la corre en solo lectura y devuelve filas + SQL."""
    from ..scope import confid_ocultos as _confid_ocultos
    sql, params, cols = _armar(c, confid_ocultos=_confid_ocultos(session, user))
    filas = _correr(sql, params)
    limite = max(1, min(int(c.limite or LIMITE_DEF), LIMITE_MAX))
    return {"sql": _sql_legible(sql, params), "columnas": cols, "filas": filas,
            "total": len(filas), "truncado": len(filas) >= limite, "limite": limite}


def _excel(tabla: str, cols: list[dict], filas: list[dict], titulo: str = "") -> Response:
    """Arma el Excel (estilo único de la firma) y lo devuelve como descarga."""
    from ..export_xlsx import tabla_simple
    hoja = (titulo or ETIQUETAS_TABLA.get(tabla, tabla))[:31]
    encab = [x["etiqueta"] for x in cols]
    rows = [[f.get(x["nombre"]) for x in cols] for f in filas]
    anchos = [max(12, min(42, len(x["etiqueta"]) + 6)) for x in cols]
    nombre = f"Consulta_{(titulo or tabla)}.xlsx".replace(" ", "_")
    return tabla_simple(nombre, hoja, encab, rows, anchos)


@router.post("/exportar")
def exportar(c: ConsultaIn, session: Session = Depends(get_session),
             user: Usuario = Depends(require_perm("consultas.generar"))):
    """La misma consulta, en Excel (con el estilo de la firma)."""
    from ..scope import confid_ocultos as _confid_ocultos
    sql, params, cols = _armar(c, confid_ocultos=_confid_ocultos(session, user))
    return _excel(c.tabla, cols, _correr(sql, params))


# ==================================================== Consultas guardadas
ALCANCES = {"asignados", "firma"}


class GuardarIn(BaseModel):
    nombre: str
    definicion: dict = {}
    descripcion: str = ""
    alcance: str = "asignados"       # "asignados" | "firma"
    roles: list[int] = []            # rol_id que pueden verla/correrla


def _roles_de(session: Session, gid: int) -> list[int]:
    return [r.rol_id for r in session.exec(
        select(ConsultaRol).where(ConsultaRol.consulta_id == gid)).all()]


def _fijar_roles(session: Session, gid: int, roles: list[int]) -> None:
    """Reemplaza los roles con acceso a la consulta."""
    for r in session.exec(select(ConsultaRol).where(ConsultaRol.consulta_id == gid)).all():
        session.delete(r)
    for rid in dict.fromkeys(int(x) for x in (roles or [])):
        session.add(ConsultaRol(consulta_id=gid, rol_id=rid))


def _es_autor(user: Usuario) -> bool:
    """Super Usuario: autor, ve todas las consultas."""
    return user.rol == "superadmin"


def _puede_ver(session: Session, user: Usuario, g: ConsultaGuardada) -> bool:
    if _es_autor(user):
        return True
    if user.rol_id is None:
        return False
    return session.exec(select(ConsultaRol).where(
        ConsultaRol.consulta_id == g.id,
        ConsultaRol.rol_id == user.rol_id)).first() is not None


# ------- Autoría (Generar Consultas): solo consultas.generar ------------------
@router.get("/guardadas")
def listar_guardadas(session: Session = Depends(get_session), _u=Depends(require_perm("consultas.generar"))):
    """Lista las consultas guardadas (sin la definición), más recientes primero."""
    filas = session.exec(select(ConsultaGuardada).order_by(ConsultaGuardada.nombre)).all()
    return [{"id": g.id, "nombre": g.nombre, "descripcion": g.descripcion or "",
             "alcance": g.alcance or "asignados", "roles": _roles_de(session, g.id),
             "creado_por": g.creado_por,
             "actualizado_at": g.actualizado_at.isoformat() if g.actualizado_at else None}
            for g in filas]


@router.get("/guardadas/{gid}")
def obtener_guardada(gid: int, session: Session = Depends(get_session), _u=Depends(require_perm("consultas.generar"))):
    g = session.get(ConsultaGuardada, gid)
    if not g:
        raise HTTPException(404, "Consulta no encontrada")
    return {"id": g.id, "nombre": g.nombre, "definicion": g.definicion or {},
            "descripcion": g.descripcion or "", "alcance": g.alcance or "asignados",
            "roles": _roles_de(session, g.id)}


@router.post("/guardadas", status_code=201)
def guardar_consulta(data: GuardarIn, session: Session = Depends(get_session),
                     user: Usuario = Depends(require_perm("consultas.generar"))):
    """Guarda (o reemplaza, si ya existe una con el mismo nombre) una consulta,
    con su descripción, alcance y los roles que pueden ejecutarla."""
    nombre = (data.nombre or "").strip()
    if not nombre:
        raise HTTPException(400, "Ponle un nombre a la consulta")
    alcance = data.alcance if data.alcance in ALCANCES else "asignados"
    g = session.exec(select(ConsultaGuardada).where(ConsultaGuardada.nombre == nombre)).first()
    if g:
        g.definicion = data.definicion or {}
        g.descripcion = (data.descripcion or "").strip()
        g.alcance = alcance
        g.actualizado_at = datetime.utcnow()
    else:
        g = ConsultaGuardada(nombre=nombre, definicion=data.definicion or {},
                             descripcion=(data.descripcion or "").strip(), alcance=alcance,
                             creado_por=user.usuario or user.nombre)
        session.add(g)
    session.commit()
    session.refresh(g)
    _fijar_roles(session, g.id, data.roles)
    session.commit()
    return {"id": g.id, "nombre": g.nombre}


class RenombrarIn(BaseModel):
    nombre: str


@router.put("/guardadas/{gid}/nombre")
def renombrar_guardada(gid: int, data: RenombrarIn, session: Session = Depends(get_session),
                       _u=Depends(require_perm("consultas.generar"))):
    """Cambia SOLO el nombre de una consulta guardada (no toca definición/roles/alcance)."""
    g = session.get(ConsultaGuardada, gid)
    if not g:
        raise HTTPException(404, "Consulta no encontrada")
    nombre = (data.nombre or "").strip()
    if not nombre:
        raise HTTPException(400, "Ponle un nombre a la consulta")
    otro = session.exec(select(ConsultaGuardada).where(
        ConsultaGuardada.nombre == nombre, ConsultaGuardada.id != gid)).first()
    if otro:
        raise HTTPException(400, "Ya existe otra consulta con ese nombre")
    g.nombre = nombre
    g.actualizado_at = datetime.utcnow()
    session.add(g)
    session.commit()
    return {"id": g.id, "nombre": g.nombre}


@router.delete("/guardadas/{gid}", status_code=204)
def borrar_guardada(gid: int, session: Session = Depends(get_session), _u=Depends(require_perm("consultas.generar"))):
    g = session.get(ConsultaGuardada, gid)
    if not g:
        raise HTTPException(404, "Consulta no encontrada")
    _fijar_roles(session, gid, [])       # limpia los roles asociados
    session.delete(g)
    session.commit()


# ------- Consumo (menú Consultas): consultas.ver, filtrado por rol ------------
@router.get("/publicadas")
def listar_publicadas(session: Session = Depends(get_session),
                      user: Usuario = Depends(require_perm("consultas.ver"))):
    """Consultas que el usuario puede ejecutar (compartidas con su rol; el Super
    ve todas). Solo nombre y descripción: el consumidor no ve alcance ni roles."""
    filas = session.exec(select(ConsultaGuardada).order_by(ConsultaGuardada.nombre)).all()
    return [{"id": g.id, "nombre": g.nombre, "descripcion": g.descripcion or ""}
            for g in filas if _puede_ver(session, user, g)]


def _preparar_publicada(session: Session, user: Usuario, gid: int):
    """Valida acceso y arma (sql, params, cols, ConsultaGuardada) aplicando el
    alcance por asignación cuando corresponde."""
    g = session.get(ConsultaGuardada, gid)
    if not g:
        raise HTTPException(404, "Consulta no encontrada")
    if not _puede_ver(session, user, g):
        raise HTTPException(403, "No tienes acceso a esta consulta")
    c = ConsultaIn(**(g.definicion or {}))
    from ..scope import ids_asignados as _ids_asignados, confid_ocultos as _confid_ocultos
    restr = None
    if (g.alcance or "asignados") == "asignados":
        restr = _ids_asignados(session, user)     # None = Admin/Super = todas
    sql, params, cols = _armar(c, restringir_ids=restr,
                               confid_ocultos=_confid_ocultos(session, user))
    return g, c, sql, params, cols


@router.post("/publicadas/{gid}/ejecutar")
def ejecutar_publicada(gid: int, session: Session = Depends(get_session),
                       user: Usuario = Depends(require_perm("consultas.ver"))):
    """Ejecuta una consulta compartida. No expone el SQL al consumidor."""
    g, c, sql, params, cols = _preparar_publicada(session, user, gid)
    filas = _correr(sql, params)
    limite = max(1, min(int(c.limite or LIMITE_DEF), LIMITE_MAX))
    return {"nombre": g.nombre, "columnas": cols, "filas": filas,
            "total": len(filas), "truncado": len(filas) >= limite, "limite": limite}


@router.post("/publicadas/{gid}/exportar")
def exportar_publicada(gid: int, session: Session = Depends(get_session),
                       user: Usuario = Depends(require_perm("consultas.ver"))):
    g, c, sql, params, cols = _preparar_publicada(session, user, gid)
    return _excel(c.tabla, cols, _correr(sql, params), titulo=g.nombre)
