"""Sección 'Cuentas de cobro': listado por período y envío por correo.

La grilla se alimenta de la facturación GUARDADA del mes (una por mes): sus
ítems con forma = CC son las cuentas de cobro. La generación en firme y el PDF
viven en el módulo de facturación (se reutilizan); aquí va el listado por
período y el envío por correo.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..deps import require_perm
from ..models import CuentaCobro, Facturacion, Usuario
from .facturacion import filas_cc

router = APIRouter(prefix="/api/cobros", tags=["cobros"])


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


_MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
          "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


@router.post("/{fid}/item/{item_id}/enviar")
def enviar(fid: int, item_id: int, session: Session = Depends(get_session),
           u: Usuario = Depends(require_perm("facturacion.editar"))):
    """Envía por correo (Microsoft 365 / Graph) la cuenta de cobro en firme de un
    ítem, con el PDF adjunto. Requiere que esté generada, que el cliente tenga
    correo y que esté configurada la cuenta de envío."""
    from datetime import datetime
    from .facturacion import _cc_existente, _cc_html
    from .parametros import _correo, _correo_configurado
    from ..correo import enviar_correo_graph
    from ..cuenta_cobro import html_a_pdf
    from ..models import Cliente, FacturacionItem

    fac = session.get(Facturacion, fid)
    it = session.get(FacturacionItem, item_id)
    if not fac or not it:
        raise HTTPException(404, "Ítem no encontrado")
    cc = _cc_existente(session, fac.anio, fac.mes, it.cliente_id, it.concepto)
    if not cc:
        raise HTTPException(400, "Primero genera la cuenta de cobro en firme.")
    correo = cc.email_destino or ((session.get(Cliente, it.cliente_id).email or "").strip()
                                  if it.cliente_id else "")
    if not correo:
        raise HTTPException(400, "El cliente no tiene correo registrado.")
    if not _correo_configurado(session):
        raise HTTPException(400, "Aún no está configurada la cuenta de correo de envío "
                                 "(Configuración → Correo de envío).")
    cfg = _correo(session)
    mes_nom = _MESES[cc.mes] if 1 <= cc.mes <= 12 else str(cc.mes)

    def _fmt(t: str) -> str:
        return (t.replace("{numero}", cc.numero).replace("{mes}", mes_nom)
                .replace("{anio}", str(cc.anio)).replace("{cliente}", cc.deudor))

    pdf = html_a_pdf(_cc_html(cc))
    try:
        enviar_correo_graph(cfg, destinatario=correo, asunto=_fmt(cfg["asunto"]),
                            cuerpo=_fmt(cfg["cuerpo"]), pdf_bytes=pdf,
                            nombre_pdf=f"CC {cc.numero}.pdf".replace("/", "-"))
    except Exception as e:  # noqa: BLE001
        cc.error_envio = str(e)[:500]
        session.add(cc)
        session.commit()
        raise HTTPException(502, f"No se pudo enviar: {e}")
    cc.estado = "enviada"
    cc.enviado_at = datetime.utcnow()
    cc.enviado_por = u.nombre or u.usuario or ""
    cc.error_envio = ""
    session.add(cc)
    session.commit()
    return {"ok": True, "numero": cc.numero, "correo": correo}
