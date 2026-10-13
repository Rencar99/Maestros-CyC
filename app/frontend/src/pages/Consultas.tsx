import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Icon, norm, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";

/** Constructor de consultas: tablas → campos → filtros → resultados.
 *  El SQL lo arma el servidor a partir de esta selección; aquí nunca se
 *  escribe SQL a mano (ver backend `routers/consultas.py`). */

interface TablaInfo { nombre: string; etiqueta: string; campos: number; filas: number | null }
interface CampoInfo {
  nombre: string; etiqueta: string; tipo: string; nulo: boolean; pk: boolean;
  operadores: string[];
}
interface RelInfo { clave: string; etiqueta: string; tabla: string; tabla_etiqueta: string; campos: CampoInfo[] }
interface Opcion { ref: string; label: string; sub: string; tipo: string; operadores: string[]; pk: boolean; grupo: string }
interface FiltroUI { uid: number; campo: string; op: string; valor: string; valor2: string }
interface Resultado {
  sql: string; columnas: CampoInfo[]; filas: Record<string, any>[];
  total: number; truncado: boolean; limite: number;
}

const OP_LBL: Record<string, string> = {
  "=": "es igual a", "!=": "es distinto de", contiene: "contiene",
  empieza: "empieza por", termina: "termina en", ">": "mayor que",
  ">=": "mayor o igual que", "<": "menor que", "<=": "menor o igual que",
  entre: "está entre", vacio: "está vacío", novacio: "tiene dato",
};
const SIN_VALOR = new Set(["vacio", "novacio"]);
const NUMERICOS = new Set(["entero", "decimal"]);
const FECHAS = new Set(["fecha", "fecha y hora"]);

