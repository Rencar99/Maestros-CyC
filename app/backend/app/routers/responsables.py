"""CRUD de Responsables (tabla ``usuario``: internos con login y externos)."""
from __future__ import annotations

import html as _html
import os
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from ..concurrency import exigir_sin_conflicto
from ..db import get_session
from ..deps import ADMIN_PERMISOS, get_current_user, require_perm
from ..models import (Cliente, ReasignacionCorreo, ReasignacionItem, ReasignacionLote,
                      Rol, RolPermiso, Usuario, UsuarioFormulario)
from ..schemas import ResponsableCreate, ResponsableRead, ResponsableUpdate
from ..scope import cliente_liviano, confid_ocultos
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


@router.get("/{uid:int}", response_model=ResponsableRead)
def obtener(uid: int, session: Session = Depends(get_session),
            _u=Depends(get_current_user)):
    """Un responsable por id (para recargar la ficha ante un conflicto de edición)."""
    u = session.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Responsable no encontrado")
    return _read(u)


@router.put("/{uid:int}", response_model=ResponsableRead)
def actualizar(uid: int, data: ResponsableUpdate, base: Optional[str] = None,
               session: Session = Depends(get_session),
               admin: Usuario = Depends(require_perm("responsables.editar"))):
    u = session.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Responsable no encontrado")
    # Concurrencia optimista: si otra persona guardó mientras editabas → 409.
    exigir_sin_conflicto(base, u.actualizado_at, u.nombre, u.actualizado_por)
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
    u.actualizado_at = datetime.utcnow()
    u.actualizado_por = admin.usuario or admin.nombre
    session.add(u)
    session.commit()
    session.refresh(u)
    return _read(u)


@router.get("/{uid:int}/password")
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


@router.delete("/{uid:int}", status_code=204)
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


# ============================================================ Reasignación / Suplencias
# Reasignar en lote los clientes de un responsable que sale (vacaciones o traspaso).
# Solo los 5 roles de GESTIÓN; las firmas (contador/revisor) son firmantes legales y
# NO se tocan aquí. Cambia el FK directo (las demás apps ven al reemplazo al instante)
# y guarda un lote REVERSIBLE con el valor anterior de cada cliente+rol.
_ROLES_GESTION = _ROLES_CLIENTE[:5]
_ROLES_GESTION_SET = {campo for campo, _ in _ROLES_GESTION}
_LBL_ROL = dict(_ROLES_CLIENTE)


@router.get("/{uid:int}/clientes")
def clientes_de_saliente(uid: int, session: Session = Depends(get_session),
                         admin: Usuario = Depends(require_perm("responsables.reasignar"))):
    """Asignaciones de gestión del saliente, UNA FILA por (cliente, rol), para repartir
    sus clientes en la grilla (uno a uno o por bloques). Lista TODOS (confidenciales
    incluidos) para no dejar a nadie descubierto, pero enmascara el NOMBRE del cliente
    cuando el operador no puede ver ese confidencial (la fila sigue siendo reasignable).
    Las firmas (contador/revisor) son firmantes legales: no se reparten aquí."""
    u = session.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Responsable no encontrado")
    ocultos = confid_ocultos(session, admin)
    rows = []
    for campo, lbl in _ROLES_GESTION:
        for c in session.exec(select(Cliente).options(*cliente_liviano())
                              .where(getattr(Cliente, campo) == uid)).all():
            oculto = c.id in ocultos
            rows.append({
                "cliente_id": c.id, "rol": campo, "rol_label": lbl,
                "confidencial": bool(c.confidencial), "oculto": oculto,
                "grupo": "" if oculto else (c.grupo or ""),
                "nombre": "Cliente confidencial" if oculto
                          else (c.razon_social or c.nombre or c.num_id or f"#{c.id}"),
            })
    rows.sort(key=lambda r: (r["rol_label"], (r["grupo"] or "~").lower(), r["nombre"].lower()))
    return {"saliente_id": uid, "nombre": u.nombre, "rows": rows}


