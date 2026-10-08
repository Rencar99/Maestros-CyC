"""Autenticación: login, cambio de contraseña y perfil actual."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user, permisos_de
from ..models import Usuario
from ..schemas import CambiarPasswordIn, LoginIn, LoginOut, ResponsableRead
from ..security import crear_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/usuarios")
def usuarios_para_login(session: Session = Depends(get_session)):
    """Lista pública (mínima) de responsables internos activos para el desplegable
    del login. Solo expone nombre y usuario (login); evita errores de tipeo."""
    us = session.exec(
        select(Usuario).where(Usuario.activo == True, Usuario.tipo == "Int")  # noqa: E712
    ).all()
    us = [u for u in us if u.usuario]
    us.sort(key=lambda u: u.nombre.lower())
    return [{"usuario": u.usuario, "nombre": u.nombre} for u in us]


@router.post("/login", response_model=LoginOut)
def login(data: LoginIn, session: Session = Depends(get_session)):
    u = session.exec(select(Usuario).where(Usuario.usuario == data.usuario)).first()
    if not u or not u.activo or not verify_password(data.password, u.password_hash):
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    token = crear_token(u.id, u.rol)
    return LoginOut(token=token, nombre=u.nombre, usuario=u.usuario or "",
                    rol=u.rol, debe_cambiar=u.debe_cambiar)


@router.post("/cambiar-password")
def cambiar_password(data: CambiarPasswordIn,
                     session: Session = Depends(get_session),
                     user: Usuario = Depends(get_current_user)):
    if not verify_password(data.actual, user.password_hash):
        raise HTTPException(400, "La contraseña actual no coincide")
    if len(data.nueva or "") < 4:
        raise HTTPException(422, "La nueva contraseña es muy corta")
    user.password_hash = hash_password(data.nueva)
    user.debe_cambiar = False
    session.add(user)
    session.commit()
    return {"ok": True}


@router.get("/me")
def me(user: Usuario = Depends(get_current_user),
       session: Session = Depends(get_session)):
    data = ResponsableRead.model_validate(user, from_attributes=True).model_dump()
    data["permisos"] = sorted(permisos_de(session, user))
    return data
