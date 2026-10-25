import { useState } from "react";
import { api } from "./api";

/** Estado + lógica para revelar/ocultar claves cifradas en una grilla (mapa
 *  id→clave en claro). El endpoint de revelado lo inyecta cada pantalla (global
 *  vs por-cliente). Fuente única del patrón "clic en el ojo → GET /revelar". */
export function useReveladas(revelarUrl: (id: number) => string, toast: (m: string, e?: boolean) => void) {
  const [reveladas, setReveladas] = useState<Record<number, string>>({});
  const toggle = async (id: number) => {
    if (reveladas[id] !== undefined) {                         // ya visible → ocultar
      setReveladas((x) => { const n = { ...x }; delete n[id]; return n; });
      return;
    }
    try { const r: any = await api.get(revelarUrl(id)); setReveladas((x) => ({ ...x, [id]: r.clave || "" })); }
    catch (e: any) { toast(e.message, true); }
  };
  const ocultar = () => setReveladas({});
  return { reveladas, toggle, ocultar, setReveladas };
}