class _ItemIn(BaseModel):
    cliente_id: int
    rol: str
    a_id: int


class ReasignarIn(BaseModel):
    saliente_id: int
    tipo: str = "vacaciones"            # "vacaciones" | "definitiva"
    fecha_retorno: Optional[date] = None
    nota: str = ""
    items: list[_ItemIn] = []


@router.post("/reasignar")
def reasignar(data: ReasignarIn, session: Session = Depends(get_session),
              admin: Usuario = Depends(require_perm("responsables.reasignar"))):
    """Reparte los clientes elegidos (uno a uno o por bloques). Cada ``item`` mueve UN
    cliente en UN rol del saliente a un reemplazo; distintos items pueden ir a distintas
    personas. El servidor es DUEÑO del valor anterior (``de_id`` = saliente): nunca se
    toma del payload. Transacción única, lote reversible, y bombea ``actualizado_at/por``
    de cada cliente (para que una ficha abierta choque con el 409 de concurrencia en vez
    de deshacer el cambio en silencio). Si la grilla quedó OBSOLETA (algún cliente ya no
    está en el saliente para ese rol) se aborta TODO con 409 para no dejar a medias."""
    sal = session.get(Usuario, data.saliente_id)
    if not sal:
        raise HTTPException(404, "El responsable saliente no existe")
    if data.tipo not in ("vacaciones", "definitiva"):
        raise HTTPException(400, "Tipo inválido")
    if not data.items:
        raise HTTPException(400, "No hay clientes seleccionados para reasignar.")
    # 1) Validar payload sin tocar nada: rol de gestión, reemplazo activo ≠ saliente,
    #    y sin (cliente, rol) repetidos.
    reps: dict[int, Usuario] = {}
    vistos: set[tuple[int, str]] = set()
    for it in data.items:
        if it.rol not in _ROLES_GESTION_SET:
            raise HTTPException(400, f"Rol inválido: {it.rol}")
        if it.a_id == data.saliente_id:
            raise HTTPException(400, "El reemplazo no puede ser la misma persona.")
        clave = (it.cliente_id, it.rol)
        if clave in vistos:
            raise HTTPException(400, "Hay un cliente repetido en la selección.")
        vistos.add(clave)
        if it.a_id not in reps:
            rep = session.get(Usuario, it.a_id)
            if not rep or not rep.activo:
                raise HTTPException(400, "Un reemplazo no existe o está inactivo.")
            reps[it.a_id] = rep
    # 2) La grilla debe seguir vigente: cada cliente aún en el saliente para ese rol.
    pares: list[tuple[Cliente, str, int]] = []
    obsoletos = 0
    for it in data.items:
        c = session.get(Cliente, it.cliente_id)
        if not c or getattr(c, it.rol) != data.saliente_id:
            obsoletos += 1
        else:
            pares.append((c, it.rol, it.a_id))
    if obsoletos:
        raise HTTPException(409, f"La lista cambió desde que la abriste ({obsoletos} "
                                 "cliente(s) ya no están en el saliente). Recárgala e "
                                 "inténtalo de nuevo.")
    por = admin.nombre or admin.usuario or ""
    ahora = datetime.utcnow()
    lote = ReasignacionLote(
        saliente_id=data.saliente_id, tipo=data.tipo,
        fecha_retorno=data.fecha_retorno if data.tipo == "vacaciones" else None,
        nota=(data.nota or "").strip(), creado_por=por, estado="activa")
    session.add(lote)
    session.flush()                     # necesito lote.id para los items
    for c, rol, a_id in pares:
        session.add(ReasignacionItem(lote_id=lote.id, cliente_id=c.id, rol=rol,
                                     de_id=data.saliente_id, a_id=a_id))
        setattr(c, rol, a_id)
        c.actualizado_at = ahora
        c.actualizado_por = por
        session.add(c)
    session.commit()
    return {"lote_id": lote.id, "total": len(pares)}


