"""Prueba de la migración de siembra sobre SQLite (simula el esquema dian)."""
import os, sys, tempfile

sys.path.insert(0, ".")
_tmp = os.path.join(tempfile.gettempdir(), "maestros_migr_test.db")
if os.path.exists(_tmp):
    os.remove(_tmp)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"
os.environ["FUENTE_CLIENTE"] = "contribuyente_src"
os.environ["FUENTE_USUARIO"] = "usuario_src"

from sqlalchemy import text
from sqlmodel import Session, select
from app.db import engine, init_db
from app.models import Cliente, Usuario
import migrar_desde_dian as M

ok = 0
def check(cond, msg):
    global ok
    print(("  ✓ " if cond else "  ✗ FALLA ") + msg)
    assert cond, msg
    ok += 1

init_db()
# --- Tablas fuente simuladas (como dian.contribuyente / dian.usuario) ---
with engine.begin() as c:
    c.execute(text("""CREATE TABLE contribuyente_src (
        id INTEGER, tipo_contribuyente TEXT, tipo_documento TEXT, num_id TEXT, nombre TEXT,
        password_enc TEXT, estado TEXT, regimen TEXT, email TEXT,
        representante_tipo_documento TEXT, representante_num_id TEXT, rut_actualizado TEXT, creado_at TEXT)"""))
    c.execute(text("""CREATE TABLE usuario_src (
        id INTEGER, nombre TEXT, usuario TEXT, password_hash TEXT, rol TEXT,
        activo INTEGER, debe_cambiar INTEGER, foto TEXT, creado_at TEXT)"""))
    # id con hueco (7, 42) para verificar que se preservan
    c.execute(text("""INSERT INTO contribuyente_src VALUES
        (7,'Jur','NT','900123456','Comercializadora Los Andes S.A.S.','gAAAA-token-jur','Act','Simple','a@a.co','','','2026-05-01','2026-03-01'),
        (42,'Nat','CC','43256789','Martínez López Diana Carolina','gAAAA-token-nat','Act','Ordinario','','', '', '', '2026-04-02')"""))
    c.execute(text("""INSERT INTO usuario_src VALUES
        (3,'Cristian Cardona','admin','argon2hash','admin',1,0,''  ,'2026-01-01'),
        (9,'Ana Fernández','ana','argon2hash2','usuario',1,1,'','2026-02-01')"""))

# --- DRY-RUN: no debe escribir ---
res = M.correr(apply=False)
with Session(engine) as s:
    check(len(s.exec(select(Cliente)).all()) == 0, "dry-run no escribe clientes")
check(res["clientes_ins"] == 2 and res["usuarios_ins"] == 2, "dry-run cuenta 2+2 nuevos")

# --- APPLY ---
res = M.correr(apply=True)
check(res["clientes_ins"] == 2 and res["usuarios_ins"] == 2, "apply inserta 2 clientes + 2 usuarios")
with Session(engine) as s:
    jur = s.get(Cliente, 7); nat = s.get(Cliente, 42)
    check(jur is not None and nat is not None, "ids preservados (7 y 42)")
    check(jur.dv == 8, f"DV calculado (900123456 -> 8), got {jur.dv}")
    check(jur.razon_social == "Comercializadora Los Andes S.A.S.", "Jur: razon_social = nombre")
    check(jur.password_enc == "gAAAA-token-jur", "password_enc copiado verbatim")
    check(nat.nombre == "Martínez López Diana Carolina" and nat.primer_apellido == "", "Nat: nombre conservado, componentes vacíos")
    u = s.exec(select(Usuario).where(Usuario.usuario == "admin")).first()
    check(u is not None and u.id == 3 and u.tipo == "Int", "usuario admin migrado (id 3, Int)")

# --- IDEMPOTENCIA: correr de nuevo no duplica ---
res2 = M.correr(apply=True)
check(res2["clientes_ins"] == 0 and res2["clientes_upd"] == 2, "2a corrida: 0 nuevos, 2 actualizados")
with Session(engine) as s:
    check(len(s.exec(select(Cliente)).all()) == 2, "sigue habiendo 2 clientes (sin duplicar)")
    # un cliente nuevo toma id > max migrado (secuencia por encima de 42)
    nuevo = Cliente(tipo_contribuyente="Jur", tipo_documento="NT", num_id="800000000", nombre="X")
    s.add(nuevo); s.commit(); s.refresh(nuevo)
    check(nuevo.id > 42, f"nuevo id ({nuevo.id}) por encima del máximo migrado (42)")

print(f"\n== {ok} verificaciones OK ==")
