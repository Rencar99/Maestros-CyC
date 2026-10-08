"""Siembra de datos de arranque.

El catálogo **CIIU no se hardcodea en el código**: vive en la tabla ``ciiu`` y
se siembra desde ``seed_data/ciiu.csv`` (reemplazable por la lista oficial
completa de la DIAN). Aquí también irán, más adelante, el admin inicial y otros
datos base (espejo de Documentos DIAN).
"""
from __future__ import annotations

import csv
from pathlib import Path

from sqlmodel import Session, select

from .db import engine
from .models import (Cargo, Ciiu, Entidad, FormaCobro, Municipio, ObligacionTipo,
                     Permiso, Responsabilidad, Rol, RolPermiso, TipoDocumento,
                     Usuario)

# Prefijo DANE (2 dígitos) -> nombre del departamento.
DEPTOS = {
    "05": "Antioquia", "08": "Atlántico", "11": "Bogotá D.C.", "13": "Bolívar",
    "15": "Boyacá", "17": "Caldas", "18": "Caquetá", "19": "Cauca", "20": "Cesar",
    "23": "Córdoba", "25": "Cundinamarca", "27": "Chocó", "41": "Huila",
    "44": "La Guajira", "47": "Magdalena", "50": "Meta", "52": "Nariño",
    "54": "Norte de Santander", "63": "Quindío", "66": "Risaralda",
    "68": "Santander", "70": "Sucre", "73": "Tolima", "76": "Valle del Cauca",
    "81": "Arauca", "85": "Casanare", "86": "Putumayo",
    "88": "Archipiélago de San Andrés", "91": "Amazonas", "94": "Guainía",
    "95": "Guaviare", "97": "Vaupés", "99": "Vichada",
}
from .security import hash_password

CARGOS_BASE = ["Socio", "Revisor Fiscal", "Contador", "Coordinador",
               "Auxiliar contable", "Asistente"]

# Tipos de documento de la DIAN (mismo orden del portal MUISCA).
TIPOS_DOC = [
    ("RC", "Registro civil"), ("TI", "Tarjeta de identidad"),
    ("CC", "Cédula de ciudadanía"), ("CR", "Certificado de Registraduría"),
    ("SI", "Sucesión ilíquida"), ("TE", "Tarjeta de extranjería"),
    ("CE", "Cédula de extranjería"), ("NT", "NIT"),
    ("IE", "Identificación de extranjeros"), ("PA", "Pasaporte"),
    ("DE", "Documento extranjero"), ("SD", "Sin identif. del exterior"),
    ("PJ", "Doc. extranjero P. Jurídica"), ("PEP", "Permiso especial / PPT"),
    ("NP", "NIT de otro país"),
]


def bootstrap_tipos_doc() -> None:
    """Siembra el catálogo de tipos de documento la primera vez."""
    with Session(engine) as s:
        if s.exec(select(TipoDocumento)).first():
            return
        for i, (cod, desc) in enumerate(TIPOS_DOC):
            s.add(TipoDocumento(codigo=cod, descripcion=desc, orden=i))
        s.commit()


# Formas de cobro de un servicio (editable desde Catálogos).
FORMAS_COBRO = [("Fa", "Factura"), ("CC", "Cuenta de cobro"), ("Ma", "Mandato")]


def bootstrap_formas_cobro() -> None:
    """Siembra Fa/CC/Ma y agrega las faltantes si la tabla ya existía."""
    with Session(engine) as s:
        for i, (cod, desc) in enumerate(FORMAS_COBRO):
            if not s.get(FormaCobro, cod):
                s.add(FormaCobro(codigo=cod, descripcion=desc, orden=i))
        s.commit()


