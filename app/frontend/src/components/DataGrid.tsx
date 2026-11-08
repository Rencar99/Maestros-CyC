import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
// Las tres dependencias de la aplicación entran por un solo archivo, que cada
// una escribe una vez y el kit nunca sobrescribe: en Descargas DIAN el icono
// vive en «./Icon» y en Maestros en «../ui». Sin esta indirección, la misma
// copia no sirve para las dos y vuelven a bifurcarse. Ver cyc-grid-deps.ts.
import { Icon, exportarExcel, toast } from "./cyc-grid-deps";
// Lo que el componente necesita para cumplir el estándar por sí mismo: el asa
// de columnas y el menú de totales. El resto de la tabla sigue vistiéndose con
// la hoja del aplicativo.
import "./cyc-grid-react.css";

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
  hideable?: boolean;             // el usuario puede ocultarla (botón «Columnas»); default true
  defaultHidden?: boolean;        // arranca oculta: así una grilla ancha cabe sin barra horizontal (§2.8)
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
  // Alto de fila elástico (mín. 23 px) para que en el alto disponible quepa un número
  // entero de filas: la última nunca queda cortada. Lo usan las grillas a pantalla llena.
  fitRows?: boolean;
  // Desplazamiento continuo (§2.9): con más de 150 filas se dibujan solo las que se
  // ven. Se apaga con `virtual={false}`, solo en una grilla que nunca crece.
  virtual?: boolean;
  // Sub-filas expandibles: `renderSubRow(row)` se dibuja en un <tr> extra bajo la fila
  // cuando su clave está en `expandedKeys`. El control (chevron) lo pone la pantalla en
  // una celda. Mientras haya alguna abierta, la tabla se dibuja completa (sin ventana):
  // las sub-filas rompen el alto uniforme que exige el desplazamiento continuo.
  expandedKeys?: Set<string | number>;
  renderSubRow?: (row: T) => ReactNode;
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
  // Grilla de selección (§2.15): clase extra por fila (resaltar/atenuar) y clic en la
  // fila. `onRowClick` IGNORA el clic cuando sale de un button/a interno (para no
  // chocar con la columna de acciones) y queda en `click` (no mousedown) para no
  // comerse la selección de texto/arrastre.
  rowClass?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
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
// Un solo Collator para todo el componente: `localeCompare(…, opciones)` por par
// de filas arma uno nuevo cada vez y con 10.000 filas el orden tardaba segundos.
const collator = new Intl.Collator("es", { numeric: true });

// Desde cuántas filas se dibuja solo la ventana visible (más un margen arriba y
// abajo). Por debajo la tabla se dibuja completa, como siempre.
const VIRTUAL_DESDE = 150;
const MARGEN_FILAS = 12;

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
/* Totales por columna (Estándar §2.6). Suma, Máximo, Mínimo y Promedio solo
   tienen sentido donde hay valores; los dos recuentos sirven en cualquier
   columna, también de texto, que es donde más se usan en un maestro. */
export type FuncionTotal = "suma" | "maximo" | "minimo" | "promedio" | "recuento" | "recuento_unico";

const MENU_VALORES = ["suma", "-", "maximo", "minimo", "-", "promedio",
  "-", "recuento", "recuento_unico", "-", "ninguno"] as const;
const MENU_TEXTO = ["recuento", "recuento_unico", "-", "ninguno"] as const;

/** La marca que queda en el encabezado cuando la columna está totalizada. */
const MARCA_TOTAL: Record<FuncionTotal, string> = {
  suma: "Σ", maximo: "máx", minimo: "mín", promedio: "x̄", recuento: "n", recuento_unico: "n≠",
};
const ETIQUETA_TOTAL: Record<FuncionTotal, string> = {
  suma: "Suma", maximo: "Máximo", minimo: "Mínimo", promedio: "Promedio",
  recuento: "Recuento", recuento_unico: "Recuento único",
};

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
  onHide?: () => void;
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
      {props.onHide && <button type="button" className="fp-hide" onClick={props.onHide}>Ocultar esta columna</button>}
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
    </div>
  );
}


/** Iconos del menú de columnas. Van dentro del componente porque no todos los
 *  aplicativos tienen `columns`, `eye`, `eye-off` o `lock` en su Icon. */
function KitIcon({ name, size = 14 }: { name: "columns" | "eye" | "eye-off" | "lock"; size?: number }) {
  const p = {
    columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
    eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    "eye-off": <><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.6 18.6 0 0 1 5.1-5.9M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2" /><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20" /></>,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  }[name];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
  );
}

