# HANDOFF → Maestros CyC · Cerebro de obligaciones por cliente

**Origen:** sesión de **Calendario CyC** (2026-09-25). Acuerdo de arquitectura cerrado con Renzo.
**Para:** una sesión de **Maestros CyC** (`G:\Mi unidad\Maestros CyC`).

## Decisión (acordada con Renzo)
Se quita la **duplicación** de "qué obligaciones tiene un cliente" (hoy se decide en dos lados:
la pestaña *Otras Obligaciones* de Maestros **y** la derivación de Calendario). Reparto definitivo:

- **Maestros = el QUÉ y el QUIÉN (cerebro):**
  1. **Dueño del catálogo de obligaciones** de la firma (`ObligacionTipo`: código, descripción, ente,
     criterio, periodicidad). Hoy vive en Calendario → **debe pasar a ser referencia de Maestros**
     (o que Maestros sea su dueño de escritura y Calendario lo lea).
  2. **Asignación por cliente** = **una sola lista** "obligaciones del cliente" = lo **derivado de sus
     atributos** + lo **manual** (la vieja *Otras Obligaciones* se fusiona aquí). Maestros la mantiene
     (materializada en la tabla `clienteobligacion`, o expuesta por endpoint) para que Calendario la lea.
- **Calendario = el CUÁNDO y el CÓMO VA (consume):** fechas por año (`plazovencimiento`), festivos,
  "Generar año", cumplimiento (`obligacioncumplimiento`) y las vistas (Maestro / Por cliente / Vista mes).
  **Deja de derivar**; solo lee catálogo + asignación desde Maestros y les pone fechas y estado.

## Qué debe construir Maestros
1. **Ser dueño del catálogo `ObligacionTipo`** (o exponerlo como referencia). Campos de generación que
   son de Calendario (`modo_generacion`, `paso_dias_habiles`) pueden quedarse como columnas que solo
   Calendario usa — a decidir en el diseño de Maestros.
2. **Motor de aplicabilidad por cliente** (mover la lógica que hoy está en Calendario, ver abajo) →
   producir, por cliente activo, la lista de `obligacion_tipo` que le aplican, **derivadas + manuales**,
   en una sola fuente que Calendario consuma.
3. **UI:** la ficha del cliente muestra sus obligaciones (derivadas, solo-lectura + manuales editables);
   *Otras Obligaciones* se reabsorbe aquí. Nada de asignar obligaciones en dos lados.

## Reglas de derivación EXACTAS (ya implementadas y probadas en Calendario — reutilizar, no reinventar)
Fuente: `G:\Mi unidad\Calendario CyC\app\backend\app\routers\calendario.py` → `_obligaciones_dian(c)` y
`_es_informante_exogena(c)`. Todas leen atributos que **ya son de Maestros** (`cliente`):
- **Renta / RST (excluyentes):** `regimen == "Simple"` → **RST** + **RST_ANT**; si no, Gran Contribuyente
  (`gran_contribuyente`) → **RENTA_GC**; si no, `tipo_contribuyente == "Jur"` → **RENTA_JUR**;
  `"Nat"` → **RENTA_NAT**.
- **Retención:** `agente_retenedor` → **RETEFUENTE**.
- **IVA:** `responsable_iva` + `periodicidad_iva` (`"Bimestral"`→**IVA_BIM**, `"Cuatrimestral"`→**IVA_CUAT**).
- **Exógena nacional:** Informante de exógena = responsabilidad RUT casilla 53 **código "14"** en
  `cliente.responsabilidades` → **EXOG_GC** si Gran Contribuyente, si no **EXOG_OC**.
- **ICA municipal (por diseñar):** por cada fila de `clientemunicipioica` del cliente, aplica la(s)
  obligación(es) de ese municipio (modelo propuesto: un calendario/ente por ciudad, obligación etiquetada
  con `municipio_dane`); si la fila tiene `exogena_distrital` → aplica además la Exógena distrital de esa
  ciudad. **OJO:** `clientemunicipioica.municipio` viene **mezclado** (unos DANE, otros nombre/vacío) →
  **normalizar a DANE** con la tabla `municipio` antes de derivar.

Códigos reales en catálogo: `RETEFUENTE, IVA_BIM, IVA_CUAT, RENTA_JUR, RENTA_NAT, RENTA_GC, RST, RST_ANT,
EXOG_OC, EXOG_GC` (exógena es `EXOG_OC`/`EXOG_GC`, no "EXOGENA").

## Contrato con Calendario (lo que Calendario espera leer)
- Catálogo `ObligacionTipo` (por id/código).
- Asignación **cliente → [obligacion_tipo_id]** (derivada + manual, unificada). Hoy Calendario lee
  `clienteobligacion` para lo manual y deriva el resto; el objetivo es que **todo** venga de Maestros.
- Base compartida (esquema `maestros`), enlaces por id — sin API intermedia (patrón ya usado).

## Lo que NO cambia / se queda en Calendario
`plazovencimiento` (fechas por año), `anclaperiodo`, `festivoexcepcion`, `obligacioncumplimiento`,
el motor `plazos_gen.py` + "Generar año", y las vistas del calendario.

## Actualización 2026-09-25 (Renzo confirmó)
- El **catálogo de obligaciones se administra SOLO en Maestros**. Se **retiró de Calendario** su pestaña
  "Configuración → Calendarios" (crear/renombrar/reasignar) para no duplicar; Calendario ahora **solo lee**
  el catálogo. En Config de Calendario queda solo *Festivos*.
- **Falta en el editor de Obligaciones de Maestros:** además de Criterio y Disparador, exponer dos campos
  de generación que ya existen en la tabla `obligaciontipo` (los agregó Calendario): **`tam_intervalo`**
  (tamaño del intervalo de NIT por grupo — nit2: de a 2, 5…) y **`paso_dias_habiles`** (paso: días hábiles
  que avanza por grupo, default 1). Son propiedades estables de la obligación. Calendario los **muestra
  solo-lectura** en Generar y respeta que Maestros es el dueño de escritura.
- Modelo de generación de Calendario (para contexto): **secuencia** = ancla + `paso` días hábiles por
  grupo (grupos según criterio + `tam_intervalo`); **fija** = una fecha corrida a hábil. Calendario genera
  las FECHAS; Maestros define el catálogo (incl. estos parámetros).

## Coordinación
Cuando Maestros defina la fuente única de "obligaciones del cliente", **avisar a la sesión de Calendario**
para: (1) retirar `_obligaciones_dian`/derivación de `calendario.py` y leer de Maestros; (2) confirmar el
formato del contrato. Alinear con mockup antes de codear (estilo de la firma).