@router.get("/reasignaciones")
def lista_reasignaciones(estado: str = "activa", session: Session = Depends(get_session),
                         _=Depends(require_perm("responsables.reasignar"))):
    """Lotes de reasignación. ``estado`` = activa|revertida|revertida_parcial|todas."""
    q = select(ReasignacionLote).order_by(ReasignacionLote.creado_at.desc())
    if estado and estado != "todas":
        q = q.where(ReasignacionLote.estado == estado)
    nombres = {u.id: u.nombre for u in session.exec(select(Usuario)).all()}
    hoy = date.today()
    rows = []
    for l in session.exec(q).all():
        items = session.exec(select(ReasignacionItem).where(ReasignacionItem.lote_id == l.id)).all()
        por_rol: dict[str, dict] = {}
        for it in items:
            k = f"{it.rol}|{it.a_id}"
            d = por_rol.setdefault(k, {"rol": _LBL_ROL.get(it.rol, it.rol),
                                       "a": nombres.get(it.a_id, "?"), "n": 0})
            d["n"] += 1
        rows.append({
            "id": l.id, "saliente": nombres.get(l.saliente_id, "?"), "tipo": l.tipo,
            "fecha_retorno": l.fecha_retorno.isoformat() if l.fecha_retorno else None,
            "vence": bool(l.fecha_retorno and l.fecha_retorno <= hoy and l.estado == "activa"),
            "estado": l.estado, "total": len(items), "detalle": list(por_rol.values()),
            "creado_por": l.creado_por,
            "creado_at": l.creado_at.isoformat() if l.creado_at else None,
            "nota": l.nota,
        })
    return {"rows": rows}


@router.post("/reasignaciones/{lid:int}/revertir")
def revertir_reasignacion(lid: int, session: Session = Depends(get_session),
                          admin: Usuario = Depends(require_perm("responsables.reasignar"))):
    """Revierte un lote: devuelve cada cliente a su responsable anterior, pero SOLO si
    sigue en el reemplazo (no pisa un cambio manual posterior). Reporta lo omitido y
    marca el lote revertida / revertida_parcial."""
    lote = session.get(ReasignacionLote, lid)
    if not lote:
        raise HTTPException(404, "Lote no encontrado")
    if lote.estado != "activa":
        raise HTTPException(400, "Este lote ya fue revertido.")
    por = admin.nombre or admin.usuario or ""
    ahora = datetime.utcnow()
    nombres = {u.id: u.nombre for u in session.exec(select(Usuario)).all()}
    ocultos = confid_ocultos(session, admin)
    restaurados = 0
    omitidos = []
    for it in session.exec(select(ReasignacionItem).where(ReasignacionItem.lote_id == lid)).all():
        if it.revertido:
            continue
        c = session.get(Cliente, it.cliente_id)
        if not c:
            continue
        actual = getattr(c, it.rol)
        if actual == it.a_id:
            setattr(c, it.rol, it.de_id)
            c.actualizado_at = ahora
            c.actualizado_por = por
            it.revertido = True
            session.add(c)
            session.add(it)
            restaurados += 1
        else:
            omitidos.append({"cliente": "Cliente confidencial" if c.id in ocultos
                             else (c.razon_social or c.nombre or c.num_id),
                             "rol": _LBL_ROL.get(it.rol, it.rol),
                             "actual": nombres.get(actual, "—") if actual else "—"})
    lote.estado = "revertida_parcial" if omitidos else "revertida"
    lote.revertida_por = por
    lote.revertida_at = ahora
    session.add(lote)
    session.commit()
    return {"restaurados": restaurados, "omitidos": omitidos, "estado": lote.estado}


