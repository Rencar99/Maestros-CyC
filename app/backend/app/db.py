"""Motor de base de datos (Postgres o SQLite) y utilidades de sesión.

El ``engine`` es reconstruible en vivo: si el usuario cambia la IP/puerto del
servidor (data/servidor.json), ``reconstruir_engine()`` lo rehace sin reiniciar.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from . import config

DB_URL = config.DB_URL
_ES_SQLITE = DB_URL.startswith("sqlite")


def _crear_engine(url: str):
    es_sqlite = url.startswith("sqlite")
    # connect_timeout evita que la app se cuelgue al arrancar si la base no responde.
    connect_args = {"check_same_thread": False} if es_sqlite else {"connect_timeout": 8}
    return create_engine(url, echo=False, pool_pre_ping=not es_sqlite, connect_args=connect_args)


engine = _crear_engine(DB_URL)


def reconstruir_engine() -> None:
    """Reconstruye el motor desde la ubicación de servidor actual (tras un cambio)."""
    global engine, _ES_SQLITE, DB_URL
    nueva = config.db_url_efectivo()
    anterior = engine
    engine = _crear_engine(nueva)
    DB_URL = nueva
    _ES_SQLITE = nueva.startswith("sqlite")
    try:
        anterior.dispose()
    except Exception:  # noqa: BLE001
        pass


def probar_conexion(url: str | None = None) -> tuple[bool, str]:
    """Prueba una conexión real (SELECT 1). Con ``url=None`` usa el motor actual;
    con una url, crea un motor temporal para probar un servidor candidato."""
    temporal = None
    try:
        eng = engine if url is None else (temporal := _crear_engine(url))
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, (str(exc).splitlines() or [""])[0][:200]
    finally:
        if temporal is not None:
            try:
                temporal.dispose()
            except Exception:  # noqa: BLE001
                pass


def init_db() -> None:
    """Crea el esquema y las tablas si no existen.

    En Postgres, primero asegura el esquema ``maestros`` (search_path apunta
    ahí); en SQLite se ignora el esquema.
    """
    from . import models  # noqa: F401  (registro de tablas)

    if not _ES_SQLITE:
        from .config import DB_SCHEMA
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DB_SCHEMA}"'))

    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """Migración liviana e idempotente: agrega columnas nuevas a tablas ya
    existentes (``create_all`` solo crea tablas nuevas, no altera columnas).

    Cobros programados por período: ``clienteservicio.periodo`` (AAAA-MM) y
    ``facturacion_id`` (cabecera donde se facturó; NULL = pendiente). La primera
    vez que se crea ``periodo`` se siembra 2026-07 en las filas que eran
    mensuales, para no perder los cobros ya cargados.
    """
    if _ES_SQLITE:
        return
    from .config import DB_SCHEMA
    with engine.begin() as conn:
        ya = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=:s AND table_name='clienteservicio' "
            "AND column_name='periodo'"), {"s": DB_SCHEMA}).first()
        conn.execute(text(
            "ALTER TABLE clienteservicio "
            "ADD COLUMN IF NOT EXISTS periodo VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE clienteservicio "
            "ADD COLUMN IF NOT EXISTS facturacion_id INTEGER"))
        if not ya:   # primera migración: sembrar el período de arranque
            conn.execute(text(
                "UPDATE clienteservicio SET periodo='2026-07' "
                "WHERE periodicidad='Mes' AND (periodo IS NULL OR periodo='')"))
        # RBAC: rol de acceso del usuario (FK a rol; NULL = fallback por `rol`).
        conn.execute(text(
            "ALTER TABLE usuario ADD COLUMN IF NOT EXISTS rol_id INTEGER"))
        # Responsable del Registro (FK a usuario; cuenta para el alcance por asignación).
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS responsable_registro_id INTEGER"))
        # Cliente confidencial: solo visible con permiso "clientes.ver_confidencial" (y Super).
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS confidencial BOOLEAN NOT NULL DEFAULT FALSE"))
        # Emisor de la cuenta de cobro asignado al cliente (FK a emisor; NULL = sin asignar).
        conn.execute(text(
            "ALTER TABLE cliente ADD COLUMN IF NOT EXISTS emisor_id INTEGER"))
        # Consultas compartidas: descripción y alcance de filas por consulta guardada.
        conn.execute(text(
            "ALTER TABLE consultaguardada ADD COLUMN IF NOT EXISTS descripcion VARCHAR NOT NULL DEFAULT ''"))
        conn.execute(text(
            "ALTER TABLE consultaguardada "
            "ADD COLUMN IF NOT EXISTS alcance VARCHAR NOT NULL DEFAULT 'asignados'"))
        # Parámetros de generación de obligaciones (tabla compartida con Calendario).
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS modo_generacion VARCHAR NOT NULL DEFAULT 'auto_dian'"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS paso_dias_habiles INTEGER NOT NULL DEFAULT 1"))
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS tam_intervalo INTEGER NOT NULL DEFAULT 0"))
        # Familia: agrupación visual en el Calendario (columna compartida ya poblada;
        # IF NOT EXISTS es defensivo para instalaciones nuevas, no re-hace el backfill).
        conn.execute(text(
            "ALTER TABLE obligaciontipo ADD COLUMN IF NOT EXISTS familia VARCHAR NOT NULL DEFAULT 'otras'"))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
