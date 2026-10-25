"""Reglas de ALCANCE de clientes (transversal a varios routers): qué clientes
ve cada usuario según su asignación, y la confidencialidad.

Vive aparte (no en ``routers.clientes``) para que facturación/consultas no tengan
que importarlo "local anti-ciclo". Fuente única de estas reglas de negocio.
"""
from __future__ import annotations

from sqlalchemy.orm import defer
from sqlmodel import Session, select

from .deps import es_super, permisos_de
from .models import Cliente, Usuario


def cliente_liviano():
    """Opciones de carga para traer clientes SIN las columnas pesadas (``logo``
    data-URI base64, ``objeto_social`` y ``notas``, textos largos). Se usa en los
    listados que no necesitan esos campos: `select(Cliente).options(*cliente_liviano())`.
    No cambia el esquema; solo evita mover megas inútiles en cada listado."""
    return (defer(Cliente.logo), defer(Cliente.objeto_social), defer(Cliente.notas))


def ve_confidencial(session: Session, user: Usuario) -> bool:
    """¿Es "supervisor"? (permiso clientes.ver_confidencial; Super siempre). Super
    corta temprano (es_super) para no expandir todo el catálogo de permisos solo
    para comprobar una membresía."""
    if es_super(session, user):
        return True
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


def alcance_de(session: Session, user: Usuario) -> tuple[set[int] | None, set[int]]:
    """``(permitidos, ocultos)`` en UNA sola pasada, para los endpoints que necesitan
    ambos (lo normal). Evita recalcular ``asignados_de`` (lo hacían `ids_asignados` y
    `confid_ocultos` por separado) y corta Super sin expandir el catálogo de permisos.
      · permitidos: ids visibles por asignación; ``None`` = ve TODOS (Admin/Super).
      · ocultos: confidenciales que el usuario NO puede ver (supervisor → ∅)."""
    es_sup = es_super(session, user)
    admin_like = es_sup or user.rol == "admin"
    supervisor = es_sup or ("clientes.ver_confidencial" in permisos_de(session, user))
    asignados = None
    if not admin_like or not supervisor:
        asignados = asignados_de(session, user)  # una sola vez
    permitidos = None if admin_like else asignados
    if supervisor:
        ocultos: set[int] = set()
    else:
        conf = set(session.exec(
            select(Cliente.id).where(Cliente.confidencial == True)).all())  # noqa: E712
        ocultos = conf - (asignados or set())
    return permitidos, ocultos