# ====================================================== Correo de notificación del lote
# Tras una reasignación TRIBUTARIA, avisar por correo al Responsable de Impuestos de cada
# cliente afectado, con la tabla (Célula/grupo · Cliente · Supervisor encargado) de SUS
# clientes. OJO con la semántica del rol movido (de aquí sale quién recibe y quién es el
# supervisor), confirmada contra el correo real de la firma:
#   · se movió el COORDINADOR  → el aviso va al RESPONSABLE del cliente; el supervisor es
#                                el reemplazo (a_id, el nuevo coordinador).
#   · se movió el RESPONSABLE  → el aviso va al reemplazo (a_id, el nuevo responsable); el
#                                supervisor es el coordinador actual del cliente.
#   · financiero/registro      → no es tributario, no genera correo (se cuenta aparte).
# El envío sale del BUZÓN del usuario que opera (Graph delegado), igual que Cuentas de cobro.
_MESES_NOM = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
              "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _tc(s: str) -> str:
    """Título legible de un nombre de PERSONA guardado en MAYÚSCULAS (APELLIDOS NOMBRES)."""
    return " ".join(w.capitalize() for w in (s or "").split())


def _tc_cli(s: str) -> str:
    """Título de una RAZÓN SOCIAL: capitaliza palabras pero conserva las siglas en
    mayúscula (SAS, S.A.S, LTDA, TSA, SEA…), como en el correo real de la firma."""
    out = []
    for w in (s or "").split():
        letras = w.replace(".", "")
        out.append(w if letras.isupper() and len(letras) <= 4 else w.capitalize())
    return " ".join(out)


def _join_y(xs: list[str]) -> str:
    xs = [x for x in xs if x]
    if len(xs) <= 1:
        return xs[0] if xs else ""
    return ", ".join(xs[:-1]) + " y " + xs[-1]


def _fmt_reasig(t: str, *, responsable: str, periodo: str, mes: int, anio: int) -> str:
    return (t.replace("{responsable}", responsable).replace("{periodo}", periodo)
            .replace("{mes_nom}", _MESES_NOM[mes] if 1 <= mes <= 12 else str(mes))
            .replace("{anio}", str(anio)))


def _armar_correos(session: Session, lote: ReasignacionLote, operador: Usuario) -> dict:
    """Arma, por DESTINATARIO (Responsable de Impuestos avisado), la tabla de su correo a
    partir de los items vigentes del lote. El servidor es dueño de la tabla (no del cliente).
    Enmascara nombres de confidenciales que el operador no pueda ver."""
    from .parametros import _reasig
    cfg = _reasig(session)
    ocultos = confid_ocultos(session, operador)
    nombres = {u.id: u.nombre for u in session.exec(select(Usuario)).all()}
    creado = lote.creado_at or datetime.utcnow()
    periodo = f"{creado.year:04d}-{creado.month:02d}"
    # destinatario_id -> {nombre, filas_raw: [(celula, cliente, supervisor, oculto)]}
    dest: dict[int, dict] = {}
    sin_resp: list[dict] = []
    omitidos = 0
    for it in session.exec(select(ReasignacionItem).where(
            ReasignacionItem.lote_id == lote.id, ReasignacionItem.revertido == False)).all():  # noqa: E712
        c = session.get(Cliente, it.cliente_id)
        if not c:
            continue
        if it.rol == "coordinador_impuestos_id":
            rid, sup_id = c.responsable_impuestos_id, it.a_id
        elif it.rol == "responsable_impuestos_id":
            rid, sup_id = it.a_id, c.coordinador_impuestos_id
        else:
            omitidos += 1
            continue
        oculto = c.id in ocultos
        celula = (c.grupo or "").strip() or _tc_cli(c.razon_social or c.nombre or c.num_id or f"#{c.id}")
        cli = "Cliente confidencial" if oculto else _tc_cli(c.razon_social or c.nombre or c.num_id or f"#{c.id}")
        sup = _tc(nombres.get(sup_id, "")) if sup_id else "—"
        fila = (celula, cli, sup)
        if not rid:
            sin_resp.append({"celula": celula, "cliente": cli, "supervisor": sup})
            continue
        dest.setdefault(rid, {"filas_raw": []})["filas_raw"].append(fila)
    # agrupar por (célula, supervisor) y unir clientes
    recipientes = []
    enviados = {rc.destinatario_id: rc for rc in session.exec(select(ReasignacionCorreo).where(
        ReasignacionCorreo.lote_id == lote.id).order_by(ReasignacionCorreo.enviado_at.desc())).all()}
    for rid, d in dest.items():
        u = session.get(Usuario, rid)
        grupos: dict[tuple, list[str]] = {}
        for celula, cli, sup in d["filas_raw"]:
            grupos.setdefault((celula, sup), []).append(cli)
        filas = [{"celula": k[0], "supervisor": k[1], "clientes": _join_y(v)}
                 for k, v in sorted(grupos.items(), key=lambda x: (x[0][0].lower(), x[0][1].lower()))]
        nom = _tc(u.nombre if u else nombres.get(rid, ""))
        rc = enviados.get(rid)
        recipientes.append({
            "destinatario_id": rid, "nombre": nom,
            "para": (u.email_corporativo or "").strip() if u else "",
            "tiene_correo": bool(u and (u.email_corporativo or "").strip()),
            "enviado": {"at": rc.enviado_at.isoformat(), "por": rc.enviado_por} if rc else None,
            "asunto": _fmt_reasig(cfg["asunto"], responsable=nom, periodo=periodo, mes=creado.month, anio=creado.year),
            "intro": _fmt_reasig(cfg["intro"], responsable=nom, periodo=periodo, mes=creado.month, anio=creado.year),
            "cierre": _fmt_reasig(cfg["cierre"], responsable=nom, periodo=periodo, mes=creado.month, anio=creado.year),
            "filas": filas, "n_clientes": len(d["filas_raw"]),
        })
    recipientes.sort(key=lambda r: r["nombre"].lower())
    return {"periodo": periodo, "recipientes": recipientes, "sin_responsable": sin_resp,
            "omitidos_no_tributarios": omitidos}


