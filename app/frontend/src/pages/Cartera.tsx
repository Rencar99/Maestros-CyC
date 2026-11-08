import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DateInput } from "../components/DateInput";
import { useActiveReload } from "../useActiveReload";
import { Icon, pesos, SecTitle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";
import { AsyncCombo } from "../components/AsyncCombo";

// --- Catálogos de presentación (estado de gestión y edad de cartera) ---
const EST: Record<string, { lbl: string; cls: string }> = {
  sin_gestion: { lbl: "Sin gestión", cls: "cxc-g-sin" },
  en_gestion: { lbl: "En gestión", cls: "cxc-g-gest" },
  promesa: { lbl: "Promesa de pago", cls: "cxc-g-prom" },
  disputa: { lbl: "En disputa", cls: "cxc-g-disp" },
  juridico: { lbl: "Jurídico", cls: "cxc-g-jur" },
  al_dia: { lbl: "Al día", cls: "cxc-g-ok" },
};
const EST_ORDEN = ["sin_gestion", "en_gestion", "promesa", "disputa", "juridico", "al_dia"];
// Tipo de interacción de una anotación del historial (CRM de cobro).
const TIPO_NOTA: Record<string, { lbl: string; icon: string }> = {
  llamada: { lbl: "Llamada", icon: "phone" },
  correo: { lbl: "Correo", icon: "mail" },
  whatsapp: { lbl: "WhatsApp", icon: "whatsapp" },
  visita: { lbl: "Visita", icon: "map-pin" },
  acuerdo: { lbl: "Acuerdo", icon: "check" },
  nota: { lbl: "Nota", icon: "file" },
};
const TIPO_ORDEN = ["llamada", "whatsapp", "correo", "visita", "acuerdo", "nota"];
// Agenda de cobro (acciones programadas): tipo de acción y prioridad.
const TIPO_ACC: Record<string, { lbl: string; icon: string }> = {
  llamada: { lbl: "Llamada", icon: "phone" },
  whatsapp: { lbl: "WhatsApp", icon: "whatsapp" },
  correo: { lbl: "Correo", icon: "mail" },
  visita: { lbl: "Visita", icon: "map-pin" },
  otro: { lbl: "Otro", icon: "file" },
};
const TIPO_ACC_ORDEN = ["llamada", "whatsapp", "correo", "visita", "otro"];
const PRIO: Record<string, { lbl: string; cls: string }> = {
  alta: { lbl: "Alta", cls: "cxc-p-alta" },
  media: { lbl: "Media", cls: "cxc-p-media" },
  baja: { lbl: "Baja", cls: "cxc-p-baja" },
};
const PRIO_ORDEN = ["alta", "media", "baja"];
const BUK: Record<string, { lbl: string; cls: string }> = {
  "corriente": { lbl: "Corriente", cls: "cxc-e-corr" },
  "1-30": { lbl: "1–30", cls: "cxc-e-1" },
  "31-60": { lbl: "31–60", cls: "cxc-e-2" },
  "61-90": { lbl: "61–90", cls: "cxc-e-3" },
  "90+": { lbl: "+90", cls: "cxc-e-4" },
};
const BUK_COLOR: Record<string, string> = {
  "corriente": "#2563eb", "1-30": "#0f9d58", "31-60": "#e0a90b", "61-90": "#e8821f", "90+": "#d64545",
};
const BUK_ORDEN = ["corriente", "1-30", "31-60", "61-90", "90+"];

const comp = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
};
// Fecha en formato AAAA-MM-DD (estándar de la firma). El backend ya entrega ISO.
const fmtFecha = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

interface Row {
  nit: string; nombre: string; cliente_id: number | null; grupo: string;
  docs: number; saldo: number; dias_max: number; bucket: string;
  fecha_antigua: string | null; doc_antiguo: string;
  estado: string; compromiso_fecha: string | null; proximo_contacto: string | null;
  riesgo?: string; dias_sin_gestion?: number | null;
  prox_accion?: { id: number; tipo: string; fecha: string } | null;
  factura_unica?: string | null;
}
// Semáforo de prioridad (riesgo) del cockpit de cobro.
const RIESGO: Record<string, { lbl: string; dot: string }> = {
  alta: { lbl: "Alta", dot: "#d64545" },
  media: { lbl: "Media", dot: "#e0a90b" },
  baja: { lbl: "Baja", dot: "#0f9d58" },
};
const RIESGO_ORDEN = ["alta", "media", "baja"];

/** Campo de fecha estándar de la firma: texto AAAA-MM-DD (el date-picker nativo
 *  muestra el formato del navegador) + ícono de calendario que abre el datepicker
 *  y escribe en AAAA-MM-DD. */
interface Resumen {
  configurado: boolean; sincronizado_at: string | null; sincronizado_por: string;
  total: number; docs: number; clientes: number; vencido: number;
  edades: { bucket: string; docs: number; saldo: number }[];
}
interface Doc {
  nit: string; nombre: string; documento: string; tipodoc: string; grupo: string;
  fecfac: string | null; vencimiento: string | null; venfac: number;
  dias_venc: number; bucket: string; saldo: number;
}

/** Sección "Cartera / CxC": cartera por cobrar de la firma (snapshot de GLERP) +
 *  seguimiento de cobro. Fila por cliente; el panel de gestión y el estado de
 *  cuenta se abren por fila. */
