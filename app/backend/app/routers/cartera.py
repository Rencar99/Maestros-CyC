"""Sección 'Cartera / CxC': lee la cartera por cobrar de la firma desde GLERP
(snapshot en ``CxcItem``) y gestiona el cobro (dato propio en ``CxcGestion`` /
``CxcNota``), enlazado al maestro de Clientes por NIT.

Dos capas:
  · GLERP = fuente SOLO LECTURA; se sincroniza a una foto local (``sincronizar``).
  · Seguimiento de cobro = dato de la firma (estado, compromiso, notas).

Alcance: la cartera es una vista financiera de la firma (quien tiene
``cartera.ver`` la ve completa), pero se ocultan los clientes CONFIDENCIALES que
el usuario no puede ver (misma regla que el resto de Maestros).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from .. import glerp
from ..config import glerp_configurado
from ..db import get_session
from ..deps import require_perm
from ..models import Cliente, CxcGestion, CxcItem, CxcNota, CxcSync, Usuario
from ..scope import alcance_de

router = APIRouter(prefix="/api/cartera", tags=["cartera"])

ESTADOS = {"sin_gestion", "en_gestion", "promesa", "disputa", "juridico", "al_dia"}
_BUCKETS = ["corriente", "1-30", "31-60", "61-90", "90+"]


def _digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _mapa_clientes(session: Session) -> dict[str, tuple[int, bool]]:
    """NIT (solo dígitos) → (cliente_id, confidencial). Clave por num_id del
    maestro (sin dígito de verificación)."""
    mapa: dict[str, tuple[int, bool]] = {}
    for cid, num_id, conf in session.exec(
            select(Cliente.id, Cliente.num_id, Cliente.confidencial)).all():
        k = _digitos(num_id)
        if k:
            mapa[k] = (cid, bool(conf))
    return mapa


def _resolver(nit: str, mapa: dict[str, tuple[int, bool]]) -> Optional[tuple[int, bool]]:
    """Resuelve un NIT de GLERP contra el maestro: exacto, o quitando el dígito
    de verificación (GLERP a veces lo trae pegado)."""
    g = _digitos(nit)
    if not g:
        return None
    return mapa.get(g) or (mapa.get(g[:-1]) if len(g) > 1 else None)


def _dec(x) -> Decimal:
    return Decimal(str(round(float(x or 0), 2)))


def _visibles(session: Session, user: Usuario):
    """Items de cartera que el usuario puede ver (oculta confidenciales no
    autorizados) + el mapa de clientes para resolver nombre/id. Devuelve
    ``(items, mapa, ocultos)``."""
    _permitidos, ocultos = alcance_de(session, user)
    mapa = _mapa_clientes(session)
    items = session.exec(select(CxcItem)).all()
    if ocultos:
        vis = []
        for it in items:
            r = _resolver(it.nit, mapa)
            if r and r[0] in ocultos:
                continue
            vis.append(it)
        items = vis
    return items, mapa, ocultos


def _ultima_sync(session: Session) -> Optional[CxcSync]:
    return session.exec(select(CxcSync).order_by(CxcSync.fecha.desc())).first()


@router.get("/resumen")
def resumen(session: Session = Depends(get_session),
            u: Usuario = Depends(require_perm("cartera.ver"))):
    """KPIs y cartera por edades de la foto vigente (solo lo visible al usuario)."""
    items, _mapa, _oc = _visibles(session, u)
    por_bucket = {b: {"docs": 0, "saldo": 0.0} for b in _BUCKETS}
    nits: set[str] = set()
    total = 0.0
    for it in items:
        s = float(it.saldo or 0)
        total += s
        b = it.bucket if it.bucket in por_bucket else "corriente"
        por_bucket[b]["docs"] += 1
        por_bucket[b]["saldo"] += s
        if it.nit:
            nits.add(_digitos(it.nit))
    vencido = sum(por_bucket[b]["saldo"] for b in ("1-30", "31-60", "61-90", "90+"))
    sync = _ultima_sync(session)
    return {
        "configurado": glerp_configurado(),
        "sincronizado_at": sync.fecha.isoformat() if sync else None,
        "sincronizado_por": sync.por if sync else "",
        "total": round(total, 2),
        "docs": len(items),
        "clientes": len(nits),
        "vencido": round(vencido, 2),
        "edades": [{"bucket": b, "docs": por_bucket[b]["docs"],
                    "saldo": round(por_bucket[b]["saldo"], 2)} for b in _BUCKETS],
    }


@router.get("")
def listar(session: Session = Depends(get_session),
           u: Usuario = Depends(require_perm("cartera.ver"))):
    """Una fila por cliente (agrupa sus documentos): saldo, nº de docs, edad peor,
    días máximos vencido y su estado de gestión."""
    items, mapa, _oc = _visibles(session, u)
    # Gestión por NIT (dígitos) para empalmar.
    gest = {_digitos(g.nit): g for g in session.exec(select(CxcGestion)).all()}
    por_nit: dict[str, dict] = {}
    for it in items:
        k = _digitos(it.nit) or ("__" + it.codcli)
        g = por_nit.get(k)
        if not g:
            r = _resolver(it.nit, mapa)
            g = por_nit[k] = {
                "nit": it.nit, "nombre": it.nombre, "cliente_id": r[0] if r else None,
                "docs": 0, "saldo": 0.0, "dias_max": -99999, "bucket": "corriente",
                "fec_ant": None, "doc_ant": "",
            }
        g["docs"] += 1
        g["saldo"] += float(it.saldo or 0)
        if it.dias_venc > g["dias_max"]:
            g["dias_max"] = it.dias_venc
        if _BUCKETS.index(it.bucket if it.bucket in _BUCKETS else "corriente") > _BUCKETS.index(g["bucket"]):
            g["bucket"] = it.bucket
        # Documento más antiguo del cliente (menor fecha de emisión).
        if it.fecfac and (g["fec_ant"] is None or it.fecfac < g["fec_ant"]):
            g["fec_ant"] = it.fecfac
            g["doc_ant"] = it.documento
    filas = []
    for k, g in por_nit.items():
        ge = gest.get(_digitos(g["nit"]))
        filas.append({
            "nit": g["nit"], "nombre": g["nombre"], "cliente_id": g["cliente_id"],
            "docs": g["docs"], "saldo": round(g["saldo"], 2),
            "dias_max": g["dias_max"] if g["dias_max"] > -99999 else 0,
            "bucket": g["bucket"],
            "fecha_antigua": g["fec_ant"].isoformat() if g["fec_ant"] else None,
            "doc_antiguo": g["doc_ant"],
            "estado": ge.estado if ge else "sin_gestion",
            "compromiso_fecha": ge.compromiso_fecha.isoformat() if ge and ge.compromiso_fecha else None,
            "proximo_contacto": ge.proximo_contacto.isoformat() if ge and ge.proximo_contacto else None,
        })
    filas.sort(key=lambda r: r["saldo"], reverse=True)
    return {"rows": filas}


@router.get("/documentos")
def documentos(session: Session = Depends(get_session),
               u: Usuario = Depends(require_perm("cartera.ver"))):
    """Detalle por documento de toda la cartera visible (vista 'CxC por Edades').
    Cada fila trae su saldo y su rango de edad; el reparto en columnas de edad lo
    hace el frontend."""
    items, _mapa, _oc = _visibles(session, u)
    docs = [{
        "nit": it.nit, "nombre": it.nombre, "documento": it.documento, "tipodoc": it.tipodoc,
        "fecfac": it.fecfac.isoformat() if it.fecfac else None,
        "vencimiento": it.vencimiento.isoformat() if it.vencimiento else None,
        "venfac": it.venfac, "dias_venc": it.dias_venc, "bucket": it.bucket,
        "saldo": float(it.saldo) if it.saldo is not None else 0.0,
    } for it in items]
    docs.sort(key=lambda d: d["saldo"], reverse=True)
    return {"rows": docs}


def _nit_visible(session: Session, u: Usuario, nit: str) -> None:
    """Corta con 403 si el NIT corresponde a un cliente confidencial oculto."""
    _permitidos, ocultos = alcance_de(session, u)
    if not ocultos:
        return
    r = _resolver(nit, _mapa_clientes(session))
    if r and r[0] in ocultos:
        raise HTTPException(403, "Cliente confidencial")


@router.get("/cliente/{nit}")
def estado_cuenta(nit: str, session: Session = Depends(get_session),
                  u: Usuario = Depends(require_perm("cartera.ver"))):
    """Documentos (estado de cuenta) de un cliente, ordenados por vencimiento."""
    _nit_visible(session, u, nit)
    d = _digitos(nit)
    items = [it for it in session.exec(select(CxcItem)).all() if _digitos(it.nit) == d]
    items.sort(key=lambda it: (it.vencimiento or date.max))
    docs = [{
        "documento": it.documento, "tipodoc": it.tipodoc,
        "fecfac": it.fecfac.isoformat() if it.fecfac else None,
        "vencimiento": it.vencimiento.isoformat() if it.vencimiento else None,
        "venfac": it.venfac, "dias_venc": it.dias_venc, "bucket": it.bucket,
        "vlrfac": float(it.vlrfac) if it.vlrfac is not None else None,
        "saldo": float(it.saldo) if it.saldo is not None else None,
    } for it in items]
    nombre = items[0].nombre if items else ""
    total = round(sum(float(it.saldo or 0) for it in items), 2)
    return {"nit": nit, "nombre": nombre, "docs": docs, "total": total}


# --- Enviar estado de cuenta (correo + WhatsApp) -----------------------------
def _cliente_de_nit(session: Session, nit: str) -> Optional[Cliente]:
    """Cliente del maestro para un NIT de GLERP (resuelve con/sin dígito)."""
    r = _resolver(nit, _mapa_clientes(session))
    return session.get(Cliente, r[0]) if r else None


def _edades(docs: list[dict]) -> dict[str, float]:
    """Suma de saldo por rango de edad (para el resumen del PDF y de WhatsApp)."""
    m = {b: 0.0 for b in _BUCKETS}
    for d in docs:
        b = d.get("bucket") if d.get("bucket") in m else "corriente"
        m[b] += float(d.get("saldo") or 0)
    return m


def _pesos(v) -> str:
    return "$ " + f"{int(round(float(v or 0))):,}".replace(",", ".")


def _estado_cuenta_html(session: Session, nombre: str, nit: str,
                        docs: list[dict], total: float) -> str:
    """HTML del estado de cuenta (membrete de la firma + tabla de documentos +
    resumen por edades + total + datos de pago). Se convierte a PDF y se adjunta."""
    from html import escape
    from .parametros import _cobro
    pago = _cobro(session)
    firma = pago.get("titular") or "Cardona & Cardona Consultores S.A.S"
    sync = _ultima_sync(session)
    corte = sync.fecha.strftime("%Y-%m-%d") if sync and sync.fecha else date.today().isoformat()
    ed = _edades(docs)
    filas = "".join(
        f"<tr><td>{escape(str(d.get('tipodoc') or ''))} {escape(str(d.get('documento') or ''))}</td>"
        f"<td>{escape(d.get('fecfac') or '')}</td><td>{escape(d.get('vencimiento') or '')}</td>"
        f"<td class='r'>{d.get('dias_venc') if (d.get('dias_venc') or 0) > 0 else '—'}</td>"
        f"<td class='r'>{_pesos(d.get('saldo'))}</td></tr>"
        for d in docs) or "<tr><td colspan='5' class='vacio'>Sin documentos pendientes.</td></tr>"
    chips = "".join(
        f"<span class='ed'><b>{_BUCKET_LBL[b]}</b> {_pesos(ed[b])}</span>"
        for b in _BUCKETS if ed[b])
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #2b2f36; margin: 0; padding: 34px 40px; }}
  .enc {{ display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0836c7; padding-bottom:12px; }}
  .firma {{ font-size:17px; font-weight:800; color:#0836c7; }}
  .firma small {{ display:block; font-size:11.5px; font-weight:600; color:#6b7280; margin-top:2px; }}
  .tit {{ text-align:right; }}
  .tit b {{ font-size:15px; }} .tit small {{ display:block; color:#6b7280; font-size:11.5px; }}
  .cli {{ margin:18px 0 8px; font-size:13px; }} .cli b {{ font-size:14px; }}
  table.doc {{ width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }}
  table.doc th {{ background:#f1f4f8; text-align:left; padding:7px 9px; border-bottom:1px solid #d6dce5; font-size:11px; text-transform:uppercase; letter-spacing:.3px; color:#55606e; }}
  table.doc td {{ padding:6px 9px; border-bottom:1px solid #eef1f5; }}
  table.doc .r {{ text-align:right; }} .vacio {{ color:#8a94a3; padding:14px 9px; }}
  .tot {{ margin-top:4px; text-align:right; font-size:14px; }} .tot b {{ font-size:18px; color:#0836c7; }}
  .edades {{ margin:16px 0; display:flex; flex-wrap:wrap; gap:8px; }}
  .ed {{ background:#f6f8fc; border:1px solid #e2e6ec; border-radius:7px; padding:6px 10px; font-size:11.5px; }}
  .ed b {{ color:#44474b; }}
  .pago {{ margin-top:22px; background:#fafbfc; border:1px solid #e2e6ec; border-radius:9px; padding:13px 15px; font-size:12.5px; line-height:1.6; color:#44474b; }}
  .pago .lbl {{ font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; color:#8a94a3; margin-bottom:3px; }}
  .pie {{ margin-top:18px; font-size:11.5px; color:#6b7280; }}
</style></head><body>
  <div class="enc">
    <div class="firma">{escape(firma)}<small>Estado de cuenta de cartera</small></div>
    <div class="tit"><b>Estado de cuenta</b><small>Corte: {escape(corte)}</small></div>
  </div>
  <div class="cli">Cliente: <b>{escape(nombre or '')}</b><br>NIT: {escape(nit)}</div>
  <div class="edades">{chips}</div>
  <table class="doc">
    <thead><tr><th>Documento</th><th>Fecha</th><th>Vence</th><th class="r">Días</th><th class="r">Saldo</th></tr></thead>
    <tbody>{filas}</tbody>
  </table>
  <div class="tot">Total adeudado: <b>{_pesos(total)}</b></div>
  <div class="pago"><div class="lbl">Forma de pago</div>
    Consignación en la cuenta de <b>{escape(pago.get('tipo_cuenta') or '')} N° {escape(pago.get('numero_cuenta') or '')}</b>
    del banco <b>{escape(pago.get('banco') or '')}</b> a nombre de <b>{escape(firma)}</b>.</div>
  <div class="pie">Si ya realizaste el pago, por favor haz caso omiso de este mensaje y envíanos el comprobante. Gracias por tu atención.</div>
</body></html>"""


