import { useEffect, useState } from "react";
import { api } from "../api";

/** Pantalla de bienvenida (splash) que se muestra al arrancar y se desvanece. */
export function Splash() {
  const [fuera, setFuera] = useState(false);
  const [quitar, setQuitar] = useState(false);
  const [ver, setVer] = useState("");

  useEffect(() => {
    api.get("/health").then((r: any) => setVer(r.version)).catch(() => {});
    const t1 = window.setTimeout(() => setFuera(true), 1600);
    const t2 = window.setTimeout(() => setQuitar(true), 2150);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  if (quitar) return null;
  return (
    <div className={"splash-ov" + (fuera ? " out" : "")}>
      <div className="splash-card">
        <img className="splash-logo" src="/assets/logo-blanco-t.png" alt="Cardona & co." />
        <div className="splash-rule" />
        <div className="splash-eyebrow">Cardona Apps · C&amp;C</div>
        <h1 className="splash-title">Maestros</h1>
        <p className="splash-sub">Catálogo general de Clientes y Responsables de la firma</p>
        <p className="splash-chips">Clientes · Responsables · Servicios · Municipios ICA · CIIU</p>
        <div className="splash-bar"><i /></div>
        <div className="splash-load">Cargando aplicación…</div>
        <div className="splash-foot">
          <div>{ver && <><span className="v">v{ver}</span> · </>}© 2026 Cardona &amp; Cardona Consultores S.A.S.</div>
          <div>🔒 Uso exclusivo de la firma</div>
        </div>
      </div>
    </div>
  );
}
