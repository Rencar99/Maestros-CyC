"""Configuración del aplicativo Maestros.

La configuración sensible (conexión a la base, secretos) se lee de un ``.env``
en la carpeta backend (excluido de git). Ver ``.env.example``.

Base de datos: la MISMA base compartida de las Apps de la firma (la del
Conciliador / Documentos DIAN), pero con ``search_path=maestros`` para que los
maestros compartidos vivan en su propio esquema. Si no hay conexión Postgres,
cae a SQLite local (útil en desarrollo).
"""
from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> backend/
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(BASE_DIR / ".env")

# Esquema propio de esta app dentro de la base compartida de la firma.
DB_SCHEMA = "maestros"


def _db_url() -> str:
    """Cadena de conexión por orden de prioridad.

    1. ``DATABASE_URL`` del .env (la que escribe el instalador).
    2. ``CARDONA_DATABASE_URL``: base compartida de la firma; se le agrega
       ``search_path=maestros`` para aislar el esquema.
    3. SQLite local (modo autónomo / desarrollo).
    """
    propia = os.getenv("DATABASE_URL", "").strip()
    if propia:
        return propia

    firma = os.getenv("CARDONA_DATABASE_URL", "").strip()
    if firma:
        from urllib.parse import quote
        url = re.sub(r"^postgresql(\+\w+)?://", "postgresql+psycopg://", firma)
        sep = "&" if "?" in url else "?"
        if "search_path" not in url:
            url += f"{sep}options={quote(f'-csearch_path={DB_SCHEMA}')}"
        return url

    return f"sqlite:///{DATA_DIR / 'maestros.db'}"


# --- Ubicación del servidor (IP + puerto), editable desde la App SIN admin ----
SERVIDOR_FILE = DATA_DIR / "servidor.json"


def _ubicacion_guardada() -> dict | None:
    try:
        d = json.loads(SERVIDOR_FILE.read_text(encoding="utf-8"))
        ip = str(d.get("ip", "")).strip()
        puerto = int(d.get("puerto", 0))
        if ip and puerto:
            return {"ip": ip, "puerto": puerto}
    except Exception:  # noqa: BLE001
        pass
    return None


def _sustituir_host(url: str, ip: str, puerto: int) -> str:
    """Cadena de conexión con host y puerto reemplazados.
    OJO: render_as_string(hide_password=False); str(URL) enmascara la clave."""
    from sqlalchemy.engine import make_url
    return make_url(url).set(host=ip.strip(), port=int(puerto)).render_as_string(
        hide_password=False)


def db_url_efectivo() -> str:
    base = _db_url()
    loc = _ubicacion_guardada()
    if not loc or not base.startswith("postgresql"):
        return base
    try:
        return _sustituir_host(base, loc["ip"], loc["puerto"])
    except Exception:  # noqa: BLE001
        return base


def url_para(ip: str, puerto: int) -> str:
    return _sustituir_host(_db_url(), ip, puerto)


def servidor_info() -> dict:
    url = db_url_efectivo()
    es_pg = url.startswith("postgresql")
    host, puerto = "", 0
    if es_pg:
        try:
            from sqlalchemy.engine import make_url
            u = make_url(url)
            host, puerto = (u.host or ""), (u.port or 5432)
        except Exception:  # noqa: BLE001
            pass
    return {"host": host, "puerto": puerto, "es_postgres": es_pg,
            "personalizado": _ubicacion_guardada() is not None}


def guardar_ubicacion(ip: str, puerto: int) -> None:
    SERVIDOR_FILE.write_text(
        json.dumps({"ip": ip.strip(), "puerto": int(puerto)}), encoding="utf-8")


DB_URL = db_url_efectivo()

# Llave Fernet ÚNICA de la firma (misma que Documentos DIAN, para poder
# descifrar/compartir las claves de portal). Se entrega por .env (FERNET_KEY).
SECRET_KEY_PATH = DATA_DIR / "secret.key"
FERNET_KEY = os.getenv("FERNET_KEY", "").strip()

# Raíz permitida para el explorador de carpetas/archivos del servidor (se usa
# para elegir la "Ruta de trabajo del cliente" y la propuesta). La navegación
# se limita a esta carpeta hacia abajo, por seguridad. Configurable por .env.
EXPLORADOR_RAIZ = os.getenv(
    "EXPLORADOR_RAIZ",
    r"C:\Users\COMPUMAX\OneDrive - Cardona & Castillo Consultores S.A.S").strip()


