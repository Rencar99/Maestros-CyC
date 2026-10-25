"""Administración de roles y permisos (RBAC). Todo protegido por ``config.roles``
(el Super Usuario lo tiene siempre). Ver memoria rbac-roles-permisos."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, SQLModel, select

from ..db import get_session
from ..deps import require_admin, require_perm
from ..models import Permiso, Rol, RolPermiso, Usuario

router = APIRouter(prefix="/api/roles", tags=["roles"])

_guard = Depends(require_perm("config.roles"))


class RolIn(SQLModel):
    nombre: str = ""
    activo: bool = True


class PermisosIn(SQLModel):
    claves: list[str] = []


def _rol_dict(session: Session, r: Rol, n_perm: int | None = None, n_usr: int | None = None) -> dict:
    # En lote (listar) los conteos llegan precalculados; de a uno se cuentan aquí.
    n = n_perm if n_perm is not None else session.exec(
        select(func.count()).select_from(RolPermiso).where(RolPermiso.rol_id == r.id)).one()
    usuarios = n_usr if n_usr is not None else session.exec(
        select(func.count()).select_from(Usuario).where(Usuario.rol_id == r.id)).one()
    return {"id": r.id, "nombre": r.nombre, "sistema": r.sistema, "activo": r.activo,
            "n_permisos": n, "n_usuarios": usuarios}


@router.get("")
def listar(session: Session = Depends(get_session), _=Depends(require_admin)):
    # Lista de roles (para la matriz y para asignar rol a un usuario). La edición
    # de la matriz (POST/PUT/DELETE, permisos) sí exige config.roles.
    roles = session.exec(select(Rol).order_by(Rol.orden, Rol.nombre)).all()
    # Conteos agregados en la BD (no 2 queries por rol).
    n_perm = dict(session.exec(select(RolPermiso.rol_id, func.count()).group_by(RolPermiso.rol_id)).all())
    n_usr = dict(session.exec(select(Usuario.rol_id, func.count()).group_by(Usuario.rol_id)).all())
    return [_rol_dict(session, r, n_perm.get(r.id, 0), n_usr.get(r.id, 0)) for r in roles]


@router.get("/permisos")
def catalogo_permisos(session: Session = Depends(get_session), _=_guard):
    ps = session.exec(select(Permiso).order_by(Permiso.orden)).all()
    return [{"clave": p.clave, "seccion": p.seccion, "accion": p.accion,
             "etiqueta": p.etiqueta} for p in ps]


@router.get("/{rid}/permisos")
def permisos_de_rol(rid: int, session: Session = Depends(get_session), _=_guard):
    rol = session.get(Rol, rid)
    if not rol:
        raise HTTPException(404, "Rol no encontrado")
    if rol.sistema:   # Super: tiene todos
        return [p.clave for p in session.exec(select(Permiso)).all()]
    return session.exec(select(RolPermiso.permiso_clave).where(RolPermiso.rol_id == rid)).all()


@router.put("/{rid}/permisos")
def set_permisos(rid: int, data: PermisosIn, session: Session = Depends(get_session), _=_guard):
    rol = session.get(Rol, rid)
    if not rol:
        raise HTTPException(404, "Rol no encontrado")
    if rol.sistema:
        raise HTTPException(400, "El rol de sistema tiene todos los permisos (no se edita)")
    validas = {p.clave for p in session.exec(select(Permiso)).all()}
    nuevas = {c for c in data.claves if c in validas}
    for rp in session.exec(select(RolPermiso).where(RolPermiso.rol_id == rid)).all():
        session.delete(rp)
    for c in nuevas:
        session.add(RolPermiso(rol_id=rid, permiso_clave=c))
    session.commit()
    return {"ok": True, "n": len(nuevas)}


@router.post("", status_code=201)
def crear(data: RolIn, session: Session = Depends(get_session), _=_guard):
    nombre = (data.nombre or "").strip()
    if not nombre:
        raise HTTPException(422, "El nombre es obligatorio")
    if session.exec(select(Rol).where(Rol.nombre == nombre)).first():
        raise HTTPException(409, "Ya existe un rol con ese nombre")
    orden = (session.exec(select(func.max(Rol.orden)).select_from(Rol)).one() or 0) + 1
    r = Rol(nombre=nombre, sistema=False, orden=orden, activo=data.activo)
    session.add(r); session.commit(); session.refresh(r)
    return _rol_dict(session, r)


@router.put("/{rid}")
def actualizar(rid: int, data: RolIn, session: Session = Depends(get_session), _=_guard):
    rol = session.get(Rol, rid)
    if not rol:
        raise HTTPException(404, "Rol no encontrado")
    nombre = (data.nombre or "").strip()
    if nombre and nombre != rol.nombre:
        if session.exec(select(Rol).where(Rol.nombre == nombre)).first():
            raise HTTPException(409, "Ya existe un rol con ese nombre")
        rol.nombre = nombre
    rol.activo = data.activo
    session.add(rol); session.commit(); session.refresh(rol)
    return _rol_dict(session, rol)


@router.delete("/{rid}", status_code=204)
def borrar(rid: int, session: Session = Depends(get_session), _=_guard):
    rol = session.get(Rol, rid)
    if not rol:
        raise HTTPException(404, "Rol no encontrado")
    if rol.sistema:
        raise HTTPException(400, "No se puede eliminar un rol de sistema")
    if session.exec(select(Usuario).where(Usuario.rol_id == rid)).first():
        raise HTTPException(409, "Hay usuarios con este rol; reasígnalos primero")
    for rp in session.exec(select(RolPermiso).where(RolPermiso.rol_id == rid)).all():
        session.delete(rp)
    session.delete(rol)
    session.commit()
