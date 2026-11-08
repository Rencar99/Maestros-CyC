import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useActiveReload } from "../useActiveReload";
import { Responsable } from "../types";
import { fmtTel, Icon, soloDig, Toggle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";
import { Cat, CatSelect } from "../components/CatSelect";
import { RespCombo } from "../components/RespCombo";
import { DateInput } from "../components/DateInput";

const FORM: Record<number, string> = { 1: "Profesional", 2: "Postgrado", 3: "Maestría", 4: "Doctorado", 5: "Otros" };
/** Sugerencia de apodo (nombre en formato "Apellido1 Apellido2 Nombre1 …"):
 *  inicial del primer nombre + iniciales de los dos apellidos → ej. "Amaya Rumie Luis Jose" = "LAR". */
const sugApodo = (nombre: string): string => {
  const w = String(nombre || "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  if (w.length === 1) return w[0].slice(0, 3);
  if (w.length === 2) return (w[1][0] + w[0][0]);            // nombre + apellido
  return (w[2][0] + w[0][0] + w[1][0]);                      // nom1 + ap1 + ap2
};

const vacio = (): Responsable => ({
  id: 0, tipo: "Int", nombre: "", cedula: "", tarjeta_profesional: "", formacion_academica: 1,
  email_corporativo: "", usuario: "", rol: "usuario", activo: true, cargo: "", telefono: "", foto: "", formacion_nombre: "", apodo: "",
});

export function Responsables({ esSuper = false, puede, active = true }: { esSuper?: boolean; puede: (c: string) => boolean; active?: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<Responsable[]>([]);
  const [actualizado, setActualizado] = useState("");
  const [edit, setEdit] = useState<Responsable | null>(null);
  const [cargos, setCargos] = useState<Cat[]>([]);
  const [orden, setOrden] = useState<number[]>([]);   // orden visible de la grilla (para navegar)
  const [supl, setSupl] = useState(false);            // modal Reasignar / Suplencias

  const vecino = (dir: "prev" | "next"): number | undefined => {
    if (!edit || !edit.id) return undefined;
    const i = orden.indexOf(edit.id);
    if (i < 0) return undefined;
    return orden[dir === "next" ? i + 1 : i - 1];
  };
  const abrirId = (id: number) => { const row = rows.find((r) => r.id === id); if (row) setEdit({ ...row }); };
  const confirmar = useConfirm();
  const borrar = async (r: Responsable) => {
    if ((await confirmar({ titulo: "Eliminar responsable", mensaje: `Se eliminará a "${r.nombre}" del maestro de responsables. Esta acción no se puede deshacer.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/responsables/${r.id}`); toast("Eliminado"); load(); }
    catch (e: any) { toast(e.message, true); }
  };

  const load = () => api.get("/responsables").then((r: Responsable[]) => { setRows(r); setActualizado(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })); }).catch((e) => toast(e.message, true));
  useEffect(() => {
    load();
    api.get("/catalogos/cargo").then((cs: Cat[]) => setCargos(cs.filter((c) => c.activo))).catch(() => {});
  }, []); // eslint-disable-line
  // Re-leer al volver a entrar solo si hubo escrituras desde la última vez (epoch).
  useActiveReload(active, load);

  const inic = (n: string) => (n || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const cols: Column<Responsable>[] = [
    {
      key: "nombre", label: "Nombre", sortable: true, filterable: true, value: (r) => r.nombre,
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="grid-av">{r.foto ? <img src={r.foto} alt="" /> : inic(r.nombre)}</span>
          <span>{r.nombre}</span>
        </div>
      ),
    },
    { key: "tipo", label: "Tipo", type: "status", filterable: true, value: (r) => (r.tipo === "Int" ? "Interno" : "Externo"), render: (r) => <span className={"tag " + (r.tipo === "Int" ? "int" : "ext")}>{r.tipo === "Int" ? "Interno" : "Externo"}</span> },
    { key: "cedula", label: "Cédula", type: "code", sortable: true, value: (r) => r.cedula },
    { key: "cargo", label: "Cargo", sortable: true, filterable: true, value: (r) => r.cargo || "—" },
    { key: "form", label: "Formación", filterable: true, value: (r) => FORM[r.formacion_academica] || "" },
    { key: "email", label: "Email corporativo", sortable: true, filterable: true, width: "26ch", value: (r) => r.email_corporativo },
    { key: "activo", label: "Activo", type: "status", filterable: true, value: (r) => (r.activo ? "Sí" : "No"), render: (r) => <span className={"tag " + (r.activo ? "act" : "ina")}>{r.activo ? "Sí" : "No"}</span> },
  ];

  return (
    <>
      <div className="card gframe gframe-sinh">
        <div className="gframe-body">
          <DataGrid columns={cols} rows={rows} getKey={(r) => r.id} label="Responsables" emptyLabel="Sin responsables."
            storageKey="responsables" fitRows
            onView={(rs) => setOrden(rs.map((r) => r.id))}
            toolbar={(puede("responsables.crear") || puede("responsables.reasignar")) ? <span className="gf-end">
              {puede("responsables.reasignar") && <button className="btn sm" onClick={() => setSupl(true)}><Icon name="resp" size={16} />Reasignar / Suplencias</button>}
              {puede("responsables.crear") && <button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />Nuevo responsable</button>}
            </span> : undefined}
            actionsWidth={puede("responsables.eliminar") ? "72px" : undefined}
            actions={(puede("responsables.editar") || puede("responsables.eliminar")) ? (r) => (
              <>
                {puede("responsables.editar") && <button className="act-btn edit" title="Editar" onClick={() => setEdit({ ...r })}><Icon name="edit" size={15} /></button>}
                {puede("responsables.eliminar") && <button className="act-btn del" title="Eliminar" onClick={() => borrar(r)}><Icon name="trash" size={15} /></button>}
              </>
            ) : undefined} />
        </div>
        <div className="gframe-foot">
          {rows.length} responsable{rows.length === 1 ? "" : "s"}
          {actualizado && <><span className="gf-dot">·</span> Actualizado: {actualizado}</>}
        </div>
      </div>
      {edit && <Ficha resp={edit} esSuper={esSuper} puede={puede}
        cargos={cargos} onCargo={(n) => setCargos((p) => [...p, n])}
        formaciones={[...new Set(rows.map((r) => r.formacion_nombre).filter(Boolean))].sort()}
        prevId={vecino("prev") ?? null} nextId={vecino("next") ?? null} onGo={abrirId} reload={load}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {supl && <SuplenciasModal responsables={rows} confirmar={confirmar}
        onClose={() => setSupl(false)} onDone={load} />}
    </>
  );
}

function Ficha({ resp, esSuper, puede, cargos, onCargo, formaciones, prevId, nextId, onGo, reload, onClose, onSaved }: {
  resp: Responsable; esSuper?: boolean; puede: (c: string) => boolean; cargos: Cat[]; onCargo: (n: Cat) => void; formaciones: string[];
  prevId?: number | null; nextId?: number | null; onGo?: (id: number) => void; reload?: () => void;
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [r, setR] = useState<Responsable>(resp);
  const [min, setMin] = useState(false);                     // ficha minimizada a píldora
  const [pass, setPass] = useState("");
  const [passTouched, setPassTouched] = useState(false);     // true solo si el usuario tecleó la clave
  const [showPw, setShowPw] = useState(false);
  const [apodoAuto, setApodoAuto] = useState(!resp.apodo);   // autocompletar apodo mientras no se edite a mano
  const [rolesAcc, setRolesAcc] = useState<{ id: number; nombre: string; sistema: boolean }[]>([]);
  useEffect(() => { api.get("/roles").then(setRolesAcc).catch(() => {}); }, []);
  const set = (k: keyof Responsable, v: any) => setR((o) => ({ ...o, [k]: v }));
  const nuevo = !resp.id;
  const interno = r.tipo === "Int";
  // Al navegar a otro registro el modal NO se remonta (evita el "salto"): refrescamos el estado aquí.
  const primera = useRef(true);
  // Concurrencia optimista: marca de tiempo con la que se cargó la ficha (se manda
  // al guardar; si otro guardó entretanto, el backend devuelve 409).
  const baseTs = useRef<string>((resp as any).actualizado_at || "");
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    setR(resp); setPass(""); setPassTouched(false); setShowPw(false); setApodoAuto(!resp.apodo); setMin(false);
    baseTs.current = (resp as any).actualizado_at || "";
  }, [resp.id]); // eslint-disable-line

  const guardarRaw = async (): Promise<boolean> => {
    try {
      const body: any = { ...r };
      if (passTouched && pass) body.password = pass;
      if (nuevo) { delete body.id; const x: any = await api.post("/responsables", body); baseTs.current = x?.actualizado_at || ""; }
      else { const x: any = await api.put(`/responsables/${resp.id}?base=${encodeURIComponent(baseTs.current || "")}`, body); baseTs.current = x?.actualizado_at || ""; }
      return true;
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/fue modificado/i.test(msg)) {
        const res = await confirmar({
          titulo: "Conflicto al guardar", peligro: true,
          mensaje: msg + " Si recargas, verás los datos actuales y perderás lo que escribiste sin guardar.",
          confirmar: "Recargar ficha", cancelar: "Seguir editando",
        });
        if (res === "si") {
          try { const fresh: any = await api.get(`/responsables/${resp.id}`); setR(fresh); baseTs.current = fresh?.actualizado_at || ""; }
          catch (ex: any) { toast(ex.message, true); }
        }
      } else { toast(msg, true); }
      return false;
    }
  };
  const guardar = async () => { if (await guardarRaw()) { toast("Guardado ✓"); onSaved(); } };
  const verOcultarClave = async () => {
    if (showPw) { setShowPw(false); return; }
    if (!nuevo && !passTouched && !pass) {
      try {
        const res = await api.get(`/responsables/${resp.id}/password`);
        if (res.password) setPass(res.password);
        else toast("Esta clave se guardó antes; vuelve a definirla para poder verla.");
      } catch (e: any) { toast(e.message, true); }
    }
    setShowPw(true);
  };
  const cambiado = () => JSON.stringify(r) !== JSON.stringify(resp) || passTouched;
  const navegar = async (id?: number | null) => {
    if (id == null || !onGo) return;
    if (cambiado()) {
      const res = await confirmar({ titulo: "Cambios sin guardar", mensaje: "Tienes cambios sin guardar en este responsable. ¿Qué deseas hacer antes de pasar al otro registro?", confirmar: "Guardar y continuar", descartar: "Descartar", cancelar: "Cancelar" });
      if (res === "cancelar") return;
      if (res === "si") { if (!(await guardarRaw())) return; reload?.(); }
    }
    onGo(id);
  };
  const borrar = async () => {
    if ((await confirmar({ titulo: "Eliminar responsable", mensaje: `Se eliminará a "${r.nombre}" del maestro de responsables. Esta acción no se puede deshacer.`, peligro: true, confirmar: "Eliminar" })) !== "si") return;
    try { await api.del(`/responsables/${resp.id}`); toast("Eliminado"); onSaved(); }
    catch (e: any) { toast(e.message, true); }
  };
  const onFoto = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = (e) => set("foto", String(e.target?.result || ""));
    rd.readAsDataURL(file);
  };

  return (
    <Modal
      size="md"
      icon="user"
      portal
      minimized={min}
      onMinimize={() => setMin(true)}
      onRestore={() => setMin(false)}
      title={nuevo ? "Nuevo responsable" : `Editando - ${r.nombre}${r.cedula ? "  ·  " + r.cedula : ""}`}
      sub={nuevo ? "Nuevo registro en el maestro de responsables" : "Datos del responsable de la firma"}
      onClose={onClose}
      onPrev={!nuevo && prevId != null ? () => navegar(prevId) : undefined}
      onNext={!nuevo && nextId != null ? () => navegar(nextId) : undefined}
      onSave={guardar} saveLabel={nuevo ? "Crear" : "Guardar cambios"} saveIcon={nuevo ? "check" : "save"}
      extraActions={!nuevo && puede("responsables.eliminar")
        ? <button className="mh-act danger" onClick={borrar} aria-label="Eliminar"><Icon name="trash" size={18} /><span className="mh-tip">Eliminar</span></button>
        : undefined}
    >
          <div className="fieldgroup"><h4>Datos del responsable</h4>
            <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "150px 1fr 150px", gap: "11px 14px" }}>
                <div className="f" style={{ gridColumn: "span 2" }}><label>Nombre <span className="req">*</span></label>
                  <input value={r.nombre} onChange={(e) => { const v = e.target.value; set("nombre", v); if (apodoAuto) set("apodo", sugApodo(v)); }} /></div>
                <div className="f"><label>Apodo</label>
                  <input value={r.apodo} maxLength={3} placeholder={sugApodo(r.nombre) || "—"}
                    style={{ width: 92, textTransform: "uppercase", textAlign: "center", letterSpacing: 2, fontWeight: 700 }}
                    title="Iniciales para mostrar en las grillas (sugerido: nombre + apellidos)"
                    onChange={(e) => { setApodoAuto(false); set("apodo", e.target.value.toUpperCase().replace(/[^A-ZÑ]/g, "").slice(0, 3)); }} /></div>

                <div className="f"><label>Cédula</label><input value={r.cedula} onChange={(e) => set("cedula", e.target.value)} /></div>
                <div className="f"><label>Cargo{interno ? "" : " (solo interno)"}</label>
                  <CatSelect path="cargo" by="descripcion" items={cargos} onItems={onCargo} value={r.cargo} onChange={(v) => set("cargo", v ?? "")} disabled={!interno} /></div>
                <div className="f"><label>Tarjeta profesional</label><input value={r.tarjeta_profesional} onChange={(e) => set("tarjeta_profesional", e.target.value)} /></div>

                <div className="f"><label>Formación académica</label><select value={r.formacion_academica} onChange={(e) => set("formacion_academica", Number(e.target.value))}>{Object.entries(FORM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="f" style={{ gridColumn: "span 2" }}><label>Nombre de la formación</label><input value={r.formacion_nombre} list="form-list" placeholder="Ej: Contador Público" onChange={(e) => set("formacion_nombre", e.target.value)} /><datalist id="form-list">{formaciones.map((f) => <option key={f} value={f} />)}</datalist></div>

                <div className="f"><label>Teléfono</label><input value={fmtTel(r.telefono)} placeholder="999-9999999" onChange={(e) => set("telefono", soloDig(e.target.value))} /></div>
                <div className="f" style={{ gridColumn: "span 2" }}><label>Email corporativo</label><input type="email" value={r.email_corporativo} onChange={(e) => set("email_corporativo", e.target.value)} /></div>
              </div>
              <div className="foto-up">
                <label className="foto-drop" title="Cargar / cambiar foto">
                  {r.foto ? <img src={r.foto} alt="foto" /> : <span className="foto-ph"><Icon name="user" size={30} /></span>}
                  <input type="file" accept="image/*" onChange={(e) => onFoto(e.target.files?.[0])} />
                  {r.foto && <span className="foto-ov">Cambiar</span>}
                </label>
                {r.foto && <button type="button" className="foto-clr" title="Quitar foto" onClick={() => set("foto", "")}><Icon name="broom" size={15} /></button>}
              </div>
            </div>
          </div>
          <div className="fieldgroup"><h4>Estado</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 300 }}>
              <Toggle label="Interno de la firma" checked={r.tipo === "Int"} onChange={(v) => set("tipo", v ? "Int" : "Ext")} />
              <Toggle label="Activo" color="green" checked={r.activo} onChange={(v) => set("activo", v)} />
            </div>
          </div>
          <div className="fieldgroup"><h4>Acceso al aplicativo</h4>
            {interno ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 190px 220px", gap: "9px 16px" }}>
                {/* Señuelos ocultos: absorben el autocompletado del navegador para que no rellene la clave real */}
                <input type="text" name="usuario-decoy" tabIndex={-1} autoComplete="username" style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }} />
                <input type="password" name="clave-decoy" tabIndex={-1} autoComplete="new-password" style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }} />
                <div className="f"><label>Usuario (login)</label><input autoComplete="off" value={r.usuario || ""} onChange={(e) => set("usuario", e.target.value)} /></div>
                <div className="f"><label>Rol de acceso</label><select value={r.rol_id ?? ""} onChange={(e) => set("rol_id", e.target.value ? Number(e.target.value) : null)}><option value="">— Sin rol —</option>{rolesAcc.map((ro) => <option key={ro.id} value={ro.id}>{ro.nombre}</option>)}</select></div>
                <div className="f"><label>{nuevo ? "Contraseña" : "Nueva contraseña (opcional)"}</label>
                  <div className="pw-wrap">
                    <input type={showPw ? "text" : "password"} name="clave-resp-cyc" autoComplete="new-password" value={pass} placeholder={nuevo ? "Definir contraseña" : "Escribe para cambiar"} onChange={(e) => { setPass(e.target.value); setPassTouched(true); }} />
                    {puede("config.roles") && <button type="button" className="pw-eye" title={showPw ? "Ocultar" : "Ver contraseña"} onClick={verOcultarClave}><Icon name={showPw ? "eye-off" : "eye"} size={16} /></button>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty">Los responsables externos no inician sesión en el aplicativo.</div>
            )}
          </div>
    </Modal>
  );
}


