import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useActiveReload } from "../useActiveReload";
import { ClaveCell, copiar, Icon, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { useReveladas } from "../useReveladas";

/** Listado GLOBAL de claves de clientes en portales (Grilla CyC).
 *  Cada usuario ve las de sus clientes asignados; Admin/Super las ven todas.
 *  La clave va oculta (••••) con botón de revelar y copiar por fila. */
interface ClaveRow {
  id: number; cliente_id: number; num_id: string; cliente: string; estado: string; tipo: string;
  rl: string; portal: string; usuario: string; comentario: string; url: string;
  tiene_clave: boolean; actualizado_at: string | null;
}

export function Claves({ esSuper, puede, active = true }: { esSuper: boolean; puede: (c: string) => boolean; active?: boolean }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [rows, setRows] = useState<ClaveRow[]>([]);
  const { reveladas, toggle: revelar, ocultar, setReveladas } = useReveladas((id) => `/clientes/claves/${id}/revelar`, toast);
  const [todas, setTodas] = useState(false);      // ¿toda la columna revelada?
  const [cargando, setCargando] = useState(false);
  const [quick, setQuick] = useState("");         // filtro rápido: act/ina/jur/nat
  const [actualizado, setActualizado] = useState("");

  const load = () => {
    setCargando(true); ocultar(); setTodas(false);
    api.get("/clientes/claves/todas")
      .then((r: ClaveRow[]) => { setRows(r); setActualizado(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })); })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  };
  // Carga al montar y al volver, solo si hubo escrituras desde la última vez
  // (keep-alive + epoch): no re-consulta en navegación sin cambios.
  useActiveReload(active, load);

  const verTodas = async () => {
    if (todas) { ocultar(); setTodas(false); return; }  // ocultar todas
    try {
      const res: any[] = await api.get("/clientes/claves/reveladas");
      const m: Record<number, string> = {};
      res.forEach((x) => { m[x.id] = x.clave || ""; });
      setReveladas(m); setTodas(true);
    } catch (e: any) { toast(e.message, true); }
  };

  const exportar = () =>
    api.download("/clientes/claves/exportar", "Claves_clientes.xlsx").catch((e: any) => toast(e.message, true));


  const borrar = async (r: ClaveRow) => {
    const ok = await confirmar({
      titulo: "Eliminar clave",
      mensaje: `Se eliminará la clave de "${r.cliente}" en el portal ${r.portal || "—"} (usuario ${r.usuario || "—"}). Esta acción no se puede deshacer.`,
      peligro: true, confirmar: "Eliminar",
    });
    if (ok !== "si") return;
    try {
      await api.del(`/clientes/claves/${r.id}`);
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      toast("Clave eliminada ✓");
    } catch (e: any) { toast(e.message, true); }
  };

  // Esta pantalla muestra SOLO las claves de clientes ACTIVOS; las inactivas no se listan.
  const activas = useMemo(() => rows.filter((r) => r.estado === "Act"), [rows]);

  const filtered = useMemo(() => {
    // La búsqueda por texto ahora la hace el buscador global de la grilla (todas las columnas).
    // Aquí solo quedan los filtros rápidos (chips): Jurídicas / Naturales, sobre las activas.
    return activas.filter((r) => {
      if (quick === "jur" && r.tipo !== "Jur") return false;
      if (quick === "nat" && r.tipo !== "Nat") return false;
      return true;
    });
  }, [activas, quick]);

  const qfiltros = [
    { k: "", lbl: "Todas", n: activas.length },
    { k: "jur", lbl: "Jurídicas", n: activas.filter((r) => r.tipo === "Jur").length },
    { k: "nat", lbl: "Naturales", n: activas.filter((r) => r.tipo === "Nat").length },
  ];

  const cols: Column<ClaveRow>[] = useMemo(() => [
    { key: "num_id", label: "Id", type: "code", sortable: true, width: "12ch", value: (r) => r.num_id || "", render: (r) => <span className="mono">{r.num_id || "—"}</span> },
    { key: "cliente", label: "Cliente", sortable: true, filterable: true, className: "cli-full", value: (r) => r.cliente || "" },
    { key: "rl", label: "RL", sortable: true, filterable: true, width: "20ch", value: (r) => r.rl || "", tip: (r) => r.rl, render: (r) => r.rl || <span className="cell-dash">—</span> },
    { key: "tipo", label: "Tipo", type: "status", filterable: true, width: "7ch", value: (r) => r.tipo || "—", render: (r) => r.tipo ? <span className={"tag " + (r.tipo === "Jur" ? "jur" : "nat")}>{r.tipo}</span> : <span className="cell-dash">—</span> },
    { key: "portal", label: "Portal", align: "left", sortable: true, filterable: true, width: "18ch", value: (r) => r.portal || "—", render: (r) => r.portal ? <span className="tag int">{r.portal}</span> : <span className="tag ina">—</span> },
    { key: "url", label: "URL", align: "left", sortable: true, filterable: true, width: "20ch", value: (r) => r.url || "", tip: (r) => r.url, render: (r) => r.url
        ? <a href={/^https?:\/\//i.test(r.url) ? r.url : "https://" + r.url} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()} style={{ color: "var(--primary)", textDecoration: "none" }}>{r.url}</a>
        : <span className="cell-dash">—</span> },
    {
      key: "usuario", label: "Usuario", sortable: true, filterable: true, width: "18ch", value: (r) => r.usuario || "", tip: (r) => r.usuario,
      render: (r) => r.usuario
        ? <span className="mono" style={{ cursor: "pointer" }}
            onMouseDown={(e) => e.stopPropagation()} onClick={() => copiar(r.usuario, toast)}>{r.usuario}</span>
        : <span className="cell-dash">—</span>,
    },
    { key: "comentario", label: "Comentario", filterable: true, width: "24ch", value: (r) => r.comentario || "", tip: (r) => r.comentario },
    {
      key: "clave", label: "Clave", align: "left", width: "26ch", value: (r) => (r.tiene_clave ? "1" : "0"),
      render: (r) => <ClaveCell revealed={reveladas[r.id]} tiene_clave={r.tiene_clave} puede={puede("claves.revelar")}
        onToggle={() => revelar(r.id)} onCopy={(t) => copiar(t, toast)} />,
    },
  ], [reveladas, puede]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card gframe gframe-sinh">
      <div className="gframe-body">
        {cargando
          ? <div className="grid-empty" style={{ padding: 20 }}>Cargando…</div>
          : <DataGrid columns={cols} rows={filtered} getKey={(r) => r.id} label="Claves de clientes"
              storageKey="claves2" searchable exportable={false} fitRows emptyLabel="No hay claves para mostrar."
              actionsWidth="92px"
              toolbar={<>
                <div className="qfbar">
                  {qfiltros.map((f) => (
                    <button key={f.k} className={"qf" + (quick === f.k ? " on" : "")} onClick={() => setQuick(f.k)}>
                      {f.lbl}<span className="n">{f.n}</span>
                    </button>
                  ))}
                </div>
                <span className="gf-end">
                  {puede("claves.revelar") && <button className={"btn sm" + (todas ? " primary" : "")} onClick={verTodas} title="Mostrar/ocultar toda la columna de claves">
                    <Icon name="eye" size={15} />{todas ? "Ocultar Claves" : "Ver Claves"}
                  </button>}
                  {puede("claves.exportar") && <button className="btn sm" onClick={exportar} title="Exportar a Excel"><Icon name="down" size={15} />Exportar Excel</button>}
                  <button className="btn sm" onClick={load} title="Refrescar"><Icon name="refresh" size={15} />Refrescar</button>
                </span>
              </>}
              actions={puede("claves.eliminar") ? (r) => (
                <button className="act-btn del" title="Eliminar clave" onClick={() => borrar(r)}><Icon name="trash" size={14} /></button>
              ) : undefined} />}
      </div>
      <div className="gframe-foot">
        {activas.length} registro{activas.length === 1 ? "" : "s"}
        {(quick || "") && <><span className="gf-dot">·</span> {filtered.length} en vista</>}
        {actualizado && <><span className="gf-dot">·</span> Actualizado: {actualizado}</>}
      </div>
    </div>
  );
}
