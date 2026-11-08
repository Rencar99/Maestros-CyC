"""Envío de correos por Microsoft Graph con autenticación DELEGADA: cada
responsable envía desde SU propio correo de Microsoft 365 (el Nuevo Outlook).

Usa el flujo de 'código de dispositivo' con el cliente público de Microsoft
(Microsoft Graph Command Line Tools), así NO hay que registrar una app en
Azure. El responsable inicia sesión una sola vez en microsoft.com/devicelogin
y se guarda su refresh token (cifrado) para enviar a su nombre. Reutilizable
para cuentas de cobro, estados de cuenta, calendarios, etc. Solo stdlib.
"""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request

# Cliente público multi-tenant de Microsoft con permisos delegados de Graph.
# No requiere registrar una app propia ni manejar secretos.
CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"  # Microsoft Graph Command Line Tools
_AUTH = "https://login.microsoftonline.com/organizations"   # solo cuentas de trabajo/escuela
SCOPE = "Mail.Send offline_access openid profile User.Read"
# Scope para LEER archivos (OneDrive/SharePoint) por Graph. Requiere consentimiento
# de administrador en el inquilino de la firma (Files.Read.All). Se usa aparte del
# correo: `refrescar(rt, SCOPE_FILES)` da un token de archivos desde el MISMO refresh
# token, siempre que ese usuario haya consentido archivos (re-login). No cambia el
# flujo de correo, que sigue usando `SCOPE` por defecto.
SCOPE_FILES = "Files.Read.All offline_access"
# Scope combinado para el login device-code cuando se quiera un solo token que cubra
# correo + archivos. NO se usa aún en el flujo de correo en producción (evita el muro
# de admin consent a quien solo conecta correo); se adoptará con el consent tenant-wide.
SCOPE_LOGIN_FULL = "Mail.Send Files.Read.All offline_access openid profile User.Read"


def _post_form(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode() or "{}")
        except Exception:  # noqa: BLE001
            return {"error": "http", "error_description": f"HTTP {e.code}"}


def iniciar_device_code(scope: str = SCOPE) -> dict:
    """Pide un código de dispositivo. Devuelve user_code, verification_uri,
    device_code, interval, expires_in, message. `scope` por defecto = correo (no
    cambia el flujo existente); pasar SCOPE_LOGIN_FULL para pedir también archivos."""
    j = _post_form(f"{_AUTH}/oauth2/v2.0/devicecode", {"client_id": CLIENT_ID, "scope": scope})
    if "device_code" not in j:
        raise RuntimeError(j.get("error_description") or "No se pudo iniciar el inicio de sesión.")
    return j


def poll_token(device_code: str) -> tuple[str, dict]:
    """Un intento de canje del device_code. Devuelve ('ok', tokens) |
    ('pendiente', {}) | ('error', {'msg': ...})."""
    j = _post_form(f"{_AUTH}/oauth2/v2.0/token", {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "client_id": CLIENT_ID, "device_code": device_code})
    if "access_token" in j:
        return "ok", j
    err = j.get("error", "")
    if err in ("authorization_pending", "slow_down"):
        return "pendiente", {}
    return "error", {"msg": j.get("error_description") or err or "Inicio de sesión no completado."}


def refrescar(refresh_token: str, scope: str = SCOPE) -> dict:
    """Canjea el refresh token por un access token nuevo (y a veces un refresh
    token nuevo). `scope` por defecto = correo (comportamiento existente intacto);
    pasar SCOPE_FILES para un token de archivos. Lanza si el token fue revocado,
    expiró o el usuario no consintió ese scope (p.ej. archivos sin re-login)."""
    j = _post_form(f"{_AUTH}/oauth2/v2.0/token", {
        "grant_type": "refresh_token", "client_id": CLIENT_ID,
        "scope": scope, "refresh_token": refresh_token})
    if "access_token" not in j:
        raise RuntimeError(j.get("error_description") or "Sesión de correo expirada; vuelve a conectarla.")
    return j


def cuenta_de(access_token: str) -> str:
    """Correo de la cuenta conectada (para mostrarlo)."""
    req = urllib.request.Request("https://graph.microsoft.com/v1.0/me",
                                 headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode() or "{}")
            return j.get("mail") or j.get("userPrincipalName") or ""
    except Exception:  # noqa: BLE001
        return ""


def _destinatarios(valores: list[str] | None) -> list[dict]:
    return [{"emailAddress": {"address": v}} for v in (valores or []) if (v or "").strip()]


def enviar(access_token: str, *, destinatario: str, asunto: str, cuerpo: str,
           cc: list[str] | None = None, cco: list[str] | None = None,
           adjuntos: list[tuple[str, bytes]] | None = None, html: bool = False,
           imagenes_inline: list[tuple[str, bytes, str]] | None = None) -> None:
    """Envía un correo COMO el usuario del token (sale de su propio buzón),
    con los adjuntos indicados y copias CC/CCO opcionales. Lanza RuntimeError con
    mensaje claro si falla. ``imagenes_inline`` = (cid, bytes, mime) para incrustar
    imágenes en el HTML vía ``<img src="cid:...">`` (p. ej. el logo de la firma)."""
    attachments = [
        {"@odata.type": "#microsoft.graph.fileAttachment", "name": nombre,
         "contentBytes": base64.b64encode(data).decode()}
        for nombre, data in (adjuntos or [])
    ]
    attachments += [
        {"@odata.type": "#microsoft.graph.fileAttachment", "name": cid,
         "contentType": mime, "isInline": True, "contentId": cid,
         "contentBytes": base64.b64encode(data).decode()}
        for cid, data, mime in (imagenes_inline or [])
    ]
    msg = {
        "message": {
            "subject": asunto,
            "body": {"contentType": "HTML" if html else "Text", "content": cuerpo},
            "toRecipients": [{"emailAddress": {"address": destinatario}}],
            "ccRecipients": _destinatarios(cc),
            "bccRecipients": _destinatarios(cco),
            "attachments": attachments,
        },
        "saveToSentItems": True,
    }
    req = urllib.request.Request("https://graph.microsoft.com/v1.0/me/sendMail",
                                 data=json.dumps(msg).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {access_token}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status not in (200, 202):
                raise RuntimeError(f"Microsoft 365 respondió {r.status}")
    except urllib.error.HTTPError as e:
        detalle = ""
        try:
            detalle = json.loads(e.read().decode()).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"No se pudo enviar por Microsoft 365: {detalle or e.reason}")
