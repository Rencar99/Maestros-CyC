import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Icon, norm, SecTitle, useConfirm, useToast } from "../ui";

interface Rol { id: number; nombre: string; sistema: boolean; activo: boolean; n_permisos: number; n_usuarios: number; }
interface Perm { clave: string; seccion: string; accion: string; etiqueta: string; app?: string; activo?: boolean; }

const SEC: Record<string, { lbl: string; icon: string }> = {
  clientes: { lbl: "Clientes", icon: "clientes" },
  responsables: { lbl: "Responsables", icon: "resp" },
  claves: { lbl: "Claves", icon: "lock" },
  facturacion: { lbl: "Facturación", icon: "briefcase" },
  catalogos: { lbl: "Catálogos", icon: "cat" },
  consultas: { lbl: "Consultas", icon: "db" },
  config: { lbl: "Configuración", icon: "shield-check" },
  // Secciones de otras apps (auto-registro). Etiqueta/ícono amable; el chip de app
  // ya indica de quién es. Las que no estén aquí caen al nombre de la sección.
  calendario: { lbl: "Calendario", icon: "clipboard-check" },
};
const SENSIBLE = new Set(["eliminar", "revelar"]);   // acciones sensibles → color peligro
// Permisos que además definen el "rol efectivo" que leen otras apps (Calendario,
// Liquidador, Descargas DIAN): concederlos a un rol lo vuelve 'admin' allá.
const CROSS_APP = new Set(["config.roles", "responsables.editar", "catalogos.editar", "clientes.ver_todos"]);

type Mapa = Record<number, Set<string>>;
const clonar = (m: Mapa): Mapa => Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), new Set(v)]));
const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Checkbox de 3 estados (marcado / parcial / vacío). */
function Tri({ checked, partial, disabled, onChange }: { checked: boolean; partial: boolean; disabled?: boolean; onChange: () => void }) {
  const r = useRef<HTMLInputElement>(null);
  useEffect(() => { if (r.current) r.current.indeterminate = partial && !checked; }, [partial, checked]);
  return <input ref={r} type="checkbox" className="rp-chk" checked={checked} disabled={disabled} onChange={onChange} />;
}

/** Matriz usuarios × formularios: quién puede PRESENTAR borradores de cada
 *  formulario. Super siempre puede (fila atenuada). Solo Super (config.roles). */
interface MbUser { id: number; nombre: string; usuario: string; es_super: boolean; }
interface MbForm { id: number; nombre: string; codigo_calendario: string; }
const clonN = (m: Record<number, Set<number>>): Record<number, Set<number>> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), new Set(v)]));
const eqN = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((x) => b.has(x));

