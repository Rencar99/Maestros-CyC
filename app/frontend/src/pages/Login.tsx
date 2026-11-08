import { useEffect, useState } from "react";
import { api, setToken } from "../api";
import { Responsable } from "../types";
import { Icon } from "../ui";
import { ServidorConfig } from "../components/ServidorConfig";

export function Login({ onOk }: { onOk: (u: Responsable) => void }) {
  const [usuarios, setUsuarios] = useState<{ usuario: string; nombre: string }[]>([]);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [cfgServidor, setCfgServidor] = useState(false);

  // Si llegamos al login porque la sesión se cerró (se inició en otro equipo o la
  // cerró un admin), mostrar el motivo.
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("maestros_logout_msg");
      if (m) { setErr(m); sessionStorage.removeItem("maestros_logout_msg"); }
    } catch { /* ignore */ }
  }, []);

  // Lista de responsables internos activos para el desplegable.
  useEffect(() => {
    api.get("/auth/usuarios")
      .then((us: { usuario: string; nombre: string }[]) => {
        setUsuarios(us);
        if (us.length) setUsuario((p) => p || us[0].usuario);
      })
      .catch(() => setUsuarios([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await api.post("/auth/login", { usuario: usuario.trim(), password });
      setToken(r.token);
      const me = await api.get("/auth/me");
      onOk(me);
    } catch (ex: any) { setErr(ex.message || "No se pudo iniciar sesión"); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-photo">
          <img src="/assets/login-hero.jpg" alt="Red de clientes y responsables de la firma" />
          <div className="lp-veil" />
          <div className="lp-top">
            <span className="lp-mark"><img src="/assets/logo-icono-t.png" alt="" /></span>
            <span className="lp-wm">Cardona Apps</span>
          </div>
          <div className="lp-cap">
            <div className="lp-kick"><span className="lp-dot" /> Red de la firma</div>
            <h1 className="lp-h1">Clientes y responsables, <span>conectados</span><br />para toda la firma.</h1>
          </div>
        </div>

        <div className="login-panel">
          <form className="login-form" onSubmit={submit} autoComplete="off">
            <img src="/assets/logo-full-t.png" alt="Cardona & co." className="login-logo solo-cla" />
            <img src="/assets/logo-blanco-t.png" alt="Cardona & co." className="login-logo solo-osc" />
            <div className="login-kicker">Maestros · Cardona Apps</div>
            <h2 className="login-title">Bienvenido</h2>
            <p className="login-lead">Selecciona tu usuario e ingresa tu clave.</p>

            <div className="fld" style={{ marginBottom: 14 }}>
              <label>Usuario</label>
              {usuarios.length > 0 ? (
                <select className="inp" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                  {usuarios.map((u) => <option key={u.usuario} value={u.usuario}>{u.nombre}</option>)}
                </select>
              ) : (
                <input className="inp" value={usuario} onChange={(e) => setUsuario(e.target.value)}
                  placeholder="Tu usuario" autoFocus />
              )}
            </div>
            <div className="fld" style={{ marginBottom: 6 }}>
              <label>Clave</label>
              <div style={{ position: "relative" }}>
                <input className="inp" type={showPw ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
                  autoFocus={usuarios.length > 0} style={{ width: "100%", paddingRight: 46 }} />
                <button type="button" className={"pw-eye" + (showPw ? " on" : "")} onClick={() => setShowPw(!showPw)}
                  title={showPw ? "Ocultar clave" : "Ver clave"} aria-label="Ver clave">
                  <Icon name="eye" size={17} />
                </button>
              </div>
            </div>

            {err && <div className="login-err">{err}</div>}

            <button className="btn primary login-btn" type="submit" disabled={loading}>
              <Icon name="lock" size={16} /> {loading ? "Ingresando…" : "Ingresar"}
            </button>

            <div className="login-foot">
              <div><Icon name="lock" size={13} /> Acceso protegido para usuarios autorizados de la firma.</div>
              <div className="login-foot-2">Uso exclusivo de Cardona &amp; Cardona Consultores S.A.S.</div>
              <button type="button" className="login-srv" onClick={() => setCfgServidor(true)}>
                <Icon name="gear" size={13} /> Cambiar servidor
              </button>
            </div>
          </form>
        </div>
      </div>
      {cfgServidor && <ServidorConfig variant="modal" onClose={() => setCfgServidor(false)} />}
    </div>
  );
}