# ---------------------------------------------------------- Roles y permisos
# Catálogo de permisos: (sección, [(acción, etiqueta)]). Llave = "seccion.accion".
PERMISOS_CAT = [
    ("clientes", [("ver", "Ver"), ("crear", "Crear"), ("editar", "Editar"),
                  ("eliminar", "Eliminar"), ("exportar", "Exportar"), ("importar", "Importar"),
                  ("ver_confidencial", "Ver confidenciales")]),
    ("responsables", [("ver", "Ver"), ("crear", "Crear"), ("editar", "Editar"), ("eliminar", "Eliminar")]),
    ("claves", [("ver", "Ver"), ("crear", "Crear"), ("editar", "Editar"),
                ("eliminar", "Eliminar"), ("revelar", "Revelar clave"), ("exportar", "Exportar")]),
    ("facturacion", [("ver", "Ver"), ("crear", "Crear"), ("editar", "Editar"),
                     ("eliminar", "Eliminar"), ("exportar", "Exportar"), ("aprobar", "Aprobar"), ("validar", "Validar")]),
    ("catalogos", [("ver", "Ver"), ("editar", "Editar")]),
    ("consultas", [("ver", "Ver y ejecutar"), ("generar", "Generar consultas")]),
    ("config", [("roles", "Administrar roles")]),
]

# Permisos por rol semilla (replican el comportamiento actual). Super = todos.
_ADMIN_PERMS = (
    ["clientes." + a for a in ("ver", "crear", "editar", "eliminar", "exportar")]
    + ["responsables." + a for a in ("ver", "crear", "editar", "eliminar")]
    + ["claves." + a for a in ("ver", "crear", "editar", "eliminar", "revelar", "exportar")]
    + ["catalogos.ver", "catalogos.editar"]
    + ["consultas.ver"]           # consumo de consultas compartidas (no generar)
)
# Consulta preserva el flujo de "claves de mis clientes asignados" (ver/revelar/
# exportar, ya filtrado por asignación en el backend) + lecturas.
_CONSULTA_PERMS = [
    "clientes.ver", "responsables.ver", "catalogos.ver",
    "claves.ver", "claves.revelar", "claves.exportar",
    "consultas.ver",              # consumo de consultas compartidas (no generar)
]


def todas_las_claves() -> list[str]:
    return [f"{sec}.{acc}" for sec, accs in PERMISOS_CAT for acc, _ in accs]


def bootstrap_roles() -> None:
    """Siembra el catálogo de permisos, los 3 roles semilla y sus permisos, y
    migra el ``rol_id`` de los usuarios existentes según su ``rol`` de texto."""
    with Session(engine) as s:
        # 1) Catálogo de permisos (idempotente por clave; refresca etiqueta/orden).
        orden = 0
        nuevo_generar = False
        for sec, accs in PERMISOS_CAT:
            for acc, etq in accs:
                clave = f"{sec}.{acc}"
                p = s.get(Permiso, clave)
                if not p:
                    if clave == "consultas.generar":
                        nuevo_generar = True
                    s.add(Permiso(clave=clave, seccion=sec, accion=acc, etiqueta=etq, orden=orden))
                else:
                    p.etiqueta = etq; p.orden = orden; s.add(p)
                orden += 1
        # 2) Roles semilla (idempotente por nombre).
        roles = {r.nombre: r for r in s.exec(select(Rol)).all()}
        defs = [("Super Usuario", True, 0), ("Administrador", False, 1), ("Consulta", False, 2)]
        for nombre, sist, orden_r in defs:
            if nombre not in roles:
                r = Rol(nombre=nombre, sistema=sist, orden=orden_r, activo=True)
                s.add(r); s.commit(); s.refresh(r); roles[nombre] = r
        # 3) Permisos de cada rol (solo la 1ª vez: si el rol no tiene ninguno).
        def _sembrar(rol: Rol, claves: list[str]) -> None:
            hay = s.exec(select(RolPermiso).where(RolPermiso.rol_id == rol.id)).first()
            if hay:
                return
            for c in claves:
                s.add(RolPermiso(rol_id=rol.id, permiso_clave=c))
        _sembrar(roles["Administrador"], _ADMIN_PERMS)
        _sembrar(roles["Consulta"], _CONSULTA_PERMS)
        s.commit()
        # 3b) Migración única: al estrenar "consultas.generar", conceder el consumo
        #     (consultas.ver) a los roles no-Super existentes que aún no lo tengan.
        #     Corre una sola vez (cuando el permiso aparece por primera vez), así no
        #     pisa ajustes que el usuario haga luego en la matriz.
        if nuevo_generar:
            for rol in s.exec(select(Rol)).all():
                if rol.sistema:
                    continue
                tiene = s.exec(select(RolPermiso).where(
                    RolPermiso.rol_id == rol.id,
                    RolPermiso.permiso_clave == "consultas.ver")).first()
                if not tiene:
                    s.add(RolPermiso(rol_id=rol.id, permiso_clave="consultas.ver"))
            s.commit()
        # 4) Migrar usuarios sin rol_id, según su `rol` de texto.
        mapa = {"superadmin": roles["Super Usuario"].id,
                "admin": roles["Administrador"].id}
        for u in s.exec(select(Usuario)).all():
            if u.rol_id is None:
                u.rol_id = mapa.get(u.rol, roles["Consulta"].id)
                s.add(u)
        s.commit()


