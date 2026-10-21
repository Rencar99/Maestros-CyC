import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Responsable } from "../types";
import { Icon, Toggle, useConfirm, useToast } from "../ui";
import { Column, DataGrid } from "../components/DataGrid";
import { Modal } from "../components/Modal";
import { Cat, CatSelect } from "../components/CatSelect";

const FORM: Record<number, string> = { 1: "Profesional", 2: "Postgrado", 3: "Maestría", 4: "Doctorado", 5: "Otros" };
const soloDig = (v: string) => String(v || "").replace(/\D/g, "").slice(0, 10);
const fmtTel = (v: string) => { const d = soloDig(v); return d.length <= 3 ? d : d.slice(0, 3) + "-" + d.slice(3); };
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
  // La App mantiene las páginas montadas (display:none); re-leer al volver a entrar.
  useEffect(() => { if (active) load(); }, [active]); // eslint-disable-line

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
            toolbar={puede("responsables.crear") ? <span className="gf-end"><button className="btn primary sm" onClick={() => setEdit(vacio())}><Icon name="plus" size={16} />Nuevo responsable</button></span> : undefined}
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
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    setR(resp); setPass(""); setPassTouched(false); setShowPw(false); setApodoAuto(!resp.apodo); setMin(false);
  }, [resp.id]); // eslint-disable-line

  const guardarRaw = async (): Promise<boolean> => {
    try {
      const body: any = { ...r };
      if (passTouched && pass) body.password = pass;
      if (nuevo) { delete body.id; await api.post("/responsables", body); }
      else await api.put(`/responsables/${resp.id}`, body);
      return true;
    } catch (e: any) { toast(e.message, true); return false; }
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
