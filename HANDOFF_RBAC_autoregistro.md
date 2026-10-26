# Handoff — Auto-registro de permisos (RBAC compartido)

**Autor:** sesión Maestros CyC · **Fecha:** 2026-10-26 · **Estado:** Fase 1 en Maestros (hecha); Fases 2+ por app.

Para: sesiones de **Calendario**, **Descargas DIAN**, **Liquidador**, **Revisión GL** (y cualquier app futura que gatee funcionalidades por permiso).

---

## 1. Por qué

Hoy el catálogo de permisos (`maestros.permiso`) se siembra desde el **seed de Maestros** (`PERMISOS_CAT`). Cuando otra app quiere gatear una función, hay que agregar su clave a MI seed y liberar Maestros — raro (Maestros define permisos de Calendario) y no escala a 4+ apps.

**Idea:** cada app **declara los permisos que ella misma aplica**; Maestros solo los **muestra y asigna**. Una casilla existe ⇔ una app la registró ⇒ está realmente gateada en algún lado. Sin permisos fantasma, sin typos (la clave sale de la misma constante del código que la app chequea).

**Frontera dura (no se cruza):**
- **Registrar** = escribir filas en `maestros.permiso` (DEFINICIÓN de la clave). Lo hace cada app, de sus propias claves.
- **Asignar** = escribir `maestros.rolpermiso` (quién tiene qué). **SOLO Maestros** (y el puente `_sync_rol`). Una app NUNCA escribe `rolpermiso`. Los grants por defecto de una clave nueva los hace Maestros (reconciliación) o Renzo en la matriz.

---

## 2. Esquema (lo nuevo)

Tabla `maestros.permiso` gana dos columnas (migración idempotente, ya hecha en Maestros `db._ensure_columns`):

| columna | tipo | significado |
|---|---|---|
| `app` | text | qué app es DUEÑA de esa clave (`maestros`, `calendario`, `descargas_dian`, `liquidador`, `revision_gl`). |
| `activo` | bool (default true) | `false` = deprecada (la app la retiró). Se muestra tachada en la matriz; no se borra para no perder asignaciones. |

Backfill (una vez): todo lo existente → `app='maestros'`, salvo `calendario.*` → `app='calendario'`.

`clave` sigue siendo PK (`seccion.accion`) → dos apps NO pueden registrar la misma clave (colisión imposible). Usa secciones propias de tu app (ej. Calendario: `calendario.*`; DIAN: `dian.*` o por módulo).

---

## 3. El contrato de registro (lo que implementa cada app)

En el **arranque del backend** (donde ya inicializas la BD compartida), una función `registrar_permisos()` que:

1. Define TU lista completa de permisos (constante en tu código):
   ```python
   PERMISOS_APP = [
       ("calendario", [("carga", "Ver Carga"), ("generar", "Generar calendarios")]),
       # ("otra_seccion", [("accion", "Etiqueta"), ...]),
   ]
   MI_APP = "calendario"
   ```
2. **Upsert** idempotente de cada clave tuya (refresca etiqueta/orden, marca `activo=true`, `app=MI_APP`):
   ```python
   vivas = set()
   orden = 0
   for sec, accs in PERMISOS_APP:
       for acc, etq in accs:
           clave = f"{sec}.{acc}"; vivas.add(clave)
           p = session.get(Permiso, clave)
           if p is None:
               session.add(Permiso(clave=clave, seccion=sec, accion=acc,
                                    etiqueta=etq, orden=orden, app=MI_APP, activo=True))
           else:
               p.seccion, p.accion, p.etiqueta, p.orden = sec, acc, etq, orden
               p.app, p.activo = MI_APP, True
               session.add(p)
           orden += 1
   # 3. Deprecar SOLO TUS claves que ya no están en la lista (retiraste la función):
   for p in session.exec(select(Permiso).where(Permiso.app == MI_APP)).all():
       if p.clave not in vivas and p.activo:
           p.activo = False; session.add(p)
   session.commit()
   ```

