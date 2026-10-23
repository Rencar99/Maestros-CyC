import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon, SecTitle, useToast } from "../ui";
import { RolesPermisos } from "./RolesPermisos";
import { ManualUsuario } from "../components/ManualUsuario";
import { ServidorConfig } from "../components/ServidorConfig";
import { Explorador } from "../components/Explorador";

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
      <div className="card-h"><div><SecTitle icon="coins">Datos de cobro</SecTitle><div className="hint">Datos de pago que aparecen en las cuentas de cobro.</div></div></div>
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
              <textarea value={f.nota_383} onChange={(e) => set({ nota_383: e.target.value })} rows={3}
                placeholder="Texto de la nota del art. 383 ET" style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
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
      <div className="card-h"><div><SecTitle icon="mail">Plantilla del correo</SecTitle>
        <div className="hint">Asunto y cuerpo del correo con que se envían las cuentas de cobro. Cada responsable las envía desde su propio correo (pestaña "Mi correo").</div></div></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 620 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="f"><label>Asunto del correo</label><input value={f.asunto} onChange={(e) => set({ asunto: e.target.value })} /></div>
            <div className="f" style={{ marginTop: 10 }}><label>Cuerpo del correo</label><textarea rows={5} value={f.cuerpo} onChange={(e) => set({ cuerpo: e.target.value })} style={{ width: "100%", resize: "vertical" }} /></div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>Variables disponibles: {"{numero} {mes} {anio} {cliente}"}</div>
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
      <div className="card-h"><div><SecTitle icon="mail">Mi correo</SecTitle><div className="hint">Conecta tu correo de Microsoft 365 para enviar los documentos a tu nombre.</div></div></div>
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
export function Config({ active = true, puede }: { active?: boolean; puede: (c: string) => boolean }) {
  const sup = puede("config.roles");
  const tabs = [
    ...(sup ? [{ k: "roles", lbl: "Roles y permisos", icon: "shield-check" }] : []),
    { k: "manual", lbl: "Manual de usuario", icon: "file" },
    { k: "micorreo", lbl: "Mi correo", icon: "mail" },
    ...(sup ? [{ k: "cobro", lbl: "Datos de cobro", icon: "coins" }] : []),
    ...(sup ? [{ k: "correo", lbl: "Plantilla del correo", icon: "mail" }] : []),
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
      {tab === "manual" && <ManualUsuario />}
      {tab === "micorreo" && <MiCorreoCard />}
      {tab === "cobro" && sup && <DatosCobroCard />}
      {tab === "correo" && sup && <CorreoEnvioCard />}
      {tab === "servidor" && sup && <ServidorConfig variant="panel" />}
    </>
  );
}
