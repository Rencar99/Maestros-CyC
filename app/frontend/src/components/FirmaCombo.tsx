import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Combo híbrido para la firma del Contador / Revisor Fiscal.
 *  Dos valores posibles, excluyentes:
 *   · `id`     → responsable de la firma (interno).  Se muestra su nombre.
 *   · `nombre` → nombre libre (contador/revisor externo, no está en la firma).
 *  Al escribir, sugiere responsables; si ninguno empata, el texto se guarda tal
 *  cual como nombre externo (sin FK, sin validar). Mismo look que RespCombo. */
type Opt = { id: number; nombre: string };
export function FirmaCombo({ id, nombre, options, onChange, disabled }: {
  id: number | null;
  nombre: string;
  options: Opt[];
  onChange: (id: number | null, nombre: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sel = options.find((o) => o.id === id);
  const actual = sel?.nombre ?? nombre ?? "";          // lo que vale hoy el campo
  const shown = open ? text : actual;
  const esExterno = !id && !!(nombre || "").trim();    // tiene nombre libre, sin FK
  const q = text.trim();
  const filtered = useMemo(() => {
    const t = q.toLowerCase();
    return t ? options.filter((o) => o.nombre.toLowerCase().includes(t)) : options;
  }, [q, options]);
  const exacto = options.some((o) => o.nombre.toLowerCase() === q.toLowerCase());

  const posicionar = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width });
  };
  const abrir = () => { posicionar(); setText(actual); setOpen(true); };
  // Al salir: si escribiste algo que no empata con un responsable, se guarda como
  // nombre externo; si quedó vacío, se limpia; si no tocaste, se respeta.
  const salir = () => window.setTimeout(() => {
    setOpen(false);
    const t = text.trim();
    if (t === actual.trim()) return;                   // sin cambios
    if (!t) { onChange(null, ""); return; }            // vaciar
    if (!exacto) onChange(null, t);                    // texto libre → externo
  }, 150);

  return (
    <div className="combo" ref={wrapRef}>
      <input
        className={"cbo-input" + (esExterno ? " firma-ext" : "")}
        value={shown}
        placeholder="Responsable de la firma o nombre externo…"
        disabled={disabled}
        onFocus={abrir}
        onChange={(e) => { setText(e.target.value); posicionar(); setOpen(true); }}
        onBlur={salir}
      />
      {esExterno && !open && <span className="firma-ext-tag" title="Nombre externo (no está en Responsables)">externo</span>}
      {open && rect && createPortal(
        <div className="cbo-list cbo-portal" style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}>
          <div className="cbo-opt" onMouseDown={() => { onChange(null, ""); setOpen(false); }}>
            <span style={{ color: "var(--ink-3)" }}>— (ninguno)</span>
          </div>
          {q && !exacto && (
            <div className="cbo-opt firma-usar" onMouseDown={() => { onChange(null, q); setOpen(false); }}>
              Usar «{q}» <span style={{ color: "var(--ink-3)" }}>(externo)</span>
            </div>
          )}
          {filtered.length ? (
            filtered.map((o) => (
              <div className="cbo-opt" key={o.id} onMouseDown={() => { onChange(o.id, ""); setOpen(false); }}>{o.nombre}</div>
            ))
          ) : (
            !q && <div className="cbo-empty">Sin responsables</div>
          )}
        </div>, document.body)}
    </div>
  );
}
