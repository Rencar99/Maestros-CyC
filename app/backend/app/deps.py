"""Dependencias de FastAPI: usuario actual (JWT) y control de rol."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from .db import get_session
from .models import Permiso, Rol, RolPermiso, Usuario
from .security import leer_token


def permisos_de(session: Session, user: Usuario) -> set[str]:
    """Conjunto de claves de permiso del usuario. Super (por rol de sistema o por
    el `rol` de texto de compatibilidad) = todos los permisos del catálogo."""
    if user.rol == "superadmin":
        return set(session.exec(select(Permiso.clave)).all())
    if user.rol_id:
        rol = session.get(Rol, user.rol_id)
        if rol and rol.sistema:
            return set(session.exec(select(Permiso.clave)).all())
        return set(session.exec(
            select(RolPermiso.permiso_clave).where(RolPermiso.rol_id == user.rol_id)).all())
    return set()


def require_perm(clave: str):
    """Factory de dependencia: exige que el usuario tenga el permiso `clave`."""
    def _dep(user: Usuario = Depends(get_current_user),
             session: Session = Depends(get_session)) -> Usuario:
        if user.rol == "superadmin":
            return user
        if clave not in permisos_de(session, user):
            raise HTTPException(403, f"Requiere el permiso «{clave}»")
        return user
    return _dep


def get_current_user(authorization: str = Header(default=""),
                     session: Session = Depends(get_session)) -> Usuario:
    """Valida el token Bearer y devuelve el usuario interno autenticado."""
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    data = leer_token(token) if token else None
    if not data:
        raise HTTPException(401, "No autenticado")
    try:
        user = session.get(Usuario, int(data.get("sub", 0)))
    except (TypeError, ValueError):
        user = None
    if not user or not user.activo:
        raise HTTPException(401, "Sesión inválida")
    return user


def require_admin(user: Usuario = Depends(get_current_user)) -> Usuario:
    if user.rol not in ("admin", "superadmin"):
        raise HTTPException(403, "Requiere permisos de administrador")
    return user


def require_superadmin(user: Usuario = Depends(get_current_user)) -> Usuario:
    if user.rol != "superadmin":
        raise HTTPException(403, "Requiere permisos de Super Usuario")
    return user
