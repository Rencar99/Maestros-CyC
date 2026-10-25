import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useActiveReload } from "../useActiveReload";
import { Icon, numInt, pesos, useConfirm, useToast } from "../ui";
import { Explorador } from "../components/Explorador";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal, minDock } from "../components/Modal";
import { RespCombo } from "../components/RespCombo";
import { MESES, PeriodoPicker } from "../components/PeriodoPicker";

interface Fila {
  _uid: number; id?: number; cliente_id: number | null; num_id: string; nombre: string; rol_servicio: string;
  concepto: string; valor: string; forma: string; iva: string; reteiva: string;
  periodicidad: string; observaciones: string; rete: boolean;
}
// Llave estable por fila del editor (las filas libres no tienen id de BD).
let _fuid = 0;
const nuevoUid = () => ++_fuid;
interface Cab {
  id: number; anio: number; mes: number; etiqueta: string;
  creado_at: string; creado_por: string; n_items: number; total_valor: string;
  aprobada_at: string | null; aprobada_por: string;
}
interface CliMin { id: number; num_id: string; nombre: string; }

const fmtFechaHora = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
// Dinero a 0 decimales (estándar firma): lógica única en ui.tsx.
const num = numInt;
const fmt = (v: string | number) => numInt(v).toLocaleString("es-CO");
const money$ = pesos;
// Evita que el clic en un input de celda inicie la selección de la grilla. A nivel
// de módulo (estable) para no romper el memo de `detCols`.
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function Facturacion({ usuario, puede, active = true, goFacturacion }: { usuario: string; puede: (c: string) => boolean; active?: boolean; goFacturacion?: () => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const _h = new Date();
  const hoy = { anio: _h.getFullYear(), mes: _h.getMonth() + 1 };   // período inicial = hoy (editable)
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
  const conRete = (it: any): Fila => ({ ...it, rete: num(it.reteiva) > 0, _uid: nuevoUid() });

  const cargarLista = () => api.get("/facturacion").then(setCabs).catch((e) => toast(e.message, true));
  // Clientes (para el combo del editor): una sola vez al montar.
  useEffect(() => {
    api.get("/clientes").then((cs: any[]) => setClientes(cs.map((c) => ({ id: c.id, num_id: c.num_id, nombre: c.nombre })))).catch(() => {});
  }, []); // eslint-disable-line
  // Carga al montar y al volver, solo si hubo escrituras desde la última vez
  // (keep-alive + epoch): no re-consulta en navegación sin cambios.
  useActiveReload(active, cargarLista);

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
  // Handlers del editor por `_uid` (llave estable de fila), NO por índice: así las
  // columnas no dependen de `filas` y, con `useCallback`, su identidad no cambia al
  // teclear → `detCols` memoizado se mantiene estable → la fila memoizada del grid
  // aísla la tecla a la celda editada (no re-renderiza toda la tabla). `pctRete` se
  // lee por ref para no entrar en las dependencias.
  const reteCalc = useCallback((forma: string, on: boolean, iva: string, pct: number) =>
    (forma === "Fa" && on) ? String(Math.round(num(iva) * pct / 100)) : "0", []);
  const pctRef = useRef(pctRete);
  pctRef.current = pctRete;
  const setF = useCallback((uid: number, patch: Partial<Fila>) =>
    setFilas((f) => f.map((x) => x._uid === uid ? { ...x, ...patch } : x)), []);
  const delF = useCallback((uid: number) =>
    setFilas((f) => f.filter((x) => x._uid !== uid)), []);
  // Al editar el Valor: se toman SOLO los dígitos (el separador de miles "." no debe
  // interpretarse como decimal). IVA = 19% si es Factura (0 si CC) y se recalcula ReteIVA.
  const setValor = useCallback((uid: number, v: string) => setFilas((f) => f.map((x) => {
    if (x._uid !== uid) return x;
    const valor = (v || "").replace(/\D/g, "") || "0";
    const iva = x.forma === "Fa" ? String(Math.round(Number(valor) * 0.19)) : "0";
    return { ...x, valor, iva, reteiva: reteCalc(x.forma, x.rete, iva, pctRef.current) };
  })), [reteCalc]);
  const cambiarPct = (p: number) => { setPctRete(p); setFilas((f) => f.map((x) => ({ ...x, reteiva: reteCalc(x.forma, x.rete, x.iva, p) }))); };
  const pickCliente = useCallback((uid: number, cid: number) => {
    const c = clientes.find((x) => x.id === cid);
    if (c) setF(uid, { cliente_id: c.id, num_id: c.num_id, nombre: c.nombre });
  }, [clientes, setF]);

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
  // Estable entre renders: el RespCombo de las filas sin cliente memoiza sus opciones.
  const clientesOpt = useMemo(() => clientes.map((c) => ({ id: c.id, nombre: `${c.num_id} · ${c.nombre}` })), [clientes]);
  // Columnas MEMOIZADAS: su identidad no cambia al teclear (los handlers son estables
  // y keyean por `_uid`, no por índice, así que no dependen de `filas`). Junto con la
  // fila memoizada del grid, cada tecla re-renderiza SOLO la celda editada.
  const detCols: Column<Fila>[] = useMemo(() => [
    {
      key: "id", label: "Id", type: "code", sortable: true, value: (f) => f.num_id || "",
      render: (f) => f.cliente_id === null
        ? <RespCombo value={null} options={clientesOpt} placeholder="Buscar cliente…"
            onChange={(id) => { if (id != null) pickCliente(f._uid, id); }} />
        : <span className="pill">{f.num_id}</span>,
    },
    { key: "nombre", label: "Nombre Cliente", sortable: true, filterable: true, width: "26ch", value: (f) => f.nombre || "", tip: (f) => f.nombre },
    {
      key: "concepto", label: "Concepto", sortable: true, filterable: true, minWidth: "180px", value: (f) => f.concepto || "",
      render: (f) => <input className="cell-input" value={f.concepto} onMouseDown={stop}
        onChange={(e) => setF(f._uid, { concepto: e.target.value })} />,
    },
    {
      key: "valor", label: "Valor", type: "money", sortable: true, filterable: true, total: true, value: (f) => num(f.valor), formatter: money$,
      render: (f) => <input className="cell-input" style={{ textAlign: "right" }} value={fmt(f.valor)} onMouseDown={stop}
        onChange={(e) => setValor(f._uid, e.target.value)} />,
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
      key: "obs", label: "Observaciones", minWidth: "190px", value: (f) => f.observaciones || "",
      render: (f) => <input className="cell-input" value={f.observaciones} onMouseDown={stop}
        onChange={(e) => setF(f._uid, { observaciones: e.target.value })} />,
    },
  ], [clientesOpt, pickCliente, setF, setValor]);
  // Estable para no invalidar la fila memoizada del grid en cada render.
  const detActions = useCallback((f: Fila) =>
    <button className="act-btn del" title="Quitar" onClick={() => delF(f._uid)}><Icon name="trash" size={14} /></button>, [delF]);
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
                {puede("facturacion.crear") && <button className="btn primary sm" onClick={() => { setFilas([]); setGuardadoId(null); setEtiqueta(""); setMin(false); setVista("editor"); }}>
                  <Icon name="plus" size={16} />Nueva facturación
                </button>}
              </span>}
              actions={(c) => <>
                {puede("facturacion.aprobar") && <button className={"act-btn " + (c.aprobada_at ? "aprob-on" : "aprob")} title={c.aprobada_at ? "Quitar aprobación" : "Aprobar facturación del mes"} onClick={() => aprobar(c)}><Icon name={c.aprobada_at ? "check-circle" : "check"} size={15} /></button>}
                {puede("facturacion.validar") && <button className="act-btn val" title="Validar contra facturas emitidas (XML)" onClick={() => { setValCab(c); setValRep(null); setValCarpeta(""); valPicked.current = false; setValPicker(true); }}><Icon name="clipboard-check" size={15} /></button>}
                <button className="act-btn edit" title="Abrir" onClick={() => abrir(c.id)}><Icon name="edit" size={15} /></button>
                {puede("facturacion.eliminar") && <button className="act-btn del" title="Eliminar" onClick={() => eliminar(c.id, c.etiqueta)}><Icon name="trash" size={15} /></button>}
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
            <PeriodoPicker mes={mes} anio={anio} onMes={setMes} onAnio={setAnio} title="Mes de proceso" />
            {puede("facturacion.crear") && <button className="btn primary sm" onClick={generar}><Icon name="gear" size={15} />Generar</button>}
          </div>
          <div className="r" style={{ alignItems: "center", gap: 8 }}>
            {puede("facturacion.crear") && <div className="fact-addwrap">
              <button className="btn sm" onClick={() => setAddMenu((o) => !o)} aria-expanded={addMenu}><Icon name="plus" size={15} />Agregar<span className="cw">▾</span></button>
              {addMenu && <>
                <div className="menu-backdrop" onMouseDown={() => setAddMenu(false)} />
                <div className="fact-addpop" role="menu">
                  <button role="menuitem" onClick={() => { setModalAdd(true); setAddMenu(false); }}><Icon name="box" size={14} />Servicios</button>
                  <button role="menuitem" onClick={() => { setModalLibre(true); setAddMenu(false); }} title="Cobro puntual (extra)"><Icon name="edit" size={14} />Fila libre</button>
                </div>
              </>}
            </div>}
            {puede("facturacion.crear") && <button className="btn primary sm" onClick={guardar}><Icon name="save" size={15} />Guardar</button>}
          </div>
        </div>

        {modalAdd && <AgregarServicios etiqueta={etqActual} yaEnGrilla={yaEnGrilla}
          onAgregar={(nuevas) => setFilas((f) => [...f, ...nuevas.map((n: any) => ({ ...n, _uid: nuevoUid() }))])} onClose={() => setModalAdd(false)} />}
        {modalLibre && <FilaLibreModal etiqueta={etqActual} clientes={clientes} pctRete={pctRete}
          onAgregar={(fila) => setFilas((f) => [...f, { ...fila, _uid: nuevoUid() }])} onClose={() => setModalLibre(false)} />}

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
            <DataGrid columns={detCols} rows={filas} getKey={(f) => f._uid}
              label="Detalle de facturación" storageKey="fact-detalle" fitRows
              searchable exportable toolbar={factTabs}
              defaultTotals={["valor", "iva", "reteiva"]}
              emptyLabel="Elige el mes y pulsa «Generar», o agrega filas manuales."
              actions={detActions} />
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
  useEffect(() => {
    api.get("/facturacion/no-mensuales")
      .then((list: any[]) => setItems(list.map((x) => ({ ...x, check: false, valorEd: x.valor }))))
      .catch((e: any) => toast(e.message, true));
  }, []); // eslint-disable-line
  const key = (s: Serv) => `${s.cliente_id}|${s.rol_servicio}`;
  const set = (i: number, patch: Partial<Serv>) => setItems((a) => a.map((x, j) => j === i ? { ...x, ...patch } : x));
  const nSel = items.filter((s) => s.check).length;
  const cols: Column<Serv>[] = [
    { key: "check", label: "", width: "40px", align: "center", value: (s) => s.check ? "1" : "0",
      render: (s) => yaEnGrilla.has(key(s))
        ? <span title="Ya está en la grilla" style={{ color: "var(--ok)", fontWeight: 700 }}>✓</span>
        : <input type="checkbox" checked={s.check} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => set(items.indexOf(s), { check: e.target.checked })} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} /> },
    { key: "nombre", label: "Cliente", sortable: true, filterable: true, value: (s) => s.nombre, tip: (s) => `${s.num_id} · ${s.nombre}`, render: (s) => <span><span className="pill">{s.num_id}</span> {s.nombre}</span> },
    { key: "rol_servicio", label: "Concepto", sortable: true, filterable: true, value: (s) => s.rol_servicio },
    { key: "periodicidad", label: "Period.", width: "90px", value: (s) => s.periodicidad === "Anio" ? "Año" : "Eventual" },
    { key: "valorEd", label: "Valor", type: "money", align: "right", width: "130px", value: (s) => num(s.valorEd),
      render: (s) => <input className="cell-input" style={{ textAlign: "right" }} value={fmt(s.valorEd)} disabled={yaEnGrilla.has(key(s))} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => set(items.indexOf(s), { valorEd: String(num(e.target.value)) })} /> },
  ];
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
      <DataGrid columns={cols} rows={items} getKey={key} label="Servicios"
        storageKey="fact-agregar-serv" scrollClass="modal-grid" searchable exportable={false}
        rowClass={(s) => yaEnGrilla.has(key(s)) ? "row-dim" : ""}
        emptyLabel="No hay servicios Año/Eventual de clientes activos." />
    </Modal>
  );
}

