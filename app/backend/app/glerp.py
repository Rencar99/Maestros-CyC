"""Lectura de SOLO LECTURA de la cartera (CxC) desde GLERP (SQL Server del
proveedor VIT), vía ODBC (pyodbc + driver "SQL Server" de Windows).

El módulo NUNCA escribe en GLERP: solo ejecuta el SELECT de cartera abierta
(``acccccxc`` con ``saldo<>0`` y no anulada), calcado del libro de cartera de
la firma. La conexión se arma desde el ``.env`` (ver ``config.glerp_conn_str``);
si falta pyodbc o la configuración, se lanza un error claro.
"""
from __future__ import annotations

from datetime import date

from . import config

# Consulta de cartera abierta (misma del libro "V_fin CxC GLERP"): un documento
# por fila, con el tercero resuelto por el código de cliente. Se agrega vlrfac
# (valor original) y se descartan las anuladas.
_SQL_CARTERA = """
SELECT x.nrofac AS documento, x.tipodoc AS tipodoc,
       c.clinit AS nit, c.clinom AS nombre, x.codcli AS codcli,
       x.fecfac AS fecfac, x.venfac AS venfac, x.vlrfac AS vlrfac, x.saldo AS saldo
  FROM acccccxc x
  LEFT OUTER JOIN clientes c ON x.codcli = c.clicod
 WHERE x.saldo <> 0 AND ISNULL(x.anulada, 0) = 0
"""


def _conn():
    try:
        import pyodbc  # noqa: PLC0415
    except ImportError as e:  # noqa: BLE001
        raise RuntimeError(
            "Falta el conector pyodbc en el servidor (instálalo para leer GLERP).") from e
    cs = config.glerp_conn_str()
    if not cs:
        raise RuntimeError(
            "GLERP no está configurado (define GLERP_SERVER/DATABASE/UID/PWD en el .env).")
    return pyodbc.connect(cs, timeout=20)


def leer_cartera() -> list[dict]:
    """Devuelve la cartera abierta de GLERP como lista de dicts con claves:
    documento, tipodoc, nit, nombre, codcli, fecfac(date|None), venfac(int),
    vlrfac(float|None), saldo(float|None). Solo lectura."""
    cn = _conn()
    try:
        cur = cn.cursor()
        cur.execute(_SQL_CARTERA)
        cols = [d[0] for d in cur.description]
        filas: list[dict] = []
        for row in cur.fetchall():
            d = dict(zip(cols, row))
            filas.append({
                "documento": (str(d.get("documento") or "")).strip(),
                "tipodoc": (str(d.get("tipodoc") or "")).strip(),
                "nit": (str(d.get("nit") or "")).strip(),
                "nombre": (str(d.get("nombre") or "")).strip(),
                "codcli": (str(d.get("codcli") or "")).strip(),
                "fecfac": d.get("fecfac").date() if hasattr(d.get("fecfac"), "date") else d.get("fecfac"),
                "venfac": int(d.get("venfac") or 0),
                "vlrfac": float(d["vlrfac"]) if d.get("vlrfac") is not None else None,
                "saldo": float(d["saldo"]) if d.get("saldo") is not None else None,
            })
        return filas
    finally:
        try:
            cn.close()
        except Exception:  # noqa: BLE001
            pass


def probar() -> tuple[bool, str]:
    """Prueba la conexión a GLERP (SELECT 1). (ok, mensaje)."""
    try:
        cn = _conn()
        try:
            cn.cursor().execute("SELECT 1")
        finally:
            cn.close()
        return True, "ok"
    except Exception as e:  # noqa: BLE001
        return False, (str(e).splitlines() or [""])[0][:200]


def bucket_de(venc: date | None, hoy: date) -> tuple[int, str]:
    """(días_vencido, bucket) de un documento. días>0 = vencido. Sin vencimiento
    → se trata como corriente."""
    if venc is None:
        return 0, "corriente"
    dias = (hoy - venc).days
    if dias <= 0:
        return dias, "corriente"
    if dias <= 30:
        return dias, "1-30"
    if dias <= 60:
        return dias, "31-60"
    if dias <= 90:
        return dias, "61-90"
    return dias, "90+"
