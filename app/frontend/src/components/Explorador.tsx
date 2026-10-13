import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon, useToast } from "../ui";
import { Modal } from "./Modal";

interface Item { nombre: string; ruta: string; modificado?: string; tipo?: string; tamano?: string; }
interface Data { ruta: string; padre: string; raiz: string; es_raiz: boolean; carpetas: Item[]; archivos: Item[]; }

/** Explorador de carpetas/archivos de la máquina local (app por-equipo). Abre en
 *  la carpeta de la firma y permite subir a cualquier unidad del equipo.
 *  modo "carpeta": selecciona la carpeta actual. modo "archivo": selecciona un archivo. */
export function Explorador({ modo, onSelect, onClose, libre = true }: {
  modo: "carpeta" | "archivo";
  onSelect: (ruta: string) => void;
  onClose: () => void;
  libre?: boolean;   // navegar todo el equipo (abre en la carpeta de la firma; se puede subir a cualquier unidad)
}) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState("");

  const cargar = (ruta: string) => {
    setCargando(true); setFiltro("");
    api.get(`/sistema/explorar?ruta=${encodeURIComponent(ruta)}&solo_carpetas=${modo === "carpeta"}&libre=${libre}`)
      .then((d: Data) => setData(d))
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  };
  useEffect(() => { cargar(""); }, []); // eslint-disable-line

  const q = filtro.trim().toLowerCase();
  const carpetas = (data?.carpetas || []).filter((c) => !q || c.nombre.toLowerCase().includes(q));
  const archivos = (data?.archivos || []).filter((a) => !q || a.nombre.toLowerCase().includes(q));

  const rutaCorta = (r: string) => {
    if (!r) return libre ? "Este equipo" : "…";
    if (!data) return r;
    // dentro de la carpeta de la firma → ruta relativa corta; fuera → ruta completa
    if (data.raiz && r.startsWith(data.raiz)) return "…\\" + r.replace(data.raiz, "").replace(/^[\\/]+/, "");
    return r;
  };

  return (
    <Modal title={modo === "carpeta" ? "Elegir carpeta" : "Elegir archivo"} icon="folder" size="md"
           onClose={onClose}
           aviso={modo === "carpeta" ? "Clic para entrar; «Seleccionar» toma la carpeta actual." : "Clic en un archivo para elegirlo."}
           onSave={modo === "carpeta" ? () => { if (data?.ruta) { onSelect(data.ruta); onClose(); } } : undefined}
           canSave={!!data?.ruta} saveLabel="Seleccionar esta carpeta" saveIcon="check">
      <div className="expl-bar">
        <button className="btn sm" disabled={!data || data.es_raiz} onClick={() => data && cargar(data.padre)} title="Subir">
          <Icon name="arrow-up" size={15} />
        </button>
        <div className="expl-path" title={data?.ruta}>{data ? rutaCorta(data.ruta) : "…"}</div>
        <div className="search" style={{ width: 210 }}><Icon name="search" size={15} /><input placeholder="Filtrar en esta carpeta…" value={filtro} onChange={(e) => setFiltro(e.target.value)} /></div>
      </div>

      <div className="expl-list">
        <div className="expl-hd"><span /><span>Nombre ({carpetas.length}{modo === "archivo" ? "+" + archivos.length : ""})</span><span>Tipo</span><span>Modificado</span></div>
        {cargando && <div className="expl-empty">Cargando…</div>}
        {!cargando && !carpetas.length && !archivos.length && <div className="expl-empty">{q ? "Sin coincidencias" : "Carpeta vacía"}</div>}
        {carpetas.map((c) => (
          <div key={c.ruta} className="expl-row" onClick={() => cargar(c.ruta)}>
            <Icon name="folder" size={17} />
            <span className="expl-name">{c.nombre}</span>
            <span className="expl-col">Carpeta</span>
            <span className="expl-col">{c.modificado || ""}</span>
          </div>
        ))}
        {modo === "archivo" && archivos.map((a) => (
          <div key={a.ruta} className="expl-row file" onClick={() => { onSelect(a.ruta); onClose(); }}>
            <Icon name="file" size={16} />
            <span className="expl-name">{a.nombre}</span>
            <span className="expl-col">{a.tipo}{a.tamano ? ` · ${a.tamano}` : ""}</span>
            <span className="expl-col">{a.modificado || ""}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
