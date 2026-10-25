"""CRUD de Responsables (tabla ``usuario``: internos con login y externos)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlmodel import Session, select

from ..db import get_session
from ..deps import ADMIN_PERMISOS, get_current_user, require_perm
from ..models import Cliente, Rol, RolPermiso, Usuario, UsuarioFormulario
from ..schemas import ResponsableCreate, ResponsableRead, ResponsableUpdate
from ..security import decrypt, encrypt, hash_password

router = APIRouter(prefix="/api/responsables", tags=["responsables"])

# ADMIN_PERMISOS (regla de rol "admin") vive en deps.py (fuente única); se re-exporta
# aquí por compatibilidad de imports (p.ej. la prueba de regresión).


def _read(u: Usuario) -> ResponsableRead:
    return ResponsableRead.model_validate(u, from_attributes=True)


def _sync_rol(session: Session, u: Usuario) -> None:
    """Deriva el ``rol`` de texto (compat: super/admin/usuario) desde el rol RBAC
    asignado, para que ``esSuper``/``esAdmin`` y los ``require_admin/superadmin``
    sigan coherentes mientras se completa la Fase 2b."""
    if not u.rol_id:
        return
    rol = session.get(Rol, u.rol_id)
    if not rol:
        return
    if rol.sistema:
        u.rol = "superadmin"
        return
    claves = set(session.exec(
        select(RolPermiso.permiso_clave).where(RolPermiso.rol_id == rol.id)).all())
    # Regla ESTRICTA (2026-10-25): "admin" = permisos que solo tienen los roles de
    # GESTIÓN de la firma (Coordinador/Administrador), NO un rol operativo que
    # casualmente cree/edite datos (p.ej. Contador crea declaraciones y NO es admin).
    # La regla laxa anterior (cualquier .crear/.editar/.eliminar → admin) promovía
    # al Contador a 'admin' en la siguiente edición → le daba acceso a TODOS los
    # clientes y a las claves de portal DIAN en otras apps. Contrato cross-app: el
    # texto ('superadmin'/'admin'/'usuario', minúsculas) lo leen LITERAL Calendario,
    # Liquidador y Descargas DIAN para autorizar; esta misma regla debe quedar en la
    # futura vista de permisos efectivos. Ver ADMIN_PERMISOS.
    admin_like = bool(claves & ADMIN_PERMISOS)
    u.rol = "admin" if admin_like else "usuario"


@router.get("", response_model=list[ResponsableRead])
def listar(session: Session = Depends(get_session), _u=Depends(get_current_user)):
    return [_read(u) for u in session.exec(select(Usuario)).all()]


@router.post("", response_model=ResponsableRead, status_code=201)
def crear(data: ResponsableCreate, session: Session = Depends(get_session),
          _admin=Depends(require_perm("responsables.crear"))):
    if data.usuario:
        if session.exec(select(Usuario).where(Usuario.usuario == data.usuario)).first():
            raise HTTPException(409, "Ya existe un usuario con ese login")
    u = Usuario(**data.model_dump(exclude={"password"}))
    u.usuario = data.usuario or None      # externos sin login → NULL
    if data.password:
        u.password_hash = hash_password(data.password)
        u.password_enc = encrypt(data.password)   # reversible: para que el superusuario la vea
    _sync_rol(session, u)
    session.add(u)
    session.commit()
    session.refresh(u)
    return _read(u)


@router.put("/{uid}", response_model=ResponsableRead)
def actualizar(uid: int, data: ResponsableUpdate, session: Session = Depends(get_session),
               _admin=Depends(require_perm("responsables.editar"))):
    u = session.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Responsable no encontrado")
    campos = data.model_dump(exclude_unset=True, exclude={"password"})
    if "usuario" in campos:
        nuevo = campos["usuario"] or None
        if nuevo:
            choque = session.exec(select(Usuario).where(Usuario.usuario == nuevo)).first()
            if choque and choque.id != uid:
                raise HTTPException(409, "Ya existe otro usuario con ese login")
        campos["usuario"] = nuevo
    for k, v in campos.items():
        setattr(u, k, v)
    _sync_rol(session, u)   # rol (compat) derivado del rol_id asignado
    if data.password:
        u.password_hash = hash_password(data.password)
        u.password_enc = encrypt(data.password)   # reversible: para que el superusuario la vea
        u.debe_cambiar = True
    session.add(u)
    session.commit()
    session.refresh(u)
    return _read(u)


@router.get("/{uid}/password")
def ver_password(uid: int, session: Session = Depends(get_session),
                 _su=Depends(require_perm("config.roles"))):
    """Devuelve la clave de login en claro (solo superusuario). Vacío si se
    definió antes de habilitar el guardado reversible → hay que volver a fijarla."""
    u = session.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Responsable no encontrado")
    try:
        clave = decrypt(u.password_enc) if u.password_enc else ""
    except Exception:  # noqa: BLE001 — token inválido / clave rotada
        clave = ""
    return {"password": clave}


# Campos de ``cliente`` que apuntan a un responsable (usuario.id). Si alguno
# referencia al usuario a borrar, se bloquea: hay que reasignar primero.
_ROLES_CLIENTE: list[tuple[str, str]] = [
    ("responsable_impuestos_id", "Responsable de Impuestos"),
    ("coordinador_impuestos_id", "Coordinador de Impuestos"),
    ("responsable_financiero_id", "Responsable Financiero"),
    ("coordinador_financiero_id", "Coordinador Financiero"),
    ("responsable_registro_id", "Responsable del Registro"),
    ("firma_contador_id", "Firma Contador"),
    ("firma_revisor_id", "Firma Revisor"),
]


@router.delete("/{uid}", status_code=204)
def borrar(uid: int, session: Session = Depends(get_session), admin=Depends(require_perm("responsables.eliminar"))):
    u = session.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Responsable no encontrado")
    if u.id == admin.id:
        raise HTTPException(400, "No puedes eliminar tu propio usuario")
    # Validar referencias: ¿está asignado a algún cliente (en cualquier rol)?
    cond = [getattr(Cliente, campo) == uid for campo, _ in _ROLES_CLIENTE]
    clientes = session.exec(select(Cliente).where(or_(*cond))).all()
    if clientes:
        roles = sorted({lbl for campo, lbl in _ROLES_CLIENTE
                        for c in clientes if getattr(c, campo) == uid})
        n = len(clientes)
        raise HTTPException(409, f"No se puede eliminar: {u.nombre} está asignado a "
                                 f"{n} cliente{'s' if n != 1 else ''} como {', '.join(roles)}. "
                                 "Reasigna esos clientes antes de eliminar.")
    # Sin referencias duras: limpiar sus autorizaciones (permisos propios) y borrar.
    for uf in session.exec(select(UsuarioFormulario).where(UsuarioFormulario.usuario_id == uid)).all():
        session.delete(uf)
    session.delete(u)
    session.commit()