def _leer_cod_csv(nombre: str) -> list[tuple[str, str]]:
    """Lee un CSV ``codigo,descripcion`` de seed_data (UTF-8)."""
    archivo = SEED_DIR / nombre
    if not archivo.exists():
        return []
    filas: list[tuple[str, str]] = []
    with archivo.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            cod = (row.get("codigo") or "").strip()
            desc = (row.get("descripcion") or "").strip()
            if cod and desc:
                filas.append((cod, desc))
    return filas


def bootstrap_responsabilidades() -> None:
    """Siembra las responsabilidades del RUT (casilla 53) desde CSV la 1ª vez."""
    with Session(engine) as s:
        if s.exec(select(Responsabilidad)).first():
            return
        for i, (cod, desc) in enumerate(_leer_cod_csv("responsabilidades.csv")):
            s.add(Responsabilidad(codigo=cod, descripcion=desc, orden=i))
        s.commit()


def bootstrap_cargos() -> None:
    """Siembra unos cargos base la primera vez (si la tabla está vacía)."""
    with Session(engine) as s:
        if s.exec(select(Cargo)).first():
            return
        for d in CARGOS_BASE:
            s.add(Cargo(descripcion=d, activo=True))
        s.commit()


# Entidades / entes de control (alimentan el Calendario y el Ente de Obligaciones).
ENTIDADES_BASE = [
    ("DIAN", "DIAN"), ("UGPP (PILA)", "UGPP"), ("Super Salud", "Supersalud"),
    ("Super Sociedades", "Supersociedades"), ("Super Financiera", "Superfinanciera"),
    ("Super Transporte", "Supertransporte"), ("Superservicios Públicos", "SSPD"),
    ("Hacienda CTG", "Hacienda CTG"),
]


def bootstrap_entidades() -> None:
    """Siembra las entidades base la primera vez (si la tabla está vacía)."""
    with Session(engine) as s:
        if s.exec(select(Entidad)).first():
            return
        for nombre, sigla in ENTIDADES_BASE:
            s.add(Entidad(nombre=nombre, sigla=sigla, activo=True))
        s.commit()


