import { useEffect, useState } from "react";
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

/** Cuenta de correo (Microsoft 365 / Graph) desde la que se envían las cuentas de
 *  cobro. El secreto se guarda cifrado y nunca se devuelve en claro. Solo Super. */
function CorreoEnvioCard() {
  const toast = useToast();
  const [f, setF] = useState({ remitente: "", tenant: "", client_id: "", client_secret: "", asunto: "", cuerpo: "" });
  const [tieneSecret, setTieneSecret] = useState(false);
  const [configurado, setConfigurado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    api.get("/config/correo").then((d: any) => {
      setF({ remitente: d.remitente, tenant: d.tenant, client_id: d.client_id, client_secret: "", asunto: d.asunto, cuerpo: d.cuerpo });
      setTieneSecret(!!d.tiene_secret); setConfigurado(!!d.configurado);
    }).catch((e: any) => toast(e.message, true)).finally(() => setCargando(false));
  }, []); // eslint-disable-line
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const guardar = async () => {
    setGuardando(true);
    try {
      const d: any = await api.put("/config/correo", f);
      setF((x) => ({ ...x, client_secret: "", asunto: d.asunto, cuerpo: d.cuerpo }));
      setTieneSecret(!!d.tiene_secret); setConfigurado(!!d.configurado);
      toast("Cuenta de correo guardada ✓");
    } catch (e: any) { toast(e.message, true); } finally { setGuardando(false); }
  };
  return (
    <div className="card">
      <div className="card-h"><div><SecTitle icon="mail">Correo de envío</SecTitle>
        <div className="hint">Cuenta Microsoft 365 desde la que se envían las cuentas de cobro (Graph). {configurado ? "Configurada ✓" : "Sin configurar."}</div></div></div>
      <div style={{ padding: "14px 16px 18px", maxWidth: 620 }}>
        {cargando ? <div className="hint">Cargando…</div> : (
          <>
            <div className="grid2">
              <div className="f"><label>Remitente (buzón de la firma)</label><input value={f.remitente} onChange={(e) => set({ remitente: e.target.value })} placeholder="facturacion@cardonaycardona.com" /></div>
              <div className="f"><label>Directory (tenant) ID</label><input value={f.tenant} onChange={(e) => set({ tenant: e.target.value })} placeholder="de Azure (App registration)" /></div>
              <div className="f"><label>Application (client) ID</label><input value={f.client_id} onChange={(e) => set({ client_id: e.target.value })} placeholder="de Azure (App registration)" /></div>
              <div className="f"><label>Client secret</label><input type="password" value={f.client_secret} onChange={(e) => set({ client_secret: e.target.value })} placeholder={tieneSecret ? "•••••• (guardado) — deja vacío para conservar" : "valor del secret de Azure"} /></div>
            </div>
            <div className="f" style={{ marginTop: 10 }}><label>Asunto del correo</label><input value={f.asunto} onChange={(e) => set({ asunto: e.target.value })} /></div>
            <div className="f" style={{ marginTop: 10 }}><label>Cuerpo del correo</label><textarea rows={5} value={f.cuerpo} onChange={(e) => set({ cuerpo: e.target.value })} style={{ width: "100%", resize: "vertical" }} /></div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>Variables disponibles: {"{numero} {mes} {anio} {cliente}"}</div>
            <div style={{ marginTop: 16 }}><button className="btn primary" onClick={guardar} disabled={guardando}><Icon name="save" size={16} />{guardando ? "Guardando…" : "Guardar"}</button></div>
          </>
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
    ...(sup ? [{ k: "cobro", lbl: "Datos de cobro", icon: "coins" }] : []),
    ...(sup ? [{ k: "correo", lbl: "Correo de envío", icon: "mail" }] : []),
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
      {tab === "cobro" && sup && <DatosCobroCard />}
      {tab === "correo" && sup && <CorreoEnvioCard />}
      {tab === "servidor" && sup && <ServidorConfig variant="panel" />}
    </>
  );
}
