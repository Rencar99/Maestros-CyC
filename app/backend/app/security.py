"""Seguridad del aplicativo Maestros (idéntico patrón a Documentos DIAN).

- **Clave de portal DIAN de los clientes:** cifrada con Fernet (reversible;
  la usan las apps que hacen login en la DIAN). Misma ``FERNET_KEY`` de la firma.
- **Contraseñas de los usuarios internos:** hash Argon2 (NO reversible).
- **Sesiones:** tokens JWT firmados con ``config.SESSION_SECRET``.
"""
from __future__ import annotations

import os
import stat
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from cryptography.fernet import Fernet
from passlib.context import CryptContext

from .config import FERNET_KEY, SECRET_KEY_PATH, SESSION_HOURS, SESSION_SECRET


def _load_or_create_key() -> bytes:
    """Prioridad: FERNET_KEY del .env (llave única de la firma, obligatoria con
    base compartida) → archivo local → generar una nueva (modo autónomo/dev)."""
    if FERNET_KEY:
        return FERNET_KEY.encode("utf-8")
    if SECRET_KEY_PATH.exists():
        return SECRET_KEY_PATH.read_bytes()
    key = Fernet.generate_key()
    SECRET_KEY_PATH.write_bytes(key)
    try:
        os.chmod(SECRET_KEY_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return key


_fernet = Fernet(_load_or_create_key())


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode("utf-8")).decode("utf-8")


# --- Contraseñas de usuarios internos (hash Argon2) ---
_pwd = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(plaintext: str) -> str:
    return _pwd.hash(plaintext)


def verify_password(plaintext: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plaintext, hashed)
    except Exception:  # noqa: BLE001
        return False


# --- Sesiones (JWT) ---
def crear_token(usuario_id: int, rol: str, jti: str = "") -> str:
    payload = {
        "sub": str(usuario_id),
        "rol": rol,
        "jti": jti,
        "exp": datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS),
    }
    return jwt.encode(payload, SESSION_SECRET, algorithm="HS256")


def leer_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
    except Exception:  # noqa: BLE001
        return None
