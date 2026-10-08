import { useEffect, useState } from "react";
import { api, setToken } from "../api";
import { Responsable } from "../types";
import { Icon } from "../ui";
import { ServidorConfig } from "../components/ServidorConfig";

// Red de "terceros" del hero: nodos (x, y, tamaño) + enlaces.
// El ocre "viaja" de izquierda a derecha: el retraso `d` se asigna por orden en X
// (paso 0.7s) para que se enciendan de uno en uno, como una ola.
const HERO_NODOS = [
  { x: 200, y: 168, s: 36, d: 2.1 },   // central (más grande)
  { x: 92, y: 74, s: 24, d: 0.7 }, { x: 308, y: 80, s: 24, d: 4.2 },
  { x: 54, y: 196, s: 22, d: 0.0 }, { x: 346, y: 186, s: 24, d: 4.9 },
  { x: 136, y: 296, s: 22, d: 1.4 }, { x: 274, y: 292, s: 24, d: 3.5 },
  { x: 200, y: 44, s: 22, d: 2.8 },
];
const HERO_ENLACES = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
  [1, 7], [2, 7], [3, 5], [4, 6], [1, 3], [2, 4]];

export function Login({ onOk }: { onOk: (u: Responsable) => void }) {
  const [usuarios, setUsuarios] = useState<{ usuario: string; nombre: string }[]>([]);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [cfgServidor, setCfgServidor] = useState(false);

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
    <div className="login-split">
      <div className="login-hero">
        <div className="login-hero-overlay" />
        <svg className="login-net" viewBox="0 0 400 340" aria-hidden="true">
          <defs>
            <symbol id="terc" viewBox="-12 -13 24 24">
              <circle cx="0" cy="-5" r="6" /><path d="M-10 11c0-6.5 4.5-10 10-10s10 3.5 10 10z" />
            </symbol>
          </defs>
          {HERO_ENLACES.map(([a, b], i) => (
            <line key={i} className="lnk" x1={HERO_NODOS[a].x} y1={HERO_NODOS[a].y}
              x2={HERO_NODOS[b].x} y2={HERO_NODOS[b].y} />
          ))}
          {HERO_NODOS.map((n, i) => (
            <use key={i} className="nd" href="#terc" x={n.x - n.s / 2} y={n.y - n.s / 2}
              width={n.s} height={n.s} style={{ animationDelay: `${n.d}s` }} />
          ))}
        </svg>
        <div className="login-hero-content">
          <div className="login-hero-firma">Cardona &amp; Cardona Consultores S.A.S.</div>
          <h1>Maestro de Clientes y<br />Responsables de la Firma</h1>
          <div className="login-hero-sub">Maestros compartidos · Cardona Apps · Cartagena, Colombia</div>
        </div>
      </div>

      <div className="login-panel">
        <form className="login-form" onSubmit={submit} autoComplete="off">
          <img src="/assets/logo-full-t.png" alt="Cardona & co." className="login-logo" />
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
      {cfgServidor && <ServidorConfig variant="modal" onClose={() => setCfgServidor(false)} />}
    </div>
  );
}
