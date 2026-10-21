import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Icon, useConfirm, useToast } from "../ui";
import { Explorador } from "../components/Explorador";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal, minDock } from "../components/Modal";

interface Fila {
  id?: number; cliente_id: number | null; num_id: string; nombre: string; rol_servicio: string;
  concepto: string; valor: string; forma: string; iva: string; reteiva: string;
  periodicidad: string; observaciones: string; rete: boolean;
}
interface Cab {
  id: number; anio: number; mes: number; etiqueta: string;
  creado_at: string; creado_por: string; n_items: number; total_valor: string;
  aprobada_at: string | null; aprobada_por: string;
}
interface CliMin { id: number; num_id: string; nombre: string; }

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const fmtFechaHora = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const fmt = (v: string | number) => {
  const n = Math.round(Number(String(v).replace(/[^\d.-]/g, "")) || 0);
  return n.toLocaleString("es-CO");
};
const num = (v: string) => Math.round(Number(String(v).replace(/[^\d.-]/g, "")) || 0);
// Formato de dinero de las grillas (celda y total) a 0 decimales, estilo Maestros.
const money$ = (v: string | number) => "$ " + fmt(v);

export function Facturacion({ usuario, active = true, goFacturacion }: { usuario: string; active?: boolean; goFacturacion?: () => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const hoy = { anio: 2026, mes: 8 };            // valor inicial editable
  const [vista, setVista] = useState<"lista" | "editor">("lista");
  const [min, setMin] = useState(false);                    // editor minimizado a píldora
  const [cabs, setCabs] = useState<Cab[]>([]);
  const [anio, setAnio] = useState(hoy.anio);
  const [mes, setMes] = useState(hoy.mes);
  const [etiqueta, setEtiqueta] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [guardadoId, setGuardadoId] = useState<number | null>(null);
  const [clientes, setClientes] = useState<CliMin[]>([]);
  const [pctRete, setPctRete] = useState(15);
  const [sub, setSub] = useState<"detalle" | "resumen">("detalle");
  const [modalAdd, setModalAdd] = useState(false);
  const [modalLibre, setModalLibre] = useState(false);     // modal "Fila libre" (cobro puntual)
  const [addMenu, setAddMenu] = useState(false);           // menú "+ Agregar" (Servicios / Fila libre)
  const [valCab, setValCab] = useState<Cab | null>(null);   // facturación en validación
  const [valRep, setValRep] = useState<any>(null);          // reporte de validación
  const [valCarpeta, setValCarpeta] = useState("");         // carpeta elegida
  const [valPicker, setValPicker] = useState(false);        // explorador de carpeta abierto
  const [validando, setValidando] = useState(false);
  const [importar, setImportar] = useState(false);          // modal importar cobros desde Excel
  const valPicked = useRef(false);                          // ¿se eligió carpeta? (evita cancelar al cerrar el picker)
  const conRete = (it: any) => ({ ...it, rete: num(it.reteiva) > 0 });

  const cargarLista = () => api.get("/facturacion").then(setCabs).catch((e) => toast(e.message, true));
  useEffect(() => {
    cargarLista();
    api.get("/clientes").then((cs: any[]) => setClientes(cs.map((c) => ({ id: c.id, num_id: c.num_id, nombre: c.nombre })))).catch(() => {});
  }, []); // eslint-disable-line
  // La App mantiene las páginas montadas (display:none); re-leer la lista al volver a entrar.
  useEffect(() => { if (active) cargarLista(); }, [active]); // eslint-disable-line

  const generar = async () => {
    try {
      const r = await api.post("/facturacion/generar", { anio, mes });
      setEtiqueta(r.etiqueta); setFilas(r.items.map(conRete)); setGuardadoId(null); setMin(false); setVista("editor");
      if (!r.items.length) toast("No hay cobros pendientes programados para este período.");
    } catch (e: any) { toast(e.message, true); }
  };
  const abrir = async (id: number) => {
    try {
      const r = await api.get(`/facturacion/${id}`);
      setAnio(r.anio); setMes(r.mes); setEtiqueta(r.etiqueta); setFilas(r.items.map(conRete)); setGuardadoId(r.id); setMin(false); setVista("editor");
    } catch (e: any) { toast(e.message, true); }
  };
  const setF = (i: number, patch: Partial<Fila>) => setFilas((f) => f.map((x, j) => j === i ? { ...x, ...patch } : x));
  const delF = (i: number) => setFilas((f) => f.filter((_, j) => j !== i));
  const reteCalc = (forma: string, on: boolean, iva: string, pct: number) =>
    (forma === "Fa" && on) ? String(Math.round(num(iva) * pct / 100)) : "0";
  const setIva = (i: number, v: string) => setFilas((f) => f.map((x, j) => j === i
    ? { ...x, iva: v, reteiva: reteCalc(x.forma, x.rete, v, pctRete) } : x));
  // Al editar el Valor: se toman SOLO los dígitos (el separador de miles "." no debe
  // interpretarse como decimal). IVA = 19% si es Factura (0 si CC) y se recalcula ReteIVA.
  const setValor = (i: number, v: string) => setFilas((f) => f.map((x, j) => {
    if (j !== i) return x;
    const valor = (v || "").replace(/\D/g, "") || "0";
    const iva = x.forma === "Fa" ? String(Math.round(Number(valor) * 0.19)) : "0";
    return { ...x, valor, iva, reteiva: reteCalc(x.forma, x.rete, iva, pctRete) };
  }));
  const setForma = (i: number, v: string) => setFilas((f) => f.map((x, j) => j === i
    ? { ...x, forma: v, rete: v === "Fa" ? x.rete : false, reteiva: reteCalc(v, v === "Fa" ? x.rete : false, x.iva, pctRete) } : x));
  const toggleRete = (i: number, on: boolean) => setFilas((f) => f.map((x, j) => j === i
    ? { ...x, rete: on, reteiva: reteCalc(x.forma, on, x.iva, pctRete) } : x));
  const cambiarPct = (p: number) => { setPctRete(p); setFilas((f) => f.map((x) => ({ ...x, reteiva: reteCalc(x.forma, x.rete, x.iva, p) }))); };
  const pickCliente = (i: number, cid: number) => {
    const c = clientes.find((x) => x.id === cid);
    if (c) setF(i, { cliente_id: c.id, num_id: c.num_id, nombre: c.nombre });
  };

  const guardar = async () => {
    if (!filas.length) { toast("No hay filas para guardar.", true); return; }
    if ((await confirmar({
      titulo: "Guardar facturación",
      mensaje: `Se guardará la facturación de ${etqActual} (${filas.length} filas). Si ya existe una de este mes, se reemplazará.`,
      confirmar: "Guardar",
    })) !== "si") return;
    try {
      const r = await api.post("/facturacion", { anio, mes, items: filas });
      setGuardadoId(r.id);
      toast(r.reemplazo ? `Reemplazó la facturación de ${r.etiqueta} (${r.items} filas) ✓` : `Guardado: ${r.items} filas ✓`);
      cargarLista();
    } catch (e: any) { toast(e.message, true); }
  };
  const exportar = async (id: number, etq: string) => {
    try { await api.download(`/facturacion/${id}/excel`, `Facturacion ${etq}.xlsx`); }
    catch (e: any) { toast(e.message, true); }
  };
  const eliminar = async (id: number, etq: string) => {
    if ((await confirmar({ titulo: "Eliminar facturación", mensaje: `Se eliminará la facturación de ${etq} del histórico. Esta acción no se puede deshacer.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/facturacion/${id}`); toast("Eliminada"); cargarLista(); }
    catch (e: any) { toast(e.message, true); }
  };
  const aprobar = async (c: Cab) => {
    const quitar = !!c.aprobada_at;
    const r = await confirmar({
      titulo: quitar ? "Quitar aprobación" : "Aprobar facturación",
      mensaje: quitar
        ? `Se quitará la aprobación de ${c.etiqueta} (aprobada por ${c.aprobada_por} el ${fmtFechaHora(c.aprobada_at!)}).`
        : `Aprobar la facturación de ${c.etiqueta}.\n\nAprueba: ${usuario}\nFecha: ${fmtFechaHora(new Date().toISOString())}`,
      confirmar: quitar ? "Quitar" : "Aprobar",
    });
    if (r !== "si") return;
    try { await api.post(`/facturacion/${c.id}/aprobar`, {}); toast(quitar ? "Aprobación quitada" : "Facturación aprobada ✓"); cargarLista(); }
    catch (e: any) { toast(e.message, true); }
  };
  const validarCarpeta = async (cabId: number, carpeta: string) => {
    setValidando(true); setValRep(null);
    try { setValRep(await api.post(`/facturacion/${cabId}/validar`, { carpeta })); }
    catch (e: any) { toast(e.message, true); }
    finally { setValidando(false); }
  };

  const tot = useMemo(() => filas.reduce((a, f) => {
    const v = num(f.valor);
    return { fa: a.fa + (f.forma === "Fa" ? v : 0), cc: a.cc + (f.forma === "CC" ? v : 0),
             iva: a.iva + num(f.iva), reteiva: a.reteiva + num(f.reteiva) };
  }, { fa: 0, cc: 0, iva: 0, reteiva: 0 }), [filas]);

  const yaEnGrilla = useMemo(() => new Set(filas.map((f) => `${f.cliente_id}|${f.rol_servicio}`)), [filas]);
  const etqActual = etiqueta || `${MESES[mes]} ${anio}`;

  // Resumen agrupado por cliente (total a facturar por cliente)
  const resumen = useMemo(() => {
    const m = new Map<string, { num_id: string; nombre: string; n: number; valor: number; iva: number; reteiva: number }>();
    for (const f of filas) {
      const k = f.num_id || f.nombre || "?";
      const g = m.get(k) || { num_id: f.num_id, nombre: f.nombre, n: 0, valor: 0, iva: 0, reteiva: 0 };
      g.n += 1; g.valor += num(f.valor); g.iva += num(f.iva); g.reteiva += num(f.reteiva);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  }, [filas]);

  // -------- Columnas DataGrid (Grilla CyC) --------
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const detCols: Column<Fila>[] = [
    {
      key: "id", label: "Id", type: "code", sortable: true, value: (f) => f.num_id || "",
      render: (f) => f.cliente_id === null
        ? <select className="cell-input" value={f.cliente_id ?? ""} onMouseDown={stop}
            onChange={(e) => pickCliente(filas.indexOf(f), Number(e.target.value))} style={{ width: "100%" }}>
            <option value="">— cliente —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.num_id} · {c.nombre}</option>)}
          </select>
        : <span className="pill">{f.num_id}</span>,
    },
    { key: "nombre", label: "Nombre Cliente", sortable: true, filterable: true, width: "46ch", value: (f) => f.nombre || "" },
    {
      key: "concepto", label: "Concepto", sortable: true, filterable: true, minWidth: "220px", value: (f) => f.concepto || "",
      render: (f) => <input className="cell-input" value={f.concepto} onMouseDown={stop}
        onChange={(e) => setF(filas.indexOf(f), { concepto: e.target.value })} />,
    },
    {
      key: "valor", label: "Valor", type: "money", sortable: true, filterable: true, total: true, value: (f) => num(f.valor), formatter: money$,
      render: (f) => <input className="cell-input" style={{ textAlign: "right" }} value={fmt(f.valor)} onMouseDown={stop}
        onChange={(e) => setValor(filas.indexOf(f), e.target.value)} />,
    },
    {
      key: "forma", label: "Tipo Cobro", type: "status", filterable: true, value: (f) => f.forma,
      render: (f) => <span className={"tag " + (f.forma === "CC" ? "ext" : "int")}>{f.forma}</span>,
    },
    { key: "iva", label: "IVA", type: "money", sortable: true, filterable: true, total: true, value: (f) => num(f.iva), formatter: money$ },
    {
      key: "reteiva", label: "ReteIVA", type: "money", sortable: true, filterable: true, total: true, formatter: money$,
      value: (f) => (f.forma === "Fa" && f.rete) ? num(f.reteiva) : 0,
      render: (f) => (f.forma === "Fa" && f.rete)
        ? <span>$ {fmt(f.reteiva)}</span>
        : <span style={{ color: "var(--ink-3)" }}>—</span>,
    },
    {
      key: "obs", label: "Observaciones", minWidth: "260px", value: (f) => f.observaciones || "",
      render: (f) => <input className="cell-input" value={f.observaciones} onMouseDown={stop}
        onChange={(e) => setF(filas.indexOf(f), { observaciones: e.target.value })} />,
    },
  ];
  const resCols: Column<typeof resumen[number]>[] = [
    { key: "num_id", label: "Id", type: "code", sortable: true, width: "12ch", value: (g) => g.num_id || "", render: (g) => <span className="pill">{g.num_id || "—"}</span> },
    { key: "nombre", label: "Cliente", sortable: true, filterable: true, value: (g) => g.nombre || "" },
    { key: "n", label: "Servicios", type: "status", sortable: true, filterable: true, total: true, value: (g) => g.n },
    { key: "valor", label: "Valor", type: "money", sortable: true, filterable: true, total: true, value: (g) => g.valor, formatter: money$ },
    { key: "iva", label: "IVA", type: "money", sortable: true, filterable: true, total: true, value: (g) => g.iva, formatter: money$ },
    { key: "reteiva", label: "ReteIVA", type: "money", sortable: true, filterable: true, total: true, value: (g) => g.reteiva, formatter: money$ },
    { key: "neto", label: "Neto a facturar", type: "money", sortable: true, filterable: true, total: true, value: (g) => g.valor + g.iva - g.reteiva, formatter: money$ },
  ];

  // Columnas de la lista "Facturaciones guardadas" (Grilla CyC).
  const listCols: Column<Cab>[] = [
    { key: "etiqueta", label: "Mes", sortable: true, filterable: true, value: (c) => c.etiqueta, render: (c) => <b>{c.etiqueta}</b> },
    { key: "n_items", label: "Filas", type: "status", sortable: true, align: "center", value: (c) => c.n_items },
    { key: "total_valor", label: "Total valor", type: "money", sortable: true, total: true, value: (c) => num(c.total_valor), formatter: money$ },
    { key: "creado_por", label: "Generada por", sortable: true, filterable: true, value: (c) => c.creado_por || "" },
    {
      key: "aprob", label: "Aprobación", sortable: true, filterable: true,
      value: (c) => (c.aprobada_at ? `Aprobada · ${c.aprobada_por}` : "Sin aprobar"),
      render: (c) => c.aprobada_at
        ? <span className="fac-aprob" title={`Aprobada por ${c.aprobada_por}`}><Icon name="check" size={13} />{c.aprobada_por} · {fmtFechaHora(c.aprobada_at)}</span>
        : <span className="fac-pend">Sin aprobar</span>,
    },
  ];

  // ---------------------------------------------------------------- histórico
  if (vista === "lista" || min) {
    return (
      <div style={{ maxWidth: 1200 }}>
        {min && createPortal(
          <div className="modal-min" onClick={() => { setMin(false); goFacturacion?.(); }} title="Volver a la facturación en edición" role="button" tabIndex={0}>
            <span className="modal-min-ic"><Icon name="briefcase" size={16} /></span>
            <span className="modal-min-t">Editando: {etiqueta || "facturación"}</span>
            <button className="modal-min-x" onClick={(e) => { e.stopPropagation(); setMin(false); setVista("lista"); }} aria-label="Descartar edición" title="Descartar edición"><Icon name="x" size={14} /></button>
          </div>, minDock())}
        <div className="card gframe gframe-sinh">
          <div className="gframe-body">
            <DataGrid columns={listCols} rows={cabs} getKey={(c) => c.id}
              label="Facturaciones guardadas" storageKey="fact-lista" fitRows
              searchable emptyLabel="Aún no hay facturaciones. Crea una nueva."
              actionsWidth="196px"
              toolbar={<span className="gf-end">
                <button className="icon-btn" onClick={cargarLista} title="Actualizar lista"><Icon name="refresh" size={16} /></button>
                <button className="btn sm" onClick={() => setImportar(true)} title="Cargar cobros programados desde un Excel (cruce por NIT)">
                  <Icon name="upload" size={15} />Importar cobros
                </button>
                <button className="btn primary sm" onClick={() => { setFilas([]); setGuardadoId(null); setEtiqueta(""); setMin(false); setVista("editor"); }}>
                  <Icon name="plus" size={16} />Nueva facturación
                </button>
              </span>}
              actions={(c) => <>
                <button className={"act-btn " + (c.aprobada_at ? "aprob-on" : "aprob")} title={c.aprobada_at ? "Quitar aprobación" : "Aprobar facturación del mes"} onClick={() => aprobar(c)}><Icon name={c.aprobada_at ? "check-circle" : "check"} size={15} /></button>
                <button className="act-btn val" title="Validar contra facturas emitidas (XML)" onClick={() => { setValCab(c); setValRep(null); setValCarpeta(""); valPicked.current = false; setValPicker(true); }}><Icon name="clipboard-check" size={15} /></button>
                <button className="act-btn edit" title="Abrir" onClick={() => abrir(c.id)}><Icon name="edit" size={15} /></button>
                <button className="act-btn edit" title="Exportar Excel" onClick={() => exportar(c.id, c.etiqueta)}><Icon name="down" size={15} /></button>
                <button className="act-btn del" title="Eliminar" onClick={() => eliminar(c.id, c.etiqueta)}><Icon name="trash" size={15} /></button>
              </>} />
          </div>
          <div className="gframe-foot">{cabs.length} facturación{cabs.length === 1 ? "" : "es"} guardada{cabs.length === 1 ? "" : "s"}</div>
        </div>
        {valPicker && valCab && <Explorador modo="carpeta"
          onSelect={(ruta) => { valPicked.current = true; setValPicker(false); setValCarpeta(ruta); validarCarpeta(valCab.id, ruta); }}
          onClose={() => { setValPicker(false); if (!valPicked.current) setValCab(null); }} />}
        {valCab && !valPicker && <ValidarModal cab={valCab} rep={valRep} validando={validando} carpeta={valCarpeta}
          onRepick={() => setValPicker(true)} onClose={() => { setValCab(null); setValRep(null); setValCarpeta(""); }} />}
        {importar && <ImportarCobros onClose={() => setImportar(false)} onListo={() => { setImportar(false); cargarLista(); }} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- editor
  const factTabs = (
    <div className="segtabs">
      <button className={sub === "detalle" ? "on" : ""} onClick={() => setSub("detalle")}>Detalle</button>
      <button className={sub === "resumen" ? "on" : ""} onClick={() => setSub("resumen")}>Resumen por cliente</button>
    </div>
  );
  return (
    <div className="card gframe">
        <div className="card-h fact-head">
          <div className="fact-head-l">
            <button className="btn sm" onClick={() => setVista("lista")}><Icon name="logout" size={14} />Volver</button>
            <button className="btn sm" onClick={() => setMin(true)} title="Minimizar (consultar otra pantalla y volver)"><Icon name="minus" size={14} />Minimizar</button>
            <span className="fact-period" title="Mes de proceso">
              <Icon name="calendar" size={16} />
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <input className="fp-year" value={anio} onChange={(e) => setAnio(Number(e.target.value) || anio)} />
            </span>
            <button className="btn primary sm" onClick={generar}><Icon name="gear" size={15} />Generar</button>
          </div>
          <div className="r" style={{ alignItems: "center", gap: 8 }}>
            <div className="fact-addwrap">
              <button className="btn sm" onClick={() => setAddMenu((o) => !o)} aria-expanded={addMenu}><Icon name="plus" size={15} />Agregar<span className="cw">▾</span></button>
              {addMenu && <>
                <div className="menu-backdrop" onMouseDown={() => setAddMenu(false)} />
                <div className="fact-addpop" role="menu">
                  <button role="menuitem" onClick={() => { setModalAdd(true); setAddMenu(false); }}><Icon name="box" size={14} />Servicios</button>
                  <button role="menuitem" onClick={() => { setModalLibre(true); setAddMenu(false); }} title="Cobro puntual (extra)"><Icon name="edit" size={14} />Fila libre</button>
                </div>
              </>}
            </div>
            <button className="btn primary sm" onClick={guardar}><Icon name="save" size={15} />Guardar</button>
          </div>
        </div>

        {modalAdd && <AgregarServicios etiqueta={etqActual} yaEnGrilla={yaEnGrilla}
          onAgregar={(nuevas) => setFilas((f) => [...f, ...nuevas])} onClose={() => setModalAdd(false)} />}
        {modalLibre && <FilaLibreModal etiqueta={etqActual} clientes={clientes} pctRete={pctRete}
          onAgregar={(fila) => setFilas((f) => [...f, fila])} onClose={() => setModalLibre(false)} />}

        <div className="fact-kpis">
          <span className="ft ok"><em>Facturas</em>$ {fmt(tot.fa)}</span>
          <span className="ft info"><em>Cuentas de cobro</em>$ {fmt(tot.cc)}</span>
          <span className="ft gold"><em>IVA</em>$ {fmt(tot.iva)}</span>
          <span className="ft warn"><em>ReteIVA</em>$ {fmt(tot.reteiva)}</span>
          <span className="ft-pct"><em>% ReteIVA</em>
            <input value={pctRete} onChange={(e) => cambiarPct(Number(e.target.value) || 0)} />
          </span>
        </div>

        <div className="gframe-body">
          {sub === "resumen" && (
            <DataGrid columns={resCols} rows={resumen} getKey={(g) => g.num_id || g.nombre}
              label="Resumen por cliente" storageKey="fact-resumen" fitRows
              searchable exportable toolbar={factTabs}
              defaultTotals={["n", "valor", "iva", "reteiva", "neto"]}
              emptyLabel="Sin filas. Genera o agrega filas en «Detalle»." />
          )}

          {sub === "detalle" && (
            <DataGrid columns={detCols} rows={filas} getKey={(f) => filas.indexOf(f)}
              label="Detalle de facturación" storageKey="fact-detalle" fitRows
              searchable exportable toolbar={factTabs}
              defaultTotals={["valor", "iva", "reteiva"]}
              emptyLabel="Elige el mes y pulsa «Generar», o agrega filas manuales."
              actions={(f) => <button className="act-btn del" title="Quitar" onClick={() => delF(filas.indexOf(f))}><Icon name="trash" size={14} /></button>} />
          )}
        </div>
        <div className="gframe-foot">
          {sub === "detalle" ? `${filas.length} fila${filas.length === 1 ? "" : "s"} en el detalle` : `${resumen.length} cliente${resumen.length === 1 ? "" : "s"} en el resumen`}
        </div>
    </div>
  );
}

/** Modal para agregar servicios Año/Eventual a la facturación del mes. */
interface Serv { cliente_id: number; num_id: string; nombre: string; rol_servicio: string; valor: string; forma: string; periodicidad: string; check: boolean; valorEd: string; }
function AgregarServicios({ etiqueta, yaEnGrilla, onAgregar, onClose }: {
  etiqueta: string; yaEnGrilla: Set<string>; onAgregar: (filas: any[]) => void; onClose: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Serv[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.get("/facturacion/no-mensuales")
      .then((list: any[]) => setItems(list.map((x) => ({ ...x, check: false, valorEd: x.valor }))))
      .catch((e: any) => toast(e.message, true));
  }, []); // eslint-disable-line
  const key = (s: Serv) => `${s.cliente_id}|${s.rol_servicio}`;
  const set = (i: number, patch: Partial<Serv>) => setItems((a) => a.map((x, j) => j === i ? { ...x, ...patch } : x));
  const ql = q.toLowerCase();
  const vis = q ? items.filter((s) => (s.nombre + " " + s.rol_servicio + " " + s.num_id).toLowerCase().includes(ql)) : items;
  const nSel = items.filter((s) => s.check).length;
  const agregar = () => {
    const nuevas = items.filter((s) => s.check).map((s) => ({
      cliente_id: s.cliente_id, num_id: s.num_id, nombre: s.nombre, rol_servicio: s.rol_servicio,
      concepto: `${s.rol_servicio} — ${etiqueta}`, valor: String(num(s.valorEd)), forma: s.forma,
      iva: s.forma === "Fa" ? String(Math.round(num(s.valorEd) * 0.19)) : "0",
      reteiva: "0", periodicidad: s.periodicidad, observaciones: "", rete: false,
    }));
    if (!nuevas.length) { toast("Marca al menos un servicio.", true); return; }
    onAgregar(nuevas); onClose();
  };
  return (
    <Modal title="Agregar servicios (Año / Eventual)" icon="plus" size="md" onClose={onClose}
           aviso="Los ✓ ya están en la grilla. Marca los que facturarás este mes y ajusta el valor."
           onSave={agregar} canSave={!!nSel} saveLabel={`Agregar ${nSel || ""}`.trim()} saveIcon="check">
      <div className="search" style={{ maxWidth: 360, margin: "0 0 10px" }}><Icon name="search" size={15} />
        <input placeholder="Buscar cliente o concepto…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tbl-wrap grid-scroll" style={{ maxHeight: "52vh" }}>
        <table>
          <thead><tr><th style={{ width: 34 }}></th><th>Cliente</th><th>Concepto</th><th style={{ width: 90 }}>Period.</th><th style={{ width: 130, textAlign: "right" }}>Valor</th></tr></thead>
          <tbody>
            {vis.map((s) => {
              const i = items.indexOf(s);
              const ya = yaEnGrilla.has(key(s));
              return (
                <tr key={i} style={ya ? { opacity: 0.5 } : undefined}>
                  <td className="al-c">{ya
                    ? <span title="Ya está en la grilla" style={{ color: "var(--ok)", fontWeight: 700 }}>✓</span>
                    : <input type="checkbox" checked={s.check} onChange={(e) => set(i, { check: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />}</td>
                  <td style={{ fontSize: 12 }}><span className="pill">{s.num_id}</span> {s.nombre}</td>
                  <td style={{ fontSize: 12 }}>{s.rol_servicio}</td>
                  <td style={{ fontSize: 12 }}>{s.periodicidad === "Anio" ? "Año" : "Eventual"}</td>
                  <td><input className="cell-input" style={{ textAlign: "right" }} value={fmt(s.valorEd)} disabled={ya} onChange={(e) => set(i, { valorEd: String(num(e.target.value)) })} /></td>
                </tr>
              );
            })}
            {!vis.length && <tr><td colSpan={5} className="grid-empty">No hay servicios Año/Eventual de clientes activos.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Modal (estándar CyC) para agregar una "fila libre": un cobro puntual/extra.
 *  Cliente opcional (búsqueda por NIT o nombre); IVA (19% si Factura) y ReteIVA
 *  se derivan solos, igual que en la grilla. */
function FilaLibreModal({ etiqueta, clientes, pctRete, onAgregar, onClose }: {
  etiqueta: string; clientes: CliMin[]; pctRete: number;
  onAgregar: (fila: Fila) => void; onClose: () => void;
}) {
  const toast = useToast();
  const [cli, setCli] = useState<CliMin | null>(null);
  const [cliQ, setCliQ] = useState("");
  const [concepto, setConcepto] = useState("");
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("Fa");
  const [rete, setRete] = useState(false);
  const [obs, setObs] = useState("");
  // Formas de cobro del catálogo (Fa, CC, Ma…): así aparecen todas, incluida Mandato.
  const [formas, setFormas] = useState<{ codigo: string; descripcion: string }[]>([]);
  useEffect(() => { api.get("/catalogos/forma-cobro").then(setFormas).catch(() => {}); }, []);

  const ql = cliQ.trim().toLowerCase();
  const opts = ql ? clientes.filter((c) => `${c.num_id} ${c.nombre}`.toLowerCase().includes(ql)).slice(0, 40) : [];
  const valorN = num(valor);
  const iva = forma === "Fa" ? Math.round(valorN * 0.19) : 0;
  const reteOn = forma === "Fa" && rete;
  const reteiva = reteOn ? Math.round(iva * pctRete / 100) : 0;

  const guardar = () => {
    if (valorN <= 0) { toast("Indica un valor mayor a 0.", true); return; }
    const base = concepto.trim();
    onAgregar({
      cliente_id: cli?.id ?? null, num_id: cli?.num_id ?? "", nombre: cli?.nombre ?? "",
      rol_servicio: "", concepto: base ? `${base} — ${etiqueta}` : etiqueta,
      valor: String(valorN), forma, iva: String(iva), reteiva: String(reteiva),
      periodicidad: "Eventual", observaciones: obs.trim(), rete: reteOn,
    });
    onClose();
  };

  return (
    <Modal title="Fila libre" sub={etiqueta} icon="edit" size="md" onClose={onClose}
      onSave={guardar} saveLabel="Agregar" saveIcon="check"
      aviso={`Valor $ ${fmt(valorN)}${forma === "Fa" ? ` · IVA $ ${fmt(iva)}${reteOn ? ` · ReteIVA $ ${fmt(reteiva)}` : ""}` : " · sin IVA (no es factura)"}`}>
      <div className="obl-cli-form">
        <label className="cq-fld"><span>Cliente (opcional)</span>
          {cli
            ? <div className="catsel-row">
                <input value={`${cli.num_id} · ${cli.nombre}`} readOnly style={{ flex: 1 }} />
                <button type="button" className="icon-btn" title="Quitar cliente" onClick={() => { setCli(null); setCliQ(""); }}><Icon name="x" size={15} /></button>
              </div>
            : <input value={cliQ} placeholder="NIT o nombre para buscar… (o déjalo en blanco)" onChange={(e) => setCliQ(e.target.value)} />}
        </label>
        {!cli && ql && (
          <div className="tbl-wrap grid-scroll" style={{ maxHeight: 190, marginTop: -6 }}>
            <table><tbody>
              {opts.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => { setCli(c); setCliQ(""); }}>
                  <td style={{ width: 96 }}><span className="pill">{c.num_id}</span></td>
                  <td style={{ fontSize: 12.5 }}>{c.nombre}</td>
                </tr>
              ))}
              {!opts.length && <tr><td className="grid-empty">Sin coincidencias</td></tr>}
            </tbody></table>
          </div>
        )}
        <label className="cq-fld"><span>Concepto</span>
          <input value={concepto} autoFocus onChange={(e) => setConcepto(e.target.value)} placeholder="Ej. Certificación, honorarios extra…" /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 190px", gap: 12 }}>
          <label className="cq-fld"><span>Valor</span>
            <input inputMode="numeric" style={{ textAlign: "right" }} value={valor ? fmt(valor) : ""}
              onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))} placeholder="0" /></label>
          <label className="cq-fld"><span>Tipo cobro</span>
            <select value={forma} onChange={(e) => setForma(e.target.value)}>
              {formas.length
                ? formas.map((fo) => <option key={fo.codigo} value={fo.codigo}>{fo.descripcion} ({fo.codigo})</option>)
                : <><option value="Fa">Factura (Fa)</option><option value="CC">Cuenta de cobro (CC)</option><option value="Ma">Mandato (Ma)</option></>}
            </select></label>
        </div>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 9, cursor: forma === "Fa" ? "pointer" : "default", opacity: forma === "Fa" ? 1 : 0.45 }}>
          <input type="checkbox" checked={reteOn} disabled={forma !== "Fa"} onChange={(e) => setRete(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Aplica ReteIVA</span></label>
        <label className="cq-fld"><span>Observaciones</span>
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" /></label>
      </div>
    </Modal>
  );
}

/** Importa cobros programados (ClienteServicio) desde un Excel, cruzando por NIT.
 *  Paso 1: elegir archivo → vista previa (no guarda). Paso 2: confirmar → crea. */
interface FilaOk {
  fila: number; cliente_id: number; nit: string; nombre: string; rol: string;
  rol_nuevo: boolean; forma: string; periodo: string; periodo_fin: string;
  meses: number; valor: string; vendedor: string; pct_comision: string;
}
interface FilaErr { fila: number; nit: string; nombre: string; rol: string; periodo: string; motivo: string; }
interface Prev {
  resumen: { filas_ok: number; filas_error: number; cobros_a_crear: number; roles_nuevos: string[] };
  ok: FilaOk[]; errores: FilaErr[];
}
function ImportarCobros({ onClose, onListo }: { onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [prev, setPrev] = useState<Prev | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const analizar = async (f: File) => {
    setArchivo(f); setPrev(null); setCargando(true);
    try { setPrev(await api.upload("/clientes/servicios/importar", f)); }
    catch (e: any) { toast(e.message, true); setArchivo(null); }
    finally { setCargando(false); }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) analizar(f); e.target.value = "";
  };
  const confirmar = async () => {
    if (!prev?.ok.length) return;
    setGuardando(true);
    try {
      const filas = prev.ok.map((r) => ({
        cliente_id: r.cliente_id, rol: r.rol, forma: r.forma, periodo: r.periodo,
        meses: r.meses, valor: r.valor, vendedor: r.vendedor, pct_comision: r.pct_comision,
      }));
      const r = await api.post("/clientes/servicios/importar/confirmar", { filas });
      toast(`Importación lista: ${r.creados} cobro(s) creado(s)${r.omitidos ? `, ${r.omitidos} ya existían` : ""} ✓`);
      onListo();
    } catch (e: any) { toast(e.message, true); }
    finally { setGuardando(false); }
  };

  const R = prev?.resumen;
  return (
    <Modal title="Importar cobros desde Excel" icon="upload" size="lg" onClose={onClose} saving={guardando}
           aviso={R ? (R.filas_error > 0 ? `Se importarán solo las ${R.filas_ok} filas válidas; las ${R.filas_error} con error se omiten.` : "Todas las filas son válidas.") : undefined}
           avisoTone={R && R.filas_error > 0 ? "warn" : "info"}
           onSave={confirmar} canSave={!!prev?.ok.length} saveLabel={`Crear ${R?.cobros_a_crear || ""} cobro(s)`} saveIcon="check">
      <div className="hint" style={{ marginBottom: 12 }}>
        Se identifican los clientes por <b>NIT</b> y los servicios por <b>nombre del rol</b>. Columnas esperadas
        (el encabezado puede variar): <b>nit</b>, nombre, <b>rol</b>, forma (Fa/CC), <b>periodo</b> (AAAA-MM),
        <b> valor</b>, vendedor, comisión, meses. «Meses» repite el cobro en períodos consecutivos.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn" onClick={() => inputRef.current?.click()}><Icon name="file" size={15} />Elegir Excel…</button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm" onChange={onFile} style={{ display: "none" }} />
        {archivo && <span className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="file" size={14} />{archivo.name}</span>}
        {cargando && <span className="rut-cargando"><Icon name="hourglass" size={15} />Leyendo…</span>}
      </div>

      {prev && R && (
        <>
          <div className="val-resumen" style={{ margin: "12px 0 0" }}>
            <span className="vr e-ok">Filas válidas: <b>{R.filas_ok}</b></span>
            <span className="vr">Cobros a crear: <b>{R.cobros_a_crear}</b></span>
            {R.filas_error > 0 && <span className="vr e-sf">Con error: <b>{R.filas_error}</b></span>}
            {R.roles_nuevos.length > 0 && <span className="vr e-dif" title={R.roles_nuevos.join(", ")}>Roles nuevos: <b>{R.roles_nuevos.length}</b></span>}
          </div>
          {R.roles_nuevos.length > 0 && (
            <div className="hint" style={{ padding: "6px 0 0" }}>
              Se crearán estos roles en el catálogo: <b>{R.roles_nuevos.join(", ")}</b>
            </div>
          )}

          <div className="tbl-wrap grid-scroll" style={{ margin: "10px 0 0", maxHeight: "56vh" }}>
            <table>
              <thead><tr>
                <th style={{ width: 44 }}>#</th><th style={{ width: 110 }}>NIT</th><th>Cliente</th>
                <th>Rol</th><th style={{ width: 60 }}>Forma</th><th style={{ width: 150 }}>Período</th>
                <th style={{ width: 60, textAlign: "center" }}>Meses</th><th style={{ width: 120, textAlign: "right" }}>Valor</th>
              </tr></thead>
              <tbody>
                {prev.ok.map((r) => (
                  <tr key={"ok" + r.fila}>
                    <td style={{ color: "var(--ink-3)" }}>{r.fila}</td>
                    <td><span className="pill">{r.nit}</span></td>
                    <td style={{ fontSize: 12 }}>{r.nombre}</td>
                    <td style={{ fontSize: 12 }}>{r.rol || "—"} {r.rol_nuevo && <span className="tipo-tag t-cc" title="Rol nuevo (se creará)">nuevo</span>}</td>
                    <td style={{ textAlign: "center" }}>{r.forma}</td>
                    <td style={{ fontSize: 12 }}>{r.periodo}{r.meses > 1 ? ` → ${r.periodo_fin}` : ""}</td>
                    <td style={{ textAlign: "center" }}>{r.meses}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.valor)}</td>
                  </tr>
                ))}
                {prev.errores.map((e) => (
                  <tr key={"err" + e.fila} style={{ background: "rgba(220,60,60,.05)" }}>
                    <td style={{ color: "var(--ink-3)" }}>{e.fila}</td>
                    <td><span className="pill" style={{ opacity: .7 }}>{e.nit || "—"}</span></td>
                    <td style={{ fontSize: 12 }}>{e.nombre}</td>
                    <td style={{ fontSize: 12 }}>{e.rol}</td>
                    <td colSpan={3} style={{ fontSize: 12, color: "var(--err)" }}><Icon name="alert" size={12} /> {e.motivo}</td>
                    <td></td>
                  </tr>
                ))}
                {!prev.ok.length && !prev.errores.length && <tr><td colSpan={8} className="grid-empty">El Excel no trajo filas.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

const EST: Record<string, { lbl: string; cls: string }> = {
  ok: { lbl: "Coincide", cls: "e-ok" },
  dif: { lbl: "Diferencia", cls: "e-dif" },
  sin_emitir: { lbl: "Sin emitir", cls: "e-se" },
  sin_facturar: { lbl: "Sin facturar", cls: "e-sf" },
};

function ValidarModal({ cab, rep, validando, carpeta, onRepick, onClose }: {
  cab: Cab; rep: any; validando: boolean; carpeta: string;
  onRepick: () => void; onClose: () => void;
}) {
  const m = (n: number) => "$ " + Math.round(n || 0).toLocaleString("es-CO");
  const R = rep?.resumen;
  const [filtro, setFiltro] = useState<string | null>(null);   // filtra la tabla por estado
  const chip = (est: string) => filtro === est ? " on" : "";
  const toggle = (est: string) => setFiltro((f) => f === est ? null : est);

  const vrows = useMemo(() => {
    if (!rep) return [] as any[];
    return [...rep.filas.map((f: any) => ({ ...f, tipo: "Fa" })), ...rep.filas_cc.map((f: any) => ({ ...f, tipo: "CC" }))]
      .filter((f: any) => !filtro || f.estado === filtro)
      .sort((a: any, b: any) => (a.nit || "").localeCompare(b.nit || ""))
      .map((f: any, i: number) => ({ ...f, _k: i }));
  }, [rep, filtro]);

  const difCol = (v: number) => <span style={{ color: Math.abs(v) >= 1 ? "var(--err)" : "var(--ink-3)" }}>{m(v)}</span>;
  const cols: Column<any>[] = [
    { key: "nit", label: "ID", type: "code", align: "left", sortable: true, filterable: true, width: "12ch", value: (f) => f.nit || "", render: (f) => <span className="mono">{f.nit}</span> },
    { key: "nombre", label: "Cliente", sortable: true, filterable: true, width: "36ch", value: (f) => f.nombre || "" },
    { key: "base_esp", label: "Valor aprob.", type: "money", sortable: true, value: (f) => f.base_esp, formatter: money$ },
    { key: "base_emi", label: "Valor emit.", type: "money", sortable: true, value: (f) => f.base_emi, formatter: money$ },
    { key: "dif_base", label: "Dif", type: "money", sortable: true, value: (f) => f.dif_base, formatter: money$, render: (f) => difCol(f.dif_base) },
    { key: "iva_esp", label: "IVA aprob.", type: "money", sortable: true, value: (f) => f.iva_esp, formatter: money$ },
    { key: "iva_emi", label: "IVA emit.", type: "money", sortable: true, value: (f) => f.iva_emi, formatter: money$ },
    { key: "dif_iva", label: "Dif IVA", type: "money", sortable: true, value: (f) => f.dif_iva, formatter: money$, render: (f) => difCol(f.dif_iva) },
    { key: "estado", label: "Estado", type: "status", filterable: true, value: (f) => EST[f.estado]?.lbl || f.estado, render: (f) => <span className={"val-estado " + EST[f.estado].cls}>{EST[f.estado].lbl}</span> },
    { key: "docs", label: "Fact/CC", width: "20ch", value: (f) => `${f.tipo} ${(f.numeros || []).join(", ")}`, render: (f) => <span style={{ fontSize: 11.5 }}><span className={"tipo-tag " + (f.tipo === "CC" ? "t-cc" : "t-fa")}>{f.tipo}</span> <span style={{ color: "var(--ink-3)" }}>{(f.numeros || []).join(", ")}</span></span> },
  ];

  const acciones = rep ? (
    <>
      <button className="mh-act" onClick={onRepick} aria-label="Otra carpeta"><Icon name="folder" size={18} /><span className="mh-tip">Otra carpeta</span></button>
      <button className="mh-act" aria-label="Exportar Excel"
        onClick={() => api.downloadPost("/facturacion/validar/excel", { etiqueta: cab.etiqueta, resumen: R, filas: rep.filas, filas_cc: rep.filas_cc }, `Validacion ${cab.etiqueta}.xlsx`).catch(() => {})}><Icon name="down" size={18} /><span className="mh-tip">Exportar Excel</span></button>
    </>
  ) : undefined;

  return (
    <Modal icon="clipboard-check" size="xl" onClose={onClose} extraActions={acciones}
      aviso={rep ? <>Emitido — Facturas: <b>{m(R.base_emi)}</b> (IVA {m(R.iva_emi)}) · CC: <b>{m(R.cc_base_emi)}</b></> : undefined}
      title={`Validar ${cab.etiqueta} · aprobada vs facturas emitidas`}>
      {carpeta && <div className="hint" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="folder" size={14} /><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>{carpeta}</span>
        <button className="btn sm" onClick={onRepick}><Icon name="folder" size={13} />Cambiar carpeta</button>
      </div>}
      {!rep ? (
        <div style={{ padding: "6px 2px" }}>
          <div className="hint" style={{ marginBottom: 14 }}>
            Elige la <b>carpeta</b> del mes; se lee <b>completa</b> (subcarpetas incluidas): las <b>facturas</b> desde los <b>XML</b> y las
            <b> cuentas de cobro</b> desde los <b>Word (.docx)</b>. Se compara por cliente (NIT): base/valor e IVA (las CC no llevan IVA;
            las retenciones no vienen en la factura de venta).
          </div>
          {validando
            ? <span className="rut-cargando"><Icon name="hourglass" size={16} />Leyendo la carpeta (facturas y cuentas de cobro)…</span>
            : <button className="btn primary" onClick={onRepick}><Icon name="folder" size={15} />Elegir carpeta…</button>}
        </div>
      ) : (
        <>
          <div className="val-resumen">
            <span className="vr">XML: <b>{R.n_xml}</b> → Facturas: <b>{R.n_facturas}</b></span>
            <span className="vr">Word: <b>{R.n_docx}</b> → CC: <b>{R.n_cc}</b></span>
            <button className={"vr e-ok" + chip("ok")} onClick={() => toggle("ok")}>Coinciden: <b>{R.ok + R.cc_ok}</b></button>
            <button className={"vr e-dif" + chip("dif")} onClick={() => toggle("dif")}>Diferencias: <b>{R.dif + R.cc_dif}</b></button>
            <button className={"vr e-se" + chip("sin_emitir")} onClick={() => toggle("sin_emitir")}>Sin emitir: <b>{R.sin_emitir + R.cc_sin_emitir}</b></button>
            <button className={"vr e-sf" + chip("sin_facturar")} onClick={() => toggle("sin_facturar")}>Sin facturar: <b>{R.sin_facturar + R.cc_sin_facturar}</b></button>
            {filtro && <button className="vr vr-clear" onClick={() => setFiltro(null)}>✕ Ver todos</button>}
          </div>
          <DataGrid columns={cols} rows={vrows} getKey={(f) => f._k} label="Validación de facturación"
            scrollClass="claves-modal-scroll" emptyLabel="Sin datos para cruzar." />
          {rep.errores.length > 0 && <div className="fld-err" style={{ marginTop: 8 }}>{rep.errores.length} archivo(s) no se pudieron leer.</div>}
        </>
      )}
    </Modal>
  );
}
