import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Combo de búsqueda ASÍNCRONA (lista desde el servidor), estándar CyC. La lista
 *  va en un portal con posición fija para no recortarse por el `overflow` de
 *  tablas/modales. Lo concreto (endpoint, etiqueta, render, qué devuelve al
 *  elegir) lo inyecta cada combo; aquí vive toda la mecánica común. */
export function AsyncCombo<T>({ value, buscar, label, renderOpt, getKey, codeOf, onPick, placeholder }: {
  value: string;
  buscar: (q: string) => Promise<T[]>;
  label: (o: T) => string;          // texto "código — descripción" para el input
  renderOpt: (o: T) => ReactNode;   // cuerpo de cada opción de la lista
  getKey: (o: T) => string;
  codeOf: (o: T) => string;         // para resolver el valor actual contra su opción exacta
  onPick: (o: T) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<T[]>([]);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const qSeq = useRef(0);   // descarta respuestas de búsquedas superadas (teclado rápido)

  // Al montar/cambiar el código, resuelve su etiqueta para mostrarla.
  useEffect(() => {
    let vivo = true;
    if (!value) { setText(""); return; }
    buscar(value)
      .then((r) => { if (!vivo) return; const ex = r.find((x) => codeOf(x) === value); setText(ex ? label(ex) : value); })
      .catch(() => vivo && setText(value));
    return () => { vivo = false; };
  }, [value]); // eslint-disable-line

  const posicionar = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width });
  };
  const query = (q: string) => {
    const seq = ++qSeq.current;
    buscar(q).then((r) => { if (seq === qSeq.current) setOpts(r); })
             .catch(() => { if (seq === qSeq.current) setOpts([]); });
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
              <div className="cbo-opt" key={getKey(o)}
                onMouseDown={() => { setText(label(o)); onPick(o); setOpen(false); }}>
                {renderOpt(o)}
              </div>
            ))
          ) : (
            <div className="cbo-empty">Sin coincidencias</div>
          )}
        </div>, document.body)}
    </div>
  );
}
