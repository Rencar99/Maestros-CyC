import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon, SecTitle, useToast } from "../ui";
import { Modal } from "./Modal";

export interface ServidorInfo {
  host: string; puerto: number; es_postgres: boolean;
  personalizado: boolean; conectado?: boolean;
}

/** Configura la IP/host y el puerto del servidor de datos (Postgres de la firma).
 *  - variant="pantalla": pantalla completa antes del login (la base no responde).
 *  - variant="modal": modal arrastrable (desde el login o Configuración). */
export function ServidorConfig({ variant, onListo, onClose }: {
  variant: "pantalla" | "modal" | "panel";
  onListo?: () => void;
  onClose?: () => void;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<ServidorInfo | null>(null);
  const [ip, setIp] = useState("");
  const [puerto, setPuerto] = useState(5432);
  const [probando, setProbando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [prueba, setPrueba] = useState<{ ok: boolean; msg: string } | null>(null);

  const cargar = () => api.get("/servidor")
    .then((i: ServidorInfo) => { setInfo(i); setIp(i.host); setPuerto(i.puerto || 5432); })
    .catch(() => {});
  useEffect(() => { cargar(); }, []);

  const puertoValido = puerto >= 1 && puerto <= 65535;
  const puedeGuardar = !!ip.trim() && puertoValido && !guardando && !probando;

  const probar = async () => {
    if (!ip.trim() || !puertoValido) return;
    setProbando(true); setPrueba(null);
    try { const r: any = await api.query("/servidor/probar", { ip: ip.trim(), puerto: Number(puerto) }); setPrueba({ ok: r.ok, msg: r.mensaje }); }
    catch (e: any) { setPrueba({ ok: false, msg: e.message }); }
    finally { setProbando(false); }
  };

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true); setPrueba(null);
    try {
      const i: ServidorInfo = await api.post("/servidor", { ip: ip.trim(), puerto: Number(puerto) });
      setInfo({ ...i, conectado: true });
      setPrueba({ ok: true, msg: "Conectado. Servidor actualizado." });
      toast("Servidor actualizado y reconectado ✓");
      onListo?.();
    } catch (e: any) { setPrueba({ ok: false, msg: e.message }); }
    finally { setGuardando(false); }
  };

  const campos = (
    <>
      {info && (
        <div className="srv-actual">
          <span style={{ color: "var(--ink-3)" }}>Servidor actual:</span>
          <b>{info.host || "—"}:{info.puerto || "—"}</b>
          <span className={"pill " + (info.conectado ? "ok" : "off")}>{info.conectado ? "Conectado" : "Sin conexión"}</span>
          {info.personalizado && <span className="tag jur">personalizado</span>}
        </div>
      )}
      <div className="srv-form">
        <div className="fld"><label>Dirección del servidor (IP o nombre) <span className="req">*</span></label>
          <input className="inp" value={ip} placeholder="DESKTOP-N8VFD87" onChange={(e) => { setIp(e.target.value); setPrueba(null); }} />
        </div>
        <div className="fld"><label>Puerto <span className="req">*</span></label>
          <input className="inp" type="number" min={1} max={65535} value={puerto} onChange={(e) => { setPuerto(Number(e.target.value)); setPrueba(null); }} />
        </div>
      </div>
      {prueba && (
        <div className={"srv-msg " + (prueba.ok ? "ok" : "err")}>
          <Icon name={prueba.ok ? "check-circle" : "alert"} size={15} /> {prueba.msg}
        </div>
      )}
    </>
  );
  const botones = (
    <div className="srv-btns">
      <button className="btn" onClick={probar} disabled={!ip.trim() || !puertoValido || probando || guardando}>
        <Icon name="refresh" size={15} /> {probando ? "Probando…" : "Probar conexión"}
      </button>
      <button className="btn primary" onClick={guardar} disabled={!puedeGuardar}>
        <Icon name="save" size={16} /> {guardando ? "Guardando…" : "Guardar y reconectar"}
      </button>
    </div>
  );

  // Modal estándar: Guardar = acción primaria (onSave), Probar = acción secundaria.
  if (variant === "modal") {
    return (
      <Modal title="Servidor de datos" sub="IP/host y puerto de la Postgres de la firma" icon="gear" size="md"
        onClose={onClose || (() => {})} onSave={guardar} canSave={puedeGuardar} saving={guardando}
        saveLabel="Guardar y reconectar" saveIcon="save"
        extraActions={<button className="mh-act" onClick={probar} disabled={!ip.trim() || !puertoValido || probando || guardando} aria-label="Probar conexión"><Icon name="refresh" size={18} /><span className="mh-tip">{probando ? "Probando…" : "Probar conexión"}</span></button>}>
        {campos}
      </Modal>
    );
  }

  // Panel embebido (pestaña de Configuración): tarjeta estándar con encabezado.
  if (variant === "panel") {
    return (
      <div className="card">
        <div className="card-h"><SecTitle icon="gear">Servidor de datos</SecTitle></div>
        <div style={{ padding: "14px 16px 18px" }}>{campos}{botones}</div>
      </div>
    );
  }

  // Pantalla completa pre-login (la base no responde).
  return (
    <div className="srv-screen">
      <div className="card srv-card">
        <div className="srv-screen-head">
          <img src="/assets/logo-full-t.png" alt="Cardona & co." />
          <div className="srv-screen-ic"><Icon name="alert" size={22} /></div>
          <h2>Sin conexión con el servidor</h2>
          <p>La aplicación no pudo conectarse al servidor de datos. Si el servidor cambió de dirección, corrige la IP/host y el puerto aquí.</p>
        </div>
        <div className="srv-screen-body">{campos}{botones}</div>
        <div className="srv-screen-foot">
          <button className="btn" onClick={onListo}>Continuar al inicio de sesión</button>
        </div>
      </div>
    </div>
  );
}