_BUCKET_LBL = {"corriente": "Corriente", "1-30": "1–30", "31-60": "31–60",
               "61-90": "61–90", "90+": "+90"}


def _wa_texto(nombre: str, total: float, firma: str) -> str:
    """Mensaje corto para WhatsApp (wa.me). El detalle va por correo (PDF)."""
    saludo = (nombre or "").split()[0].title() if nombre else ""
    return (f"Hola {saludo}, te saluda {firma}. "
            f"A la fecha presentas un saldo pendiente con nosotros de {_pesos(total)}. "
            f"Te enviamos el estado de cuenta detallado a tu correo. "
            f"Quedamos atentos, muchas gracias.").replace("Hola ,", "Hola,")


class EnviarCarteraIn(BaseModel):
    para: Optional[str] = None
    asunto: Optional[str] = None
    cuerpo: Optional[str] = None
    cc: Optional[str] = None
    cco: Optional[str] = None


def _datos_envio(session: Session, nit: str):
    """(cliente, nombre, docs, total) para armar correo/WhatsApp de un NIT."""
    d = _digitos(nit)
    items = [it for it in session.exec(select(CxcItem)).all() if _digitos(it.nit) == d]
    items.sort(key=lambda it: (it.vencimiento or date.max))
    docs = [{"documento": it.documento, "tipodoc": it.tipodoc,
             "fecfac": it.fecfac.isoformat() if it.fecfac else None,
             "vencimiento": it.vencimiento.isoformat() if it.vencimiento else None,
             "dias_venc": it.dias_venc, "bucket": it.bucket,
             "saldo": float(it.saldo) if it.saldo is not None else 0.0} for it in items]
    nombre = items[0].nombre if items else ""
    cli = _cliente_de_nit(session, nit)
    if cli and cli.nombre:
        nombre = cli.nombre
    total = round(sum(float(it.saldo or 0) for it in items), 2)
    return cli, nombre, docs, total


