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
from ..graph_delegado import cuenta_de, iniciar_device_code, poll_token
from ..models import Parametro, Usuario
from ..security import encrypt

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


# ===================================================== Plantilla del correo (asunto + cuerpo)
# Cada responsable envía las CC desde SU propio correo (ver "Mi correo" / Graph delegado);
# aquí solo vive la PLANTILLA (asunto y cuerpo) con que se arma el correo.
_CORREO_ASUNTO_DEF = "Cuenta de cobro {numero} - Cardona & Cardona Consultores"
_CORREO_CUERPO_DEF = ("Apreciado cliente,\n\nAdjunto encontrará la cuenta de cobro "
                      "{numero} correspondiente a {mes} de {anio}.\n\n"
                      "Cordialmente,\nCardona & Cardona Consultores S.A.S")


class CorreoIn(BaseModel):
    asunto: str = ""
    cuerpo: str = ""


def _correo(session: Session) -> dict:
    """Plantilla del correo con que se envían las cuentas de cobro."""
    return {
        "asunto": _get(session, "correo_asunto", _CORREO_ASUNTO_DEF),
        "cuerpo": _get(session, "correo_cuerpo", _CORREO_CUERPO_DEF),
    }


@router.get("/correo")
def obtener_correo(session: Session = Depends(get_session), _=Depends(require_perm("config.roles"))):
    return _correo(session)


@router.put("/correo")
def guardar_correo(data: CorreoIn, session: Session = Depends(get_session),
                   _=Depends(require_perm("config.roles"))):
    _set(session, "correo_asunto", data.asunto.strip() or _CORREO_ASUNTO_DEF)
    _set(session, "correo_cuerpo", data.cuerpo.strip() or _CORREO_CUERPO_DEF)
    session.commit()
    return _correo(session)


# ===================================================== Mi correo (Graph delegado, por usuario)
# Cada responsable conecta SU cuenta de Microsoft 365 una vez (código de dispositivo)
# y la app envía a su nombre. No requiere registrar app en Azure.
class DeviceIn(BaseModel):
    device_code: str


@router.get("/mi-correo")
def mi_correo(session: Session = Depends(get_session), u: Usuario = Depends(get_current_user)):
    """Estado de la conexión de correo del usuario actual."""
    usr = session.get(Usuario, u.id)
    return {"conectado": bool(usr and usr.correo_token_enc), "cuenta": (usr.correo_cuenta if usr else "")}


@router.post("/mi-correo/iniciar")
def mi_correo_iniciar(_u: Usuario = Depends(get_current_user)):
    """Arranca el inicio de sesión por código de dispositivo. Devuelve el código
    y la URL donde el usuario debe escribirlo (microsoft.com/devicelogin)."""
    try:
        j = iniciar_device_code()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, str(e))
    return {"user_code": j.get("user_code"), "verification_uri": j.get("verification_uri"),
            "device_code": j.get("device_code"), "interval": j.get("interval", 5),
            "expires_in": j.get("expires_in", 900), "message": j.get("message", "")}


@router.post("/mi-correo/completar")
def mi_correo_completar(data: DeviceIn, session: Session = Depends(get_session),
                        u: Usuario = Depends(get_current_user)):
    """Un intento de completar el inicio de sesión. El front lo llama cada pocos
    segundos hasta que el usuario termina de autenticarse en el navegador."""
    estado, res = poll_token(data.device_code)
    if estado == "pendiente":
        return {"estado": "pendiente"}
    if estado == "error":
        return {"estado": "error", "mensaje": res.get("msg", "No se completó el inicio de sesión.")}
    refresh = res.get("refresh_token")
    if not refresh:
        return {"estado": "error", "mensaje": "Microsoft no devolvió el token de sesión; reintenta."}
    cuenta = cuenta_de(res.get("access_token", ""))
    usr = session.get(Usuario, u.id)
    usr.correo_token_enc = encrypt(refresh)
    usr.correo_cuenta = cuenta
    session.add(usr)
    session.commit()
    return {"estado": "ok", "cuenta": cuenta}


@router.post("/mi-correo/desconectar")
def mi_correo_desconectar(session: Session = Depends(get_session),
                          u: Usuario = Depends(get_current_user)):
    usr = session.get(Usuario, u.id)
    usr.correo_token_enc = ""
    usr.correo_cuenta = ""
    session.add(usr)
    session.commit()
    return {"ok": True}
