import { ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CatItem } from "../types";
import { Icon, SecTitle, SiNo, Toggle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";
import { CRITERIOS, CRIT_TXT, DISPARADORES, DISP_TXT, FAMILIAS, PERIODICIDADES } from "../catalogos-labels";
import { CatSelect } from "../components/CatSelect";

/** Encabezado de subsección: reusa SecTitle (ícono ámbar), con tooltip opcional. */
function CatH3({ icon, titulo, hint }: { icon: string; titulo: string; hint?: string }) {
  return <SecTitle icon={icon} title={hint}>{titulo}</SecTitle>;
}

/** Marco del catálogo (estándar): cabecera (ícono ámbar + título + acciones) +
 *  cuerpo gframe que llena el panel + pie ámbar con el conteo. */
function CatShell({ icon, titulo, hint, right, n, children }: {
  icon: string; titulo: string; hint: string; right?: ReactNode; n: number; children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <CatH3 icon={icon} titulo={titulo} hint={hint} />
        {right && <div className="r" style={{ gap: 8 }}>{right}</div>}
      </div>
      <div className="gframe-body">{children}</div>
      <div className="gframe-foot">{n} registro{n === 1 ? "" : "s"}</div>
    </div>
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

  const cols: Column<CatItem>[] = [
    { key: "descripcion", label: "Descripción", sortable: true, filterable: true, value: (r) => r.descripcion, render: (r) => <input className={cellInput} defaultValue={r.descripcion} onBlur={(e) => e.target.value !== r.descripcion && save(r, { descripcion: e.target.value })} /> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <input type="checkbox" checked={r.activo} onChange={(e) => save(r, { activo: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /> },
  ];
  return (
    <CatShell icon={icon} titulo={titulo} hint={hint} n={items.length}
      right={<button className="btn primary sm" onClick={add}><Icon name="plus" size={16} />Nuevo</button>}>
      <DataGrid columns={cols} rows={items} getKey={(r) => r.id} label={titulo} scrollClass="cat-scroll" fitRows
        searchable={false} exportable={false} emptyLabel="Vacío" actionsWidth="64px"
        actions={(r) => <button className="act-btn del" onClick={() => del(r)} title="Eliminar"><Icon name="trash" size={15} /></button>} />
    </CatShell>
  );
}

interface TD { codigo: string; descripcion: string; }

function CodeCard({ titulo, hint, path, icon, codLabel = "Código", maxCod = 4 }:
  { titulo: string; hint: string; path: string; icon: string; codLabel?: string; maxCod?: number }) {
  const toast = useToast();
  const [items, setItems] = useState<TD[]>([]);
  const [draft, setDraft] = useState(false);
  const load = () => api.get(`/catalogos/${path}`).then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const crear = async (codigo: string) => { const cod = codigo.trim().toUpperCase(); setDraft(false); if (!cod) return; try { await api.post(`/catalogos/${path}`, { codigo: cod, descripcion: "" }); load(); } catch (e: any) { toast(e.message, true); } };
  const save = async (t: TD, descripcion: string) => { if (descripcion === t.descripcion) return; try { await api.put(`/catalogos/${path}/${t.codigo}`, { descripcion }); load(); } catch (e: any) { toast(e.message, true); } };
  const del = async (t: TD) => { try { await api.del(`/catalogos/${path}/${t.codigo}`); load(); toast("Eliminado"); } catch (e: any) { toast(e.message, true); } };

  const cols: Column<TD>[] = [
    { key: "codigo", label: codLabel, sortable: true, filterable: true, width: "120px", value: (r) => r.codigo, render: (r) => <span className="pill">{r.codigo}</span> },
    { key: "descripcion", label: "Descripción", sortable: true, filterable: true, value: (r) => r.descripcion, render: (r) => <input className={cellInput} defaultValue={r.descripcion} onBlur={(e) => save(r, e.target.value)} /> },
  ];
  // Crear: pide el código inline (es la llave estable) y luego se edita la descripción en la fila.
  const draftInput = (
    <input autoFocus maxLength={maxCod} placeholder={codLabel} className={cellInput}
      style={{ textTransform: "uppercase", width: 150 }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(false); }}
      onBlur={(e) => crear(e.target.value)} />
  );
  return (
    <CatShell icon={icon} titulo={titulo} hint={hint} n={items.length}
      right={draft ? draftInput : <button className="btn primary sm" onClick={() => setDraft(true)}><Icon name="plus" size={16} />Nuevo</button>}>
      <DataGrid columns={cols} rows={items} getKey={(r) => r.codigo} label={titulo} scrollClass="cat-scroll" fitRows
        searchable={false} exportable={false} emptyLabel="Vacío" actionsWidth="64px"
        actions={(r) => <button className="act-btn del" onClick={() => del(r)} title="Eliminar"><Icon name="trash" size={15} /></button>} />
    </CatShell>
  );
}

/** Municipios DANE: catálogo de referencia con búsqueda (servidor). */
function MunicipioRef() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ codigo: string; nombre: string; departamento: string }[]>([]);
  const buscar = (term: string) => api.get(`/catalogos/municipio/buscar?q=${encodeURIComponent(term)}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { buscar(""); }, []); // eslint-disable-line
  const cols: Column<{ codigo: string; nombre: string; departamento: string }>[] = [
    { key: "codigo", label: "Código", sortable: true, filterable: true, width: "120px", value: (r) => r.codigo, render: (r) => <span className="pill">{r.codigo}</span> },
    { key: "nombre", label: "Municipio", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "departamento", label: "Departamento", sortable: true, filterable: true, width: "230px", value: (r) => r.departamento },
  ];
  return (
    <CatShell icon="map-pin" titulo="Municipios (DANE)" hint="Referencia; se usan con búsqueda en la ficha (contacto y Municipios ICA)" n={rows.length}
      right={<div className="search" style={{ width: 320 }}><Icon name="search" size={15} />
        <input placeholder="Buscar por código o municipio…" value={q} onChange={(e) => { setQ(e.target.value); buscar(e.target.value); }} /></div>}>
      <DataGrid columns={cols} rows={rows} getKey={(r) => r.codigo} label="Municipios" scrollClass="cat-scroll" fitRows
        searchable={false} exportable={false} emptyLabel="Sin coincidencias" />
    </CatShell>
  );
}

/** CIIU (referencia DIAN): grilla con búsqueda (servidor) + recargar desde archivo. */
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
  const cols: Column<{ codigo: string; descripcion: string }>[] = [
    { key: "codigo", label: "Código", sortable: true, filterable: true, width: "120px", value: (r) => r.codigo, render: (r) => <span className="pill">{r.codigo}</span> },
    { key: "descripcion", label: "Descripción", sortable: true, filterable: true, value: (r) => r.descripcion },
  ];
  return (
    <CatShell icon="tag" titulo="CIIU (referencia DIAN)" hint="Actividades económicas (DIAN); se usan con búsqueda en la ficha" n={rows.length}
      right={<>
        <div className="search" style={{ width: 320 }}><Icon name="search" size={15} />
          <input placeholder="Buscar por código o actividad…" value={q} onChange={(e) => { setQ(e.target.value); buscar(e.target.value); }} /></div>
        <button className="btn sm" onClick={recargar}>Recargar desde archivo</button>
      </>}>
      <DataGrid columns={cols} rows={rows} getKey={(r) => r.codigo} label="CIIU" scrollClass="cat-scroll" fitRows
        searchable={false} exportable={false} emptyLabel="Sin coincidencias" />
    </CatShell>
  );
}

/** Catálogo de Obligaciones (rico): alimenta el calendario y las Otras Obligaciones del cliente. */
interface Oblig { id: number; codigo: string; descripcion: string; ente: string; criterio: string; periodicidad: string; origen: string; disparador: string; activo: boolean; tam_intervalo: number; paso_dias_habiles: number; familia: string; genera_pago: boolean; formulario_pago: string; plazo_pago_fatal_num: number; plazo_pago_fatal_unidad: string; consecuencia_impago: string; }

interface EntidadItem { id: number; nombre: string; sigla: string; activo: boolean; }

/** Modal (estándar CyC) para crear/editar una obligación del catálogo. */
function ObligacionModal({ obl, entidades, formularios, onEntidadCreada, onClose, onSaved, foco }: { obl: Oblig; entidades: EntidadItem[]; formularios: FormularioItem[]; onEntidadCreada: (e: EntidadItem) => void; onClose: () => void; onSaved: () => void; foco?: "etapas" }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const editando = !!obl.id;
  const [f, setF] = useState<Oblig>(obl);
  const set = (patch: Partial<Oblig>) => setF((x) => ({ ...x, ...patch }));
  // Etapas (subtareas) de la obligación: se gestionan aquí mismo. Cuelgan del id,
  // así que solo cuando la obligación ya existe (editando).
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [etEdit, setEtEdit] = useState<Etapa | null>(null);
  const etapasRef = useRef<HTMLDivElement>(null);
  const cargarEtapas = () => { if (obl.id) api.get(`/catalogos/obligacion-tipo/${obl.id}/etapas`).then(setEtapas).catch(() => {}); };
  useEffect(() => { cargarEtapas(); }, []); // eslint-disable-line
  useEffect(() => { if (foco === "etapas") etapasRef.current?.scrollIntoView({ block: "start" }); }, [foco]);
  const moverEtapa = async (r: Etapa, dir: -1 | 1) => {
    const i = etapas.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (j < 0 || j >= etapas.length) return;
    const ids = etapas.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { setEtapas(await api.put(`/catalogos/obligacion-tipo/${obl.id}/etapas/orden`, { ids })); }
    catch (e: any) { toast(e.message, true); }
  };
  const borrarEtapa = async (r: Etapa) => {
    if ((await confirmar({ titulo: "Eliminar etapa", mensaje: `Se eliminará la etapa «${r.nombre}».`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/catalogos/etapa/${r.id}`); cargarEtapas(); toast("Etapa eliminada ✓"); } catch (e: any) { toast(e.message, true); }
  };
  const nuevaEtapa = (): Etapa => ({ id: 0, obligacion_tipo_id: obl.id, orden: 0, nombre: "", codigo: "", dias_antes: 0, activa: true, nota: "" });
  const colsEtapa: Column<Etapa>[] = [
    { key: "orden", label: "#", align: "center", width: "44px", value: (r) => String(r.orden), render: (r) => <span className="pill">{r.orden}</span> },
    { key: "nombre", label: "Etapa", value: (r) => r.nombre, render: (r) => <div>{r.nombre}{r.nota && <div className="cc-sub">{r.nota}</div>}</div> },
    { key: "codigo", label: "Código", align: "center", width: "90px", value: (r) => r.codigo, render: (r) => r.codigo ? <span className="pill">{r.codigo}</span> : <span style={{ color: "var(--ink-3)" }}>—</span> },
    { key: "dias_antes", label: "Días háb.", align: "center", width: "90px", value: (r) => String(r.dias_antes) },
    { key: "activa", label: "Activa", align: "center", width: "80px", value: (r) => (r.activa ? "Sí" : "No"), render: (r) => <SiNo v={r.activa} /> },
  ];
  // Crear entidad al vuelo (patrón "+") desde el campo Ente.
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
      plazo_pago_fatal_num: f.genera_pago ? (Number(f.plazo_pago_fatal_num) || 0) : 0,
      plazo_pago_fatal_unidad: f.genera_pago ? f.plazo_pago_fatal_unidad : "",
      consecuencia_impago: f.genera_pago ? f.consecuencia_impago : "",
    };
    try {
      if (editando) await api.put(`/catalogos/obligacion-tipo/${obl.id}`, payload);
      else await api.post("/catalogos/obligacion-tipo", payload);
      toast(editando ? "Obligación actualizada ✓" : "Obligación creada ✓");
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
    <Modal title={editando ? "Editar obligación" : "Nueva obligación"} icon="clipboard-check" size="md"
           onClose={onClose}
           onSave={guardar}>
      <div className="oblig-layout">
      <div className="fieldgroup"><h4 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Identificación
          <span style={{ textTransform: "none", fontWeight: 400 }}><Toggle label="Activa" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} /></span>
        </h4>
        <div className="obl-row">
          <label className="cq-fld" style={{ width: 190 }}><span>Código</span>
            <input value={f.codigo} disabled={editando} style={{ textTransform: "uppercase" }} autoFocus={!editando}
                   title={editando ? "El código es la llave estable — no se puede cambiar" : ""}
                   onChange={(e) => set({ codigo: e.target.value })} placeholder="Ej. IVA_BIM" /></label>
          <label className="cq-fld" style={{ width: 250 }}><span>Ente</span>
            <CatSelect path="entidad" by="descripcion" textKey="nombre"
              items={entidades.filter((x) => x.activo)} onItems={onEntidadCreada}
              value={f.ente} onChange={(v) => set({ ente: (v as string) || "" })}
              disabled={editando} placeholder="— Selecciona —" noAdd={editando} /></label>
          <label className="cq-fld" style={{ width: 230 }}><span>Familia</span>
            <select value={f.familia || "otras"} onChange={(e) => set({ familia: e.target.value })}>
              {FAMILIAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="cq-fld obl-full"><span>Obligación</span>
            <input value={f.descripcion} disabled={editando}
                   title={editando ? "No se puede cambiar en una obligación existente" : ""}
                   onChange={(e) => set({ descripcion: e.target.value })} placeholder="Descripción de la obligación" /></label>
        </div>
      </div>

      <div className="fieldgroup"><h4>Generación (Calendario)</h4>
        <div className="obl-row">
          <label className="cq-fld" style={{ width: 215 }}><span>Criterio</span>
            <select value={f.criterio} onChange={(e) => set({ criterio: e.target.value })}>
              {f.criterio && !CRITERIOS.includes(f.criterio) && <option value={f.criterio}>{CRIT_TXT[f.criterio] || f.criterio}</option>}
              {CRITERIOS.map((o) => <option key={o} value={o}>{CRIT_TXT[o] || o}</option>)}</select></label>
          <label className="cq-fld" style={{ width: 160 }}><span>Periodicidad</span>
            <select value={f.periodicidad} onChange={(e) => set({ periodicidad: e.target.value })}>
              {PERIODICIDADES.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select></label>
          <label className="cq-fld" style={{ width: 245 }}><span>Disparador (DIAN)</span>
            <select value={f.disparador} disabled={editando}
              title={editando ? "No se puede cambiar en una obligación existente" : ""}
              onChange={(e) => set({ disparador: e.target.value })}>
              {DISPARADORES.map((o) => <option key={o} value={o}>{DISP_TXT[o] ?? o}</option>)}</select></label>
          <label className="cq-fld" style={{ width: 135 }}><span>Tamaño de intervalo</span>
            <input type="number" min={0} value={f.tam_intervalo} disabled={!(f.criterio === "nit1" || f.criterio === "nit2")}
              title={(f.criterio === "nit1" || f.criterio === "nit2") ? "" : "Solo aplica cuando el criterio es por dígito de NIT"}
              onChange={(e) => set({ tam_intervalo: Number(e.target.value) || 0 })} /></label>
          <label className="cq-fld" style={{ width: 150 }}><span>Paso (días hábiles)</span>
            <input type="number" min={1} value={f.paso_dias_habiles} disabled={!(f.criterio === "nit1" || f.criterio === "nit2")}
              title={(f.criterio === "nit1" || f.criterio === "nit2") ? "" : "Solo aplica cuando el criterio es por dígito de NIT"}
              onChange={(e) => set({ paso_dias_habiles: Number(e.target.value) || 1 })} /></label>
        </div>
      </div>

      <div className="fieldgroup"><h4 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Pago
          <span style={{ textTransform: "none", fontWeight: 400 }}><Toggle checked={f.genera_pago} color="green" label={f.genera_pago ? "Sí" : "No"}
            onChange={(v) => set({ genera_pago: v, formulario_pago: v ? f.formulario_pago : "", plazo_pago_fatal_num: v ? (f.plazo_pago_fatal_num || 60) : 0, plazo_pago_fatal_unidad: v ? (f.plazo_pago_fatal_unidad || "dias") : "", consecuencia_impago: v ? f.consecuencia_impago : "" })}
            title="¿Esta obligación genera un pago a verificar? (retención, IVA, renta, consumo, ICA/ReteICA)" /></span>
        </h4>
        <div className="obl-row">
          <label className="cq-fld" style={{ width: 300 }}><span>Formulario de pago</span>
            <select value={f.formulario_pago} disabled={!f.genera_pago} onChange={(e) => set({ formulario_pago: e.target.value })}>
              <option value="">— ninguno (municipal / sin 490) —</option>
              {f.formulario_pago && !formularios.some((x) => x.numero === f.formulario_pago) && <option value={f.formulario_pago}>{f.formulario_pago}</option>}
              {formularios.filter((x) => x.activo && x.numero).map((x) => <option key={x.id} value={x.numero}>{x.nombre}</option>)}
            </select></label>
          <label className="cq-fld" style={{ width: 280 }}><span>Plazo de pago fatal</span>
            <div className="catsel-row">
              <input type="number" min={0} style={{ width: 80 }} disabled={!f.genera_pago} value={f.plazo_pago_fatal_num}
                onChange={(e) => set({ plazo_pago_fatal_num: Number(e.target.value) || 0 })} />
              <select style={{ flex: 1 }} disabled={!f.genera_pago} value={f.plazo_pago_fatal_unidad} onChange={(e) => set({ plazo_pago_fatal_unidad: e.target.value })}>
                <option value="">— sin plazo fatal —</option>
                <option value="dias">días (desde el vencimiento)</option>
                <option value="meses">meses (desde el vencimiento)</option>
              </select>
            </div></label>
          <label className="cq-fld" style={{ width: 300 }}><span>Consecuencia si no paga</span>
            <select value={f.consecuencia_impago} disabled={!f.genera_pago} onChange={(e) => set({ consecuencia_impago: e.target.value })}>
              <option value="">Ninguna (solo intereses)</option>
              <option value="ineficacia">Ineficacia (se da por no presentada)</option>
              <option value="exclusion_rst">Exclusión del RST</option>
            </select></label>
        </div>
      </div>

      <div className="fieldgroup etapas-fg" ref={etapasRef}>
        <h4 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Etapas
          {editando && <button type="button" className="btn sm primary" onClick={() => setEtEdit(nuevaEtapa())}><Icon name="plus" size={14} />Nueva etapa</button>}
        </h4>
        {!editando ? (
          <div className="hint">Guarda la obligación para agregarle etapas.</div>
        ) : (
          <DataGrid columns={colsEtapa} rows={etapas} getKey={(r) => r.id} label="Etapas"
            storageKey="cat-etapas-grid" scrollClass="etapas-grid" actionsWidth="118px"
            searchable={false} exportable={false}
            emptyLabel="Sin etapas. Usa «＋ Nueva etapa» (arriba)."
            actions={(r) => <>
              <button className="act-btn" title="Subir" disabled={etapas[0]?.id === r.id} onClick={() => moverEtapa(r, -1)}><Icon name="arrow-up" size={15} /></button>
              <button className="act-btn" title="Bajar" disabled={etapas[etapas.length - 1]?.id === r.id} onClick={() => moverEtapa(r, 1)}><Icon name="arrow-down" size={15} /></button>
              <button className="act-btn" title="Editar" onClick={() => setEtEdit(r)}><Icon name="edit" size={15} /></button>
              <button className="act-btn del" title="Eliminar" onClick={() => borrarEtapa(r)}><Icon name="trash" size={15} /></button>
            </>} />
        )}
      </div>
      </div>
    </Modal>
    {etEdit && <EtapaModal tid={obl.id} etapa={etEdit.id ? etEdit : null} onClose={() => setEtEdit(null)} onSaved={cargarEtapas} />}
    </>
  );
}

