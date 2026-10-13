"""Prueba end-to-end de la API (SQLite en archivo temporal, TestClient)."""
import os, sys, tempfile

sys.path.insert(0, ".")
_tmp = os.path.join(tempfile.gettempdir(), "maestros_test.db")
if os.path.exists(_tmp):
    os.remove(_tmp)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"

from fastapi.testclient import TestClient
from app.main import app

ok = 0
def check(cond, msg):
    global ok
    print(("  ✓ " if cond else "  ✗ FALLA ") + msg)
    assert cond, msg
    ok += 1

with TestClient(app) as c:
    # Health
    r = c.get("/api/health"); check(r.status_code == 200 and r.json()["status"] == "ok", "health")

    # Login admin
    r = c.post("/api/auth/login", json={"usuario": "admin", "password": "admin"})
    check(r.status_code == 200, "login admin")
    tok = r.json()["token"]; H = {"Authorization": f"Bearer {tok}"}
    check(r.json()["debe_cambiar"] is True, "admin debe cambiar clave")

    # Sin token -> 401
    check(c.get("/api/clientes").status_code == 401, "clientes sin token = 401")

    # Catálogos
    r = c.post("/api/catalogos/rol-servicio", json={"descripcion": "Contabilidad mensual"}, headers=H)
    check(r.status_code == 201, "crear rol-servicio")
    rol_id = r.json()["id"]
    r = c.post("/api/catalogos/software", json={"descripcion": "Siigo"}, headers=H)
    check(r.status_code == 201, "crear software"); sw_id = r.json()["id"]

    # CIIU sembrado + búsqueda
    r = c.get("/api/catalogos/ciiu/buscar", params={"q": "contab"}, headers=H)
    check(r.status_code == 200 and any(x["codigo"] == "6920" for x in r.json()), "buscar CIIU 'contab' -> 6920")
    r = c.get("/api/catalogos/ciiu/buscar", params={"q": "4711"}, headers=H)
    check(any(x["codigo"] == "4711" for x in r.json()), "buscar CIIU por código 4711")

    # Responsable externo
    r = c.post("/api/responsables", json={"tipo": "Ext", "nombre": "Laura Gómez", "formacion_academica": 1}, headers=H)
    check(r.status_code == 201, "crear responsable externo"); resp_id = r.json()["id"]

    # Cliente Jurídica con hijas + clave
    payload = {
        "tipo_contribuyente": "Jur", "num_id": "900123456", "razon_social": "Comercializadora Los Andes S.A.S.",
        "software_id": sw_id, "responsable_id": 1, "regimen": "Simple", "regimen_desde": 2021,
        "actividad_ciiu_principal": "6920", "responsable_iva": True, "agente_retenedor": True,
        "objeto_social": "Servicios de asesoría contable y tributaria.", "password": "ClaveDian#2026",
        "servicios": [{"rol_servicio_id": rol_id, "forma_facturacion": "Fa", "periodicidad": "Mes",
                       "valor_servicio": "850000.00", "vendedor": "Cristian C.", "pct_comision": "5.0"}],
        "municipios_ica": [{"municipio_dane": "05001", "municipio": "Medellín", "ciiu": "4711", "exogena_distrital": True}],
    }
    r = c.post("/api/clientes", json=payload, headers=H)
    check(r.status_code == 201, "crear cliente Jur"); cli = r.json(); cid = cli["id"]
    check(cli["dv"] == 8, f"DV calculado (900123456 -> 8), got {cli['dv']}")
    check(cli["nombre"] == "Comercializadora Los Andes S.A.S.", "Jur: nombre = razón social")
    check(cli["tipo_documento"] == "NT", "Jur: tipo_documento forzado a NT")
    check("password" not in cli and cli["tiene_password"] is True, "clave NO se devuelve; tiene_password=True")
    check(len(cli["servicios"]) == 1 and len(cli["municipios_ica"]) == 1, "hijas guardadas")

    # Agente de retención sale del RUT, no de lo que manden. El payload de arriba
    # pide agente_retenedor=True y no trae responsabilidades: sin RUT cargado no
    # se puede afirmar que lo sea ni que no lo sea, así que queda en nulo.
    check(cli["agente_retenedor"] is None,
          f"agente_retenedor ignora lo que mandan: sin RUT queda nulo, got {cli['agente_retenedor']}")

    # Con RUT cargado se calcula solo: 07 = retención a título de renta.
    r = c.put(f"/api/clientes/{cid}", headers=H,
              json={**payload, "agente_retenedor": False,
                    "responsabilidades": [{"codigo": "07", "nombre": "Retención en la fuente"}]})
    check(r.status_code == 200 and r.json()["agente_retenedor"] is True,
          "con 07 en el RUT es agente de retención, aunque manden False")

    # Y un RUT que no trae 07 ni 23 lo deja en False: ahí sí se sabe que no.
    r = c.put(f"/api/clientes/{cid}", headers=H,
              json={**payload, "agente_retenedor": True,
                    "responsabilidades": [{"codigo": "48", "nombre": "IVA"}]})
    check(r.status_code == 200 and r.json()["agente_retenedor"] is False,
          "con RUT sin 07/23 no es agente, aunque manden True")

    # Se deja como estaba para no alterar las pruebas que siguen.
    c.put(f"/api/clientes/{cid}", json=payload, headers=H)

    # num_id duplicado -> 409
    check(c.post("/api/clientes", json=payload, headers=H).status_code == 409, "num_id duplicado = 409")

    # Ver clave (admin)
    r = c.get(f"/api/clientes/{cid}/password", headers=H)
    check(r.status_code == 200 and r.json()["password"] == "ClaveDian#2026", "revelar clave descifrada")

    # Listado con conteos y nombre de responsable
    r = c.get("/api/clientes", headers=H); item = r.json()[0]
    check(item["n_servicios"] == 1 and item["n_municipios"] == 1, "conteos en el listado")
    check(item["software_desc"] == "Siigo", "software resuelto en el listado")

    # Update: cambia estado y agrega un servicio; sin password (no debe borrarla)
    payload["estado"] = "Ina"
    payload["servicios"].append({"rol_servicio_id": rol_id, "forma_facturacion": "CC", "periodicidad": "Anio"})
    del payload["password"]
    r = c.put(f"/api/clientes/{cid}", json=payload, headers=H)
    check(r.status_code == 200 and r.json()["estado"] == "Ina", "update estado=Ina")
    check(len(r.json()["servicios"]) == 2, "update reemplaza hijas (2 servicios)")
    check(c.get(f"/api/clientes/{cid}/password", headers=H).json()["password"] == "ClaveDian#2026",
          "update sin password conserva la clave")

    # Cliente Natural: nombre se arma desde componentes
    natp = {"tipo_contribuyente": "Nat", "tipo_documento": "CC", "num_id": "43256789",
            "primer_apellido": "Martínez", "segundo_apellido": "López",
            "primer_nombre": "Diana", "otros_nombres": "Carolina"}
    r = c.post("/api/clientes", json=natp, headers=H)
    check(r.status_code == 201, "crear cliente Natural")
    check(r.json()["nombre"] == "Martínez López Diana Carolina", "Nat: nombre armado desde componentes")

    # Borrado
    check(c.delete(f"/api/clientes/{cid}", headers=H).status_code == 204, "borrar cliente")
    check(c.delete(f"/api/responsables/{resp_id}", headers=H).status_code == 204, "borrar responsable")

print(f"\n== {ok} verificaciones OK ==")