/** Checkbox de 3 estados (marcado / parcial / vacío) para el "seleccionar todo". */
function TriBox({ checked, partial, onChange }: { checked: boolean; partial: boolean; onChange: () => void }) {
  const r = useRef<HTMLInputElement>(null);
  useEffect(() => { if (r.current) r.current.indeterminate = partial && !checked; }, [partial, checked]);
  return <input ref={r} type="checkbox" checked={checked} onChange={onChange} />;
}

type FilaRep = { cliente_id: number; rol: string; rol_label: string; nombre: string; grupo: string; confidencial: boolean; oculto: boolean };
const kFila = (r: FilaRep) => `${r.cliente_id}|${r.rol}`;

/** Reasignar los clientes de un responsable que sale (vacaciones o traspaso): grilla
 *  con casillas para repartir UNO A UNO o por BLOQUES (filtrar Rol + seleccionar todo)
 *  a distintos reemplazos; + ver/revertir suplencias activas. Reutiliza DataGrid,
 *  RespCombo y DateInput. Las firmas (contador/revisor) son legales: no se reparten. */
function SuplenciasModal({ responsables, confirmar, onClose, onDone }: {
  responsables: Responsable[];
  confirmar: (o: any) => Promise<string>;
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"nueva" | "activas">("nueva");
  const [salienteId, setSalienteId] = useState<number | null>(null);
  const [filas, setFilas] = useState<FilaRep[]>([]);
  const [asign, setAsign] = useState<Record<string, number | null>>({});  // rowKey → reemplazo (pendiente)
  const [sel, setSel] = useState<Set<string>>(new Set());                 // filas marcadas
  const [visibles, setVisibles] = useState<string[]>([]);                 // rowKeys visibles (filtro+búsqueda)
  const [reempBulk, setReempBulk] = useState<number | null>(null);        // reemplazo del "asignar a seleccionados"
  const [tipo, setTipo] = useState<"vacaciones" | "definitiva">("vacaciones");
  const [retorno, setRetorno] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [lotes, setLotes] = useState<any[]>([]);
  const [min, setMin] = useState(false);
  const [correoLid, setCorreoLid] = useState<number | null>(null);   // modal de aviso del lote

  const opts = responsables.filter((r) => r.tipo === "Int" && r.activo).map((r) => ({ id: r.id, nombre: r.nombre }));
  const optsRepl = opts.filter((o) => o.id !== salienteId);
  const nombreRep = (id: number | null | undefined) => (id ? (responsables.find((r) => r.id === id)?.nombre ?? "?") : "");

  const traerClientes = (uid: number, conservar = false) =>
    api.get(`/responsables/${uid}/clientes`).then((d: any) => {
      const rows: FilaRep[] = d.rows || [];
      setFilas(rows);
      setSel(new Set());
      if (!conservar) { setAsign({}); return; }
      const keys = new Set(rows.map(kFila));                      // podar asignaciones huérfanas
      setAsign((prev) => { const n: Record<string, number | null> = {}; Object.entries(prev).forEach(([k, v]) => { if (v && keys.has(k)) n[k] = v; }); return n; });
    });

  useEffect(() => {
    setFilas([]); setAsign({}); setSel(new Set()); setReempBulk(null);
    if (!salienteId) return;
    setCargando(true);
    traerClientes(salienteId).catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, [salienteId]); // eslint-disable-line

  const cargarActivas = () => api.get("/responsables/reasignaciones?estado=activa")
    .then((d: any) => setLotes(d.rows || [])).catch((e: any) => toast(e.message, true));
  useEffect(() => { if (tab === "activas") cargarActivas(); }, [tab]); // eslint-disable-line

  const toggle = (key: string) => setSel((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const allSel = visibles.length > 0 && visibles.every((v) => sel.has(v));
  const someSel = !allSel && visibles.some((v) => sel.has(v));
  const toggleTodos = () => setSel((p) => { const n = new Set(p); if (allSel) visibles.forEach((v) => n.delete(v)); else visibles.forEach((v) => n.add(v)); return n; });
  const asignarSel = (a_id: number) => {
    if (!a_id || sel.size === 0) return;
    const cnt = sel.size;
    setAsign((prev) => { const n = { ...prev }; sel.forEach((k) => (n[k] = a_id)); return n; });
    setSel(new Set()); setReempBulk(null);
    toast(`${cnt} cliente${cnt === 1 ? "" : "s"} → ${nombreRep(a_id)}`);
  };
  const quitarSel = () => { setAsign((prev) => { const n = { ...prev }; sel.forEach((k) => delete n[k]); return n; }); setSel(new Set()); };

  const items = Object.entries(asign).filter(([, v]) => v).map(([k, v]) => { const [cid, rol] = k.split("|"); return { cliente_id: Number(cid), rol, a_id: v as number }; });
  const puedeAplicar = !!salienteId && items.length > 0 && !guardando;

  const cols: Column<FilaRep>[] = [
    {
      key: "sel", label: "", width: "40px", align: "center",
      headerRender: () => <span onClick={(e) => e.stopPropagation()}><TriBox checked={allSel} partial={someSel} onChange={toggleTodos} /></span>,
      render: (r) => <input type="checkbox" readOnly checked={sel.has(kFila(r))} />,
    },
    {
      key: "nombre", label: "Cliente", filterable: true, sortable: true, minWidth: "16ch",
      render: (r) => <span className={r.oculto ? "supl-oculta" : ""}>{r.nombre}</span>, value: (r) => r.nombre,
    },
    {
      key: "grupo", label: "Grupo económico", filterable: true, sortable: true, width: "18ch",
      render: (r) => r.grupo ? <span>{r.grupo}</span> : <span className="supl-rep-off">—</span>, value: (r) => r.grupo,
    },
    { key: "rol_label", label: "Rol", filterable: true, sortable: true, width: "20ch" },
    {
      key: "reemplazo", label: "Reemplazo", filterable: true, sortable: true, width: "18ch",
      render: (r) => { const a = asign[kFila(r)]; return a ? <span className="supl-rep-on">{nombreRep(a)}</span> : <span className="supl-rep-off">—</span>; },
      value: (r) => nombreRep(asign[kFila(r)]),
    },
  ];

  const bulkBar = (
    <div className="supl-bulk">
      <RespCombo value={reempBulk} options={optsRepl} onChange={setReempBulk} placeholder="Reemplazo…" />
      <button className="btn sm" disabled={!reempBulk || sel.size === 0} onClick={() => asignarSel(reempBulk!)}>
        <Icon name="resp" size={14} />Asignar{sel.size ? ` (${sel.size})` : ""}
      </button>
      <button className="btn sm" disabled={sel.size === 0} onClick={quitarSel}>Quitar</button>
      <span className="supl-count">Repartidos <b>{items.length}</b> / {filas.length}</span>
    </div>
  );

  const aplicar = async () => {
    if (!puedeAplicar) return;
    if (tipo === "vacaciones" && retorno && !/^\d{4}-\d{2}-\d{2}$/.test(retorno)) { toast("Fecha de retorno inválida (AAAA-MM-DD).", true); return; }
    setGuardando(true);
    try {
      const r: any = await api.post("/responsables/reasignar", {
        saliente_id: salienteId, tipo,
        fecha_retorno: tipo === "vacaciones" && retorno ? retorno : null,
        items,
      });
      toast(`Reasignados ${r.total} cliente${r.total === 1 ? "" : "s"} ✓`);
      onDone();
      setSalienteId(null); setAsign({}); setSel(new Set()); setReempBulk(null); setRetorno(""); setFilas([]);
      setTab("activas"); cargarActivas();
      setCorreoLid(r.lote_id);                 // ofrecer el aviso por correo del lote recién creado
    } catch (e: any) {
      toast(e.message, true);
      if (salienteId) traerClientes(salienteId, true).catch(() => {});   // la lista pudo quedar obsoleta → refrescar
    } finally { setGuardando(false); }
  };

  const revertir = async (l: any) => {
    if ((await confirmar({ titulo: "Revertir reasignación", mensaje: `Se devolverán ${l.total} cliente(s) a ${l.saliente}. Los que se hayan cambiado a mano no se tocan.`, confirmar: "Revertir" })) !== "si") return;
    try {
      const r: any = await api.post(`/responsables/reasignaciones/${l.id}/revertir`, {});
      if (r.omitidos?.length) toast(`Revertidos ${r.restaurados}; ${r.omitidos.length} omitido(s) por cambio manual.`, true);
      else toast(`Revertido ✓ (${r.restaurados})`);
      cargarActivas(); onDone();
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <>
    <Modal title="Reasignar clientes / Suplencias" icon="resp" size="lg" onClose={onClose}
      onSave={tab === "nueva" ? aplicar : undefined} canSave={puedeAplicar} saving={guardando}
      saveLabel="Aplicar reasignación" saveIcon="resp"
      onMinimize={() => setMin(true)} minimized={min} onRestore={() => setMin(false)}
      aviso={tab === "nueva" && items.length > 0 ? "Listo para aplicar arriba" : undefined} avisoTone="ok">
      <div className="supl-tabs">
        <button className={"supl-tab" + (tab === "nueva" ? " on" : "")} onClick={() => setTab("nueva")}>Nueva reasignación</button>
        <button className={"supl-tab" + (tab === "activas" ? " on" : "")} onClick={() => setTab("activas")}>Suplencias activas</button>
      </div>
      {tab === "nueva" ? (
        <div className="supl-body">
          <div className="f"><label>Responsable que sale</label>
            <RespCombo value={salienteId} options={opts} onChange={setSalienteId} placeholder="Elige al responsable…" />
          </div>
          {cargando ? <div className="hint">Cargando…</div>
            : salienteId && filas.length === 0 ? <div className="hint">No tiene clientes en roles de gestión.</div>
            : filas.length > 0 && (
              <>
                <DataGrid<FilaRep> columns={cols} rows={filas} getKey={kFila}
                  label="Clientes del saliente" emptyLabel="Sin clientes."
                  searchable exportable={false} toolbar={bulkBar}
                  onView={(rs) => setVisibles(rs.map(kFila))}
                  onRowClick={(r) => toggle(kFila(r))}
                  rowClass={(r) => (asign[kFila(r)] ? "supl-fila-on" : r.oculto ? "supl-fila-off" : undefined)}
                  storageKey="supl-reparto" scrollClass="supl-grid-scroll" />
                <div className="supl-modo">
                  <div className="supl-tipo">
                    <button className={"supl-pill" + (tipo === "vacaciones" ? " on" : "")} onClick={() => setTipo("vacaciones")}>Vacaciones (revertible)</button>
                    <button className={"supl-pill" + (tipo === "definitiva" ? " on" : "")} onClick={() => setTipo("definitiva")}>Definitiva</button>
                  </div>
                  {tipo === "vacaciones" && <div className="f"><label>Fecha de retorno (opcional)</label>
                    <DateInput value={retorno} onChange={setRetorno} /></div>}
                </div>
              </>
            )}
        </div>
      ) : (
        <div className="supl-body">
          {lotes.length === 0 ? <div className="hint">No hay suplencias activas.</div>
            : lotes.map((l) => (
              <div className={"supl-lote" + (l.vence ? " vence" : "")} key={l.id}>
                <div className="supl-lote-top">
                  <b>{l.saliente}</b>
                  <span className={"supl-badge " + l.tipo}>{l.tipo === "vacaciones" ? "Vacaciones" : "Definitiva"}</span>
                  {l.fecha_retorno && <span className={"supl-ret" + (l.vence ? " due" : "")}>Retorno {l.fecha_retorno}{l.vence ? " · vencida" : ""}</span>}
                  <span className="supl-grow" />
                  <button className="btn sm" onClick={() => setCorreoLid(l.id)}><Icon name="mail" size={14} />Correo</button>
                  <button className="btn sm" onClick={() => revertir(l)}><Icon name="refresh" size={14} />Revertir</button>
                </div>
                <div className="supl-lote-det">
                  {l.detalle.map((d: any, i: number) => <span key={i} className="supl-chip">{d.rol} → {d.a} <b>({d.n})</b></span>)}
                </div>
              </div>
            ))}
        </div>
      )}
    </Modal>
    {correoLid != null && <CorreoReasignacionModal lid={correoLid} confirmar={confirmar} onClose={() => setCorreoLid(null)} />}
    </>
  );
}

/** Aviso por correo de un lote de reasignación: un borrador por Responsable de Impuestos
 *  afectado (tabla célula/cliente/supervisor autogenerada), editable, enviado desde el
 *  buzón del operador (Graph delegado). La tabla la arma el servidor; aquí solo se edita
 *  el texto. Se puede reenviar (con confirmación). */
function CorreoReasignacionModal({ lid, confirmar, onClose }: {
  lid: number; confirmar: (o: any) => Promise<string>; onClose: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [ed, setEd] = useState<Record<number, { para: string; asunto: string; intro: string; cierre: string }>>({});
  const [enviadosLocal, setEnviadosLocal] = useState<Record<number, boolean>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setCargando(true);
    api.get(`/responsables/reasignaciones/${lid}/correos`)
      .then((d: any) => {
        setData(d);
        const rs = d.recipientes || [];
        const m: any = {};
        rs.forEach((r: any) => (m[r.destinatario_id] = { para: r.para, asunto: r.asunto, intro: r.intro, cierre: r.cierre }));
        setEd(m);
        setSel((rs.find((r: any) => !r.enviado) || rs[0])?.destinatario_id ?? null);
      })
      .catch((e: any) => toast(e.message, true))
      .finally(() => setCargando(false));
  }, [lid]); // eslint-disable-line

  const rec = data?.recipientes?.find((r: any) => r.destinatario_id === sel) || null;
  const campos = sel != null ? ed[sel] : null;
  const setCampo = (k: string, v: string) => sel != null && setEd((m) => ({ ...m, [sel]: { ...m[sel], [k]: v } }));
  const yaEnviado = (r: any) => !!enviadosLocal[r.destinatario_id] || !!r.enviado;

  const enviar = async () => {
    if (!rec || !campos) return;
    if (!campos.para.trim()) { toast("El destinatario no tiene correo.", true); return; }
    if (yaEnviado(rec) && (await confirmar({ titulo: "Reenviar correo", mensaje: `Ya se le envió el aviso a ${rec.nombre}. ¿Reenviar?`, confirmar: "Reenviar" })) !== "si") return;
    setEnviando(true);
    try {
      await api.post(`/responsables/reasignaciones/${lid}/correo`, {
        destinatario_id: rec.destinatario_id, para: campos.para, asunto: campos.asunto, intro: campos.intro, cierre: campos.cierre,
      });
      toast(`Correo enviado a ${rec.nombre} ✓`);
      setEnviadosLocal((m) => ({ ...m, [rec.destinatario_id]: true }));
      const sig = data.recipientes.find((r: any) => r.destinatario_id !== rec.destinatario_id && !yaEnviado(r) && r.tiene_correo);
      if (sig) setSel(sig.destinatario_id);
    } catch (e: any) { toast(e.message, true); } finally { setEnviando(false); }
  };

  return (
    <Modal title="Enviar aviso de reasignación" icon="mail" size="lg" portal onClose={onClose}
      onSave={rec ? enviar : undefined} canSave={!!data?.conectado && !!campos?.para?.trim() && !enviando}
      saving={enviando} saveLabel={rec && yaEnviado(rec) ? "Reenviar correo" : "Enviar correo"} saveIcon="mail"
      aviso={!cargando && data && !data.conectado ? "Conecta tu correo de Microsoft 365 (Configuración → Mi correo) para poder enviar." : undefined} avisoTone="warn">
      {cargando ? <div className="hint">Cargando…</div>
        : !data?.recipientes?.length ? <div className="hint">Esta reasignación no genera avisos (no fueron roles tributarios).</div>
        : <div className="cre-body">
            <div className="f"><label>De</label><input value={data.de || "(sin correo conectado)"} disabled /></div>
            <div className="cre-dests">
              {data.recipientes.map((r: any) => (
                <button key={r.destinatario_id} type="button"
                  className={"cre-dest" + (r.destinatario_id === sel ? " on" : "") + (yaEnviado(r) ? " sent" : "")}
                  onClick={() => setSel(r.destinatario_id)}>
                  {yaEnviado(r) && <Icon name="check" size={12} />}{r.nombre}
                  <span className="cre-n">({r.n_clientes})</span>
                  {!r.tiene_correo && <span className="cre-nomail">sin correo</span>}
                </button>
              ))}
            </div>
            {rec && campos && <>
              <div className="cre-f2">
                <div className="f"><label>Para</label><input value={campos.para} onChange={(e) => setCampo("para", e.target.value)} placeholder="correo@…" /></div>
                <div className="f"><label>Asunto</label><input value={campos.asunto} onChange={(e) => setCampo("asunto", e.target.value)} /></div>
              </div>
              <div className="f"><label>Introducción</label><textarea rows={3} value={campos.intro} onChange={(e) => setCampo("intro", e.target.value)} /></div>
              <table className="cre-tabla"><thead><tr><th>Cliente principal / célula</th><th>Cliente</th><th>Supervisor encargado</th></tr></thead>
                <tbody>{rec.filas.map((f: any, i: number) => (<tr key={i}><td>{f.celula}</td><td>{f.clientes}</td><td>{f.supervisor}</td></tr>))}</tbody></table>
              <div className="f"><label>Cierre</label><textarea rows={4} value={campos.cierre} onChange={(e) => setCampo("cierre", e.target.value)} /></div>
            </>}
            {data.sin_responsable?.length > 0 && <div className="cre-note"><Icon name="alert" size={13} />{data.sin_responsable.length} cliente(s) movido(s) sin Responsable de Impuestos — no entran en ningún aviso.</div>}
            {data.omitidos_no_tributarios > 0 && <div className="cre-note"><Icon name="info" size={13} />{data.omitidos_no_tributarios} movimiento(s) financiero/registro — no generan aviso.</div>}
          </div>}
    </Modal>
  );
}