@router.get("/cliente/{nit}/correo-preview")
def correo_preview(nit: str, session: Session = Depends(get_session),
                   u: Usuario = Depends(require_perm("cartera.editar"))):
    """Prefill del modal de envío: correo del cliente, asunto/cuerpo, celular para
    WhatsApp y el texto sugerido. Todo editable en el modal menos el adjunto."""
    _nit_visible(session, u, nit)
    from .parametros import _cobro
    cli, nombre, _docs, total = _datos_envio(session, nit)
    firma = _cobro(session).get("titular") or "Cardona & Cardona Consultores S.A.S"
    para = (cli.email or "").strip() if cli else ""
    celular = _digitos(cli.telefono) if cli else ""
    asunto = f"Estado de cuenta - {firma}"
    cuerpo = (f"Cordial saludo{(' ' + nombre) if nombre else ''},\n\n"
              f"Adjuntamos el estado de cuenta de la cartera pendiente con nosotros, "
              f"por un total de {_pesos(total)} a la fecha.\n\n"
              f"Si ya realizaste el pago, por favor envíanos el comprobante y haz caso "
              f"omiso de este mensaje.\n\nQuedamos atentos. Gracias.")
    return {"para": para, "asunto": asunto, "cuerpo": cuerpo,
            "adjunto": f"Estado de cuenta {nombre or nit}.pdf".replace("/", "-"),
            "celular": celular, "wa_texto": _wa_texto(nombre, total, firma),
            "total": total, "sin_correo": not para, "sin_celular": not celular}


