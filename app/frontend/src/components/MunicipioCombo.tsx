import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Municipio } from "../types";

/** Combo de búsqueda de municipios DANE (por código o nombre). La lista se
 *  renderiza en un portal con posición fija para no ser recortada por el
 *  `overflow` de tablas/modales. */
export function MunicipioCombo({
  value,
  onChange,
  placeholder = "Código o municipio…",
}: {
  value: string;
  onChange: (m: Municipio) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Municipio[]>([]);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    if (!value) { setText(""); return; }
    api.get(`/catalogos/municipio/buscar?q=${encodeURIComponent(value)}`)
      .then((r: Municipio[]) => {
        if (!vivo) return;
        const exacto = r.find((x) => x.codigo === value);
        setText(exacto ? `${exacto.codigo} — ${exacto.nombre}` : value);
      })
      .catch(() => vivo && setText(value));
    return () => { vivo = false; };
  }, [value]);

  const posicionar = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width });
  };
  const query = (q: string) => {
    api.get(`/catalogos/municipio/buscar?q=${encodeURIComponent(q)}`)
      .then((r: Municipio[]) => setOpts(r))
      .catch(() => setOpts([]));
  };
  const abrir = (q: string) => { posicionar(); setOpen(true); query(q); };

  return (
    <div className="combo" ref={wrapRef}>
      <input
        className="cbo-input"
        value={text}
        placeholder={placeholder}
        onFocus={() => abrir(text.replace(/ — .*/, ""))}
        onChange={(e) => { setText(e.target.value); abrir(e.target.value); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && rect && createPortal(
        <div className="cbo-list cbo-portal" style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}>
          {opts.length ? (
            opts.map((o) => (
              <div className="cbo-opt" key={o.codigo}
                onMouseDown={() => { setText(`${o.codigo} — ${o.nombre}`); onChange(o); setOpen(false); }}>
                <b>{o.codigo}</b>
                <span>{o.nombre} · {o.departamento}</span>
              </div>
            ))
          ) : (
            <div className="cbo-empty">Sin coincidencias</div>
          )}
        </div>, document.body)}
    </div>
  );
}
