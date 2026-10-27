import { useEffect, useState } from "react";
import { api } from "../api";
import { useActiveReload } from "../useActiveReload";
import { fmtMiles as fmt, Icon, pesos, SecTitle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";
import { MESES, PeriodoPicker } from "../components/PeriodoPicker";

interface Row {
  cliente_id: number; cliente: string; concepto: string;
  conceptos?: { concepto: string; valor: number }[]; n_conceptos?: number;
  valor: number | null;
  emisor: string; tiene_emisor: boolean; correo: string;
  numero: string | null; proximo_numero: string | null; ruta: string;
  estado: string; enviado_at: string | null;
}


/** Sección "Cuentas de cobro": grilla por período (lee la facturación del mes).
 *  Acciones por fila: generar en firme · revisar (PDF) · enviar por correo. */
export function CuentasCobro({ puede, active }: { puede: (c: string) => boolean; active: boolean }) {
  const puedeEditar = puede("facturacion.editar");   // generar CC / enviar correos
  const toast = useToast();
  const confirmar = useConfirm();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [fid, setFid] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cargando, setCargando] = useState(false);
  const [actualizado, setActualizado] = useState("");
  const [componer, setComponer] = useState<Row | null>(null);

  const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
  const cargar = () => {
    setCargando(true);
    api.get(`/cobros?periodo=${periodo}`)
      .then((r: { fid: number | null; rows: Row[] }) => { setFid(r.fid); setRows(r.rows || []); setActualizado(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })); })
      .catch((e) => toast(e.message, true))
      .finally(() => setCargando(false));
  };
  // Recarga al volver si hubo escrituras (epoch) o si cambió el período.
  useActiveReload(active, cargar, [periodo]);

  const generarUno = async (r: Row) => {
    if (!fid) return;
    if ((await confirmar({
      titulo: "Generar cuenta de cobro",
      mensaje: `Se generará la cuenta de cobro N° ${r.proximo_numero || "—"} para «${r.cliente}» por $ ${fmt(r.valor)} (emisor: ${r.emisor || "—"}).`
        + (r.ruta ? `\n\nEl PDF se guardará en:\n${r.ruta}` : "\n\n(No hay carpeta configurada: no se guardará el PDF en disco.)")
        + `\n\nSe consume el consecutivo del emisor. No se puede deshacer.`,
      confirmar: "Generar",
    })) !== "si") return;
    try {
      const x = await api.post(`/facturacion/${fid}/cliente/${r.cliente_id}/cuenta-cobro`, {});
      toast(x.nueva ? `Generada ${x.numero} ✓${x.ruta ? " · PDF guardado" : ""}` : `Ya existía (${x.numero})`);
      cargar();
    } catch (e: any) { toast(e.message, true); }
  };
  const generarTodas = async () => {
    if (!fid) return;
    const pend = rows.filter((r) => !r.numero && r.tiene_emisor).length;
    if (!pend) { toast("No hay cuentas de cobro pendientes por generar (con emisor)."); return; }
    if ((await confirmar({
      titulo: "Generar cuentas de cobro",
      mensaje: `Se asignará número definitivo a ${pend} cuenta(s) de cobro y se consumirán los consecutivos de sus emisores.`
        + (rows.some((r) => !r.numero && r.tiene_emisor && r.ruta) ? " Los PDF se guardarán en la carpeta configurada." : "")
        + " No se puede deshacer.",
      confirmar: "Generar todas",
    })) !== "si") return;
    try {
      const x = await api.post(`/facturacion/${fid}/cuentas-cobro/generar`, {});
      const faltan = (x.no_generadas || []).length;
      toast(`Generadas: ${x.generadas}${x.ya_existian ? ` · ya existían: ${x.ya_existian}` : ""}${faltan ? ` · sin emisor: ${faltan}` : ""} ✓`, faltan > 0);
      cargar();
    } catch (e: any) { toast(e.message, true); }
  };
  const revisar = async (r: Row) => {
    if (!fid) return;
    try { await api.openPdf(`/facturacion/${fid}/cliente/${r.cliente_id}/cuenta-cobro.pdf`); }
    catch (e: any) { toast(e.message, true); }
  };
  const enviarTodas = async () => {
    if (!fid) return;
    const elig = rows.filter((r) => r.numero && r.correo && r.estado !== "enviada");
    if (!elig.length) { toast("No hay cuentas de cobro generadas con correo para enviar."); return; }
    if ((await confirmar({
      titulo: "Enviar cuentas de cobro",
      mensaje: `Se enviarán ${elig.length} cuenta(s) de cobro por correo a los clientes.`,
      confirmar: "Enviar todas",
    })) !== "si") return;
    let ok = 0;
    for (const r of elig) {
      try { await api.post(`/cobros/${fid}/cliente/${r.cliente_id}/enviar`, {}); ok++; }
      catch (e: any) { toast(e.message, true); break; }
    }
    if (ok) toast(`Enviadas: ${ok} ✓`);
    cargar();
  };

  const estadoView = (r: Row) => {
    if (r.estado === "enviada") return <span className="cc-est ok">Enviada</span>;
    if (r.numero) return <span className="cc-est info">Generada</span>;
    return <span className="cc-est warn">Pendiente</span>;
  };

  const cols: Column<Row>[] = [
    {
      key: "cliente", label: "Cliente", sortable: true, filterable: true, minWidth: "240px",
      value: (r) => r.cliente || "",
      render: (r) => <div><div>{r.cliente}</div>{r.concepto && <div className="cc-sub">{r.n_conceptos && r.n_conceptos > 1 ? `${r.n_conceptos} conceptos · ` : ""}{r.concepto}</div>}</div>,
    },
    {
      key: "emisor", label: "Emisor", sortable: true, filterable: true, width: "140px", value: (r) => r.emisor || "",
      render: (r) => r.tiene_emisor ? <span>{r.emisor}</span>
        : <span className="cc-nocorreo"><Icon name="alert" size={13} />sin emisor</span>,
    },
    { key: "valor", label: "Valor", type: "money", sortable: true, total: true, value: (r) => r.valor || 0, formatter: (v) => pesos(v as number), render: (r) => <span>{pesos(r.valor)}</span> },
    {
      key: "numero", label: "N°", width: "100px", align: "center", value: (r) => r.numero || "",
      render: (r) => r.numero ? <span className="pill cc-num">{r.numero}</span> : <span style={{ color: "var(--ink-3)" }}>—</span>,
    },
    { key: "estado", label: "Estado", type: "status", filterable: true, width: "120px", align: "center", value: (r) => r.estado, render: estadoView },
    {
      key: "correo", label: "Correo", filterable: true, minWidth: "160px", value: (r) => r.correo || "",
      render: (r) => r.correo ? <span style={{ color: "var(--ink-2)" }}>{r.correo}</span>
        : <span className="cc-nocorreo"><Icon name="alert" size={13} />sin correo</span>,
    },
  ];

  return (
    <div className="card gframe">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SecTitle icon="file">Cuentas de cobro</SecTitle>
        <div className="r" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <PeriodoPicker mes={mes} anio={anio} onMes={setMes} onAnio={setAnio} />
          <button className="btn sm" onClick={cargar} title="Actualizar"><Icon name="refresh" size={15} /></button>
          {fid && puedeEditar && <>
            <button className="btn primary sm" onClick={generarTodas}><Icon name="clipboard-check" size={15} />Generar todas</button>
            <button className="btn sm" onClick={enviarTodas}><Icon name="mail" size={15} />Enviar todas</button>
          </>}
        </div>
      </div>
      <div className="gframe-body">
        {!fid && !cargando
          ? <p style={{ color: "var(--ink-3)", padding: "8px 2px" }}>No hay facturación guardada de {MESES[mes]} {anio}. Genérala y guárdala en «Facturación» para ver aquí sus cuentas de cobro.</p>
          : <DataGrid columns={cols} rows={rows} getKey={(r) => r.cliente_id}
              label={`Cuentas de cobro · ${MESES[mes]} ${anio}`} storageKey="cobros-grid" fitRows
              searchable exportable defaultTotals={["valor"]}
              emptyLabel={cargando ? "Cargando…" : "No hay cuentas de cobro (ítems CC) en la facturación de este mes."}
              actions={(r) => <span className="cc-cell">
                {puedeEditar && <button className="act-btn" title={!r.tiene_emisor ? "El cliente no tiene emisor asignado (ficha → Comercial)" : r.numero ? "Ya generada" : "Generar en firme (quema el consecutivo)"}
                  disabled={!!r.numero || !r.tiene_emisor} onClick={() => generarUno(r)}><Icon name="clipboard-check" size={15} /></button>}
                <button className="act-btn" title={r.numero ? "Revisar PDF" : "Vista previa (PDF)"}
                  disabled={!r.numero && !r.tiene_emisor} onClick={() => revisar(r)}><Icon name="eye" size={15} /></button>
                {puedeEditar && <button className="act-btn" title={!r.numero ? "Genera primero" : r.estado === "enviada" ? "Reenviar por correo" : !r.correo ? "Enviar (escribe el destinatario)" : "Enviar por correo"}
                  disabled={!r.numero} onClick={() => setComponer(r)}><Icon name="mail" size={15} /></button>}
              </span>} />}
      </div>
      <div className="gframe-foot">
        {rows.length} cuenta{rows.length === 1 ? "" : "s"} de cobro
        {actualizado && <><span className="gf-dot">·</span> Actualizado: {actualizado}</>}
      </div>
      {componer && fid && <EnviarCorreoModal fid={fid} row={componer} onClose={() => setComponer(null)} onSent={cargar} />}
    </div>
  );
}