@router.post("/cliente/{nit}/enviar")
def enviar_cartera(nit: str, datos: EnviarCarteraIn | None = None,
                   session: Session = Depends(get_session),
                   u: Usuario = Depends(require_perm("cartera.editar"))):
    """Envía el estado de cuenta en PDF por correo (Graph DELEGADO: sale del
    propio correo del responsable). Registra una nota en la gestión del cliente."""
    from datetime import datetime
    from ..graph_delegado import enviar as graph_enviar, refrescar
    from ..cuenta_cobro import html_a_pdf
    from ..security import decrypt, encrypt
    _nit_visible(session, u, nit)
    datos = datos or EnviarCarteraIn()
    cli, nombre, docs, total = _datos_envio(session, nit)
    if not docs:
        raise HTTPException(400, "El cliente no tiene cartera pendiente para enviar.")
    para = (datos.para or "").strip() or ((cli.email or "").strip() if cli else "")
    if not para:
        raise HTTPException(400, "El cliente no tiene correo registrado.")

    usr = session.get(Usuario, u.id)
    if not usr or not usr.correo_token_enc:
        raise HTTPException(400, "Conecta tu correo de Microsoft 365 primero (Configuración → Mi correo).")
    try:
        tokens = refrescar(decrypt(usr.correo_token_enc))
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Tu sesión de correo expiró; reconéctala en Configuración → Mi correo.")
    if tokens.get("refresh_token"):
        usr.correo_token_enc = encrypt(tokens["refresh_token"])
        session.add(usr); session.commit()

    asunto = (datos.asunto or f"Estado de cuenta - {nombre or nit}").strip()
    cuerpo = datos.cuerpo if datos.cuerpo is not None else ""
    pdf = html_a_pdf(_estado_cuenta_html(session, nombre, nit, docs, total))
    nombre_pdf = f"Estado de cuenta {nombre or nit}.pdf".replace("/", "-")
    try:
        graph_enviar(tokens["access_token"], destinatario=para, asunto=asunto, cuerpo=cuerpo,
                     cc=[c.strip() for c in (datos.cc or "").split(",") if c.strip()],
                     cco=[c.strip() for c in (datos.cco or "").split(",") if c.strip()],
                     adjuntos=[(nombre_pdf, pdf)])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo enviar: {e}")

    # Deja constancia en el historial de gestión del cliente.
    session.add(CxcNota(nit=nit, fecha=datetime.utcnow(),
                        usuario=u.nombre or u.usuario or "",
                        texto=f"Estado de cuenta enviado por correo a {para}.", estado=""))
    session.commit()
    return {"ok": True, "para": para}