# Catálogo canónico (codigo, descripcion, ente, periodicidad, digitos_nit, origen, criterio).
# criterio: nit1 | nit2 | fijo | grupo | municipio. origen: dian (deriva del perfil) | manual.
# (codigo, descripcion, ente, periodicidad, digitos, origen, criterio, disparador)
OBLIGACIONES_CANON = [
    ("RETEFUENTE",      "Retención en la fuente",       "DIAN", "Mensual",       1, "dian", "nit1", "retencion"),
    ("IVA_BIM",         "IVA Bimestral",                "DIAN", "Bimestral",     1, "dian", "nit1", "iva_bim"),
    ("IVA_CUAT",        "IVA Cuatrimestral",            "DIAN", "Cuatrimestral", 1, "dian", "nit1", "iva_cuat"),
    ("RENTA_JUR",       "Renta Personas Jurídicas",     "DIAN", "Anual",         1, "dian", "nit1", "renta_jur"),
    ("RENTA_GC",        "Renta Grandes Contribuyentes", "DIAN", "Anual",         1, "dian", "nit1", "renta_gc"),
    ("RENTA_NAT",       "Renta Personas Naturales",     "DIAN", "Anual",         2, "dian", "nit2", "renta_nat"),
    ("RST",             "RST — Declaración anual",      "DIAN", "Anual",         1, "dian", "nit1", "rst_anual"),
    ("RST_ANT",         "RST — Anticipo bimestral",     "DIAN", "Bimestral",     1, "dian", "nit1", "rst_anticipo"),
    ("IVA_ANUAL",       "IVA Anual (RST)",              "DIAN", "Anual",         1, "dian", "nit1", "iva_anual"),
    ("EXOGENA",         "Exógena (jurídicas/naturales)", "DIAN", "Anual",        2, "dian", "nit2", "exogena_jn"),
    ("EXOGENA_GC",      "Exógena (grandes contribuyentes)", "DIAN", "Anual",     1, "dian", "nit1", "exogena_gc"),
    ("BENEF_FIN",       "Beneficiarios Finales (RUB)",  "DIAN", "Anual",         1, "dian", "nit1", "beneficiarios"),
    ("NOMINA_ELEC",     "Nómina electrónica",           "DIAN", "Mensual",       1, "manual", "nit1", ""),
    ("PILA",            "Seguridad social (PILA)",      "UGPP (PILA)",            "Mensual", 2, "manual", "nit2", ""),
    ("SUPERSOCIEDADES", "Supersociedades",              "Supersociedades",        "Anual",   0, "manual", "grupo", ""),
    ("SUPERSALUD",      "Supersalud",                   "Supersalud",             "Anual",   0, "manual", "fijo", ""),
    ("SUPERTRANSPORTE", "Supertransporte",              "Supertransporte",        "Anual",   0, "manual", "fijo", ""),
    ("SUPERSERVICIOS",  "Superservicios Públicos",      "Superservicios Públicos", "Anual",  0, "manual", "fijo", ""),
    ("SUPERFINANCIERA", "Superfinanciera",              "Superfinanciera",        "Mensual", 0, "manual", "fijo", ""),
]


def bootstrap_obligaciones() -> None:
    """Siembra el catálogo base la PRIMERA vez. NO destructivo: solo crea las que
    faltan (por código o descripción); nunca pisa ediciones del usuario."""
    import re
    import unicodedata

    def _nk(x: str) -> str:  # descripción normalizada sin acentos ni espacios
        x = unicodedata.normalize("NFD", (x or "").lower())
        return re.sub(r"[^a-z0-9]", "", "".join(c for c in x if unicodedata.category(c) != "Mn"))

    with Session(engine) as s:
        filas = s.exec(select(ObligacionTipo)).all()
        cods = {t.codigo for t in filas if t.codigo}
        descs = {t.descripcion for t in filas}
        nkeys = {_nk(t.descripcion) for t in filas}
        disps = {t.disparador for t in filas if t.disparador}
        for codigo, desc, ente, per, dig, origen, criterio, disp in OBLIGACIONES_CANON:
            # no recrear si ya existe por código, descripción, descripción-sin-espacios,
            # o (DIAN) por disparador → respeta renombres del usuario.
            if codigo in cods or desc in descs or _nk(desc) in nkeys or (disp and disp in disps):
                continue
            s.add(ObligacionTipo(codigo=codigo, descripcion=desc, ente=ente, periodicidad=per,
                                 digitos_nit=dig, origen=origen, criterio=criterio, disparador=disp))
            cods.add(codigo); descs.add(desc); nkeys.add(_nk(desc))
            if disp:
                disps.add(disp)
        s.commit()


def bootstrap_formularios() -> None:
    """Siembra el catálogo de Formularios DIAN la primera vez (no destructivo)."""
    from .models import Formulario
    BASE = [("Formulario 350 (Rete Renta)", "Rete_Renta")]
    with Session(engine) as s:
        cods = {f.codigo_calendario for f in s.exec(select(Formulario)).all() if f.codigo_calendario}
        nombres = {f.nombre for f in s.exec(select(Formulario)).all()}
        nuevo = False
        for nombre, cod in BASE:
            if nombre in nombres or (cod and cod in cods):
                continue
            s.add(Formulario(nombre=nombre, codigo_calendario=cod, activo=True))
            nuevo = True
        if nuevo:
            s.commit()