/** Resalta la coincidencia del buscador global en un texto plano (celdas sin
 *  render propio). A nivel de módulo para que la fila memoizada dependa solo del
 *  término, una primitiva estable. */
function resaltarTerm(txt: string, term: string): ReactNode {
  if (!term) return txt;
  const i = txt.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return txt;
  return <>{txt.slice(0, i)}<mark className="grid-mark">{txt.slice(i, i + term.length)}</mark>{txt.slice(i + term.length)}</>;
}

/** Fila de la grilla, MEMOIZADA (viene de Maestros 1.22.0, auditoría B3). El cuerpo
 *  solo se recalcula si cambia algo PROPIO de la fila: el hover en otra celda, el
 *  cursor en otra fila, el menú de totales o el aviso de copiado llegan como las
 *  mismas props y `memo` la salta. Cursor y selección entran como PRIMITIVAS
 *  (rowCur/curC/selC0/selC1), no como objetos nuevos por render. Complementa el
 *  desplazamiento continuo: este recorta cuántas filas se dibujan; `memo`, cuántas
 *  de las dibujadas se vuelven a calcular. Ojo: si una pantalla pinta con `render`
 *  algo que depende de su estado, debe darle a `columns` (o a `actions`) una
 *  identidad nueva cuando ese estado cambie; si no, la fila no se entera. */
interface GridRowProps<T> {
  row: T;
  rowKey: string | number;
  r: number;
  ocols: Column<T>[];
  colW: Record<string, number>;
  frozenLeft: number[];
  rowCur: boolean;        // el cursor está en esta fila
  curC: number;           // columna del cursor si rowCur, si no -1
  selC0: number;          // rango de columnas seleccionado en esta fila, -1 si ninguna
  selC1: number;
  activo: boolean;        // fila "activa" (ámbar) que sigue un proceso
  rowExtra: string;       // clase extra de la pantalla (rowClass)
  term: string;           // término del buscador global para resaltar
  actions?: (row: T) => ReactNode;
  actionsWidth?: string;
  onRowClick?: (row: T) => void;
  onCellDown: (r: number, c: number, shift: boolean) => void;
  onCellEnter: (r: number, c: number, col: Column<T>, row: T, e: React.MouseEvent<HTMLTableCellElement>) => void;
  onCellLeave: () => void;
}

function GridRowInner<T>(p: GridRowProps<T>) {
  const { row, ocols, colW, frozenLeft, r } = p;
  const fz = (i: number) => i < frozenLeft.length
    ? { cls: "col-frozen" + (i === frozenLeft.length - 1 ? " col-frozen-last" : ""), left: frozenLeft[i] }
    : null;
  const trClass = [
    p.rowCur ? "row-cur" : "",
    p.activo ? "row-activo" : "",
    p.rowExtra,
    p.onRowClick ? "row-click" : "",
  ].filter(Boolean).join(" ") || undefined;
  return (
    <tr data-k={p.rowKey}
        onClick={p.onRowClick ? (e) => { if (!(e.target as HTMLElement).closest("button, a")) p.onRowClick!(row); } : undefined}
        className={trClass}>
      {ocols.map((col, c) => {
        const a = alignOf(col);
        const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key] as string | number;
        const neg = col.type === "money" &&
          (typeof raw === "number" ? raw < 0 : Number(String(raw).replace(/[^\d.-]/g, "")) < 0);
        const cur = p.rowCur && p.curC === c;
        const sel = p.selC0 >= 0 && c >= p.selC0 && c <= p.selC1;
        const tdW = colW[col.key] ? `${colW[col.key]}px` : col.width;
        const f = fz(c);
        const cls = [
          col.className, f?.cls, tdW ? "ell" : "",
          a === "center" ? "al-c" : a === "right" ? "al-r" : "",
          col.type === "money" ? "money" : "", neg ? "neg" : "",
          sel ? "cell-sel" : "", cur ? "cell-cur" : "",
        ].filter(Boolean).join(" ") || undefined;
        return (
          <td key={col.key} className={cls} title=""
              style={{ width: tdW, maxWidth: tdW, minWidth: col.minWidth, left: f?.left }}
              onMouseDown={(e) => p.onCellDown(r, c, e.shiftKey)}
              onMouseEnter={(e) => p.onCellEnter(r, c, col, row, e)}
              onMouseLeave={p.onCellLeave}>
            {col.render ? col.render(row) : resaltarTerm(formatCell(col, raw ?? "", row), p.term)}
          </td>
        );
      })}
      {p.actions && <td className="al-c" style={{ width: p.actionsWidth }}><div className="act-btns">{p.actions(row)}</div></td>}
    </tr>
  );
}
const GridRow = memo(GridRowInner) as typeof GridRowInner;