_LOGO_CID = "logocyc"
_LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "logo-correo.png")


def _logo_bytes() -> bytes | None:
    """Bytes del logo de la firma para incrustarlo en el correo (None si no está)."""
    try:
        with open(_LOGO_PATH, "rb") as f:
            return f.read()
    except OSError:
        return None


def _esc(t: str) -> str:
    return _html.escape(t or "")


def _parrafos(txt: str) -> str:
    out = []
    for p in (txt or "").split("\n\n"):
        if p.strip():
            out.append("<p style=\"margin:0 0 11px\">" + _esc(p).replace("\n", "<br>") + "</p>")
    return "".join(out)


def _html_correo(intro: str, filas: list[dict], cierre: str, firmante: dict, con_logo: bool = False) -> str:
    th = ("style=\"background:#0b1f4d;color:#fff;text-align:left;padding:7px 11px;"
          "font-size:13px;border:1px solid #0b1f4d\"")
    td = "style=\"padding:6px 11px;font-size:13px;border:1px solid #cbd5e1;vertical-align:top\""
    filas_html = "".join(
        f"<tr><td {td}>{_esc(f['celula'])}</td><td {td}>{_esc(f['clientes'])}</td>"
        f"<td {td}>{_esc(f['supervisor'])}</td></tr>" for f in filas)
    tabla = (
        "<table style=\"border-collapse:collapse;margin:4px 0 14px;max-width:760px\">"
        f"<tr><th {th}>Cliente principal / célula</th><th {th}>Cliente</th>"
        f"<th {th}>Supervisor encargado</th></tr>{filas_html}</table>")
    firma = (
        "<div style=\"margin-top:14px;line-height:1.35\">"
        f"<div style=\"font-weight:700;color:#0b1f4d\">{_esc(firmante.get('nombre',''))}</div>"
        + (f"<div style=\"color:#0836c7;font-weight:700;text-transform:uppercase;font-size:12px\">{_esc(firmante['cargo'])}</div>" if firmante.get("cargo") else "")
        + (f"<div style=\"color:#6b7280;font-size:12px\">{_esc(firmante['contacto'])}</div>" if firmante.get("contacto") else "")
        + (f"<div style=\"color:#6b7280;font-size:12px\">{_esc(firmante['email'])}</div>" if firmante.get("email") else "")
        + (f"<div style=\"color:#6b7280;font-size:12px\">{_esc(firmante['firma'])}</div>" if firmante.get("firma") else "")
        + (f"<div style=\"margin-top:12px\"><img src=\"cid:{_LOGO_CID}\" width=\"180\" alt=\"Cardona & Cardona\" style=\"display:block;width:180px;height:auto\"></div>" if con_logo else "")
        + "</div>")
    return ("<div style=\"font-family:Arial,Helvetica,sans-serif;color:#1f2a37;font-size:13px;"
            f"line-height:1.45\">{_parrafos(intro)}{tabla}{_parrafos(cierre)}{firma}</div>")


