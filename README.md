# Maestros CyC — Catálogo General de Clientes + Responsables

App interna de **maestros compartidos** de la firma (fuente única de verdad de
**Clientes** y **Responsables**) que consumirán Documentos DIAN, Revisión GL y
apps futuras. Mismo stack e identidad que Documentos DIAN.

- **Stack:** FastAPI + SQLModel + Postgres (esquema `maestros`) · frontend React + Vite (DataGrid, identidad Cardona Apps).
- **Base:** la misma base compartida de la firma; `search_path=maestros`.
- **Seguridad:** clave de portal DIAN cifrada con Fernet (misma `FERNET_KEY` de la firma); contraseñas de usuarios internos con Argon2; sesiones JWT.

## Estructura
```
Maestros CyC/
  app/
    backend/
      .env.example        # copiar a .env
      app/
        config.py         # conexión, esquema maestros, Fernet, sesión
        security.py       # cifrado/hash/JWT (patrón firma)
        db.py             # engine + init_db (crea el esquema y tablas)
        models.py         # ← MODELO DE DATOS (6 tablas)
```

## Modelo de datos (7 tablas)
- `rolservicio`, `software` — catálogos editables por el usuario.
- `ciiu` — catálogo de referencia (actividades DIAN), **sembrado desde `seed_data/ciiu.csv`** (no hardcodeado); no editable por el usuario común.
- `usuario` — Responsables (internos con login / externos).
- `cliente` — catálogo ancho de clientes.
- `clienteservicio` — servicios comerciales por cliente (N).
- `clientemunicipioica` — municipios donde declara ICA (N).

Detalle y decisiones: `..\Claude Code\DISENO_Maestros_Clientes.md`.

## Cómo correr (dev)
```
cd app/backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # editar CARDONA_DATABASE_URL y FERNET_KEY
uvicorn app.main:app --reload
```
Sin `.env` cae a SQLite local. Admin inicial: `admin` / `admin` (cambio obligatorio).
Prueba de humo de la API: `python test_api.py` (usa SQLite temporal).
Prueba del constructor de consultas: `python test_consultas.py` (SQLite temporal, 56 verificaciones).

## Runbook de migración de siembra (dian → maestros)
Corre contra el **Postgres compartido** (necesita `.env` con `CARDONA_DATABASE_URL` y `FERNET_KEY`).
1. **Backup** de la base (obligatorio).
2. Simulacro (no escribe): `python migrar_desde_dian.py`
3. Aplicar: `python migrar_desde_dian.py --apply`
4. Verificar en la app (grilla de Clientes / Responsables).

Notas: preserva `id` (sigue válido `DescargaLog.contribuyente_id`); copia `password_enc` sin descifrar; idempotente (se puede recorrer varias veces). Los **componentes de nombre de las personas naturales quedan vacíos** (se completan al re-leer el RUT o a mano). Mientras DIAN 1.1.4 siga escribiendo en `dian.contribuyente`, repetir el paso 3 al hacer el cutover recoge el delta.

## Estado / pendientes
- [x] Modelo de datos (`models.py`) validado (crea las 7 tablas).
- [x] Catálogo CIIU sembrado desde `seed_data/ciiu.csv` (`seed.py` → `bootstrap_ciiu`, idempotente). **Pendiente: reemplazar la muestra (26) por la lista oficial DIAN completa.**
- [x] `schemas.py` (entrada/salida; la clave nunca se devuelve).
- [x] Routers CRUD: clientes (+ hijas servicios/municipios), responsables, catálogos.
- [x] Auth (login/JWT/cambiar clave) + `deps` (rol) + seed admin.
- [x] Cálculo del `dv` (algoritmo DIAN, `util.py`).
- [x] Nombre de Nat armado desde componentes; Jur ⇒ NT.
- [x] Prueba end-to-end (`test_api.py`): **26 verificaciones OK** sobre SQLite.
- [ ] GRANT por columna (excluir `password_enc` a Revisión GL) — al pasar a Postgres.
- [x] **Migración de siembra** (`migrar_desde_dian.py`): dian → maestros preservando `id`, clave verbatim, idempotente, dry-run por defecto. Probada (`test_migracion.py`, 12 OK) y **APLICADA en Postgres real (4-ago-2026): 255 clientes + 8 responsables, ids preservados (0 desalineados)**. El esquema `maestros` ya vive en la base compartida con datos reales.
- [x] **Constructor de consultas** (`routers/consultas.py` + `pages/Consultas.tsx`) — fase 1:
      tablas → campos → filtros → resultados, sin escribir SQL. **Solo Super Usuario**, solo el
      esquema `maestros`. El cliente nunca envía SQL: manda la consulta estructurada y el servidor
      la arma (identificadores validados contra el catálogo real, valores como parámetros
      vinculados, transacción READ ONLY con `statement_timeout`, tope de 5.000 filas). Columnas
      sensibles ocultas (`password_hash`, `password_enc`, `clave_enc`) y blobs base64 (`foto`,
      `logo`). Exporta a Excel. Probado (`test_consultas.py`, **56 OK**) y **en la app en vivo**.
      Pendiente fase 2: JOINs por llave foránea, agrupar/totalizar y guardar consultas con nombre.
- [x] **Frontend real (React + Vite + TS)** — identidad Cardona Apps, `DataGrid` (orden + autofiltro con conteos + totalizar), login/JWT, páginas Clientes (grilla + ficha con 8 pestañas, hijas, CIIU con búsqueda, logo), Responsables y Catálogos. **Compila** (`tsc` + `vite build`) y **probado en vivo** por HTTP (login, crear cliente 201 con DV, listar, CIIU).
- [ ] Botón real "ubicar archivo/carpeta" (necesita capa de escritorio; hoy es campo de texto).
- [ ] Control de sesión única (tabla `Sesion`, como DIAN) — opcional MVP.
- [ ] Lista oficial CIIU completa antes de producción.

## Frontend (dev)
> **No desarrollar el frontend sobre Google Drive**: `node_modules` (miles de archivos) rompe la sincronización de Drive. Clona/copia el proyecto a una carpeta **local** para `npm install` y `npm run dev`.
```
cd app/frontend
npm install
npm run dev        # http://localhost:5173, proxy /api -> :8000
npm run build      # genera dist/ (lo sirve el backend)
```
