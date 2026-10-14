import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CatItem } from "../types";
import { Icon, Toggle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Encabezado de subsección con su ícono del menú en ámbar corporativo. */
function CatH3({ icon, titulo, hint }: { icon: string; titulo: string; hint?: string }) {
  return (
    <h3 title={hint} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "#f7931e", display: "inline-flex" }}><Icon name={icon} size={19} /></span>{titulo}
    </h3>
  );
}

/* ----------------------------- Grid editable estilo CyC -------------------- */
interface EGCol { key: string; label: string; width?: string; align?: "left" | "center"; sortable?: boolean; filterable?: boolean; value?: (r: any) => string; render: (r: any) => ReactNode; }

function EditGrid({ cols, rows, getKey, actions, onAdd, empty, footRow }: {
  cols: EGCol[]; rows: any[]; getKey: (r: any) => string | number;
  actions: (r: any) => ReactNode; onAdd?: () => void; empty?: string; footRow?: ReactNode;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  const val = (col: EGCol, r: any) => (col.value ? col.value(r) : String(r[col.key] ?? ""));

  let view = [...rows];
  for (const col of cols) {
    const f = filters[col.key];
    if (f) { const q = norm(f); view = view.filter((r) => norm(val(col, r)).includes(q)); }
  }
  if (sortKey) {
    const col = cols.find((c) => c.key === sortKey);
    if (col) view.sort((a, b) => {
      const c = val(col, a).localeCompare(val(col, b), "es", { numeric: true });
      return sortDir === "asc" ? c : -c;
    });
  }

  const toggleSort = (col: EGCol) => {
    if (!col.sortable) return;
    if (sortKey === col.key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(col.key); setSortDir("asc"); }
  };
  const openMenu = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(menu?.key === key ? null : { key, x: r.right, y: r.bottom + 6 });
  };
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".filter-pop") && !t.closest(".filter-ico")) setMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [menu]);

  const menuCol = menu ? cols.find((c) => c.key === menu.key) : null;

  return (
    <>
      <div className="tbl-wrap grid-scroll cat-scroll">
        <table>
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col.key} className={col.sortable ? "sortable" : undefined}
                    style={{ textAlign: col.align === "center" ? "center" : "left", width: col.width }}>
                  <span className="th-in">
                    <button type="button" className="th-sort" disabled={!col.sortable} onClick={() => toggleSort(col)}>
                      {col.label}
                      {col.sortable && <span className="sort-arrow">{sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>}
                    </button>
                    {col.filterable && (
                      <button type="button" className={"filter-ico" + (filters[col.key] ? " act" : "")}
                              title="Ordenar / filtrar" onClick={(e) => openMenu(e, col.key)}>▼</button>
                    )}
                  </span>
                </th>
              ))}
              <th className="center" style={{ width: 74 }}>
                {onAdd
                  ? <button className="add-ic" onClick={onAdd} title="Agregar"><Icon name="plus" size={16} /></button>
                  : "Acciones"}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={getKey(r)}>
                {cols.map((col) => <td key={col.key} className={col.align === "center" ? "al-c" : undefined}>{col.render(r)}</td>)}
                <td className="al-c">{actions(r)}</td>
              </tr>
            ))}
            {footRow}
            {view.length === 0 && !footRow && <tr><td colSpan={cols.length + 1} className="grid-empty">{empty || "Sin registros."}</td></tr>}
          </tbody>
        </table>
      </div>
      {menu && menuCol && (
        <div className="filter-pop" role="dialog" style={{ position: "fixed", left: Math.max(10, menu.x - 230), top: menu.y }}>
          <button className="cm-item" onClick={() => { setSortKey(menu.key); setSortDir("asc"); setMenu(null); }}>Ordenar ascendente <span className="cm-ic">↑</span></button>
          <button className="cm-item" onClick={() => { setSortKey(menu.key); setSortDir("desc"); setMenu(null); }}>Ordenar descendente <span className="cm-ic">↓</span></button>
          {menuCol.filterable && (
            <>
              <div className="cm-sep" />
              <div className="fp-lbl">Filtrar por {menuCol.label}</div>
              <input autoFocus type="text" placeholder="Contiene…" value={filters[menu.key] || ""}
                     onChange={(e) => setFilters((f) => ({ ...f, [menu.key]: e.target.value }))} />
              <div className="fp-actions"><span />
                <button onClick={() => setFilters((f) => { const c = { ...f }; delete c[menu.key]; return c; })}>Limpiar</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------- Catálogos ---------------------------------- */
const cellInput = "cell-input";

function CatCard({ titulo, hint, path, icon }: { titulo: string; hint: string; path: string; icon: string }) {
  const toast = useToast();
  const [items, setItems] = useState<CatItem[]>([]);
  const load = () => api.get(`/catalogos/${path}`).then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const add = async () => { try { await api.post(`/catalogos/${path}`, { descripcion: "Nuevo", activo: true }); load(); } catch (e: any) { toast(e.message, true); } };
  const save = async (it: CatItem, patch: Partial<CatItem>) => { try { await api.put(`/catalogos/${path}/${it.id}`, patch); load(); } catch (e: any) { toast(e.message, true); } };
  const del = async (it: CatItem) => { try { await api.del(`/catalogos/${path}/${it.id}`); load(); toast("Eliminado"); } catch (e: any) { toast(e.message, true); } };

  const cols: EGCol[] = [
    { key: "descripcion", label: "Descripción", sortable: true, filterable: true, value: (r) => r.descripcion, render: (r: CatItem) => <input className={cellInput} defaultValue={r.descripcion} onBlur={(e) => e.target.value !== r.descripcion && save(r, { descripcion: e.target.value })} /> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r: CatItem) => <input type="checkbox" checked={r.activo} onChange={(e) => save(r, { activo: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /> },
  ];
  return (
    <div className="card">
      <div className="card-h"><CatH3 icon={icon} titulo={titulo} hint={hint} /></div>
      <EditGrid cols={cols} rows={items} getKey={(r) => r.id} onAdd={add} empty="Vacío"
        actions={(r) => <button className="act-btn del" onClick={() => del(r)} title="Eliminar"><Icon name="trash" size={15} /></button>} />
    </div>
  );
}

interface TD { codigo: string; descripcion: string; }

function CodeCard({ titulo, hint, path, icon, codLabel = "Código", maxCod = 4 }:
  { titulo: string; hint: string; path: string; icon: string; codLabel?: string; maxCod?: number }) {
  const toast = useToast();
  const [items, setItems] = useState<TD[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const load = () => api.get(`/catalogos/${path}`).then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const crear = async (codigo: string) => { const cod = codigo.trim().toUpperCase(); setDraft(null); if (!cod) return; try { await api.post(`/catalogos/${path}`, { codigo: cod, descripcion: "" }); load(); } catch (e: any) { toast(e.message, true); } };
  const save = async (t: TD, descripcion: string) => { if (descripcion === t.descripcion) return; try { await api.put(`/catalogos/${path}/${t.codigo}`, { descripcion }); load(); } catch (e: any) { toast(e.message, true); } };
  const del = async (t: TD) => { try { await api.del(`/catalogos/${path}/${t.codigo}`); load(); toast("Eliminado"); } catch (e: any) { toast(e.message, true); } };

  const cols: EGCol[] = [
    { key: "codigo", label: codLabel, sortable: true, filterable: true, width: "100px", value: (r) => r.codigo, render: (r: TD) => <span className="pill">{r.codigo}</span> },
    { key: "descripcion", label: "Descripción", sortable: true, filterable: true, value: (r) => r.descripcion, render: (r: TD) => <input className={cellInput} defaultValue={r.descripcion} onBlur={(e) => save(r, e.target.value)} /> },
  ];
  const draftRow = draft !== null ? (
    <tr>
      <td><input autoFocus placeholder="Código" maxLength={maxCod} defaultValue=""
        onBlur={(e) => crear(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }}
        className={cellInput} style={{ textTransform: "uppercase" }} /></td>
      <td style={{ color: "var(--ink-3)", fontSize: 12 }}>Escribe el código y presiona Enter</td>
      <td className="al-c"><button className="act-btn del" onClick={() => setDraft(null)} title="Descartar"><Icon name="trash" size={15} /></button></td>
    </tr>
  ) : null;

  return (
    <div className="card">
      <div className="card-h"><CatH3 icon={icon} titulo={titulo} hint={hint} /></div>
      <EditGrid cols={cols} rows={items} getKey={(r) => r.codigo} onAdd={() => setDraft("")} empty="Vacío" footRow={draftRow}
        actions={(r) => <button className="act-btn del" onClick={() => del(r)} title="Eliminar"><Icon name="trash" size={15} /></button>} />
    </div>
  );
}

/** Municipios DANE: catálogo de referencia con búsqueda + recargar. */
function MunicipioRef() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ codigo: string; nombre: string; departamento: string }[]>([]);
  const buscar = (term: string) => api.get(`/catalogos/municipio/buscar?q=${encodeURIComponent(term)}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { buscar(""); }, []); // eslint-disable-line
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon="map-pin" titulo="Municipios (DANE)" hint="Referencia; se usan con búsqueda en la ficha (contacto y Municipios ICA)" />
        <div className="search" style={{ width: 320 }}><Icon name="search" size={15} />
          <input placeholder="Buscar por código o municipio…" value={q} onChange={(e) => { setQ(e.target.value); buscar(e.target.value); }} />
        </div>
      </div>
      <div className="tbl-wrap grid-scroll cat-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th style={{ width: 110 }}>Código</th><th>Municipio</th><th style={{ width: 210 }}>Departamento</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.codigo}><td><span className="pill">{m.codigo}</span></td><td>{m.nombre}</td><td>{m.departamento}</td></tr>
            ))}
            {!rows.length && <tr><td colSpan={3} className="grid-empty">Sin coincidencias</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 16px 14px", fontSize: 12, color: "var(--ink-3)" }}>Escribe para filtrar la lista.</div>
    </div>
  );
}

/** CIIU (referencia DIAN): grilla con búsqueda + recargar desde archivo. */
function CiiuRef() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ codigo: string; descripcion: string }[]>([]);
  const buscar = (term: string) => api.get(`/catalogos/ciiu/buscar?q=${encodeURIComponent(term)}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { buscar(""); }, []); // eslint-disable-line
  const recargar = async () => {
    try { const r = await api.post("/catalogos/ciiu/recargar"); toast(`CIIU recargado: ${r.cambios} cambios`); buscar(q); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon="tag" titulo="CIIU (referencia DIAN)" hint="Actividades económicas (DIAN); se usan con búsqueda en la ficha" />
        <div className="r" style={{ gap: 8 }}>
          <div className="search" style={{ width: 320 }}><Icon name="search" size={15} />
            <input placeholder="Buscar por código o actividad…" value={q} onChange={(e) => { setQ(e.target.value); buscar(e.target.value); }} />
          </div>
          <button className="btn sm" onClick={recargar}>Recargar desde archivo</button>
        </div>
      </div>
      <div className="tbl-wrap grid-scroll cat-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th style={{ width: 110 }}>Código</th><th>Descripción</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.codigo}><td><span className="pill">{m.codigo}</span></td><td>{m.descripcion}</td></tr>
            ))}
            {!rows.length && <tr><td colSpan={2} className="grid-empty">Sin coincidencias</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 16px 14px", fontSize: 12, color: "var(--ink-3)" }}>Escribe para filtrar la lista.</div>
    </div>
  );
}

/** Catálogo de Obligaciones (rico): alimenta el calendario y las Otras Obligaciones del cliente. */
interface Oblig { id: number; codigo: string; descripcion: string; ente: string; criterio: string; periodicidad: string; origen: string; disparador: string; activo: boolean; tam_intervalo: number; paso_dias_habiles: number; familia: string; genera_pago: boolean; formulario_pago: string; }
const CRITERIOS = ["nit1", "nit2", "fijo"];
// Familia: agrupación visual en el Calendario (se guarda el key, se muestra la etiqueta).
const FAMILIAS: [string, string][] = [["dian", "Impuestos DIAN"], ["super", "Superintendencias"], ["municipal", "Impuestos municipales"], ["nomina", "Obligaciones de nómina"], ["otras", "Otras obligaciones"]];
const CRIT_TXT: Record<string, string> = { nit1: "Último dígito", nit2: "2 últimos dígitos", fijo: "Fecha única", grupo: "Por grupo", municipio: "Por municipio" };
const PERIODICIDADES = ["", "Mensual", "Bimestral", "Cuatrimestral", "Semestral", "Anual"];
const DISPARADORES = ["", "renta_jur", "renta_nat", "renta_gc", "retencion", "inc", "iva_bim", "iva_cuat", "iva_anual", "rst_anual", "rst_anticipo", "exogena_jn", "exogena_gc", "beneficiarios"];
const DISP_TXT: Record<string, string> = { "": "— (manual)", renta_jur: "Renta P. Jurídica", renta_nat: "Renta P. Natural", renta_gc: "Renta Grandes Contrib.", retencion: "Retención (07)", reteiva: "ReteIVA (07)", inc: "INC (33)", iva_bim: "IVA Bimestral (48)", iva_cuat: "IVA Cuatrimestral (48)", iva_anual: "IVA Anual RST (47+48)", rst_anual: "RST Declaración (47)", rst_anticipo: "RST Anticipo (47)", exogena_jn: "Exógena Jur/Nat (14)", exogena_gc: "Exógena Grandes Contrib. (14)", beneficiarios: "Beneficiarios Finales (RUB)" };

interface EntidadItem { id: number; nombre: string; sigla: string; activo: boolean; }

/** Modal (estándar CyC) para crear/editar una obligación del catálogo. */
function ObligacionModal({ obl, entidades, onEntidadCreada, onClose, onSaved }: { obl: Oblig; entidades: EntidadItem[]; onEntidadCreada: (e: EntidadItem) => void; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!obl.id;
  const [f, setF] = useState<Oblig>(obl);
  const set = (patch: Partial<Oblig>) => setF((x) => ({ ...x, ...patch }));
  // Crear entidad al vuelo (patrón "+") desde el campo Ente.
  const [entCreando, setEntCreando] = useState(false);
  const [entTxt, setEntTxt] = useState("");
  const crearEnt = async () => {
    const nombre = entTxt.trim();
    if (!nombre) { setEntCreando(false); setEntTxt(""); return; }
    try {
      const nueva: EntidadItem = await api.post("/catalogos/entidad", { nombre, sigla: "", activo: true });
      onEntidadCreada(nueva);
      set({ ente: nueva.nombre });
      setEntCreando(false); setEntTxt("");
      toast("Entidad creada ✓");
    } catch (e: any) { toast(e.message, true); }
  };
  const guardar = async () => {
    const codigo = f.codigo.trim().toUpperCase();
    const descripcion = f.descripcion.trim();
    if (!editando && !codigo) { toast("El código es obligatorio (es la llave estable)", true); return; }
    if (!descripcion) { toast("La obligación es obligatoria", true); return; }
    const esNit = f.criterio === "nit1" || f.criterio === "nit2";
    const payload = {
      codigo, descripcion, ente: f.ente.trim(), criterio: f.criterio,
      periodicidad: f.periodicidad, origen: f.origen || "manual", disparador: f.disparador, activo: f.activo,
      tam_intervalo: esNit ? (Number(f.tam_intervalo) || 0) : 0,
      paso_dias_habiles: esNit ? (Number(f.paso_dias_habiles) || 1) : 1,
      familia: f.familia || "otras",
      genera_pago: f.genera_pago,
      formulario_pago: f.genera_pago ? f.formulario_pago.trim() : "",
    };
    try {
      if (editando) await api.put(`/catalogos/obligacion-tipo/${obl.id}`, payload);
      else await api.post("/catalogos/obligacion-tipo", payload);
      toast(editando ? "Obligación actualizada ✓" : "Obligación creada ✓");
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={editando ? "Editar obligación" : "Nueva obligación"} icon="clipboard-check" size="md"
           onClose={onClose}
           onSave={guardar}
           aviso={editando ? "El código y el ente son la llave estable: no se cambian en una obligación existente." : undefined}>
      <div className="obl-grid">
        <label className="cq-fld"><span>Código</span>
          <input value={f.codigo} disabled={editando} style={{ textTransform: "uppercase" }} autoFocus={!editando}
                 title={editando ? "El código es la llave estable — no se puede cambiar" : ""}
                 onChange={(e) => set({ codigo: e.target.value })} placeholder="Ej. IVA_BIM" /></label>
        <label className="cq-fld"><span>Ente</span>
          {entCreando ? (
            <div className="catsel-row">
              <input autoFocus value={entTxt} placeholder="Nueva entidad…" style={{ flex: 1 }}
                onChange={(e) => setEntTxt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crearEnt(); } if (e.key === "Escape") { setEntCreando(false); setEntTxt(""); } }} />
              <button type="button" className="icon-btn" title="Crear" onClick={crearEnt}><Icon name="check" size={16} /></button>
              <button type="button" className="icon-btn" title="Cancelar" onClick={() => { setEntCreando(false); setEntTxt(""); }}><Icon name="x" size={15} /></button>
            </div>
          ) : (
            <div className="catsel-row">
              <select style={{ flex: 1 }} value={f.ente} disabled={editando}
                title={editando ? "No se puede cambiar en una obligación existente" : ""}
                onChange={(e) => set({ ente: e.target.value })}>
                {!f.ente && <option value="">— Selecciona —</option>}
                {f.ente && !entidades.some((x) => x.nombre === f.ente) && <option value={f.ente}>{f.ente}</option>}
                {entidades.filter((x) => x.activo).map((x) => <option key={x.id} value={x.nombre}>{x.nombre}</option>)}
              </select>
              {!editando && <button type="button" className="icon-btn add-plus" title="Crear nueva entidad" onClick={() => { setEntTxt(""); setEntCreando(true); }}><Icon name="plus" size={16} /></button>}
            </div>
          )}</label>
        <label className="cq-fld obl-wide"><span>Obligación</span>
          <input value={f.descripcion} disabled={editando}
                 title={editando ? "No se puede cambiar en una obligación existente" : ""}
                 onChange={(e) => set({ descripcion: e.target.value })} placeholder="Descripción de la obligación" /></label>
        <label className="cq-fld"><span>Criterio</span>
          <select value={f.criterio} onChange={(e) => set({ criterio: e.target.value })}>
            {f.criterio && !CRITERIOS.includes(f.criterio) && <option value={f.criterio}>{CRIT_TXT[f.criterio] || f.criterio}</option>}
            {CRITERIOS.map((o) => <option key={o} value={o}>{CRIT_TXT[o] || o}</option>)}</select></label>
        <label className="cq-fld"><span>Disparador (DIAN)</span>
          <select value={f.disparador} disabled={editando}
            title={editando ? "No se puede cambiar en una obligación existente" : ""}
            onChange={(e) => set({ disparador: e.target.value })}>
            {DISPARADORES.map((o) => <option key={o} value={o}>{DISP_TXT[o] ?? o}</option>)}</select></label>
        <label className="cq-fld"><span>Familia</span>
          <select value={f.familia || "otras"} onChange={(e) => set({ familia: e.target.value })}>
            {FAMILIAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="cq-fld"><span>Genera pago</span>
          <Toggle checked={f.genera_pago} color="green" label={f.genera_pago ? "Sí" : "No"}
            onChange={(v) => set({ genera_pago: v, formulario_pago: v ? f.formulario_pago : "" })}
            title="¿Esta obligación genera un pago a verificar? (retención, IVA, renta, consumo, ICA/ReteICA)" /></label>
        {f.genera_pago && <label className="cq-fld"><span>Formulario de pago</span>
          <input value={f.formulario_pago} onChange={(e) => set({ formulario_pago: e.target.value })}
            placeholder="DIAN: 350, 300, 110, 210, 315 · vacío si municipal (sin 490)" /></label>}
        {(f.criterio === "nit1" || f.criterio === "nit2") && <>
          <label className="cq-fld"><span>Tamaño de intervalo</span>
            <input type="number" min={0} value={f.tam_intervalo}
              onChange={(e) => set({ tam_intervalo: Number(e.target.value) || 0 })} /></label>
          <label className="cq-fld"><span>Paso (días hábiles)</span>
            <input type="number" min={1} value={f.paso_dias_habiles}
              onChange={(e) => set({ paso_dias_habiles: Number(e.target.value) || 1 })} /></label>
        </>}
        <div className="obl-wide" style={{ marginTop: 2 }}>
          <Toggle label="Activa" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} /></div>
      </div>
    </Modal>
  );
}

function ObligacionesCard({ puedeEditar = true, esSuper = false }: { puedeEditar?: boolean; esSuper?: boolean }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [items, setItems] = useState<Oblig[]>([]);
  const [edit, setEdit] = useState<Oblig | null>(null);
  const [entidades, setEntidades] = useState<EntidadItem[]>([]);
  // Revisión DIAN en lote (revisable, nada se aplica en silencio). Muestra el
  // diff de TODOS los clientes con RUT y separa AGREGAR faltantes (seguro) de
  // QUITAR sobrantes (con confirmación). Manuales nunca se tocan.
  type BatchDiff = { clientes: number; sin_rut: number; con_faltan: number; faltan_total: number; con_sobran: number; sobran_total: number };
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState<BatchDiff | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const cargarBatch = async () => {
    setBatchBusy(true);
    try { setBatch(await api.get("/clientes/dian-diff-todos")); } catch (e: any) { toast(e.message, true); }
    finally { setBatchBusy(false); }
  };
  const abrirBatch = async () => { setBatch(null); setBatchOpen(true); await cargarBatch(); };
  const aplicarAgregarTodos = async () => {
    if ((await confirmar({ titulo: "Agregar faltantes a todos", mensaje: `Se agregarán ${batch?.faltan_total ?? 0} obligación(es) DIAN a ${batch?.con_faltan ?? 0} cliente(s). Conserva las manuales.`, confirmar: "Agregar" })) !== "si") return;
    setBatchBusy(true);
    try { const r = await api.post("/clientes/dian-agregar-faltantes-todos", {}); toast(`Agregadas ${r.agregadas} en ${r.clientes_tocados} clientes ✓`); await cargarBatch(); }
    catch (e: any) { toast(e.message, true); } finally { setBatchBusy(false); }
  };
  const aplicarQuitarTodos = async () => {
    if ((await confirmar({ titulo: "Quitar sobrantes a todos", mensaje: `Se quitarán ${batch?.sobran_total ?? 0} obligación(es) DIAN que ya no aplican, en ${batch?.con_sobran ?? 0} cliente(s). Revisa: algunas pudieron ponerse a mano. Las manuales no se tocan.`, peligro: true, confirmar: "Quitar" })) !== "si") return;
    setBatchBusy(true);
    try { const r = await api.post("/clientes/dian-quitar-sobrantes-todos", {}); toast(`Quitadas ${r.quitadas} en ${r.clientes_tocados} clientes ✓`); await cargarBatch(); }
    catch (e: any) { toast(e.message, true); } finally { setBatchBusy(false); }
  };
  const load = () => api.get("/catalogos/obligacion-tipo").then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => {
    load();
    api.get("/catalogos/entidad").then((l: EntidadItem[]) => setEntidades(l)).catch(() => {});
  }, []); // eslint-disable-line
  const del = async (r: Oblig) => {
    if ((await confirmar({ titulo: "Eliminar obligación", mensaje: `Se eliminará «${r.descripcion}» (${r.codigo}). No se puede si está asignada a clientes o con plazos.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/catalogos/obligacion-tipo/${r.id}`); load(); toast("Eliminada"); } catch (e: any) { toast(e.message, true); }
  };
  const vacio = (): Oblig => ({ id: 0, codigo: "", descripcion: "", ente: "DIAN", criterio: "nit1", periodicidad: "", origen: "manual", disparador: "", activo: true, tam_intervalo: 0, paso_dias_habiles: 1, familia: "otras", genera_pago: false, formulario_pago: "" });

  const cols: Column<Oblig>[] = [
    { key: "codigo", label: "Código", sortable: true, filterable: true, width: "130px", value: (r) => r.codigo, render: (r) => <span className="pill">{r.codigo}</span> },
    { key: "descripcion", label: "Obligación", sortable: true, filterable: true, width: "40ch", value: (r) => r.descripcion, tip: (r) => r.descripcion },
    { key: "ente", label: "Ente", sortable: true, filterable: true, width: "170px", value: (r) => r.ente },
    { key: "criterio", label: "Criterio", sortable: true, filterable: true, width: "150px", value: (r) => CRIT_TXT[r.criterio] || r.criterio },
    { key: "disparador", label: "Disparador (DIAN)", sortable: true, filterable: true, width: "190px", value: (r) => DISP_TXT[r.disparador] ?? r.disparador },
    { key: "pago", label: "Pago", sortable: true, filterable: true, width: "110px", align: "center",
      value: (r) => r.genera_pago ? (r.formulario_pago || "Sí") : "",
      render: (r) => r.genera_pago ? <span className="pill">{r.formulario_pago || "Sí"}</span> : <span style={{ color: "var(--ink-3)" }}>—</span> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <span style={{ color: r.activo ? "var(--ok)" : "var(--ink-3)", fontWeight: 700 }}>{r.activo ? "Sí" : "No"}</span> },
  ];
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon="clipboard-check" titulo="Obligaciones" hint="Catálogo de obligaciones de reporte. Alimenta el Calendario y la pestaña Obligaciones del cliente. El código es la llave estable (inmutable). No se puede borrar una obligación asignada a clientes o con plazos." />
        <div className="r" style={{ gap: 8 }}>
          {esSuper && <button className="btn sm" onClick={abrirBatch}
            title="Revisa el diff DIAN de todos los clientes con RUT y aplica agregar/quitar (con confirmación). Úsalo tras cambiar una regla del catálogo. Conserva las manuales.">
            <Icon name="check-circle" size={15} />Revisar DIAN de todos</button>}
          {puedeEditar && <button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />Nueva Obligación</button>}
        </div>
      </div>
      <DataGrid columns={cols} rows={items} getKey={(r) => r.id}
        label="Obligaciones" scrollClass="cat-scroll" storageKey="cat-oblig"
        searchable exportable actionsWidth="120px" emptyLabel="Sin obligaciones."
        actions={puedeEditar ? (r) => <>
          <button className="act-btn" title="Editar" onClick={() => setEdit(r)}><Icon name="edit" size={15} /></button>
          <button className="act-btn" title="Duplicar (nueva con estos datos)" onClick={() => setEdit({ ...r, id: 0 })}><Icon name="copy" size={15} /></button>
          <button className="act-btn del" title="Eliminar" onClick={() => del(r)}><Icon name="trash" size={15} /></button>
        </> : undefined} />
      {edit && <ObligacionModal obl={edit} entidades={entidades}
        onEntidadCreada={(e) => setEntidades((prev) => [...prev, e].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")))}
        onClose={() => setEdit(null)} onSaved={load} />}
      {batchOpen && <Modal title="Revisar obligaciones DIAN — todos los clientes" icon="check-circle" size="md"
        onClose={() => setBatchOpen(false)}
        aviso={batch ? `${batch.clientes} clientes · ${batch.sin_rut} sin RUT (omitidos) · las manuales no se tocan.` : "Calculando…"}>
        {!batch ? <div className="rev-ok" style={{ color: "var(--ink-3)" }}>Calculando…</div> : <>
          <div className="rev-sec">
            <div className="rev-h add"><Icon name="plus" size={14} />Faltan<span className="n">{batch.faltan_total}</span><span className="sp" />
              <button className="btn add sm" disabled={batchBusy || batch.faltan_total === 0} onClick={aplicarAgregarTodos}><Icon name="plus" size={14} />Agregar faltantes a todos</button></div>
            <p className="rev-note" style={{ margin: 0 }}>{batch.con_faltan} cliente(s) con obligaciones DIAN aplicables que aún no tienen.</p>
          </div>
          <div className="rev-sec">
            <div className="rev-h del"><Icon name="trash" size={14} />Sobran<span className="n">{batch.sobran_total}</span><span className="sp" />
              <button className="btn del2 sm" disabled={batchBusy || batch.sobran_total === 0} onClick={aplicarQuitarTodos}><Icon name="trash" size={14} />Quitar sobrantes a todos…</button></div>
            <p className="rev-note" style={{ margin: 0 }}>{batch.con_sobran} cliente(s) con DIAN que ya no aplican. Revisa antes: pudieron ponerse a mano.</p>
          </div>
          {batch.faltan_total === 0 && batch.sobran_total === 0 && <div className="rev-ok"><Icon name="check-circle" size={18} />Todos los clientes están al día.</div>}
        </>}
      </Modal>}
    </div>
  );
}

/** Modal (estándar CyC) para crear/editar una entidad (ente de control). */
function EntidadModal({ ent, onClose, onSaved }: { ent: EntidadItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!ent.id;
  const [f, setF] = useState<EntidadItem>(ent);
  const set = (patch: Partial<EntidadItem>) => setF((x) => ({ ...x, ...patch }));
  const guardar = async () => {
    const nombre = f.nombre.trim();
    if (!nombre) { toast("El nombre es obligatorio", true); return; }
    try {
      const payload = { nombre, sigla: f.sigla.trim(), activo: f.activo };
      if (editando) await api.put(`/catalogos/entidad/${ent.id}`, payload);
      else await api.post("/catalogos/entidad", payload);
      toast(editando ? "Entidad actualizada ✓" : "Entidad creada ✓");
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={editando ? "Editar entidad" : "Nueva entidad"} icon="landmark" size="md" onClose={onClose}
           onSave={guardar}>
      <div className="obl-grid">
        <label className="cq-fld obl-wide"><span>Nombre</span>
          <input value={f.nombre} autoFocus onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej. DIAN" /></label>
        <label className="cq-fld"><span>Sigla</span>
          <input value={f.sigla} onChange={(e) => set({ sigla: e.target.value })} placeholder="Ej. DIAN" /></label>
        <div className="obl-wide" style={{ marginTop: 2 }}>
          <Toggle label="Activa" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} /></div>
      </div>
    </Modal>
  );
}

function EntidadesCard() {
  const toast = useToast();
  const confirmar = useConfirm();
  const [items, setItems] = useState<EntidadItem[]>([]);
  const [edit, setEdit] = useState<EntidadItem | null>(null);
  const load = () => api.get("/catalogos/entidad").then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const del = async (r: EntidadItem) => {
    if ((await confirmar({ titulo: "Eliminar entidad", mensaje: `Se eliminará «${r.nombre}».`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/catalogos/entidad/${r.id}`); load(); toast("Eliminada"); } catch (e: any) { toast(e.message, true); }
  };
  const vacio = (): EntidadItem => ({ id: 0, nombre: "", sigla: "", activo: true });
  const cols: Column<EntidadItem>[] = [
    { key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "sigla", label: "Sigla", sortable: true, filterable: true, width: "180px", value: (r) => r.sigla },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <span style={{ color: r.activo ? "var(--ok)" : "var(--ink-3)", fontWeight: 700 }}>{r.activo ? "Sí" : "No"}</span> },
  ];
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon="landmark" titulo="Entidades" hint="Entes de control (DIAN, UGPP, Superintendencias, Hacienda…). Alimentan el Calendario y el Ente de las Obligaciones." />
        <div className="r"><button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />Nueva Entidad</button></div>
      </div>
      <DataGrid columns={cols} rows={items} getKey={(r) => r.id}
        label="Entidades" scrollClass="cat-scroll" storageKey="cat-entidad"
        searchable exportable actionsWidth="92px" emptyLabel="Sin entidades."
        actions={(r) => <>
          <button className="act-btn" title="Editar" onClick={() => setEdit(r)}><Icon name="edit" size={15} /></button>
          <button className="act-btn del" title="Eliminar" onClick={() => del(r)}><Icon name="trash" size={15} /></button>
        </>} />
      {edit && <EntidadModal ent={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </div>
  );
}

/** Catálogo de Formularios DIAN (350, etc.). Solo Super. La autorización de quién
 *  puede presentar cada uno se define en Roles y permisos. */
interface FormularioItem { id: number; nombre: string; codigo_calendario: string; activo: boolean; }

function FormularioModal({ f0, onClose, onSaved }: { f0: FormularioItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!f0.id;
  const [f, setF] = useState<FormularioItem>(f0);
  const set = (patch: Partial<FormularioItem>) => setF((x) => ({ ...x, ...patch }));
  const guardar = async () => {
    const nombre = f.nombre.trim();
    if (!nombre) { toast("El nombre es obligatorio", true); return; }
    try {
      const payload = { nombre, codigo_calendario: f.codigo_calendario.trim(), activo: f.activo };
      if (editando) await api.put(`/formularios/${f0.id}`, payload);
      else await api.post("/formularios", payload);
      toast(editando ? "Formulario actualizado ✓" : "Formulario creado ✓");
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={editando ? "Editar formulario" : "Nuevo formulario"} icon="file" size="md" onClose={onClose}
           onSave={guardar}>
      <div className="obl-grid">
        <label className="cq-fld obl-wide"><span>Nombre</span>
          <input value={f.nombre} autoFocus onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej. Formulario 350 (Rete Renta)" /></label>
        <label className="cq-fld obl-wide"><span>Código Calendario</span>
          <input value={f.codigo_calendario} onChange={(e) => set({ codigo_calendario: e.target.value })} placeholder="Ej. Rete_Renta" /></label>
        <div className="obl-wide" style={{ marginTop: 2 }}>
          <Toggle label="Activo" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} /></div>
      </div>
    </Modal>
  );
}

function FormulariosCard() {
  const toast = useToast();
  const confirmar = useConfirm();
  const [items, setItems] = useState<FormularioItem[]>([]);
  const [edit, setEdit] = useState<FormularioItem | null>(null);
  const load = () => api.get("/formularios").then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const del = async (r: FormularioItem) => {
    if ((await confirmar({ titulo: "Eliminar formulario", mensaje: `Se eliminará «${r.nombre}» y sus autorizaciones.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/formularios/${r.id}`); load(); toast("Eliminado"); } catch (e: any) { toast(e.message, true); }
  };
  const vacio = (): FormularioItem => ({ id: 0, nombre: "", codigo_calendario: "", activo: true });
  const cols: Column<FormularioItem>[] = [
    { key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "codigo_calendario", label: "Código Calendario", sortable: true, filterable: true, width: "220px", value: (r) => r.codigo_calendario, render: (r) => r.codigo_calendario ? <span className="pill">{r.codigo_calendario}</span> : <span className="muted">—</span> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <span style={{ color: r.activo ? "var(--ok)" : "var(--ink-3)", fontWeight: 700 }}>{r.activo ? "Sí" : "No"}</span> },
  ];
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon="file" titulo="Formularios" hint="Formularios DIAN cuyos borradores se presentan (350, etc.). El Código Calendario es la llave estable (para enlazar con el Calendario). La autorización de quién puede presentar cada uno se define en Roles y permisos → Presentar borradores." />
        <div className="r"><button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />Nuevo Formulario</button></div>
      </div>
      <DataGrid columns={cols} rows={items} getKey={(r) => r.id}
        label="Formularios" scrollClass="cat-scroll" storageKey="cat-formulario"
        searchable exportable actionsWidth="92px" emptyLabel="Sin formularios."
        actions={(r) => <>
          <button className="act-btn" title="Editar" onClick={() => setEdit(r)}><Icon name="edit" size={15} /></button>
          <button className="act-btn del" title="Eliminar" onClick={() => del(r)}><Icon name="trash" size={15} /></button>
        </>} />
      {edit && <FormularioModal f0={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </div>
  );
}

/** Catálogo de Emisores: personas que firman/emiten las cuentas de cobro a nombre
 *  de la firma. Cada emisor lleva su propio consecutivo (ej. MB-421). */
interface EmisorItem { id: number; nombre: string; cedula: string; direccion: string; celular: string; prefijo: string; consecutivo: number; nota_383: boolean; activo: boolean; }

function EmisorModal({ em, onClose, onSaved }: { em: EmisorItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!em.id;
  const [f, setF] = useState<EmisorItem>(em);
  const set = (patch: Partial<EmisorItem>) => setF((x) => ({ ...x, ...patch }));
  const guardar = async () => {
    const nombre = f.nombre.trim();
    if (!nombre) { toast("El nombre del emisor es obligatorio", true); return; }
    try {
      const payload = { nombre, cedula: f.cedula.trim(), direccion: f.direccion.trim(), celular: f.celular.trim(),
        prefijo: f.prefijo.trim().toUpperCase(), consecutivo: Math.max(0, Number(f.consecutivo) || 0), nota_383: f.nota_383, activo: f.activo };
      if (editando) await api.put(`/catalogos/emisor/${em.id}`, payload);
      else await api.post("/catalogos/emisor", payload);
      toast(editando ? "Emisor actualizado ✓" : "Emisor creado ✓");
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={editando ? "Editar emisor" : "Nuevo emisor"} icon="user" size="md" onClose={onClose}
           onSave={guardar}
           aviso={`Próximo N° de cuenta de cobro: ${(f.prefijo.trim().toUpperCase() || "—")}-${Math.max(0, Number(f.consecutivo) || 0) + 1}`}>
      <div className="obl-grid">
        <label className="cq-fld obl-wide"><span>Nombre completo</span>
          <input value={f.nombre} autoFocus onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej. María Bernarda Fernández Garrido" /></label>
        <label className="cq-fld"><span>Cédula</span>
          <input value={f.cedula} onChange={(e) => set({ cedula: e.target.value })} placeholder="Ej. 45.461.353" /></label>
        <label className="cq-fld"><span>Celular</span>
          <input value={f.celular} onChange={(e) => set({ celular: e.target.value })} placeholder="Ej. 310 706 3656" /></label>
        <label className="cq-fld obl-wide"><span>Dirección</span>
          <input value={f.direccion} onChange={(e) => set({ direccion: e.target.value })} placeholder="Ej. Brr los Abetos Mz D Lt 18" /></label>
        <label className="cq-fld"><span>Prefijo (iniciales del N°)</span>
          <input value={f.prefijo} maxLength={6} onChange={(e) => set({ prefijo: e.target.value.toUpperCase() })} placeholder="Ej. MB" /></label>
        <label className="cq-fld"><span>Consecutivo (último usado)</span>
          <input type="number" min={0} value={f.consecutivo} onChange={(e) => set({ consecutivo: Number(e.target.value) })} title="El siguiente N° será este + 1" /></label>
        <div className="obl-wide" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320, marginTop: 2 }}>
          <Toggle label="Activo" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} />
          <Toggle label="Incluye nota art. 383 ET" checked={f.nota_383} onChange={(v) => set({ nota_383: v })} />
        </div>
      </div>
    </Modal>
  );
}

function EmisoresCard() {
  const toast = useToast();
  const confirmar = useConfirm();
  const [items, setItems] = useState<EmisorItem[]>([]);
  const [edit, setEdit] = useState<EmisorItem | null>(null);
  const load = () => api.get("/catalogos/emisor").then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const del = async (r: EmisorItem) => {
    if ((await confirmar({ titulo: "Eliminar emisor", mensaje: `Se eliminará «${r.nombre}».`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/catalogos/emisor/${r.id}`); load(); toast("Eliminado"); } catch (e: any) { toast(e.message, true); }
  };
  const vacio = (): EmisorItem => ({ id: 0, nombre: "", cedula: "", direccion: "", celular: "", prefijo: "", consecutivo: 0, nota_383: false, activo: true });
  const siSi = (b: boolean) => <span style={{ color: b ? "var(--ok)" : "var(--ink-3)", fontWeight: 700 }}>{b ? "Sí" : "No"}</span>;
  const cols: Column<EmisorItem>[] = [
    { key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "cedula", label: "Cédula", type: "code", sortable: true, width: "140px", value: (r) => r.cedula },
    { key: "prefijo", label: "Prefijo", align: "center", sortable: true, width: "90px", value: (r) => r.prefijo, render: (r) => r.prefijo ? <span className="pill">{r.prefijo}</span> : <span className="muted">—</span> },
    { key: "consecutivo", label: "Último N°", align: "center", sortable: true, width: "100px", value: (r) => String(r.consecutivo), render: (r) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.prefijo ? `${r.prefijo}-${r.consecutivo}` : r.consecutivo}</span> },
    { key: "nota_383", label: "Nota 383", align: "center", sortable: true, filterable: true, width: "100px", value: (r) => (r.nota_383 ? "Sí" : "No"), render: (r) => siSi(r.nota_383) },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => siSi(r.activo) },
  ];
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon="user" titulo="Emisores" hint="Personas que firman y emiten las cuentas de cobro a nombre de la firma. Cada una lleva su propio consecutivo (ej. MB-421) y, si aplica, la nota del art. 383." />
        <div className="r"><button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />Nuevo Emisor</button></div>
      </div>
      <DataGrid columns={cols} rows={items} getKey={(r) => r.id}
        label="Emisores" scrollClass="cat-scroll" storageKey="cat-emisor"
        searchable exportable actionsWidth="92px" emptyLabel="Sin emisores."
        actions={(r) => <>
          <button className="act-btn" title="Editar" onClick={() => setEdit(r)}><Icon name="edit" size={15} /></button>
          <button className="act-btn del" title="Eliminar" onClick={() => del(r)}><Icon name="trash" size={15} /></button>
        </>} />
      {edit && <EmisorModal em={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </div>
  );
}

const CAT_TABS = [
  ["rol", "Rol del Servicio"], ["forma", "Formas de cobro"], ["software", "Software"], ["cargo", "Cargos"],
  ["grupo", "Grupos económicos"],
  ["portal", "Portales"], ["emisor", "Emisores"],
  ["entidad", "Entidades"],
  ["oblig", "Obligaciones"],
  ["formulario", "Formularios"],
  ["td", "Tipos de documento"], ["resp", "Responsabilidades"],
  ["mun", "Municipios"], ["ciiu", "CIIU (DIAN)"],
] as const;
const CAT_ICON: Record<string, string> = {
  rol: "briefcase", forma: "coins", software: "box", cargo: "resp", grupo: "user", portal: "globe",
  entidad: "landmark", oblig: "clipboard-check", formulario: "file", emisor: "user",
  td: "files", resp: "shield-check", mun: "map-pin", ciiu: "tag",
};

export function Catalogos({ esSuper = false }: { esSuper?: boolean }) {
  const [tab, setTab] = useState("rol");
  return (
    <div className="cat-layout">
      <nav className="cat-nav">
        <div className="cat-nav-title">Listas maestras</div>
        {CAT_TABS.filter(([k]) => k !== "formulario" || esSuper).map(([k, l]) => (
          <button key={k} className={"cat-nav-item" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            <Icon name={CAT_ICON[k]} size={16} />{l}
          </button>
        ))}
      </nav>
      <div className="cat-content">
      {tab === "rol" && <CatCard titulo="Rol del Servicio" hint="Tipos de servicio que presta la firma" path="rol-servicio" icon={CAT_ICON.rol} />}
      {tab === "forma" && <CodeCard titulo="Formas de cobro" hint="Forma de cobro del servicio (Fa=Factura, CC=Cuenta de cobro, Ma=Mandato…)" path="forma-cobro" codLabel="Forma" icon={CAT_ICON.forma} />}
      {tab === "software" && <CatCard titulo="Software Utilizado" hint="Software contable/administrativo" path="software" icon={CAT_ICON.software} />}
      {tab === "cargo" && <CatCard titulo="Cargos" hint="Cargos de los responsables de la firma" path="cargo" icon={CAT_ICON.cargo} />}
      {tab === "grupo" && <CatCard titulo="Grupos económicos" hint="Agrupan clientes de un mismo dueño (PN/PJ) para consolidarlos" path="grupo-economico" icon={CAT_ICON.grupo} />}
      {tab === "portal" && <CatCard titulo="Portales" hint="Portales/entidades donde el cliente tiene credenciales (DIAN, Cámara, banco, etc.)" path="portal" icon={CAT_ICON.portal} />}
      {tab === "emisor" && <EmisoresCard />}
      {tab === "entidad" && <EntidadesCard />}
      {tab === "oblig" && <ObligacionesCard esSuper={esSuper} />}
      {tab === "formulario" && esSuper && <FormulariosCard />}
      {tab === "td" && <CodeCard titulo="Tipos de documento" hint="Tipos de doc. de la DIAN (código + descripción)" path="tipo-documento" icon={CAT_ICON.td} />}
      {tab === "resp" && <CodeCard titulo="Responsabilidades (RUT 53)" hint="Responsabilidades del RUT (código + descripción)" path="responsabilidad" maxCod={5} icon={CAT_ICON.resp} />}
      {tab === "mun" && <MunicipioRef />}
      {tab === "ciiu" && <CiiuRef />}
      </div>
    </div>
  );
}
