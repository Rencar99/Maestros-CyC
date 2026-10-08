import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
// Las tres dependencias de la aplicación entran por un solo archivo, que cada
// una escribe una vez y el kit nunca sobrescribe: en Descargas DIAN el icono
// vive en «./Icon» y en Maestros en «../ui». Sin esta indirección, la misma
// copia no sirve para las dos y vuelven a bifurcarse. Ver cyc-grid-deps.ts.
import { Icon, exportarExcel, toast } from "./cyc-grid-deps";

/** Tipo de columna: define alineación y formato por defecto (Estándar C&C §8). */
export type ColType = "text" | "code" | "date" | "money" | "status" | "actions";

export interface Column<T> {
  key: string;
  label: string;
  type?: ColType;                 // default "text"
  sortable?: boolean;
  filterable?: boolean;
  total?: boolean;                // suma en la fila de totales (columnas numéricas)
  width?: string;                 // ej. "22ch", "180px" — activa elipsis + tooltip
  minWidth?: string;
  align?: "left" | "center" | "right";  // sobreescribe el default del tipo
  className?: string;
  render?: (row: T) => ReactNode; // presentación libre (pills, tags…): sin formato automático
  value?: (row: T) => string | number;  // valor para ordenar/filtrar/copiar
  formatter?: (v: string | number, row: T) => string;
  headerRender?: () => ReactNode; // encabezado libre (ej. casilla "seleccionar todos")
  tip?: (row: T) => string;       // tooltip azul (estándar CyC) por celda, aunque tenga render
  exportOnly?: boolean;           // no se dibuja en la grilla; solo sale en Exportar (ej. CUFE)
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string | number;
  actions?: (row: T) => ReactNode;
  label?: string;                 // nombre accesible de la tabla
  emptyLabel?: string;            // mensaje de estado vacío
  scrollClass?: string;           // clase extra para el contenedor con scroll (ajustar alto)
  onView?: (rows: T[]) => void;   // notifica el orden visible (filtrado + ordenado) para navegación
  defaultTotals?: string[];       // columnas totalizadas desde el inicio (keys)
  actionsLabel?: string;          // encabezado de la columna de acciones (default "Acciones")
  actionsWidth?: string;          // ancho de la columna de acciones (ej. "60px")
  // Si se pasa, los anchos y el ORDEN de columna que el usuario ajuste (arrastrando
  // el borde / la etiqueta, estilo Excel) se guardan por-grilla en localStorage.
  storageKey?: string;
  // Barra de herramientas superior (búsqueda global + exportar). Por defecto
  // ENCENDIDAS (§13: la pantalla no pone su propio buscador ni exportar); una
  // pantalla que ya trae buscador propio las apaga explícitamente (false).
  searchable?: boolean;           // buscador global (cualquier columna, sin tildes)
  exportable?: boolean;           // botón Exportar (Excel/CSV) de la vista actual
  toolbar?: ReactNode;            // contenido extra a la IZQUIERDA (ej. chips de filtro)
  // Fila "activa" (ámbar) que se desplaza sola a la vista, para seguir un proceso.
  activeKey?: string | number | null;
  // Si se pasa, el grid NO dibuja su barra interna de "Limpiar filtros" y en su
  // lugar reporta el estado (activo + función de limpiar) al contenedor.
  onClearbar?: (state: { active: boolean; clear: () => void } | null) => void;
  // Cantidad de columnas (las primeras, en el orden visible) que quedan fijas a la
  // izquierda al desplazarse horizontalmente, como «Inmovilizar paneles» de Excel.
  frozen?: number;
  // Exportar: nombre del archivo (sin extensión; por defecto «label fecha»), subtítulo
  // del Excel y, si se pasa `onExportar`, el archivo se entrega a la pantalla (p. ej. para
  // guardarlo en la carpeta del cliente) en vez de bajarlo a Descargas.
  exportNombre?: string;
  exportSubtitulo?: string;
  onExportar?: (archivo: Blob, filename: string) => Promise<void>;
}

