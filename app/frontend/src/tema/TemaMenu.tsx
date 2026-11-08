import { useEffect, useRef, useState, type ReactNode } from "react";
import { type Modo, type Paleta, PALETAS, EVENTO_TEMA, leerModo, leerPaleta, modoEfectivo, guardarModo, guardarPaleta } from "./cyc-tema";

// Selector de tema (kit CyC): Modo (Auto/Claro/Oscuro; Auto sigue a Windows) + Color.
// Popover que cierra al clic afuera o con Escape. Íconos en línea para no depender del
// set de íconos de cada aplicativo. No editar la copia: se replica con Sync-TemaCyC.ps1.

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const ICONOS: Record<string, ReactNode> = {
  palette: <><circle cx="12" cy="12" r="9" /><circle cx="7.5" cy="10.5" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="16.5" cy="10.5" r="1.2" /><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a3 3 0 0 0 3-3" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};
const Ico = ({ n, s = 15 }: { n: string; s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}>{ICONOS[n]}</svg>;

const MODOS: { id: Modo; icon: string; lbl: string }[] = [
  { id: "auto", icon: "monitor", lbl: "Auto" },
  { id: "claro", icon: "sun", lbl: "Claro" },
  { id: "oscuro", icon: "moon", lbl: "Oscuro" },
];

/** Devuelve el modo efectivo y la paleta, y re-renderiza al cambiar (para gráficas). */
export function useTema(): { modo: "claro" | "oscuro"; paleta: Paleta } {
  const [t, setT] = useState(() => ({ modo: modoEfectivo(), paleta: leerPaleta() }));
  useEffect(() => {
    const h = () => setT({ modo: modoEfectivo(), paleta: leerPaleta() });
    const ev = EVENTO_TEMA();
    window.addEventListener(ev, h);
    return () => window.removeEventListener(ev, h);
  }, []);
  return t;
}

export function TemaMenu({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<Modo>(leerModo);
  const [pal, setPal] = useState<Paleta>(leerPaleta);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pickModo = (m: Modo) => { setModo(m); guardarModo(m); };
  const pickPal = (p: Paleta) => { setPal(p); guardarPaleta(p); };

  return (
    <div className={"tema-wrap " + className} ref={ref}>
      <button type="button" className={"tema-btn" + (open ? " on" : "")} title="Tema y color" aria-label="Tema y color"
        onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Ico n="palette" s={17} />
      </button>
      {open && (
        <div className="tema-pop" role="menu">
          <div className="tema-grp">Modo</div>
          <div className="tema-seg">
            {MODOS.map((m) => (
              <button type="button" key={m.id} className={"tema-seg-b" + (modo === m.id ? " on" : "")} onClick={() => pickModo(m.id)}>
                <Ico n={m.icon} />{m.lbl}
              </button>
            ))}
          </div>
          <div className="tema-grp">Color</div>
          <div className="tema-pals">
            {PALETAS.map((p) => (
              <button type="button" key={p.id} className={"tema-pal" + (pal === p.id ? " on" : "")} onClick={() => pickPal(p.id)} title={p.nombre}>
                <span className="tema-sw" style={{ background: p.swatch }}>{pal === p.id && <Ico n="check" s={12} />}</span>
                {p.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