function MatrizBorradores({ reloadKey }: { reloadKey?: string | number }) {
  const toast = useToast();
  const [users, setUsers] = useState<MbUser[]>([]);
  const [forms, setForms] = useState<MbForm[]>([]);
  const [edit, setEdit] = useState<Record<number, Set<number>>>({});
  const [base, setBase] = useState<Record<number, Set<number>>>({});
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    try {
      const d = await api.get("/formularios/matriz");
      const m: Record<number, Set<number>> = {};
      for (const u of d.usuarios) m[u.id] = new Set<number>(d.autorizados[u.id] || []);
      setUsers(d.usuarios); setForms(d.formularios); setEdit(clonN(m)); setBase(clonN(m));
    } catch (e: any) { toast(e.message, true); }
  };
  // Re-carga al montarse y cada vez que la vista se reactiva (reloadKey), para
  // tomar formularios creados mientras esta pantalla estaba abierta.
  useEffect(() => { cargar(); }, [reloadKey]); // eslint-disable-line

  const has = (u: MbUser, fid: number) => u.es_super || (edit[u.id]?.has(fid) ?? false);
  const cambiado = (u: MbUser, fid: number) => !u.es_super && ((edit[u.id]?.has(fid) ?? false) !== (base[u.id]?.has(fid) ?? false));
  const toggle = (u: MbUser, fid: number) => {
    if (u.es_super) return;
    setEdit((m) => { const s = new Set(m[u.id]); s.has(fid) ? s.delete(fid) : s.add(fid); return { ...m, [u.id]: s }; });
  };
  const nCambios = useMemo(() => users.reduce((acc, u) => {
    if (u.es_super) return acc;
    const p = edit[u.id] || new Set<number>(), b = base[u.id] || new Set<number>();
    let n = 0; new Set([...p, ...b]).forEach((x) => { if (p.has(x) !== b.has(x)) n++; });
    return acc + n;
  }, 0), [users, edit, base]);
  const guardar = async () => {
    const dirty = users.filter((u) => !u.es_super && !eqN(edit[u.id] || new Set(), base[u.id] || new Set()));
    setGuardando(true);
    try {
      for (const u of dirty) await api.put(`/formularios/autorizados/${u.id}`, { formulario_ids: [...(edit[u.id] || [])] });
      setBase(clonN(edit)); toast(`Guardado ✓ (${nCambios} cambio${nCambios === 1 ? "" : "s"})`);
    } catch (e: any) { toast(e.message, true); cargar(); }
    finally { setGuardando(false); }
  };
  const descartar = () => setEdit(clonN(base));

  if (!forms.length) return <div className="rp-empty" style={{ padding: 24 }}>No hay formularios activos. Créalos en Catálogos → Formularios.</div>;
  return (
    <>
      <div className="rp-scroll">
        <table className="rp-mtx mb-mtx">
          <thead><tr>
            <th className="rp-hp">Usuario</th>
            {forms.map((f) => (
              <th key={f.id} className="rp-rh">
                <div className="rp-rname"><span className="rp-rn">{f.nombre}</span></div>
                {f.codigo_calendario && <div className="rp-rmeta"><span>{f.codigo_calendario}</span></div>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="rp-act">
                <td className="rp-pl">{u.nombre}{u.es_super && <span className="rp-sens">Super</span>}</td>
                {forms.map((f) => (
                  <td key={f.id} className="rp-c">
                    <span className={"rp-cell" + (cambiado(u, f.id) ? " chg" : "")}>
                      <input type="checkbox" className="rp-chk" checked={has(u, f.id)} disabled={u.es_super} onChange={() => toggle(u, f.id)} />
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            {users.length === 0 && <tr><td className="rp-empty" colSpan={forms.length + 1}>No hay usuarios internos.</td></tr>}
          </tbody>
        </table>
      </div>
      {nCambios > 0 && (
        <div className="rp-savebar">
          <span className="rp-saven"><b>{nCambios}</b> cambio{nCambios === 1 ? "" : "s"} sin guardar</span>
          <div className="rp-saveb">
            <button className="btn sm" onClick={descartar} disabled={guardando}>Descartar</button>
            <button className="btn primary sm" onClick={guardar} disabled={guardando}><Icon name="save" size={15} />{guardando ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Config → Roles y permisos: matriz roles × permisos + matriz de presentar borradores. */
export function RolesPermisos({ active = true }: { active?: boolean }) {
  const [vista, setVista] = useState<"roles" | "borradores">("roles");
  const toast = useToast();
  const confirmar = useConfirm();
  const [roles, setRoles] = useState<Rol[]>([]);
  const [cat, setCat] = useState<Perm[]>([]);
  const [perms, setPerms] = useState<Mapa>({});   // edición en curso
  const [base, setBase] = useState<Mapa>({});     // último guardado
  const [q, setQ] = useState("");
  const [colapso, setColapso] = useState<Record<string, boolean>>({});
  const colapsoInit = useRef(false);   // arrancar colapsado una sola vez
  const [creando, setCreando] = useState(false);
  const [nombreN, setNombreN] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    try {
      const rs: Rol[] = await api.get("/roles");
      const ps: Perm[] = await api.get("/roles/permisos");
      const mapa: Mapa = {};
      for (const r of rs) { const cl: string[] = await api.get(`/roles/${r.id}/permisos`); mapa[r.id] = new Set(cl); }
      setRoles(rs); setCat(ps); setPerms(clonar(mapa)); setBase(clonar(mapa));
    } catch (e: any) { toast(e.message, true); }
  };
  useEffect(() => { cargar(); }, []); // eslint-disable-line

  // Agrupar el catálogo por sección, en el orden en que viene (Maestros primero,
  // luego cada app). Cada grupo recuerda la `app` dueña (para el chip de la sección).
  const grupos = useMemo(() => {
    const g: { seccion: string; app: string; perms: Perm[] }[] = [];
    for (const p of cat) {
      let last = g[g.length - 1];
      if (!last || last.seccion !== p.seccion) { last = { seccion: p.seccion, app: p.app || "maestros", perms: [] }; g.push(last); }
      last.perms.push(p);
    }
    return g;
  }, [cat]);
  // Claves VIGENTES (no deprecadas): base de los conteos "N/total".
  const activeSet = useMemo(() => new Set(cat.filter((p) => p.activo !== false).map((p) => p.clave)), [cat]);
  const totalAct = activeSet.size;

  // Por defecto la pantalla arranca colapsada por sección (una sola vez, al
  // tener las secciones). El ref evita re-colapsar al recargar o pisar lo que
  // el usuario despliegue luego.
  useEffect(() => {
    if (colapsoInit.current || grupos.length === 0) return;
    colapsoInit.current = true;
    setColapso(Object.fromEntries(grupos.map((g) => [g.seccion, true])));
  }, [grupos]);

  const has = (r: Rol, clave: string) => r.sistema || (perms[r.id]?.has(clave) ?? false);
  const cambiado = (r: Rol, clave: string) =>
    !r.sistema && ((perms[r.id]?.has(clave) ?? false) !== (base[r.id]?.has(clave) ?? false));
  const activos = (r: Rol) => (r.sistema ? totalAct
    : [...(perms[r.id] ?? [])].filter((c) => activeSet.has(c)).length);

  const toggle = (r: Rol, clave: string) => {
    if (r.sistema) return;
    setPerms((p) => { const s = new Set(p[r.id]); s.has(clave) ? s.delete(clave) : s.add(clave); return { ...p, [r.id]: s }; });
  };
  const estadoMod = (r: Rol, claves: string[]) => {
    if (r.sistema) return { all: true, part: false };
    const n = claves.filter((c) => perms[r.id]?.has(c)).length;
    return { all: n > 0 && n === claves.length, part: n > 0 && n < claves.length };
  };
  const toggleMod = (r: Rol, claves: string[]) => {
    if (r.sistema) return;
    setPerms((p) => {
      const s = new Set(p[r.id]);
      const allIn = claves.every((c) => s.has(c));
      claves.forEach((c) => (allIn ? s.delete(c) : s.add(c)));
      return { ...p, [r.id]: s };
    });
  };

  // Cambios pendientes (nº de celdas que difieren de base).
  const nCambios = useMemo(() => roles.reduce((acc, r) => {
    if (r.sistema) return acc;
    const p = perms[r.id] || new Set<string>(), b = base[r.id] || new Set<string>();
    let n = 0; new Set([...p, ...b]).forEach((c) => { if (p.has(c) !== b.has(c)) n++; });
    return acc + n;
  }, 0), [roles, perms, base]);

  const guardar = async () => {
    const dirty = roles.filter((r) => !r.sistema && !setEq(perms[r.id] || new Set(), base[r.id] || new Set()));
    setGuardando(true);
    try {
      for (const r of dirty) await api.put(`/roles/${r.id}/permisos`, { claves: [...(perms[r.id] || [])] });
      setBase(clonar(perms));
      setRoles((rs) => rs.map((r) => (r.sistema ? r : { ...r, n_permisos: perms[r.id]?.size ?? 0 })));
      toast(`Guardado ✓ (${nCambios} cambio${nCambios === 1 ? "" : "s"})`);
    } catch (e: any) { toast(e.message, true); cargar(); }
    finally { setGuardando(false); }
  };
  const descartar = () => setPerms(clonar(base));

  const crear = async () => {
    const n = nombreN.trim(); setCreando(false); setNombreN("");
    if (!n) return;
    try {
      const r: Rol = await api.post("/roles", { nombre: n, activo: true });
      setRoles((rs) => [...rs, r]); setPerms((p) => ({ ...p, [r.id]: new Set() })); setBase((b) => ({ ...b, [r.id]: new Set() }));
      toast("Rol creado ✓");
    } catch (e: any) { toast(e.message, true); }
  };
  const renombrar = async (r: Rol, nombre: string) => {
    nombre = nombre.trim();
    if (!nombre || nombre === r.nombre) return;
    try { await api.put(`/roles/${r.id}`, { nombre, activo: r.activo }); setRoles((rs) => rs.map((x) => (x.id === r.id ? { ...x, nombre } : x))); }
    catch (e: any) { toast(e.message, true); cargar(); }
  };
  const borrarRol = async (r: Rol) => {
    if (r.n_usuarios > 0) { toast(`No se puede: ${r.n_usuarios} usuario(s) tienen este rol`, true); return; }
    const ok = await confirmar({ titulo: "Eliminar rol", mensaje: `Se eliminará el rol "${r.nombre}".`, peligro: true, confirmar: "Eliminar" });
    if (ok !== "si") return;
    try {
      await api.del(`/roles/${r.id}`);
      setRoles((rs) => rs.filter((x) => x.id !== r.id));
      setPerms((p) => { const n = { ...p }; delete n[r.id]; return n; });
      setBase((b) => { const n = { ...b }; delete n[r.id]; return n; });
      toast("Rol eliminado ✓");
    } catch (e: any) { toast(e.message, true); }
  };

  // Búsqueda: filtra por acción o sección; con búsqueda activa, todo desplegado.
  const nq = norm(q.trim());
  const gruposVis = useMemo(() => {
    if (!nq) return grupos;
    return grupos.map((g) => {
      const secMatch = norm(SEC[g.seccion]?.lbl || g.seccion).includes(nq);
      const perms = g.perms.filter((p) => secMatch || norm(p.etiqueta).includes(nq));
      return { ...g, perms };
    }).filter((g) => g.perms.length);
  }, [grupos, nq]);
  const abierto = (sec: string) => (nq ? true : !colapso[sec]);
  const todosCol = grupos.length > 0 && grupos.every((g) => colapso[g.seccion]);
  const alternarTodos = () => setColapso(todosCol ? {} : Object.fromEntries(grupos.map((g) => [g.seccion, true])));

  // Aviso al cerrar la ventana con cambios sin guardar.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (nCambios > 0) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [nCambios]);

  return (
    <div className="rp">
      <div className="rp-top">
        <div>
          <SecTitle icon="shield-check" level={2}>Roles y permisos</SecTitle>
          <div className="segtabs" style={{ marginTop: 10 }}>
            <button className={vista === "roles" ? "on" : ""} onClick={() => setVista("roles")}>Permisos por rol</button>
            <button className={vista === "borradores" ? "on" : ""} onClick={() => setVista("borradores")}>Presentar borradores</button>
          </div>
        </div>
        {vista === "roles" && <div className="rp-tools">
          <div className="search sm" style={{ width: 240 }}><Icon name="search" size={15} />
            <input placeholder="Buscar permiso…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {creando
            ? <div className="catsel-row" style={{ width: 220 }}>
                <input autoFocus placeholder="Nombre del rol" value={nombreN} style={{ flex: 1 }}
                  onChange={(e) => setNombreN(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") crear(); if (e.key === "Escape") { setCreando(false); setNombreN(""); } }} />
                <button type="button" className="icon-btn" title="Crear" onClick={crear}><Icon name="check" size={16} /></button>
                <button type="button" className="icon-btn" title="Cancelar" onClick={() => { setCreando(false); setNombreN(""); }}><Icon name="x" size={15} /></button>
              </div>
            : <button className="btn primary sm" onClick={() => setCreando(true)}><Icon name="plus" size={16} />Nuevo rol</button>}
        </div>}
      </div>

      {vista === "borradores" && <MatrizBorradores reloadKey={active ? "on" : "off"} />}
      {vista === "roles" && (<>
      <div className="rp-scroll">
        <table className="rp-mtx">
          <thead>
            <tr>
              <th className="rp-hp">
                <button className="rp-collall" onClick={alternarTodos} title={todosCol ? "Expandir todo" : "Contraer todo"} disabled={!!nq}>
                  <Icon name={todosCol ? "chevron-right" : "chevron-down"} size={14} />
                </button>Permiso
              </th>
              {roles.map((r) => (
                <th key={r.id} className="rp-rh">
                  <div className="rp-rname">
                    {r.sistema
                      ? <span className="rp-rn">{r.nombre}</span>
                      : <input className="rp-rinput" defaultValue={r.nombre} title="Renombrar"
                          onBlur={(e) => renombrar(r, e.target.value)} />}
                    {r.sistema && <Icon name="lock" size={12} />}
                  </div>
                  <div className="rp-rmeta">
                    <span>{r.n_usuarios} usu. · {activos(r)}/{totalAct}</span>
                    {!r.sistema && <button className="act-btn del" title="Eliminar rol" onClick={() => borrarRol(r)}><Icon name="trash" size={13} /></button>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gruposVis.map((g) => {
              const claves = g.perms.map((p) => p.clave);
              const info = SEC[g.seccion] || { lbl: g.seccion, icon: "cat" };
              return (
                <Fragment key={g.seccion}>
                  <tr className="rp-mod">
                    <td className="rp-modcell">
                      <div className="rp-modh">
                        <button className="rp-chev" onClick={() => setColapso((c) => ({ ...c, [g.seccion]: !c[g.seccion] }))}
                          aria-label={abierto(g.seccion) ? "Plegar" : "Desplegar"}>
                          <Icon name={abierto(g.seccion) ? "chevron-down" : "chevron-right"} size={15} />
                        </button>
                        <span className="rp-modic"><Icon name={info.icon} size={17} /></span>
                        <b>{info.lbl}</b>
                        {g.app !== "maestros" && <span className="rp-appchip" title={`Funcionalidades de la app «${g.app}» (ella registra y hace cumplir estos permisos; aquí solo los asignas).`}>{g.app}</span>}
                        <span className="rp-modn">{g.perms.length} permisos</span>
                      </div>
                    </td>
                    {roles.map((r) => {
                      const st = estadoMod(r, claves);
                      return <td key={r.id} className="rp-c"><Tri checked={st.all} partial={st.part} disabled={r.sistema} onChange={() => toggleMod(r, claves)} /></td>;
                    })}
                  </tr>
                  {abierto(g.seccion) && g.perms.map((p) => (
                    <tr key={p.clave} className={"rp-act" + (p.activo === false ? " rp-depr" : "")}>
                      <td className="rp-pl">
                        <span className={p.activo === false ? "rp-depr-lbl" : undefined}>{p.etiqueta}</span>
                        {p.activo === false && <span className="rp-deprtag" title="Permiso deprecado: la app que lo definía lo retiró. Desmárcalo de los roles; ya no aplica.">deprecado</span>}
                        {SENSIBLE.has(p.accion) && <span className="rp-sens">sensible</span>}
                        {CROSS_APP.has(p.clave) && <span className="rp-xapp"
                          title="Este permiso vuelve 'administrador' al rol en las otras apps (Calendario, Liquidador, Descargas DIAN): verá todos los clientes y podrá cambiar claves de portal. Concédelo solo a roles de gestión.">afecta otras apps</span>}
                      </td>
                      {roles.map((r) => (
                        <td key={r.id} className="rp-c">
                          <span className={"rp-cell" + (cambiado(r, p.clave) ? " chg" : "")}>
                            <input type="checkbox" className="rp-chk" checked={has(r, p.clave)} disabled={r.sistema} onChange={() => toggle(r, p.clave)} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {gruposVis.length === 0 && (
              <tr><td className="rp-empty" colSpan={roles.length + 1}>Ningún permiso coincide con «{q}».</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {nCambios > 0 && (
        <div className="rp-savebar">
          <span className="rp-saven"><b>{nCambios}</b> cambio{nCambios === 1 ? "" : "s"} sin guardar</span>
          <div className="rp-saveb">
            <button className="btn sm" onClick={descartar} disabled={guardando}>Descartar</button>
            <button className="btn primary sm" onClick={guardar} disabled={guardando}><Icon name="save" size={15} />{guardando ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
