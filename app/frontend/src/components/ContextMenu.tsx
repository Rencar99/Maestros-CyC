import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui";

/** Ítem de un menú emergente (estilo Excel). `sep:true` dibuja un separador. */
export interface MenuItem {
  label: string;
  icon?: string;          // nombre de Icon
  iconColor?: string;     // color del ícono (p.ej. "var(--primary)"); por defecto, tenue
  onClick?: () => void;
  danger?: boolean;       // acción destructiva (rojo)
  disabled?: boolean;
  sep?: boolean;          // separador (ignora el resto)
  hint?: string;          // texto tenue a la derecha (atajo)
}

/** Menú contextual reutilizable: aparece en (x, y), se reubica para no salirse de la
 *  pantalla, navega con flechas y cierra con Escape, clic afuera, scroll o resize.
 *  Controlado: el padre decide cuándo montarlo y lo desmonta en `onClose`. */
export function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);
  const enabled = useMemo(
    () => items.map((it, i) => ({ it, i })).filter((o) => !o.it.sep && !o.it.disabled).map((o) => o.i),
    [items]);

  // Reubica dentro del viewport (como Excel: nunca se corta contra el borde).
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 6;
    let nx = x, ny = y;
    if (nx + width + pad > window.innerWidth) nx = Math.max(pad, window.innerWidth - width - pad);
    if (ny + height + pad > window.innerHeight) ny = Math.max(pad, window.innerHeight - height - pad);
    setPos({ x: nx, y: ny });
  }, [x, y, items.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!enabled.length) return;
        const cur = enabled.indexOf(active);
        const n = e.key === "ArrowDown"
          ? enabled[cur < 0 ? 0 : (cur + 1) % enabled.length]
          : enabled[cur <= 0 ? enabled.length - 1 : cur - 1];
        setActive(n);
      }
      // Sin activación con Enter: las acciones solo se disparan con clic (evita abrir el modal sin querer).
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [active, enabled, items, onClose]);

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }}
         onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it.sep ? (
        <div key={i} className="ctx-sep" role="separator" />
      ) : (
        <button key={i} type="button" role="menuitem" disabled={it.disabled}
                className={"ctx-item" + (it.danger ? " danger" : "") + (i === active ? " on" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => { it.onClick?.(); onClose(); }}>
          <i className="ctx-ic" style={it.iconColor ? { color: it.iconColor } : undefined}>{it.icon && <Icon name={it.icon} size={15} />}</i>
          <span className="ctx-lbl">{it.label}</span>
          {it.hint && <span className="ctx-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
