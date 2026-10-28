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
