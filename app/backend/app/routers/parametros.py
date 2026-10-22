"""Parámetros de configuración de la firma (clave-valor). Hoy: los datos de pago
que salen en las cuentas de cobro. Lectura = cualquier usuario autenticado;
edición = solo Super (``config.roles``)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from ..cuenta_cobro import _NOTA_383 as _NOTA_383_DEF
from ..db import get_session
from ..deps import get_current_user, require_perm
from ..models import Parametro
from ..security import decrypt, encrypt

router = APIRouter(prefix="/api/config", tags=["config"])

# Valores por defecto (los del formato actual); se usan si el parámetro no está guardado.
_COBRO_DEF = {
    "cobro_banco": "Bancolombia",
    "cobro_tipo_cuenta": "Ahorros",
    "cobro_numero_cuenta": "78400013127",
    "cobro_titular": "Cardona & Cardona Consultores S.A.S",
    "cobro_carpeta": "",     # carpeta base donde se guardan los PDF de las cuentas de cobro
    "cobro_nota_383": _NOTA_383_DEF,   # texto de la nota del art. 383 ET (el emisor decide si se incluye)
}


def _get(session: Session, clave: str, default: str = "") -> str:
    p = session.get(Parametro, clave)
    return p.valor if p else default


def _set(session: Session, clave: str, valor: str) -> None:
    p = session.get(Parametro, clave)
    if p:
        p.valor = valor
    else:
        p = Parametro(clave=clave, valor=valor)
    session.add(p)


class CobroIn(BaseModel):
    banco: str = ""
    tipo_cuenta: str = ""
    numero_cuenta: str = ""
    titular: str = ""
    carpeta: str = ""
    nota_383: str = ""


def _cobro(session: Session) -> dict:
    return {
        "banco": _get(session, "cobro_banco", _COBRO_DEF["cobro_banco"]),
        "tipo_cuenta": _get(session, "cobro_tipo_cuenta", _COBRO_DEF["cobro_tipo_cuenta"]),
        "numero_cuenta": _get(session, "cobro_numero_cuenta", _COBRO_DEF["cobro_numero_cuenta"]),
        "titular": _get(session, "cobro_titular", _COBRO_DEF["cobro_titular"]),
        "carpeta": _get(session, "cobro_carpeta", _COBRO_DEF["cobro_carpeta"]),
        "nota_383": _get(session, "cobro_nota_383", _COBRO_DEF["cobro_nota_383"]),
    }


@router.get("/cobro")
def obtener_cobro(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    """Datos de pago que salen en la cuenta de cobro (banco, tipo y N° de cuenta, titular)."""
    return _cobro(session)


@router.put("/cobro")
def guardar_cobro(data: CobroIn, session: Session = Depends(get_session),
                  _=Depends(require_perm("config.roles"))):
    _set(session, "cobro_banco", data.banco.strip())
    _set(session, "cobro_tipo_cuenta", data.tipo_cuenta.strip())
    _set(session, "cobro_numero_cuenta", data.numero_cuenta.strip())
    _set(session, "cobro_titular", data.titular.strip())
    _set(session, "cobro_carpeta", data.carpeta.strip())
    _set(session, "cobro_nota_383", data.nota_383.strip() or _COBRO_DEF["cobro_nota_383"])
    session.commit()
    return _cobro(session)


# ===================================================== Correo de envío (Microsoft 365 / Graph)
_CORREO_ASUNTO_DEF = "Cuenta de cobro {numero} - Cardona & Cardona Consultores"
_CORREO_CUERPO_DEF = ("Apreciado cliente,\n\nAdjunto encontrará la cuenta de cobro "
                      "{numero} correspondiente a {mes} de {anio}.\n\n"
                      "Cordialmente,\nCardona & Cardona Consultores S.A.S")


class CorreoIn(BaseModel):
    remitente: str = ""        # buzón desde el que se envía (ej. facturacion@cardonaycardona.com)
    tenant: str = ""           # Directory (tenant) ID de Azure
    client_id: str = ""        # Application (client) ID
    client_secret: str = ""    # se guarda cifrado; vacío = conservar el actual
    asunto: str = ""
    cuerpo: str = ""


def _correo(session: Session) -> dict:
    """Config del correo de envío. Incluye el secreto DESCIFRADO (uso interno)."""
    sec_enc = _get(session, "correo_client_secret_enc", "")
    secret = ""
    if sec_enc:
        try:
            secret = decrypt(sec_enc)
        except Exception:  # noqa: BLE001
            secret = ""
    return {
        "remitente": _get(session, "correo_remitente", ""),
        "tenant": _get(session, "correo_tenant", ""),
        "client_id": _get(session, "correo_client_id", ""),
        "client_secret": secret,
        "asunto": _get(session, "correo_asunto", _CORREO_ASUNTO_DEF),
        "cuerpo": _get(session, "correo_cuerpo", _CORREO_CUERPO_DEF),
    }


def _correo_configurado(session: Session) -> bool:
    c = _correo(session)
    return bool(c["remitente"] and c["tenant"] and c["client_id"] and c["client_secret"])


@router.get("/correo")
def obtener_correo(session: Session = Depends(get_session), _=Depends(require_perm("config.roles"))):
    """Config del correo de envío. NUNCA devuelve el secreto en claro: solo si está puesto."""
    c = _correo(session)
    return {
        "remitente": c["remitente"], "tenant": c["tenant"], "client_id": c["client_id"],
        "asunto": c["asunto"], "cuerpo": c["cuerpo"],
        "tiene_secret": bool(c["client_secret"]), "configurado": _correo_configurado(session),
    }


@router.put("/correo")
def guardar_correo(data: CorreoIn, session: Session = Depends(get_session),
                   _=Depends(require_perm("config.roles"))):
    _set(session, "correo_remitente", data.remitente.strip())
    _set(session, "correo_tenant", data.tenant.strip())
    _set(session, "correo_client_id", data.client_id.strip())
    _set(session, "correo_asunto", data.asunto.strip() or _CORREO_ASUNTO_DEF)
    _set(session, "correo_cuerpo", data.cuerpo.strip() or _CORREO_CUERPO_DEF)
    if data.client_secret.strip():   # vacío = conservar el secreto actual
        _set(session, "correo_client_secret_enc", encrypt(data.client_secret.strip()))
    session.commit()
    return obtener_correo(session)
