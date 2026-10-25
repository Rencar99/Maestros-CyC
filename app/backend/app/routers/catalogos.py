"""Catálogos: Rol del Servicio, Software, Cargo y Tipos de documento (editables)
+ CIIU (referencia DIAN)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user, require_perm
from ..models import (AnclaPeriodo, Cargo, Ciiu, ClienteObligacion, Emisor, Entidad, FormaCobro,
                      GrupoEconomico, Municipio, ObligacionCumplimiento, ObligacionEtapa,
                      ObligacionTipo, PlazoVencimiento, Portal, Responsabilidad, RolServicio,
                      Software, TipoDocumento)
from ..schemas import CatItemCreate, CatItemRead, CatItemUpdate, CiiuRead
from ..seed import bootstrap_ciiu, cargar_municipios

router = APIRouter(prefix="/api/catalogos", tags=["catalogos"])

# Mapea el nombre de ruta al modelo de tabla.
_MODELOS = {"rol-servicio": RolServicio, "software": Software, "cargo": Cargo,
            "grupo-economico": GrupoEconomico, "portal": Portal,
            "obligacion-tipo": ObligacionTipo}


def _modelo(nombre: str):
    m = _MODELOS.get(nombre)
    if not m:
        raise HTTPException(404, "Catálogo no encontrado")
    return m


# ================================================= Catálogos por código (TD, Resp.)
# OJO: estas rutas van ANTES del genérico ``/{cat}`` para que no las capture.
class CodCreate(BaseModel):
    codigo: str
    descripcion: str = ""


class CodUpdate(BaseModel):
    descripcion: str


def _registrar_codigo_cat(path: str, modelo, etiqueta: str) -> None:
    """Registra CRUD (código + descripción) para un catálogo de clave string."""

    @router.get(f"/{path}", name=f"list_{path}")
    def _listar(session: Session = Depends(get_session), _u=Depends(get_current_user)):
        ts = session.exec(select(modelo).order_by(modelo.orden)).all()
        return [{"codigo": t.codigo, "descripcion": t.descripcion} for t in ts]

    @router.post(f"/{path}", status_code=201, name=f"create_{path}")
    def _crear(data: CodCreate, session: Session = Depends(get_session), _admin=Depends(require_perm("catalogos.editar"))):
        codigo = (data.codigo or "").strip().upper()
        if not codigo:
            raise HTTPException(400, "El código es obligatorio")
        if session.get(modelo, codigo):
            raise HTTPException(409, f"Ya existe {etiqueta} con ese código")
        orden = (session.exec(select(func.max(modelo.orden)).select_from(modelo)).one() or -1) + 1
        t = modelo(codigo=codigo, descripcion=(data.descripcion or "").strip(), orden=orden)
        session.add(t)
        session.commit()
        return {"codigo": t.codigo, "descripcion": t.descripcion}

    @router.put(f"/{path}/{{codigo}}", name=f"update_{path}")
    def _actualizar(codigo: str, data: CodUpdate, session: Session = Depends(get_session),
                    _admin=Depends(require_perm("catalogos.editar"))):
        t = session.get(modelo, codigo)
        if not t:
            raise HTTPException(404, f"No se encontró {etiqueta}")
        t.descripcion = (data.descripcion or "").strip()
        session.add(t)
        session.commit()
        return {"codigo": t.codigo, "descripcion": t.descripcion}

    @router.delete(f"/{path}/{{codigo}}", status_code=204, name=f"delete_{path}")
    def _borrar(codigo: str, session: Session = Depends(get_session), _admin=Depends(require_perm("catalogos.editar"))):
        t = session.get(modelo, codigo)
        if not t:
            raise HTTPException(404, f"No se encontró {etiqueta}")
        session.delete(t)
        session.commit()


_registrar_codigo_cat("tipo-documento", TipoDocumento, "un tipo de documento")
_registrar_codigo_cat("responsabilidad", Responsabilidad, "una responsabilidad")
_registrar_codigo_cat("forma-cobro", FormaCobro, "una forma de cobro")


# ============================================================ CIIU (referencia)
# También antes del genérico: ``/ciiu/...`` son dos segmentos y se agrupan aquí.
@router.get("/ciiu/buscar", response_model=list[CiiuRead])
def buscar_ciiu(q: str = "", session: Session = Depends(get_session), _u=Depends(get_current_user)):
    """Busca CIIU por código (prefijo) o por nombre (contiene). Devuelve hasta 40."""
    consulta = select(Ciiu)
    q = (q or "").strip()
    if q:
        patron = f"%{q}%"
        consulta = consulta.where((Ciiu.codigo.like(f"{q}%")) | (Ciiu.descripcion.ilike(patron)))
    filas = session.exec(consulta.order_by(Ciiu.codigo).limit(2000)).all()
    return [CiiuRead.model_validate(x, from_attributes=True) for x in filas]


@router.post("/ciiu/recargar")
def recargar_ciiu(_admin=Depends(require_perm("catalogos.editar"))):
    """Recarga el catálogo CIIU desde el CSV (upsert). Solo administrador."""
    return {"cambios": bootstrap_ciiu()}


# ============================================================ Municipios (referencia)
@router.get("/municipio/buscar")
def buscar_municipio(q: str = "", session: Session = Depends(get_session), _u=Depends(get_current_user)):
    """Busca municipios por código (prefijo) o nombre (contiene). Hasta 40."""
    consulta = select(Municipio)
    q = (q or "").strip()
    if q:
        patron = f"%{q}%"
        consulta = consulta.where((Municipio.codigo.like(f"{q}%")) | (Municipio.nombre.ilike(patron)))
    filas = session.exec(consulta.order_by(Municipio.nombre).limit(2000)).all()
    return [{"codigo": m.codigo, "nombre": m.nombre, "departamento": m.departamento} for m in filas]


@router.post("/municipio/recargar")
def recargar_municipio(_admin=Depends(require_perm("catalogos.editar"))):
    """Recarga el catálogo de municipios desde el CSV (upsert). Solo admin."""
    return {"cambios": cargar_municipios(solo_si_vacio=False)}


# ============================================================ Obligaciones (con metadata)
# Antes del genérico: devuelve los campos extra del calendario y filtra por origen.
def _oblig_dict(t: ObligacionTipo) -> dict:
    return {"id": t.id, "descripcion": t.descripcion, "activo": t.activo,
            "codigo": t.codigo, "ente": t.ente, "periodicidad": t.periodicidad,
            "criterio": t.criterio, "digitos_nit": t.digitos_nit, "origen": t.origen,
            "disparador": t.disparador, "familia": t.familia,
            "genera_pago": t.genera_pago, "formulario_pago": t.formulario_pago,
            "plazo_pago_fatal_num": t.plazo_pago_fatal_num,
            "plazo_pago_fatal_unidad": t.plazo_pago_fatal_unidad,
            "consecuencia_impago": t.consecuencia_impago,
            "tam_intervalo": t.tam_intervalo, "paso_dias_habiles": t.paso_dias_habiles}


_DIG_CRIT = {"nit1": 1, "nit2": 2}   # criterio -> nº de dígitos (0 para fijo/grupo/municipio)
# Familia (agrupación visual en el Calendario). Cualquier valor fuera del set -> "otras".
_FAMILIAS = {"dian", "super", "municipal", "nomina", "otras"}


def _norm_familia(v: str) -> str:
    return v if v in _FAMILIAS else "otras"


class ObligTipoIn(BaseModel):
    codigo: str = ""
    descripcion: str
    ente: str = ""
    criterio: str = "nit1"      # nit1 | nit2 | fijo | grupo | municipio
    periodicidad: str = ""
    origen: str = "manual"      # dian | manual
    disparador: str = ""        # qué la activa (anclaje estable)
    activo: bool = True
    tam_intervalo: int = 0          # generación (Calendario lee): tamaño de intervalo de NIT
    paso_dias_habiles: int = 1      # generación (Calendario lee): días hábiles por grupo
    familia: str = "otras"          # agrupación visual (Calendario): dian|super|municipal|nomina|otras
    genera_pago: bool = False       # ¿genera un pago a verificar? (Calendario lo lee para el hito de pago)
    formulario_pago: str = ""       # formulario DIAN que paga (350/300/110/210/315…); vacío = municipal/sin 490
    plazo_pago_fatal_num: int = 0   # plazo fatal de pago desde el vencimiento (0 = sin plazo fatal)
    plazo_pago_fatal_unidad: str = ""   # "dias" | "meses"
    consecuencia_impago: str = ""   # "ineficacia" | "exclusion_rst" | ""


@router.get("/obligacion-tipo")
def listar_obligacion_tipo(origen: str = "", session: Session = Depends(get_session),
                           _u=Depends(get_current_user)):
    q = select(ObligacionTipo)
    if origen:
        q = q.where(ObligacionTipo.origen == origen)
    filas = session.exec(q.order_by(ObligacionTipo.ente, ObligacionTipo.descripcion)).all()
    return [_oblig_dict(t) for t in filas]


@router.post("/obligacion-tipo", status_code=201)
def crear_obligacion_tipo(data: ObligTipoIn, session: Session = Depends(get_session),
                          _admin=Depends(require_perm("catalogos.editar"))):
    desc = data.descripcion.strip()
    cod = data.codigo.strip().upper()
    if not cod:
        raise HTTPException(400, "El código es obligatorio (es la llave estable, no se podrá cambiar luego)")
    if not desc:
        raise HTTPException(400, "La descripción es obligatoria")
    if session.exec(select(ObligacionTipo).where(ObligacionTipo.codigo == cod)).first():
        raise HTTPException(409, "Ya existe una obligación con ese código")
    if session.exec(select(ObligacionTipo).where(ObligacionTipo.descripcion == desc)).first():
        raise HTTPException(409, "Ya existe una obligación con esa descripción")
    t = ObligacionTipo(
        descripcion=desc, codigo=cod, ente=data.ente.strip(),
        criterio=data.criterio, periodicidad=data.periodicidad, origen=data.origen,
        disparador=data.disparador, digitos_nit=_DIG_CRIT.get(data.criterio, 0), activo=data.activo,
        tam_intervalo=data.tam_intervalo, paso_dias_habiles=data.paso_dias_habiles,
        familia=_norm_familia(data.familia),
        genera_pago=data.genera_pago,
        formulario_pago=(data.formulario_pago.strip() if data.genera_pago else ""),
        plazo_pago_fatal_num=(data.plazo_pago_fatal_num if data.genera_pago else 0),
        plazo_pago_fatal_unidad=(data.plazo_pago_fatal_unidad.strip() if data.genera_pago else ""),
        consecuencia_impago=(data.consecuencia_impago.strip() if data.genera_pago else ""))
    session.add(t)
    session.commit()
    session.refresh(t)
    return _oblig_dict(t)


@router.put("/obligacion-tipo/{item_id}")
def actualizar_obligacion_tipo(item_id: int, data: ObligTipoIn,
                               session: Session = Depends(get_session),
                               _admin=Depends(require_perm("catalogos.editar"))):
    t = session.get(ObligacionTipo, item_id)
    if not t:
        raise HTTPException(404, "Obligación no encontrada")
    # El código es INMUTABLE (llave estable): se ignora cualquier cambio.
    t.descripcion = data.descripcion.strip()
    t.ente = data.ente.strip()
    t.criterio = data.criterio
    t.periodicidad = data.periodicidad
    t.origen = data.origen
    t.disparador = data.disparador
    t.digitos_nit = _DIG_CRIT.get(data.criterio, 0)
    t.activo = data.activo
    t.tam_intervalo = data.tam_intervalo
    t.paso_dias_habiles = data.paso_dias_habiles
    t.familia = _norm_familia(data.familia)
    t.genera_pago = data.genera_pago
    t.formulario_pago = data.formulario_pago.strip() if data.genera_pago else ""
    t.plazo_pago_fatal_num = data.plazo_pago_fatal_num if data.genera_pago else 0
    t.plazo_pago_fatal_unidad = data.plazo_pago_fatal_unidad.strip() if data.genera_pago else ""
    t.consecuencia_impago = data.consecuencia_impago.strip() if data.genera_pago else ""
    # modo_generacion NO se toca: es de Calendario, se preserva.
    session.add(t)
    session.commit()
    session.refresh(t)
    return _oblig_dict(t)


@router.delete("/obligacion-tipo/{item_id}", status_code=204)
def borrar_obligacion_tipo(item_id: int, session: Session = Depends(get_session),
                           _admin=Depends(require_perm("catalogos.editar"))):
    t = session.get(ObligacionTipo, item_id)
    if not t:
        raise HTTPException(404, "Obligación no encontrada")
    en_clientes = session.exec(select(ClienteObligacion).where(
        ClienteObligacion.obligacion_tipo_id == item_id)).first()
    con_plazos = session.exec(select(PlazoVencimiento).where(
        PlazoVencimiento.obligacion_tipo_id == item_id)).first()
    con_cumpl = session.exec(select(ObligacionCumplimiento).where(
        ObligacionCumplimiento.obligacion_tipo_id == item_id)).first()
    con_anclas = session.exec(select(AnclaPeriodo).where(
        AnclaPeriodo.obligacion_tipo_id == item_id)).first()
    if en_clientes or con_plazos or con_cumpl or con_anclas:
        raise HTTPException(409, "No se puede eliminar: tiene entradas en el Calendario "
                                 "(asignada a clientes, plazos, cumplimientos o anclas). "
                                 "Desactívala en su lugar.")
    session.delete(t)
    session.commit()


# ===================================================== Etapas de la obligación (plantilla)
# Subtareas con vencimiento ANTERIOR al de la obligación (p. ej. EXÓGENA: preparar data,
# Formato 1001, 1002…). Maestros define la PLANTILLA por tipo de obligación; el Calendario
# la materializa por cliente y lleva el avance por período. ``dias_antes`` son días HÁBILES.
def _etapa_dict(e: ObligacionEtapa) -> dict:
    return {"id": e.id, "obligacion_tipo_id": e.obligacion_tipo_id, "orden": e.orden,
            "nombre": e.nombre, "codigo": e.codigo, "dias_antes": e.dias_antes,
            "activa": e.activa, "nota": e.nota}


class EtapaIn(BaseModel):
    nombre: str
    codigo: str = ""
    dias_antes: int = 0
    activa: bool = True
    nota: str = ""


class OrdenIn(BaseModel):
    ids: list[int]


@router.get("/obligacion-tipo/{tid}/etapas")
def listar_etapas(tid: int, session: Session = Depends(get_session), _u=Depends(get_current_user)):
    """Etapas (plantilla) de un tipo de obligación, en orden."""
    filas = session.exec(select(ObligacionEtapa)
                         .where(ObligacionEtapa.obligacion_tipo_id == tid)
                         .order_by(ObligacionEtapa.orden)).all()
    return [_etapa_dict(e) for e in filas]


@router.post("/obligacion-tipo/{tid}/etapas", status_code=201)
def crear_etapa(tid: int, data: EtapaIn, session: Session = Depends(get_session),
                _admin=Depends(require_perm("catalogos.editar"))):
    if not session.get(ObligacionTipo, tid):
        raise HTTPException(404, "Obligación no encontrada")
    if not data.nombre.strip():
        raise HTTPException(400, "El nombre de la etapa es obligatorio")
    ultimo = session.exec(select(ObligacionEtapa)
                          .where(ObligacionEtapa.obligacion_tipo_id == tid)
                          .order_by(ObligacionEtapa.orden.desc())).first()
    e = ObligacionEtapa(
        obligacion_tipo_id=tid, orden=(ultimo.orden + 1) if ultimo else 1,
        nombre=data.nombre.strip(), codigo=data.codigo.strip(),
        dias_antes=max(0, data.dias_antes), activa=data.activa, nota=data.nota.strip())
    session.add(e)
    session.commit()
    session.refresh(e)
    return _etapa_dict(e)


@router.put("/etapa/{eid}")
def actualizar_etapa(eid: int, data: EtapaIn, session: Session = Depends(get_session),
                     _admin=Depends(require_perm("catalogos.editar"))):
    e = session.get(ObligacionEtapa, eid)
    if not e:
        raise HTTPException(404, "Etapa no encontrada")
    if not data.nombre.strip():
        raise HTTPException(400, "El nombre de la etapa es obligatorio")
    e.nombre = data.nombre.strip()
    e.codigo = data.codigo.strip()
    e.dias_antes = max(0, data.dias_antes)
    e.activa = data.activa
    e.nota = data.nota.strip()
    session.add(e)
    session.commit()
    return _etapa_dict(e)


@router.delete("/etapa/{eid}", status_code=204)
def borrar_etapa(eid: int, session: Session = Depends(get_session),
                 _admin=Depends(require_perm("catalogos.editar"))):
    e = session.get(ObligacionEtapa, eid)
    if not e:
        raise HTTPException(404, "Etapa no encontrada")
    session.delete(e)
    session.commit()


@router.put("/obligacion-tipo/{tid}/etapas/orden")
def reordenar_etapas(tid: int, data: OrdenIn, session: Session = Depends(get_session),
                     _admin=Depends(require_perm("catalogos.editar"))):
    """Fija el orden de las etapas: orden = posición en la lista de ids recibida."""
    for pos, eid in enumerate(data.ids, start=1):
        e = session.get(ObligacionEtapa, eid)
        if e and e.obligacion_tipo_id == tid:
            e.orden = pos
            session.add(e)
    session.commit()
    filas = session.exec(select(ObligacionEtapa)
                         .where(ObligacionEtapa.obligacion_tipo_id == tid)
                         .order_by(ObligacionEtapa.orden)).all()
    return [_etapa_dict(e) for e in filas]


# ============================================================ Entidades (nombre + sigla)
def _entidad_dict(e: Entidad) -> dict:
    return {"id": e.id, "nombre": e.nombre, "sigla": e.sigla, "activo": e.activo}


class EntidadIn(BaseModel):
    nombre: str
    sigla: str = ""
    activo: bool = True


@router.get("/entidad")
def listar_entidad(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    filas = session.exec(select(Entidad).order_by(Entidad.nombre)).all()
    return [_entidad_dict(e) for e in filas]


@router.post("/entidad", status_code=201)
def crear_entidad(data: EntidadIn, session: Session = Depends(get_session),
                  _admin=Depends(require_perm("catalogos.editar"))):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    if session.exec(select(Entidad).where(Entidad.nombre == nombre)).first():
        raise HTTPException(409, "Ya existe una entidad con ese nombre")
    e = Entidad(nombre=nombre, sigla=data.sigla.strip(), activo=data.activo)
    session.add(e)
    session.commit()
    session.refresh(e)
    return _entidad_dict(e)


@router.put("/entidad/{item_id}")
def actualizar_entidad(item_id: int, data: EntidadIn, session: Session = Depends(get_session),
                       _admin=Depends(require_perm("catalogos.editar"))):
    e = session.get(Entidad, item_id)
    if not e:
        raise HTTPException(404, "Entidad no encontrada")
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    otro = session.exec(select(Entidad).where(Entidad.nombre == nombre, Entidad.id != item_id)).first()
    if otro:
        raise HTTPException(409, "Ya existe otra entidad con ese nombre")
    e.nombre = nombre
    e.sigla = data.sigla.strip()
    e.activo = data.activo
    session.add(e)
    session.commit()
    session.refresh(e)
    return _entidad_dict(e)


@router.delete("/entidad/{item_id}", status_code=204)
def borrar_entidad(item_id: int, session: Session = Depends(get_session),
                   _admin=Depends(require_perm("catalogos.editar"))):
    e = session.get(Entidad, item_id)
    if not e:
        raise HTTPException(404, "Entidad no encontrada")
    session.delete(e)
    session.commit()


# ============================================================ Emisores (cuentas de cobro)
def _emisor_dict(e: Emisor) -> dict:
    return {"id": e.id, "nombre": e.nombre, "cedula": e.cedula, "direccion": e.direccion,
            "celular": e.celular, "prefijo": e.prefijo, "consecutivo": e.consecutivo,
            "nota_383": e.nota_383, "firma": e.firma, "activo": e.activo}


class EmisorIn(BaseModel):
    nombre: str
    cedula: str = ""
    direccion: str = ""
    celular: str = ""
    prefijo: str = ""
    consecutivo: int = 0
    nota_383: bool = False
    firma: str = ""
    activo: bool = True


@router.get("/emisor")
def listar_emisor(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    filas = session.exec(select(Emisor).order_by(Emisor.nombre)).all()
    return [_emisor_dict(e) for e in filas]


@router.post("/emisor", status_code=201)
def crear_emisor(data: EmisorIn, session: Session = Depends(get_session),
                 _admin=Depends(require_perm("catalogos.editar"))):
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre del emisor es obligatorio")
    if session.exec(select(Emisor).where(Emisor.nombre == nombre)).first():
        raise HTTPException(409, "Ya existe un emisor con ese nombre")
    e = Emisor(nombre=nombre, cedula=data.cedula.strip(), direccion=data.direccion.strip(),
               celular=data.celular.strip(), prefijo=data.prefijo.strip().upper(),
               consecutivo=max(0, int(data.consecutivo or 0)), nota_383=data.nota_383,
               firma=data.firma, activo=data.activo)
    session.add(e)
    session.commit()
    session.refresh(e)
    return _emisor_dict(e)


@router.put("/emisor/{item_id}")
def actualizar_emisor(item_id: int, data: EmisorIn, session: Session = Depends(get_session),
                      _admin=Depends(require_perm("catalogos.editar"))):
    e = session.get(Emisor, item_id)
    if not e:
        raise HTTPException(404, "Emisor no encontrado")
    nombre = data.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre del emisor es obligatorio")
    otro = session.exec(select(Emisor).where(Emisor.nombre == nombre, Emisor.id != item_id)).first()
    if otro:
        raise HTTPException(409, "Ya existe otro emisor con ese nombre")
    e.nombre = nombre
    e.cedula = data.cedula.strip()
    e.direccion = data.direccion.strip()
    e.celular = data.celular.strip()
    e.prefijo = data.prefijo.strip().upper()
    e.consecutivo = max(0, int(data.consecutivo or 0))
    e.nota_383 = data.nota_383
    e.firma = data.firma
    e.activo = data.activo
    session.add(e)
    session.commit()
    session.refresh(e)
    return _emisor_dict(e)


@router.delete("/emisor/{item_id}", status_code=204)
def borrar_emisor(item_id: int, session: Session = Depends(get_session),
                  _admin=Depends(require_perm("catalogos.editar"))):
    e = session.get(Emisor, item_id)
    if not e:
        raise HTTPException(404, "Emisor no encontrado")
    session.delete(e)
    session.commit()


# ============================================================ Catálogos genéricos
@router.get("/{cat}", response_model=list[CatItemRead])
def listar(cat: str, session: Session = Depends(get_session), _u=Depends(get_current_user)):
    m = _modelo(cat)
    return [CatItemRead.model_validate(x, from_attributes=True)
            for x in session.exec(select(m)).all()]


@router.post("/{cat}", response_model=CatItemRead, status_code=201)
def crear(cat: str, data: CatItemCreate, session: Session = Depends(get_session),
          _admin=Depends(require_perm("catalogos.editar"))):
    m = _modelo(cat)
    if session.exec(select(m).where(m.descripcion == data.descripcion)).first():
        raise HTTPException(409, "Ya existe un elemento con esa descripción")
    x = m(**data.model_dump())
    session.add(x)
    session.commit()
    session.refresh(x)
    return CatItemRead.model_validate(x, from_attributes=True)


@router.put("/{cat}/{item_id}", response_model=CatItemRead)
def actualizar(cat: str, item_id: int, data: CatItemUpdate,
               session: Session = Depends(get_session), _admin=Depends(require_perm("catalogos.editar"))):
    m = _modelo(cat)
    x = session.get(m, item_id)
    if not x:
        raise HTTPException(404, "Elemento no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(x, k, v)
    session.add(x)
    session.commit()
    session.refresh(x)
    return CatItemRead.model_validate(x, from_attributes=True)


@router.delete("/{cat}/{item_id}", status_code=204)
def borrar(cat: str, item_id: int, session: Session = Depends(get_session),
           _admin=Depends(require_perm("catalogos.editar"))):
    m = _modelo(cat)
    x = session.get(m, item_id)
    if not x:
        raise HTTPException(404, "Elemento no encontrado")
    session.delete(x)
    session.commit()
