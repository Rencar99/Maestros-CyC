"""Aplicación FastAPI: API de Maestros + servido del frontend compilado."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, CORS_ORIGINS, VERSION, servidor_info
from .db import init_db
from .routers import (auth, catalogos, clientes, cobros, consultas, facturacion,
                      formularios, parametros, responsables, roles, servidor, sistema)
from .seed import (bootstrap_admin, bootstrap_cargos, bootstrap_ciiu,
                   bootstrap_disparadores_canon, bootstrap_entidades,
                   bootstrap_formas_cobro, bootstrap_formularios, bootstrap_municipios,
                   bootstrap_obligaciones, bootstrap_responsabilidades,
                   bootstrap_roles, bootstrap_tipos_doc)

app = FastAPI(title="Maestros CyC — Clientes y Responsables", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# El control de sesión/rol se hace por endpoint dentro de cada router.
app.include_router(auth.router)
app.include_router(clientes.router)
app.include_router(responsables.router)
app.include_router(catalogos.router)
app.include_router(sistema.router)
app.include_router(facturacion.router)
app.include_router(servidor.router)
app.include_router(consultas.router)
app.include_router(roles.router)
app.include_router(formularios.router)
app.include_router(parametros.router)
app.include_router(cobros.router)


@app.on_event("startup")
def _startup() -> None:
    # Si la base no responde, no bloquear el arranque: la app sube y muestra el
    # error al usarla (el connect_timeout de db.py evita que se cuelgue).
    try:
        init_db()
        bootstrap_admin()
        bootstrap_ciiu()
        bootstrap_cargos()
        bootstrap_entidades()
        bootstrap_obligaciones()
        bootstrap_disparadores_canon()
        bootstrap_formularios()
        bootstrap_tipos_doc()
        bootstrap_responsabilidades()
        bootstrap_formas_cobro()
        bootstrap_roles()
        bootstrap_municipios()
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("uvicorn.error").warning(
            "No se pudo inicializar la base al arrancar: %s. La app sube igual.", exc)


@app.get("/api/health")
def health() -> dict:
    """Estado del servicio + a qué base está conectado (sin credenciales).
    Útil para detectar equipos que quedaron en SQLite local en vez de la BD
    central de la firma."""
    info = {"motor": "desconocido", "host": "", "puerto": 0, "personalizado": False}
    try:
        s = servidor_info()
        info = {
            "motor": "postgres" if s.get("es_postgres") else "sqlite",
            "host": s.get("host") or ("local" if not s.get("es_postgres") else ""),
            "puerto": s.get("puerto") or 0,
            "personalizado": bool(s.get("personalizado")),
        }
    except Exception:  # noqa: BLE001
        pass
    return {"status": "ok", "version": VERSION, "bd": info}


# En producción/escritorio se sirve el frontend compilado (frontend/dist).
class _SPAStatics(StaticFiles):
    async def get_response(self, path: str, scope):  # type: ignore[override]
        resp = await super().get_response(path, scope)
        if path in ("", ".", "index.html") or path.endswith(".html"):
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp


_DIST = BASE_DIR.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", _SPAStatics(directory=str(_DIST), html=True), name="frontend")
