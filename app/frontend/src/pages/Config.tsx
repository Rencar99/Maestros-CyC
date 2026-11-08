import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon, SecTitle, useConfirm, useToast } from "../ui";
import { RolesPermisos } from "./RolesPermisos";
import { ManualUsuario } from "../components/ManualUsuario";
import { ServidorConfig } from "../components/ServidorConfig";
import { Explorador } from "../components/Explorador";
import { AutoTextarea } from "../components/AutoTextarea";

/** Datos de pago (banco/cuenta/titular) + carpeta donde se guardan los PDF, que usan
 *  las cuentas de cobro. Editable solo por Super; guardado como parámetros clave-valor. */
function DatosCobroCard() {
  const toast = useToast();
  const [f, setF] = useState({ banco: "", tipo_cuenta: "Ahorros", numero_cuenta: "", titular: "", carpeta: "", nota_383: "" });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [explorar, setExplorar] = useState(false);
  useEffect(() => {
    api.get("/config/cobro").then((d: any) => setF(d)).catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, []); // eslint-disable-line
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const guardar = async () => {
    setGuardando(true);
    try { const d: any = await api.put("/config/cobro", f); setF(d); toast("Datos de cobro guardados ✓"); }
    catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };
  return (
    <div className="card">
      <div className="card-h"><SecTitle icon="coins">Datos de cobro</SecTitle></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 580 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="grid2">
              <div className="f"><label>Banco</label><input value={f.banco} onChange={(e) => set({ banco: e.target.value })} placeholder="Ej. Bancolombia" /></div>
              <div className="f"><label>Tipo de cuenta</label><select value={f.tipo_cuenta} onChange={(e) => set({ tipo_cuenta: e.target.value })}><option>Ahorros</option><option>Corriente</option></select></div>
              <div className="f"><label>Número de cuenta</label><input value={f.numero_cuenta} onChange={(e) => set({ numero_cuenta: e.target.value })} placeholder="Ej. 78400013127" /></div>
              <div className="f"><label>Titular</label><input value={f.titular} onChange={(e) => set({ titular: e.target.value })} placeholder="Ej. Cardona & Cardona Consultores S.A.S" /></div>
            </div>
            <div className="f" style={{ marginTop: 10 }}><label>Carpeta de las cuentas de cobro
              <button type="button" className="lbl-ic" title="Elegir carpeta…" onClick={() => setExplorar(true)}><Icon name="folder" size={14} /></button></label>
              <input value={f.carpeta} onChange={(e) => set({ carpeta: e.target.value })} placeholder="Carpeta base donde se guardan los PDF (se organiza por año)" />
            </div>
            <div className="f" style={{ marginTop: 10 }}><label>Nota art. 383 ET</label>
              <AutoTextarea value={f.nota_383} onChange={(e) => set({ nota_383: e.target.value })} minRows={3}
                placeholder="Texto de la nota del art. 383 ET" />
            </div>
            <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--card-2)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              <b>Así saldrá en la cuenta de cobro:</b><br />
              Por favor efectuar el pago en: consignación en la cuenta de {f.tipo_cuenta || "—"} N° {f.numero_cuenta || "—"} a nombre de {f.titular || "—"} del banco {f.banco || "—"}.
            </div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={guardar} disabled={guardando}><Icon name="save" size={16} />{guardando ? "Guardando…" : "Guardar"}</button></div>
          </>
        )}
      </div>
      {explorar && <Explorador modo="carpeta" onSelect={(ruta) => set({ carpeta: ruta })} onClose={() => setExplorar(false)} />}
    </div>
  );
}

/** Plantilla del correo (asunto + cuerpo) con que se envían las cuentas de cobro.
 *  El envío lo hace cada responsable desde SU propio correo (ver "Mi correo"). Solo Super. */
