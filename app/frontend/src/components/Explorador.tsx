import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon, useToast } from "../ui";
import { Modal } from "./Modal";

interface Item { nombre: string; ruta: string; modificado?: string; tipo?: string; tamano?: string; }
interface Data { ruta: string; padre: string; raiz: string; es_raiz: boolean; carpetas: Item[]; archivos: Item[]; }

/** Explorador de carpetas/archivos de la máquina local (app por-equipo). Abre en
 *  la carpeta de la firma y permite subir a cualquier unidad del equipo.
 *  modo "carpeta": selecciona la carpeta actual. modo "archivo": selecciona un archivo.
 *  Interacción: un clic SELECCIONA la fila (y enfoca la lista para teclado); doble
 *  clic ENTRA a la carpeta / elige el archivo. Con la lista enfocada: ↑/↓ mueven la
 *  selección, Enter entra/elige, y escribir letras salta a la fila que coincide. */
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
  const [sel, setSel] = useState<string>("");        // ruta de la fila seleccionada
  const listRef = useRef<HTMLDivElement>(null);
  const buf = useRef<{ s: string; t: number }>({ s: "", t: 0 });   // buffer de type-ahead

  const cargar = (ruta: string) => {
    setCargando(true); setFiltro(""); setSel("");
    api.get(`/sistema/explorar?ruta=${encodeURIComponent(ruta)}&solo_carpetas=${modo === "carpeta"}&libre=${libre}`)
      .then((d: Data) => setData(d))
      .catch((e: any) => toast(e.message, true))
      .finally(() => { setCargando(false); setTimeout(() => listRef.current?.focus(), 0); });
  };
  useEffect(() => { cargar(""); }, []); // eslint-disable-line

  const q = filtro.trim().toLowerCase();
  const carpetas = (data?.carpetas || []).filter((c) => !q || c.nombre.toLowerCase().includes(q));
  const archivos = (data?.archivos || []).filter((a) => !q || a.nombre.toLowerCase().includes(q));
  const items: Item[] = [...carpetas, ...(modo === "archivo" ? archivos : [])];
  const esCarpeta = (it: Item) => carpetas.some((c) => c.ruta === it.ruta);

  // Entra a la carpeta o elige el archivo (doble clic / Enter).
  const activar = (it: Item) => {
    if (esCarpeta(it)) cargar(it.ruta);
    else { onSelect(it.ruta); onClose(); }
  };
  // Clic simple: selecciona la fila y pasa el foco a la lista (para el teclado).
  const seleccionar = (ruta: string) => { setSel(ruta); listRef.current?.focus(); };

  // La fila seleccionada se trae a la vista.
  useEffect(() => {
    if (!sel) return;
    listRef.current?.querySelector(`[data-k="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    const idx = items.findIndex((it) => it.ruta === sel);
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((items[Math.min(idx + 1, items.length - 1)] || items[0]).ruta); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((items[Math.max(idx - 1, 0)] || items[items.length - 1]).ruta); }
    else if (e.key === "Home") { e.preventDefault(); setSel(items[0].ruta); }
    else if (e.key === "End") { e.preventDefault(); setSel(items[items.length - 1].ruta); }
    else if (e.key === "Enter") { e.preventDefault(); const it = items[idx]; if (it) activar(it); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Búsqueda por tecla: acumula las letras escritas (se reinicia tras una pausa).
      const now = Date.now();
      buf.current.s = (now - buf.current.t < 800 ? buf.current.s : "") + e.key.toLowerCase();
      buf.current.t = now;
      const p = buf.current.s;
      const hit = items.find((it) => it.nombre.toLowerCase().startsWith(p))
        || items.find((it) => it.nombre.toLowerCase().includes(p));
      if (hit) { setSel(hit.ruta); e.preventDefault(); }
    }
  };

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
           aviso={modo === "carpeta" ? "Doble clic para entrar · «Seleccionar» toma la carpeta elegida (o la actual)." : "Doble clic en un archivo para elegirlo."}
           onSave={modo === "carpeta" ? () => { const t = sel || data?.ruta; if (t) { onSelect(t); onClose(); } } : undefined}
           canSave={!!(sel || data?.ruta)} saveLabel="Seleccionar esta carpeta" saveIcon="check">
      <div className="expl-bar">
        <button className="btn sm" disabled={!data || data.es_raiz} onClick={() => data && cargar(data.padre)} title="Subir">
          <Icon name="arrow-up" size={15} />
        </button>
        <div className="expl-path" title={data?.ruta}>{data ? rutaCorta(data.ruta) : "…"}</div>
        <div className="search" style={{ width: 210 }}><Icon name="search" size={15} /><input placeholder="Filtrar en esta carpeta…" value={filtro} onChange={(e) => setFiltro(e.target.value)} /></div>
      </div>

      <div className="expl-list" ref={listRef} tabIndex={0} onKeyDown={onKey}>
        <div className="expl-hd"><span /><span>Nombre ({carpetas.length}{modo === "archivo" ? "+" + archivos.length : ""})</span><span>Tipo</span><span>Modificado</span></div>
        {cargando && <div className="expl-empty">Cargando…</div>}
        {!cargando && !carpetas.length && !archivos.length && <div className="expl-empty">{q ? "Sin coincidencias" : "Carpeta vacía"}</div>}
        {carpetas.map((c) => (
          <div key={c.ruta} data-k={c.ruta} className={"expl-row" + (sel === c.ruta ? " sel" : "")}
               onClick={() => seleccionar(c.ruta)} onDoubleClick={() => cargar(c.ruta)}>
            <Icon name="folder" size={17} />
            <span className="expl-name">{c.nombre}</span>
            <span className="expl-col">Carpeta</span>
            <span className="expl-col">{c.modificado || ""}</span>
          </div>
        ))}
        {modo === "archivo" && archivos.map((a) => (
          <div key={a.ruta} data-k={a.ruta} className={"expl-row file" + (sel === a.ruta ? " sel" : "")}
               onClick={() => seleccionar(a.ruta)} onDoubleClick={() => { onSelect(a.ruta); onClose(); }}>
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