// Ícono estilo Excel (cuadro verde con "X" blanca) para el botón/menú de exportar.
const ExcelIcon = ({ size = 15 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
       style={{ flex: "none", width: size, height: size }}>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#1D6F42" />
    <path d="M8.5 8l7 8M15.5 8l-7 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

// Normaliza para comparar/filtrar: sin tildes, minúsculas (Estándar §5).
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Coincidencia estilo Excel (Estándar §2.1 y §2.2), para el buscador global y el
// buscador del menú de filtro:
//  - Sin comodines: "contiene" (800 → cualquier valor que contenga 800).
//  - "*" = cualquier cantidad de caracteres (800* = empieza por; *800 = termina en).
//  - "?" = exactamente un carácter (80? = 800, 801, 80A…).
//  - Con comodines el patrón se ancla (coincide con TODO el valor); "~*"/"~?" = literal.
// Se memoiza el patrón compilado para no rehacer el regex por cada fila.
let _patCache: { q: string; test: (t: string) => boolean } | null = null;
function coincide(etiqueta: string, q: string): boolean {
  const t = norm(etiqueta);
  const nq = norm(q);
  if (!nq) return true;
  if (_patCache?.q !== nq) {
    if (!/[*?]/.test(nq.replace(/~[*?]/g, ""))) {
      _patCache = { q: nq, test: (x) => x.includes(nq) };
    } else {
      let re = "";
      for (let i = 0; i < nq.length; i++) {
        const c = nq[i];
        if (c === "~" && (nq[i + 1] === "*" || nq[i + 1] === "?")) { re += nq[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
        if (c === "*") { re += ".*"; continue; }
        if (c === "?") { re += "."; continue; }
        re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      const rx = new RegExp("^" + re + "$");
      _patCache = { q: nq, test: (x) => rx.test(x) };
    }
  }
  return _patCache.test(t);
}

const nfMoney = new Intl.NumberFormat("es-CO", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const nfInt = new Intl.NumberFormat("es-CO");

/** ¿La columna ofrece «Totalizar columna» en su menú?
 *
 *  Por estándar (§2.6) toda columna de valor puede totalizarse: no es algo que
 *  la pantalla tenga que pedir. `total` queda para forzarlo en una columna que
 *  no se declaró como dinero, o para apagarlo con `total: false`. */
function admiteTotal<T>(col: Column<T>): boolean {
  return col.total ?? col.type === "money";
}

function alignOf<T>(col: Column<T>): "left" | "center" | "right" {
  if (col.align) return col.align;
  switch (col.type) {
    case "money": return "right";
    case "code": case "date": case "status": case "actions": return "center";
    default: return "left";
  }
}

/** Texto de presentación de una celda según su tipo (cuando no hay render propio). */
function formatCell<T>(col: Column<T>, raw: string | number, row: T): string {
  if (col.formatter) return col.formatter(raw, row);
  if (raw === "" || raw === null || raw === undefined) return "—";
  if (col.type === "money") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.-]/g, ""));
    return isNaN(n) ? String(raw) : "$ " + nfMoney.format(n);
  }
  return String(raw);
}

const VACIO = "—";

/** Bloque de ordenar (Asc/Desc) — estándar Grilla C&C, reutilizado por ambos popovers. */
function SortRow(props: { dir: "asc" | "desc" | null; onSort: (d: "asc" | "desc") => void }) {
  return (
    <div className="fp-sort">
      <button className={props.dir === "asc" ? "on" : ""} onClick={() => props.onSort("asc")}>↑ Ascendente</button>
      <button className={props.dir === "desc" ? "on" : ""} onClick={() => props.onSort("desc")}>↓ Descendente</button>
    </div>
  );
}

/** Casilla "Totalizar columna" (solo aparece si la columna admite totales). */
function TotalRow(props: { on: boolean; onToggle: () => void }) {
  return (
    <label className="fp-totrow">
      <input type="checkbox" checked={props.on} onChange={props.onToggle} />
      Totalizar columna
    </label>
  );
}

/** Popover de filtro: lista los valores DISTINTOS de la columna (multi-selección)
 *  más un buscador para acotar cuando hay muchos (autofiltro tipo Excel, §5). */
function FilterPop(props: {
  label: string;
  distintos: { valor: string; etiqueta: string; count: number }[];
  seleccion: string[];
  x: number; y: number;
  filterable: boolean;
  onToggle: (v: string) => void;
  onSelectAll: (visibles: string[]) => void;
  onClear: () => void;
  sortDir: "asc" | "desc" | null;
  onSort: (d: "asc" | "desc") => void;
  colTotal: boolean;
  totalOn: boolean;
  onToggleTotal: () => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (props.filterable) ref.current?.focus(); }, [props.filterable]);
  const visibles = q
    ? props.distintos.filter((d) => coincide(d.etiqueta, q))
    : props.distintos;
  const sel = new Set(props.seleccion);
  return (
    <div className="filter-pop" role="dialog" aria-label={`Menú de ${props.label}`}
         style={{ position: "fixed", left: Math.max(10, props.x - 230), top: props.y }}>
      <div className="fp-lbl">{props.label}</div>
      <SortRow dir={props.sortDir} onSort={props.onSort} />
      {props.filterable && (
        <>
          <input ref={ref} placeholder="Buscar valor…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="fp-actions">
            <button onClick={() => props.onSelectAll(visibles.map((d) => d.valor))}>Seleccionar {q ? "visibles" : "todos"}</button>
            <button onClick={props.onClear}>Limpiar</button>
          </div>
          <div className="fp-list">
            {visibles.length === 0 && <div className="fp-empty">Sin coincidencias</div>}
            {visibles.map((d) => (
              <label key={d.valor} className="fp-item">
                <input type="checkbox" checked={sel.has(d.valor)} onChange={() => props.onToggle(d.valor)} />
                <span className="fp-item-lbl">{d.etiqueta}</span>
                <span className="fp-item-n">{d.count}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {props.colTotal && <TotalRow on={props.totalOn} onToggle={props.onToggleTotal} />}
    </div>
  );
}

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Checkbox de 3 estados (marcado / parcial / vacío). */
function Tri({ checked, partial, onChange }: { checked: boolean; partial: boolean; onChange: () => void }) {
  const r = useRef<HTMLInputElement>(null);
  useEffect(() => { if (r.current) r.current.indeterminate = partial && !checked; }, [partial, checked]);
  return <input ref={r} type="checkbox" checked={checked} onChange={onChange} />;
}

const TW: React.CSSProperties = { border: "none", background: "none", cursor: "pointer", width: 16, padding: 0, color: "var(--ink-3)", fontSize: 10 };

/** Filtro de FECHA jerárquico tipo Excel: Año → Mes → Día (para columnas type "date",
 *  valores YYYY-MM-DD). Selecciona los valores-hoja; el filtrado del grid no cambia. */
function DateFilterPop(props: {
  label: string;
  distintos: { valor: string; etiqueta: string; count: number }[];
  seleccion: string[];
  x: number; y: number;
  onApply: (vals: string[]) => void;
  onClear: () => void;
  sortDir: "asc" | "desc" | null;
  onSort: (d: "asc" | "desc") => void;
  colTotal: boolean;
  totalOn: boolean;
  onToggleTotal: () => void;
}) {
  const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fechas = props.distintos.filter((d) => esFecha(d.valor));
  const otras = props.distintos.filter((d) => !esFecha(d.valor));
  const [sel, setSel] = useState<Set<string>>(new Set(props.seleccion));
  const [openY, setOpenY] = useState<Set<string>>(() => new Set(fechas.map((f) => f.valor.slice(0, 4))));
  const [openM, setOpenM] = useState<Set<string>>(new Set());

  const arbol = useMemo(() => {
    const y: Record<string, Record<string, { valor: string; count: number }[]>> = {};
    for (const f of fechas) {
      const yr = f.valor.slice(0, 4), mo = f.valor.slice(5, 7);
      (y[yr] ||= {}); (y[yr][mo] ||= []); y[yr][mo].push({ valor: f.valor, count: f.count });
    }
    return y;
  }, [props.distintos]);  // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = (next: Set<string>) => { setSel(new Set(next)); props.onApply([...next]); };
  const toggleVals = (vals: string[]) => {
    const next = new Set(sel);
    const allIn = vals.every((v) => next.has(v));
    vals.forEach((v) => { if (allIn) next.delete(v); else next.add(v); });
    aplicar(next);
  };
  const estado = (vals: string[]) => {
    const n = vals.filter((v) => sel.has(v)).length;
    return { checked: n > 0 && n === vals.length, partial: n > 0 && n < vals.length };
  };
  const toggleOpen = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); setter(n);
  };

  const años = Object.keys(arbol).sort().reverse();
  return (
    <div className="filter-pop" role="dialog" aria-label={`Filtrar por ${props.label}`}
         style={{ position: "fixed", left: Math.max(10, props.x - 240), top: props.y }}>
      <div className="fp-lbl">{props.label}</div>
      <SortRow dir={props.sortDir} onSort={props.onSort} />
      <div className="fp-actions">
        <button onClick={() => aplicar(new Set([...fechas.map((f) => f.valor), ...otras.map((o) => o.valor)]))}>Todos</button>
        <button onClick={() => { setSel(new Set()); props.onClear(); }}>Limpiar</button>
      </div>
      <div className="fp-list">
        {años.map((yr) => {
          const valsY = fechas.filter((f) => f.valor.startsWith(yr)).map((f) => f.valor);
          const stY = estado(valsY);
          const meses = Object.keys(arbol[yr]).sort();
          return (
            <div key={yr}>
              <div className="fp-item" style={{ fontWeight: 600 }}>
                <button style={TW} onClick={() => toggleOpen(openY, setOpenY, yr)}>{openY.has(yr) ? "▾" : "▸"}</button>
                <Tri checked={stY.checked} partial={stY.partial} onChange={() => toggleVals(valsY)} />
                <span className="fp-item-lbl">{yr}</span>
                <span className="fp-item-n">{valsY.length}</span>
              </div>
              {openY.has(yr) && meses.map((mo) => {
                const valsM = arbol[yr][mo].map((d) => d.valor);
                const stM = estado(valsM);
                const mk = yr + "-" + mo;
                return (
                  <div key={mk}>
                    <div className="fp-item" style={{ paddingLeft: 16 }}>
                      <button style={TW} onClick={() => toggleOpen(openM, setOpenM, mk)}>{openM.has(mk) ? "▾" : "▸"}</button>
                      <Tri checked={stM.checked} partial={stM.partial} onChange={() => toggleVals(valsM)} />
                      <span className="fp-item-lbl">{MESES[+mo]}</span>
                      <span className="fp-item-n">{valsM.length}</span>
                    </div>
                    {openM.has(mk) && [...arbol[yr][mo]].sort((a, b) => a.valor.localeCompare(b.valor)).map((d) => (
                      <label key={d.valor} className="fp-item" style={{ paddingLeft: 40 }}>
                        <Tri checked={sel.has(d.valor)} partial={false} onChange={() => toggleVals([d.valor])} />
                        <span className="fp-item-lbl">Día {d.valor.slice(8, 10)}</span>
                        <span className="fp-item-n">{d.count}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
        {otras.map((o) => (
          <label key={o.valor} className="fp-item">
            <Tri checked={sel.has(o.valor)} partial={false} onChange={() => toggleVals([o.valor])} />
            <span className="fp-item-lbl">{o.valor === "" ? VACIO : o.valor}</span>
            <span className="fp-item-n">{o.count}</span>
          </label>
        ))}
      </div>
      {props.colTotal && <TotalRow on={props.totalOn} onToggle={props.onToggleTotal} />}
    </div>
  );
}


export function DataGrid<T>({
  columns: todasCols, rows, getKey, actions, label, emptyLabel, scrollClass, onView,
  defaultTotals, actionsLabel, actionsWidth, storageKey, searchable = true, exportable = true,
  toolbar, onClearbar, activeKey, frozen = 0, exportNombre, exportSubtitulo, onExportar,
}: Props<T>) {
  // Columnas que se dibujan (las `exportOnly` solo viajan al Excel/CSV).
  const columns = useMemo(() => todasCols.filter((c) => !c.exportOnly), [todasCols]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [openFilter, setOpenFilter] = useState<{ key: string; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ r: number; c: number } | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [copiado, setCopiado] = useState(0);
  const [tip, setTip] = useState<{ t: string; x: number; y: number } | null>(null);  // tooltip azul en celda truncada
  const [totals, setTotals] = useState<Record<string, boolean>>(
    () => Object.fromEntries((defaultTotals || []).map((k) => [k, true])));  // columnas totalizadas
  const [q, setQ] = useState("");                 // buscador global (solo si searchable)
  const [expOpen, setExpOpen] = useState(false);  // menú del botón Exportar
  const draggingRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tblRef = useRef<HTMLTableElement>(null);

  // Columnas inmovilizadas: la posición `left` de cada una es la suma de los anchos
  // reales de las anteriores. Se mide tras cada render y solo se guarda si cambió.
  const [frozenLeft, setFrozenLeft] = useState<number[]>([]);
  useLayoutEffect(() => {
    const ths = frozen ? tblRef.current?.querySelectorAll<HTMLElement>("thead th") : undefined;
    const lefts: number[] = [];
    let acc = 0;
    for (let i = 0; ths && i < Math.min(frozen, ths.length); i++) {
      lefts.push(acc); acc += ths[i].getBoundingClientRect().width;
    }
    if (lefts.join() !== frozenLeft.join()) setFrozenLeft(lefts);
  });
  const fz = (i: number) => i < frozenLeft.length
    ? { cls: "col-frozen" + (i === frozenLeft.length - 1 ? " col-frozen-last" : ""), left: frozenLeft[i] }
    : null;

  // Desplaza la fila "activa" a la vista (para seguir un proceso en curso).
  useEffect(() => {
    if (activeKey == null) return;
    wrapRef.current?.querySelector(`tr[data-k="${CSS.escape(String(activeKey))}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  // Anchos de columna ajustables tipo Excel (px), por columna. Persisten si hay storageKey.
  const WKEY = storageKey ? "mx_colw_" + storageKey : "";
  const [colW, setColW] = useState<Record<string, number>>(() => {
    if (!WKEY) return {};
    try { return JSON.parse(localStorage.getItem(WKEY) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    if (!WKEY) return;
    try { localStorage.setItem(WKEY, JSON.stringify(colW)); } catch { /* ignore */ }
  }, [colW, WKEY]);

  // Orden de columnas (reordenable arrastrando la etiqueta del encabezado). Persiste por grilla.
  const ORDKEY = storageKey ? "mx_colord_" + storageKey : "";
  const [colOrder, setColOrder] = useState<string[]>(() => {
    if (!ORDKEY) return columns.map((c) => c.key);
    try { const s = JSON.parse(localStorage.getItem(ORDKEY) || "null"); return Array.isArray(s) && s.length ? s : columns.map((c) => c.key); }
    catch { return columns.map((c) => c.key); }
  });
  useEffect(() => {
    if (!ORDKEY) return;
    try { localStorage.setItem(ORDKEY, JSON.stringify(colOrder)); } catch { /* ignore */ }
  }, [colOrder, ORDKEY]);
  // Columnas en el orden efectivo (las nuevas/no guardadas van al final; ignora llaves obsoletas).
  const ocols = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c] as const));
    const seen = new Set<string>();
    const out: Column<T>[] = [];
    for (const k of colOrder) { const c = byKey.get(k); if (c && !seen.has(k)) { out.push(c); seen.add(k); } }
    for (const c of columns) { if (!seen.has(c.key)) { out.push(c); seen.add(c.key); } }
    return out;
  }, [columns, colOrder]);
  const dragKey = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const reordenar = (destino: string) => {
    const origen = dragKey.current;
    if (!origen || origen === destino) return;
    const base = ocols.map((c) => c.key);
    const sinOrigen = base.filter((k) => k !== origen);
    const idx = sinOrigen.indexOf(destino);
    sinOrigen.splice(idx < 0 ? sinOrigen.length : idx, 0, origen);
    setColOrder(sinOrigen);
  };
  const resetGrid = () => {
    setColW({}); setColOrder(columns.map((c) => c.key));
    try { if (WKEY) localStorage.removeItem(WKEY); if (ORDKEY) localStorage.removeItem(ORDKEY); } catch { /* ignore */ }
  };

  // Arrastrar el borde derecho del encabezado para ensanchar/angostar (estilo Excel).
  const startResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement | null;
    if (!th) return;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => {
      setColW((m) => ({ ...m, [key]: Math.max(56, Math.round(startW + (ev.clientX - startX))) }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("col-resizing"); document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("col-resizing"); document.body.style.userSelect = "none";
  };
  // Doble clic en el borde: auto-ajustar la columna al contenido (mide el texto oculto).
  const autoFit = (key: string, idx: number) => {
    const tbl = tblRef.current; if (!tbl) return;
    let max = 0;
    tbl.querySelectorAll(`tr > *:nth-child(${idx + 1})`).forEach((c) => {
      max = Math.max(max, (c as HTMLElement).scrollWidth);
    });
    if (max > 0) setColW((m) => ({ ...m, [key]: Math.min(640, Math.max(56, max + 26)) }));
  };

  const val = (col: Column<T>, row: T): string => {
    if (col.value) return String(col.value(row));
    const v = (row as Record<string, unknown>)[col.key];
    return v == null ? "" : String(v);
  };

  const toggleSort = (col: Column<T>) => {
    if (!col.sortable) return;
    if (sortKey === col.key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(col.key); setSortDir("asc"); }
  };
  // Ordenar desde el menú de filtro (no depende del flag `sortable`).
  const sortByKey = (key: string, dir: "asc" | "desc") => { setSortKey(key); setSortDir(dir); };

  // Valores distintos de una columna (para el popover de filtro), con conteo.
  const distintosDe = useMemo(() => (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col) return [];
    const m = new Map<string, { count: number; row: T }>();
    for (const r of rows) {
      const v = val(col, r);
      const e = m.get(v);
      if (e) e.count++; else m.set(v, { count: 1, row: r });
    }
    return [...m.entries()]
      // La etiqueta usa el MISMO formato de la celda (money → "$ 1.234", etc.).
      .map(([valor, { count, row }]) => ({
        valor, count, etiqueta: valor === "" ? VACIO : formatCell(col, valor, row),
      }))
      .sort((a, b) => col.type === "money"
        ? Number(a.valor) - Number(b.valor)
        : a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true }));
  }, [rows, columns]);  // eslint-disable-line react-hooks/exhaustive-deps

  let view = [...rows];
  for (const col of columns) {
    const sel = filters[col.key];
    if (sel && sel.length) {
      const set = new Set(sel);
      view = view.filter((r) => set.has(val(col, r)));
    }
  }
  // Buscador global: la fila pasa si ALGUNA columna coincide (sin tildes, con
  // comodines estilo Excel: 800*, *800, 80?), igual que el buscador de columna.
  const qn = searchable ? q.trim() : "";
  if (qn) view = view.filter((r) => columns.some((c) => coincide(val(c, r), qn)));
  if (sortKey) {
    const col = columns.find((c) => c.key === sortKey);
    if (col) {
      view.sort((a, b) => {
        const x = val(col, a), y = val(col, b);
        const nx = Number(x.replace(/[.\s]/g, "")), ny = Number(y.replace(/[.\s]/g, ""));
        let c: number;
        if (!isNaN(nx) && !isNaN(ny) && x !== "" && y !== "") c = nx - ny;
        else c = x.localeCompare(y, "es", { numeric: true });
        return sortDir === "asc" ? c : -c;
      });
    }
  }

  const viewKey = view.map((r) => getKey(r)).join(",");
  useEffect(() => { onView?.(view); }, [viewKey]); // eslint-disable-line

  useEffect(() => {
    if (!openFilter) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".filter-pop") && !t.closest(".filter-ico")) setOpenFilter(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenFilter(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [openFilter]);

  useEffect(() => {
    if (!expOpen) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".grid-export")) setExpOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [expOpen]);

  const clickFilter = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setOpenFilter(openFilter?.key === key ? null : { key, x: r.right, y: r.bottom + 6 });
  };

  const setSel = (key: string, next: string[]) =>
    setFilters((f) => { const c = { ...f }; if (next.length) c[key] = next; else delete c[key]; return c; });
  const toggleVal = (key: string, v: string) => {
    const cur = filters[key] || [];
    setSel(key, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };

  const activos = Object.entries(filters).filter(([, v]) => v.length);
  const limpiarTodos = () => { setFilters({}); setOpenFilter(null); };
  const colCount = columns.length + (actions ? 1 : 0);

  // Reportar al contenedor el estado de filtros (para dibujar "Limpiar filtros" afuera).
  useEffect(() => {
    onClearbar?.(activos.length ? { active: true, clear: () => { setFilters({}); setOpenFilter(null); } } : null);
  }, [activos.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const maxR = view.length - 1;
  const maxC = ocols.length - 1;
  const rect = cursor && anchor ? {
    r0: Math.min(anchor.r, cursor.r), r1: Math.max(anchor.r, cursor.r),
    c0: Math.min(anchor.c, cursor.c), c1: Math.max(anchor.c, cursor.c),
  } : null;
  const enRango = (r: number, c: number) =>
    !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;

  useEffect(() => {
    if (cursor && (cursor.r > maxR || cursor.c > maxC || maxR < 0)) {
      setCursor(null); setAnchor(null);
    }
  }, [maxR, maxC]);  // eslint-disable-line react-hooks/exhaustive-deps

  const seleccionar = (r: number, c: number, extender: boolean) => {
    setCursor({ r, c });
    if (!extender) setAnchor({ r, c });
    wrapRef.current?.focus();
  };

  // Tooltip azul: solo si el texto de la celda está truncado (Estándar §7).
  const cellTip = (e: React.MouseEvent<HTMLTableCellElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth > el.clientWidth + 1) {
      const b = el.getBoundingClientRect();
      setTip({ t: el.innerText, x: Math.min(b.left, window.innerWidth - 340), y: b.bottom + 5 });
    } else if (tip) setTip(null);
  };

  const copiar = async () => {
    if (!rect) return;
    const lineas: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const celdas: string[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) celdas.push(val(ocols[c], view[r]));
      lineas.push(celdas.join("\t"));
    }
    const texto = lineas.join("\n");
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* sin portapapeles */ }
      ta.remove();
    }
    setCopiado((rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1));
    window.setTimeout(() => setCopiado(0), 1400);
  };

  // Valor tipado para exportar: money→número (sumable), date→Date, resto→texto.
  const exportCell = (col: Column<T>, row: T): string | number | Date | null => {
    const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
    if (raw == null || raw === "") return null;
    if (col.type === "money") {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.-]/g, ""));
      return isNaN(n) ? String(raw) : n;
    }
    if (col.type === "date") {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : String(raw);
    }
    return typeof raw === "number" ? raw : String(raw);
  };
  // Exporta la VISTA actual (filtros + búsqueda + orden de filas y de columnas).
  const exportar = (fmt: "xlsx" | "csv") => {
    setExpOpen(false);
    // Fuera las columnas de acciones y las sin título (p. ej. la casilla de selección):
    // una tabla de Excel no admite encabezados vacíos. Las de solo-exportar van detrás de
    // la columna que las precede en la definición (o al final si no hay ninguna visible).
    const orden = [...ocols];
    let previa: Column<T> | null = null;
    for (const c of todasCols) {
      if (!c.exportOnly) { previa = c; continue; }
      const i = previa ? orden.indexOf(previa) : -1;
      if (i < 0) orden.push(c); else orden.splice(i + 1, 0, c);
      previa = c;
    }
    const cols = orden.filter((c) => c.type !== "actions" && (c.label || "").trim());
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = (label || "Datos").replace(/[\\/:*?"<>|]/g, "").trim() || "Datos";
    const base = exportNombre ? exportNombre.replace(/[\\/:*?"<>|]/g, "").trim() : `${nombre} ${fecha}`;
    void exportarExcel({
      filename: `${base}.${fmt}`,
      hoja: nombre, dataset: nombre, formato: fmt, subtitulo: exportSubtitulo, entregar: onExportar,
      columnas: cols.map((c) => ({ header: c.label, type: c.type })),
      filas: view.map((row) => cols.map((c) => exportCell(c, row))),
    }).catch((e) => toast(`No se pudo exportar: ${(e as Error).message}`));
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;
    // Ctrl+Alt+R (con el foco en la grilla): restablecer anchos Y orden de columnas.
    if (meta && e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (Object.keys(colW).length || colOrder.join() !== columns.map((c) => c.key).join()) resetGrid();
      return;
    }
    if (meta && (e.key === "c" || e.key === "C")) { e.preventDefault(); void copiar(); return; }
    if (!cursor) {
      if (maxR >= 0 && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) {
        e.preventDefault(); seleccionar(0, 0, false);
      }
      return;
    }
    if (meta && (e.key === "a" || e.key === "A")) {
      e.preventDefault(); setAnchor({ r: 0, c: 0 }); setCursor({ r: maxR, c: maxC }); return;
    }
    let { r, c } = cursor;
    switch (e.key) {
      case "ArrowUp": r = Math.max(0, r - 1); break;
      case "ArrowDown": r = Math.min(maxR, r + 1); break;
      case "ArrowLeft": c = Math.max(0, c - 1); break;
      case "ArrowRight": c = Math.min(maxC, c + 1); break;
      case "Home": c = 0; if (meta) r = 0; break;
      case "End": c = maxC; if (meta) r = maxR; break;
      case "PageUp": r = 0; break;
      case "PageDown": r = maxR; break;
      case "Escape": setCursor(null); setAnchor(null); return;
      default: return;
    }
    e.preventDefault();
    setCursor({ r, c });
    if (!e.shiftKey) setAnchor({ r, c });
  };

  // ---- Fila de totales (columnas marcadas con total / totalizadas por el usuario) ----
  const hayTotales = columns.some((c) => totals[c.key]);
  const sumaDe = (col: Column<T>) =>
    view.reduce((acc, row) => {
      const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
      const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
      return acc + (isNaN(n) ? 0 : n);
    }, 0);

  // Resalta la coincidencia del buscador global en celdas de texto (sin render propio).
  const resaltar = (txt: string): ReactNode => {
    const term = searchable ? q.trim() : "";
    if (!term) return txt;
    const i = txt.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0) return txt;
    return <>{txt.slice(0, i)}<mark className="grid-mark">{txt.slice(i, i + term.length)}</mark>{txt.slice(i + term.length)}</>;
  };

  const hayToolbar = !!(toolbar || searchable || exportable);
  // Columna cuyo menú ▼ está abierto: se busca una vez y la usan los dos popovers.
  const colMenu = openFilter ? columns.find((c) => c.key === openFilter.key) : undefined;

  return (
    <>
      {hayToolbar && (
        <div className="grid-toolbar">
          {searchable && (
            <div className="grid-search">
              <Icon name="search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la tabla…" aria-label="Buscar en la tabla" />
              {q && <button className="grid-search-x" onClick={() => setQ("")} aria-label="Limpiar búsqueda"><Icon name="x" size={13} /></button>}
            </div>
          )}
          {toolbar}
          {(qn || activos.length > 0) && (
            <span className="grid-count"><b>{view.length}</b> de {rows.length}</span>
          )}
          {activos.length >= 1 && (
            <button className="grid-clr" onClick={limpiarTodos} title="Quitar todos los filtros de columna"><Icon name="broom" size={14} /> Limpiar filtros</button>
          )}
          {exportable && (
            <div className="grid-export">
              <button className="btn sm" onClick={() => exportar("xlsx")} title="Exportar a Excel (la vista actual)" disabled={view.length === 0}>
                <ExcelIcon size={18} /> Exportar
              </button>
              <button className="btn sm grid-export-caret" onClick={() => setExpOpen((o) => !o)}
                      aria-label="Elegir formato" aria-expanded={expOpen} disabled={view.length === 0}>▾</button>
              {expOpen && (
                <div className="grid-export-menu" role="menu">
                  <button role="menuitem" onClick={() => exportar("xlsx")}><ExcelIcon size={14} /> Excel (.xlsx)</button>
                  <button role="menuitem" onClick={() => exportar("csv")}><Icon name="file" size={14} /> CSV</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {!hayToolbar && !onClearbar && activos.length >= 1 && (
        <div className="grid-filterbar">
          <b>{activos.length}</b> columna{activos.length === 1 ? "" : "s"} filtrada{activos.length === 1 ? "" : "s"} · {view.length} resultado{view.length === 1 ? "" : "s"}
          <button className="clr" onClick={limpiarTodos}><Icon name="broom" size={14} /> Limpiar filtros</button>
        </div>
      )}
      <div className={"tbl-wrap grid-scroll" + (scrollClass ? " " + scrollClass : "") + (copiado ? " copy-flash" : "")}
           ref={wrapRef} tabIndex={0} onKeyDown={onGridKey} onScroll={() => tip && setTip(null)}
           onMouseUp={() => { draggingRef.current = false; }}
           onMouseLeave={() => { draggingRef.current = false; setTip(null); }}>
        <table aria-label={label} ref={tblRef}>
          <thead>
            <tr>
              {ocols.map((col, ci) => {
                const ariaSort = col.sortable
                  ? (sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none")
                  : undefined;
                const thW = colW[col.key] ? `${colW[col.key]}px` : col.width;
                const conMenu = col.filterable || admiteTotal(col);
                const f = fz(ci);
                return (
                  <th key={col.key} scope="col" aria-sort={ariaSort as never}
                      className={[col.sortable ? "sortable" : "", "th-move", dragOver === col.key ? "th-drag-over" : "", f?.cls].filter(Boolean).join(" ") || undefined}
                      style={{ textAlign: alignOf(col), width: thW, minWidth: col.minWidth, left: f?.left }}
                      draggable
                      onDragStart={(e) => { dragKey.current = col.key; e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { e.preventDefault(); if (dragKey.current && dragKey.current !== col.key) setDragOver(col.key); }}
                      onDragLeave={() => setDragOver((k) => (k === col.key ? null : k))}
                      onDrop={(e) => { e.preventDefault(); reordenar(col.key); setDragOver(null); dragKey.current = null; }}
                      onDragEnd={() => { setDragOver(null); dragKey.current = null; }}>
                    <span className="th-in">
                      {col.headerRender ? col.headerRender() : (<>
                      <button type="button" className="th-sort" onClick={() => toggleSort(col)}
                              disabled={!col.sortable}>
                        {col.label}
                        {col.sortable && (
                          <span className="sort-arrow" aria-hidden="true">
                            {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        )}
                      </button>
                      {conMenu && (
                        <button type="button" className={"filter-ico" + (filters[col.key]?.length ? " act" : totals[col.key] ? " act tot" : "")}
                                aria-label={`Menú de ${col.label}`} aria-expanded={openFilter?.key === col.key}
                                title="Filtrar / ordenar" onClick={(e) => clickFilter(e, col.key)}>▼</button>
                      )}
                      </>)}
                    </span>
                    <span className="col-resizer" role="separator" aria-hidden="true"
                          title="Arrastra para ajustar · doble clic: auto-ajustar · Ctrl+Alt+R: restablecer"
                          onMouseDown={(e) => startResize(e, col.key)}
                          onDoubleClick={() => autoFit(col.key, ci)} />
                  </th>
                );
              })}
              {actions && <th scope="col" style={{ textAlign: "center", width: actionsWidth }}>{actionsLabel ?? "Acciones"}</th>}
            </tr>
          </thead>
          <tbody>
            {view.map((row, r) => (
              <tr key={getKey(row)} data-k={getKey(row)}
                  className={[cursor?.r === r ? "row-cur" : "", (activeKey != null && getKey(row) === activeKey) ? "row-activo" : ""].filter(Boolean).join(" ") || undefined}>
                {ocols.map((col, c) => {
                  const a = alignOf(col);
                  const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key] as string | number;
                  const neg = col.type === "money" &&
                    (typeof raw === "number" ? raw < 0 : Number(String(raw).replace(/[^\d.-]/g, "")) < 0);
                  const cur = cursor?.r === r && cursor?.c === c;
                  const tdW = colW[col.key] ? `${colW[col.key]}px` : col.width;
                  const f = fz(c);
                  const cls = [
                    col.className,
                    f?.cls,
                    tdW ? "ell" : "",
                    a === "center" ? "al-c" : a === "right" ? "al-r" : "",
                    col.type === "money" ? "money" : "",
                    neg ? "neg" : "",
                    enRango(r, c) ? "cell-sel" : "",
                    cur ? "cell-cur" : "",
                  ].filter(Boolean).join(" ") || undefined;
                  return (
                    <td key={col.key} className={cls} title=""
                        style={{ width: tdW, maxWidth: tdW, minWidth: col.minWidth, left: f?.left }}
                        onMouseDown={(e) => { draggingRef.current = true; seleccionar(r, c, e.shiftKey); }}
                        onMouseEnter={(e) => {
                          if (draggingRef.current) { setCursor({ r, c }); return; }
                          if (col.tip) {
                            const t = col.tip(row);
                            if (t) { const b = e.currentTarget.getBoundingClientRect(); setTip({ t, x: Math.min(b.left, window.innerWidth - 340), y: b.bottom + 5 }); }
                            return;
                          }
                          if (!col.render) cellTip(e);
                        }}
                        onMouseLeave={() => setTip(null)}>
                      {col.render ? col.render(row) : resaltar(formatCell(col, raw ?? "", row))}
                    </td>
                  );
                })}
                {actions && <td className="al-c" style={{ width: actionsWidth }}><div className="act-btns">{actions(row)}</div></td>}
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={colCount} className="grid-empty">
                  {activos.length
                    ? <>No hay registros para los filtros actuales.
                        <button className="clr" onClick={limpiarTodos}><Icon name="broom" size={14} /> Limpiar filtros</button></>
                    : (emptyLabel || "Sin registros.")}
                </td>
              </tr>
            )}
          </tbody>
          {hayTotales && view.length > 0 && (
            <tfoot>
              <tr className="grid-total">
                {ocols.map((col, i) => {
                  const f = fz(i);
                  if (f && !totals[col.key]) return <td key={col.key} className={"tot " + f.cls} style={{ left: f.left }}>{i === 0 ? "Total" : ""}</td>;
                  if (totals[col.key]) {
                    const s = sumaDe(col);
                    // El total se escribe con el mismo formato que las celdas de su columna.
                    const txt = col.formatter ? col.formatter(s, undefined as unknown as T)
                      : col.type === "money" ? "$ " + nfMoney.format(s) : nfInt.format(s);
                    const a = alignOf(col);
                    return <td key={col.key} className={"tot " + (a === "right" || col.type === "money" ? "al-r" : a === "center" ? "al-c" : "")}>{txt}</td>;
                  }
                  return <td key={col.key} className="tot">{i === 0 ? "Total" : ""}</td>;
                })}
                {actions && <td className="tot" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {openFilter && (colMenu?.type === "date" ? (
        <DateFilterPop
          label={colMenu?.label || ""}
          distintos={distintosDe(openFilter.key)}
          seleccion={filters[openFilter.key] || []}
          x={openFilter.x}
          y={openFilter.y}
          onApply={(vals) => setSel(openFilter.key, vals)}
          onClear={() => setSel(openFilter.key, [])}
          sortDir={sortKey === openFilter.key ? sortDir : null}
          onSort={(d) => sortByKey(openFilter.key, d)}
          colTotal={!!colMenu && admiteTotal(colMenu)}
          totalOn={!!totals[openFilter.key]}
          onToggleTotal={() => setTotals((t) => ({ ...t, [openFilter.key]: !t[openFilter.key] }))}
        />
      ) : (
        <FilterPop
          label={colMenu?.label || ""}
          distintos={distintosDe(openFilter.key)}
          seleccion={filters[openFilter.key] || []}
          x={openFilter.x}
          y={openFilter.y}
          filterable={!!colMenu?.filterable}
          onToggle={(v) => toggleVal(openFilter.key, v)}
          onSelectAll={(visibles) => {
            const cur = new Set(filters[openFilter.key] || []);
            visibles.forEach((v) => cur.add(v));
            setSel(openFilter.key, [...cur]);
          }}
          onClear={() => setSel(openFilter.key, [])}
          sortDir={sortKey === openFilter.key ? sortDir : null}
          onSort={(d) => sortByKey(openFilter.key, d)}
          colTotal={!!colMenu && admiteTotal(colMenu)}
          totalOn={!!totals[openFilter.key]}
          onToggleTotal={() => setTotals((t) => ({ ...t, [openFilter.key]: !t[openFilter.key] }))}
        />
      ))}
      {copiado > 0 && (
        <div className="grid-copied" role="status">
          <span aria-hidden="true">✓</span>
          {copiado === 1 ? "Celda copiada" : `${copiado} celdas copiadas`}
        </div>
      )}
      {tip && <div className="utip-pop" style={{ left: tip.x, top: tip.y }}>{tip.t}</div>}
    </>
  );
}
