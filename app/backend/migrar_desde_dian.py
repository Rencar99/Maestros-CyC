"""Migración de siembra: dian.contribuyente / dian.usuario  ->  maestros.cliente / maestros.usuario.

Reglas:
- **Preserva el `id`** (lo referencia DescargaLog.contribuyente_id en la app DIAN).
- **Copia `password_enc` tal cual** (token Fernet); NUNCA se descifra.
- **Idempotente**: upsert por `num_id` (clientes) y por `usuario` (responsables).
  Correr de nuevo actualiza los campos migrados sin duplicar ni cambiar ids.
- **DRY-RUN por defecto**: reporta qué haría y hace rollback. Usa ``--apply`` para escribir.

Fuente configurable por entorno (para pruebas):
  FUENTE_CLIENTE (default "dian.contribuyente"), FUENTE_USUARIO (default "dian.usuario").

Uso:
  python migrar_desde_dian.py            # simulacro (no escribe)
  python migrar_desde_dian.py --apply    # aplica (¡haz backup antes!)
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime

import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from sqlmodel import Session, select

from app.db import _ES_SQLITE, engine, init_db
from app.models import Cliente, Usuario
from app.util import calcular_dv

FUENTE_CLIENTE = os.getenv("FUENTE_CLIENTE", "dian.contribuyente")
FUENTE_USUARIO = os.getenv("FUENTE_USUARIO", "dian.usuario")

# Campos migrables de cliente (se refrescan en cada corrida; el id NUNCA cambia).
_CAMPOS_CLI = [
    "tipo_contribuyente", "tipo_documento", "nombre", "razon_social", "password_enc",
    "estado", "regimen", "email", "representante_tipo_documento", "representante_num_id",
    "rut_actualizado", "dv",
]
_CAMPOS_USR = ["tipo", "nombre", "password_hash", "rol", "activo", "debe_cambiar", "foto"]


def _as_dt(v):
    """Coacciona a datetime. Postgres ya entrega datetime; si viene texto, lo parsea."""
    if v is None or v == "":
        return None
    if isinstance(v, (datetime, date)):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except ValueError:
        return None


def _map_cliente(r) -> Cliente:
    tc = r["tipo_contribuyente"]
    nombre = (r["nombre"] or "").strip()
    c = Cliente(
        id=r["id"],
        tipo_contribuyente=tc,
        tipo_documento=r["tipo_documento"] or ("NT" if tc == "Jur" else "CC"),
        num_id=r["num_id"],
        nombre=nombre,
        razon_social=nombre if tc == "Jur" else "",
        # Nat: los componentes (apellido1/2, nombre1/2) NO se separan en la
        # migración (no es fiable); quedan vacíos y se completan luego (RUT/manual).
        password_enc=r["password_enc"] or "",
        estado=r["estado"] or "Act",
        regimen=r["regimen"] or "Ordinario",
        email=r["email"] or "",
        representante_tipo_documento=r["representante_tipo_documento"] or "",
        representante_num_id=r["representante_num_id"] or "",
        rut_actualizado=r["rut_actualizado"] or "",
        dv=calcular_dv(r["num_id"]),
    )
    dt = _as_dt(r["creado_at"])
    if dt:
        c.creado_at = dt
    return c


def _map_usuario(r) -> Usuario:
    u = Usuario(
        id=r["id"],
        tipo="Int",                      # los usuarios actuales son internos
        nombre=(r["nombre"] or "").strip(),
        usuario=r["usuario"] or None,
        password_hash=r["password_hash"] or "",
        rol=r["rol"] or "usuario",
        activo=bool(r["activo"]),
        debe_cambiar=bool(r["debe_cambiar"]),
        foto=r["foto"] or "",
    )
    dt = _as_dt(r["creado_at"])
    if dt:
        u.creado_at = dt
    return u


def _leer(conn, tabla: str):
    return conn.execute(text(f"SELECT * FROM {tabla}")).mappings().all()


def correr(apply: bool) -> dict:
    init_db()  # asegura esquema/ tablas maestros
    ins_c = upd_c = ins_u = upd_u = 0
    with Session(engine) as s:
        conn = s.connection()

        for r in _leer(conn, FUENTE_CLIENTE):
            nuevo = _map_cliente(r)
            ex = s.exec(select(Cliente).where(Cliente.num_id == nuevo.num_id)).first()
            if ex:
                for f in _CAMPOS_CLI:
                    setattr(ex, f, getattr(nuevo, f))
                upd_c += 1
            else:
                s.add(nuevo)   # id explícito preservado
                ins_c += 1

        for r in _leer(conn, FUENTE_USUARIO):
            nuevo = _map_usuario(r)
            ex = None
            if nuevo.usuario:
                ex = s.exec(select(Usuario).where(Usuario.usuario == nuevo.usuario)).first()
            if ex:
                for f in _CAMPOS_USR:
                    setattr(ex, f, getattr(nuevo, f))
                upd_u += 1
            else:
                s.add(nuevo)
                ins_u += 1

        if apply:
            s.commit()
        else:
            s.rollback()

    # Reajustar las secuencias identity al MAX(id) (solo Postgres, tras aplicar).
    if apply and not _ES_SQLITE:
        with engine.begin() as conn:
            for tabla in ("cliente", "usuario"):
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('maestros.{tabla}','id'), "
                    f"(SELECT COALESCE(MAX(id),1) FROM maestros.{tabla}))"))

    return {"clientes_ins": ins_c, "clientes_upd": upd_c,
            "usuarios_ins": ins_u, "usuarios_upd": upd_u}


def main() -> None:
    ap = argparse.ArgumentParser(description="Siembra Maestros desde la base DIAN.")
    ap.add_argument("--apply", action="store_true", help="Escribe en la base (por defecto es simulacro).")
    args = ap.parse_args()

    print(f"Fuente clientes : {FUENTE_CLIENTE}")
    print(f"Fuente usuarios : {FUENTE_USUARIO}")
    print(f"Modo            : {'APLICAR (escribe)' if args.apply else 'SIMULACRO (no escribe)'}\n")
    try:
        res = correr(args.apply)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}")
        raise SystemExit(1)

    print("Resultado:")
    print(f"  Clientes    -> nuevos: {res['clientes_ins']:>5}   actualizados: {res['clientes_upd']:>5}")
    print(f"  Responsables-> nuevos: {res['usuarios_ins']:>5}   actualizados: {res['usuarios_upd']:>5}")
    if not args.apply:
        print("\n(SIMULACRO: no se escribió nada. Repite con --apply para aplicar.)")
    else:
        print("\nAplicado. Recuerda: los componentes de nombre de las personas naturales")
        print("quedan vacíos (se completan al re-leer el RUT o manualmente).")


if __name__ == "__main__":
    main()