@router.get("/cliente/{nit}/gestion")
def ver_gestion(nit: str, session: Session = Depends(get_session),
                u: Usuario = Depends(require_perm("cartera.ver"))):
    """Estado de gestión + historial de notas de un cliente."""
    _nit_visible(session, u, nit)
    d = _digitos(nit)
    g = session.exec(select(CxcGestion).where(CxcGestion.nit == nit)).first()
    if not g:  # tolerar NIT con/sin DV
        g = next((x for x in session.exec(select(CxcGestion)).all() if _digitos(x.nit) == d), None)
    notas = [n for n in session.exec(select(CxcNota).order_by(CxcNota.fecha.desc())).all()
             if _digitos(n.nit) == d]
    return {
        "nit": nit,
        "estado": g.estado if g else "sin_gestion",
        "compromiso_fecha": g.compromiso_fecha.isoformat() if g and g.compromiso_fecha else None,
        "compromiso_valor": float(g.compromiso_valor) if g and g.compromiso_valor is not None else None,
        "proximo_contacto": g.proximo_contacto.isoformat() if g and g.proximo_contacto else None,
        "actualizado_at": g.actualizado_at.isoformat() if g else None,
        "actualizado_por": g.actualizado_por if g else "",
        "notas": [{"fecha": n.fecha.isoformat(), "usuario": n.usuario,
                   "texto": n.texto, "estado": n.estado} for n in notas],
    }


