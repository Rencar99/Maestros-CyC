import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useActiveReload } from "../useActiveReload";
import { Icon, pesos, SecTitle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";

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
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MES[(m || 1) - 1]} ${y}`;
};

interface Row {
  nit: string; nombre: string; cliente_id: number | null;
  docs: number; saldo: number; dias_max: number; bucket: string;
  fecha_antigua: string | null; doc_antiguo: string;
  estado: string; compromiso_fecha: string | null; proximo_contacto: string | null;
}
interface Resumen {
  configurado: boolean; sincronizado_at: string | null; sincronizado_por: string;
  total: number; docs: number; clientes: number; vencido: number;
  edades: { bucket: string; docs: number; saldo: number }[];
}
interface Doc {
  nit: string; nombre: string; documento: string; tipodoc: string;
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
  const [edad, setEdad] = useState<string>("todos");   // chip de rango de edad activo

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
  const filtradas = useMemo(
    () => (edad === "todos" ? rows : rows.filter((r) => r.bucket === edad)), [rows, edad]);
  const saldoFiltrado = useMemo(() => filtradas.reduce((a, r) => a + r.saldo, 0), [filtradas]);
  // Vista 'CxC por Edades' (detalle por documento), heredando el chip de edad.
  const docsFiltrados = useMemo(
    () => (edad === "todos" ? docs : docs.filter((d) => d.bucket === edad)), [docs, edad]);
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
    value: (d) => (d.bucket === b ? d.saldo : 0),
    render: (d) => (d.bucket === b ? <span>{pesos(d.saldo)}</span> : <span />),
  });
  const dcols: Column<Doc>[] = [
    { key: "nit", label: "NIT", type: "code", sortable: true, filterable: true, width: "100px", value: (d) => d.nit || "" },
    { key: "nombre", label: "Nombre / Razón Social", sortable: true, filterable: true, minWidth: "200px", width: "250px", value: (d) => d.nombre || "", render: (d) => <span className="cxc-cli">{d.nombre || "—"}</span> },
    { key: "fecfac", label: "Fecha", type: "date", sortable: true, filterable: true, width: "95px", value: (d) => d.fecfac || "", render: (d) => <span>{fmtFecha(d.fecfac)}</span> },
    { key: "vencimiento", label: "Vence", type: "date", sortable: true, filterable: true, width: "95px", value: (d) => d.vencimiento || "", render: (d) => <span>{fmtFecha(d.vencimiento)}</span> },
    { key: "venfac", label: "Plazo", align: "center", sortable: true, filterable: true, width: "70px", value: (d) => d.venfac },
    { key: "documento", label: "Documento", sortable: true, filterable: true, width: "120px", value: (d) => d.documento || "" },
    { key: "tipodoc", label: "TD", type: "code", sortable: true, filterable: true, width: "55px", value: (d) => d.tipodoc || "" },
    { key: "saldo", label: "Saldo actual", type: "money", total: true, sortable: true, width: "115px", value: (d) => d.saldo, render: (d) => <span>{pesos(d.saldo)}</span> },
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
                label="Cartera por cobrar" storageKey="cartera-grid" fitRows toolbar={tabsBar}
                searchable exportable defaultTotals={["saldo"]} frozen={1}
                emptyLabel={cargando ? "Cargando…" : edad !== "todos" ? "No hay cartera en este rango." : "No hay cartera. Usa «Actualizar cartera» para traerla de GLERP."}
                onRowClick={(r) => setGestion(r)}
                actions={(r) => <span className="cc-cell">
                  <button className="act-btn" title="Estado de cuenta (documentos)" onClick={() => setCuenta(r)}><Icon name="list" size={15} /></button>
                  {puedeEditar && <button className="act-btn" title="Gestión de cobro" onClick={() => setGestion(r)}><Icon name="edit" size={15} /></button>}
                </span>} />
            : <DataGrid columns={dcols} rows={docsFiltrados} getKey={(d) => d.nit + "|" + d.documento}
                label="CxC por edades" storageKey="cartera-edades" fitRows toolbar={tabsBar}
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
    </div>
  );
}

/** Panel de gestión de cobro de un cliente: estado + compromiso + próximo
 *  contacto + nota, con el historial debajo. */
function GestionModal({ row, puedeEditar, onClose, onSaved, onVerCuenta }: {
  row: Row; puedeEditar: boolean; onClose: () => void; onSaved: () => void; onVerCuenta: () => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [estado, setEstado] = useState(row.estado || "sin_gestion");
  const [compFecha, setCompFecha] = useState("");
  const [compValor, setCompValor] = useState("");
  const [prox, setProx] = useState("");
  const [nota, setNota] = useState("");
  const [hist, setHist] = useState<{ fecha: string; usuario: string; texto: string; estado: string }[]>([]);

  useEffect(() => {
    api.get(`/cartera/cliente/${encodeURIComponent(row.nit)}/gestion`)
      .then((d: any) => {
        setEstado(d.estado || "sin_gestion");
        setCompFecha((d.compromiso_fecha || "").slice(0, 10));
        setCompValor(d.compromiso_valor != null ? String(d.compromiso_valor) : "");
        setProx((d.proximo_contacto || "").slice(0, 10));
        setHist(d.notas || []);
      })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  }, []); // eslint-disable-line

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.post(`/cartera/cliente/${encodeURIComponent(row.nit)}/gestion`, {
        estado, compromiso_fecha: compFecha || null,
        compromiso_valor: compValor ? Number(compValor.replace(/[^\d.-]/g, "")) : null,
        proximo_contacto: prox || null, nota: nota.trim() || null,
      });
      toast("Gestión guardada ✓"); onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); setGuardando(false); }
  };

  return (
    <Modal title={row.nombre || row.nit} sub={`NIT ${row.nit} · ${row.docs} documento${row.docs === 1 ? "" : "s"} · saldo ${pesos(row.saldo)}`}
           icon="coins" size="md" onClose={onClose}
           onSave={puedeEditar ? guardar : undefined} saving={guardando} saveLabel="Guardar gestión"
           extraActions={<button className="mh-act" onClick={onVerCuenta} aria-label="Estado de cuenta"><Icon name="list" size={18} /><span className="mh-tip">Estado de cuenta</span></button>}>
      {cargando ? <div className="hint">Cargando…</div> : (<>
        <div className="fieldgroup"><h4>Gestión</h4>
          <div className="obl-grid">
            <label className="cq-fld obl-wide"><span>Estado</span>
              <select value={estado} disabled={!puedeEditar} onChange={(e) => setEstado(e.target.value)}>
                {EST_ORDEN.map((k) => <option key={k} value={k}>{EST[k].lbl}</option>)}
              </select></label>
            <label className="cq-fld"><span>Compromiso de pago</span>
              <input type="date" value={compFecha} disabled={!puedeEditar} onChange={(e) => setCompFecha(e.target.value)} /></label>
            <label className="cq-fld"><span>Valor comprometido</span>
              <input value={compValor ? pesos(compValor) : ""} disabled={!puedeEditar}
                onChange={(e) => setCompValor(e.target.value.replace(/[^\d]/g, ""))} placeholder="$ 0" /></label>
            <label className="cq-fld obl-wide"><span>Próximo contacto</span>
              <input type="date" value={prox} disabled={!puedeEditar} onChange={(e) => setProx(e.target.value)} /></label>
            {puedeEditar && <label className="cq-fld obl-wide"><span>Nota de gestión</span>
              <textarea value={nota} rows={3} onChange={(e) => setNota(e.target.value)} placeholder="Registrar llamada, correo o acuerdo…" /></label>}
          </div>
        </div>
        <div className="fieldgroup"><h4>Historial</h4>
          {hist.length === 0 ? <div className="hint">Sin anotaciones.</div>
            : <div className="cxc-hist">{hist.map((h, i) => (
                <div className="cxc-hit" key={i}>
                  <div className="d">{fmtFecha(h.fecha)} · {h.usuario || "—"}{h.estado ? ` · ${(EST[h.estado] || EST.sin_gestion).lbl}` : ""}</div>
                  <div className="t">{h.texto}</div>
                </div>))}</div>}
        </div>
      </>)}
    </Modal>
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
                <td>{d.documento}</td><td>{d.tipodoc}</td><td>{fmtFecha(d.fecfac)}</td><td>{fmtFecha(d.vencimiento)}</td>
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
