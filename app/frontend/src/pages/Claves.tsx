import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";

/** Listado GLOBAL de claves de clientes en portales (Grilla CyC).
 *  Cada usuario ve las de sus clientes asignados; Admin/Super las ven todas.
 *  La clave va oculta (••••) con botón de revelar y copiar por fila. */
interface ClaveRow {
  id: number; cliente_id: number; num_id: string; cliente: string; estado: string; tipo: string;
  portal: string; usuario: string; comentario: string; url: string;
  tiene_clave: boolean; actualizado_at: string | null;
}

export function Claves({ esSuper, puede, active = true }: { esSuper: boolean; puede: (c: string) => boolean; active?: boolean }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [rows, setRows] = useState<ClaveRow[]>([]);
  const [reveladas, setReveladas] = useState<Record<number, string>>({});
  const [todas, setTodas] = useState(false);      // ¿toda la columna revelada?
  const [cargando, setCargando] = useState(false);
  const [tip, setTip] = useState<{ t: string; x: number; y: number } | null>(null);
  const [quick, setQuick] = useState("");         // filtro rápido: act/ina/jur/nat
  const [actualizado, setActualizado] = useState("");

  const load = () => {
    setCargando(true); setReveladas({}); setTodas(false);
    api.get("/clientes/claves/todas")
      .then((r: ClaveRow[]) => { setRows(r); setActualizado(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })); })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  // La App mantiene las páginas montadas (display:none); re-leer al volver a entrar.
  useEffect(() => { if (active) load(); }, [active]); // eslint-disable-line

  const revelar = async (r: ClaveRow) => {
    if (reveladas[r.id] !== undefined) {   // ya visible → ocultar
      setReveladas((x) => { const n = { ...x }; delete n[r.id]; return n; });
      return;
    }
    try {
      const res: any = await api.get(`/clientes/claves/${r.id}/revelar`);
      setReveladas((x) => ({ ...x, [r.id]: res.clave || "" }));
    } catch (e: any) { toast(e.message, true); }
  };

  const verTodas = async () => {
    if (todas) { setReveladas({}); setTodas(false); return; }  // ocultar todas
    try {
      const res: any[] = await api.get("/clientes/claves/reveladas");
      const m: Record<number, string> = {};
      res.forEach((x) => { m[x.id] = x.clave || ""; });
      setReveladas(m); setTodas(true);
    } catch (e: any) { toast(e.message, true); }
  };

  const exportar = () =>
    api.download("/clientes/claves/exportar", "Claves_clientes.xlsx").catch((e: any) => toast(e.message, true));

  const copiar = (txt: string) => { navigator.clipboard?.writeText(txt); toast("Copiado ✓"); };

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

  // Tooltip (azul) para usuarios que no caben en la columna.
  const onUserEnter = (e: { currentTarget: HTMLElement }, txt: string) => {
    const el = e.currentTarget;
    if (el.scrollWidth > el.clientWidth + 1) {
      const b = el.getBoundingClientRect();
      setTip({ t: txt, x: b.left, y: b.bottom + 5 });
    }
  };

  const filtered = useMemo(() => {
    // La búsqueda por texto ahora la hace el buscador global de la grilla (todas las columnas).
    // Aquí solo quedan los filtros rápidos (chips).
    return rows.filter((r) => {
      if (quick === "act" && r.estado !== "Act") return false;
      if (quick === "ina" && r.estado !== "Ina") return false;
      if (quick === "jur" && r.tipo !== "Jur") return false;
      if (quick === "nat" && r.tipo !== "Nat") return false;
      return true;
    });
  }, [rows, quick]);

  const qfiltros = [
    { k: "", lbl: "Todas", n: rows.length },
    { k: "act", lbl: "Activos", n: rows.filter((r) => r.estado === "Act").length },
    { k: "ina", lbl: "Inactivos", n: rows.filter((r) => r.estado === "Ina").length },
    { k: "jur", lbl: "Jurídicas", n: rows.filter((r) => r.tipo === "Jur").length },
    { k: "nat", lbl: "Naturales", n: rows.filter((r) => r.tipo === "Nat").length },
  ];

  const cols: Column<ClaveRow>[] = [
    { key: "num_id", label: "Id", type: "code", sortable: true, width: "12ch", value: (r) => r.num_id || "", render: (r) => <span className="mono">{r.num_id || "—"}</span> },
    { key: "cliente", label: "Cliente", sortable: true, filterable: true, className: "cli-full", value: (r) => r.cliente || "" },
    { key: "estado", label: "Estado", type: "status", filterable: true, width: "9ch", value: (r) => (r.estado === "Act" ? "Activo" : r.estado === "Ina" ? "Inactivo" : "—"), render: (r) => r.estado === "Act" ? <span className="tag act">Activo</span> : r.estado === "Ina" ? <span className="tag ina">Inactivo</span> : <span style={{ color: "var(--ink-3)" }}>—</span> },
    { key: "tipo", label: "Tipo", type: "status", filterable: true, width: "7ch", value: (r) => r.tipo || "—", render: (r) => r.tipo ? <span className={"tag " + (r.tipo === "Jur" ? "jur" : "nat")}>{r.tipo}</span> : <span style={{ color: "var(--ink-3)" }}>—</span> },
    { key: "portal", label: "Portal", align: "left", sortable: true, filterable: true, width: "20ch", value: (r) => r.portal || "—", render: (r) => r.portal ? <span className="tag int">{r.portal}</span> : <span className="tag ina">—</span> },
    { key: "url", label: "URL", align: "left", sortable: true, filterable: true, width: "24ch", value: (r) => r.url || "", render: (r) => r.url
        ? <a href={/^https?:\/\//i.test(r.url) ? r.url : "https://" + r.url} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()} style={{ color: "var(--primary)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url}>{r.url}</a>
        : <span style={{ color: "var(--ink-3)" }}>—</span> },
    {
      key: "usuario", label: "Usuario", sortable: true, filterable: true, width: "20ch", value: (r) => r.usuario || "",
      render: (r) => r.usuario
        ? <span className="mono" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
            onMouseEnter={(e) => onUserEnter(e, r.usuario)} onMouseLeave={() => setTip(null)}
            onMouseDown={(e) => e.stopPropagation()} onClick={() => copiar(r.usuario)}>{r.usuario}</span>
        : <span style={{ color: "var(--ink-3)" }}>—</span>,
    },
    { key: "comentario", label: "Comentario", filterable: true, width: "30ch", value: (r) => r.comentario || "" },
    {
      key: "clave", label: "Clave", align: "left", width: "26ch", value: (r) => (r.tiene_clave ? "1" : "0"),
      render: (r) => r.tiene_clave ? (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", letterSpacing: reveladas[r.id] !== undefined ? 0 : 2 }}>
            {reveladas[r.id] !== undefined ? (reveladas[r.id] || "(vacía)") : "••••••••"}
          </span>
          <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
            {puede("claves.revelar") && <button type="button" className="act-btn" title={reveladas[r.id] !== undefined ? "Ocultar" : "Ver"} onMouseDown={(e) => e.stopPropagation()} onClick={() => revelar(r)}><Icon name="eye" size={14} /></button>}
            {reveladas[r.id] ? <button type="button" className="act-btn" title="Copiar clave" onMouseDown={(e) => e.stopPropagation()} onClick={() => copiar(reveladas[r.id])}><Icon name="copy" size={14} /></button> : null}
          </span>
        </span>
      ) : <span className="tag ina">sin clave</span>,
    },
  ];

  return (
    <div className="card gframe gframe-sinh">
      <div className="gframe-body">
        {cargando
          ? <div className="grid-empty" style={{ padding: 20 }}>Cargando…</div>
          : <DataGrid columns={cols} rows={filtered} getKey={(r) => r.id} label="Claves de clientes"
              storageKey="claves" searchable exportable={false} fitRows emptyLabel="No hay claves para mostrar."
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
        {rows.length} registro{rows.length === 1 ? "" : "s"}
        {(quick || "") && <><span className="gf-dot">·</span> {filtered.length} en vista</>}
        {actualizado && <><span className="gf-dot">·</span> Actualizado: {actualizado}</>}
      </div>
      {tip && <div className="utip-pop" style={{ left: tip.x, top: tip.y }}>{tip.t}</div>}
    </div>
  );
}