export function Cartera({ puede, active }: { puede: (c: string) => boolean; active: boolean }) {
  const puedeEditar = puede("cartera.editar");
  const puedeSync = puede("cartera.sincronizar");
  const toast = useToast();
  const confirmar = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [res, setRes] = useState<Resumen | null>(null);
  const [vista, setVista] = useState<"resumen" | "edades">("resumen");   // pestaña activa
  const [cargando, setCargando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [gestion, setGestion] = useState<Row | null>(null);
  const [cuenta, setCuenta] = useState<Row | null>(null);
  const [enviar, setEnviar] = useState<Row | null>(null);
  const [wa, setWa] = useState<Row | null>(null);
  const [edad, setEdad] = useState<string>("todos");   // chip de rango de edad activo
  const [grupoF, setGrupoF] = useState<string>("");    // filtro por grupo económico ("" = todos)

  // Saldo/nº de clientes por rango (antigüedad máxima del cliente) para los chips,
  // y las filas filtradas por el chip activo.
  const stats = useMemo(() => {
    const m: Record<string, { n: number; saldo: number }> = {};
    for (const b of BUK_ORDEN) m[b] = { n: 0, saldo: 0 };
    let tn = 0, ts = 0;
    for (const r of rows) {
      const b = m[r.bucket] ? r.bucket : "corriente";
      m[b].n++; m[b].saldo += r.saldo; tn++; ts += r.saldo;
    }
    return { m, tn, ts };
  }, [rows]);
  // Grupos económicos presentes en la cartera (para el filtro).
  const gruposDisp = useMemo(
    () => Array.from(new Set(rows.map((r) => r.grupo).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  const filtradas = useMemo(
    () => rows.filter((r) => (edad === "todos" || r.bucket === edad) && (!grupoF || r.grupo === grupoF)), [rows, edad, grupoF]);
  const saldoFiltrado = useMemo(() => filtradas.reduce((a, r) => a + r.saldo, 0), [filtradas]);
  // Vista 'CxC por Edades' (detalle por documento), heredando el chip de edad.
  const docsFiltrados = useMemo(
    () => docs.filter((d) => (edad === "todos" || d.bucket === edad) && (!grupoF || d.grupo === grupoF)), [docs, edad, grupoF]);
  const saldoDocs = useMemo(() => docsFiltrados.reduce((a, d) => a + d.saldo, 0), [docsFiltrados]);

  const cargar = () => {
    setCargando(true);
    Promise.all([api.get("/cartera"), api.get("/cartera/resumen"), api.get("/cartera/documentos")])
      .then(([l, r, d]: any) => { setRows(l.rows || []); setRes(r); setDocs(d.rows || []); })
      .catch((e) => toast(e.message, true))
      .finally(() => setCargando(false));
  };
  useActiveReload(active, cargar, []);

  const sincronizar = async () => {
    if ((await confirmar({
      titulo: "Sincronizar cartera",
      mensaje: "Se traerá la cartera abierta desde GLERP y se reemplazará la foto actual. No modifica GLERP.",
      confirmar: "Sincronizar",
    })) !== "si") return;
    setSincronizando(true);
    try {
      const x: any = await api.post("/cartera/sincronizar", {});
      toast(`Cartera actualizada: ${x.docs} documentos · ${x.clientes} clientes ✓`);
      cargar();
    } catch (e: any) { toast(e.message, true); }
    finally { setSincronizando(false); }
  };

  const pctBase = stats.ts || 1;   // total de la cartera (todas las filas) para el %
  const cols: Column<Row>[] = [
    {
      key: "nombre", label: "Cliente", sortable: true, filterable: true, minWidth: "240px", width: "300px",
      value: (r) => r.nombre || r.nit,
      render: (r) => <div><div className="cxc-cli">{r.nombre || "—"}</div>
        {!r.cliente_id && <span className="cxc-noenlace" title="No está en el maestro de Clientes">sin enlace</span>}</div>,
    },
    { key: "nit", label: "NIT", type: "code", sortable: true, filterable: true, width: "110px", value: (r) => r.nit || "" },
    { key: "docs", label: "Docs", align: "center", sortable: true, width: "70px", total: true, value: (r) => r.docs },
    {
      key: "saldo", label: "Saldo", type: "money", sortable: true, total: true, width: "140px",
      value: (r) => r.saldo, formatter: (v) => pesos(v as number), render: (r) => <span>{pesos(r.saldo)}</span>,
    },
    {
      key: "pct", label: "% cartera", align: "right", sortable: true, total: true, width: "90px",
      value: (r) => (pctBase ? (r.saldo / pctBase) * 100 : 0),
      formatter: (v) => (v as number).toFixed(1) + " %",
      render: (r) => <span>{(pctBase ? (r.saldo / pctBase) * 100 : 0).toFixed(1)} %</span>,
    },
    { key: "dias_max", label: "Días máx.", align: "center", width: "90px", sortable: true, value: (r) => r.dias_max },
    {
      key: "fecha_antigua", label: "Más antiguo", type: "date", sortable: true, filterable: true, width: "115px", align: "center",
      value: (r) => r.fecha_antigua || "",
      tip: (r) => (r.doc_antiguo ? "Documento " + r.doc_antiguo : ""),
      render: (r) => <span style={{ color: r.fecha_antigua ? "var(--ink)" : "var(--ink-3)" }}>{fmtFecha(r.fecha_antigua)}</span>,
    },
    {
      key: "bucket", label: "Edad", type: "status", align: "center", sortable: true, width: "90px",
      value: (r) => (BUK[r.bucket] || BUK["corriente"]).lbl,
      render: (r) => { const b = BUK[r.bucket] || BUK["corriente"]; return <span className={"cxc-chip " + b.cls}>{b.lbl}</span>; },
    },
    {
      key: "estado", label: "Gestión", type: "status", align: "center", sortable: true, filterable: true, width: "130px",
      value: (r) => (EST[r.estado] || EST.sin_gestion).lbl,
      render: (r) => { const e = EST[r.estado] || EST.sin_gestion; return <span className={"cxc-chip " + e.cls}>{e.lbl}</span>; },
    },
    {
      key: "proximo_contacto", label: "Próx. contacto", type: "date", sortable: true, filterable: true, width: "130px", align: "center",
      value: (r) => r.proximo_contacto || "", render: (r) => <span style={{ color: r.proximo_contacto ? "var(--ink)" : "var(--ink-3)" }}>{fmtFecha(r.proximo_contacto)}</span>,
    },
  ];

  // Columnas de la vista 'CxC por Edades' (detalle por documento, como la imagen):
  // el saldo se reparte en la columna del rango que le corresponde.
  const colEdad = (key: string, label: string, b: string): Column<Doc> => ({
    key, label, type: "money", total: true, sortable: true, width: "105px",
    value: (d) => (d.bucket === b ? d.saldo : 0), formatter: (v) => pesos(v as number),
    render: (d) => (d.bucket === b ? <span>{pesos(d.saldo)}</span> : <span />),
  });
  const dcols: Column<Doc>[] = [
    { key: "nit", label: "NIT", type: "code", sortable: true, filterable: true, width: "100px", value: (d) => d.nit || "" },
    { key: "nombre", label: "Nombre / Razón Social", sortable: true, filterable: true, minWidth: "200px", width: "250px", value: (d) => d.nombre || "", render: (d) => <span className="cxc-cli">{d.nombre || "—"}</span> },
    { key: "fecfac", label: "Fecha", type: "date", sortable: true, filterable: true, width: "95px", value: (d) => d.fecfac || "", render: (d) => <span>{fmtFecha(d.fecfac)}</span> },
    { key: "vencimiento", label: "Vence", type: "date", sortable: true, filterable: true, width: "95px", value: (d) => d.vencimiento || "", render: (d) => <span>{fmtFecha(d.vencimiento)}</span> },
    { key: "venfac", label: "Plazo", align: "center", sortable: true, filterable: true, width: "70px", value: (d) => d.venfac },
    { key: "documento", label: "Documento", sortable: true, filterable: true, width: "140px", value: (d) => d.documento || "",
      render: (d) => <span className="cxc-doc-cell">{d.documento || "—"}<FacturaPdfBtn doc={d} /></span> },
    { key: "saldo", label: "Saldo actual", type: "money", total: true, sortable: true, width: "115px", value: (d) => d.saldo, formatter: (v) => pesos(v as number), render: (d) => <span>{pesos(d.saldo)}</span> },
    { key: "dias", label: "Días", align: "center", sortable: true, width: "65px", value: (d) => d.dias_venc, render: (d) => <span>{d.dias_venc > 0 ? d.dias_venc : "—"}</span> },
    colEdad("b_corr", "Corriente", "corriente"),
    colEdad("b1", "1–30", "1-30"),
    colEdad("b2", "31–60", "31-60"),
    colEdad("b3", "61–90", "61-90"),
    colEdad("b4", "+90", "90+"),
  ];
  const tabsBar = (
    <div className="cxc-vtabs">
      <button className={"cxc-vtab" + (vista === "resumen" ? " on" : "")} onClick={() => setVista("resumen")}>Resumen CxC</button>
      <button className={"cxc-vtab" + (vista === "edades" ? " on" : "")} onClick={() => setVista("edades")}>CxC por Edades</button>
    </div>
  );
  const grupoSel = gruposDisp.length > 0 ? (
    <select className="cxc-grupo-sel" value={grupoF} onChange={(e) => setGrupoF(e.target.value)} title="Filtrar por grupo económico">
      <option value="">Todos los grupos</option>
      {gruposDisp.map((g) => <option key={g} value={g}>{g}</option>)}
    </select>
  ) : null;

  const sincTxt = res?.sincronizado_at
    ? `Última sincronización: ${fmtFecha(res.sincronizado_at)} ${new Date(res.sincronizado_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`
    : "Sin sincronizar";

  return (
    <div className="card gframe">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SecTitle icon="coins">Cartera por cobrar</SecTitle>
        <div className="r" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="cxc-sync">{sincTxt}</span>
          {puedeSync && <button className="btn primary sm" onClick={sincronizar} disabled={sincronizando}>
            <Icon name={sincronizando ? "hourglass" : "refresh"} size={15} />{sincronizando ? "Sincronizando…" : "Actualizar cartera"}</button>}
        </div>
      </div>

      <div className="cxc-tabs">
        <button className={"cxc-tab" + (edad === "todos" ? " on" : "")} onClick={() => setEdad("todos")}>
          <span className="lb">Todos</span><span className="val">{comp(stats.ts)}</span><span className="n">{stats.tn}</span>
        </button>
        {BUK_ORDEN.map((b) => (
          <button key={b} className={"cxc-tab" + (edad === b ? " on" : "")} onClick={() => setEdad(b)}
            style={edad === b ? { borderColor: BUK_COLOR[b] } : undefined}>
            <span className="dot" style={{ background: BUK_COLOR[b] }} />
            <span className="lb">{BUK[b].lbl}</span><span className="val">{comp(stats.m[b].saldo)}</span><span className="n">{stats.m[b].n}</span>
          </button>
        ))}
      </div>

      <div className="gframe-body">
        {res && !res.configurado && res.docs === 0
          ? <p style={{ color: "var(--ink-3)", padding: "8px 2px" }}>GLERP aún no está configurado en el servidor. Pídele al administrador que defina la conexión de solo lectura, luego usa «Actualizar cartera».</p>
          : vista === "resumen"
            ? <DataGrid columns={cols} rows={filtradas} getKey={(r) => r.nit || String(r.cliente_id)}
                label="Cartera por cobrar" storageKey="cartera-grid" fitRows toolbar={<>{tabsBar}{grupoSel}</>}
                searchable exportable defaultTotals={["saldo"]} frozen={1}
                emptyLabel={cargando ? "Cargando…" : edad !== "todos" ? "No hay cartera en este rango." : "No hay cartera. Usa «Actualizar cartera» para traerla de GLERP."}
                onRowClick={(r) => setGestion(r)}
                actions={(r) => <span className="cc-cell">
                  {r.factura_unica && <FacturaPdfBtn doc={{ documento: r.factura_unica, tipodoc: "FR" }} btnClass="act-btn" size={15} />}
                  <button className="act-btn" title="Estado de cuenta (documentos)" onClick={() => setCuenta(r)}><Icon name="list" size={15} /></button>
                  {puedeEditar && <button className="act-btn" title="Enviar estado de cuenta por correo" onClick={() => setEnviar(r)}><Icon name="mail" size={15} /></button>}
                  {puedeEditar && <button className="act-btn act-wa" title="Enviar por WhatsApp" onClick={() => setWa(r)}><Icon name="whatsapp" size={15} /></button>}
                  {puedeEditar && <button className="act-btn" title="Gestión de cobro" onClick={() => setGestion(r)}><Icon name="edit" size={15} /></button>}
                </span>} />
            : <DataGrid columns={dcols} rows={docsFiltrados} getKey={(d) => d.nit + "|" + d.documento}
                label="CxC por edades" storageKey="cartera-edades" fitRows toolbar={<>{tabsBar}{grupoSel}</>}
                searchable exportable defaultTotals={["saldo", "b_corr", "b1", "b2", "b3", "b4"]} frozen={2}
                emptyLabel={cargando ? "Cargando…" : edad !== "todos" ? "No hay documentos en este rango." : "No hay cartera. Usa «Actualizar cartera» para traerla de GLERP."} />}
      </div>
      <div className="gframe-foot">
        {vista === "resumen"
          ? <>{filtradas.length} cliente{filtradas.length === 1 ? "" : "s"}{edad !== "todos" ? ` · ${BUK[edad].lbl}` : " con saldo"}<span className="gf-dot">·</span> {comp(saldoFiltrado)}</>
          : <>{docsFiltrados.length} documento{docsFiltrados.length === 1 ? "" : "s"}{edad !== "todos" ? ` · ${BUK[edad].lbl}` : ""}<span className="gf-dot">·</span> {comp(saldoDocs)}</>}
      </div>

      {gestion && <GestionModal row={gestion} puedeEditar={puedeEditar} onClose={() => setGestion(null)} onSaved={cargar} onVerCuenta={() => { setCuenta(gestion); setGestion(null); }} />}
      {cuenta && <CuentaModal row={cuenta} onClose={() => setCuenta(null)} />}
      {enviar && <EnviarModal row={enviar} onClose={() => setEnviar(null)} onSent={cargar} />}
      {wa && <WaModal row={wa} onClose={() => setWa(null)} />}
    </div>
  );
}

/** Página «Gestión de CxC» (grupo Comercial): workspace de cobro con selector de
 *  cliente (los que tienen cartera) + estado de cuenta/correo/WhatsApp + el panel
 *  de gestión e historial. Reutiliza GestionBody y los modales de Cartera. */
export function GestionCxc({ puede, active }: { puede: (c: string) => boolean; active: boolean }) {
  const puedeEditar = puede("cartera.editar");
  const puedePrograma = puede("cartera.programar");
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<"lista" | "tablero">("lista");
  const [seg, setSeg] = useState<"todos" | "v90" | "promesas" | "singestion">("todos");
  const [grupoF, setGrupoF] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());   // NITs marcados
  const [viewRows, setViewRows] = useState<Row[]>([]);        // filas visibles del grid (para "seleccionar todo")
  const [gestores, setGestores] = useState<Gestor[]>([]);
  const [gestion, setGestion] = useState<Row | null>(null);  // gestión individual (modal)
  const [grupoM, setGrupoM] = useState<string | null>(null); // grupo consolidado (modal)
  const [enviar, setEnviar] = useState<Row | null>(null);
  const [wa, setWa] = useState<Row | null>(null);
  const [bulk, setBulk] = useState<{ tipo?: string } | null>(null);  // popover programar lote

  const cargar = () => {
    setCargando(true);
    api.get("/cartera").then((d: any) => setRows(d.rows || []))
      .catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  };
  useActiveReload(active, cargar, []);
  useEffect(() => { if (active) api.get("/cartera/gestores").then((d: any) => setGestores(d.rows || [])).catch(() => {}); }, [active]); // eslint-disable-line

  const gruposDisp = useMemo(
    () => Array.from(new Set(rows.map((r) => r.grupo).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  const hoy = useMemo(() => new Date().toISOString().slice(0, 10), []);
  // Segmentos inteligentes + filtro de grupo.
  const filtered = useMemo(() => rows.filter((r) => {
    if (grupoF && r.grupo !== grupoF) return false;
    if (seg === "v90") return r.bucket === "90+";
    if (seg === "promesas") return r.estado === "promesa" && !!r.compromiso_fecha && r.compromiso_fecha < hoy;
    if (seg === "singestion") return r.dias_sin_gestion == null || r.dias_sin_gestion >= 15;
    return true;
  }), [rows, grupoF, seg, hoy]);

  const selList = useMemo(() => filtered.filter((r) => sel.has(r.nit)), [filtered, sel]);
  const selSaldo = useMemo(() => selList.reduce((a, r) => a + r.saldo, 0), [selList]);
  useEffect(() => { setSel(new Set()); }, [seg, grupoF, vista]); // eslint-disable-line

  const toggle = (nit: string) => setSel((s) => { const n = new Set(s); n.has(nit) ? n.delete(nit) : n.add(nit); return n; });
  const toggleAll = () => {
    const vis = viewRows.map((r) => r.nit);
    const todos = vis.length > 0 && vis.every((x) => sel.has(x));
    setSel((s) => { const n = new Set(s); vis.forEach((x) => todos ? n.delete(x) : n.add(x)); return n; });
  };
  const limpiarSel = () => setSel(new Set());

  const marcarHecha = async (r: Row) => {
    if (!r.prox_accion) return;
    try { await api.post(`/cartera/acciones/${r.prox_accion.id}/cerrar`, {}); toast("Acción marcada como hecha ✓"); cargar(); }
    catch (e: any) { toast(e.message, true); }
  };
  const cambiarEstado = async (nit: string, estado: string) => {
    try { await api.post(`/cartera/cliente/${encodeURIComponent(nit)}/gestion`, { estado }); cargar(); }
    catch (e: any) { toast(e.message, true); }
  };

  const cols: Column<Row>[] = [
    { key: "sel", label: "", width: "40px", align: "center",
      headerRender: () => { const vis = viewRows.map((r) => r.nit); const n = vis.filter((x) => sel.has(x)).length;
        return <input type="checkbox" aria-label="Seleccionar todo" checked={n > 0 && n === vis.length}
          ref={(el) => { if (el) el.indeterminate = n > 0 && n < vis.length; }} onChange={toggleAll} />; },
      render: (r) => <input type="checkbox" aria-label={`Seleccionar ${r.nombre || r.nit}`}
        checked={sel.has(r.nit)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.nit)} /> },
    { key: "riesgo", label: "", width: "46px", align: "center", sortable: true,
      value: (r) => RIESGO_ORDEN.indexOf(r.riesgo || "media"),
      render: (r) => { const x = RIESGO[r.riesgo || "media"]; return <span className="cxc-sem" title={"Prioridad " + x.lbl} style={{ background: x.dot }} />; } },
    { key: "nombre", label: "Cliente", sortable: true, filterable: true, minWidth: "220px", width: "280px",
      value: (r) => r.nombre || r.nit,
      render: (r) => <div><div className="cxc-cli">{r.nombre || "—"}</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>NIT {r.nit}{r.grupo ? " · " + r.grupo : ""}</div></div> },
    { key: "saldo", label: "Saldo", type: "money", sortable: true, total: true, width: "130px",
      value: (r) => r.saldo, formatter: (v) => pesos(v as number), render: (r) => <span>{pesos(r.saldo)}</span> },
    { key: "bucket", label: "Edad", type: "status", align: "center", sortable: true, width: "90px",
      value: (r) => (BUK[r.bucket] || BUK.corriente).lbl,
      render: (r) => { const b = BUK[r.bucket] || BUK.corriente; return <span className={"cxc-chip " + b.cls}>{b.lbl}</span>; } },
    { key: "estado", label: "Gestión", type: "status", align: "center", sortable: true, filterable: true, width: "120px",
      value: (r) => (EST[r.estado] || EST.sin_gestion).lbl,
      render: (r) => { const e = EST[r.estado] || EST.sin_gestion; return <span className={"cxc-chip " + e.cls}>{e.lbl}</span>; } },
    { key: "prox", label: "Próx. acción", align: "center", sortable: true, width: "160px",
      value: (r) => r.prox_accion?.fecha || "",
      render: (r) => r.prox_accion ? (() => { const t = TIPO_ACC[r.prox_accion!.tipo] || TIPO_ACC.otro;
        return <span className="cxc-prox"><Icon name={t.icon} size={13} /> {fmtFecha(r.prox_accion!.fecha)}
          {puedeEditar && <button className="act-btn" title="Marcar como hecha" onClick={(e) => { e.stopPropagation(); marcarHecha(r); }}><Icon name="check" size={13} /></button>}</span>; })()
        : <span style={{ color: "var(--ink-3)" }}>—</span> },
  ];

  const segTabs = (
    <div className="cxc-vtabs">
      {([["todos", "Todos"], ["v90", "+90 días"], ["promesas", "Promesas vencidas"], ["singestion", "Sin gestión +15d"]] as const).map(([k, l]) => (
        <button key={k} className={"cxc-vtab" + (seg === k ? " on" : "")} onClick={() => setSeg(k)}>{l}</button>
      ))}
    </div>
  );
  const grupoSel = gruposDisp.length > 0 ? (
    <select className="cxc-grupo-sel" value={grupoF} onChange={(e) => setGrupoF(e.target.value)} title="Filtrar por grupo económico">
      <option value="">Todos los grupos</option>
      {gruposDisp.map((g) => <option key={g} value={g}>{g}</option>)}
    </select>
  ) : null;

  return (
    <div className="card gframe">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SecTitle icon="coins">Gestión de cartera</SecTitle>
        <div className="cxc-vtabs">
          <button className={"cxc-vtab" + (vista === "lista" ? " on" : "")} onClick={() => setVista("lista")}><Icon name="list" size={14} /> Lista</button>
          <button className={"cxc-vtab" + (vista === "tablero" ? " on" : "")} onClick={() => setVista("tablero")}><Icon name="briefcase" size={14} /> Tablero</button>
        </div>
      </div>
      <div className="gframe-body">
        {vista === "lista" ? (
          <DataGrid columns={cols} rows={filtered} getKey={(r) => r.nit} onView={setViewRows}
            label="Gestión de cartera" storageKey="cxc-cockpit" fitRows searchable exportable
            defaultTotals={["saldo"]} frozen={2}
            toolbar={<>{segTabs}{grupoSel}{grupoF && <button className="btn sm" onClick={() => setGrupoM(grupoF)} title="Gestión consolidada del grupo"><Icon name="briefcase" size={14} />Grupo consolidado</button>}</>}
            emptyLabel={cargando ? "Cargando…" : "No hay clientes con cartera en este filtro."}
            onRowClick={(r) => setGestion(r)}
            actions={(r) => <span className="cc-cell">
              {puedeEditar && <button className="act-btn" title="Enviar por correo" onClick={() => setEnviar(r)}><Icon name="mail" size={15} /></button>}
              {puedeEditar && <button className="act-btn act-wa" title="Enviar por WhatsApp" onClick={() => setWa(r)}><Icon name="whatsapp" size={15} /></button>}
              {puedeEditar && <button className="act-btn" title="Gestión de cobro" onClick={() => setGestion(r)}><Icon name="edit" size={15} /></button>}
            </span>} />
        ) : (
          <div className="cxc-board-wrap">
            <div className="cxc-kbtabs">{segTabs}{grupoSel}</div>
            <div className="cxc-kanban">
              {EST_ORDEN.map((est) => {
                const items = filtered.filter((r) => (r.estado || "sin_gestion") === est);
                const tot = items.reduce((a, r) => a + r.saldo, 0);
                const e = EST[est];
                return (
                  <div className="cxc-kcol" key={est}
                    onDragOver={(ev) => { ev.preventDefault(); (ev.currentTarget as HTMLElement).classList.add("over"); }}
                    onDragLeave={(ev) => (ev.currentTarget as HTMLElement).classList.remove("over")}
                    onDrop={(ev) => { ev.preventDefault(); (ev.currentTarget as HTMLElement).classList.remove("over");
                      const nit = ev.dataTransfer.getData("text/nit"); const cur = ev.dataTransfer.getData("text/est");
                      if (nit && cur !== est) cambiarEstado(nit, est); }}>
                    <div className="cxc-khead"><span className={"cxc-chip " + e.cls}>{e.lbl}</span><span className="cxc-kn">{items.length} · {comp(tot)}</span></div>
                    <div className="cxc-kbody">
                      {items.map((r) => (
                        <div key={r.nit} className="cxc-kcard" draggable={puedeEditar}
                          onDragStart={(ev) => { ev.dataTransfer.setData("text/nit", r.nit); ev.dataTransfer.setData("text/est", est); ev.dataTransfer.effectAllowed = "move"; }}
                          onClick={() => setGestion(r)}>
                          <div className="cxc-kc-top"><span className="cxc-sem" style={{ background: RIESGO[r.riesgo || "media"].dot }} /><span className="cxc-cli">{r.nombre || r.nit}</span></div>
                          <div className="cxc-kmeta"><span className={"cxc-chip " + (BUK[r.bucket] || BUK.corriente).cls}>{(BUK[r.bucket] || BUK.corriente).lbl}</span><b>{pesos(r.saldo)}</b></div>
                          {r.prox_accion && <div className="cxc-kprox"><Icon name={(TIPO_ACC[r.prox_accion.tipo] || TIPO_ACC.otro).icon} size={12} /> {fmtFecha(r.prox_accion.fecha)}</div>}
                        </div>
                      ))}
                      {items.length === 0 && <div className="cxc-kempty">—</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selList.length > 0 && (
        <div className="cxc-bulkbar">
          <span className="cxc-bulk-n"><b>{selList.length}</b> cliente{selList.length === 1 ? "" : "s"} · {pesos(selSaldo)}</span>
          {puedePrograma && <button className="cxc-bulk-act primary" onClick={() => setBulk({})}><Icon name="calendar" size={15} />Programar</button>}
          {puedePrograma && <button className="cxc-bulk-act" onClick={() => setBulk({ tipo: "whatsapp" })}><Icon name="whatsapp" size={15} />WhatsApp</button>}
          {puedePrograma && <button className="cxc-bulk-act" onClick={() => setBulk({ tipo: "correo" })}><Icon name="mail" size={15} />Correo</button>}
          <button className="cxc-bulk-x" onClick={limpiarSel} aria-label="Limpiar selección"><Icon name="x" size={16} /></button>
        </div>
      )}

      {gestion && <Modal title={gestion.nombre || gestion.nit}
        sub={`NIT ${gestion.nit} · ${gestion.docs} documento${gestion.docs === 1 ? "" : "s"} · saldo ${pesos(gestion.saldo)}`}
        icon="coins" size="xl" onClose={() => setGestion(null)}>
        <GestionBody nit={gestion.nit} puedeEditar={puedeEditar} onSaved={cargar} conCuenta /></Modal>}
      {grupoM && <Modal title={`Grupo ${grupoM}`} sub="Gestión consolidada" icon="briefcase" size="xl" onClose={() => setGrupoM(null)}>
        <GrupoBody grupo={grupoM} puedeEditar={puedeEditar} onSaved={cargar} /></Modal>}
      {bulk && <ProgramarModal accion="nueva" cartera={rows} gestores={gestores}
        preset={selList.map((r) => ({ alcance: "cliente" as const, key: r.nit, label: r.nombre || r.nit }))}
        presetTipo={bulk.tipo} presetSaldo={selSaldo} onClose={() => setBulk(null)} onSaved={() => { setBulk(null); limpiarSel(); cargar(); }} />}
      {enviar && <EnviarModal row={enviar} onClose={() => setEnviar(null)} onSent={cargar} />}
      {wa && <WaModal row={wa} onClose={() => setWa(null)} />}
    </div>
  );
}

/** Enviar el estado de cuenta por CORREO (tabla embebida por Graph delegado).
 *  El correo del cliente, CC, asunto y saludo son editables. */
function EnviarModal({ row, onClose, onSent }: { row: Row; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [para, setPara] = useState("");
  const [cc, setCc] = useState("");
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");

  useEffect(() => {
    api.get(`/cartera/cliente/${encodeURIComponent(row.nit)}/correo-preview`)
      .then((d: any) => {
        setPara(d.para || ""); setAsunto(d.asunto || ""); setCuerpo(d.cuerpo || "");
      })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  }, []); // eslint-disable-line

  const enviarCorreo = async () => {
    if (!para.trim()) { toast("Falta el correo del cliente", true); return; }
    setEnviando(true);
    try {
      const r: any = await api.post(`/cartera/cliente/${encodeURIComponent(row.nit)}/enviar`,
        { para: para.trim(), cc: cc.trim(), asunto, cuerpo });
      toast(`Estado de cuenta enviado a ${r.para} ✓`);
      onSent(); onClose();
    } catch (e: any) { toast(e.message, true); }
    finally { setEnviando(false); }
  };

  return (
    <Modal title={row.nombre || row.nit} sub={`Enviar estado de cuenta · saldo ${pesos(row.saldo)}`}
           icon="mail" size="md" onClose={onClose}
           onSave={enviarCorreo} saving={enviando} canSave={!!para.trim()}
           saveLabel="Enviar por correo" saveIcon="mail"
           aviso={cargando ? "Cargando…" : (!para.trim() ? "El cliente no tiene correo en el maestro; escríbelo o usa WhatsApp." : "")}
           avisoTone={!cargando && !para.trim() ? "warn" : "info"}>
      {cargando ? <div className="hint">Cargando…</div> : (
        <div className="fieldgroup">
          <div className="obl-grid">
            <label className="cq-fld"><span>Para</span>
              <input value={para} onChange={(e) => setPara(e.target.value)} placeholder="correo@cliente.com" /></label>
            <label className="cq-fld"><span>CC (copia)</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Opcional · coma entre varios" /></label>
            <label className="cq-fld obl-wide"><span>Asunto</span>
              <input value={asunto} onChange={(e) => setAsunto(e.target.value)} /></label>
            <label className="cq-fld obl-wide"><span>Saludo</span>
              <textarea rows={5} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} /></label>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Enviar por WhatsApp (api.whatsapp.com): celular y mensaje editables; el
 *  detalle va por correo (no adjunta). Abre WhatsApp con el texto prellenado. */
function WaModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [celular, setCelular] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    api.get(`/cartera/cliente/${encodeURIComponent(row.nit)}/correo-preview`)
      .then((d: any) => { setCelular(d.celular || ""); setMensaje(d.wa_texto || ""); })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  }, []); // eslint-disable-line

  const abrir = () => {
    const cel = celular.replace(/\D/g, "");
    if (!cel) { toast("Falta el celular del cliente", true); return; }
    const num = cel.length === 10 ? "57" + cel : cel;   // Colombia
    // api.whatsapp.com (NO wa.me): wa.me rompe los emojis de 4 bytes (plano
    // astral) en su redirección, convirtiéndolos en «�». api.whatsapp.com los
    // conserva intactos.
    window.open(`https://api.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(mensaje)}`, "_blank");
    // Deja constancia en el historial de gestión (no bloquea si falla).
    api.post(`/cartera/cliente/${encodeURIComponent(row.nit)}/wa-enviado`, { celular }).catch(() => {});
    onClose();
  };

  return (
    <Modal title={row.nombre || row.nit} sub={`Enviar por WhatsApp · saldo ${pesos(row.saldo)}`}
           icon="whatsapp" size="md" onClose={onClose}
           onSave={abrir} canSave={!!celular.replace(/\D/g, "")}
           saveLabel="Abrir WhatsApp" saveIcon="whatsapp"
           aviso={cargando ? "Cargando…" : (!celular.replace(/\D/g, "") ? "El cliente no tiene celular en el maestro; escríbelo para continuar." : "")}
           avisoTone={!cargando && !celular.replace(/\D/g, "") ? "warn" : "info"}>
      {cargando ? <div className="hint">Cargando…</div> : (
        <div className="fieldgroup">
          <div className="obl-grid">
            <label className="cq-fld"><span>Celular</span>
              <input value={celular} onChange={(e) => setCelular(e.target.value)} placeholder="3XX XXX XXXX" /></label>
            <label className="cq-fld obl-wide"><span>Mensaje</span>
              <textarea rows={7} value={mensaje} onChange={(e) => setMensaje(e.target.value)} /></label>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Cuerpo reutilizable de gestión de cobro (estado + compromiso + próximo
 *  contacto + tipo/nota + historial), con su propio botón Guardar. Lo usan el
 *  modal de la fila y la pestaña «Gestión de cobro». Se recarga al cambiar de
 *  cliente (`nit`) y NO se cierra al guardar (deja ver la anotación nueva). */
type Hit = { id: number; fecha: string; usuario: string; texto: string; estado: string; tipo: string };
/** Documento del estado de cuenta (foto de GLERP) para la grilla embebida. */
type ECDoc = { documento: string; tipodoc: string; fecfac: string | null; vencimiento: string | null;
               dias_venc: number; bucket: string; vlrfac: number; saldo: number };
function GestionBody({ nit, puedeEditar, onSaved, conCuenta = false }: {
  nit: string; puedeEditar: boolean; onSaved?: () => void; conCuenta?: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [estado, setEstado] = useState("sin_gestion");
  const [compFecha, setCompFecha] = useState("");
  const [compValor, setCompValor] = useState("");
  const [prox, setProx] = useState("");
  const [nota, setNota] = useState("");
  const [notaTipo, setNotaTipo] = useState("llamada");
  const [hist, setHist] = useState<Hit[]>([]);
  const [ecDocs, setEcDocs] = useState<ECDoc[]>([]);
  const [ecTotal, setEcTotal] = useState(0);
  const [ecCargando, setEcCargando] = useState(conCuenta);

  const cargar = () => api.get(`/cartera/cliente/${encodeURIComponent(nit)}/gestion`)
    .then((d: any) => {
      setEstado(d.estado || "sin_gestion");
      setCompFecha((d.compromiso_fecha || "").slice(0, 10));
      setCompValor(d.compromiso_valor != null ? String(d.compromiso_valor) : "");
      setProx((d.proximo_contacto || "").slice(0, 10));
      setHist(d.notas || []);
    });
  useEffect(() => {
    setCargando(true); setNota("");
    cargar().catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, [nit]); // eslint-disable-line

  // Estado de cuenta embebido (solo en la página; el modal mantiene su botón).
  useEffect(() => {
    if (!conCuenta) return;
    setEcCargando(true);
    api.get(`/cartera/cliente/${encodeURIComponent(nit)}`)
      .then((d: any) => { setEcDocs(d.docs || []); setEcTotal(d.total || 0); })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setEcCargando(false));
  }, [nit, conCuenta]); // eslint-disable-line

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.post(`/cartera/cliente/${encodeURIComponent(nit)}/gestion`, {
        estado, compromiso_fecha: compFecha || null,
        compromiso_valor: compValor ? Number(compValor.replace(/[^\d.-]/g, "")) : null,
        proximo_contacto: prox || null, nota: nota.trim() || null, nota_tipo: notaTipo,
      });
      setNota(""); await cargar(); toast("Gestión guardada ✓"); onSaved?.();
    } catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };

  const histCols: Column<Hit>[] = [
    { key: "tipo", label: "Tipo", sortable: true, width: "118px",
      value: (h) => (TIPO_NOTA[h.tipo] || TIPO_NOTA.nota).lbl,
      render: (h) => { const t = TIPO_NOTA[h.tipo] || TIPO_NOTA.nota; return <span className="cxc-tipo"><Icon name={t.icon} size={14} /> {t.lbl}</span>; } },
    { key: "fecha", label: "Fecha", type: "date", sortable: true, width: "110px",
      value: (h) => h.fecha, render: (h) => <span>{fmtFecha(h.fecha)}</span> },
    { key: "usuario", label: "Usuario", sortable: true, width: "150px", value: (h) => h.usuario || "—" },
    { key: "texto", label: "Nota", minWidth: "240px", value: (h) => h.texto, tip: (h) => h.texto },
  ];
  const borrarNota = async (h: Hit) => {
    if (await confirm({ titulo: "Borrar anotación", mensaje: "¿Eliminar esta anotación del historial?", peligro: true, confirmar: "Borrar" }) !== "si") return;
    try { await api.del(`/cartera/nota/${h.id}`); setHist((xs) => xs.filter((x) => x.id !== h.id)); }
    catch (e: any) { toast(e.message, true); }
  };

  const ecCols: Column<ECDoc>[] = [
    { key: "documento", label: "Documento", sortable: true, width: "150px", value: (d) => d.documento || "",
      render: (d) => <span className="cxc-doc-cell">{d.documento || "—"}<FacturaPdfBtn doc={d} /></span> },
    { key: "vencimiento", label: "Vence", type: "date", sortable: true, width: "100px", value: (d) => d.vencimiento || "", render: (d) => <span>{fmtFecha(d.vencimiento)}</span> },
    { key: "dias", label: "Días", align: "center", sortable: true, width: "70px", value: (d) => d.dias_venc, render: (d) => <span>{d.dias_venc > 0 ? d.dias_venc : "—"}</span> },
    { key: "bucket", label: "Edad", type: "status", align: "center", sortable: true, width: "95px",
      value: (d) => (BUK[d.bucket] || BUK.corriente).lbl,
      render: (d) => { const b = BUK[d.bucket] || BUK.corriente; return <span className={"cxc-chip " + b.cls}>{b.lbl}</span>; } },
    { key: "vlrfac", label: "Valor", type: "money", sortable: true, width: "120px", value: (d) => d.vlrfac, formatter: (v) => pesos(v as number), render: (d) => <span>{pesos(d.vlrfac)}</span> },
    { key: "saldo", label: "Saldo", type: "money", total: true, sortable: true, width: "120px", value: (d) => d.saldo, formatter: (v) => pesos(v as number), render: (d) => <span><b>{pesos(d.saldo)}</b></span> },
  ];

  if (cargando) return <div className="hint">Cargando…</div>;
  return (<>
    <div className="fieldgroup cxc-crm"><h4>Gestión</h4>
      <div className="cxc-gline">
        <label className="cq-fld" style={{ flex: "0 0 148px" }}><span>Estado</span>
          <select value={estado} disabled={!puedeEditar} onChange={(e) => setEstado(e.target.value)}>
            {EST_ORDEN.map((k) => <option key={k} value={k}>{EST[k].lbl}</option>)}
          </select></label>
        <label className="cq-fld" style={{ flex: "0 0 150px" }}><span>Compromiso de pago</span>
          <DateInput value={compFecha} disabled={!puedeEditar} onChange={setCompFecha} /></label>
        <label className="cq-fld" style={{ flex: "0 0 140px" }}><span>Valor comprometido</span>
          <input value={compValor ? pesos(compValor) : ""} disabled={!puedeEditar}
            onChange={(e) => setCompValor(e.target.value.replace(/[^\d]/g, ""))} placeholder="$ 0" /></label>
        <label className="cq-fld" style={{ flex: "0 0 150px" }}><span>Próximo contacto</span>
          <DateInput value={prox} disabled={!puedeEditar} onChange={setProx} /></label>
        {puedeEditar && <label className="cq-fld" style={{ flex: "0 0 158px" }}><span>Tipo de interacción</span>
          <select value={notaTipo} onChange={(e) => setNotaTipo(e.target.value)}>
            {TIPO_ORDEN.map((k) => <option key={k} value={k}>{TIPO_NOTA[k].lbl}</option>)}
          </select></label>}
        {puedeEditar && <label className="cq-fld" style={{ flex: "1 1 200px", minWidth: 180 }}><span>Nota de gestión</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Registrar llamada, correo o acuerdo…" /></label>}
        {puedeEditar && <button className="btn primary sm" style={{ flex: "0 0 auto" }} onClick={guardar} disabled={guardando}><Icon name="save" size={15} />{guardando ? "Guardando…" : "Guardar"}</button>}
      </div>
    </div>
    <div className="cxc-grids">
      {conCuenta && <div className="fieldgroup cxc-crm cxc-hist-fg cxc-gridfg"><h4>Estado de cuenta</h4>
        {ecCargando ? <div className="hint">Cargando…</div>
          : ecDocs.length === 0 ? <div className="hint">Sin documentos.</div>
          : <DataGrid columns={ecCols} rows={ecDocs} getKey={(d) => d.documento}
              label="Estado de cuenta" storageKey="cxc-estado-cuenta"
              scrollClass="cxc-hist-scroll" searchable={false} exportable={false} />}
      </div>}
      <div className="fieldgroup cxc-crm cxc-hist-fg cxc-gridfg" style={{ flex: "1.4 1 0" }}><h4>Historial</h4>
        {hist.length === 0 ? <div className="hint">Sin anotaciones.</div>
          : <DataGrid columns={histCols} rows={hist} getKey={(h) => h.id}
              label="Historial de gestión" storageKey="cxc-historial"
              scrollClass="cxc-hist-scroll" searchable={false} exportable={false} actionsWidth="48px"
              actions={puedeEditar ? (h) => (
                <button className="act-btn del" title="Borrar anotación" onClick={() => borrarNota(h)}><Icon name="trash" size={15} /></button>
              ) : undefined} />}
      </div>
    </div>
  </>);
}

/** Cuerpo de gestión CONSOLIDADA de un grupo económico: estado de cuenta e
 *  historial de todas sus empresas juntos, y una gestión que se aplica a todas
 *  a la vez (sólo toca lo que se diligencia). */
type GEmp = { nit: string; empresa: string; saldo: number; docs: number };
type GDoc = ECDoc & { nit: string; empresa: string };
type GHit = Hit & { empresa: string };
function GrupoBody({ grupo, puedeEditar, onSaved }: { grupo: string; puedeEditar: boolean; onSaved?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [empresas, setEmpresas] = useState<GEmp[]>([]);
  const [docs, setDocs] = useState<GDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [hist, setHist] = useState<GHit[]>([]);
  const [estado, setEstado] = useState("");        // "" = sin cambiar
  const [compFecha, setCompFecha] = useState("");
  const [compValor, setCompValor] = useState("");
  const [prox, setProx] = useState("");
  const [nota, setNota] = useState("");
  const [notaTipo, setNotaTipo] = useState("llamada");

  const cargar = () => api.get(`/cartera/grupo/${encodeURIComponent(grupo)}`).then((d: any) => {
    setEmpresas(d.empresas || []); setDocs(d.docs || []); setTotal(d.total || 0); setHist(d.notas || []);
  });
  useEffect(() => {
    setCargando(true); setNota("");
    cargar().catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, [grupo]); // eslint-disable-line

  const guardar = async () => {
    if (!estado && !compFecha && !prox && !nota.trim()) { toast("Nada que registrar: escribe una nota o cambia un campo.", true); return; }
    setGuardando(true);
    try {
      const r: any = await api.post(`/cartera/grupo/${encodeURIComponent(grupo)}/gestion`, {
        estado: estado || null, compromiso_fecha: compFecha || null,
        compromiso_valor: compValor ? Number(compValor.replace(/[^\d.-]/g, "")) : null,
        proximo_contacto: prox || null, nota: nota.trim() || null, nota_tipo: notaTipo,
      });
      setNota(""); setEstado(""); setCompFecha(""); setCompValor(""); setProx("");
      await cargar(); toast(`Gestión aplicada a ${r.empresas} empresa${r.empresas === 1 ? "" : "s"} ✓`); onSaved?.();
    } catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };

  const dcols: Column<GDoc>[] = [
    { key: "empresa", label: "Empresa", sortable: true, minWidth: "150px", width: "180px", value: (d) => d.empresa || "", render: (d) => <span className="cxc-cli">{d.empresa || "—"}</span> },
    { key: "documento", label: "Documento", sortable: true, width: "150px", value: (d) => d.documento || "",
      render: (d) => <span className="cxc-doc-cell">{d.documento || "—"}<FacturaPdfBtn doc={d} /></span> },
    { key: "vencimiento", label: "Vence", type: "date", sortable: true, width: "100px", value: (d) => d.vencimiento || "", render: (d) => <span>{fmtFecha(d.vencimiento)}</span> },
    { key: "dias", label: "Días", align: "center", sortable: true, width: "70px", value: (d) => d.dias_venc, render: (d) => <span>{d.dias_venc > 0 ? d.dias_venc : "—"}</span> },
    { key: "bucket", label: "Edad", type: "status", align: "center", sortable: true, width: "95px",
      value: (d) => (BUK[d.bucket] || BUK.corriente).lbl,
      render: (d) => { const b = BUK[d.bucket] || BUK.corriente; return <span className={"cxc-chip " + b.cls}>{b.lbl}</span>; } },
    { key: "saldo", label: "Saldo", type: "money", total: true, sortable: true, width: "120px", value: (d) => d.saldo, formatter: (v) => pesos(v as number), render: (d) => <span><b>{pesos(d.saldo)}</b></span> },
  ];
  const hcols: Column<GHit>[] = [
    { key: "tipo", label: "Tipo", sortable: true, width: "118px",
      value: (h) => (TIPO_NOTA[h.tipo] || TIPO_NOTA.nota).lbl,
      render: (h) => { const t = TIPO_NOTA[h.tipo] || TIPO_NOTA.nota; return <span className="cxc-tipo"><Icon name={t.icon} size={14} /> {t.lbl}</span>; } },
    { key: "fecha", label: "Fecha", type: "date", sortable: true, width: "110px", value: (h) => h.fecha, render: (h) => <span>{fmtFecha(h.fecha)}</span> },
    { key: "empresa", label: "Empresa", sortable: true, width: "160px", value: (h) => h.empresa || "", render: (h) => <span className="cxc-cli">{h.empresa || "—"}</span> },
    { key: "texto", label: "Nota", minWidth: "220px", value: (h) => h.texto, tip: (h) => h.texto },
  ];
  const borrarNota = async (h: GHit) => {
    if (await confirm({ titulo: "Borrar anotación", mensaje: "¿Eliminar esta anotación del historial?", peligro: true, confirmar: "Borrar" }) !== "si") return;
    try { await api.del(`/cartera/nota/${h.id}`); setHist((xs) => xs.filter((x) => x.id !== h.id)); }
    catch (e: any) { toast(e.message, true); }
  };

  if (cargando) return <div className="hint">Cargando…</div>;
  return (<>
    <div className="fieldgroup cxc-crm"><h4>Gestión del grupo · {empresas.length} empresa{empresas.length === 1 ? "" : "s"} · saldo {pesos(total)}</h4>
      <div className="cxc-gline">
        <label className="cq-fld" style={{ flex: "0 0 160px" }}><span>Estado</span>
          <select value={estado} disabled={!puedeEditar} onChange={(e) => setEstado(e.target.value)}>
            <option value="">(sin cambiar)</option>
            {EST_ORDEN.map((k) => <option key={k} value={k}>{EST[k].lbl}</option>)}
          </select></label>
        <label className="cq-fld" style={{ flex: "0 0 150px" }}><span>Compromiso de pago</span>
          <DateInput value={compFecha} disabled={!puedeEditar} onChange={setCompFecha} /></label>
        <label className="cq-fld" style={{ flex: "0 0 140px" }}><span>Valor comprometido</span>
          <input value={compValor ? pesos(compValor) : ""} disabled={!puedeEditar}
            onChange={(e) => setCompValor(e.target.value.replace(/[^\d]/g, ""))} placeholder="$ 0" /></label>
        <label className="cq-fld" style={{ flex: "0 0 150px" }}><span>Próximo contacto</span>
          <DateInput value={prox} disabled={!puedeEditar} onChange={setProx} /></label>
        {puedeEditar && <label className="cq-fld" style={{ flex: "0 0 158px" }}><span>Tipo de interacción</span>
          <select value={notaTipo} onChange={(e) => setNotaTipo(e.target.value)}>
            {TIPO_ORDEN.map((k) => <option key={k} value={k}>{TIPO_NOTA[k].lbl}</option>)}
          </select></label>}
        {puedeEditar && <label className="cq-fld" style={{ flex: "1 1 200px", minWidth: 180 }}><span>Nota de gestión (a todas las empresas)</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Registrar llamada, correo o acuerdo…" /></label>}
        {puedeEditar && <button className="btn primary sm" style={{ flex: "0 0 auto" }} onClick={guardar} disabled={guardando}><Icon name="save" size={15} />{guardando ? "Guardando…" : "Aplicar al grupo"}</button>}
      </div>
    </div>
    <div className="cxc-grids">
      <div className="fieldgroup cxc-crm cxc-hist-fg cxc-gridfg"><h4>Estado de cuenta del grupo</h4>
        {docs.length === 0 ? <div className="hint">Sin documentos.</div>
          : <DataGrid columns={dcols} rows={docs} getKey={(d) => d.nit + "|" + d.documento}
              label="Estado de cuenta del grupo" storageKey="cxc-grupo-estado"
              scrollClass="cxc-hist-scroll" searchable={false} exportable={false} />}
      </div>
      <div className="fieldgroup cxc-crm cxc-hist-fg cxc-gridfg" style={{ flex: "1.2 1 0" }}><h4>Historial del grupo</h4>
        {hist.length === 0 ? <div className="hint">Sin anotaciones.</div>
          : <DataGrid columns={hcols} rows={hist} getKey={(h) => h.id}
              label="Historial del grupo" storageKey="cxc-grupo-hist"
              scrollClass="cxc-hist-scroll" searchable={false} exportable={false} actionsWidth="48px"
              actions={puedeEditar ? (h) => (
                <button className="act-btn del" title="Borrar anotación" onClick={() => borrarNota(h)}><Icon name="trash" size={15} /></button>
              ) : undefined} />}
      </div>
    </div>
  </>);
}

/** Modal de gestión desde una fila de la grilla: reutiliza GestionBody. */
function GestionModal({ row, puedeEditar, onClose, onSaved, onVerCuenta }: {
  row: Row; puedeEditar: boolean; onClose: () => void; onSaved: () => void; onVerCuenta: () => void;
}) {
  return (
    <Modal title={row.nombre || row.nit} sub={`NIT ${row.nit} · ${row.docs} documento${row.docs === 1 ? "" : "s"} · saldo ${pesos(row.saldo)}`}
           icon="coins" size="md" onClose={onClose}
           extraActions={<button className="mh-act" onClick={onVerCuenta} aria-label="Estado de cuenta"><Icon name="list" size={18} /><span className="mh-tip">Estado de cuenta</span></button>}>
      <GestionBody nit={row.nit} puedeEditar={puedeEditar} onSaved={onSaved} />
    </Modal>
  );
}

/** Página «Agenda de cobro» (grupo Comercial): programador de acciones de cobro
 *  tipo CRM. El supervisor (cartera.programar) crea y asigna acciones; el gestor
 *  ve su agenda, las ejecuta y deja la traza automática en el Gestor (historial). */
type Accion = {
  id: number; alcance: "cliente" | "grupo"; nit: string; grupo: string;
  objetivo: string; saldo: number; tipo: string; fecha_programada: string | null;
  asignado_a: string; asignado_nombre: string; prioridad: string;
  instruccion: string; estado: string; creado_nombre: string;
  resuelto_nombre: string; resuelto_at: string | null; resultado: string;
  vencida: boolean; dias: number;
};
type Gestor = { usuario: string; nombre: string };

export function AgendaCobro({ puede, active }: { puede: (c: string) => boolean; active: boolean }) {
  const puedePrograma = puede("cartera.programar");
  const puedeEditar = puede("cartera.editar");
  const toast = useToast();
  const confirmar = useConfirm();
  const [rows, setRows] = useState<Accion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [scope, setScope] = useState<"mias" | "todas">(puedePrograma ? "todas" : "mias");
  const [estado, setEstado] = useState<"pendiente" | "hechas" | "canceladas">("pendiente");
  const [cartera, setCartera] = useState<Row[]>([]);
  const [gestores, setGestores] = useState<Gestor[]>([]);
  const [prog, setProg] = useState<Accion | "nueva" | null>(null);
  const [cerrar, setCerrar] = useState<Accion | null>(null);

  const cargar = () => {
    setCargando(true);
    api.get(`/cartera/acciones?scope=${scope}&estado=${estado}`)
      .then((d: any) => setRows(d.rows || []))
      .catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  };
  useActiveReload(active, cargar, [scope, estado]);
  // Catálogos para los selectores del programador (clientes/grupos + gestores).
  useEffect(() => {
    if (!active) return;
    api.get("/cartera").then((d: any) => setCartera(d.rows || [])).catch(() => {});
    api.get("/cartera/gestores").then((d: any) => setGestores(d.rows || [])).catch(() => {});
  }, [active]); // eslint-disable-line

  const cancelar = async (a: Accion) => {
    if (await confirmar({ titulo: "Cancelar acción", mensaje: `¿Cancelar la acción de cobro de ${a.objetivo}?`, peligro: true, confirmar: "Cancelar acción" }) !== "si") return;
    try { await api.post(`/cartera/acciones/${a.id}/cancelar`, {}); toast("Acción cancelada ✓"); cargar(); }
    catch (e: any) { toast(e.message, true); }
  };

  const pend = estado === "pendiente";
  const cols: Column<Accion>[] = [
    { key: "prioridad", label: "Prioridad", type: "status", align: "center", sortable: true, width: "100px",
      value: (a) => (PRIO[a.prioridad] || PRIO.media).lbl,
      render: (a) => { const p = PRIO[a.prioridad] || PRIO.media; return <span className={"cxc-chip " + p.cls}>{p.lbl}</span>; } },
    { key: "fecha_programada", label: "Fecha", type: "date", sortable: true, width: "120px", align: "center",
      value: (a) => a.fecha_programada || "",
      render: (a) => (
        <span className={a.vencida ? "cxc-venc" : undefined}>
          {fmtFecha(a.fecha_programada)}
          {pend && a.vencida && <span className="cxc-venc-tag">vencida</span>}
          {pend && !a.vencida && a.dias === 0 && <span className="cxc-hoy-tag">hoy</span>}
        </span>) },
    { key: "tipo", label: "Acción", sortable: true, width: "120px",
      value: (a) => (TIPO_ACC[a.tipo] || TIPO_ACC.otro).lbl,
      render: (a) => { const t = TIPO_ACC[a.tipo] || TIPO_ACC.otro; return <span className="cxc-tipo"><Icon name={t.icon} size={14} /> {t.lbl}</span>; } },
    { key: "objetivo", label: "Cliente / Grupo", sortable: true, filterable: true, minWidth: "200px", width: "240px",
      value: (a) => a.objetivo || "",
      render: (a) => <div><span className="cxc-cli">{a.objetivo || "—"}</span>
        {a.alcance === "grupo" && <span className="cxc-noenlace" title="Acción para todo el grupo económico">grupo</span>}</div> },
    { key: "saldo", label: "Saldo", type: "money", sortable: true, width: "130px", align: "right",
      value: (a) => a.saldo, formatter: (v) => pesos(v as number),
      render: (a) => <span>{a.alcance === "grupo" ? "—" : pesos(a.saldo)}</span> },
    { key: "asignado_nombre", label: "Asignado a", sortable: true, filterable: true, width: "160px", value: (a) => a.asignado_nombre || "" },
    { key: "instruccion", label: "Instrucción", minWidth: "220px", value: (a) => a.instruccion, tip: (a) => a.instruccion },
    ...(pend ? [] : [{ key: "resultado", label: "Resultado", minWidth: "220px", value: (a: Accion) => a.resultado, tip: (a: Accion) => a.resultado } as Column<Accion>]),
  ];

  const filtTabs = (
    <div className="cxc-vtabs">
      <button className={"cxc-vtab" + (estado === "pendiente" ? " on" : "")} onClick={() => setEstado("pendiente")}>Pendientes</button>
      <button className={"cxc-vtab" + (estado === "hechas" ? " on" : "")} onClick={() => setEstado("hechas")}>Hechas</button>
      <button className={"cxc-vtab" + (estado === "canceladas" ? " on" : "")} onClick={() => setEstado("canceladas")}>Canceladas</button>
    </div>
  );
  const scopeSel = puedePrograma ? (
    <select className="cxc-grupo-sel" value={scope} onChange={(e) => setScope(e.target.value as any)} title="Agenda a mostrar">
      <option value="todas">Todos los gestores</option>
      <option value="mias">Solo las mías</option>
    </select>
  ) : null;

  return (
    <div className="card gframe">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SecTitle icon="calendar">Agenda de cobro</SecTitle>
        {puedePrograma && <button className="btn primary sm" onClick={() => setProg("nueva")}><Icon name="plus" size={15} />Programar acción</button>}
      </div>
      <div className="gframe-body">
        <DataGrid columns={cols} rows={rows} getKey={(a) => String(a.id)}
          label="Agenda de cobro" storageKey="cxc-agenda" fitRows searchable exportable
          toolbar={<>{filtTabs}{scopeSel}</>}
          emptyLabel={cargando ? "Cargando…" : estado === "pendiente"
            ? (scope === "mias" ? "No tienes acciones de cobro pendientes." : "No hay acciones de cobro pendientes.")
            : "Sin acciones en este estado."}
          actions={(a) => (a.estado === "pendiente" ? <span className="cc-cell">
            {puedeEditar && <button className="act-btn" title="Ejecutar / registrar resultado" onClick={() => setCerrar(a)}><Icon name="check" size={15} /></button>}
            {puedePrograma && <button className="act-btn" title="Editar / reasignar" onClick={() => setProg(a)}><Icon name="edit" size={15} /></button>}
            {puedePrograma && <button className="act-btn del" title="Cancelar acción" onClick={() => cancelar(a)}><Icon name="x" size={15} /></button>}
          </span> : <span className="cxc-accion-cerr">{a.resuelto_nombre || "—"}</span>)}
          actionsWidth="120px" />
      </div>
      <div className="gframe-foot">{rows.length} acción{rows.length === 1 ? "" : "es"}{estado === "pendiente" ? " pendiente" + (rows.length === 1 ? "" : "s") : ""}</div>

      {prog && <ProgramarModal accion={prog} cartera={cartera} gestores={gestores} onClose={() => setProg(null)} onSaved={cargar} />}
      {cerrar && <CerrarModal accion={cerrar} onClose={() => setCerrar(null)} onSaved={cargar} />}
    </div>
  );
}

/** Programar (lote) / editar una acción de cobro (supervisor). Al crear se pueden
 *  marcar VARIOS clientes y/o grupos (chips) y se programa la misma acción a todos;
 *  al editar se trabaja sobre un único objetivo. */
type Dest = { alcance: "cliente" | "grupo"; key: string; label: string };
function ProgramarModal({ accion, cartera, gestores, preset, presetTipo, presetSaldo, onClose, onSaved }: {
  accion: Accion | "nueva"; cartera: Row[]; gestores: Gestor[];
  preset?: Dest[]; presetTipo?: string; presetSaldo?: number; onClose: () => void; onSaved: () => void;
}) {
  const edit = accion !== "nueva" ? (accion as Accion) : null;
  const conPreset = !edit && !!preset && preset.length > 0;   // lote desde el cockpit
  const toast = useToast();
  const [verDest, setVerDest] = useState(false);   // expandir la lista de marcados (preset)
  // Edición = objetivo único; creación = lista de destinatarios (chips).
  const [editAlcance, setEditAlcance] = useState<"cliente" | "grupo">(edit?.alcance || "cliente");
  const [editNit, setEditNit] = useState(edit && edit.alcance === "cliente" ? edit.nit : "");
  const [editGrupo, setEditGrupo] = useState(edit && edit.alcance === "grupo" ? edit.grupo : "");
  const [dest, setDest] = useState<Dest[]>(preset || []);
  const [pickAlcance, setPickAlcance] = useState<"cliente" | "grupo">("cliente");
  const [pickerKey, setPickerKey] = useState(0);
  const [tipo, setTipo] = useState(presetTipo || edit?.tipo || "llamada");
  const [fecha, setFecha] = useState((edit?.fecha_programada || "").slice(0, 10));
  const [prioridad, setPrioridad] = useState(edit?.prioridad || "media");
  const [asignado, setAsignado] = useState(edit?.asignado_a || "");
  const [instr, setInstr] = useState(edit?.instruccion || "");
  const [guardando, setGuardando] = useState(false);
  const grupos = useMemo(() => Array.from(new Set(cartera.map((r) => r.grupo).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [cartera]);

  const agregar = (d: Dest) => {
    setDest((prev) => prev.some((x) => x.alcance === d.alcance && x.key === d.key) ? prev : [...prev, d]);
    setPickerKey((k) => k + 1);
  };
  const quitar = (d: Dest) => setDest((prev) => prev.filter((x) => !(x.alcance === d.alcance && x.key === d.key)));

  const objetivosOk = edit ? (editAlcance === "cliente" ? !!editNit : !!editGrupo) : dest.length > 0;
  const guardar = async () => {
    if (!objetivosOk) { toast(edit ? "Falta el cliente o grupo" : "Marca al menos un cliente o grupo", true); return; }
    if (!fecha) { toast("Falta la fecha programada", true); return; }
    if (!asignado) { toast("Falta el gestor asignado", true); return; }
    setGuardando(true);
    try {
      if (edit) {
        await api.put(`/cartera/acciones/${edit.id}`, {
          alcance: editAlcance, nit: editAlcance === "cliente" ? editNit : "", grupo: editAlcance === "grupo" ? editGrupo : "",
          tipo, fecha_programada: fecha, prioridad, asignado_a: asignado, instruccion: instr.trim() });
        toast("Acción actualizada ✓");
      } else {
        const r: any = await api.post("/cartera/acciones/lote", {
          objetivos: dest.map((d) => ({ alcance: d.alcance, nit: d.alcance === "cliente" ? d.key : "", grupo: d.alcance === "grupo" ? d.key : "" })),
          tipo, fecha_programada: fecha, prioridad, asignado_a: asignado, instruccion: instr.trim() });
        toast(`${r.creadas} acción${r.creadas === 1 ? "" : "es"} programada${r.creadas === 1 ? "" : "s"} ✓`);
      }
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };

  return (
    <Modal title={edit ? "Editar acción de cobro" : "Programar acción de cobro"}
           icon="calendar" size="md" onClose={onClose}
           onSave={guardar} saving={guardando} canSave={objetivosOk && !!fecha && !!asignado}
           saveLabel={edit ? "Guardar" : dest.length > 1 ? `Programar a ${dest.length}` : "Programar"} saveIcon="save">
      <div className="fieldgroup">
        {edit ? (
          <div className="obl-grid">
            <label className="cq-fld"><span>Alcance</span>
              <select value={editAlcance} onChange={(e) => setEditAlcance(e.target.value as any)}>
                <option value="cliente">Cliente</option>
                <option value="grupo">Grupo económico</option>
              </select></label>
            {editAlcance === "cliente" ? (
              <label className="cq-fld obl-wide"><span>Cliente</span>
                <AsyncCombo<Row> value={editNit}
                  buscar={async (q) => { const t = q.trim().toLowerCase(); return cartera.filter((r) => !t || (r.nombre || "").toLowerCase().includes(t) || (r.nit || "").includes(t)).slice(0, 60); }}
                  label={(r) => r.nombre || r.nit} getKey={(r) => r.nit} codeOf={(r) => r.nit}
                  renderOpt={(r) => <div><div className="cxc-cli">{r.nombre || "—"}</div><div style={{ fontSize: 11, color: "var(--ink-3)" }}>NIT {r.nit}{r.grupo ? " · " + r.grupo : ""} · {pesos(r.saldo)}</div></div>}
                  onPick={(r) => setEditNit(r.nit)}
                  placeholder="Busca un cliente por nombre o NIT…" /></label>
            ) : (
              <label className="cq-fld obl-wide"><span>Grupo económico</span>
                <select value={editGrupo} onChange={(e) => setEditGrupo(e.target.value)}>
                  <option value="">Elige un grupo…</option>
                  {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                </select></label>
            )}
          </div>
        ) : (
          <div className="cxc-dest">
            {!conPreset && <div className="obl-grid">
              <label className="cq-fld"><span>Agregar</span>
                <select value={pickAlcance} onChange={(e) => setPickAlcance(e.target.value as any)}>
                  <option value="cliente">Cliente</option>
                  <option value="grupo">Grupo económico</option>
                </select></label>
              {pickAlcance === "cliente" ? (
                <label className="cq-fld obl-wide"><span>Clientes a marcar</span>
                  <AsyncCombo<Row> key={"c" + pickerKey} value=""
                    buscar={async (q) => { const t = q.trim().toLowerCase(); return cartera.filter((r) => !t || (r.nombre || "").toLowerCase().includes(t) || (r.nit || "").includes(t)).slice(0, 60); }}
                    label={(r) => r.nombre || r.nit} getKey={(r) => r.nit} codeOf={(r) => r.nit}
                    renderOpt={(r) => <div><div className="cxc-cli">{r.nombre || "—"}</div><div style={{ fontSize: 11, color: "var(--ink-3)" }}>NIT {r.nit}{r.grupo ? " · " + r.grupo : ""} · {pesos(r.saldo)}</div></div>}
                    onPick={(r) => agregar({ alcance: "cliente", key: r.nit, label: r.nombre || r.nit })}
                    placeholder="Busca y marca clientes (uno a uno)…" /></label>
              ) : (
                <label className="cq-fld obl-wide"><span>Grupos a marcar</span>
                  <select key={"g" + pickerKey} value="" onChange={(e) => { if (e.target.value) agregar({ alcance: "grupo", key: e.target.value, label: e.target.value }); }}>
                    <option value="">Elige un grupo para marcarlo…</option>
                    {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select></label>
              )}
            </div>}
            {conPreset && <div className="cxc-dest-sum">
              <span><Icon name="clientes" size={16} /> Programando a <b>{dest.length}</b> cliente{dest.length === 1 ? "" : "s"}{typeof presetSaldo === "number" ? <> · {pesos(presetSaldo)}</> : null}</span>
              <button type="button" className="cxc-dest-ver" onClick={() => setVerDest((v) => !v)}>{verDest ? "Ocultar" : "Ver"}</button>
            </div>}
            {dest.length > 0 && (!conPreset || verDest) && <div className="cxc-dest-chips">
              {dest.map((d) => <span key={d.alcance + d.key} className={"cxc-dest-chip" + (d.alcance === "grupo" ? " grp" : "")}>
                {d.alcance === "grupo" && <Icon name="briefcase" size={12} />}{d.label}
                <button type="button" onClick={() => quitar(d)} aria-label="Quitar">✕</button>
              </span>)}
            </div>}
            {!conPreset && <div className="cxc-dest-count">{dest.length} destinatario{dest.length === 1 ? "" : "s"} marcado{dest.length === 1 ? "" : "s"}</div>}
          </div>
        )}
        <div className="obl-grid" style={{ marginTop: 10 }}>
          <label className="cq-fld"><span>Tipo de acción</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPO_ACC_ORDEN.map((k) => <option key={k} value={k}>{TIPO_ACC[k].lbl}</option>)}
            </select></label>
          <label className="cq-fld"><span>Fecha programada</span>
            <DateInput value={fecha} onChange={setFecha} /></label>
          <label className="cq-fld"><span>Prioridad</span>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
              {PRIO_ORDEN.map((k) => <option key={k} value={k}>{PRIO[k].lbl}</option>)}
            </select></label>
          <label className="cq-fld"><span>Asignar a</span>
            <select value={asignado} onChange={(e) => setAsignado(e.target.value)}>
              <option value="">Elige un gestor…</option>
              {gestores.map((g) => <option key={g.usuario} value={g.usuario}>{g.nombre}</option>)}
            </select></label>
          <label className="cq-fld obl-wide"><span>Instrucción</span>
            <textarea rows={3} value={instr} onChange={(e) => setInstr(e.target.value)}
              placeholder="Qué debe hacer el gestor: contexto, acuerdo previo, monto a exigir…" /></label>
        </div>
      </div>
    </Modal>
  );
}

/** Ejecutar/cerrar una acción (gestor): registra el resultado → traza en el
 *  Gestor, y opcionalmente programa la siguiente para el mismo objetivo/gestor. */
function CerrarModal({ accion, onClose, onSaved }: { accion: Accion; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [tipo, setTipo] = useState(TIPO_ACC[accion.tipo] ? accion.tipo : "llamada");
  const [resultado, setResultado] = useState("");
  const [sig, setSig] = useState(false);
  const [sigFecha, setSigFecha] = useState("");
  const [sigTipo, setSigTipo] = useState("llamada");
  const [sigInstr, setSigInstr] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cerrar = async () => {
    if (!resultado.trim()) { toast("Escribe el resultado de la gestión", true); return; }
    if (sig && !sigFecha) { toast("Falta la fecha de la siguiente acción", true); return; }
    setGuardando(true);
    try {
      const r: any = await api.post(`/cartera/acciones/${accion.id}/cerrar`, {
        resultado: resultado.trim(), tipo,
        siguiente_fecha: sig ? sigFecha : null, siguiente_tipo: sig ? sigTipo : null,
        siguiente_instruccion: sig ? sigInstr.trim() : null,
      });
      toast(`Acción ejecutada ✓${r.siguiente_id ? " · siguiente programada" : ""}`);
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };

  return (
    <Modal title={accion.objetivo}
           sub={`${accion.alcance === "grupo" ? "Grupo" : "Cliente"} · ${(TIPO_ACC[accion.tipo] || TIPO_ACC.otro).lbl} programada ${fmtFecha(accion.fecha_programada)}`}
           icon="check" size="md" onClose={onClose}
           onSave={cerrar} saving={guardando} canSave={!!resultado.trim()}
           saveLabel="Registrar y cerrar" saveIcon="check">
      <div className="fieldgroup">
        {accion.instruccion && <p className="cxc-accion-instr"><b>Instrucción:</b> {accion.instruccion}</p>}
        <div className="obl-grid">
          <label className="cq-fld"><span>Tipo de interacción</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPO_ACC_ORDEN.map((k) => <option key={k} value={k}>{TIPO_ACC[k].lbl}</option>)}
            </select></label>
          <label className="cq-fld obl-wide"><span>Resultado</span>
            <textarea rows={3} value={resultado} onChange={(e) => setResultado(e.target.value)}
              placeholder="Qué pasó: habló con…, prometió pagar el…, no contesta…" /></label>
        </div>
        <label className="cxc-accion-chk"><input type="checkbox" checked={sig} onChange={(e) => setSig(e.target.checked)} /> Programar la siguiente acción</label>
        {sig && <div className="obl-grid">
          <label className="cq-fld"><span>Fecha</span>
            <DateInput value={sigFecha} onChange={setSigFecha} /></label>
          <label className="cq-fld"><span>Tipo</span>
            <select value={sigTipo} onChange={(e) => setSigTipo(e.target.value)}>
              {TIPO_ACC_ORDEN.map((k) => <option key={k} value={k}>{TIPO_ACC[k].lbl}</option>)}
            </select></label>
          <label className="cq-fld obl-wide"><span>Instrucción (opcional)</span>
            <input value={sigInstr} onChange={(e) => setSigInstr(e.target.value)} placeholder="Para el mismo cliente y gestor" /></label>
        </div>}
      </div>
    </Modal>
  );
}

/** Visor embebido del PDF de la factura de venta (se trae con auth como blob). */
function FacturaViewer({ documento, onClose }: { documento: string; onClose: () => void }) {
  const toast = useToast();
  const [src, setSrc] = useState("");
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let url = "";
    api.blobUrl(`/cartera/factura-pdf?documento=${encodeURIComponent(documento)}`)
      .then((u) => { url = u; setSrc(u); })
      .catch((e: any) => setErr(e?.message || "No se pudo abrir el PDF."))
      .finally(() => setCargando(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [documento]);
  const descargar = () => api.download(`/cartera/factura-pdf?documento=${encodeURIComponent(documento)}`, `${documento}.pdf`)
    .catch((e: any) => toast(e.message, true));
  return (
    <Modal title={`Factura ${documento}`} sub="Factura de venta (PDF)" icon="file" size="xl" onClose={onClose} portal
      extraActions={src ? <>
        <button className="mh-act" onClick={descargar} aria-label="Descargar"><Icon name="down" size={18} /><span className="mh-tip">Descargar</span></button>
        <button className="mh-act" onClick={() => window.open(src, "_blank")} aria-label="Abrir en pestaña"><Icon name="globe" size={18} /><span className="mh-tip">Abrir en pestaña</span></button>
      </> : undefined}>
      {cargando ? <div className="hint">Cargando factura…</div>
        : err ? <div className="cxc-pdf-err"><Icon name="alert" size={18} /><div style={{ whiteSpace: "pre-line" }}>{err}</div></div>
        : <iframe className="cxc-pdf-frame" src={src} title={`Factura ${documento}`} />}
    </Modal>
  );
}

/** Botón drop-in: muestra el PDF de la factura (solo documentos FR). */
function FacturaPdfBtn({ doc, btnClass = "cxc-pdf-ico", size = 13 }: {
  doc: { documento: string; tipodoc?: string }; btnClass?: string; size?: number;
}) {
  const [open, setOpen] = useState(false);
  if ((doc.tipodoc || "") !== "FR") return null;
  return (
    <>
      <button className={btnClass} title="Ver factura (PDF)"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}><Icon name="file" size={size} /></button>
      {open && <FacturaViewer documento={doc.documento} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Estado de cuenta: los documentos abiertos del cliente (foto de GLERP). */
function CuentaModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [docs, setDocs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.get(`/cartera/cliente/${encodeURIComponent(row.nit)}`)
      .then((d: any) => { setDocs(d.docs || []); setTotal(d.total || 0); })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  }, []); // eslint-disable-line

  return (
    <Modal title={row.nombre || row.nit} sub={`Estado de cuenta · NIT ${row.nit}`}
           icon="list" size="xl" onClose={onClose}>
      {cargando ? <div className="hint">Cargando…</div> : (
        <table className="cxc-ec">
          <thead><tr>
            <th>Documento</th><th>TD</th><th>Fecha</th><th>Vence</th>
            <th className="r">Días</th><th>Edad</th><th className="r">Valor</th><th className="r">Saldo</th>
          </tr></thead>
          <tbody>
            {docs.map((d, i) => { const b = BUK[d.bucket] || BUK.corriente; return (
              <tr key={i}>
                <td className="cxc-doc-cell">{d.documento}<FacturaPdfBtn doc={d} /></td><td>{d.tipodoc}</td><td>{fmtFecha(d.fecfac)}</td><td>{fmtFecha(d.vencimiento)}</td>
                <td className="r">{d.dias_venc > 0 ? d.dias_venc : "—"}</td>
                <td><span className={"cxc-chip " + b.cls}>{b.lbl}</span></td>
                <td className="r">{pesos(d.vlrfac)}</td><td className="r"><b>{pesos(d.saldo)}</b></td>
              </tr>); })}
            {docs.length === 0 && <tr><td colSpan={8} style={{ color: "var(--ink-3)", padding: 12 }}>Sin documentos.</td></tr>}
          </tbody>
          {docs.length > 0 && <tfoot><tr><td colSpan={7} className="r"><b>Total</b></td><td className="r"><b>{pesos(total)}</b></td></tr></tfoot>}
        </table>
      )}
    </Modal>
  );
}