function CorreoEnvioCard() {
  const toast = useToast();
  const [f, setF] = useState({ asunto: "", cuerpo: "" });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    api.get("/config/correo").then((d: any) => setF({ asunto: d.asunto, cuerpo: d.cuerpo }))
      .catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, []); // eslint-disable-line
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const guardar = async () => {
    setGuardando(true);
    try { const d: any = await api.put("/config/correo", f); setF({ asunto: d.asunto, cuerpo: d.cuerpo }); toast("Plantilla guardada ✓"); }
    catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };
  return (
    <div className="card">
      <div className="card-h"><SecTitle icon="mail">Plantilla del correo</SecTitle></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 620 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="f"><label>Asunto del correo</label><input value={f.asunto} onChange={(e) => set({ asunto: e.target.value })} /></div>
            <div className="f" style={{ marginTop: 10 }}><label>Cuerpo del correo</label><AutoTextarea value={f.cuerpo} onChange={(e) => set({ cuerpo: e.target.value })} minRows={5} /></div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>Variables disponibles: {"{numero} {mes} {anio} {cliente} {emisor}"}</div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={guardar} disabled={guardando}><Icon name="save" size={16} />{guardando ? "Guardando…" : "Guardar"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** Texto base del aviso de reasignación (asunto + introducción + cierre). La tabla la
 *  arma la app; aquí solo el texto, editable también por-envío en el modal. Solo Super. */
function CorreoReasignacionCard() {
  const toast = useToast();
  const [f, setF] = useState({ asunto: "", intro: "", cierre: "" });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    api.get("/config/reasig-correo").then((d: any) => setF({ asunto: d.asunto, intro: d.intro, cierre: d.cierre }))
      .catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, []); // eslint-disable-line
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const guardar = async () => {
    setGuardando(true);
    try { const d: any = await api.put("/config/reasig-correo", f); setF({ asunto: d.asunto, intro: d.intro, cierre: d.cierre }); toast("Texto base guardado ✓"); }
    catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };
  return (
    <div className="card">
      <div className="card-h"><SecTitle icon="mail">Correo de reasignación</SecTitle></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 680 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="f"><label>Asunto</label><input value={f.asunto} onChange={(e) => set({ asunto: e.target.value })} /></div>
            <div className="f" style={{ marginTop: 10 }}><label>Introducción</label><AutoTextarea value={f.intro} onChange={(e) => set({ intro: e.target.value })} minRows={3} /></div>
            <div className="f" style={{ marginTop: 10 }}><label>Cierre</label><AutoTextarea value={f.cierre} onChange={(e) => set({ cierre: e.target.value })} minRows={5} /></div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>Variables disponibles: {"{responsable} {periodo} {mes_nom} {anio}"}</div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={guardar} disabled={guardando}><Icon name="save" size={16} />{guardando ? "Guardando…" : "Guardar"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** Pie de correo corporativo (firma/contacto) que va al pie de los correos de la
 *  firma — hoy el estado de cuenta de cartera. Editable solo por Super. */
function PieCorreoCard() {
  const toast = useToast();
  const [f, setF] = useState({ nit: "", nombre: "", cargo: "", telefono: "", correo: "", ciudad: "", web: "", facebook: "", instagram: "", legal: "" });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    api.get("/config/pie-correo").then((d: any) => setF(d)).catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, []); // eslint-disable-line
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const guardar = async () => {
    setGuardando(true);
    try { const d: any = await api.put("/config/pie-correo", f); setF(d); toast("Pie de correo guardado ✓"); }
    catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };
  return (
    <div className="card">
      <div className="card-h"><SecTitle icon="mail">Pie de correo</SecTitle></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 620 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="grid2">
              <div className="f"><label>NIT de la firma</label><input value={f.nit} onChange={(e) => set({ nit: e.target.value })} /></div>
              <div className="f"><label>Ciudad</label><input value={f.ciudad} onChange={(e) => set({ ciudad: e.target.value })} /></div>
              <div className="f"><label>Nombre (contacto)</label><input value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} /></div>
              <div className="f"><label>Cargo</label><input value={f.cargo} onChange={(e) => set({ cargo: e.target.value })} /></div>
              <div className="f"><label>Teléfono</label><input value={f.telefono} onChange={(e) => set({ telefono: e.target.value })} /></div>
              <div className="f"><label>Correo</label><input value={f.correo} onChange={(e) => set({ correo: e.target.value })} /></div>
              <div className="f"><label>Página web</label><input value={f.web} onChange={(e) => set({ web: e.target.value })} /></div>
              <div className="f"><label>Facebook</label><input value={f.facebook} onChange={(e) => set({ facebook: e.target.value })} /></div>
              <div className="f"><label>Instagram</label><input value={f.instagram} onChange={(e) => set({ instagram: e.target.value })} /></div>
            </div>
            <div className="f" style={{ marginTop: 10 }}><label>Línea legal</label>
              <AutoTextarea value={f.legal} onChange={(e) => set({ legal: e.target.value })} minRows={2} />
            </div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={guardar} disabled={guardando}><Icon name="save" size={16} />{guardando ? "Guardando…" : "Guardar"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** Plantilla del mensaje de WhatsApp de cartera (editable por Super). */
function WaPlantillaCard() {
  const toast = useToast();
  const [plantilla, setPlantilla] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    api.get("/config/wa").then((d: any) => setPlantilla(d.plantilla)).catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, []); // eslint-disable-line
  const guardar = async () => {
    setGuardando(true);
    try { const d: any = await api.put("/config/wa", { plantilla }); setPlantilla(d.plantilla); toast("Mensaje de WhatsApp guardado ✓"); }
    catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };
  return (
    <div className="card">
      <div className="card-h"><SecTitle icon="whatsapp">Mensaje WhatsApp</SecTitle></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 620 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="f"><label>Plantilla del mensaje</label>
              <AutoTextarea value={plantilla} onChange={(e) => setPlantilla(e.target.value)} minRows={6} /></div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>Variables: {"{saludo} {cliente} {total} {firma} {banco} {tipo_cuenta} {numero_cuenta} {titular}"}</div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={guardar} disabled={guardando}><Icon name="save" size={16} />{guardando ? "Guardando…" : "Guardar"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** Mi correo (Graph delegado): cada responsable conecta su cuenta de Microsoft
 *  365 una sola vez (código de dispositivo) y la app envía los correos a su
 *  nombre. No requiere Azure ni Outlook de escritorio. */
function MiCorreoCard() {
  const toast = useToast();
  const [estado, setEstado] = useState<{ conectado: boolean; cuenta: string }>({ conectado: false, cuenta: "" });
  const [cargando, setCargando] = useState(true);
  const [errCarga, setErrCarga] = useState(false);
  const [flujo, setFlujo] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [esperando, setEsperando] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Si la consulta falla (p.ej. el servidor reiniciando por un release) NO afirmamos
  // "no conectado" —eso asusta sin motivo—: marcamos el error y ofrecemos reintentar.
  const cargar = () => api.get("/config/mi-correo").then((d: any) => { setEstado(d); setErrCarga(false); }).catch(() => setErrCarga(true)).finally(() => setCargando(false));
  const reintentar = () => { setCargando(true); cargar(); };
  useEffect(() => { cargar(); return () => { if (pollRef.current) window.clearInterval(pollRef.current); }; }, []); // eslint-disable-line

  const detener = (msg?: string) => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    setEsperando(false); setFlujo(null);
    if (msg) toast(msg, true);
  };
  const conectar = async () => {
    setEsperando(true);
    try {
      const d: any = await api.post("/config/mi-correo/iniciar", {});
      setFlujo({ user_code: d.user_code, verification_uri: d.verification_uri });
      try { window.open(d.verification_uri, "_blank"); } catch { /* el usuario abre el enlace a mano */ }
      const vence = Date.now() + (d.expires_in || 900) * 1000;
      pollRef.current = window.setInterval(async () => {
        if (Date.now() > vence) { detener("El código expiró, intenta de nuevo."); return; }
        try {
          const r: any = await api.post("/config/mi-correo/completar", { device_code: d.device_code });
          if (r.estado === "ok") { detener(); setEstado({ conectado: true, cuenta: r.cuenta }); toast(`Correo conectado: ${r.cuenta} ✓`); }
          else if (r.estado === "error") { detener(r.mensaje || "No se completó el inicio de sesión."); }
        } catch { /* reintentar en el próximo tick */ }
      }, Math.max(3, d.interval || 5) * 1000);
    } catch (e: any) { toast(e.message, true); setEsperando(false); }
  };
  const desconectar = async () => {
    try { await api.post("/config/mi-correo/desconectar", {}); setEstado({ conectado: false, cuenta: "" }); toast("Correo desconectado"); }
    catch (e: any) { toast(e.message, true); }
  };

  return (
    <div className="card">
      <div className="card-h"><SecTitle icon="mail">Mi correo</SecTitle></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 560 }}>
        {cargando ? <div className="hint">Cargando…</div> : errCarga ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="hint">No pude verificar el estado de tu correo (¿el servidor estaba reiniciando?). Tu conexión no se perdió; reintenta.</div>
            <div><button className="btn sm" onClick={reintentar}><Icon name="mail" size={15} />Reintentar</button></div>
          </div>
        ) : estado.conectado ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="srv-dot" /><div style={{ flex: 1 }}>Conectado como <b>{estado.cuenta || "—"}</b></div>
            <button className="btn sm" onClick={desconectar}><Icon name="x" size={15} />Desconectar</button>
          </div>
        ) : flujo ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>1. Se abrió <a href={flujo.verification_uri} target="_blank" rel="noreferrer">{flujo.verification_uri}</a> (si no, ábrelo tú).</div>
            <div>2. Escribe este código e inicia sesión con tu correo de la firma:</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, fontFamily: "monospace", color: "var(--primary)" }}>{flujo.user_code}</div>
            <div className="hint">Esperando a que completes el inicio de sesión…</div>
            <div><button className="btn sm ghost" onClick={() => detener()}>Cancelar</button></div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="hint">Aún no has conectado tu correo. Se hace una sola vez.</div>
            <div><button className="btn primary" onClick={conectar} disabled={esperando}><Icon name="mail" size={16} />Conectar mi correo</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pantalla Configuración: agrupa en pestañas los ajustes de administración.
 *  - "Manual de usuario": visible para todos. El resto: solo config.roles (Super).
 *  Por eso la pantalla es visible para todos; las pestañas se filtran por permiso. */
interface SesionRow { id: number; usuario: string; usuario_login: string; equipo: string; inicio: string | null; ultima_actividad: string | null; colgada: boolean; }
const fmtSes = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Monitor de sesiones activas (admin): quién está conectado y en qué equipo;
 *  permite cerrar una sesión (el equipo queda deslogueado en su próxima acción).
 *  Regla: una sola sesión activa por usuario a la vez. */
function SesionesCard({ active }: { active: boolean }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [rows, setRows] = useState<SesionRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cerrando, setCerrando] = useState<number | null>(null);

  const cargar = () => api.get("/sesiones")
    .then((r: SesionRow[]) => setRows(r))
    .catch((e: any) => toast(e.message, true))
    .finally(() => setCargando(false));
  useEffect(() => {
    if (!active) return;
    cargar();
    const t = window.setInterval(cargar, 15_000);
    return () => window.clearInterval(t);
  }, [active]); // eslint-disable-line

  const cerrar = async (s: SesionRow) => {
    if ((await confirmar({
      titulo: "Cerrar sesión", peligro: true, confirmar: "Cerrar",
      mensaje: `Se cerrará la sesión de ${s.usuario} en «${s.equipo}». El equipo quedará deslogueado en su próxima acción.`,
    })) !== "si") return;
    setCerrando(s.id);
    try { await api.del(`/sesiones/${s.id}`); toast("Sesión cerrada ✓"); cargar(); }
    catch (e: any) { toast(e.message, true); }
    finally { setCerrando(null); }
  };

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SecTitle icon="resp">Sesiones activas</SecTitle>
        <button className="btn sm" onClick={cargar} title="Actualizar"><Icon name="refresh" size={15} /> Actualizar</button>
      </div>
      <div style={{ padding: 16 }}>
        {cargando ? <div className="hint">Cargando…</div>
          : rows.length === 0 ? <div className="hint">No hay sesiones activas.</div>
          : (
            <table className="cxc-ec">
              <thead><tr><th>Usuario</th><th>Equipo</th><th>Inicio</th><th>Última actividad</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.usuario}</b>{s.usuario_login ? <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{s.usuario_login}</div> : null}</td>
                    <td>{s.equipo}</td>
                    <td>{fmtSes(s.inicio)}</td>
                    <td>{fmtSes(s.ultima_actividad)}</td>
                    <td><span className={"cxc-chip " + (s.colgada ? "cxc-g-sin" : "cxc-g-ok")}>{s.colgada ? "Inactiva" : "Activa"}</span></td>
                    <td className="r"><button className="btn sm danger" disabled={cerrando === s.id} onClick={() => cerrar(s)}><Icon name="logout" size={14} /> Cerrar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

export function Config({ active = true, puede }: { active?: boolean; puede: (c: string) => boolean }) {
  const sup = puede("config.roles");
  const tabs = [
    ...(sup ? [{ k: "roles", lbl: "Roles y permisos", icon: "shield-check" }] : []),
    { k: "manual", lbl: "Manual de usuario", icon: "file" },
    { k: "micorreo", lbl: "Mi correo", icon: "mail" },
    ...(sup ? [{ k: "sesiones", lbl: "Sesiones", icon: "resp" }] : []),
    ...(sup ? [{ k: "cobro", lbl: "Datos de cobro", icon: "coins" }] : []),
    ...(sup ? [{ k: "correo", lbl: "Plantilla del correo", icon: "mail" }] : []),
    ...(sup ? [{ k: "reasig", lbl: "Correo de reasignación", icon: "mail" }] : []),
    ...(sup ? [{ k: "pie", lbl: "Pie de correo", icon: "mail" }] : []),
    ...(sup ? [{ k: "wa", lbl: "Mensaje WhatsApp", icon: "whatsapp" }] : []),
    ...(sup ? [{ k: "servidor", lbl: "Servidor de datos", icon: "gear" }] : []),
  ];
  const [tab, setTab] = useState(tabs[0].k);

  return (
    <>
      <div className="cfg-tabs">
        {tabs.map((t) => (
          <button key={t.k} className={"cfg-tab" + (tab === t.k ? " on" : "")} onClick={() => setTab(t.k)}>
            <Icon name={t.icon} size={16} />{t.lbl}
          </button>
        ))}
      </div>
      {tab === "roles" && sup && <RolesPermisos active={active && tab === "roles"} />}
      {tab === "sesiones" && sup && <SesionesCard active={active && tab === "sesiones"} />}
      {tab === "manual" && <ManualUsuario />}
      {tab === "micorreo" && <MiCorreoCard />}
      {tab === "cobro" && sup && <DatosCobroCard />}
      {tab === "correo" && sup && <CorreoEnvioCard />}
      {tab === "reasig" && sup && <CorreoReasignacionCard />}
      {tab === "pie" && sup && <PieCorreoCard />}
      {tab === "wa" && sup && <WaPlantillaCard />}
      {tab === "servidor" && sup && <ServidorConfig variant="panel" />}
    </>
  );
}
