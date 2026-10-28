"""Monitoreo de sesiones activas (administradores).

Lista las sesiones activas de los usuarios y permite cerrarlas de forma remota.
Se apoya en la tabla `Sesion`. Mismo patrón que Descargar DIAN.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..deps import require_perm
from ..models import Sesion, Usuario

router = APIRouter(prefix="/api/sesiones", tags=["sesiones"])

# Debe coincidir con el umbral del login (auth.SESION_INACTIVA_MIN).
_INACTIVA_MIN = 5


@router.get("")
def listar(session: Session = Depends(get_session), _=Depends(require_perm("config.roles"))):
    """Sesiones activas: usuario, equipo, inicio, última actividad y si está colgada."""
    limite = datetime.utcnow() - timedelta(minutes=_INACTIVA_MIN)
    ses = session.exec(
        select(Sesion).where(Sesion.activa == True)  # noqa: E712
    ).all()
    ses.sort(key=lambda s: s.ultima_actividad or s.creado_at, reverse=True)
    # Las fechas se guardan en UTC (naive); se etiquetan como UTC para que el
    # frontend las muestre en la hora local del equipo.
    utc = lambda d: (d.replace(tzinfo=timezone.utc).isoformat() if d else None)  # noqa: E731
    out = []
    for s in ses:
        u = session.get(Usuario, s.usuario_id)
        out.append({
            "id": s.id,
            "usuario": u.nombre if u else "—",
            "usuario_login": u.usuario if u else "",
            "equipo": s.equipo or "—",
            "inicio": utc(s.creado_at),
            "ultima_actividad": utc(s.ultima_actividad),
            "colgada": bool(s.ultima_actividad and s.ultima_actividad <= limite),
        })
    return out


@router.delete("/{sid}")
def cerrar(sid: int, session: Session = Depends(get_session),
           _=Depends(require_perm("config.roles"))):
    """Cierra (revoca) una sesión: el equipo queda deslogueado en su próxima acción."""
    s = session.get(Sesion, sid)
    if not s:
        raise HTTPException(404, "La sesión no existe")
    s.activa = False
    session.add(s)
    session.commit()
    return {"ok": True}
