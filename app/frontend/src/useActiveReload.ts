import { useEffect, useRef } from "react";
import { dataEpoch } from "./api";

/** Recarga al ACTIVARSE la pestaña, pero evitando el refetch en cada regreso sin
 *  cambios. Llama `load()` cuando la página se vuelve activa SOLO si:
 *   · hubo ESCRITURAS (el `dataEpoch` subió) desde la última carga —aquí o en otra
 *     pestaña—, o
 *   · cambió alguna de las `deps` extra (p. ej. el período de Cuentas de cobro).
 *  La App mantiene las páginas montadas (keep-alive); este hook cubre el montaje
 *  (la primera vez siempre carga) y los regresos. Nunca queda stale: cualquier
 *  mutación invalida; a lo sumo una recarga de más tras una edición propia. */
export function useActiveReload(active: boolean, load: () => void, deps: unknown[] = []) {
  const last = useRef<{ epoch: number; deps: unknown[] }>({ epoch: -1, deps: [] });
  useEffect(() => {
    if (!active) return;
    const ep = dataEpoch();
    const depsChanged = deps.length !== last.current.deps.length
      || deps.some((d, i) => d !== last.current.deps[i]);
    if (ep === last.current.epoch && !depsChanged) return;
    load();
    last.current = { epoch: ep, deps };
    // `load` y `deps` entran por valor; el efecto se reevalúa con active + deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}
