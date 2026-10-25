"""Reglas de ALCANCE de clientes (transversal a varios routers): qué clientes
ve cada usuario según su asignación, y la confidencialidad.

Vive aparte (no en ``routers.clientes``) para que facturación/consultas no tengan
que importarlo "local anti-ciclo". Fuente única de estas reglas de negocio.
"""
from __future__ import annotations

from sqlmodel import Session, select

from .deps import permisos_de
from .models import Cliente, Usuario


def ve_confidencial(session: Session, user: Usuario) -> bool:
    """¿Es "supervisor"? (permiso clientes.ver_confidencial; Super siempre)."""
    return "clientes.ver_confidencial" in permisos_de(session, user)


def asignados_de(session: Session, user: Usuario) -> set[int]:
    """Ids de clientes asignados al usuario (responsable/coordinador de impuestos o
    financiero, o responsable del registro). Para CUALQUIER usuario, incl. Admin/Super."""
    return set(session.exec(select(Cliente.id).where(
        (Cliente.responsable_impuestos_id == user.id) |
        (Cliente.coordinador_impuestos_id == user.id) |
        (Cliente.responsable_financiero_id == user.id) |
        (Cliente.coordinador_financiero_id == user.id) |
        (Cliente.responsable_registro_id == user.id))).all())


def confid_ocultos(session: Session, user: Usuario) -> set[int]:
    """Confidenciales que ESTE usuario NO puede ver. Regla: un confidencial se ve si
    eres supervisor (ve_confidencial) O lo tienes asignado. Supervisor → vacío."""
    if ve_confidencial(session, user):
        return set()
    conf = set(session.exec(
        select(Cliente.id).where(Cliente.confidencial == True)).all())  # noqa: E712
    return conf - asignados_de(session, user)


def ids_asignados(session: Session, user: Usuario) -> set[int] | None:
    """Ids de clientes que el usuario puede ver por asignación. None = ve TODOS (Admin/Super)."""
    if user.rol in ("admin", "superadmin"):
        return None
    return asignados_de(session, user)
