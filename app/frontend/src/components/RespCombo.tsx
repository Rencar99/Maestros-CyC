import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Combo de búsqueda de responsables (lista ya en memoria), por nombre. La lista
 *  se renderiza en un portal con posición fija para no ser recortada por el
 *  `overflow` de tablas/modales. Mismo look que MunicipioCombo/CiiuCombo. */
type Opt = { id: number; nombre: string };
export function RespCombo({ value, options, onChange, disabled, placeholder = "Buscar responsable…" }: {
  value: number | null;
  options: Opt[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sel = options.find((o) => o.id === value);
  const shown = open ? text : (sel?.nombre ?? "");
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return q ? options.filter((o) => o.nombre.toLowerCase().includes(q)) : options;
  }, [text, options]);

  const posicionar = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width });
  };
  const abrir = () => { posicionar(); setText(""); setOpen(true); };

  return (
    <div className="combo" ref={wrapRef}>
      <input
        className="cbo-input"
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={abrir}
        onChange={(e) => { setText(e.target.value); posicionar(); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && rect && createPortal(
        <div className="cbo-list cbo-portal" style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}>
          <div className="cbo-opt" onMouseDown={() => { onChange(null); setOpen(false); }}>
            <span style={{ color: "var(--ink-3)" }}>— (ninguno)</span>
          </div>
          {filtered.length ? (
            filtered.map((o) => (
              <div className="cbo-opt" key={o.id} onMouseDown={() => { onChange(o.id); setOpen(false); }}>{o.nombre}</div>
            ))
          ) : (
            <div className="cbo-empty">Sin coincidencias</div>
          )}
        </div>, document.body)}
    </div>
  );
}
