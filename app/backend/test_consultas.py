"""Prueba del constructor de consultas (SQLite temporal, TestClient).

Cubre: catálogo de tablas/campos, ocultamiento de columnas sensibles, armado
del SELECT, operadores, orden y límite, exportación a Excel y el control de rol
(solo Super Usuario). También intenta inyección por nombre de campo.
"""
import os
import sys
import tempfile

sys.path.insert(0, ".")
_tmp = os.path.join(tempfile.gettempdir(), "maestros_consultas_test.db")
if os.path.exists(_tmp):
    os.remove(_tmp)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"

from fastapi.testclient import TestClient      # noqa: E402
from app.main import app                       # noqa: E402

ok = 0


def check(cond, msg):
    global ok
    print(("  OK  " if cond else "  FALLA  ") + msg)
    assert cond, msg
    ok += 1


with TestClient(app) as c:
    # --- Sesión: admin crea un Super Usuario y entramos con él ---------------
    r = c.post("/api/auth/login", json={"usuario": "admin", "password": "admin"})
    check(r.status_code == 200, "login admin")
    HA = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.post("/api/responsables", headers=HA, json={
        "tipo": "Int", "nombre": "Cristian Cardona", "usuario": "cris",
        "password": "Sup3r#2026", "rol": "superadmin"})
    check(r.status_code == 201, "crear Super Usuario")
    r = c.post("/api/auth/login", json={"usuario": "cris", "password": "Sup3r#2026"})
    check(r.status_code == 200, "login Super Usuario")
    H = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.post("/api/responsables", headers=HA, json={
        "tipo": "Int", "nombre": "Auxiliar", "usuario": "aux",
        "password": "Aux#2026", "rol": "usuario"})
    check(r.status_code == 201, "crear usuario común")
    r = c.post("/api/auth/login", json={"usuario": "aux", "password": "Aux#2026"})
    HU = {"Authorization": f"Bearer {r.json()['token']}"}

    # --- Datos de prueba -----------------------------------------------------
    r = c.post("/api/catalogos/software", json={"descripcion": "Siigo"}, headers=HA)
    sw_id = r.json()["id"]
    for num, nombre, regimen in (("900123456", "Comercializadora Los Andes S.A.S.", "Simple"),
                                 ("901555111", "Inversiones Del Valle S.A.S.", "Ordinario"),
                                 ("800999222", "Andes Logistica S.A.S.", "Ordinario")):
        r = c.post("/api/clientes", headers=HA, json={
            "tipo_contribuyente": "Jur", "num_id": num, "razon_social": nombre,
            "software_id": sw_id, "regimen": regimen, "responsable_iva": True,
            "password": "ClaveDian#2026"})
        check(r.status_code == 201, f"crear cliente {num}")

    # --- Control de acceso ---------------------------------------------------
    check(c.get("/api/consultas/tablas").status_code == 401, "sin token = 401")
    check(c.get("/api/consultas/tablas", headers=HU).status_code == 403,
          "usuario comun = 403 (solo Super Usuario)")
    check(c.get("/api/consultas/tablas", headers=HA).status_code == 403,
          "administrador = 403 (solo Super Usuario)")

    # --- Catálogo de tablas --------------------------------------------------
    r = c.get("/api/consultas/tablas", headers=H)
    check(r.status_code == 200, "listar tablas")
    tablas = {t["nombre"]: t for t in r.json()}
    check("cliente" in tablas and "usuario" in tablas, "aparecen cliente y usuario")
    check(tablas["cliente"]["etiqueta"] == "Clientes", "etiqueta amigable de la tabla")
    check(tablas["cliente"]["filas"] == 3, "conteo de filas de cliente = 3")

    # --- Campos y columnas ocultas ------------------------------------------
    r = c.get("/api/consultas/tablas/cliente/campos", headers=H)
    check(r.status_code == 200, "listar campos de cliente")
    campos = {x["nombre"]: x for x in r.json()}
    check("password_enc" not in campos, "password_enc NO se expone")
    check("logo" not in campos, "el logo (base64) no se ofrece como campo")
    check("razon_social" in campos and campos["razon_social"]["tipo"] == "texto",
          "razon_social es texto")
    check(campos["id"]["pk"] is True, "id marcado como llave primaria")
    check("entre" in campos["id"]["operadores"], "campo numerico ofrece 'entre'")
    check("contiene" in campos["razon_social"]["operadores"], "campo texto ofrece 'contiene'")

    r = c.get("/api/consultas/tablas/usuario/campos", headers=H)
    nombres = {x["nombre"] for x in r.json()}
    check(not (nombres & {"password_hash", "password_enc", "foto"}),
          "usuario: hash, clave cifrada y foto ocultos")

    check(c.get("/api/consultas/tablas/pg_user/campos", headers=H).status_code == 404,
          "tabla fuera del catalogo = 404")

    # --- Ejecutar: selección simple -----------------------------------------
    base = {"tabla": "cliente", "campos": ["num_id", "razon_social", "regimen"]}
    r = c.post("/api/consultas/ejecutar", headers=H, json=base)
    check(r.status_code == 200, "ejecutar seleccion simple")
    d = r.json()
    check(d["total"] == 3, "devuelve las 3 filas")
    check(list(d["filas"][0].keys()) == ["num_id", "razon_social", "regimen"],
          "solo vienen los campos pedidos, en orden")
    check("SELECT" in d["sql"] and "password_enc" not in d["sql"], "SQL visible y sin secretos")

    # --- Filtros -------------------------------------------------------------
    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "filtros": [{"campo": "razon_social", "op": "contiene", "valor": "andes"}]})
    check(r.json()["total"] == 2, "filtro 'contiene' insensible a mayusculas -> 2")

    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "filtros": [{"campo": "razon_social", "op": "empieza", "valor": "Inversiones"}]})
    check(r.json()["total"] == 1, "filtro 'empieza por' -> 1")

    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "filtros": [{"campo": "regimen", "op": "=", "valor": "Ordinario"}]})
    check(r.json()["total"] == 2, "filtro '=' -> 2")

    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "union": "o",
        "filtros": [{"campo": "num_id", "op": "=", "valor": "900123456"},
                    {"campo": "num_id", "op": "=", "valor": "800999222"}]})
    check(r.json()["total"] == 2, "dos filtros unidos con O -> 2")

    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "filtros": [{"campo": "razon_social", "op": "contiene", "valor": "andes"},
                            {"campo": "regimen", "op": "=", "valor": "Simple"}]})
    check(r.json()["total"] == 1, "dos filtros unidos con Y -> 1")

    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "filtros": [{"campo": "id", "op": "entre", "valor": "1", "valor2": "2"}]})
    check(r.json()["total"] == 2, "filtro 'entre' sobre numerico -> 2")

    r = c.post("/api/consultas/ejecutar", headers=H, json={
        "tabla": "cliente", "campos": ["num_id", "objeto_social"],
        "filtros": [{"campo": "objeto_social", "op": "vacio"}]})
    check(r.json()["total"] == 3, "filtro 'vacio' -> 3")

    # El comodín del usuario se escapa: '%' no debe comportarse como comodín.
    r = c.post("/api/consultas/ejecutar", headers=H, json={
        **base, "filtros": [{"campo": "razon_social", "op": "contiene", "valor": "%"}]})
    check(r.json()["total"] == 0, "el comodin '%' se escapa (no trae todo)")

    # --- Orden y límite ------------------------------------------------------
    r = c.post("/api/consultas/ejecutar", headers=H, json={**base, "orden": "razon_social"})
    check(r.json()["filas"][0]["razon_social"].startswith("Andes"), "orden ascendente")
    r = c.post("/api/consultas/ejecutar", headers=H,
               json={**base, "orden": "razon_social", "orden_desc": True})
    check(r.json()["filas"][0]["razon_social"].startswith("Inversiones"), "orden descendente")

    r = c.post("/api/consultas/ejecutar", headers=H, json={**base, "limite": 2})
    d = r.json()
    check(d["total"] == 2 and d["truncado"] is True, "limite recorta y avisa 'truncado'")

    r = c.post("/api/consultas/ejecutar", headers=H, json={"tabla": "cliente", "limite": 99999})
    check(r.json()["limite"] == 5000, "limite se topa en 5000")

    r = c.post("/api/consultas/ejecutar", headers=H, json={"tabla": "cliente"})
    check("password_enc" not in r.json()["filas"][0], "sin campos: trae todo MENOS lo oculto")

    # --- Rechazos ------------------------------------------------------------
    malos = [
        ({"tabla": "cliente", "campos": ["password_enc"]}, "seleccionar columna oculta"),
        ({"tabla": "cliente", "campos": ["no_existe"]}, "campo inexistente"),
        ({"tabla": "cliente", "campos": ['num_id"; DROP TABLE cliente; --']}, "inyeccion por campo"),
        ({"tabla": "cliente", "orden": "password_enc"}, "ordenar por columna oculta"),
        ({"tabla": "cliente", "filtros": [{"campo": "password_enc", "op": "=", "valor": "x"}]},
         "filtrar por columna oculta"),
        ({"tabla": "cliente", "filtros": [{"campo": "num_id", "op": "; DELETE FROM cliente", "valor": "x"}]},
         "operador invalido"),
        ({"tabla": "cliente", "filtros": [{"campo": "id", "op": "=", "valor": "abc"}]},
         "valor no numerico en campo entero"),
    ]
    for payload, etiqueta in malos:
        r = c.post("/api/consultas/ejecutar", headers=H, json=payload)
        check(r.status_code == 400, f"rechaza: {etiqueta}")

    r = c.post("/api/consultas/ejecutar", headers=H, json={"tabla": "sqlite_master"})
    check(r.status_code == 404, "rechaza: tabla del sistema")

    # La tabla cliente sigue intacta tras los intentos de inyección.
    r = c.post("/api/consultas/ejecutar", headers=H, json={"tabla": "cliente", "campos": ["id"]})
    check(r.json()["total"] == 3, "la tabla sigue intacta tras los intentos de inyeccion")

    # --- Exportar a Excel ----------------------------------------------------
    r = c.post("/api/consultas/exportar", headers=H, json=base)
    check(r.status_code == 200 and r.content[:2] == b"PK", "exportar a Excel (xlsx valido)")
    check("Consulta_cliente.xlsx" in r.headers.get("content-disposition", ""),
          "nombre del archivo exportado")
    check(c.post("/api/consultas/exportar", headers=HU, json=base).status_code == 403,
          "exportar exige Super Usuario")

    # --- Forma del SQL en Postgres (la prueba corre sobre SQLite) ------------
    # Se fuerza la rama Postgres para comprobar que la tabla queda calificada
    # con el esquema y que los valores siguen viajando como parámetros.
    from app.routers import consultas as mod

    mod.ES_SQLITE = False
    try:
        sql, params, _ = mod._armar(mod.ConsultaIn(
            tabla="cliente", campos=["num_id"],
            filtros=[mod.Filtro(campo="razon_social", op="contiene", valor="O'Brien 50%")]))
    finally:
        mod.ES_SQLITE = True
    check('"maestros"."cliente"' in sql, "Postgres: tabla calificada con el esquema")
    check(":p0" in sql and "O'Brien" not in sql, "Postgres: el valor va parametrizado, no inyectado")
    check(params["p0"] == "%o'brien 50\\%%", "Postgres: el % del usuario queda escapado")

    # --- Operadores ----------------------------------------------------------
    r = c.get("/api/consultas/operadores", headers=H)
    ops = {x["op"]: x for x in r.json()}
    check(ops["entre"]["dos_valores"] is True and ops["vacio"]["sin_valor"] is True,
          "catalogo de operadores")

print(f"\n{ok} verificaciones OK")
