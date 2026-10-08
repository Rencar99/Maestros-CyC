"""Envío de correos por Microsoft Graph (flujo de aplicación / client credentials).

Usa un buzón de la firma como remitente y una app registrada en Azure con el
permiso de aplicación ``Mail.Send``. No requiere interacción del usuario ni
contraseñas de aplicación (no lo bloquea Microsoft como al SMTP). Solo stdlib."""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request


def _token(tenant: str, client_id: str, client_secret: str) -> str:
    url = f"https://login.microsoftonline.com/{urllib.parse.quote(tenant)}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            tok = json.loads(r.read()).get("access_token")
    except urllib.error.HTTPError as e:
        raise RuntimeError(_msg_error(e, "autenticando con Microsoft")) from None
    if not tok:
        raise RuntimeError("Microsoft no devolvió un token de acceso.")
    return tok


def _msg_error(e: urllib.error.HTTPError, ctx: str) -> str:
    try:
        j = json.loads(e.read())
        det = j.get("error_description") or (j.get("error") or {}).get("message") or str(j.get("error"))
    except Exception:  # noqa: BLE001
        det = ""
    det = (det or "").splitlines()[0][:220] if det else ""
    return f"{ctx} (HTTP {e.code}): {det}" if det else f"{ctx} (HTTP {e.code})"


def enviar_correo_graph(cfg: dict, *, destinatario: str, asunto: str, cuerpo: str,
                        pdf_bytes: bytes, nombre_pdf: str) -> None:
    """Envía un correo con el PDF adjunto desde el buzón ``cfg['remitente']``.
    Lanza RuntimeError con un mensaje claro si falla."""
    token = _token(cfg["tenant"], cfg["client_id"], cfg["client_secret"])
    payload = {
        "message": {
            "subject": asunto,
            "body": {"contentType": "Text", "content": cuerpo},
            "toRecipients": [{"emailAddress": {"address": destinatario}}],
            "attachments": [{
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": nombre_pdf,
                "contentType": "application/pdf",
                "contentBytes": base64.b64encode(pdf_bytes).decode("ascii"),
            }],
        },
        "saveToSentItems": True,
    }
    url = f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(cfg['remitente'])}/sendMail"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60):
            return   # 202 Accepted
    except urllib.error.HTTPError as e:
        raise RuntimeError(_msg_error(e, "enviando el correo")) from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"No hay conexión con Microsoft: {e.reason}") from None
