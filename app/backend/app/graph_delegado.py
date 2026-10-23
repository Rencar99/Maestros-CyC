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


def iniciar_device_code() -> dict:
    """Pide un código de dispositivo. Devuelve user_code, verification_uri,
    device_code, interval, expires_in, message."""
    j = _post_form(f"{_AUTH}/oauth2/v2.0/devicecode", {"client_id": CLIENT_ID, "scope": SCOPE})
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


def refrescar(refresh_token: str) -> dict:
    """Canjea el refresh token por un access token nuevo (y a veces un refresh
    token nuevo). Lanza si el token fue revocado/expiró."""
    j = _post_form(f"{_AUTH}/oauth2/v2.0/token", {
        "grant_type": "refresh_token", "client_id": CLIENT_ID,
        "scope": SCOPE, "refresh_token": refresh_token})
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


def enviar(access_token: str, *, destinatario: str, asunto: str, cuerpo: str,
           adjuntos: list[tuple[str, bytes]] | None = None, html: bool = False) -> None:
    """Envía un correo COMO el usuario del token (sale de su propio buzón),
    con los adjuntos indicados. Lanza RuntimeError con mensaje claro si falla."""
    msg = {
        "message": {
            "subject": asunto,
            "body": {"contentType": "HTML" if html else "Text", "content": cuerpo},
            "toRecipients": [{"emailAddress": {"address": destinatario}}],
            "attachments": [
                {"@odata.type": "#microsoft.graph.fileAttachment", "name": nombre,
                 "contentBytes": base64.b64encode(data).decode()}
                for nombre, data in (adjuntos or [])
            ],
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