@router.get("/reasignaciones/{lid:int}/correos")
def correos_lote(lid: int, session: Session = Depends(get_session),
                 operador: Usuario = Depends(require_perm("responsables.reasignar"))):
    """Borradores (uno por Responsable de Impuestos a avisar) del lote, para el modal."""
    lote = session.get(ReasignacionLote, lid)
    if not lote:
        raise HTTPException(404, "Lote no encontrado")
    data = _armar_correos(session, lote, operador)
    op = session.get(Usuario, operador.id)
    data["de"] = (op.correo_cuenta if op else "") or ""
    data["conectado"] = bool(op and op.correo_token_enc)
    return data


class CorreoReasigIn(BaseModel):
    destinatario_id: int
    para: str
    asunto: str
    intro: str
    cierre: str


@router.post("/reasignaciones/{lid:int}/correo")
def enviar_correo_lote(lid: int, datos: CorreoReasigIn, session: Session = Depends(get_session),
                       operador: Usuario = Depends(require_perm("responsables.reasignar"))):
    """Compone y envía (desde el buzón del operador, Graph delegado) el aviso a UN
    destinatario. La TABLA se recalcula en el servidor desde el lote (no se toma del
    payload); del modal solo se usan para/asunto/intro/cierre."""
    from ..graph_delegado import enviar as graph_enviar, refrescar
    from .parametros import _get as _get_param
    from ..security import decrypt, encrypt

    lote = session.get(ReasignacionLote, lid)
    if not lote:
        raise HTTPException(404, "Lote no encontrado")
    para = (datos.para or "").strip()
    if not para:
        raise HTTPException(400, "El destinatario no tiene correo registrado.")
    data = _armar_correos(session, lote, operador)
    rec = next((r for r in data["recipientes"] if r["destinatario_id"] == datos.destinatario_id), None)
    if not rec:
        raise HTTPException(400, "Ese destinatario ya no tiene clientes en este lote.")
    op = session.get(Usuario, operador.id)
    if not op or not op.correo_token_enc:
        raise HTTPException(400, "Conecta tu correo de Microsoft 365 primero (Configuración → Mi correo).")
    try:
        tokens = refrescar(decrypt(op.correo_token_enc))
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Tu sesión de correo expiró; reconéctala en Configuración → Mi correo.")
    if tokens.get("refresh_token"):
        op.correo_token_enc = encrypt(tokens["refresh_token"])
        session.add(op)
        session.commit()
    firmante = {
        "nombre": _tc(op.nombre or op.usuario or ""),
        "cargo": op.cargo or "",
        "contacto": " · ".join(x for x in [(op.telefono or "").strip(), (op.celular or "").strip()] if x),
        "email": (op.email_corporativo or op.correo_cuenta or "").strip(),
        "firma": _get_param(session, "cobro_titular", "Cardona & Cardona Consultores S.A.S"),
    }
    logo = _logo_bytes()
    cuerpo = _html_correo(datos.intro, rec["filas"], datos.cierre, firmante, con_logo=bool(logo))
    try:
        graph_enviar(tokens["access_token"], destinatario=para, asunto=datos.asunto,
                     cuerpo=cuerpo, html=True,
                     imagenes_inline=[(_LOGO_CID, logo, "image/png")] if logo else None)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo enviar: {e}")
    session.add(ReasignacionCorreo(lote_id=lid, destinatario_id=datos.destinatario_id,
                                   para=para, enviado_por=op.nombre or op.usuario or ""))
    session.commit()
    return {"ok": True, "para": para}