def _session_secret() -> str:
    env = os.getenv("SESSION_SECRET")
    if env:
        return env
    p = DATA_DIR / "session.secret"
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    s = secrets.token_urlsafe(48)
    p.write_text(s, encoding="utf-8")
    return s


SESSION_SECRET = _session_secret()
SESSION_HOURS = 12


def _version() -> str:
    p = Path(__file__).resolve().parent / "VERSION"
    try:
        return p.read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


VERSION = _version()

# Raíz de ESTA instalación (…\MaestrosCyC): backend/ -> su carpeta madre.
INSTALL_ROOT = BASE_DIR.parent

# --- Auto-actualización: instalador compartido de la firma -------------------
# El equipo compara su VERSION con la del instalador compartido y ofrece
# actualizarse (estilo Windows Update). La ubicación del instalador puede variar
# entre equipos (share UNC en la LAN, letra de Google Drive, copia local), así
# que se prueban VARIOS candidatos y gana el que exista con la versión más alta.
# Un .env con INSTALADOR_DIR fuerza una única ubicación (override explícito).
_INSTALADOR_CANDIDATOS = [
    r"\\192.168.8.22\Instaladores\Maestros",   # share canónico en la LAN
    r"G:\Mi unidad\Instaladores\Maestros",       # Google Drive de la firma
    r"C:\Instaladores\Maestros",                  # copia local (equipo servidor)
]


def _vtuple(s: str) -> tuple:
    """'1.22.4' -> (1, 22, 4) para comparar numéricamente (no como texto)."""
    nums = re.findall(r"\d+", s or "")
    return tuple(int(n) for n in nums) if nums else (0,)


def _version_en(dir_: str) -> str:
    try:
        return (Path(dir_) / "app" / "backend" / "app" / "VERSION").read_text(
            encoding="utf-8").strip()
    except OSError:
        return ""


def _candidatos_instalador() -> list[str]:
    forzado = os.path.expandvars(os.getenv("INSTALADOR_DIR", "")).strip()
    return [forzado] if forzado else _INSTALADOR_CANDIDATOS


def resolver_instalador() -> tuple[str, str]:
    """(carpeta, versión) del mejor instalador alcanzable (mayor versión), o ('','')."""
    mejor_dir, mejor_ver = "", ""
    for d in _candidatos_instalador():
        if not d:
            continue
        v = _version_en(d)
        if v and (not mejor_ver or _vtuple(v) > _vtuple(mejor_ver)):
            mejor_dir, mejor_ver = d, v
    return mejor_dir, mejor_ver


def version_instalador() -> str:
    """VERSION disponible en el instalador compartido, o '' si no se encuentra."""
    return resolver_instalador()[1]


def hay_actualizacion() -> tuple[bool, str]:
    """(¿el instalador trae una versión más nueva que la instalada?, esa versión)."""
    disp = version_instalador()
    if not disp:
        return (False, "")
    return (_vtuple(disp) > _vtuple(VERSION), disp)


# Orígenes permitidos para el frontend en desarrollo (Vite).
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# --- Cartera / CxC: conexión de SOLO LECTURA a GLERP (SQL Server del proveedor) --
# Se lee del .env (secreto, fuera de git). La clave idealmente debe ser de un
# usuario de SOLO LECTURA sobre la base de GLERP. El driver por defecto es el
# "SQL Server" que trae Windows (no requiere instalar nada). Ejemplo .env:
#   GLERP_SERVER=bd07.vit.com.co,46608
#   GLERP_DATABASE=GL_CardonayCastillo
#   GLERP_UID=usuario_lectura
#   GLERP_PWD=********
#   GLERP_DRIVER=SQL Server
GLERP_SERVER = os.getenv("GLERP_SERVER", "").strip()
GLERP_DATABASE = os.getenv("GLERP_DATABASE", "").strip()
GLERP_UID = os.getenv("GLERP_UID", "").strip()
GLERP_PWD = os.getenv("GLERP_PWD", "").strip()
GLERP_DRIVER = os.getenv("GLERP_DRIVER", "SQL Server").strip()


def glerp_configurado() -> bool:
    """¿Hay conexión a GLERP definida en el .env?"""
    return bool(GLERP_SERVER and GLERP_DATABASE and GLERP_UID and GLERP_PWD)


def glerp_conn_str() -> str:
    """Cadena de conexión pyodbc para GLERP, o "" si falta configuración."""
    if not glerp_configurado():
        return ""
    return (f"DRIVER={{{GLERP_DRIVER}}};SERVER={GLERP_SERVER};"
            f"DATABASE={GLERP_DATABASE};UID={GLERP_UID};PWD={GLERP_PWD}")