export function DataGrid<T>({
  columns: todasCols, rows, getKey, actions, label, emptyLabel, scrollClass, onView,
  defaultTotals, actionsLabel, actionsWidth, storageKey, searchable = true, exportable = true,
  toolbar, onClearbar, activeKey, frozen = 0, exportNombre, exportSubtitulo, onExportar,
  rowClass, onRowClick, fitRows, virtual: virtualProp = true, expandedKeys, renderSubRow,
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
  // Qué función tiene puesta cada columna. `defaultTotals` sigue recibiendo
  // keys y significa Suma, que es lo que hacía antes de existir el menú.
  const [totals, setTotals] = useState<Record<string, FuncionTotal>>(
    () => Object.fromEntries((defaultTotals || []).map((k) => [k, "suma" as FuncionTotal])));
  const [menuTotal, setMenuTotal] = useState<string | null>(null);  // ▼ abierto en el pie
  const [q, setQ] = useState("");                 // buscador global (solo si searchable)
  const [expOpen, setExpOpen] = useState(false);  // menú del botón Exportar
  const draggingRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tblRef = useRef<HTMLTableElement>(null);
  // Ventana visible (solo con muchas filas): dónde va el scroll, cuánto se ve y el
  // alto real de una fila, medido de las que se dibujan.
  const [scrollY, setScrollY] = useState(0);
  const [altoVista, setAltoVista] = useState(600);
  const [altoFila, setAltoFila] = useState(24);
  const rafScroll = useRef(0);

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
    const tr = wrapRef.current?.querySelector(`tr[data-k="${CSS.escape(String(activeKey))}"]`);
    if (tr) tr.scrollIntoView({ block: "nearest" });
    else verFila(view.findIndex((r) => getKey(r) === activeKey));
  }, [activeKey]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  // La función de total elegida se recuerda por pantalla (Estándar §2.6).
  const TOTKEY = storageKey ? "mx_coltot_" + storageKey : "";
  useEffect(() => {
    if (!TOTKEY) return;
    try {
      const guardado = JSON.parse(localStorage.getItem(TOTKEY) || "null");
      if (guardado && typeof guardado === "object") setTotals(guardado);
    } catch { /* ignore */ }
    // Solo al montar: después manda lo que elija el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOTKEY]);
  useEffect(() => {
    if (!TOTKEY) return;
    try { localStorage.setItem(TOTKEY, JSON.stringify(totals)); } catch { /* ignore */ }
  }, [totals, TOTKEY]);

  // Orden de columnas (reordenable desde el asa del encabezado). Persiste por grilla.
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

  // Columnas OCULTAS por el usuario (botón «Columnas» y menú ▼), viene del Calendario.
  // Se guardan las ocultas y las conocidas: así una columna nueva aparece según su
  // `defaultHidden` y no según lo que el usuario eligió antes de que existiera. Acepta
  // el formato viejo del Calendario (solo la lista de ocultas).
  const VISKEY = storageKey ? "mx_colvis_" + storageKey : "";
  const ocultable = (c: Column<T>) => c.hideable !== false && c.type !== "actions" && !!c.label;
  const [vis, setVis] = useState<{ h: string[]; k: string[] }>(() => {
    const porDefecto = { h: columns.filter((c) => c.defaultHidden && ocultable(c)).map((c) => c.key), k: columns.map((c) => c.key) };
    if (!VISKEY) return porDefecto;
    try {
      const g = JSON.parse(localStorage.getItem(VISKEY) || "null");
      if (Array.isArray(g)) return { h: g, k: columns.map((c) => c.key) };
      if (g && Array.isArray(g.h) && Array.isArray(g.k)) return g;
    } catch { /* ignore */ }
    return porDefecto;
  });
  useEffect(() => {
    // Columnas que llegan después: se agregan a las conocidas con su `defaultHidden`.
    const nuevas = columns.filter((c) => !vis.k.includes(c.key));
    if (nuevas.length) setVis((v) => ({
      h: [...v.h, ...nuevas.filter((c) => c.defaultHidden && ocultable(c)).map((c) => c.key)],
      k: [...v.k, ...nuevas.map((c) => c.key)],
    }));
  }, [columns]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!VISKEY) return;
    try { localStorage.setItem(VISKEY, JSON.stringify(vis)); } catch { /* ignore */ }
  }, [vis, VISKEY]);
  const [colsOpen, setColsOpen] = useState(false);   // menú del botón «Columnas»
  const hiddenSet = useMemo(
    () => new Set(vis.h.filter((k) => columns.some((c) => c.key === k && ocultable(c)))),
    [vis, columns]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Columnas que se dibujan: orden del usuario, sin las ocultas. Indexan cursor, copia,
  // totales, búsqueda y exportación.
  const vcols = useMemo(() => ocols.filter((c) => !hiddenSet.has(c.key)), [ocols, hiddenSet]);
  const elegibles = ocols.filter(ocultable);
  // Ocultar una columna le quita su filtro: un filtro invisible esconde filas sin explicación.
  const ocultarCol = (key: string) => {
    setVis((v) => (v.h.includes(key) ? v : { ...v, h: [...v.h, key] }));
    setFilters((f) => { if (!f[key]) return f; const c = { ...f }; delete c[key]; return c; });
  };
  const toggleCol = (key: string) => {
    if (hiddenSet.has(key)) setVis((v) => ({ ...v, h: v.h.filter((k) => k !== key) }));
    else ocultarCol(key);
  };
  const mostrarTodas = () => setVis((v) => ({ ...v, h: [] }));

  const dragKey = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // La columna de acciones queda fija al final: ni se mueve ni recibe otra
  // encima (Estándar §2.5).
  const esAccion = (col: Column<T>) => col.type === "actions";
  const reordenar = (destino: string) => {
    const origen = dragKey.current;
    if (!origen || origen === destino) return;
    const colDestino = ocols.find((c) => c.key === destino);
    if (colDestino && esAccion(colDestino)) return;
    const base = ocols.map((c) => c.key);
    const sinOrigen = base.filter((k) => k !== origen);
    const idx = sinOrigen.indexOf(destino);
    sinOrigen.splice(idx < 0 ? sinOrigen.length : idx, 0, origen);
    setColOrder(sinOrigen);
  };
  // Mover con el teclado: ← y → cuando el asa tiene el foco (Estándar §2.5).
  const moverCon = (key: string, paso: -1 | 1) => {
    const base = ocols.map((c) => c.key);
    const i = base.indexOf(key);
    const j = i + paso;
    if (i < 0 || j < 0 || j >= base.length) return;
    if (esAccion(ocols[j])) return;
    [base[i], base[j]] = [base[j], base[i]];
    setColOrder(base);
  };
  const resetGrid = () => {
    setColW({}); setColOrder(columns.map((c) => c.key));
    setVis({ h: columns.filter((c) => c.defaultHidden && ocultable(c)).map((c) => c.key), k: columns.map((c) => c.key) });
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
        : collator.compare(a.etiqueta, b.etiqueta));
  }, [rows, columns]);  // eslint-disable-line react-hooks/exhaustive-deps

  // El buscador espera a que se deje de escribir: con miles de filas, filtrar en
  // cada tecla congelaba la escritura. Borrar la búsqueda aplica en el acto.
  const [qBusca, setQBusca] = useState("");
  useEffect(() => {
    if (!q.trim()) { setQBusca(""); return; }
    const t = window.setTimeout(() => setQBusca(q), 180);
    return () => window.clearTimeout(t);
  }, [q]);
  // Buscador global: la fila pasa si ALGUNA columna coincide (sin tildes, con
  // comodines estilo Excel: 800*, *800, 80?), igual que el buscador de columna.
  const qn = searchable ? qBusca.trim() : "";

  // La vista (filtros + búsqueda + orden) se calcula solo cuando cambia algo de
  // eso, no en cada render (marcar una casilla, mover el cursor, pasar el mouse).
  const view = useMemo(() => {
    let v = [...rows];
    for (const col of columns) {
      const sel = filters[col.key];
      if (sel && sel.length) {
        const set = new Set(sel);
        v = v.filter((r) => set.has(val(col, r)));
      }
    }
    if (qn) v = v.filter((r) => vcols.some((c) => coincide(val(c, r), qn)));
    const col = sortKey ? columns.find((c) => c.key === sortKey) : undefined;
    if (col) {
      // Cada valor se lee y se convierte una sola vez, no en cada comparación.
      const llaves = v.map((r) => {
        const x = val(col, r);
        const n = x === "" ? NaN : Number(x.replace(/[.\s]/g, ""));
        return { r, x, n };
      });
      const signo = sortDir === "asc" ? 1 : -1;
      llaves.sort((a, b) => signo * (!isNaN(a.n) && !isNaN(b.n) ? a.n - b.n : collator.compare(a.x, b.x)));
      v = llaves.map((k) => k.r);
    }
    return v;
  }, [rows, columns, vcols, filters, qn, sortKey, sortDir]);  // eslint-disable-line react-hooks/exhaustive-deps

  const viewKey = useMemo(() => view.map((r) => getKey(r)).join(","), [view]);  // eslint-disable-line react-hooks/exhaustive-deps
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

  // El ▼ del pie se cierra igual que el del encabezado: clic fuera o Escape.
  useEffect(() => {
    if (!menuTotal) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".cyc-grid-summary")) setMenuTotal(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuTotal(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [menuTotal]);

  useEffect(() => {
    if (!colsOpen) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".grid-cols")) setColsOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setColsOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [colsOpen]);

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
  const colCount = vcols.length + (actions ? 1 : 0);

  // Reportar al contenedor el estado de filtros (para dibujar "Limpiar filtros" afuera).
  useEffect(() => {
    onClearbar?.(activos.length ? { active: true, clear: () => { setFilters({}); setOpenFilter(null); } } : null);
  }, [activos.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const maxR = view.length - 1;

  // ---- Ventana visible: con muchas filas se dibujan solo las que se ven (más un
  // margen) y el resto va como relleno del mismo alto, para que la barra de scroll
  // se comporte igual que con la tabla completa. Exige una línea por fila.
  const virtual = virtualProp && view.length > VIRTUAL_DESDE && !(renderSubRow && expandedKeys?.size);
  const altoCabeza = tblRef.current?.tHead?.offsetHeight ?? 0;
  let vIni = 0, vFin = view.length;
  if (virtual) {
    vIni = Math.max(0, Math.floor((scrollY - altoCabeza) / altoFila) - MARGEN_FILAS);
    vFin = Math.min(view.length, vIni + Math.ceil(altoVista / altoFila) + 2 * MARGEN_FILAS);
  }
  // El rayado de la aplicación va por posición (tr:nth-child(even)): con el relleno
  // de arriba, cada fila conserva la paridad que tendría en la tabla completa.
  const rellenoPar = virtual && vIni % 2 === 0;
  useLayoutEffect(() => {
    if (!virtual) return;
    const tr = tblRef.current?.tBodies[0]?.querySelector<HTMLElement>("tr[data-k]");
    const h = tr?.getBoundingClientRect().height ?? 0;
    if (h > 0 && Math.abs(h - altoFila) > 0.25) setAltoFila(h);
  });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const medir = () => setAltoVista(wrap.clientHeight);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);
  const alScroll = () => {
    if (tip) setTip(null);
    if (!virtual || rafScroll.current) return;
    rafScroll.current = requestAnimationFrame(() => {
      rafScroll.current = 0;
      if (wrapRef.current) setScrollY(wrapRef.current.scrollTop);
    });
  };
  // Lleva la fila `r` a la vista sin depender de que esté dibujada.
  const verFila = (r: number) => {
    const wrap = wrapRef.current;
    if (!wrap || r < 0) return;
    const pie = tblRef.current?.tFoot?.offsetHeight ?? 0;
    const arriba = r * altoFila;
    const abajo = arriba + altoFila + altoCabeza + pie;
    if (arriba < wrap.scrollTop) wrap.scrollTop = arriba;
    else if (abajo > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = abajo - wrap.clientHeight;
  };
  const maxC = vcols.length - 1;
  const rect = cursor && anchor ? {
    r0: Math.min(anchor.r, cursor.r), r1: Math.max(anchor.r, cursor.r),
    c0: Math.min(anchor.c, cursor.c), c1: Math.max(anchor.c, cursor.c),
  } : null;

  useEffect(() => {
    if (cursor && (cursor.r > maxR || cursor.c > maxC || maxR < 0)) {
      setCursor(null); setAnchor(null);
    }
  }, [maxR, maxC]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Handlers de celda ESTABLES (useCallback): usan solo setters de estado y refs,
  // así las props de cada fila memoizada no cambian de identidad entre renders.
  const seleccionar = useCallback((r: number, c: number, extender: boolean) => {
    setCursor({ r, c });
    if (!extender) setAnchor({ r, c });
    wrapRef.current?.focus();
  }, []);
  const onCellDown = useCallback((r: number, c: number, shift: boolean) => {
    draggingRef.current = true; seleccionar(r, c, shift);
  }, [seleccionar]);
  const onCellLeave = useCallback(() => setTip(null), []);
  // Tooltip azul: `col.tip` explícito, o solo si el texto de la celda está truncado
  // (Estándar §7). Arrastrando, extiende la selección.
  const onCellEnter = useCallback((r: number, c: number, col: Column<T>, row: T, e: React.MouseEvent<HTMLTableCellElement>) => {
    if (draggingRef.current) { setCursor({ r, c }); return; }
    if (col.tip) {
      const t = col.tip(row);
      if (t) { const b = e.currentTarget.getBoundingClientRect(); setTip({ t, x: Math.min(b.left, window.innerWidth - 340), y: b.bottom + 5 }); }
      return;
    }
    if (!col.render) {
      const el = e.currentTarget;
      if (el.scrollWidth > el.clientWidth + 1) {
        const b = el.getBoundingClientRect();
        setTip({ t: el.innerText, x: Math.min(b.left, window.innerWidth - 340), y: b.bottom + 5 });
      } else setTip((old) => (old ? null : old));
    }
  }, []);

  const copiar = async () => {
    if (!rect) return;
    const lineas: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const celdas: string[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) celdas.push(val(vcols[c], view[r]));
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
    const orden = [...vcols];
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
    // Ctrl+Alt+R (con el foco en la grilla): restablecer anchos, orden y columnas ocultas.
    if (meta && e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (Object.keys(colW).length || colOrder.join() !== columns.map((c) => c.key).join() || hiddenSet.size) resetGrid();
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
    verFila(r);
  };

  // ---- Fila de totales (columnas marcadas con total / totalizadas por el usuario) ----
  const crudoDe = (col: Column<T>, row: T) =>
    col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
  const numerosDe = (col: Column<T>) =>
    view.map((row) => {
      const raw = crudoDe(col, row);
      return typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
    }).filter((n) => !isNaN(n));
  /* Los recuentos cuentan LO QUE SE VE y sin las celdas vacías (Estándar §2.6).
     Todo se calcula sobre `view`, que ya trae búsqueda y filtros aplicados. */
  const textosDe = (col: Column<T>) =>
    view.map((row) => String(crudoDe(col, row) ?? "").trim()).filter((t) => t !== "");

  const totalDe = (col: Column<T>, fn: FuncionTotal): { valor: number; entero: boolean } => {
    if (fn === "recuento") return { valor: textosDe(col).length, entero: true };
    if (fn === "recuento_unico") return { valor: new Set(textosDe(col)).size, entero: true };
    const ns = numerosDe(col);
    if (!ns.length) return { valor: 0, entero: false };
    if (fn === "suma") return { valor: ns.reduce((a, n) => a + n, 0), entero: false };
    if (fn === "maximo") return { valor: Math.max(...ns), entero: false };
    if (fn === "minimo") return { valor: Math.min(...ns), entero: false };
    return { valor: ns.reduce((a, n) => a + n, 0) / ns.length, entero: false };
  };

  const hayToolbar = !!(toolbar || searchable || exportable);
  useEffect(() => {
    const wrap = wrapRef.current, tbl = tblRef.current;
    if (!fitRows || !wrap || !tbl) return;
    const MIN = 23;
    const ajustar = () => {
      const alto = wrap.clientHeight - (tbl.tHead?.offsetHeight ?? 0) - (tbl.tFoot?.offsetHeight ?? 0);
      const n = Math.max(1, Math.floor(alto / MIN));
      const h = Math.floor((alto / n) * 100) / 100;
      tbl.style.setProperty("--row-h", `${h}px`);
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitRows, view.length]);

  // Columna cuyo menú ▼ está abierto: se busca una vez y la usan los dos popovers.
  const colMenu = openFilter ? columns.find((c) => c.key === openFilter.key) : undefined;

  return (
    <>
      {hayToolbar && (
        <div className="grid-toolbar">
          {searchable && (
            <div className="grid-search">
              <Icon name="search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la tabla…" aria-label="Buscar en la tabla"
                     autoComplete="off" name="grid-buscar" spellCheck={false} />
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
          {elegibles.length > 1 && (
            <div className="grid-cols">
              <button className={"btn sm grid-cols-btn" + (hiddenSet.size ? " on" : "")} onClick={() => setColsOpen((o) => !o)}
                      aria-expanded={colsOpen} aria-label="Columnas"
                      title={hiddenSet.size ? `Columnas · ${hiddenSet.size} oculta${hiddenSet.size === 1 ? "" : "s"}` : "Mostrar u ocultar columnas"}>
                <KitIcon name="columns" size={16} />
              </button>
              {colsOpen && (
                <div className="grid-cols-menu" role="menu">
                  <div className="grid-cols-head">
                    <KitIcon name="columns" size={14} />
                    <span>Columnas</span>
                    <span className="grid-cols-count">{vcols.filter(ocultable).length}/{elegibles.length}</span>
                  </div>
                  <div className="grid-cols-list">
                    {elegibles.map((c) => {
                      const visible = !hiddenSet.has(c.key);
                      const bloqueada = visible && vcols.filter(ocultable).length <= 1;   // nunca sin columnas
                      return (
                        <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={visible}
                                className={"grid-cols-item" + (visible ? "" : " off")}
                                disabled={bloqueada} onClick={() => toggleCol(c.key)}>
                          <span className="gc-eye"><KitIcon name={visible ? "eye" : "eye-off"} size={14} /></span>
                          <span className="grid-cols-name">{c.label}</span>
                          {bloqueada && <span className="gc-lock" title="Debe quedar al menos una columna visible"><KitIcon name="lock" size={12} /></span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid-cols-foot">
                    <button className="grid-cols-all" disabled={hiddenSet.size === 0} onClick={mostrarTodas}>
                      <KitIcon name="eye" size={13} /> Mostrar todas
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {exportable && (
            <div className="grid-export">
              <button className="btn sm grid-export-main" onClick={() => exportar("xlsx")} title="Exportar a Excel (la vista actual)" aria-label="Exportar a Excel" disabled={view.length === 0}>
                <ExcelIcon size={18} />
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
           ref={wrapRef} tabIndex={0} onKeyDown={onGridKey} onScroll={alScroll}
           onMouseUp={() => { draggingRef.current = false; }}
           onMouseLeave={() => { draggingRef.current = false; setTip(null); }}>
        <table aria-label={label} ref={tblRef}>
          <thead>
            <tr>
              {vcols.map((col, ci) => {
                const ariaSort = col.sortable
                  ? (sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none")
                  : undefined;
                const thW = colW[col.key] ? `${colW[col.key]}px` : col.width;
                const conMenu = !!col.filterable;
                const f = fz(ci);
                return (
                  <th key={col.key} scope="col" aria-sort={ariaSort as never}
                      className={[col.sortable ? "sortable" : "", "th-move", dragOver === col.key ? "th-drag-over" : "", f?.cls].filter(Boolean).join(" ") || undefined}
                      style={{ textAlign: alignOf(col), width: thW, minWidth: col.minWidth, left: f?.left }}
                      onDragOver={(e) => { e.preventDefault(); if (dragKey.current && dragKey.current !== col.key) setDragOver(col.key); }}
                      onDragLeave={() => setDragOver((k) => (k === col.key ? null : k))}
                      onDrop={(e) => { e.preventDefault(); reordenar(col.key); setDragOver(null); dragKey.current = null; }}
                      onDragEnd={() => { setDragOver(null); dragKey.current = null; }}>
                    <span className="th-in">
                      {col.headerRender ? col.headerRender() : (<>
                      <button type="button" className="th-sort" onClick={() => toggleSort(col)}
                              disabled={!col.sortable}>
                        {col.label}
                        {/* Qué hay en la fila de totales, sin bajar a mirarla. */}
                        {totals[col.key] && (
                          <span className="cyc-grid-summary-mark"
                                title={`${ETIQUETA_TOTAL[totals[col.key]]} en la fila de totales`}>
                            {MARCA_TOTAL[totals[col.key]]}
                          </span>
                        )}
                        {col.sortable && (
                          <span className="sort-arrow" aria-hidden="true">
                            {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        )}
                      </button>
                      {conMenu && (
                        <button type="button" className={"filter-ico" + (filters[col.key]?.length ? " act" : "")}
                                aria-label={`Menú de ${col.label}`} aria-expanded={openFilter?.key === col.key}
                                title="Filtrar / ordenar" onClick={(e) => clickFilter(e, col.key)}>▼</button>
                      )}
                      {/* El encabezado completo NO se arrastra: competía con el clic
                          para ordenar y un arrastre corto terminaba ordenando la
                          tabla sola. Se mueve desde el asa (Estándar §2.5). */}
                      {esAccion(col)
                        ? <span className="cyc-grid-move-hueco" aria-hidden="true" />
                        : (
                          <span className="cyc-grid-move" draggable role="button" tabIndex={0}
                                title={`Mover la columna ${col.label} · flechas ← → con el foco aquí`}
                                aria-label={`Mover la columna ${col.label}`}
                                onDragStart={(e) => { dragKey.current = col.key; e.dataTransfer.effectAllowed = "move"; }}
                                onKeyDown={(e) => {
                                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                                  e.preventDefault(); e.stopPropagation();
                                  moverCon(col.key, e.key === "ArrowLeft" ? -1 : 1);
                                }}>⋮⋮</span>
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
            {virtual && (
              <tr className="cyc-grid-relleno" aria-hidden="true">
                <td colSpan={colCount} style={{ height: vIni * altoFila, padding: 0, border: 0 }} />
              </tr>
            )}
            {rellenoPar && (
              <tr className="cyc-grid-relleno" aria-hidden="true">
                <td colSpan={colCount} style={{ height: 0, padding: 0, border: 0 }} />
              </tr>
            )}
            {(virtual ? view.slice(vIni, vFin) : view).map((row, i) => {
              const r = vIni + i;
              const rk = getKey(row);
              const rowCur = cursor?.r === r;
              const inSel = !!rect && r >= rect.r0 && r <= rect.r1;
              const sub = renderSubRow && expandedKeys?.has(rk) ? renderSubRow(row) : null;
              return (
                <Fragment key={rk}>
                <GridRow<T>
                  row={row} rowKey={rk} r={r}
                  ocols={vcols} colW={colW} frozenLeft={frozenLeft}
                  rowCur={rowCur} curC={rowCur ? cursor!.c : -1}
                  selC0={inSel ? rect!.c0 : -1} selC1={inSel ? rect!.c1 : -1}
                  activo={activeKey != null && rk === activeKey}
                  rowExtra={rowClass?.(row) || ""}
                  term={qn}
                  actions={actions} actionsWidth={actionsWidth} onRowClick={onRowClick}
                  onCellDown={onCellDown} onCellEnter={onCellEnter} onCellLeave={onCellLeave}
                />
                {sub && <tr className="grid-subrow"><td colSpan={colCount}>{sub}</td></tr>}
                </Fragment>
              );
            })}
            {virtual && vFin < view.length && (
              <tr className="cyc-grid-relleno" aria-hidden="true">
                <td colSpan={colCount} style={{ height: (view.length - vFin) * altoFila, padding: 0, border: 0 }} />
              </tr>
            )}
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
          {/* Fila de totales como la del Liquidador: TODA columna lleva su ▼
              abajo a la izquierda —también las de texto, donde sirven los
              recuentos— y el valor va solo, alineado como su columna. El menú
              del encabezado es solo filtro; el total no se elige desde ahí. */}
          {view.length > 0 && (
            <tfoot>
              <tr className="grid-total">
                {vcols.map((col, i) => {
                  const f = fz(i);
                  const estilo = f ? { left: f.left } : undefined;
                  if (esAccion(col)) {
                    return <td key={col.key} className={"cyc-grid-summary-empty " + (f?.cls || "")} style={estilo} />;
                  }
                  const fn = totals[col.key];
                  const conValores = admiteTotal(col);
                  let txt = "";
                  if (fn) {
                    const { valor, entero } = totalDe(col, fn);
                    /* Un recuento es una cantidad de filas: entero, aunque la
                       columna sea de dinero. Lo demás, con el formato de su
                       columna. */
                    txt = entero ? nfInt.format(valor)
                      : col.formatter ? col.formatter(valor, undefined as unknown as T)
                      : col.type === "money" ? "$ " + nfMoney.format(valor) : nfInt.format(valor);
                  }
                  const opciones = conValores ? MENU_VALORES : MENU_TEXTO;
                  return (
                    <td key={col.key} className={"cyc-grid-summary-cell " + (fn ? "active " : "") + (f?.cls || "")} style={estilo}>
                      <div className={"cyc-grid-summary" + (conValores ? " numeric" : "")}>
                        <button type="button" className={fn ? "active" : undefined}
                                aria-expanded={menuTotal === col.key}
                                title={`Elegir qué mostrar en la fila de totales de ${col.label}`}
                                aria-label={`Elegir qué mostrar en la fila de totales de ${col.label}`}
                                onClick={(e) => { e.stopPropagation(); setMenuTotal((k) => (k === col.key ? null : col.key)); }}>▼</button>
                        <strong title={fn ? `${ETIQUETA_TOTAL[fn]} de ${col.label}: ${txt}` : ""}>{txt}</strong>
                        {menuTotal === col.key && (
                          <div className="cyc-grid-summary-menu" role="menu">
                            {opciones.map((modo, j) => modo === "-"
                              ? <div key={`sep${j}`} className="cyc-grid-summary-sep" />
                              : (
                                <button key={modo} type="button" role="menuitem"
                                        className={(fn || "ninguno") === modo ? "elegida" : undefined}
                                        onClick={() => {
                                          setTotals((t) => {
                                            const siguiente = { ...t };
                                            if (modo === "ninguno") delete siguiente[col.key];
                                            else siguiente[col.key] = modo as FuncionTotal;
                                            return siguiente;
                                          });
                                          setMenuTotal(null);
                                        }}>
                                  {modo === "ninguno" ? "Ninguno" : ETIQUETA_TOTAL[modo as FuncionTotal]}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
                {actions && <td className="cyc-grid-summary-empty" />}
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
          onHide={colMenu && ocultable(colMenu) && vcols.filter(ocultable).length > 1
            ? () => { ocultarCol(openFilter.key); setOpenFilter(null); } : undefined}
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
