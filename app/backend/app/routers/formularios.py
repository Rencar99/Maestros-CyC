"""Catálogo de Formularios DIAN + autorización (matriz usuario × formulario) para
PRESENTAR borradores. Maestros solo aporta la AUTORIZACIÓN (quién puede presentar
qué formulario); el flujo de aprobación es de cada aplicativo (350, etc.), que
consulta ``/puede-presentar`` para gatear su botón "Presentar en DIAN".

Gestión (catálogo + matriz) = solo Super (``config.roles``). La consulta de
autorización la puede hacer cualquier usuario autenticado (la hace cada app en
nombre del usuario que va a presentar)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user, require_perm
from ..models import Formulario, Usuario, UsuarioFormulario

router = APIRouter(prefix="/api/formularios", tags=["formularios"])

_guard = Depends(require_perm("config.roles"))   # gestión = solo Super


def _dict(f: Formulario) -> dict:
    return {"id": f.id, "nombre": f.nombre, "codigo_calendario": f.codigo_calendario, "activo": f.activo}


class FormularioIn(BaseModel):
    nombre: str
    codigo_calendario: str = ""
    activo: bool = True


class AutorizadosIn(BaseModel):
    formulario_ids: list[int] = []


# -------------------------------------------------------------- Catálogo
@router.get("")
def listar(session: Session = Depends(get_session), _u: Usuario = Depends(get_current_user)):
    filas = session.exec(select(Formulario).order_by(Formulario.nombre)).all()
    return [_dict(f) for f in filas]


@router.post("", status_code=201)
def crear(data: FormularioIn, session: Session = Depends(get_session), _=_guard):
    nombre = data.nombre.strip()
    cod = data.codigo_calendario.strip()
    if not nombre:
        raise HTTPException(400, "El nombre del formulario es obligatorio")
    if session.exec(select(Formulario).where(Formulario.nombre == nombre)).first():
        raise HTTPException(409, "Ya existe un formulario con ese nombre")
    if cod and session.exec(select(Formulario).where(Formulario.codigo_calendario == cod)).first():
        raise HTTPException(409, "Ya existe un formulario con ese código de calendario")
    f = Formulario(nombre=nombre, codigo_calendario=cod, activo=data.activo)
    session.add(f)
    session.commit()
    session.refresh(f)
    return _dict(f)


@router.put("/{item_id}")
def actualizar(item_id: int, data: FormularioIn, session: Session = Depends(get_session), _=_guard):
    f = session.get(Formulario, item_id)
    if not f:
        raise HTTPException(404, "Formulario no encontrado")
    nombre = data.nombre.strip()
    cod = data.codigo_calendario.strip()
    choque = session.exec(select(Formulario).where(Formulario.nombre == nombre)).first()
    if choque and choque.id != item_id:
        raise HTTPException(409, "Ya existe otro formulario con ese nombre")
    if cod:
        ch2 = session.exec(select(Formulario).where(Formulario.codigo_calendario == cod)).first()
        if ch2 and ch2.id != item_id:
            raise HTTPException(409, "Ya existe otro formulario con ese código de calendario")
    f.nombre = nombre
    f.codigo_calendario = cod
    f.activo = data.activo
    session.add(f)
    session.commit()
    return _dict(f)


@router.delete("/{item_id}", status_code=204)
def borrar(item_id: int, session: Session = Depends(get_session), _=_guard):
    f = session.get(Formulario, item_id)
    if not f:
        raise HTTPException(404, "Formulario no encontrado")
    for uf in session.exec(select(UsuarioFormulario).where(UsuarioFormulario.formulario_id == item_id)).all():
        session.delete(uf)
    session.delete(f)
    session.commit()


# -------------------------------------------------------------- Matriz
@router.get("/matriz")
def matriz(session: Session = Depends(get_session), _=_guard):
    """Usuarios internos × formularios activos + autorizaciones actuales."""
    usuarios = session.exec(
        select(Usuario).where(Usuario.tipo == "Int", Usuario.usuario != None)  # noqa: E711
        .order_by(Usuario.nombre)).all()
    formularios = session.exec(
        select(Formulario).where(Formulario.activo == True).order_by(Formulario.nombre)).all()  # noqa: E712
    auth: dict[int, list[int]] = {}
    for uf in session.exec(select(UsuarioFormulario)).all():
        auth.setdefault(uf.usuario_id, []).append(uf.formulario_id)
    return {
        "usuarios": [{"id": u.id, "nombre": u.nombre, "usuario": u.usuario,
                      "es_super": u.rol == "superadmin"} for u in usuarios],
        "formularios": [{"id": f.id, "nombre": f.nombre, "codigo_calendario": f.codigo_calendario} for f in formularios],
        "autorizados": auth,
    }


@router.get("/autorizados/{usuario_id}")
def get_autorizados(usuario_id: int, session: Session = Depends(get_session), _=_guard):
    """Formularios que el usuario puede presentar (para la ficha del responsable)."""
    ids = [uf.formulario_id for uf in session.exec(
        select(UsuarioFormulario).where(UsuarioFormulario.usuario_id == usuario_id)).all()]
    return {"formulario_ids": ids}


@router.put("/autorizados/{usuario_id}")
def set_autorizados(usuario_id: int, data: AutorizadosIn, session: Session = Depends(get_session), _=_guard):
    """Reemplaza el conjunto de formularios que el usuario puede presentar."""
    if not session.get(Usuario, usuario_id):
        raise HTTPException(404, "Usuario no encontrado")
    quiere = set(data.formulario_ids)
    actuales = session.exec(select(UsuarioFormulario).where(UsuarioFormulario.usuario_id == usuario_id)).all()
    tiene = {uf.formulario_id for uf in actuales}
    for uf in actuales:
        if uf.formulario_id not in quiere:
            session.delete(uf)
    for fid in quiere - tiene:
        session.add(UsuarioFormulario(usuario_id=usuario_id, formulario_id=fid))
    session.commit()
    return {"usuario_id": usuario_id, "formulario_ids": sorted(quiere)}


# -------------------------------------------------- Consulta para las apps
@router.get("/puede-presentar")
def puede_presentar(usuario: str, codigo: str, session: Session = Depends(get_session),
                    _u: Usuario = Depends(get_current_user)):
    """¿El usuario (login) puede presentar borradores del formulario (código de
    calendario)? Super siempre puede. Lo consultan las apps (350, etc.)."""
    u = session.exec(select(Usuario).where(Usuario.usuario == usuario)).first()
    if not u:
        return {"puede": False, "motivo": "usuario no encontrado"}
    if u.rol == "superadmin":
        return {"puede": True, "motivo": "superusuario"}
    f = session.exec(select(Formulario).where(Formulario.codigo_calendario == codigo)).first()
    if not f:
        return {"puede": False, "motivo": "formulario no encontrado"}
    autorizado = session.exec(select(UsuarioFormulario).where(
        UsuarioFormulario.usuario_id == u.id, UsuarioFormulario.formulario_id == f.id)).first()
    return {"puede": bool(autorizado), "motivo": "autorizado" if autorizado else "no autorizado"}
