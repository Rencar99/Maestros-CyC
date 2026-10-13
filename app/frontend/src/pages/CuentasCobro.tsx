import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon, SecTitle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";

interface Row {
  item_id: number; cliente: string; concepto: string; valor: number | null;
  emisor: string; tiene_emisor: boolean; correo: string;
  numero: string | null; proximo_numero: string | null; ruta: string;
  estado: string; enviado_at: string | null;
}

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const fmt = (v: number | null) => (v == null ? "" : Math.round(v).toLocaleString("es-CO"));

/** Sección "Cuentas de cobro": grilla por período (lee la facturación del mes).
 *  Acciones por fila: generar en firme · revisar (PDF) · enviar por correo. */
export function CuentasCobro({ active }: { active: boolean }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [fid, setFid] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cargando, setCargando] = useState(false);

  const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
  const cargar = () => {
    setCargando(true);
    api.get(`/cobros?periodo=${periodo}`)
      .then((r: { fid: number | null; rows: Row[] }) => { setFid(r.fid); setRows(r.rows || []); })
      .catch((e) => toast(e.message, true))
      .finally(() => setCargando(false));
  };
  useEffect(() => { if (active) cargar(); }, [active, periodo]); // eslint-disable-line

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
      const x = await api.post(`/facturacion/${fid}/item/${r.item_id}/cuenta-cobro`, {});
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
    try { await api.openPdf(`/facturacion/${fid}/item/${r.item_id}/cuenta-cobro.pdf`); }
    catch (e: any) { toast(e.message, true); }
  };
  const enviarUno = async (r: Row) => {
    if (!fid) return;
    try {
      await api.post(`/cobros/${fid}/item/${r.item_id}/enviar`, {});
      toast(`Enviada a ${r.correo} ✓`); cargar();
    } catch (e: any) { toast(e.message, true); }
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
      try { await api.post(`/cobros/${fid}/item/${r.item_id}/enviar`, {}); ok++; }
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
      render: (r) => <div><div>{r.cliente}</div>{r.concepto && <div className="cc-sub">{r.concepto}</div>}</div>,
    },
    {
      key: "emisor", label: "Emisor", sortable: true, filterable: true, width: "140px", value: (r) => r.emisor || "",
      render: (r) => r.tiene_emisor ? <span>{r.emisor}</span>
        : <span className="cc-nocorreo"><Icon name="alert" size={13} />sin emisor</span>,
    },
    { key: "valor", label: "Valor", type: "money", sortable: true, total: true, value: (r) => r.valor || 0, formatter: (v) => "$ " + fmt(Number(v) || 0), render: (r) => <span>$ {fmt(r.valor)}</span> },
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
    <div className="card">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SecTitle icon="file">Cuentas de cobro</SecTitle>
        <div className="r" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="fact-period" title="Período">
            <Icon name="calendar" size={16} />
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input className="fp-year" value={anio} onChange={(e) => setAnio(Number(e.target.value) || anio)} />
          </span>
          <button className="btn sm" onClick={cargar} title="Actualizar"><Icon name="refresh" size={15} /></button>
          {fid && <>
            <button className="btn primary sm" onClick={generarTodas}><Icon name="clipboard-check" size={15} />Generar todas</button>
            <button className="btn sm" onClick={enviarTodas}><Icon name="mail" size={15} />Enviar todas</button>
          </>}
        </div>
      </div>

      {!fid && !cargando
        ? <p style={{ color: "var(--ink-3)", padding: "8px 2px" }}>No hay facturación guardada de {MESES[mes]} {anio}. Genérala y guárdala en «Facturación» para ver aquí sus cuentas de cobro.</p>
        : <DataGrid columns={cols} rows={rows} getKey={(r) => r.item_id}
            label={`Cuentas de cobro · ${MESES[mes]} ${anio}`} scrollClass="fact-scroll" storageKey="cobros-grid"
            searchable exportable defaultTotals={["valor"]}
            emptyLabel={cargando ? "Cargando…" : "No hay cuentas de cobro (ítems CC) en la facturación de este mes."}
            actions={(r) => <span className="cc-cell">
              <button className="act-btn" title={!r.tiene_emisor ? "El cliente no tiene emisor asignado (ficha → Comercial)" : r.numero ? "Ya generada" : "Generar en firme (quema el consecutivo)"}
                disabled={!!r.numero || !r.tiene_emisor} onClick={() => generarUno(r)}><Icon name="clipboard-check" size={15} /></button>
              <button className="act-btn" title={r.numero ? "Revisar PDF" : "Vista previa (PDF)"}
                disabled={!r.numero && !r.tiene_emisor} onClick={() => revisar(r)}><Icon name="eye" size={15} /></button>
              <button className="act-btn" title={!r.numero ? "Genera primero" : !r.correo ? "El cliente no tiene correo" : r.estado === "enviada" ? "Reenviar por correo" : "Enviar por correo"}
                disabled={!r.numero || !r.correo} onClick={() => enviarUno(r)}><Icon name="mail" size={15} /></button>
            </span>} />}
    </div>
  );
}
