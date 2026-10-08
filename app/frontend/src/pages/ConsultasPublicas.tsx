import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../ui";
import { useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";

/** Menú "Consultas" (consumo): en UNA sola vista, un dropdown con las consultas
 *  compartidas con el rol del usuario; al elegir una se ejecuta y el resultado
 *  aparece en la Grilla CyC abajo. La autoría vive en "Generar Consultas" (Super).
 *  El backend aplica el alcance por asignación al ejecutar. */

interface Pub { id: number; nombre: string; descripcion: string }
interface ColInfo { nombre: string; etiqueta: string; tipo: string }
interface ResPub {
  nombre: string; columnas: ColInfo[]; filas: Record<string, any>[];
  total: number; truncado: boolean; limite: number;
}

const NUMERICOS = new Set(["entero", "decimal"]);
const FECHAS = new Set(["fecha", "fecha y hora"]);

function pinta(v: any, tipo: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (tipo === "booleano") return v === true || v === "true" || v === 1 ? "Sí" : "No";
  if (FECHAS.has(tipo)) {
    const s = String(v).replace(" ", "T");
    const [f, h] = s.split("T");
    const p = f.split("-");
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}` + (tipo === "fecha y hora" && h ? ` ${h.slice(0, 5)}` : "");
    return s;
  }
  if (NUMERICOS.has(tipo)) return Number(v).toLocaleString("es-CO");
  return String(v);
}

export function ConsultasPublicas() {
  const toast = useToast();
  const [lista, setLista] = useState<Pub[]>([]);
  const [selId, setSelId] = useState("");
  const [res, setRes] = useState<ResPub | null>(null);
  const [corriendo, setCorriendo] = useState(false);

  useEffect(() => {
    api.get("/consultas/publicadas").then((l: Pub[]) => setLista(l)).catch((e: any) => toast(e.message, true));
  }, []); // eslint-disable-line

  const ejecutar = (id: string) => {
    setSelId(id);
    if (!id) { setRes(null); return; }
    setCorriendo(true);
    api.post(`/consultas/publicadas/${id}/ejecutar`)
      .then((r: ResPub) => setRes({ ...r, filas: r.filas.map((f, i) => ({ ...f, __i: i })) }))
      .catch((e: any) => { toast(e.message, true); setRes(null); })
      .finally(() => setCorriendo(false));
  };

  const exportar = () => {
    if (!selId) return;
    api.downloadPost(`/consultas/publicadas/${selId}/exportar`, {}, `Consulta_${sel?.nombre || selId}.xlsx`)
      .catch((e: any) => toast(e.message, true));
  };

  const sel = lista.find((p) => String(p.id) === selId);

  const colsRes: Column<Record<string, any>>[] = useMemo(() => {
    if (!res) return [];
    return res.columnas.map((c) => ({
      key: c.nombre,
      label: c.etiqueta,
      sortable: true,
      filterable: true,
      align: NUMERICOS.has(c.tipo) ? "right" : FECHAS.has(c.tipo) || c.tipo === "booleano" ? "center" : "left",
      width: c.tipo === "texto" ? "32ch" : undefined,
      value: (r) => {
        const v = r[c.nombre];
        if (v === null || v === undefined) return "";
        return NUMERICOS.has(c.tipo) ? Number(v) : String(v);
      },
      formatter: (_v, r) => pinta(r[c.nombre], c.tipo),
    }));
  }, [res]);

  return (
    <div className="cpub">
      <div className="card">
        <div className="cpub-bar2">
          <span className="cpub-title"><Icon name="search" size={18} />Consultas disponibles</span>
          <select className="cpub-select" value={selId} onChange={(e) => ejecutar(e.target.value)}
                  disabled={!lista.length} title="Elige una consulta para ejecutar">
            <option value="">{lista.length ? "Elige una consulta…" : "No tienes consultas disponibles"}</option>
            {lista.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {sel?.descripcion && <span className="cpub-seldesc" title={sel.descripcion}>{sel.descripcion}</span>}
          <span className="cpub-spacer" />
          {res && <span className="cpub-count"><b>{res.total}</b> fila{res.total === 1 ? "" : "s"}{res.truncado ? ` · tope ${res.limite}` : ""}</span>}
          <button className="btn sm" onClick={exportar} disabled={!res || corriendo}>
            <Icon name="down" size={14} />Exportar Excel</button>
        </div>
        {res
          ? <DataGrid columns={colsRes} rows={res.filas} getKey={(r) => r.__i}
                      label={sel?.nombre || "Consulta"} scrollClass="cons-scroll"
                      emptyLabel="La consulta no devolvió filas." />
          : <div className="cpub-empty">
              {corriendo ? "Ejecutando…" : "Elige una consulta arriba para ver los resultados."}
            </div>}
      </div>
    </div>
  );
}