def bootstrap_disparadores_canon() -> None:
    """Fija los disparadores canónicos que faltaban en el catálogo, para que la
    derivación (Maestros = fuente única) los reconozca. Idempotente y NO
    destructivo: solo escribe cuando el disparador está VACÍO (respeta ediciones).
      · INC     → 'inc'     (aplica con responsabilidad 33)
      · RETEIVA → 'reteiva' (aplica con responsabilidad 07, agente retenedor)
    """
    CANON = {"INC": "inc", "RETEIVA": "reteiva"}
    with Session(engine) as s:
        cambiado = False
        for cod, disp in CANON.items():
            t = s.exec(select(ObligacionTipo).where(ObligacionTipo.codigo == cod)).first()
            if t and not (t.disparador or "").strip():
                t.disparador = disp
                s.add(t)
                cambiado = True
        if cambiado:
            s.commit()


SEED_DIR = Path(__file__).resolve().parent / "seed_data"


def bootstrap_admin() -> None:
    """Crea el usuario administrador inicial si no existe ninguno.

    Login ``admin`` / clave ``admin`` con cambio obligatorio al primer ingreso.
    Es un responsable interno.
    """
    with Session(engine) as s:
        if s.exec(select(Usuario).where(Usuario.rol == "admin")).first():
            return
        s.add(Usuario(tipo="Int", nombre="Administrador", usuario="admin",
                      password_hash=hash_password("admin"), rol="admin",
                      activo=True, debe_cambiar=True))
        s.commit()


def _leer_ciiu_csv() -> list[tuple[str, str]]:
    archivo = SEED_DIR / "ciiu.csv"
    if not archivo.exists():
        return []
    filas: list[tuple[str, str]] = []
    with archivo.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            cod = (row.get("codigo") or "").strip()
            desc = (row.get("descripcion") or "").strip()
            if cod and desc:
                filas.append((cod, desc))
    return filas


def _leer_municipios_csv() -> list[tuple[str, str]]:
    archivo = SEED_DIR / "municipios.csv"
    if not archivo.exists():
        return []
    filas: list[tuple[str, str]] = []
    with archivo.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            cod = (row.get("codigo") or "").strip()
            nom = (row.get("nombre") or "").strip()
            if cod and nom:
                filas.append((cod, nom))
    return filas


def cargar_municipios(*, solo_si_vacio: bool) -> int:
    """Carga/actualiza municipios desde el CSV (upsert por código DANE).

    El departamento se deriva del prefijo de 2 dígitos. Devuelve cuántas filas
    se insertaron o actualizaron."""
    filas = _leer_municipios_csv()
    if not filas:
        return 0
    cambios = 0
    with Session(engine) as s:
        if solo_si_vacio and s.exec(select(Municipio)).first():
            return 0
        for cod, nom in filas:
            depto = DEPTOS.get(cod[:2], "")
            existente = s.get(Municipio, cod)
            if existente is None:
                s.add(Municipio(codigo=cod, nombre=nom, departamento=depto))
                cambios += 1
            elif existente.nombre != nom or existente.departamento != depto:
                existente.nombre = nom
                existente.departamento = depto
                s.add(existente)
                cambios += 1
        s.commit()
    return cambios


def bootstrap_municipios() -> None:
    """Siembra el catálogo de municipios la primera vez (si está vacío)."""
    cargar_municipios(solo_si_vacio=True)


def bootstrap_ciiu() -> int:
    """Carga/actualiza el catálogo CIIU desde el CSV (upsert por código).

    Devuelve cuántas filas se insertaron o actualizaron. Idempotente: correr de
    nuevo no duplica; solo agrega códigos nuevos o corrige descripciones.
    """
    filas = _leer_ciiu_csv()
    if not filas:
        return 0
    cambios = 0
    with Session(engine) as s:
        for cod, desc in filas:
            existente = s.get(Ciiu, cod)
            if existente is None:
                s.add(Ciiu(codigo=cod, descripcion=desc))
                cambios += 1
            elif existente.descripcion != desc:
                existente.descripcion = desc
                s.add(existente)
                cambios += 1
        s.commit()
    return cambios
