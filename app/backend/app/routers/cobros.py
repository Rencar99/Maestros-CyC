"""Sección 'Cuentas de cobro': listado por período y envío por correo.

La grilla se alimenta de la facturación GUARDADA del mes (una por mes): sus
ítems con forma = CC son las cuentas de cobro. La generación en firme y el PDF
viven en el módulo de facturación (se reutilizan); aquí va el listado por
período y el envío por correo.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..deps import require_perm
from ..models import CuentaCobro, Facturacion, Usuario
from .facturacion import filas_cc

router = APIRouter(prefix="/api/cobros", tags=["cobros"])

_MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
          "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


class EnviarIn(BaseModel):
    """Lo que el modal de envío (estilo Outlook) manda. Todo opcional: si viene
    vacío (p.ej. 'Enviar todas') se usa la plantilla y el correo del cliente."""
    para: str | None = None
    cc: str | None = None
    cco: str | None = None
    asunto: str | None = None
    cuerpo: str | None = None


def _split_correos(txt: str | None) -> list[str]:
    """Separa 'a@x, b@y; c@z' en una lista limpia de direcciones."""
    return [p.strip() for p in re.split(r"[,;\n]+", txt or "") if p.strip()]


def _emisor_nombre(session: Session, cc: CuentaCobro) -> str:
    """Nombre del emisor que firma/emite la CC: la foto guardada en la cuenta o,
    si está vacía (CC vieja), el del catálogo."""
    if cc.emisor_nombre:
        return cc.emisor_nombre
    if cc.emisor_id:
        from ..models import Emisor
        em = session.get(Emisor, cc.emisor_id)
        return em.nombre if em else ""
    return ""


def _fmt_txt(t: str, cc: CuentaCobro, emisor: str = "") -> str:
    """Resuelve los marcadores de la plantilla contra la cuenta de cobro.
    {emisor} = quien emite/envía la cuenta de cobro (no la firma)."""
    mes_nom = _MESES[cc.mes] if 1 <= cc.mes <= 12 else str(cc.mes)
    return (t.replace("{numero}", cc.numero).replace("{mes}", mes_nom)
            .replace("{anio}", str(cc.anio)).replace("{cliente}", cc.deudor)
            .replace("{emisor}", emisor))


def _parse_periodo(periodo: str) -> tuple[int, int]:
    try:
        a, m = periodo.split("-")
        anio, mes = int(a), int(m)
        if not (1 <= mes <= 12):
            raise ValueError
        return anio, mes
    except (ValueError, AttributeError):
        raise HTTPException(400, "Período inválido (use AAAA-MM).")


@router.get("")
def listar(periodo: str, session: Session = Depends(get_session),
           _u: Usuario = Depends(require_perm("facturacion.ver"))):
    """Cuentas de cobro del período (AAAA-MM). Si no hay facturación guardada de
    ese mes, devuelve filas vacías (hay que generarla primero en Facturación)."""
    anio, mes = _parse_periodo(periodo)
    fac = session.exec(select(Facturacion).where(
        Facturacion.anio == anio, Facturacion.mes == mes)).first()
    if not fac:
        return {"fid": None, "periodo": periodo, "etiqueta": "", "rows": []}
    return {"fid": fac.id, "periodo": periodo, "etiqueta": fac.etiqueta,
            "rows": filas_cc(session, fac)}


def _cc_de_cliente(session: Session, fid: int, cliente_id: int) -> tuple[Facturacion, CuentaCobro]:
    """Resuelve (facturación, cuenta de cobro en firme del cliente) o lanza el error
    correspondiente. La CC tiene que estar generada para poder enviarla."""
    from .facturacion import _cc_existente
    fac = session.get(Facturacion, fid)
    if not fac:
        raise HTTPException(404, "Facturación no encontrada")
    cc = _cc_existente(session, fac.anio, fac.mes, cliente_id)
    if not cc:
        raise HTTPException(400, "Primero genera la cuenta de cobro en firme.")
    return fac, cc


@router.get("/{fid}/cliente/{cliente_id}/correo-preview")
def correo_preview(fid: int, cliente_id: int, session: Session = Depends(get_session),
                   u: Usuario = Depends(require_perm("facturacion.editar"))):
    """Lo que verá el modal de envío (estilo Outlook) antes de disparar: De (el
    correo conectado del responsable), Para (el del cliente), Asunto y Cuerpo ya
    resueltos desde la plantilla, y el nombre del PDF adjunto. Todo es editable
    en el modal menos el De y el adjunto."""
    from ..models import Cliente, Usuario
    from .parametros import _correo
    _fac, cc = _cc_de_cliente(session, fid, cliente_id)
    para = cc.email_destino or ((session.get(Cliente, cliente_id).email or "").strip()
                                if cliente_id else "")
    cfg = _correo(session)
    usr = session.get(Usuario, u.id)
    emisor = _emisor_nombre(session, cc)
    return {
        "de": (usr.correo_cuenta if usr else "") or "",
        "conectado": bool(usr and usr.correo_token_enc),
        "para": para,
        "asunto": _fmt_txt(cfg["asunto"], cc, emisor),
        "cuerpo": _fmt_txt(cfg["cuerpo"], cc, emisor),
        "adjunto": f"CC {cc.numero}.pdf".replace("/", "-"),
        "numero": cc.numero,
    }


@router.post("/{fid}/cliente/{cliente_id}/enviar")
def enviar(fid: int, cliente_id: int, datos: EnviarIn | None = None,
           session: Session = Depends(get_session),
           u: Usuario = Depends(require_perm("facturacion.editar"))):
    """Envía la cuenta de cobro en firme del cliente (PDF adjunto) por Microsoft
    365 (Graph DELEGADO): sale del propio correo del responsable que la envía.
    Si el body trae Para/CC/CCO/Asunto/Cuerpo (del modal), usa eso; si viene
    vacío (p.ej. 'Enviar todas'), usa la plantilla y el correo del cliente.
    Requiere que esté generada y que el responsable haya conectado su correo."""
    from datetime import datetime
    from .facturacion import _cc_html
    from .parametros import _correo
    from ..graph_delegado import enviar as graph_enviar, refrescar
    from ..cuenta_cobro import html_a_pdf
    from ..models import Cliente, Usuario
    from ..security import decrypt, encrypt

    _fac, cc = _cc_de_cliente(session, fid, cliente_id)
    datos = datos or EnviarIn()
    cfg = _correo(session)
    para = (datos.para or "").strip() or cc.email_destino or (
        (session.get(Cliente, cliente_id).email or "").strip() if cliente_id else "")
    if not para:
        raise HTTPException(400, "El cliente no tiene correo registrado.")
    emisor = _emisor_nombre(session, cc)
    asunto = datos.asunto if datos.asunto is not None else _fmt_txt(cfg["asunto"], cc, emisor)
    cuerpo = datos.cuerpo if datos.cuerpo is not None else _fmt_txt(cfg["cuerpo"], cc, emisor)
    cc_list = _split_correos(datos.cc)
    cco_list = _split_correos(datos.cco)

    usr = session.get(Usuario, u.id)
    if not usr or not usr.correo_token_enc:
        raise HTTPException(400, "Conecta tu correo de Microsoft 365 primero (Configuración → Mi correo).")
    try:
        tokens = refrescar(decrypt(usr.correo_token_enc))
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Tu sesión de correo expiró; reconéctala en Configuración → Mi correo.")
    if tokens.get("refresh_token"):
        usr.correo_token_enc = encrypt(tokens["refresh_token"])
        session.add(usr)
        session.commit()

    pdf = html_a_pdf(_cc_html(session, cc))
    try:
        graph_enviar(tokens["access_token"], destinatario=para, asunto=asunto, cuerpo=cuerpo,
                     cc=cc_list, cco=cco_list,
                     adjuntos=[(f"CC {cc.numero}.pdf".replace("/", "-"), pdf)])
    except Exception as e:  # noqa: BLE001
        cc.error_envio = str(e)[:500]
        session.add(cc)
        session.commit()
        raise HTTPException(502, f"No se pudo enviar: {e}")
    cc.estado = "enviada"
    cc.enviado_at = datetime.utcnow()
    cc.enviado_por = u.nombre or u.usuario or ""
    cc.email_destino = para
    cc.error_envio = ""
    session.add(cc)
    session.commit()
    return {"ok": True, "numero": cc.numero, "correo": para}