/** Modal (estándar CyC) para agregar una "fila libre": un cobro puntual/extra.
 *  Cliente opcional (búsqueda por NIT o nombre); IVA (19% si Factura) y ReteIVA
 *  se derivan solos, igual que en la grilla. */
function FilaLibreModal({ etiqueta, clientes, pctRete, onAgregar, onClose }: {
  etiqueta: string; clientes: CliMin[]; pctRete: number;
  onAgregar: (fila: Omit<Fila, "_uid">) => void; onClose: () => void;
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
  // Una sola grilla: filas OK + filas con error (con su Motivo en columna propia).
  const filasImp: any[] = prev ? [
    ...prev.ok.map((r: any) => ({ ...r, _ok: true, motivo: "" })),
    ...prev.errores.map((e: any) => ({ fila: e.fila, nit: e.nit, nombre: e.nombre, rol: e.rol, forma: "", periodo: "", periodo_fin: "", meses: 0, valor: 0, rol_nuevo: false, _ok: false, motivo: e.motivo })),
  ] : [];
  const colsImp: Column<any>[] = [
    { key: "fila", label: "#", width: "44px", align: "center", value: (r) => r.fila, render: (r) => <span className="cell-dash">{r.fila}</span> },
    { key: "_ok", label: "", width: "42px", align: "center", value: (r) => (r._ok ? "ok" : "error"), render: (r) => r._ok ? <Icon name="check" size={14} /> : <span style={{ color: "var(--err)" }}><Icon name="alert" size={14} /></span> },
    { key: "nit", label: "NIT", width: "110px", value: (r) => r.nit || "", render: (r) => r.nit ? <span className="pill">{r.nit}</span> : <span className="cell-dash">—</span> },
    { key: "nombre", label: "Cliente", sortable: true, filterable: true, value: (r) => r.nombre || "", tip: (r) => r.nombre },
    { key: "rol", label: "Rol", filterable: true, value: (r) => r.rol || "", render: (r) => <span>{r.rol || "—"}{r.rol_nuevo && <span className="tipo-tag t-cc" title="Rol nuevo (se creará)"> nuevo</span>}</span> },
    { key: "forma", label: "Forma", width: "64px", align: "center", value: (r) => r.forma || "" },
    { key: "periodo", label: "Período", width: "140px", value: (r) => r.periodo || "", render: (r) => r._ok ? <span>{r.periodo}{r.meses > 1 ? ` → ${r.periodo_fin}` : ""}</span> : <span className="cell-dash">—</span> },
    { key: "meses", label: "Meses", width: "60px", align: "center", value: (r) => (r._ok ? r.meses : ""), render: (r) => r._ok ? <span>{r.meses}</span> : <span className="cell-dash">—</span> },
    { key: "valor", label: "Valor", type: "money", align: "right", width: "120px", value: (r) => (r._ok ? r.valor : 0), render: (r) => r._ok ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(r.valor)}</span> : <span className="cell-dash">—</span> },
    { key: "motivo", label: "Motivo", filterable: true, value: (r) => r.motivo || "", tip: (r) => r.motivo, render: (r) => r.motivo ? <span style={{ color: "var(--err)" }}>{r.motivo}</span> : <span className="cell-dash">—</span> },
  ];
  return (
    <Modal title="Importar cobros desde Excel" icon="upload" size="lg" onClose={onClose} saving={guardando}
           aviso={R ? (R.filas_error > 0 ? `Se importarán solo las ${R.filas_ok} filas válidas; las ${R.filas_error} con error se omiten.` : "Todas las filas son válidas.") : undefined}
           avisoTone={R && R.filas_error > 0 ? "warn" : "info"}
           onSave={confirmar} canSave={!!prev?.ok.length} saveLabel={`Crear ${R?.cobros_a_crear || ""} cobro(s)`} saveIcon="check">
      <div className="hint" style={{ marginBottom: 12 }}>
        Columnas: <b>nit</b>, nombre, <b>rol</b>, forma (Fa/CC), <b>periodo</b> (AAAA-MM), <b>valor</b>, vendedor, comisión, meses.
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

          <div style={{ margin: "10px 0 0" }}>
            <DataGrid columns={colsImp} rows={filasImp} getKey={(r) => (r._ok ? "ok" : "err") + r.fila} label="Vista previa"
              storageKey="fact-importar-prev" scrollClass="modal-grid" searchable exportable={false}
              rowClass={(r) => (r._ok ? "" : "row-err")}
              emptyLabel="El Excel no trajo filas." />
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
  const toast = useToast();
  const m = money$;
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
    { key: "estado", label: "Estado", type: "status", filterable: true, value: (f) => EST[f.estado]?.lbl || f.estado, render: (f) => <span className={"val-estado " + (EST[f.estado]?.cls || "")}>{EST[f.estado]?.lbl || f.estado}</span> },
    { key: "docs", label: "Fact/CC", width: "20ch", value: (f) => `${f.tipo} ${(f.numeros || []).join(", ")}`, render: (f) => <span style={{ fontSize: 11.5 }}><span className={"tipo-tag " + (f.tipo === "CC" ? "t-cc" : "t-fa")}>{f.tipo}</span> <span style={{ color: "var(--ink-3)" }}>{(f.numeros || []).join(", ")}</span></span> },
  ];

  const acciones = rep ? (
    <>
      <button className="mh-act" onClick={onRepick} aria-label="Otra carpeta"><Icon name="folder" size={18} /><span className="mh-tip">Otra carpeta</span></button>
      <button className="mh-act" aria-label="Exportar Excel"
        onClick={() => api.downloadPost("/facturacion/validar/excel", { etiqueta: cab.etiqueta, resumen: R, filas: rep.filas, filas_cc: rep.filas_cc }, `Validacion ${cab.etiqueta}.xlsx`).catch((e: any) => toast(e.message, true))}><Icon name="down" size={18} /><span className="mh-tip">Exportar Excel</span></button>
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