/** Modal de envío estilo Outlook: De (fijo = correo conectado), Para (editable),
 *  CC/CCO opcionales, Asunto y Mensaje (precargados de la plantilla, editables) y
 *  el PDF como adjunto. El botón "Enviar" de la cabecera dispara el correo. */
function EnviarCorreoModal({ fid, row, onClose, onSent }: {
  fid: number; row: Row; onClose: () => void; onSent: () => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [conectado, setConectado] = useState(true);
  const [de, setDe] = useState("");
  const [para, setPara] = useState("");
  const [cc, setCc] = useState("");
  const [cco, setCco] = useState("");
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [adjunto, setAdjunto] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get(`/cobros/${fid}/cliente/${row.cliente_id}/correo-preview`)
      .then((d: any) => {
        setDe(d.de || ""); setConectado(!!d.conectado); setPara(d.para || "");
        setAsunto(d.asunto || ""); setCuerpo(d.cuerpo || ""); setAdjunto(d.adjunto || "");
      })
      .catch((e: any) => setErr(e.message))
      .finally(() => setCargando(false));
  }, []); // eslint-disable-line

  const enviar = async () => {
    if (!para.trim()) { toast("Indica el destinatario (Para).", true); return; }
    setEnviando(true);
    try {
      const r: any = await api.post(`/cobros/${fid}/cliente/${row.cliente_id}/enviar`, { para, cc, cco, asunto, cuerpo });
      toast(`Enviada a ${r.correo} ✓`); onSent(); onClose();
    } catch (e: any) { toast(e.message, true); setEnviando(false); }
  };
  const verPdf = () => api.openPdf(`/facturacion/${fid}/cliente/${row.cliente_id}/cuenta-cobro.pdf`).catch((e: any) => toast(e.message, true));

  const aviso = err ? err
    : !conectado ? "No has conectado tu correo (Configuración → Mi correo). Conéctalo para poder enviar."
    : undefined;

  return (
    <Modal title="Enviar cuenta de cobro" sub={`${row.cliente}${row.numero ? " · " + row.numero : ""}`}
           icon="mail" size="md" onClose={onClose} onSave={enviar} saving={enviando}
           saveLabel="Enviar" saveIcon="mail"
           canSave={conectado && !!para.trim() && !cargando}
           aviso={aviso} avisoTone={err ? "err" : "warn"}>
      {cargando ? <div className="hint">Cargando…</div> : (<>
        <div className="fieldgroup"><h4>Destinatarios</h4>
          <div className="obl-grid">
            <label className="cq-fld obl-wide"><span>De</span>
              <input value={de || "(sin correo conectado)"} disabled /></label>
            <label className="cq-fld obl-wide"><span>Para</span>
              <input value={para} onChange={(e) => setPara(e.target.value)} placeholder="correo@cliente.com" /></label>
            <label className="cq-fld"><span>CC</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Opcional · separa con coma" /></label>
            <label className="cq-fld"><span>CCO</span>
              <input value={cco} onChange={(e) => setCco(e.target.value)} placeholder="Opcional · separa con coma" /></label>
          </div>
        </div>
        <div className="fieldgroup"><h4>Mensaje</h4>
          <div className="obl-grid">
            <label className="cq-fld obl-wide"><span>Asunto</span>
              <input value={asunto} onChange={(e) => setAsunto(e.target.value)} /></label>
            <label className="cq-fld obl-wide"><span>Cuerpo</span>
              <textarea value={cuerpo} rows={8} onChange={(e) => setCuerpo(e.target.value)} /></label>
          </div>
          {adjunto && <label className="cq-fld" style={{ marginTop: 12 }}><span>Adjunto</span>
            <div className="cc-adjunto" onClick={verPdf} title="Ver el PDF adjunto">
              <Icon name="file" size={15} /><span className="cc-adj-n">{adjunto}</span><span className="cc-adj-ver">Ver</span>
            </div></label>}
        </div>
      </>)}
    </Modal>
  );
}