/** Presentación de una celda del resultado según el tipo del campo. */
function pinta(v: any, tipo: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (tipo === "booleano") return v === true || v === "true" || v === 1 ? "Sí" : "No";
  if (FECHAS.has(tipo)) {
    // Postgres devuelve ISO con "T"; SQLite, con espacio. Se aceptan ambos.
    const s = String(v).replace(" ", "T");
    const [f, h] = s.split("T");
    const p = f.split("-");
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}` + (tipo === "fecha y hora" && h ? ` ${h.slice(0, 5)}` : "");
    return s;
  }
  if (NUMERICOS.has(tipo)) return Number(v).toLocaleString("es-CO");
  return String(v);
}

interface GuardadaInfo { id: number; nombre: string; creado_por: string; actualizado_at: string | null }
interface RolItem { id: number; nombre: string; sistema: boolean; activo: boolean }

export function Consultas() {
  const toast = useToast();
  const confirmar = useConfirm();
  const [tablas, setTablas] = useState<TablaInfo[]>([]);
  const [guardadas, setGuardadas] = useState<GuardadaInfo[]>([]);
  const [selGuardada, setSelGuardada] = useState("");
  const [nombreGuardar, setNombreGuardar] = useState("");
  const [tabla, setTabla] = useState("");
  const [campos, setCampos] = useState<CampoInfo[]>([]);
  const [relaciones, setRelaciones] = useState<RelInfo[]>([]);   // relaciones N:1 disponibles
  const [joins, setJoins] = useState<string[]>([]);              // relaciones incluidas (claves)
  const [sel, setSel] = useState<string[]>([]);          // campos elegidos (refs), en orden
  const [alias, setAlias] = useState<Record<string, string>>({});  // campo -> nombre de columna
  const [maxlen, setMaxlen] = useState<Record<string, string>>({}); // campo -> máx. caracteres a mostrar
  const [filtros, setFiltros] = useState<FiltroUI[]>([]);
  const [union, setUnion] = useState<"y" | "o">("y");
  const [orden, setOrden] = useState("");
  const [ordenDesc, setOrdenDesc] = useState(false);
  const [limite, setLimite] = useState(500);
  const [res, setRes] = useState<Resultado | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [vista, setVista] = useState<"config" | "resultado">("config");
  const [qTabla, setQTabla] = useState("");
  const [qCampo, setQCampo] = useState("");
  const uid = useRef(1);
  // Diálogo de guardar: descripción, alcance de filas y roles con acceso.
  const [showGuardar, setShowGuardar] = useState(false);
  const [descGuardar, setDescGuardar] = useState("");
  const [alcanceGuardar, setAlcanceGuardar] = useState<"asignados" | "firma">("asignados");
  const [rolesGuardar, setRolesGuardar] = useState<number[]>([]);
  const [rolesDisp, setRolesDisp] = useState<RolItem[]>([]);
  // Renombrar una consulta guardada (solo el nombre).
  const [renombrando, setRenombrando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");

  useEffect(() => {
    api.get("/consultas/tablas")
      .then((t: TablaInfo[]) => setTablas(t))
      .catch((e: any) => toast(e.message, true));
    api.get("/roles").then((r: RolItem[]) => setRolesDisp(r)).catch(() => {});
    cargarGuardadas();
  }, []); // eslint-disable-line

  const cargarGuardadas = () =>
    api.get("/consultas/guardadas").then((g: GuardadaInfo[]) => setGuardadas(g)).catch(() => {});

  // Definición completa del armador (para guardar y restaurar la consulta).
  const definicionActual = () => ({
    tabla, joins, campos: sel, alias, maxlen, union, orden, orden_desc: ordenDesc, limite,
    filtros: filtros.map((f) => ({ campo: f.campo, op: f.op, valor: f.valor, valor2: f.valor2 })),
  });

  const cargarGuardada = async (id: string) => {
    setSelGuardada(id);
    if (!id) return;
    try {
      const g = await api.get(`/consultas/guardadas/${id}`);
      const d = g.definicion || {};
      if (!d.tabla) { toast("La consulta guardada está vacía", true); return; }
      const [cs, rs]: [CampoInfo[], RelInfo[]] = await Promise.all([
        api.get(`/consultas/tablas/${d.tabla}/campos`),
        api.get(`/consultas/tablas/${d.tabla}/relaciones`).catch(() => []),
      ]);
      setTabla(d.tabla); setCampos(cs); setRelaciones(rs); setJoins(d.joins || []);
      setSel(d.campos || []); setAlias(d.alias || {}); setMaxlen(d.maxlen || {});
      setUnion(d.union === "o" ? "o" : "y"); setOrden(d.orden || ""); setOrdenDesc(!!d.orden_desc);
      setLimite(d.limite || 500);
      setFiltros((d.filtros || []).map((f: any) => ({ uid: uid.current++, campo: f.campo, op: f.op, valor: f.valor || "", valor2: f.valor2 || "" })));
      // Compartir: descripción, alcance y roles guardados con la consulta.
      setNombreGuardar(g.nombre || "");
      setDescGuardar(g.descripcion || "");
      setAlcanceGuardar(g.alcance === "firma" ? "firma" : "asignados");
      setRolesGuardar(g.roles || []);
      setRes(null); setVista("config"); setQCampo("");
      toast(`Consulta «${g.nombre}» cargada. Pulsa Ejecutar.`);
    } catch (e: any) { toast(e.message, true); }
  };

  // Abre el diálogo de guardar (prellena nombre con la consulta cargada, si hay).
  const abrirGuardar = () => {
    if (!tabla) { toast("Arma una consulta primero", true); return; }
    setShowGuardar(true);
  };

  const guardarConsulta = async () => {
    const nombre = nombreGuardar.trim();
    if (!nombre) { toast("Escribe un nombre para la consulta", true); return; }
    try {
      const r = await api.post("/consultas/guardadas", {
        nombre, definicion: definicionActual(), descripcion: descGuardar.trim(),
        alcance: alcanceGuardar, roles: rolesGuardar,
      });
      toast(`Consulta «${nombre}» guardada ✓`);
      setShowGuardar(false);
      await cargarGuardadas();
      setSelGuardada(String(r.id));
    } catch (e: any) { toast(e.message, true); }
  };

  const toggleRolGuardar = (id: number) =>
    setRolesGuardar((rs) => rs.includes(id) ? rs.filter((x) => x !== id) : [...rs, id]);

  const abrirRenombrar = () => {
    const g = guardadas.find((x) => String(x.id) === selGuardada);
    if (!g) return;
    setNuevoNombre(g.nombre);
    setRenombrando(true);
  };

  const confirmarRenombrar = async () => {
    const nombre = nuevoNombre.trim();
    if (!nombre) { toast("Escribe un nombre", true); return; }
    try {
      const r = await api.put(`/consultas/guardadas/${selGuardada}/nombre`, { nombre });
      toast("Nombre actualizado ✓");
      setRenombrando(false);
      await cargarGuardadas();
      setSelGuardada(String(r.id));
      if (nombreGuardar) setNombreGuardar(nombre);
    } catch (e: any) { toast(e.message, true); }
  };

  const borrarGuardada = async () => {
    if (!selGuardada) return;
    const g = guardadas.find((x) => String(x.id) === selGuardada);
    if ((await confirmar({ titulo: "Eliminar consulta guardada", mensaje: `Se eliminará «${g?.nombre}». Esta acción no se puede deshacer.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try {
      await api.del(`/consultas/guardadas/${selGuardada}`);
      setSelGuardada(""); await cargarGuardadas(); toast("Consulta eliminada");
    } catch (e: any) { toast(e.message, true); }
  };

  const elegirTabla = (t: string) => {
    if (t === tabla) return;
    setTabla(t); setCampos([]); setRelaciones([]); setJoins([]); setSel([]); setAlias({}); setMaxlen({}); setFiltros([]);
    setOrden(""); setOrdenDesc(false); setRes(null); setQCampo("");
    api.get(`/consultas/tablas/${t}/campos`).then((cs: CampoInfo[]) => setCampos(cs)).catch((e: any) => toast(e.message, true));
    api.get(`/consultas/tablas/${t}/relaciones`).then((rs: RelInfo[]) => setRelaciones(rs)).catch(() => {});
  };

  // Opciones de campo unificadas: base + campos de las relaciones incluidas.
  const opciones = useMemo<Opcion[]>(() => {
    const out: Opcion[] = campos.map((c) => ({ ref: c.nombre, label: c.etiqueta, sub: c.nombre, tipo: c.tipo, operadores: c.operadores, pk: c.pk, grupo: "" }));
    for (const clave of joins) {
      const r = relaciones.find((x) => x.clave === clave);
      if (!r) continue;
      for (const c of r.campos)
        out.push({ ref: `${clave}.${c.nombre}`, label: c.etiqueta, sub: `${r.etiqueta} · ${c.nombre}`, tipo: c.tipo, operadores: c.operadores, pk: false, grupo: r.etiqueta });
    }
    return out;
  }, [campos, relaciones, joins]);

  const porRef = useMemo(() => {
    const m: Record<string, Opcion> = {};
    opciones.forEach((o) => { m[o.ref] = o; });
    return m;
  }, [opciones]);

  const toggleCampo = (ref: string) => {
    const quitando = sel.includes(ref);
    setSel((s) => quitando ? s.filter((x) => x !== ref) : [...s, ref]);
    if (quitando) {   // al desmarcar, se limpia su nombre de columna y su máx.
      setAlias((a) => { const n = { ...a }; delete n[ref]; return n; });
      setMaxlen((m) => { const n = { ...m }; delete n[ref]; return n; });
    }
  };

  const toggleJoin = (clave: string) => {
    if (joins.includes(clave)) {
      const pref = clave + ".";
      const quita = (x: string) => x === clave || x.startsWith(pref);
      setJoins((j) => j.filter((x) => x !== clave));
      setSel((s) => s.filter((x) => !x.startsWith(pref)));
      setFiltros((fs) => fs.filter((f) => !f.campo.startsWith(pref)));
      setOrden((o) => (o.startsWith(pref) ? "" : o));
      setAlias((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith(pref))));
      setMaxlen((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(pref))));
      void quita;
    } else {
      setJoins((j) => [...j, clave]);
    }
  };

  const tablasVis = useMemo(() => {
    const q = norm(qTabla);
    return q ? tablas.filter((t) => norm(t.etiqueta + " " + t.nombre).includes(q)) : tablas;
  }, [tablas, qTabla]);

  const opcionesVis = useMemo(() => {
    const q = norm(qCampo);
    return q ? opciones.filter((o) => norm(o.label + " " + o.sub).includes(q)) : opciones;
  }, [opciones, qCampo]);

  // ---- Filtros --------------------------------------------------------------
  const agregarFiltro = () => {
    const o = opciones[0];
    if (!o) return;
    setFiltros((f) => [...f, { uid: uid.current++, campo: o.ref, op: o.operadores[0], valor: "", valor2: "" }]);
  };
  const cambiarFiltro = (u: number, cambio: Partial<FiltroUI>) =>
    setFiltros((fs) => fs.map((f) => {
      if (f.uid !== u) return f;
      const n = { ...f, ...cambio };
      if (cambio.campo) {                       // el operador debe existir en el campo nuevo
        const ops = porRef[cambio.campo]?.operadores || [];
        if (!ops.includes(n.op)) n.op = ops[0] || "=";
        n.valor = ""; n.valor2 = "";
      }
      return n;
    }));
  const quitarFiltro = (u: number) => setFiltros((fs) => fs.filter((f) => f.uid !== u));

  // ---- Ejecutar / exportar --------------------------------------------------
  const cuerpo = () => ({
    tabla, joins, campos: sel, union, orden, orden_desc: ordenDesc, limite,
    alias: Object.fromEntries(sel.filter((n) => (alias[n] || "").trim()).map((n) => [n, alias[n].trim()])),
    filtros: filtros
      .filter((f) => SIN_VALOR.has(f.op) || f.valor !== "" || f.op === "entre")
      .map((f) => ({ campo: f.campo, op: f.op, valor: f.valor, valor2: f.valor2 })),
  });

  const ejecutar = () => {
    if (!tabla) { toast("Elige una tabla primero", true); return; }
    setCorriendo(true);
    api.post("/consultas/ejecutar", cuerpo())
      .then((r: Resultado) => {
        // __i: llave estable de fila para la grilla (el resultado no tiene id fijo).
        setRes({ ...r, filas: r.filas.map((f, i) => ({ ...f, __i: i })) });
        setVista("resultado");     // salta a la pestaña de resultado
        toast(r.total === 0 ? "Sin resultados" : `${r.total} fila${r.total === 1 ? "" : "s"} ✓`);
      })
      .catch((e: any) => { setRes(null); toast(e.message, true); })
      .finally(() => setCorriendo(false));
  };

  const exportar = () => {
    if (!tabla) return;
    api.downloadPost("/consultas/exportar", cuerpo(), `Consulta_${tabla}.xlsx`)
      .catch((e: any) => toast(e.message, true));
  };

  const limpiar = () => {
    setJoins([]); setSel([]); setAlias({}); setMaxlen({}); setFiltros([]); setOrden(""); setOrdenDesc(false); setRes(null);
  };

  const enterEjecuta = (e: React.KeyboardEvent) => { if (e.key === "Enter") ejecutar(); };

  // ---- Columnas de la grilla de resultados ---------------------------------
  const colsRes: Column<Record<string, any>>[] = useMemo(() => {
    if (!res) return [];
    return res.columnas.map((c) => ({
      key: c.nombre,
      label: c.etiqueta,
      sortable: true,
      filterable: true,
      align: NUMERICOS.has(c.tipo) ? "right" : FECHAS.has(c.tipo) || c.tipo === "booleano" ? "center" : "left",
      width: ((maxlen[(c as any).ref ?? c.nombre]) ? `${maxlen[(c as any).ref ?? c.nombre]}ch` : (c.tipo === "texto" ? "32ch" : undefined)),
      value: (r) => {
        const v = r[c.nombre];
        if (v === null || v === undefined) return "";
        return NUMERICOS.has(c.tipo) ? Number(v) : String(v);
      },
      formatter: (_v, r) => pinta(r[c.nombre], c.tipo),
    }));
  }, [res, maxlen]);

  const tablaSel = tablas.find((t) => t.nombre === tabla);

  return (
    <div className="cons cons-tabbed">
      <div className="segtabs">
        <button className={vista === "config" ? "on" : ""} onClick={() => setVista("config")}>Configurar consulta</button>
        <button className={vista === "resultado" ? "on" : ""} onClick={() => res && setVista("resultado")} disabled={!res}>
          Resultado{res ? ` · ${res.total}` : ""}
        </button>
      </div>

      {vista === "config" && (
      <>
      <div className="cons-saved">
        <Icon name="save" size={15} />
        <select value={selGuardada} onChange={(e) => cargarGuardada(e.target.value)} title="Cargar una consulta guardada">
          <option value="">— Consultas guardadas —</option>
          {guardadas.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
        </select>
        <button className="act-btn" disabled={!selGuardada} title="Renombrar la consulta guardada" onClick={abrirRenombrar}><Icon name="edit" size={15} /></button>
        <button className="act-btn del" disabled={!selGuardada} title="Eliminar la consulta guardada" onClick={borrarGuardada}><Icon name="trash" size={15} /></button>
        <span className="cons-saved-sep" />
        <input placeholder="Nombre para guardar esta consulta…" value={nombreGuardar}
               onChange={(e) => setNombreGuardar(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") abrirGuardar(); }} />
        <button className="btn sm" onClick={abrirGuardar} disabled={!tabla}><Icon name="save" size={14} />Guardar…</button>
      </div>
      <div className="cons-tabsel">
        <label>Tabla base</label>
        <select value={tabla} onChange={(e) => elegirTabla(e.target.value)} title="Elige la tabla sobre la que armas la consulta">
          {!tabla && <option value="">Elige una tabla…</option>}
          {tablas.map((t) => (
            <option key={t.nombre} value={t.nombre}>{t.etiqueta}{t.filas != null ? ` · ${t.filas}` : ""}</option>
          ))}
        </select>
        <span className="hint">{tablas.length} disponibles</span>
      </div>
      <div className="cons-top cons-top-2">
        {/* ---------------------------------------------------- Campos */}
        <div className="card cons-p cons-campos">
          <div className="card-h">
            <div><h3>Campos</h3>
              <div className="hint">{tablaSel ? tablaSel.etiqueta : "Elige una tabla arriba"}</div></div>
            <div className="r">
              <button className="btn sm ghost" disabled={!opciones.length}
                      onClick={() => setSel(opciones.map((o) => o.ref))}>Todos</button>
              <button className="btn sm ghost" disabled={!sel.length} onClick={() => setSel([])}>Ninguno</button>
            </div>
          </div>
          <div className="cons-tools">
            <div className="search sm"><Icon name="search" size={14} />
              <input placeholder="Buscar campo…" value={qCampo} disabled={!campos.length}
                     onChange={(e) => setQCampo(e.target.value)} /></div>
          </div>
          {tabla && opcionesVis.length > 0 && (
            <div className="cons-camps-hd"><span /><span>Campo</span><span>Nombre de la columna</span><span className="ci-max-h">Ancho Col</span></div>
          )}
          <div className="cons-list">
            {!tabla && <div className="cons-vacio">Elige una tabla arriba para ver sus campos.</div>}
            {tabla && opcionesVis.map((o) => {
              const on = sel.includes(o.ref);
              return (
              <div key={o.ref} className={"cons-it chk" + (on ? " on" : "")} title={o.ref}>
                <input type="checkbox" checked={on} onChange={() => toggleCampo(o.ref)} />
                <span className="ci-txt" onClick={() => toggleCampo(o.ref)} style={{ cursor: "pointer" }} title={o.sub}>
                  <span className="ci-lbl">{o.grupo && <span className="ci-rel" title={o.grupo}>{o.grupo}</span>}{o.label}{o.pk && <span className="ci-pk" title="Llave primaria">llave</span>}</span>
                </span>
                <span className="ci-tipo">{o.tipo}</span>
                <input className="ci-alias" value={alias[o.ref] || ""} disabled={!on}
                       placeholder={on ? o.label : ""} title="Nombre de la columna en la consulta"
                       onChange={(e) => setAlias((a) => ({ ...a, [o.ref]: e.target.value }))} />
                <input className="ci-max" type="number" min={1} max={200} value={maxlen[o.ref] || ""} disabled={!on}
                       placeholder="—" title="Máx. de caracteres a mostrar en la columna (vacío = automático)"
                       onChange={(e) => setMaxlen((m) => ({ ...m, [o.ref]: e.target.value.replace(/\D/g, "") }))} />
              </div>
            ); })}
            {tabla && opciones.length > 0 && opcionesVis.length === 0 && <div className="cons-vacio">Ningún campo coincide.</div>}
          </div>
        </div>

        {/* ---------------------------------------------------- 3. Consulta */}
        <div className="card cons-p cons-arma">
          <div className="card-h">
            <div><h3>Consulta</h3>
              <div className="hint">{sel.length ? `${sel.length} campo${sel.length === 1 ? "" : "s"} elegido${sel.length === 1 ? "" : "s"}` : "Sin campos: se traen todos"}</div></div>
            <div className="r">
              <button className="btn sm ghost" onClick={limpiar} disabled={!tabla}><Icon name="broom" size={14} />Limpiar</button>
            </div>
          </div>

          <div className="cons-arma-body">
            {!tabla ? (
              <div className="cons-vacio">Elige una tabla y marca los campos que quieres ver.</div>
            ) : (
              <>
                {relaciones.length > 0 && (
                  <>
                    <div className="cons-sec">
                      <div className="cons-sec-t" title="Une la tabla de Responsables/Software para traer sus columnas (1 fila por cliente)">Relaciones (JOIN)</div>
                      <div className="cons-rels-in">
                        {relaciones.map((r) => (
                          <button key={r.clave} className={"cons-rel-chip" + (joins.includes(r.clave) ? " on" : "")}
                                  onClick={() => toggleJoin(r.clave)} title={`Datos de ${r.tabla_etiqueta}`}>
                            <Icon name={joins.includes(r.clave) ? "check" : "plus"} size={12} />{r.etiqueta}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="cons-sep" />
                  </>
                )}

                <div className="cons-sec">
                  <div className="cons-sec-t">Campos a mostrar</div>
                  {sel.length === 0
                    ? <div className="cons-nota">No marcaste ninguno: la consulta traerá todos los campos de la tabla.</div>
                    : <div className="cons-chips">
                        {sel.map((n) => (
                          <span key={n} className="chip">{porRef[n] ? (porRef[n].grupo ? porRef[n].grupo + " · " : "") + porRef[n].label : n}
                            <button className="chip-x" title="Quitar" onClick={() => toggleCampo(n)}>✕</button></span>
                        ))}
                      </div>}
                </div>

                <div className="cons-sec">
                  <div className="cons-sec-t">
                    Filtros
                    {filtros.length > 1 && (
                      <span className="cons-union">
                        <button className={union === "y" ? "on" : ""} onClick={() => setUnion("y")}>Cumplen TODOS</button>
                        <button className={union === "o" ? "on" : ""} onClick={() => setUnion("o")}>Cumplen ALGUNO</button>
                      </span>
                    )}
                  </div>
                  {filtros.map((f) => {
                    const meta = porRef[f.campo];
                    const tipo = meta?.tipo || "texto";
                    const inputTipo = FECHAS.has(tipo) ? "date" : NUMERICOS.has(tipo) ? "number" : "text";
                    return (
                      <div key={f.uid} className="cons-filtro">
                        <select value={f.campo} onChange={(e) => cambiarFiltro(f.uid, { campo: e.target.value })}>
                          {opciones.map((o) => <option key={o.ref} value={o.ref}>{(o.grupo ? o.grupo + " · " : "") + o.label}</option>)}
                        </select>
                        <select value={f.op} onChange={(e) => cambiarFiltro(f.uid, { op: e.target.value })}>
                          {(meta?.operadores || []).map((o) => <option key={o} value={o}>{OP_LBL[o] || o}</option>)}
                        </select>
                        {SIN_VALOR.has(f.op) ? <span className="cons-nv">—</span> : tipo === "booleano" ? (
                          <select value={f.valor} onChange={(e) => cambiarFiltro(f.uid, { valor: e.target.value })}>
                            <option value="">…</option><option value="si">Sí</option><option value="no">No</option>
                          </select>
                        ) : (
                          <input type={inputTipo} value={f.valor} onKeyDown={enterEjecuta}
                                 placeholder="valor" onChange={(e) => cambiarFiltro(f.uid, { valor: e.target.value })} />
                        )}
                        {f.op === "entre" && (
                          <input type={inputTipo} value={f.valor2} onKeyDown={enterEjecuta}
                                 placeholder="hasta" onChange={(e) => cambiarFiltro(f.uid, { valor2: e.target.value })} />
                        )}
                        <button className="act-btn del" title="Quitar filtro" onClick={() => quitarFiltro(f.uid)}>
                          <Icon name="trash" size={14} /></button>
                      </div>
                    );
                  })}
                  <button className="btn sm ghost" onClick={agregarFiltro} disabled={!opciones.length}>
                    <Icon name="plus" size={14} />Agregar filtro</button>
                </div>

                <div className="cons-sec cons-opts">
                  <label>Ordenar por
                    <select value={orden} onChange={(e) => setOrden(e.target.value)}>
                      <option value="">(sin orden)</option>
                      {opciones.map((o) => <option key={o.ref} value={o.ref}>{(o.grupo ? o.grupo + " · " : "") + o.label}</option>)}
                    </select>
                  </label>
                  <button className="btn sm" disabled={!orden} onClick={() => setOrdenDesc((d) => !d)}
                          title="Cambiar el sentido del orden">{ordenDesc ? "▼ Descendente" : "▲ Ascendente"}</button>
                  <label>Máximo de filas
                    <input type="number" min={1} max={5000} value={limite} onKeyDown={enterEjecuta}
                           onChange={(e) => setLimite(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))} />
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="cons-foot">
            <button className="btn primary" onClick={ejecutar} disabled={!tabla || corriendo}>
              <Icon name="check" size={15} />{corriendo ? "Consultando…" : "Ejecutar"}</button>
            <button className="btn" onClick={exportar} disabled={!tabla || corriendo}>
              <Icon name="down" size={15} />Exportar Excel</button>
          </div>
        </div>
      </div>
      </>
      )}

      {/* ---------------------------------------------------- Resultado */}
      {vista === "resultado" && (
      <div className="card cons-res">
        <div className="card-h">
          <div><h3>Resultado de la consulta</h3>
            <div className="hint">
              {res ? `${res.total} fila${res.total === 1 ? "" : "s"}${res.truncado ? ` (tope de ${res.limite}; puede haber más)` : ""}`
                   : "Arma la consulta y pulsa Ejecutar."}</div></div>
          <div className="r">
            <button className="btn sm" onClick={() => setVista("config")}><Icon name="gear" size={14} />Volver a configurar</button>
            <button className="btn sm" onClick={exportar} disabled={!tabla || corriendo}><Icon name="down" size={14} />Exportar Excel</button>
          </div>
        </div>
        {res
          ? <DataGrid columns={colsRes} rows={res.filas} getKey={(r) => r.__i}
                      label="Resultados de la consulta" scrollClass="cons-scroll"
                      emptyLabel="La consulta no devolvió filas." />
          : <div className="grid-empty" style={{ padding: 22 }}>Sin consulta ejecutada todavía.</div>}
      </div>
      )}

      {renombrando && (
        <Modal title="Renombrar consulta" icon="edit" size="md" onClose={() => setRenombrando(false)}
               onSave={confirmarRenombrar}>
          <div className="cq-form">
            <label className="cq-fld">
              <span>Nombre</span>
              <input value={nuevoNombre} autoFocus onChange={(e) => setNuevoNombre(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") confirmarRenombrar(); }}
                     placeholder="Nombre de la consulta" />
            </label>
          </div>
        </Modal>
      )}

      {showGuardar && (
        <Modal title="Guardar consulta" icon="save" size="md" onClose={() => setShowGuardar(false)}
               onSave={guardarConsulta}>
          <div className="cq-form">
            <label className="cq-fld">
              <span>Nombre</span>
              <input value={nombreGuardar} onChange={(e) => setNombreGuardar(e.target.value)}
                     placeholder="Nombre de la consulta" autoFocus />
            </label>
            <label className="cq-fld">
              <span>Descripción</span>
              <textarea value={descGuardar} rows={2} onChange={(e) => setDescGuardar(e.target.value)}
                        placeholder="Breve descripción (opcional)" />
            </label>
            <div className="cq-fld">
              <span>Roles que pueden verla</span>
              <div className="cq-roles">
                {rolesDisp.filter((r) => r.activo).map((r) => {
                  const locked = r.sistema;
                  const on = locked || rolesGuardar.includes(r.id);
                  return (
                    <button key={r.id} type="button"
                            className={"cq-rol" + (on ? " on" : "") + (locked ? " lock" : "")}
                            onClick={() => !locked && toggleRolGuardar(r.id)}
                            title={locked ? "El Super Usuario siempre puede" : ""}>
                      <span className="cq-bx">{on && <Icon name="check" size={11} />}</span>{r.nombre}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="cq-fld">
              <span>Alcance de las filas</span>
              <div className="cq-seg">
                <button type="button" className={alcanceGuardar === "asignados" ? "on" : ""}
                        onClick={() => setAlcanceGuardar("asignados")}><Icon name="user" size={15} />Solo mis asignados</button>
                <button type="button" className={alcanceGuardar === "firma" ? "on" : ""}
                        onClick={() => setAlcanceGuardar("firma")}><Icon name="resp" size={15} />Toda la firma</button>
              </div>
            </div>
            <div className="cq-note">
              <Icon name="alert" size={15} />
              {alcanceGuardar === "asignados"
                ? "Cada consumidor verá únicamente los clientes que tiene asignados."
                : "Quien tenga acceso verá todas las filas de la firma."}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