**Reglas:**
- Tocas SOLO filas con `app == MI_APP`. Nunca las de otra app.
- Nunca escribes `rolpermiso` (asignación = Maestros).
- Es idempotente: corre en cada arranque sin efecto si no cambió nada.
- La clave que registras debe ser **exactamente** la que chequeas con `require_perm(...)` / `puede(...)`. Misma constante, una fuente.

### Hacer cumplir (recordatorio, no es parte del registro)
- **Front:** ocultar menú/acción con `puede("<clave>")` (Super→true, o el set de `/me`).
- **Backend:** cerrar la ruta con `require_perm("<clave>")` si la pantalla tiene endpoint **dedicado y sensible**. Si la pantalla es solo un MODO DE RENDER sobre datos que otras pantallas ya exponen legítimamente (caso «Carga» del Calendario: reusa `GET /api/calendario`), el gateo es solo-front y está bien — no inventes un endpoint que romper. Documenta ese caso.

---

## 4. Lo que hace Maestros (no lo tocas tú)

- **Muestra** todas las claves (de todas las apps) en Configuración → Roles y permisos, agrupadas por app/sección; badge "deprecado" en `activo=false`.
- **Asigna**: la matriz escribe `rolpermiso`. Super = todas las claves **activas** (`permisos_de` y la vista `usuario_permiso_efectivo` filtran `activo=true`).
- **Grants por defecto** de una clave nueva de otra app: los decide Renzo en la matriz, o Maestros corre una reconciliación puntual si se acuerda (NUNCA la app).
- Expone el set de permisos del usuario en `/auth/me` (`permisos`), que tu front lee para `puede()`.

---

## 5. Roll-out por fases

- **Fase 0 (hecha):** `calendario.carga/generar` viven en el seed de Maestros y ya funcionan (v1.22.1).
- **Fase 1 (MAESTROS, hecha):** columnas `app`/`activo` + backfill; Maestros etiqueta lo suyo `app='maestros'` y deprecación de sus propias claves retiradas (impl de referencia del contrato); `permisos_de`/vista filtran activos; matriz muestra app + badge. `calendario.*` **retirado del seed de Maestros** (quedan en BD con `app='calendario'`, granted a gestión; esperando que Calendario los registre).
- **Fase 2 (CALENDARIO):** implementar `registrar_permisos()` con `PERMISOS_calendario = [("calendario", [("carga","Ver Carga"),("generar","Generar calendarios")])]` → reafirma la propiedad y el ciclo de vida. Comportamiento idéntico (las claves ya existen); solo cambia el dueño.
- **Fase 3 (DIAN / Liquidador / Revisión GL):** cada una registra su dominio cuando gatee features. DIAN ya tenía pendiente crecer su catálogo (ajustes/sesiones/vencimientos/eventos).

---

## 6. Checklist por app (Fases 2+)

- [ ] Constante `PERMISOS_<app>` + `MI_APP` en tu código.
- [ ] `registrar_permisos()` en el arranque (sección 3), tocando solo `app == MI_APP`.
- [ ] `/auth/me` + login devuelven `permisos = sorted(permisos_de(session, user))` (si aún no).
- [ ] `puede(clave)` en el front (Super→true o `perms.has(clave)`).
- [ ] `require_perm("<clave>")` en endpoints dedicados sensibles (no en modos de render sobre data ya expuesta).
- [ ] Probar: rol sin el permiso → no ve el menú (+ 403 si hay endpoint); Super/rol con el permiso → sí.
- [ ] Avisar a Maestros al liberar (para que Renzo asigne / verifique la matriz).

---

## 7. Notas / bordes

- `activo=false` no borra filas → no se pierden asignaciones; si reactivas la función, vuelve a `true` sola.
- Una clave deprecada que un rol aún tenga en `rolpermiso` es inofensiva (nada la aplica); la matriz la muestra tachada para que Renzo la limpie.
- Colisión de secciones entre apps: imposible por PK, pero usa nombres de sección propios para no confundir la matriz.
- Identificadores ESTABLES: `clave` de permiso y `codigo_calendario` de formulario no se renombran sin avisar a las apps (ver `rbac-roles-permisos` en memoria).
