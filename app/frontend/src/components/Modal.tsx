import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, useDialogChrome } from "../ui";

/** Pila de modales abiertos (no minimizados): solo el de encima responde a
 *  Escape y a la navegación por teclado, para que un modal anidado (p. ej. el
 *  explorador dentro de una ficha) no cierre también al de abajo. */
const _modalStack: symbol[] = [];

/** Contenedor común (en body) donde se alinean las píldoras de ventanas
 *  minimizadas, para que no se superpongan (flexbox: una al lado de otra). */
let _dock: HTMLElement | null = null;
export function minDock(): HTMLElement {
  if (!_dock || !document.body.contains(_dock)) {
    _dock = document.createElement("div");
    _dock.className = "modal-min-dock";
    document.body.appendChild(_dock);
  }
  return _dock;
}

/** Modal centrado y limpio: cabecera (ícono + título + descripción + cerrar) ·
 *  pestañas opcionales · cuerpo con scroll · footer de acciones.
 *  Se cierra solo con Esc, la X o el footer; un clic en el fondo NO cierra
 *  (evita perder el trabajo): en su lugar hace un "shake" suave de aviso.
 *  Se puede reubicar arrastrando la cabecera con el mouse. */
export function Modal({ title, sub, icon, onClose, onPrev, onNext, tabs, footer, children, size = "lg",
                        portal = false, onMinimize, minimized = false, onRestore, busy = false }: {
  title: ReactNode;
  sub?: ReactNode;
  icon?: string;
  onClose: () => void;
  onPrev?: () => void;            // navegar al registro anterior (undefined = deshabilitado)
  onNext?: () => void;            // navegar al registro siguiente (undefined = deshabilitado)
  tabs?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: "lg" | "md" | "xl";
  portal?: boolean;               // renderizar en document.body (sobrevive a cambios de página)
  onMinimize?: () => void;        // si se pasa, muestra el botón minimizar (─)
  minimized?: boolean;            // true = colapsado a píldora flotante
  onRestore?: () => void;         // restaurar desde la píldora
  busy?: boolean;                 // operación en curso: bloquea Escape/cerrar (anti-doble-envío, §5)
}) {
  const [nudge, setNudge] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tok = useRef<symbol>(Symbol("modal"));
  const titleId = useId();
  const subId = useId();
  // §5/§6: foco atrapado, foco inicial, retorno de foco y bloqueo de scroll de fondo
  // (inactivo si está minimizado: el usuario está trabajando en otra pantalla).
  useDialogChrome(cardRef, { active: !minimized });

  // Pila: este modal queda "encima" mientras esté montado y no minimizado.
  useEffect(() => {
    if (minimized) return;
    const t = tok.current;
    _modalStack.push(t);
    return () => { const i = _modalStack.indexOf(t); if (i >= 0) _modalStack.splice(i, 1); };
  }, [minimized]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (minimized) return;      // minimizado: el usuario está en otra pantalla, no capturar teclas
      if (_modalStack[_modalStack.length - 1] !== tok.current) return;   // solo el modal de encima
      if (e.key === "Escape") { if (!busy) onClose(); return; }   // ocupado: Escape bloqueado
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); onPrev?.(); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); onNext?.(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, minimized, busy]);

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;   // no arrastrar desde la X
    e.preventDefault();                                        // evita seleccionar texto
    drag.current = { ox: pos.x, oy: pos.y, px: e.clientX, py: e.clientY };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      setPos({ x: drag.current.ox + ev.clientX - drag.current.px, y: drag.current.oy + ev.clientY - drag.current.py });
    };
    const up = () => { drag.current = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  // Minimizado: píldora flotante (siempre por portal para sobrevivir a cambios de página).
  if (minimized) {
    return createPortal(
      <div className="modal-min" onClick={onRestore} title="Restaurar ventana" role="button" tabIndex={0}>
        {icon && <span className="modal-min-ic"><Icon name={icon} size={16} /></span>}
        <span className="modal-min-t">{title}</span>
        <button className="modal-min-x" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Cerrar" title="Cerrar"><Icon name="x" size={14} /></button>
      </div>,
      minDock(),
    );
  }

  const vista = (
    <div className="modal-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) setNudge(true); }}>
      <div className={"modal-pos " + size} style={(pos.x || pos.y) ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}>
      <div ref={cardRef} className={"modal-card " + size + (nudge ? " nudge" : "")}
           role={sub ? "alertdialog" : "dialog"} aria-modal="true"
           aria-labelledby={titleId} aria-describedby={sub ? subId : undefined} aria-busy={busy || undefined}
           onAnimationEnd={() => nudge && setNudge(false)}>
        <div className="modal-head modal-drag" onMouseDown={startDrag} title="Arrastra para mover">
          {icon && <div className="mh-ic"><Icon name={icon} size={18} /></div>}
          <div className="mh-txt">
            <div className="mh-t" id={titleId}>{title}</div>
            {sub && <div className="mh-s" id={subId}>{sub}</div>}
          </div>
          {(onPrev || onNext) && (
            <div className="mh-nav">
              <button className="modal-nav" disabled={!onPrev} onClick={onPrev} aria-label="Anterior" title="Registro anterior (Alt+←)"><Icon name="chevron-left" size={18} /></button>
              <button className="modal-nav" disabled={!onNext} onClick={onNext} aria-label="Siguiente" title="Registro siguiente (Alt+→)"><Icon name="chevron-right" size={18} /></button>
            </div>
          )}
          {onMinimize && <button className="modal-x" onClick={onMinimize} disabled={busy} aria-label="Minimizar" title="Minimizar (seguir en otra pantalla)"><Icon name="minus" size={16} /></button>}
          <button className="modal-x" onClick={onClose} disabled={busy} aria-label="Cerrar" title="Cerrar"><Icon name="x" size={16} /></button>
        </div>
        {tabs && <div className="tabs">{tabs}</div>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
      </div>
    </div>
  );
  return portal ? createPortal(vista, document.body) : vista;
}
