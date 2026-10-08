"""Configuración del servidor de datos (IP + puerto) desde la App.

Rutas PÚBLICAS a propósito: deben funcionar ANTES del login, porque si el
servidor cambió de IP nadie puede autenticarse (la autenticación necesita la
base). Solo permiten ver y cambiar la UBICACIÓN del servidor (IP y puerto);
nunca exponen ni piden las credenciales (usuario/clave/BD), que viven en el
.env de cada equipo. Es una herramienta de red interna (LAN).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config
from ..db import probar_conexion, reconstruir_engine

router = APIRouter(prefix="/api/servidor", tags=["servidor"])

# IPv4 o nombre de host (letras, dígitos, punto, guion).
_RE_HOST = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9.\-]*[A-Za-z0-9])?$")


class Ubicacion(BaseModel):
    ip: str
    puerto: int = 5432


def _validar(u: Ubicacion) -> None:
    if not _RE_HOST.match(u.ip.strip()):
        raise HTTPException(400, "La dirección del servidor no es válida (IP o nombre de host).")
    if not (1 <= u.puerto <= 65535):
        raise HTTPException(400, "El puerto debe estar entre 1 y 65535.")


@router.get("")
def info() -> dict:
    """Host y puerto actuales + si la base responde en este momento."""
    inf = config.servidor_info()
    ok, _ = probar_conexion()
    inf["conectado"] = ok
    return inf


@router.post("/probar")
def probar(u: Ubicacion) -> dict:
    """Prueba una conexión a un servidor candidato SIN guardarlo."""
    _validar(u)
    ok, msg = probar_conexion(config.url_para(u.ip, u.puerto))
    return {"ok": ok, "mensaje": "Conexión exitosa." if ok else msg}


@router.post("")
def cambiar(u: Ubicacion) -> dict:
    """Prueba, guarda la nueva ubicación y reconecta en vivo."""
    _validar(u)
    ok, msg = probar_conexion(config.url_para(u.ip, u.puerto))
    if not ok:
        raise HTTPException(400, f"No se pudo conectar a {u.ip}:{u.puerto} · {msg}")
    config.guardar_ubicacion(u.ip, u.puerto)
    reconstruir_engine()
    # Reintentar la inicialización (crear tablas / admin) contra el nuevo servidor.
    try:
        from ..db import init_db
        from ..seed import bootstrap_admin
        init_db()
        bootstrap_admin()
    except Exception:  # noqa: BLE001
        pass
    inf = config.servidor_info()
    inf["conectado"] = True
    return inf