class GestionIn(BaseModel):
    estado: Optional[str] = None
    compromiso_fecha: Optional[str] = None
    compromiso_valor: Optional[float] = None
    proximo_contacto: Optional[str] = None
    nota: Optional[str] = None


def _pdate(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


@router.post("/cliente/{nit}/gestion")
def guardar_gestion(nit: str, datos: GestionIn,
                    session: Session = Depends(get_session),
                    u: Usuario = Depends(require_perm("cartera.editar"))):
    """Actualiza el estado/compromiso del cliente y, si viene nota, la agrega al
    historial."""
    _nit_visible(session, u, nit)
    d = _digitos(nit)
    g = session.exec(select(CxcGestion).where(CxcGestion.nit == nit)).first()
    if not g:
        g = next((x for x in session.exec(select(CxcGestion)).all() if _digitos(x.nit) == d), None)
    if not g:
        g = CxcGestion(nit=nit)
    if datos.estado is not None:
        if datos.estado not in ESTADOS:
            raise HTTPException(400, f"Estado inválido: {datos.estado}")
        g.estado = datos.estado
    g.compromiso_fecha = _pdate(datos.compromiso_fecha)
    g.compromiso_valor = _dec(datos.compromiso_valor) if datos.compromiso_valor is not None else None
    g.proximo_contacto = _pdate(datos.proximo_contacto)
    g.actualizado_at = datetime.utcnow()
    g.actualizado_por = u.nombre or u.usuario or ""
    session.add(g)
    if (datos.nota or "").strip():
        session.add(CxcNota(nit=nit, usuario=g.actualizado_por,
                            texto=datos.nota.strip(), estado=g.estado))
    session.commit()
    return {"ok": True}


@router.post("/sincronizar")
def sincronizar(session: Session = Depends(get_session),
                u: Usuario = Depends(require_perm("cartera.sincronizar"))):
    """Trae la cartera abierta de GLERP y reemplaza la foto local. Calcula la edad
    de cada documento contra HOY y guarda un resumen de la corrida (histórico)."""
    if not glerp_configurado():
        raise HTTPException(400, "GLERP no está configurado en el servidor (.env).")
    try:
        filas = glerp.leer_cartera()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo leer GLERP: {e}")
    hoy = date.today()
    session.exec(delete(CxcItem))
    por_bucket = {b: 0.0 for b in _BUCKETS}
    nits: set[str] = set()
    total = 0.0
    now = datetime.utcnow()
    for f in filas:
        fec = f["fecfac"]
        venc = None
        if fec:
            venc = fec + timedelta(days=int(f["venfac"] or 0))
        dias, bucket = glerp.bucket_de(venc, hoy)
        saldo = f["saldo"]
        session.add(CxcItem(
            documento=f["documento"], tipodoc=f["tipodoc"], nit=f["nit"],
            nombre=f["nombre"], codcli=f["codcli"], fecfac=fec,
            venfac=int(f["venfac"] or 0), vencimiento=venc,
            vlrfac=_dec(f["vlrfac"]) if f["vlrfac"] is not None else None,
            saldo=_dec(saldo) if saldo is not None else None,
            dias_venc=dias, bucket=bucket, fetched_at=now))
        total += float(saldo or 0)
        por_bucket[bucket] += float(saldo or 0)
        if f["nit"]:
            nits.add(_digitos(f["nit"]))
    session.add(CxcSync(
        fecha=now, docs=len(filas), clientes=len(nits), total=_dec(total),
        corriente=_dec(por_bucket["corriente"]), d1_30=_dec(por_bucket["1-30"]),
        d31_60=_dec(por_bucket["31-60"]), d61_90=_dec(por_bucket["61-90"]),
        d90mas=_dec(por_bucket["90+"]), por=u.nombre or u.usuario or ""))
    session.commit()
    return {"ok": True, "docs": len(filas), "clientes": len(nits),
            "total": round(total, 2), "sincronizado_at": now.isoformat()}
