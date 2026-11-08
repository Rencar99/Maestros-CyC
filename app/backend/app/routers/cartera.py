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
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from .. import glerp
from ..config import glerp_configurado
from ..db import get_session
from ..deps import permisos_de, require_perm
from ..models import Cliente, CxcAccion, CxcGestion, CxcItem, CxcNota, CxcSync, Usuario
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


def _mapa_grupo(session: Session) -> dict[str, str]:
    """NIT (solo dígitos) → grupo económico (``cliente.grupo``)."""
    m: dict[str, str] = {}
    for num_id, grupo in session.exec(select(Cliente.num_id, Cliente.grupo)).all():
        k = _digitos(num_id)
        if k and (grupo or "").strip():
            m[k] = grupo.strip()
    return m


def _resolver_grupo(nit: str, mapa: dict[str, str]) -> str:
    g = _digitos(nit)
    if not g:
        return ""
    return mapa.get(g) or (mapa.get(g[:-1]) if len(g) > 1 else "") or ""


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
    grupos = _mapa_grupo(session)
    hoy = date.today()
    # Gestión por NIT (dígitos) para empalmar.
    gest = {_digitos(g.nit): g for g in session.exec(select(CxcGestion)).all()}
    # Última anotación por NIT → "días sin gestión" (semáforo de prioridad).
    ult_nota: dict[str, date] = {}
    for nit_, fecha_ in session.exec(select(CxcNota.nit, CxcNota.fecha)).all():
        d = _digitos(nit_)
        f = fecha_.date() if isinstance(fecha_, datetime) else fecha_
        if d and f and (d not in ult_nota or f > ult_nota[d]):
            ult_nota[d] = f
    # Próxima acción pendiente por NIT (agenda de cobro, alcance cliente).
    acc_prox: dict[str, dict] = {}
    for a in session.exec(select(CxcAccion).where(CxcAccion.estado == "pendiente")).all():
        if a.alcance != "cliente" or not a.fecha_programada:
            continue
        d = _digitos(a.nit)
        cur = acc_prox.get(d)
        if d and (cur is None or a.fecha_programada < cur["_f"]):
            acc_prox[d] = {"_f": a.fecha_programada, "id": a.id, "tipo": a.tipo,
                           "fecha": a.fecha_programada.isoformat()}
    por_nit: dict[str, dict] = {}
    for it in items:
        k = _digitos(it.nit) or ("__" + it.codcli)
        g = por_nit.get(k)
        if not g:
            r = _resolver(it.nit, mapa)
            g = por_nit[k] = {
                "nit": it.nit, "nombre": it.nombre, "cliente_id": r[0] if r else None,
                "docs": 0, "saldo": 0.0, "dias_max": -99999, "bucket": "corriente",
                "fec_ant": None, "doc_ant": "", "unico_doc": "", "unico_td": "",
            }
        g["docs"] += 1
        g["unico_doc"] = it.documento      # si el cliente tiene 1 solo doc, queda este
        g["unico_td"] = it.tipodoc or ""
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
        dk = _digitos(g["nit"])
        ge = gest.get(dk)
        estado_g = ge.estado if ge else "sin_gestion"
        bucket = g["bucket"]
        dmax = g["dias_max"] if g["dias_max"] > -99999 else 0
        un = ult_nota.get(dk)
        dsg = (hoy - un).days if un else None
        # Semáforo de prioridad (riesgo): edad + días sin gestión + estado.
        if estado_g == "al_dia" or (bucket == "corriente" and dmax <= 0):
            riesgo = "baja"
        elif bucket in ("61-90", "90+"):
            riesgo = "alta"
        elif estado_g == "sin_gestion" and dmax > 0:
            riesgo = "alta"
        elif dsg is not None and dsg >= 20 and dmax > 0:
            riesgo = "alta"
        else:
            riesgo = "media"
        pa = acc_prox.get(dk)
        filas.append({
            "nit": g["nit"], "nombre": g["nombre"], "cliente_id": g["cliente_id"],
            "grupo": _resolver_grupo(g["nit"], grupos),
            "docs": g["docs"], "saldo": round(g["saldo"], 2),
            "dias_max": dmax, "bucket": bucket,
            "fecha_antigua": g["fec_ant"].isoformat() if g["fec_ant"] else None,
            "doc_antiguo": g["doc_ant"],
            "estado": estado_g,
            "compromiso_fecha": ge.compromiso_fecha.isoformat() if ge and ge.compromiso_fecha else None,
            "proximo_contacto": ge.proximo_contacto.isoformat() if ge and ge.proximo_contacto else None,
            "riesgo": riesgo, "dias_sin_gestion": dsg,
            "prox_accion": {"id": pa["id"], "tipo": pa["tipo"], "fecha": pa["fecha"]} if pa else None,
            # Si el cliente tiene UNA sola factura (FR), su número → acceso directo al PDF.
            "factura_unica": g["unico_doc"] if (g["docs"] == 1 and g["unico_td"] == "FR") else None,
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
    grupos = _mapa_grupo(session)
    docs = [{
        "nit": it.nit, "nombre": it.nombre, "documento": it.documento, "tipodoc": it.tipodoc,
        "grupo": _resolver_grupo(it.nit, grupos),
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


def _pesos(v) -> str:
    return "$ " + f"{int(round(float(v or 0))):,}".replace(",", ".")


def _fmt_fecha(iso: Optional[str]) -> str:
    """Fecha para mostrar: se deja en AAAA-MM-DD (regla de la firma)."""
    return iso or ""


def _pie_html(pie: dict) -> str:
    """Pie de correo corporativo (navy) a partir de los datos configurables
    (Configuración → Pie de correo). Email-safe (tabla + estilos en línea)."""
    from html import escape
    navy, gold = "#092f61", "#f7931e"
    der: list[str] = []
    if pie.get("telefono"):
        der.append(escape(pie["telefono"]))
    if pie.get("correo"):
        c = escape(pie["correo"])
        der.append(f'<a href="mailto:{c}" style="color:#cdd7e6;text-decoration:none;">{c}</a>')
    if pie.get("ciudad"):
        der.append(escape(pie["ciudad"]))
    if pie.get("web"):
        w = pie["web"]; url = w if w.startswith("http") else "https://" + w
        der.append(f'<a href="{escape(url)}" style="color:{gold};text-decoration:none;font-weight:700;">{escape(w)}</a>')
    redes: list[str] = []
    for etq, val in (("Facebook", pie.get("facebook")), ("Instagram", pie.get("instagram"))):
        if val:
            u = val if val.startswith("http") else "https://" + val
            redes.append(f'<a href="{escape(u)}" style="color:#cdd7e6;text-decoration:none;">{etq}</a>')
    if redes:
        der.append(" · ".join(redes))
    quien = ""
    if pie.get("nombre"):
        quien = (f'<div style="font-size:12px;color:#eaf0f8;font-weight:700;margin-top:6px;">{escape(pie["nombre"])}</div>'
                 f'<div style="font-size:11px;color:#b9c4d6;">{escape(pie.get("cargo") or "")}</div>')
    return f"""
  <tr><td style="padding:18px 22px;background:{navy};color:#dfe6f1;">
    <table role="presentation" width="100%"><tr>
      <td style="font-size:16px;font-weight:800;color:#fff;vertical-align:top;">Cardona &amp; co.
        <div style="font-size:10px;font-weight:600;color:{gold};letter-spacing:.6px;margin:2px 0 0;">TAX · ACCOUNTING · FINANCIAL ANALYTICS</div>
        {quien}
      </td>
      <td align="right" style="font-size:11.5px;color:#cdd7e6;line-height:1.75;vertical-align:top;">{"<br>".join(der)}</td>
    </tr></table>
    <div style="border-top:1px solid #1d3d6b;margin-top:12px;padding-top:9px;font-size:9.5px;color:#8ea0bd;line-height:1.4;">{escape(pie.get("legal") or "")}</div>
  </td></tr>"""


def _estado_cuenta_correo_html(session: Session, nombre: str, nit: str,
                               docs: list[dict], total: float, intro: str) -> str:
    """Cuerpo HTML del correo de estado de cuenta: saludo editable + tabla de
    documentos embebida + línea de pago + pie corporativo. Email-safe: todo con
    tablas y estilos en línea (Gmail/Outlook ignoran <style> y flexbox)."""
    from html import escape
    from .parametros import _cobro, _pie_correo
    navy, gold, rojo, verde, gris, linea = "#092f61", "#f7931e", "#c0392b", "#2e7d32", "#6b7280", "#e2e6ec"
    pago = _cobro(session)
    pie = _pie_correo(session)
    firma = pago.get("titular") or "Cardona & Cardona Consultores S.A.S"
    fechas = [d.get("fecfac") for d in docs if d.get("fecfac")]
    mas_ant = _fmt_fecha(min(fechas)) if fechas else ""
    filas = []
    for i, d in enumerate(docs):
        bg = "#ffffff" if i % 2 == 0 else "#f6f8fc"
        vdos = d.get("dias_venc") or 0
        venc = vdos > 0
        est_col = rojo if venc else verde
        edad = _BUCKET_LBL.get(d.get("bucket"), d.get("bucket") or "")
        celdas = [
            (escape(str(d.get("documento") or "")), "left", ""),
            (_fmt_fecha(d.get("fecfac")), "center", ""),
            (_fmt_fecha(d.get("vencimiento")), "center", ""),
            (str(d.get("venfac") or ""), "center", ""),
            (_pesos(d.get("saldo")), "right", "font-weight:700;"),
            (str(vdos) if venc else "—", "center", ""),
            (escape(edad), "center", ""),
            ("Vencida" if venc else "Al día", "center", f"color:{est_col};font-weight:700;"),
        ]
        tds = "".join(
            f'<td style="padding:7px 9px;border-bottom:1px solid {linea};'
            f'text-align:{al};font-size:12px;color:#2b2f36;{extra}">{txt}</td>'
            for txt, al, extra in celdas)
        filas.append(f'<tr style="background:{bg};">{tds}</tr>')
    cuerpo_filas = "".join(filas) or (
        '<tr><td colspan="8" style="padding:14px 9px;color:#8a94a3;text-align:center;">Sin documentos pendientes.</td></tr>')
    ths = ["Documento", "Fecha", "Vence", "Plazo", "Saldo actual", "Días venc.", "Edad", "Estado"]
    th_html = "".join(
        f'<th style="padding:8px 9px;text-align:{"left" if k==0 else "center"};'
        f'background:{navy};color:#fff;font-size:10.5px;text-transform:uppercase;'
        f'letter-spacing:.3px;font-weight:700;white-space:nowrap;">{t}</th>'
        for k, t in enumerate(ths))
    intro_html = "".join(
        f'<p style="margin:0 0 10px;font-size:13px;color:#3b4654;line-height:1.55;">{escape(p)}</p>'
        for p in (intro or "").split("\n") if p.strip())
    nit_firma = escape(pie.get("nit") or "")
    return f"""<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#eef1f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:18px 0;">
<tr><td align="left" style="padding-left:18px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:680px;background:#fff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="background:{navy};padding:16px 22px;">
    <table role="presentation" width="100%"><tr>
      <td style="font-size:17px;font-weight:800;color:#fff;letter-spacing:.3px;">{escape(firma)}
        <span style="color:{gold};">&bull;</span>
        <span style="font-weight:600;font-size:13px;color:#cdd7e6;">Estado de cuenta de cartera</span></td>
      <td align="right" style="font-size:11.5px;color:#b9c4d6;white-space:nowrap;">
        {('NIT ' + nit_firma + '<br>') if nit_firma else ''}Corte: {escape(date.today().strftime('%d/%m/%Y'))}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 22px 0;">
    <table role="presentation" width="100%" style="border-left:3px solid {gold};">
      <tr><td style="padding:2px 0 2px 10px;font-size:13.5px;color:#2b2f36;"><b>{escape(nombre or '')}</b><br>
        <span style="font-size:12px;color:{gris};">NIT: {escape(nit)}&nbsp;&bull;&nbsp; Factura más antigua: {escape(mas_ant)}</span>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 22px 6px;">{intro_html}</td></tr>
  <tr><td style="padding:4px 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid {linea};">
      <thead><tr>{th_html}</tr></thead>
      <tbody>{cuerpo_filas}</tbody>
      <tfoot><tr>
        <td colspan="4" style="padding:9px;text-align:right;font-weight:700;font-size:12.5px;background:#f1f4f8;border-top:2px solid {navy};">Total adeudado</td>
        <td style="padding:9px;text-align:right;font-weight:800;font-size:13.5px;color:{navy};background:#f1f4f8;border-top:2px solid {navy};">{_pesos(total)}</td>
        <td colspan="3" style="background:#f1f4f8;border-top:2px solid {navy};"></td>
      </tr></tfoot>
    </table>
  </td></tr>
  <tr><td style="padding:16px 22px 0;">
    <table role="presentation" width="100%" style="background:#fafbfc;border:1px solid {linea};border-radius:8px;">
      <tr><td style="padding:12px 15px;font-size:12.5px;color:#44474b;line-height:1.6;">
        <span style="font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:{gris};">Forma de pago</span><br>
        Consignación en la cuenta de <b>{escape(pago.get('tipo_cuenta') or '')} N° {escape(pago.get('numero_cuenta') or '')}</b>
        del banco <b>{escape(pago.get('banco') or '')}</b> a nombre de <b>{escape(firma)}</b>.
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:14px 22px 4px;font-size:11.5px;color:{gris};line-height:1.5;">
    Si ya realizaste el pago, por favor haz caso omiso de este mensaje y envíanos el comprobante. Gracias por tu atención.
  </td></tr>
  {_pie_html(pie)}
</table>
</td></tr></table>
</body></html>"""


_BUCKET_LBL = {"corriente": "Corriente", "1-30": "1–30", "31-60": "31–60",
               "61-90": "61–90", "90+": "+90"}


def _saludo_nombre(cli: Optional[Cliente]) -> str:
    """Nombre para saludar: el PRIMER NOMBRE del contacto de cobro si está definido
    (incluye jurídicas); si no, el primer nombre de la persona natural (el maestro
    guarda apellidos primero). Vacío → se saluda sin nombre."""
    if not cli:
        return ""
    cc = (getattr(cli, "contacto_cobro", "") or "").strip()
    if cc:
        return cc.split()[0].title()
    if getattr(cli, "tipo_contribuyente", "") == "Nat":
        pn = (cli.primer_nombre or "").strip()
        if pn:
            return pn.title()
    return ""


def _wa_tabla(docs: list[dict]) -> str:
    """Tablita monoespaciada (bloque ``` de WhatsApp) con DOS columnas
    documento · saldo, alineadas — angosta a propósito para que NO se parta en
    dos líneas en el celular. El detalle completo (vence, días, edad, estado)
    va por correo. Vacío si no hay docs."""
    filas = [(str(d.get("documento") or ""), _pesos(d.get("saldo"))) for d in docs]
    if not filas:
        return ""
    enc = ("Documento", "Saldo")
    cols = list(zip(*([enc] + filas)))
    w = [max(len(c) for c in col) for col in cols]
    fmt = lambda f: f"{f[0]:<{w[0]}}  {f[1]:>{w[1]}}"
    lineas = [fmt(enc)] + [fmt(f) for f in filas]
    return "```\n" + "\n".join(lineas) + "\n```"


def _wa_texto(session: Session, saludo: str, total: float, cliente: str = "",
              docs: Optional[list[dict]] = None) -> str:
    """Mensaje de WhatsApp (wa.me) a partir de la plantilla configurable
    (Configuración → Mensaje WhatsApp) + los datos de pago + la tabla de facturas.
    El detalle completo va por correo. `saludo` = ', Juan' (natural) o '' (jurídica)."""
    from .parametros import _cobro, _wa
    pago = _cobro(session)
    firma = pago.get("titular") or "Cardona & Cardona Consultores S.A.S"
    vals = {"saludo": saludo, "cliente": cliente, "total": _pesos(total), "firma": firma,
            "banco": pago.get("banco", ""), "tipo_cuenta": pago.get("tipo_cuenta", ""),
            "numero_cuenta": pago.get("numero_cuenta", ""), "titular": firma,
            "tabla": _wa_tabla(docs or [])}

    class _D(dict):
        def __missing__(self, k): return ""
    try:
        return _wa(session).format_map(_D(vals))
    except Exception:  # noqa: BLE001 — plantilla con llaves sueltas: devolver tal cual
        return _wa(session)


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
    """Prefill del modal de envío: correo del cliente, asunto, el saludo editable
    (va arriba de la tabla), celular para WhatsApp y el texto sugerido."""
    _nit_visible(session, u, nit)
    from .parametros import _cobro
    cli, nombre, docs, total = _datos_envio(session, nit)
    firma = _cobro(session).get("titular") or "Cardona & Cardona Consultores S.A.S"
    para = (cli.email or "").strip() if cli else ""
    celular = _digitos((cli.celular_cobro or cli.telefono)) if cli else ""
    saludo = _saludo_nombre(cli)
    wa_saludo = (", " + saludo) if saludo else ""
    asunto = f"Estado de cuenta - {firma}"
    # El "cuerpo" es solo el SALUDO que va arriba de la tabla (el detalle, el total
    # y el pie los arma el correo HTML); por eso ya no se menciona ningún adjunto.
    cuerpo = (f"Cordial saludo{(' ' + saludo) if saludo else ''},\n\n"
              f"A continuación encontrará el estado de su cartera pendiente con nosotros, "
              f"por un total de {_pesos(total)} a la fecha. Agradecemos su atención y "
              f"quedamos atentos a cualquier inquietud.")
    return {"para": para, "asunto": asunto, "cuerpo": cuerpo,
            "celular": celular, "wa_texto": _wa_texto(session, wa_saludo, total, nombre, docs),
            "total": total, "sin_correo": not para, "sin_celular": not celular}


@router.post("/cliente/{nit}/enviar")
def enviar_cartera(nit: str, datos: EnviarCarteraIn | None = None,
                   session: Session = Depends(get_session),
                   u: Usuario = Depends(require_perm("cartera.editar"))):
    """Envía el estado de cuenta por correo con la tabla embebida en el cuerpo
    (HTML) y el pie corporativo — sin adjuntar PDF. Graph DELEGADO: sale del
    propio correo del responsable. Registra una nota en la gestión del cliente."""
    from datetime import datetime
    from ..graph_delegado import enviar as graph_enviar, refrescar
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
    intro = datos.cuerpo if datos.cuerpo is not None else ""
    cuerpo = _estado_cuenta_correo_html(session, nombre, nit, docs, total, intro)
    try:
        graph_enviar(tokens["access_token"], destinatario=para, asunto=asunto, cuerpo=cuerpo,
                     cc=[c.strip() for c in (datos.cc or "").split(",") if c.strip()],
                     cco=[c.strip() for c in (datos.cco or "").split(",") if c.strip()],
                     html=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo enviar: {e}")

    # Deja constancia en el historial de gestión del cliente.
    session.add(CxcNota(nit=nit, fecha=datetime.utcnow(),
                        usuario=u.nombre or u.usuario or "",
                        texto=f"Estado de cuenta enviado por correo a {para}.", estado="", tipo="correo"))
    session.commit()
    return {"ok": True, "para": para}


class WaEnviadoIn(BaseModel):
    celular: Optional[str] = None


@router.post("/cliente/{nit}/wa-enviado")
def wa_enviado(nit: str, datos: WaEnviadoIn | None = None,
               session: Session = Depends(get_session),
               u: Usuario = Depends(require_perm("cartera.editar"))):
    """Deja constancia en el historial de gestión de que se envió el estado de
    cuenta por WhatsApp (se abre wa.me con el mensaje; el envío final lo da la
    persona, por eso el registro es al abrir)."""
    _nit_visible(session, u, nit)
    datos = datos or WaEnviadoIn()
    cel = (datos.celular or "").strip()
    texto = f"Estado de cuenta enviado por WhatsApp{(' al ' + cel) if cel else ''}."
    session.add(CxcNota(nit=nit, fecha=datetime.utcnow(),
                        usuario=u.nombre or u.usuario or "", texto=texto, estado="", tipo="whatsapp"))
    session.commit()
    return {"ok": True}


# ============================================================ PDF de la factura
# Carpeta raíz (portable) donde la firma archiva las facturas de venta. La ruta
# real es <raíz>\<año>\Facturas de Venta\<N. Mes>\<CLIENTE> - FEV - CYC<n>.pdf.
# El número GLERP viene con ceros (CYC00003926); el archivo usa el entero (CYC3926).
_FACTURAS_ROOT_DEF = r"%OneDriveCommercial%\Asesorias Externas\C&C"
_MESES_FEV = {1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
              7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"}


def _carpeta_mes_fev(root: Path, fecfac: date) -> Path:
    return root / str(fecfac.year) / "Facturas de Venta" / f"{fecfac.month}. {_MESES_FEV[fecfac.month]}"


def resolver_fev(documento: str, fecfac: Optional[date], root: Path) -> Optional[Path]:
    """Ruta del PDF de la factura de venta, o None. Puro (solo lista nombres, no
    abre archivos): engancha por el número `CYC<n>` (único) dentro de la carpeta
    del mes de la factura. Tolera variantes del nombre cayendo al número solo."""
    if not fecfac:
        return None
    dig = re.sub(r"\D", "", documento or "")
    if not dig:
        return None
    n = str(int(dig))                      # CYC00003926 -> "3926"
    carpeta = _carpeta_mes_fev(root, fecfac)
    if not carpeta.is_dir():
        return None
    hits = list(carpeta.glob(f"* - FEV - CYC{n}.pdf")) or list(carpeta.glob(f"*CYC{n}.pdf"))
    return hits[0] if hits else None


@router.get("/factura-pdf")
def factura_pdf(documento: str, session: Session = Depends(get_session),
                u: Usuario = Depends(require_perm("cartera.ver"))):
    """Sirve el PDF de la factura de venta de un documento de cartera (tipodoc FR),
    resuelto por convención de carpeta/nombre. Se abre embebido (inline). Solo lista
    una carpeta y abre un archivo: no barre el árbol de OneDrive."""
    from fastapi.responses import FileResponse
    from .clientes import _ruta_expandir
    from .parametros import _get as _param_get

    it = session.exec(select(CxcItem).where(CxcItem.documento == documento)).first()
    if not it:
        raise HTTPException(404, "El documento no está en la cartera vigente.")
    if (it.tipodoc or "") != "FR":
        raise HTTPException(400, "Por ahora solo las facturas (FR) tienen visor de PDF.")
    _nit_visible(session, u, it.nit)
    if not it.fecfac:
        raise HTTPException(404, "La factura no tiene fecha; no puedo ubicar su carpeta.")
    root = Path(_ruta_expandir(_param_get(session, "cartera_facturas_root", _FACTURAS_ROOT_DEF)))
    pdf = resolver_fev(it.documento, it.fecfac, root)
    if not pdf:
        carpeta = _carpeta_mes_fev(root, it.fecfac)
        raise HTTPException(404, f"No encontré el PDF de la factura {it.documento}. "
                                 f"Debería estar en:\n{carpeta}")
    return FileResponse(str(pdf), media_type="application/pdf",
                        filename=pdf.name, content_disposition_type="inline")


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
        "notas": [{"id": n.id, "fecha": n.fecha.isoformat(), "usuario": n.usuario,
                   "texto": n.texto, "estado": n.estado, "tipo": n.tipo or "nota"} for n in notas],
    }


@router.delete("/nota/{nid}", status_code=204)
def borrar_nota(nid: int, session: Session = Depends(get_session),
                u: Usuario = Depends(require_perm("cartera.editar"))):
    """Elimina una anotación del historial de gestión (solo quien edita cartera)."""
    n = session.get(CxcNota, nid)
    if not n:
        raise HTTPException(404, "Nota no encontrada")
    _nit_visible(session, u, n.nit)
    session.delete(n)
    session.commit()


_TIPOS_NOTA = {"llamada", "correo", "whatsapp", "visita", "acuerdo", "nota"}


class GestionIn(BaseModel):
    estado: Optional[str] = None
    compromiso_fecha: Optional[str] = None
    compromiso_valor: Optional[float] = None
    proximo_contacto: Optional[str] = None
    nota: Optional[str] = None
    nota_tipo: Optional[str] = None


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
        tipo = datos.nota_tipo if datos.nota_tipo in _TIPOS_NOTA else "nota"
        session.add(CxcNota(nit=nit, usuario=g.actualizado_por,
                            texto=datos.nota.strip(), estado=g.estado, tipo=tipo))
    session.commit()
    return {"ok": True}


# --- Gestión por GRUPO económico (consolidado) -------------------------------
@router.get("/grupo/{grupo}")
def estado_grupo(grupo: str, session: Session = Depends(get_session),
                 u: Usuario = Depends(require_perm("cartera.ver"))):
    """Vista consolidada de un grupo económico: documentos (estado de cuenta) e
    historial de TODAS sus empresas con cartera, más el saldo total del grupo."""
    items, _mapa, _oc = _visibles(session, u)
    grupos = _mapa_grupo(session)
    g = grupo.strip()
    miembros = [it for it in items if _resolver_grupo(it.nit, grupos) == g]
    miembros.sort(key=lambda it: (it.vencimiento or date.max))
    docs = [{
        "nit": it.nit, "empresa": it.nombre,
        "documento": it.documento, "tipodoc": it.tipodoc,
        "fecfac": it.fecfac.isoformat() if it.fecfac else None,
        "vencimiento": it.vencimiento.isoformat() if it.vencimiento else None,
        "venfac": it.venfac, "dias_venc": it.dias_venc, "bucket": it.bucket,
        "vlrfac": float(it.vlrfac) if it.vlrfac is not None else None,
        "saldo": float(it.saldo) if it.saldo is not None else None,
    } for it in miembros]
    total = round(sum(float(it.saldo or 0) for it in miembros), 2)
    emp: dict[str, dict] = {}
    for it in miembros:
        d = _digitos(it.nit)
        e = emp.get(d) or emp.setdefault(d, {"nit": it.nit, "empresa": it.nombre, "saldo": 0.0, "docs": 0})
        e["saldo"] += float(it.saldo or 0)
        e["docs"] += 1
    empresas = sorted(emp.values(), key=lambda x: x["saldo"], reverse=True)
    for e in empresas:
        e["saldo"] = round(e["saldo"], 2)
    nom = {_digitos(it.nit): it.nombre for it in miembros}
    dset = set(nom.keys())
    notas = [n for n in session.exec(select(CxcNota).order_by(CxcNota.fecha.desc())).all()
             if _digitos(n.nit) in dset]
    notas_out = [{"id": n.id, "fecha": n.fecha.isoformat(), "usuario": n.usuario,
                  "texto": n.texto, "estado": n.estado, "tipo": n.tipo or "nota",
                  "empresa": nom.get(_digitos(n.nit), n.nit)} for n in notas]
    return {"grupo": g, "empresas": empresas, "docs": docs, "total": total, "notas": notas_out}


@router.post("/grupo/{grupo}/gestion")
def guardar_gestion_grupo(grupo: str, datos: GestionIn,
                          session: Session = Depends(get_session),
                          u: Usuario = Depends(require_perm("cartera.editar"))):
    """Aplica una gestión a TODAS las empresas del grupo con cartera: sólo toca
    los campos que vienen (no borra lo individual) y agrega la nota a cada una."""
    items, _mapa, _oc = _visibles(session, u)
    grupos = _mapa_grupo(session)
    g = grupo.strip()
    nits: list[str] = []
    seen: set[str] = set()
    for it in items:
        if _resolver_grupo(it.nit, grupos) == g:
            d = _digitos(it.nit)
            if d not in seen:
                seen.add(d)
                nits.append(it.nit)
    if not nits:
        raise HTTPException(404, "Grupo sin cartera visible")
    estado = None
    if datos.estado is not None:
        if datos.estado not in ESTADOS:
            raise HTTPException(400, f"Estado inválido: {datos.estado}")
        estado = datos.estado
    por = u.nombre or u.usuario or ""
    tipo = datos.nota_tipo if datos.nota_tipo in _TIPOS_NOTA else "nota"
    texto = (datos.nota or "").strip()
    cf = _pdate(datos.compromiso_fecha)
    pc = _pdate(datos.proximo_contacto)
    # Pre-carga de gestiones por dígitos (evita re-consultar en el bucle).
    gmap: dict[str, CxcGestion] = {}
    for x in session.exec(select(CxcGestion)).all():
        gmap.setdefault(_digitos(x.nit), x)
    for nit in nits:
        d = _digitos(nit)
        ge = gmap.get(d) or CxcGestion(nit=nit)
        if estado is not None:
            ge.estado = estado
        if datos.compromiso_fecha is not None:
            ge.compromiso_fecha = cf
            ge.compromiso_valor = _dec(datos.compromiso_valor) if datos.compromiso_valor is not None else None
        if datos.proximo_contacto is not None:
            ge.proximo_contacto = pc
        ge.actualizado_at = datetime.utcnow()
        ge.actualizado_por = por
        session.add(ge)
        if texto:
            session.add(CxcNota(nit=nit, usuario=por, texto=texto,
                                estado=ge.estado, tipo=tipo))
    session.commit()
    return {"ok": True, "empresas": len(nits)}


# --- Agenda de cobro (acciones programadas · CRM) ----------------------------
_PRIORIDADES = {"alta", "media", "baja"}
_TIPOS_ACCION = {"llamada", "correo", "whatsapp", "visita", "otro"}


def _saldos_por_nit(items) -> dict[str, float]:
    """NIT (dígitos) → saldo total, a partir de los items visibles."""
    m: dict[str, float] = {}
    for it in items:
        m[_digitos(it.nit)] = m.get(_digitos(it.nit), 0.0) + float(it.saldo or 0)
    return m


def _nombre_por_nit(items) -> dict[str, str]:
    m: dict[str, str] = {}
    for it in items:
        m.setdefault(_digitos(it.nit), it.nombre)
    return m


def _mapa_gestores(session: Session) -> dict[str, str]:
    """usuario (login) → nombre, de los internos activos con acceso."""
    m: dict[str, str] = {}
    for x in session.exec(select(Usuario).where(Usuario.activo == True)).all():  # noqa: E712
        if x.usuario and x.tipo == "Int":
            m[x.usuario] = x.nombre or x.usuario
    return m


def _nits_grupo(items, grupos: dict[str, str], grupo: str) -> list[str]:
    """NITs (uno por empresa) del grupo con cartera visible."""
    nits: list[str] = []
    seen: set[str] = set()
    g = grupo.strip()
    for it in items:
        if _resolver_grupo(it.nit, grupos) == g:
            d = _digitos(it.nit)
            if d not in seen:
                seen.add(d); nits.append(it.nit)
    return nits


@router.get("/gestores")
def gestores(session: Session = Depends(get_session),
             u: Usuario = Depends(require_perm("cartera.ver"))):
    """Gestores asignables (internos activos con acceso) para la agenda."""
    m = _mapa_gestores(session)
    rows = [{"usuario": k, "nombre": v} for k, v in m.items()]
    rows.sort(key=lambda r: r["nombre"].lower())
    return {"rows": rows}


def _accion_dto(a: CxcAccion, nombres: dict[str, str], saldos: dict[str, float],
                gmap: dict[str, str], hoy: date) -> dict:
    if a.alcance == "grupo":
        objetivo = a.grupo
        saldo = 0.0  # el saldo del grupo se calcula aparte si se requiere
    else:
        d = _digitos(a.nit)
        objetivo = nombres.get(d, a.nit)
        saldo = round(saldos.get(d, 0.0), 2)
    venc = a.estado == "pendiente" and a.fecha_programada < hoy
    dias = (hoy - a.fecha_programada).days if a.fecha_programada else 0
    return {
        "id": a.id, "alcance": a.alcance, "nit": a.nit, "grupo": a.grupo,
        "objetivo": objetivo, "saldo": saldo, "tipo": a.tipo,
        "fecha_programada": a.fecha_programada.isoformat() if a.fecha_programada else None,
        "asignado_a": a.asignado_a, "asignado_nombre": gmap.get(a.asignado_a, a.asignado_a),
        "prioridad": a.prioridad, "instruccion": a.instruccion, "estado": a.estado,
        "creado_por": a.creado_por, "creado_nombre": gmap.get(a.creado_por, a.creado_por),
        "creado_at": a.creado_at.isoformat() if a.creado_at else None,
        "resuelto_por": a.resuelto_por, "resuelto_nombre": gmap.get(a.resuelto_por, a.resuelto_por),
        "resuelto_at": a.resuelto_at.isoformat() if a.resuelto_at else None,
        "resultado": a.resultado, "vencida": venc, "dias": dias,
    }


@router.get("/acciones")
def listar_acciones(scope: str = "mias", estado: str = "pendiente",
                    session: Session = Depends(get_session),
                    u: Usuario = Depends(require_perm("cartera.ver"))):
    """Agenda de acciones de cobro. ``scope``: 'mias' (asignadas a mí) o 'todas'
    (requiere programar; si no, cae a 'mias'). ``estado``: 'pendiente', 'hechas',
    'canceladas' o 'todos'. Oculta acciones de clientes confidenciales no visibles."""
    puede_prog = "cartera.programar" in permisos_de(session, u)
    if scope != "todas" or not puede_prog:
        scope = "mias"
    items, mapa, ocultos = _visibles(session, u)
    grupos = _mapa_grupo(session)
    nombres = _nombre_por_nit(items)
    saldos = _saldos_por_nit(items)
    gmap = _mapa_gestores(session)
    hoy = date.today()

    acciones = session.exec(select(CxcAccion).order_by(CxcAccion.fecha_programada)).all()
    out = []
    for a in acciones:
        if scope == "mias" and a.asignado_a != u.usuario:
            continue
        if estado == "pendiente" and a.estado != "pendiente":
            continue
        if estado == "hechas" and a.estado != "hecha":
            continue
        if estado == "canceladas" and a.estado != "cancelada":
            continue
        # Confidencialidad: ocultar acciones de clientes confidenciales no visibles.
        if a.alcance == "cliente" and ocultos:
            r = _resolver(a.nit, mapa)
            if r and r[0] in ocultos:
                continue
        out.append(_accion_dto(a, nombres, saldos, gmap, hoy))
    # Pendientes: vencidas primero, luego por prioridad y fecha.
    _pri = {"alta": 0, "media": 1, "baja": 2}
    out.sort(key=lambda x: (not x["vencida"], _pri.get(x["prioridad"], 1),
                            x["fecha_programada"] or "9999"))
    return {"rows": out, "scope": scope, "puede_programar": puede_prog}


class AccionIn(BaseModel):
    alcance: Optional[str] = "cliente"
    nit: Optional[str] = None
    grupo: Optional[str] = None
    tipo: Optional[str] = "llamada"
    fecha_programada: Optional[str] = None
    asignado_a: Optional[str] = None
    prioridad: Optional[str] = "media"
    instruccion: Optional[str] = None


def _valida_accion(session: Session, u: Usuario, d: AccionIn) -> CxcAccion:
    alcance = d.alcance if d.alcance in ("cliente", "grupo") else "cliente"
    tipo = d.tipo if d.tipo in _TIPOS_ACCION else "llamada"
    pri = d.prioridad if d.prioridad in _PRIORIDADES else "media"
    fp = _pdate(d.fecha_programada)
    if not fp:
        raise HTTPException(400, "La fecha programada es obligatoria (AAAA-MM-DD).")
    asign = (d.asignado_a or "").strip()
    if not asign or asign not in _mapa_gestores(session):
        raise HTTPException(400, "Asigna la acción a un gestor válido.")
    nit = (d.nit or "").strip()
    grupo = (d.grupo or "").strip()
    if alcance == "cliente":
        if not nit:
            raise HTTPException(400, "Falta el cliente (NIT).")
        _nit_visible(session, u, nit)
        grupo = ""
    else:
        if not grupo:
            raise HTTPException(400, "Falta el grupo económico.")
        nit = ""
    return CxcAccion(alcance=alcance, nit=nit, grupo=grupo, tipo=tipo,
                     fecha_programada=fp, asignado_a=asign, prioridad=pri,
                     instruccion=(d.instruccion or "").strip())


@router.post("/acciones", status_code=201)
def crear_accion(d: AccionIn, session: Session = Depends(get_session),
                 u: Usuario = Depends(require_perm("cartera.programar"))):
    """Programa (y asigna) una acción de cobro. La ejecuta el gestor asignado."""
    a = _valida_accion(session, u, d)
    a.creado_por = u.usuario or u.nombre or ""
    a.creado_at = datetime.utcnow()
    session.add(a); session.commit(); session.refresh(a)
    return {"ok": True, "id": a.id}


class AccionObjetivo(BaseModel):
    alcance: Optional[str] = "cliente"
    nit: Optional[str] = None
    grupo: Optional[str] = None


class AccionLoteIn(BaseModel):
    objetivos: list[AccionObjetivo] = []
    tipo: Optional[str] = "llamada"
    fecha_programada: Optional[str] = None
    asignado_a: Optional[str] = None
    prioridad: Optional[str] = "media"
    instruccion: Optional[str] = None


@router.post("/acciones/lote", status_code=201)
def crear_acciones_lote(d: AccionLoteIn, session: Session = Depends(get_session),
                        u: Usuario = Depends(require_perm("cartera.programar"))):
    """Programa la MISMA acción para VARIOS clientes/grupos a la vez (una acción por
    objetivo). Si algún objetivo es inválido, no crea ninguno (todo o nada)."""
    if not d.objetivos:
        raise HTTPException(400, "Selecciona al menos un cliente o grupo.")
    por = u.usuario or u.nombre or ""
    nuevas: list[CxcAccion] = []
    for o in d.objetivos:
        ai = AccionIn(alcance=o.alcance, nit=o.nit, grupo=o.grupo, tipo=d.tipo,
                      fecha_programada=d.fecha_programada, asignado_a=d.asignado_a,
                      prioridad=d.prioridad, instruccion=d.instruccion)
        a = _valida_accion(session, u, ai)
        a.creado_por = por
        session.add(a); nuevas.append(a)
    session.commit()
    return {"ok": True, "creadas": len(nuevas)}


@router.put("/acciones/{aid}")
def editar_accion(aid: int, d: AccionIn, session: Session = Depends(get_session),
                  u: Usuario = Depends(require_perm("cartera.programar"))):
    """Reasigna / reprograma una acción pendiente (solo mientras esté pendiente)."""
    a = session.get(CxcAccion, aid)
    if not a:
        raise HTTPException(404, "Acción no encontrada")
    if a.estado != "pendiente":
        raise HTTPException(400, "Solo se pueden editar acciones pendientes.")
    nueva = _valida_accion(session, u, d)
    a.alcance = nueva.alcance; a.nit = nueva.nit; a.grupo = nueva.grupo
    a.tipo = nueva.tipo; a.fecha_programada = nueva.fecha_programada
    a.asignado_a = nueva.asignado_a; a.prioridad = nueva.prioridad
    a.instruccion = nueva.instruccion
    session.add(a); session.commit()
    return {"ok": True}


class CerrarAccionIn(BaseModel):
    resultado: Optional[str] = None
    tipo: Optional[str] = None
    # Programar la siguiente acción (opcional): fecha + tipo + instrucción.
    siguiente_fecha: Optional[str] = None
    siguiente_tipo: Optional[str] = None
    siguiente_instruccion: Optional[str] = None


@router.post("/acciones/{aid}/cerrar")
def cerrar_accion(aid: int, d: CerrarAccionIn, session: Session = Depends(get_session),
                  u: Usuario = Depends(require_perm("cartera.editar"))):
    """Ejecuta/cierra una acción: la marca HECHA y deja la traza en el historial de
    gestión (una nota por el cliente, o una por empresa si es de grupo). Puede
    programar de una vez la siguiente acción para el mismo objetivo/gestor."""
    a = session.get(CxcAccion, aid)
    if not a:
        raise HTTPException(404, "Acción no encontrada")
    if a.estado != "pendiente":
        raise HTTPException(400, "La acción ya fue cerrada o cancelada.")
    # La ejecuta su gestor; un supervisor (programar) puede cerrarla por él.
    puede_prog = "cartera.programar" in permisos_de(session, u)
    if a.asignado_a and a.asignado_a != u.usuario and not puede_prog:
        gmap = _mapa_gestores(session)
        raise HTTPException(403, f"Esta acción está asignada a {gmap.get(a.asignado_a, a.asignado_a)}.")

    por = u.nombre or u.usuario or ""
    tipo = d.tipo if d.tipo in _TIPOS_NOTA else (a.tipo if a.tipo in _TIPOS_NOTA else "nota")
    resultado = (d.resultado or "").strip()
    texto = resultado or f"Acción de cobro ejecutada ({a.tipo})."
    if a.instruccion:
        texto = f"{texto}  ·  (Programada: {a.instruccion})"

    # Traza en el Gestor: NITs afectados (el cliente, o todas las empresas del grupo).
    if a.alcance == "grupo":
        items, _mapa, _oc = _visibles(session, u)
        grupos = _mapa_grupo(session)
        nits = _nits_grupo(items, grupos, a.grupo)
    else:
        nits = [a.nit]
    gest = {_digitos(x.nit): x for x in session.exec(select(CxcGestion)).all()}
    for nit in nits:
        if not nit:
            continue
        estado_actual = (gest.get(_digitos(nit)).estado if gest.get(_digitos(nit)) else "")
        session.add(CxcNota(nit=nit, usuario=por, texto=texto, estado=estado_actual, tipo=tipo))

    a.estado = "hecha"; a.resuelto_por = u.usuario or u.nombre or ""
    a.resuelto_at = datetime.utcnow(); a.resultado = resultado
    session.add(a)

    # Siguiente acción (opcional): mismo objetivo y gestor.
    sig_fecha = _pdate(d.siguiente_fecha)
    nueva_id = None
    if sig_fecha:
        st = d.siguiente_tipo if d.siguiente_tipo in _TIPOS_ACCION else "llamada"
        nueva = CxcAccion(alcance=a.alcance, nit=a.nit, grupo=a.grupo, tipo=st,
                          fecha_programada=sig_fecha, asignado_a=a.asignado_a,
                          prioridad=a.prioridad, instruccion=(d.siguiente_instruccion or "").strip(),
                          creado_por=u.usuario or u.nombre or "")
        session.add(nueva)
    session.commit()
    if sig_fecha:
        session.refresh(nueva); nueva_id = nueva.id
    return {"ok": True, "empresas": len(nits), "siguiente_id": nueva_id}


class CancelarAccionIn(BaseModel):
    motivo: Optional[str] = None


@router.post("/acciones/{aid}/cancelar")
def cancelar_accion(aid: int, d: CancelarAccionIn | None = None,
                    session: Session = Depends(get_session),
                    u: Usuario = Depends(require_perm("cartera.programar"))):
    """Cancela una acción pendiente (no deja traza en el historial de cobro)."""
    a = session.get(CxcAccion, aid)
    if not a:
        raise HTTPException(404, "Acción no encontrada")
    if a.estado != "pendiente":
        raise HTTPException(400, "La acción ya fue cerrada o cancelada.")
    d = d or CancelarAccionIn()
    a.estado = "cancelada"; a.resultado = (d.motivo or "").strip()
    a.resuelto_por = u.usuario or u.nombre or ""; a.resuelto_at = datetime.utcnow()
    session.add(a); session.commit()
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