interface Etapa { id: number; obligacion_tipo_id: number; orden: number; nombre: string; codigo: string; dias_antes: number; activa: boolean; nota: string; }

/** Formulario de una etapa (subtarea) de la obligación. */
function EtapaModal({ tid, etapa, onClose, onSaved }: { tid: number; etapa: Etapa | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!etapa && etapa.id > 0;
  const [f, setF] = useState<Etapa>(etapa ?? { id: 0, obligacion_tipo_id: tid, orden: 0, nombre: "", codigo: "", dias_antes: 0, activa: true, nota: "" });
  const set = (p: Partial<Etapa>) => setF((x) => ({ ...x, ...p }));
  const nombreRef = useRef<HTMLInputElement>(null);
  const guardar = async () => {
    if (!f.nombre.trim()) { toast("El nombre de la etapa es obligatorio", true); return; }
    const payload = { nombre: f.nombre.trim(), codigo: f.codigo.trim(), dias_antes: Number(f.dias_antes) || 0, activa: f.activa, nota: f.nota.trim() };
    try {
      if (editando) {
        await api.put(`/catalogos/etapa/${f.id}`, payload);
        toast("Etapa actualizada ✓"); onSaved(); onClose();
      } else {
        // Crear y SEGUIR: guarda, refresca la grilla y deja el modal abierto con los
        // mismos valores (reutilizables) para cargar la siguiente etapa de corrido.
        // Se cierra con la × cuando termines.
        await api.post(`/catalogos/obligacion-tipo/${tid}/etapas`, payload);
        toast("Etapa creada ✓"); onSaved();
        setTimeout(() => { nombreRef.current?.focus(); nombreRef.current?.select(); }, 0);
      }
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={editando ? "Editar etapa" : "Nueva etapa"} icon="list" size="md" onClose={onClose} onSave={guardar}
           saveLabel={editando ? "Guardar" : "Guardar y seguir"}>
      <div className="fieldgroup"><h4>Etapa</h4>
        <div className="obl-grid">
          <label className="cq-fld obl-wide"><span>Nombre</span>
            <input ref={nombreRef} value={f.nombre} autoFocus onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej. Preparar la data, Formato 1001" /></label>
          <label className="cq-fld"><span>Código (opcional)</span>
            <input value={f.codigo} onChange={(e) => set({ codigo: e.target.value })} placeholder="Ej. 1001" /></label>
          <label className="cq-fld"><span>Días hábiles antes</span>
            <input type="number" min={0} value={f.dias_antes} title="Días hábiles antes del vencimiento de la obligación (el Calendario deriva la fecha)"
                   onChange={(e) => set({ dias_antes: Number(e.target.value) || 0 })} /></label>
          <label className="cq-fld obl-wide"><span>Nota (opcional)</span>
            <input value={f.nota} onChange={(e) => set({ nota: e.target.value })} /></label>
          <div className="obl-wide"><Toggle label="Activa" color="green" checked={f.activa} onChange={(v) => set({ activa: v })} /></div>
        </div>
      </div>
    </Modal>
  );
}

function ObligacionesCard({ esSuper = false }: { esSuper?: boolean }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [items, setItems] = useState<Oblig[]>([]);
  const [edit, setEdit] = useState<Oblig | null>(null);
  const [focoEtapas, setFocoEtapas] = useState(false);
  const [entidades, setEntidades] = useState<EntidadItem[]>([]);
  const [formularios, setFormularios] = useState<FormularioItem[]>([]);
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
    api.get("/formularios").then((l: FormularioItem[]) => setFormularios(l)).catch(() => {});
  }, []); // eslint-disable-line
  const del = async (r: Oblig) => {
    if ((await confirmar({ titulo: "Eliminar obligación", mensaje: `Se eliminará «${r.descripcion}» (${r.codigo}). No se puede si está asignada a clientes o con plazos.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/catalogos/obligacion-tipo/${r.id}`); load(); toast("Eliminada"); } catch (e: any) { toast(e.message, true); }
  };
  const vacio = (): Oblig => ({ id: 0, codigo: "", descripcion: "", ente: "DIAN", criterio: "nit1", periodicidad: "", origen: "manual", disparador: "", activo: true, tam_intervalo: 0, paso_dias_habiles: 1, familia: "otras", genera_pago: false, formulario_pago: "", plazo_pago_fatal_num: 60, plazo_pago_fatal_unidad: "dias", consecuencia_impago: "" });

  const cols: Column<Oblig>[] = [
    { key: "codigo", label: "Código", sortable: true, filterable: true, width: "130px", value: (r) => r.codigo, render: (r) => <span className="pill">{r.codigo}</span> },
    { key: "descripcion", label: "Obligación", sortable: true, filterable: true, width: "40ch", value: (r) => r.descripcion, tip: (r) => r.descripcion },
    { key: "ente", label: "Ente", sortable: true, filterable: true, width: "170px", value: (r) => r.ente },
    { key: "criterio", label: "Criterio", sortable: true, filterable: true, width: "150px", value: (r) => CRIT_TXT[r.criterio] || r.criterio },
    { key: "disparador", label: "Disparador (DIAN)", sortable: true, filterable: true, width: "190px", value: (r) => DISP_TXT[r.disparador] ?? r.disparador },
    { key: "pago", label: "Pago", sortable: true, filterable: true, width: "110px", align: "center",
      value: (r) => r.genera_pago ? (r.formulario_pago || "Sí") : "",
      render: (r) => r.genera_pago ? <span className="pill">{r.formulario_pago || "Sí"}</span> : <span style={{ color: "var(--ink-3)" }}>—</span> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <SiNo v={r.activo} /> },
  ];
  return (
    <>
      <CatShell icon="clipboard-check" titulo="Obligaciones" n={items.length}
        hint="Catálogo de obligaciones de reporte. Alimenta el Calendario y la pestaña Obligaciones del cliente. El código es la llave estable (inmutable). No se puede borrar una obligación asignada a clientes o con plazos."
        right={<>
          {esSuper && <button className="btn sm" onClick={abrirBatch}
            title="Revisa el diff DIAN de todos los clientes con RUT y aplica agregar/quitar (con confirmación). Úsalo tras cambiar una regla del catálogo. Conserva las manuales.">
            <Icon name="check-circle" size={15} />Revisar DIAN de todos</button>}
          <button className="btn primary sm" onClick={() => { setFocoEtapas(false); setEdit(vacio()); }}><Icon name="plus" size={16} />Nueva Obligación</button>
        </>}>
        <DataGrid columns={cols} rows={items} getKey={(r) => r.id}
          label="Obligaciones" scrollClass="cat-scroll" storageKey="cat-oblig" fitRows
          searchable exportable actionsWidth="150px" emptyLabel="Sin obligaciones."
          actions={(r) => <>
            <button className="act-btn" title="Etapas (subtareas)" onClick={() => { setFocoEtapas(true); setEdit(r); }}><Icon name="list" size={15} /></button>
            <button className="act-btn" title="Editar" onClick={() => { setFocoEtapas(false); setEdit(r); }}><Icon name="edit" size={15} /></button>
            <button className="act-btn" title="Duplicar (nueva con estos datos)" onClick={() => { setFocoEtapas(false); setEdit({ ...r, id: 0 }); }}><Icon name="copy" size={15} /></button>
            <button className="act-btn del" title="Eliminar" onClick={() => del(r)}><Icon name="trash" size={15} /></button>
          </>} />
      </CatShell>
      {edit && <ObligacionModal obl={edit} entidades={entidades} formularios={formularios} foco={focoEtapas ? "etapas" : undefined}
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
    </>
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

/** Tarjeta CRUD estándar de catálogo: carga la lista, grilla con editar/eliminar,
 *  botón "Nuevo" y el modal de edición. Las tarjetas concretas solo aportan path,
 *  columnas, el objeto vacío y su modal. */
function CrudCard<T extends { id: number }>({ path, icon, titulo, hint, nuevo, cols, vacio, delTitulo, delMsg, storageKey, emptyLabel, renderModal }: {
  path: string;                     // base del endpoint ("/catalogos/entidad", "/formularios"…)
  icon: string; titulo: string; hint: string; nuevo: string;
  cols: Column<T>[];
  vacio: () => T;
  delTitulo: string; delMsg: (r: T) => string;
  storageKey: string; emptyLabel: string;
  renderModal: (item: T, onClose: () => void, onSaved: () => void) => ReactNode;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [items, setItems] = useState<T[]>([]);
  const [edit, setEdit] = useState<T | null>(null);
  const load = () => api.get(path).then(setItems).catch((e: any) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const del = async (r: T) => {
    if ((await confirmar({ titulo: delTitulo, mensaje: delMsg(r), peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`${path}/${r.id}`); load(); toast("Eliminado ✓"); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <CatShell icon={icon} titulo={titulo} n={items.length} hint={hint}
        right={<button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />{nuevo}</button>}>
        <DataGrid columns={cols} rows={items} getKey={(r) => r.id}
          label={titulo} scrollClass="cat-scroll" storageKey={storageKey} fitRows
          searchable exportable actionsWidth="92px" emptyLabel={emptyLabel}
          actions={(r) => <>
            <button className="act-btn" title="Editar" onClick={() => setEdit(r)}><Icon name="edit" size={15} /></button>
            <button className="act-btn del" title="Eliminar" onClick={() => del(r)}><Icon name="trash" size={15} /></button>
          </>} />
      </CatShell>
      {edit && renderModal(edit, () => setEdit(null), load)}
    </>
  );
}

function EntidadesCard() {
  const cols: Column<EntidadItem>[] = [
    { key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "sigla", label: "Sigla", sortable: true, filterable: true, width: "180px", value: (r) => r.sigla },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <SiNo v={r.activo} /> },
  ];
  return <CrudCard<EntidadItem> path="/catalogos/entidad" icon="landmark" titulo="Entidades" nuevo="Nueva Entidad"
    hint="Entes de control (DIAN, UGPP, Superintendencias, Hacienda…). Alimentan el Calendario y el Ente de las Obligaciones."
    cols={cols} vacio={() => ({ id: 0, nombre: "", sigla: "", activo: true })}
    delTitulo="Eliminar entidad" delMsg={(r) => `Se eliminará «${r.nombre}».`}
    storageKey="cat-entidad" emptyLabel="Sin entidades."
    renderModal={(it, onClose, onSaved) => <EntidadModal ent={it} onClose={onClose} onSaved={onSaved} />} />;
}

/** Catálogo de Formularios DIAN (350, etc.). Solo Super. La autorización de quién
 *  puede presentar cada uno se define en Roles y permisos. */
interface FormularioItem { id: number; nombre: string; numero: string; codigo_calendario: string; activo: boolean; }

function FormularioModal({ f0, obligaciones, onClose, onSaved }: { f0: FormularioItem; obligaciones: Oblig[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!f0.id;
  const [f, setF] = useState<FormularioItem>(f0);
  const set = (patch: Partial<FormularioItem>) => setF((x) => ({ ...x, ...patch }));
  const guardar = async () => {
    const nombre = f.nombre.trim();
    if (!nombre) { toast("El nombre es obligatorio", true); return; }
    try {
      const payload = { nombre, numero: f.numero.trim(), codigo_calendario: f.codigo_calendario.trim(), activo: f.activo };
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
        <label className="cq-fld"><span>Número</span>
          <input value={f.numero} onChange={(e) => set({ numero: e.target.value })} placeholder="Ej. 350" /></label>
        <label className="cq-fld obl-wide"><span>Código Calendario (obligación enlazada)</span>
          <select value={f.codigo_calendario} onChange={(e) => set({ codigo_calendario: e.target.value })}>
            <option value="">— ninguna —</option>
            {f.codigo_calendario && !obligaciones.some((o) => o.codigo === f.codigo_calendario) && <option value={f.codigo_calendario}>{f.codigo_calendario}</option>}
            {obligaciones.filter((o) => o.activo).map((o) => <option key={o.id} value={o.codigo}>{o.codigo} · {o.descripcion}</option>)}
          </select></label>
        <div className="obl-wide" style={{ marginTop: 2 }}>
          <Toggle label="Activo" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} /></div>
      </div>
    </Modal>
  );
}

function FormulariosCard() {
  // Los formularios usan /formularios (no /catalogos) y el modal necesita el
  // catálogo de obligaciones; se carga aquí y se pasa por el renderModal.
  const [obligaciones, setObligaciones] = useState<Oblig[]>([]);
  useEffect(() => {
    api.get("/catalogos/obligacion-tipo").then((l: Oblig[]) => setObligaciones(l)).catch(() => {});
  }, []);
  const cols: Column<FormularioItem>[] = [
    { key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "numero", label: "Número", sortable: true, filterable: true, width: "110px", align: "center", value: (r) => r.numero, render: (r) => r.numero ? <span className="pill">{r.numero}</span> : <span className="muted">—</span> },
    { key: "codigo_calendario", label: "Código Calendario", sortable: true, filterable: true, width: "220px", value: (r) => r.codigo_calendario, render: (r) => r.codigo_calendario ? <span className="pill">{r.codigo_calendario}</span> : <span className="muted">—</span> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <SiNo v={r.activo} /> },
  ];
  return <CrudCard<FormularioItem> path="/formularios" icon="file" titulo="Formularios" nuevo="Nuevo Formulario"
    hint="Formularios DIAN cuyos borradores se presentan (350, etc.). El Código Calendario es la llave estable (para enlazar con el Calendario). La autorización de quién puede presentar cada uno se define en Roles y permisos → Presentar borradores."
    cols={cols} vacio={() => ({ id: 0, nombre: "", numero: "", codigo_calendario: "", activo: true })}
    delTitulo="Eliminar formulario" delMsg={(r) => `Se eliminará «${r.nombre}» y sus autorizaciones.`}
    storageKey="cat-formulario" emptyLabel="Sin formularios."
    renderModal={(it, onClose, onSaved) => <FormularioModal f0={it} obligaciones={obligaciones} onClose={onClose} onSaved={onSaved} />} />;
}

/** Catálogo de Emisores: personas que firman/emiten las cuentas de cobro a nombre
 *  de la firma. Cada emisor lleva su propio consecutivo (ej. MB-421). */
interface EmisorItem { id: number; nombre: string; cedula: string; direccion: string; celular: string; prefijo: string; consecutivo: number; nota_383: boolean; firma: string; activo: boolean; }

function EmisorModal({ em, onClose, onSaved }: { em: EmisorItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editando = !!em.id;
  const [f, setF] = useState<EmisorItem>(em);
  const set = (patch: Partial<EmisorItem>) => setF((x) => ({ ...x, ...patch }));
  const onFirma = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = (e) => set({ firma: String(e.target?.result || "") });
    rd.readAsDataURL(file);
  };
  const guardar = async () => {
    const nombre = f.nombre.trim();
    if (!nombre) { toast("El nombre del emisor es obligatorio", true); return; }
    try {
      const payload = { nombre, cedula: f.cedula.trim(), direccion: f.direccion.trim(), celular: f.celular.trim(),
        prefijo: f.prefijo.trim().toUpperCase(), consecutivo: Math.max(0, Number(f.consecutivo) || 0),
        nota_383: f.nota_383, firma: f.firma, activo: f.activo };
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
      <div className="fieldgroup"><h4>Datos del emisor</h4>
        <div className="obl-grid">
          <label className="cq-fld obl-wide"><span>Nombre completo</span>
            <input value={f.nombre} autoFocus onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej. María Bernarda Fernández Garrido" /></label>
          <label className="cq-fld"><span>Cédula</span>
            <input value={f.cedula} onChange={(e) => set({ cedula: e.target.value })} placeholder="Ej. 45.461.353" /></label>
          <label className="cq-fld"><span>Celular</span>
            <input value={f.celular} onChange={(e) => set({ celular: e.target.value })} placeholder="Ej. 310 706 3656" /></label>
          <label className="cq-fld obl-wide"><span>Dirección</span>
            <input value={f.direccion} onChange={(e) => set({ direccion: e.target.value })} placeholder="Ej. Brr los Abetos Mz D Lt 18" /></label>
        </div>
      </div>

      <div className="fieldgroup"><h4>Numeración de la cuenta de cobro</h4>
        <div className="obl-grid">
          <label className="cq-fld"><span>Prefijo (iniciales del N°)</span>
            <input value={f.prefijo} maxLength={6} onChange={(e) => set({ prefijo: e.target.value.toUpperCase() })} placeholder="Ej. MB" /></label>
          <label className="cq-fld"><span>Consecutivo (último usado)</span>
            <input type="number" min={0} value={f.consecutivo} onChange={(e) => set({ consecutivo: Number(e.target.value) })} title="El siguiente N° será este + 1" /></label>
        </div>
      </div>

      <div className="fieldgroup"><h4>Firma</h4>
        <div className="firma-up">
          <label className="firma-drop" title="Cargar / cambiar firma (imagen; idealmente PNG con fondo transparente)">
            {f.firma ? <img src={f.firma} alt="firma" /> : <span className="firma-ph"><Icon name="edit" size={24} />Subir firma</span>}
            <input type="file" accept="image/*" onChange={(e) => onFirma(e.target.files?.[0])} />
            {f.firma && <span className="foto-ov">Cambiar</span>}
          </label>
          {f.firma && <button type="button" className="foto-clr" title="Quitar firma" onClick={() => set({ firma: "" })}><Icon name="broom" size={15} /></button>}
        </div>
      </div>

      <div className="fieldgroup"><h4>Estado</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 320 }}>
          <Toggle label="Activo" color="green" checked={f.activo} onChange={(v) => set({ activo: v })} />
          <Toggle label="Incluye nota art. 383 ET" checked={f.nota_383} onChange={(v) => set({ nota_383: v })} />
        </div>
      </div>
    </Modal>
  );
}

function EmisoresCard() {
  const cols: Column<EmisorItem>[] = [
    { key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre },
    { key: "cedula", label: "Cédula", type: "code", sortable: true, width: "140px", value: (r) => r.cedula },
    { key: "prefijo", label: "Prefijo", align: "center", sortable: true, width: "90px", value: (r) => r.prefijo, render: (r) => r.prefijo ? <span className="pill">{r.prefijo}</span> : <span className="muted">—</span> },
    { key: "consecutivo", label: "Último N°", align: "center", sortable: true, width: "100px", value: (r) => String(r.consecutivo), render: (r) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.prefijo ? `${r.prefijo}-${r.consecutivo}` : r.consecutivo}</span> },
    { key: "nota_383", label: "Nota 383", align: "center", sortable: true, filterable: true, width: "100px", value: (r) => (r.nota_383 ? "Sí" : "No"), render: (r) => <SiNo v={r.nota_383} /> },
    { key: "activo", label: "Activo", align: "center", sortable: true, filterable: true, width: "90px", value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <SiNo v={r.activo} /> },
  ];
  return <CrudCard<EmisorItem> path="/catalogos/emisor" icon="user" titulo="Emisores" nuevo="Nuevo Emisor"
    hint="Personas que firman y emiten las cuentas de cobro a nombre de la firma. Cada una lleva su propio consecutivo (ej. MB-421) y, si aplica, la nota del art. 383."
    cols={cols} vacio={() => ({ id: 0, nombre: "", cedula: "", direccion: "", celular: "", prefijo: "", consecutivo: 0, nota_383: false, firma: "", activo: true })}
    delTitulo="Eliminar emisor" delMsg={(r) => `Se eliminará «${r.nombre}».`}
    storageKey="cat-emisor" emptyLabel="Sin emisores."
    renderModal={(it, onClose, onSaved) => <EmisorModal em={it} onClose={onClose} onSaved={onSaved} />} />;
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
