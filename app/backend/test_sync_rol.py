"""Regresión de `_sync_rol`: la derivación del texto `usuario.rol` (compat que leen
LITERAL Calendario / Liquidador / Descargas DIAN para autorizar) NUNCA debe marcar
'admin' a un rol que solo crea/edita datos pero no gestiona la firma.

El footgun (2026-10-25): la regla laxa anterior (cualquier .crear/.editar/.eliminar
→ admin) promovía al rol Contador (tiene clientes.crear/editar) a 'admin' en la
siguiente edición del usuario → le daba acceso a TODOS los clientes y a las claves
de portal DIAN en otras apps. Esta prueba falla si esa regresión vuelve.
"""
import os, sys, tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")   # glifos ✓/✗ en consolas cp1252 (Windows)
except Exception:
    pass
sys.path.insert(0, ".")
_tmp = os.path.join(tempfile.gettempdir(), "maestros_syncrol_test.db")
if os.path.exists(_tmp):
    os.remove(_tmp)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"

from sqlmodel import Session
from app.db import engine, init_db
from app.models import Rol, Permiso, RolPermiso, Usuario
from app.routers.responsables import _sync_rol, ADMIN_PERMISOS

ok = 0
def check(cond, msg):
    global ok
    print(("  ✓ " if cond else "  ✗ FALLA ") + msg)
    assert cond, msg
    ok += 1

init_db()

# Catálogo mínimo de permisos (los que tocan la regla + ruido de escritura genérico).
PERMS = ["config.roles", "responsables.editar", "catalogos.editar",
         "clientes.crear", "clientes.editar", "clientes.eliminar", "clientes.ver",
         "claves.ver", "consultas.ver", "facturacion.ver"]

def _rol(s, nombre, sistema, claves):
    r = Rol(nombre=nombre, sistema=sistema, activo=True)
    s.add(r); s.commit(); s.refresh(r)
    for c in claves:
        s.add(RolPermiso(rol_id=r.id, permiso_clave=c))
    s.commit()
    return r

def _derivar(s, rol_id, texto_previo=""):
    u = Usuario(nombre="x", rol=texto_previo, rol_id=rol_id)
    _sync_rol(s, u)
    return u.rol

with Session(engine) as s:
    for c in PERMS:
        s.add(Permiso(clave=c, seccion=c.split(".")[0], accion=c.split(".")[1]))
    s.commit()

    r_super = _rol(s, "Super Usuario", True, [])                      # sistema → todos
    r_coord = _rol(s, "Coordinador", False, ["catalogos.editar", "responsables.editar",
                                             "clientes.crear", "clientes.editar", "clientes.eliminar"])
    r_cont  = _rol(s, "Contador", False, ["clientes.crear", "clientes.editar", "clientes.ver",
                                          "claves.ver", "consultas.ver", "facturacion.ver"])
    r_cons  = _rol(s, "Consulta", False, ["clientes.ver", "claves.ver", "consultas.ver"])
    r_adm   = _rol(s, "Administrador", False, ["config.roles"])        # solo config.roles

    check(_derivar(s, r_super.id) == "superadmin", "Rol sistema → 'superadmin'")
    check(_derivar(s, r_coord.id) == "admin",       "Coordinador (catalogos/responsables.editar) → 'admin'")
    check(_derivar(s, r_adm.id)   == "admin",       "Rol con config.roles → 'admin'")
    check(_derivar(s, r_cons.id)  == "usuario",     "Consulta (solo .ver) → 'usuario'")

    # --- REGRESIÓN DEL FOOTGUN ---
    # Contador tiene clientes.crear/editar pero NINGUNO de ADMIN_PERMISOS → debe ser 'usuario'.
    check(_derivar(s, r_cont.id) == "usuario",
          "REGRESIÓN: Contador (crea/edita pero sin config.roles/responsables.editar/catalogos.editar) → 'usuario', NO 'admin'")
    # Y aunque el texto previo fuera 'admin' por error, re-derivar lo corrige a 'usuario'.
    check(_derivar(s, r_cont.id, texto_previo="admin") == "usuario",
          "REGRESIÓN: re-derivar un Contador marcado 'admin' por error lo baja a 'usuario'")

    # El conjunto de la regla no debe incluir permisos de escritura genéricos.
    check(ADMIN_PERMISOS == {"config.roles", "responsables.editar", "catalogos.editar"},
          "ADMIN_PERMISOS = exactamente {config.roles, responsables.editar, catalogos.editar}")
    check(not (ADMIN_PERMISOS & {"clientes.crear", "clientes.editar", "clientes.eliminar"}),
          "ADMIN_PERMISOS no contiene permisos de escritura genéricos (.crear/.editar/.eliminar de clientes)")

    # rol_id NULL → no toca el texto (fallback puente, evita lockout).
    check(_derivar(s, None, texto_previo="usuario") == "usuario", "rol_id NULL → conserva el texto")

print(f"\nOK test_sync_rol: {ok} checks")
