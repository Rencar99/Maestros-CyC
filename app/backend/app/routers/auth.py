"""Autenticación: login, logout, cambio de contraseña y perfil actual."""
from __future__ import annotations

import secrets
import socket
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..deps import get_current_user, permisos_de
from ..models import Sesion, Usuario
from ..schemas import CambiarPasswordIn, LoginIn, LoginOut, ResponsableRead
from ..security import crear_token, hash_password, leer_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Una sesión sin actividad por más de este tiempo se considera colgada: no bloquea
# un nuevo ingreso (se cierra sola). El frontend manda un "latido" para mantenerla
# fresca mientras la App esté abierta.
SESION_INACTIVA_MIN = 5


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

    # Sesión única: si el usuario ya tiene una sesión activa y FRESCA en OTRO
    # equipo, se bloquea el ingreso. Las colgadas (sin actividad) o las del mismo
    # equipo se cierran solas para no dejar a nadie trancado (p. ej. ventana
    # cerrada sin usar «Salir»).
    ahora = datetime.utcnow()
    limite = ahora - timedelta(minutes=SESION_INACTIVA_MIN)
    mi_equipo = socket.gethostname()
    activas = session.exec(
        select(Sesion).where(Sesion.usuario_id == u.id, Sesion.activa == True)  # noqa: E712
    ).all()
    for s in activas:
        fresca = bool(s.ultima_actividad and s.ultima_actividad > limite)
        if fresca and s.equipo != mi_equipo:
            cuando = s.ultima_actividad.replace(tzinfo=timezone.utc).astimezone().strftime("%d/%m %H:%M")
            raise HTTPException(
                409,
                f"«{u.nombre}» ya tiene una sesión activa en el equipo «{s.equipo}» "
                f"(actividad {cuando}). Ciérrala allí, o pide a un administrador que la "
                f"cierre desde Configuración → Sesiones.")
        s.activa = False
        session.add(s)

    jti = secrets.token_hex(16)
    session.add(Sesion(usuario_id=u.id, jti=jti, equipo=mi_equipo,
                       activa=True, creado_at=ahora, ultima_actividad=ahora))
    session.commit()

    token = crear_token(u.id, u.rol, jti)
    return LoginOut(token=token, nombre=u.nombre, usuario=u.usuario or "",
                    rol=u.rol, debe_cambiar=u.debe_cambiar)


@router.post("/logout")
def logout(authorization: Optional[str] = Header(default=None),
           cuerpo: Optional[dict] = Body(default=None),
           session: Session = Depends(get_session)):
    """Cierra la sesión actual (marca inactivo el jti). Público. El token puede
    venir en la cabecera o en el cuerpo `{token}` (para el beacon de cierre de
    ventana, que no puede poner cabeceras)."""
    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif cuerpo and isinstance(cuerpo, dict) and cuerpo.get("token"):
        token = str(cuerpo["token"])
    if token:
        data = leer_token(token)
        jti = data.get("jti") if data else None
        if jti:
            ses = session.exec(select(Sesion).where(Sesion.jti == jti)).first()
            if ses and ses.activa:
                ses.activa = False
                session.add(ses)
                session.commit()
    return {"ok": True}


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
