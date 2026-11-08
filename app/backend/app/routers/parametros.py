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


# ===================================================== Carpeta de Facturas de Venta
# Raíz (portable) donde se archivan los PDF de las facturas; el visor de cartera
# resuelve <raíz>\<año>\Facturas de Venta\<N. Mes>\<CLIENTE> - FEV - CYC<n>.pdf.
_FACTURAS_ROOT_DEF = r"%OneDriveCommercial%\Asesorias Externas\C&C"


class FacturasRootIn(BaseModel):
    carpeta: str = ""


@router.get("/cartera-facturas")
def obtener_facturas_root(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    return {"carpeta": _get(session, "cartera_facturas_root", _FACTURAS_ROOT_DEF)}


@router.put("/cartera-facturas")
def guardar_facturas_root(data: FacturasRootIn, session: Session = Depends(get_session),
                          _=Depends(require_perm("config.roles"))):
    from .clientes import _ruta_portable
    v = data.carpeta.strip()
    _set(session, "cartera_facturas_root", (_ruta_portable(v) if v else "") or _FACTURAS_ROOT_DEF)
    session.commit()
    return {"carpeta": _get(session, "cartera_facturas_root", _FACTURAS_ROOT_DEF)}
    return _cobro(session)


# ===================================================== Plantilla del correo (asunto + cuerpo)
# Cada responsable envía las CC desde SU propio correo (ver "Mi correo" / Graph delegado);
# aquí solo vive la PLANTILLA (asunto y cuerpo) con que se arma el correo.
_CORREO_ASUNTO_DEF = "Cuenta de cobro {numero} - {emisor}"
_CORREO_CUERPO_DEF = ("Apreciado cliente,\n\nAdjunto encontrará la cuenta de cobro "
                      "{numero} correspondiente a {mes} de {anio}.\n\n"
                      "Cordialmente,\n{emisor}")


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


# =============================================== Texto base del correo de reasignación
# Plantilla (asunto + introducción + cierre) del aviso que se envía al Responsable de
# Impuestos tras una reasignación. La TABLA la arma la app; aquí solo el texto.
# Variables: {responsable} (quien recibe) · {periodo} (AAAA-MM) · {mes_nom} (noviembre) · {anio}.
_REASIG_ASUNTO_DEF = "Preparación y supervisión de vencimientos tributarios - {periodo}"
_REASIG_INTRO_DEF = ("Hola, {responsable}:\n\nPara el mes de {mes_nom}, como lo hemos venido "
                     "conversando, la revisión y aprobación de las liquidaciones tributarias "
                     "que tienes a cargo quedará distribuida de la siguiente manera:")
_REASIG_CIERRE_DEF = ("Las liquidaciones y sus soportes deberán remitirse al supervisor "
                      "correspondiente con la anticipación necesaria para realizar la revisión "
                      "y atender los ajustes antes del vencimiento. Cualquier dificultad que "
                      "pueda afectar el cumplimiento deberá informarse oportunamente.\n\n"
                      "Deberás mantener actualizado el calendario tributario, registrando los "
                      "soportes de presentación y pago cuando corresponda, así como las "
                      "observaciones y los pendientes de cada obligación.\n\nSaludos,")


class ReasigCorreoIn(BaseModel):
    asunto: str = ""
    intro: str = ""
    cierre: str = ""


def _reasig(session: Session) -> dict:
    """Texto base del correo de reasignación (editable en Configuración)."""
    return {
        "asunto": _get(session, "reasig_asunto", _REASIG_ASUNTO_DEF),
        "intro": _get(session, "reasig_intro", _REASIG_INTRO_DEF),
        "cierre": _get(session, "reasig_cierre", _REASIG_CIERRE_DEF),
    }


@router.get("/reasig-correo")
def obtener_reasig(session: Session = Depends(get_session), _=Depends(require_perm("config.roles"))):
    return _reasig(session)


@router.put("/reasig-correo")
def guardar_reasig(data: ReasigCorreoIn, session: Session = Depends(get_session),
                   _=Depends(require_perm("config.roles"))):
    _set(session, "reasig_asunto", data.asunto.strip() or _REASIG_ASUNTO_DEF)
    _set(session, "reasig_intro", data.intro.strip() or _REASIG_INTRO_DEF)
    _set(session, "reasig_cierre", data.cierre.strip() or _REASIG_CIERRE_DEF)
    session.commit()
    return _reasig(session)


# ===================================================== Mensaje de WhatsApp (cartera)
# Plantilla del texto que se prellena en wa.me para el cobro de cartera. Variables:
# {saludo} {cliente} {total} {firma} {banco} {tipo_cuenta} {numero_cuenta} {titular}.
# WhatsApp acepta formato: *negrita*, _cursiva_ y bloque monoespaciado con ``` ``` (la
# tabla). {tabla} la arma la app con las facturas; las demás variables son texto.
_WA_LINEA = "──────────────────"
_WA_DEF = ("🧾 *Srs. {cliente}*\n\n"
           "👋 Estimado(a){saludo}.\n\n"
           "En *{firma}* queremos recordarle que a la fecha presenta un saldo "
           "pendiente, que detallamos a continuación:\n"
           f"{_WA_LINEA}\n"
           "{tabla}\n"
           "💰 *Total: {total}*\n"
           f"{_WA_LINEA}\n\n"
           "🏦 Si lo desea, puede realizar su pago en la cuenta de "
           "*{tipo_cuenta} N° {numero_cuenta}* del banco *{banco}* a nombre de {titular}.\n\n"
           "🙏 Agradeciendo su atención, quedamos atentos a su pronto pago.\n\n"
           "P.D. Si ya realizó su pago, por favor haga caso omiso de este mensaje.")


class WaIn(BaseModel):
    plantilla: str = ""


def _wa(session: Session) -> str:
    """Plantilla del mensaje de WhatsApp de cartera."""
    return _get(session, "wa_plantilla", _WA_DEF)


@router.get("/wa")
def obtener_wa(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    return {"plantilla": _wa(session)}


@router.put("/wa")
def guardar_wa(data: WaIn, session: Session = Depends(get_session),
               _=Depends(require_perm("config.roles"))):
    _set(session, "wa_plantilla", data.plantilla.strip() or _WA_DEF)
    session.commit()
    return {"plantilla": _wa(session)}


# ===================================================== Pie de correo corporativo
# Bloque de firma/contacto que va al pie de los correos de la firma (estado de
# cuenta de cartera y, a futuro, cuentas de cobro). Editable por Super; nada
# quemado en el código.
_PIE_LEGAL_DEF = ("Este mensaje y sus anexos son confidenciales y para uso exclusivo "
                  "del destinatario. Si lo recibiste por error, por favor notifícanos "
                  "y elimínalo.")
_PIE_DEF = {
    "pie_nit": "901183812",
    "pie_nombre": "Ana Milena Cardona F.",
    "pie_cargo": "Gerente Administrativa y Financiera",
    "pie_telefono": "(+57) 324 683 3314",
    "pie_correo": "comercial@cardonaycardona.com",
    "pie_ciudad": "Cartagena, Colombia",
    "pie_web": "www.cardonaycardona.com",
    "pie_facebook": "facebook.com/cardonaycardona",
    "pie_instagram": "instagram.com/cardonaycardona",
    "pie_legal": _PIE_LEGAL_DEF,
}


class PieIn(BaseModel):
    nit: str = ""
    nombre: str = ""
    cargo: str = ""
    telefono: str = ""
    correo: str = ""
    ciudad: str = ""
    web: str = ""
    facebook: str = ""
    instagram: str = ""
    legal: str = ""


def _pie_correo(session: Session) -> dict:
    """Datos del pie de correo corporativo (con defaults de la firma)."""
    return {k.removeprefix("pie_"): _get(session, k, v) for k, v in _PIE_DEF.items()}


@router.get("/pie-correo")
def obtener_pie(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    return _pie_correo(session)


@router.put("/pie-correo")
def guardar_pie(data: PieIn, session: Session = Depends(get_session),
                _=Depends(require_perm("config.roles"))):
    _set(session, "pie_nit", data.nit.strip())
    _set(session, "pie_nombre", data.nombre.strip())
    _set(session, "pie_cargo", data.cargo.strip())
    _set(session, "pie_telefono", data.telefono.strip())
    _set(session, "pie_correo", data.correo.strip())
    _set(session, "pie_ciudad", data.ciudad.strip())
    _set(session, "pie_web", data.web.strip())
    _set(session, "pie_facebook", data.facebook.strip())
    _set(session, "pie_instagram", data.instagram.strip())
    _set(session, "pie_legal", data.legal.strip() or _PIE_LEGAL_DEF)
    session.commit()
    return _pie_correo(session)


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
