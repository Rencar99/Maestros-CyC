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
    try { const r: any = await api.post("/servidor/probar", { ip: ip.trim(), puerto: Number(puerto) }); setPrueba({ ok: r.ok, msg: r.mensaje }); }
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

  const cuerpo = (
    <>
      {info && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ color: "var(--ink-3)" }}>Servidor actual:</span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{info.host || "—"}:{info.puerto || "—"}</b>
          <span className="pill" style={{ background: info.conectado ? "var(--ok-bg)" : "var(--err-bg)", color: info.conectado ? "var(--ok)" : "var(--err)", border: "none" }}>
            {info.conectado ? "Conectado" : "Sin conexión"}
          </span>
          {info.personalizado && <span className="tag jur">personalizado</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "6px 14px" }}>
        <div className="fld"><label>Dirección del servidor (IP o nombre) <span className="req">*</span></label>
          <input className="inp" value={ip} placeholder="apps-cyc  ·  192.168.8.28" onChange={(e) => { setIp(e.target.value); setPrueba(null); }} />
        </div>
        <div className="fld"><label>Puerto <span className="req">*</span></label>
          <input className="inp" type="number" min={1} max={65535} value={puerto} onChange={(e) => { setPuerto(Number(e.target.value)); setPrueba(null); }} />
        </div>
      </div>

      {prueba && (
        <div style={{ marginTop: 12, fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, color: prueba.ok ? "var(--ok)" : "var(--err)" }}>
          <Icon name={prueba.ok ? "check-circle" : "alert"} size={15} /> {prueba.msg}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn" onClick={probar} disabled={!ip.trim() || !puertoValido || probando || guardando}>
          <Icon name="refresh" size={15} /> {probando ? "Probando…" : "Probar conexión"}
        </button>
        <button className="btn primary" onClick={guardar} disabled={!puedeGuardar}>
          <Icon name="save" size={16} /> {guardando ? "Guardando…" : "Guardar y reconectar"}
        </button>
      </div>
      <small className="hint" style={{ display: "block", marginTop: 12 }}>
        Solo cambia <b>a qué servidor</b> se conecta este equipo (IP/host y puerto). Las credenciales de la
        base no se muestran ni se modifican. Úsalo si el servidor cambió de dirección.
      </small>
    </>
  );

  if (variant === "modal") {
    return (
      <Modal title="Servidor de datos" sub="IP/host y puerto de la Postgres de la firma" icon="gear" size="md"
        onClose={onClose || (() => {})}>
        {cuerpo}
      </Modal>
    );
  }

  // Panel embebido (pestaña de Configuración): tarjeta estándar con encabezado.
  if (variant === "panel") {
    return (
      <div className="card">
        <div className="card-h">
          <div>
            <SecTitle icon="gear">Servidor de datos</SecTitle>
            <div className="hint">IP/host y puerto de la Postgres de la firma</div>
          </div>
        </div>
        <div style={{ padding: "14px 16px 18px" }}>{cuerpo}</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--page)", padding: 24 }}>
      <div className="card" style={{ width: 540, maxWidth: "94vw" }}>
        <div style={{ padding: "26px 28px 4px", textAlign: "center" }}>
          <img src="/assets/logo-full-t.png" alt="Cardona & co." style={{ height: 34, margin: "0 auto 16px", display: "block" }} />
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--warn-bg)", color: "var(--warn)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
            <Icon name="alert" size={22} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", margin: 0 }}>Sin conexión con el servidor</h2>
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "8px auto 0", maxWidth: 410 }}>
            La aplicación no pudo conectarse al servidor de datos. Si el servidor cambió de dirección,
            corrige la IP/host y el puerto aquí.
          </p>
        </div>
        <div style={{ padding: "16px 28px 22px" }}>{cuerpo}</div>
        <div style={{ padding: "14px 28px", borderTop: "1px solid var(--line)", textAlign: "center" }}>
          <button className="btn" onClick={onListo}>Continuar al inicio de sesión</button>
        </div>
      </div>
    </div>
  );
}
