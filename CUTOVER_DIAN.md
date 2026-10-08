# Cutover de Documentos DIAN → maestros (Clientes + Responsables)

Apunta la app **Documentos DIAN** (`C:\Users\COMPUMAX\Scrapping-Dian`) a los maestros
compartidos en vez de sus tablas `dian.contribuyente` / `dian.usuario`.

## Estado (4-ago-2026)
- **BD lista:** 255 clientes + 8 responsables migrados (ids preservados). Todas las columnas
  nuevas de `maestros.cliente` y `maestros.usuario` tienen **DEFAULT de servidor** → los INSERT
  parciales de DIAN funcionan. Validado.
- **Código APLICADO** en `backend/app/models.py`: `Contribuyente` → `__tablename__="cliente"` +
  `__table_args__={"schema":"maestros"}`; `Usuario` → `__table_args__={"schema":"maestros"}`.
- **Probado** con el propio venv de DIAN contra el Postgres real: **8 verificaciones OK**
  (lee 255/8 desde maestros, login admin presente, alta ORM cae en maestros.cliente y se borra).
- **NO se ha reiniciado** el servicio → la instancia viva aún corre el código viejo (apunta a
  `dian.contribuyente`). El cambio se activa al reiniciar.

## Por qué NO se tocó `config.py` ni `db.py`
- `config.py`: `search_path=dian` se mantiene; el esquema explícito en los 2 modelos enruta solo
  esas tablas a `maestros`. Las demás (`sesion`, `vencimiento`, `descargalog`) siguen en `dian`.
- `db.py`: las migraciones ligeras (`_migrar_contribuyente_cols`, `_migrar_usuario_foto`,
  `_NUEVAS_COLUMNAS["contribuyente"]`) usan el nombre de tabla **sin esquema** → con
  `search_path=dian` siguen tocando `dian.contribuyente`/`dian.usuario`, que **aún existen** →
  no rompen. Son no-ops (esas columnas ya existen). **Retíralas solo cuando se dropeen las
  tablas viejas** (paso final), o fallarán al no encontrar la tabla.

## Activación (producción) — pendiente
1. **(Seguro) Recoge el delta**: si la instancia viva de DIAN escribió en `dian.contribuyente`
   entre la siembra y ahora, corre otra vez la migración (idempotente):
   `cd "G:\Mi unidad\Maestros CyC\app\backend" && python migrar_desde_dian.py --apply`
2. **Reinicia DIAN** (cierra y vuelve a abrir la app) para que cargue el nuevo mapeo.
3. **Verifica** en DIAN: abre Contribuyentes → deben salir los mismos clientes (ahora desde
   `maestros`); crea/edita uno y confirma que aparece también en la app Maestros.
4. **Rehaz el instalador** (`armar_paquete.ps1`) y publícalo para las demás máquinas.

## Rollback
- Código: `git -C C:\Users\COMPUMAX\Scrapping-Dian checkout backend/app/models.py`
  (o quita los `__table_args__` de los 2 modelos).
- Datos: `dian.contribuyente`/`dian.usuario` están **intactas** (la migración solo leyó de ahí).
  Mientras no se dropeen, se puede volver atrás.

## Lo que NO cambia
- `DescargaLog.contribuyente_id`: sigue igual (int, sin FK; ids preservados) → histórico intacto.
- Login/sesión: `maestros.usuario` tiene los mismos 8 usuarios (id, `usuario`, `password_hash`,
  `rol`) → contraseñas y sesiones siguen funcionando.
- `FERNET_KEY`: la misma → las claves de portal (copiadas verbatim) se descifran igual.

## ⚠️ Aparte del cutover: trabajo sin commitear en el repo DIAN
`Scrapping-Dian` tiene ~4.000 líneas sin commitear (auth, multi-DT, re-skin, routers/motores
nuevos) desde el último commit del 18-jul. Es un riesgo (un `git checkout` las borraría).
**Recomendado: hacer un commit de respaldo** (incluyendo este cutover) antes de seguir.
