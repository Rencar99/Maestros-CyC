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

/** Modal estándar CyC: cabecera con chip de título ÁMBAR (rojo si tone="danger"),
 *  ACCIONES por ícono a la derecha (una sola primaria: Guardar; navegación,
 *  minimizar y cerrar), cuerpo con scroll y franja inferior SOLO para avisos.
 *  Cierra con Esc / la × / clic en el fondo (que hace "shake", no cierra);
 *  Guardar también con Ctrl+Enter. `saving` bloquea cierre y doble envío.
 *  Se arrastra por la cabecera. `footer` se conserva como compat (fichas). */
export function Modal({ title, sub, icon, tone = "normal", onClose, onSave, saving = false, canSave = true,
                        saveLabel = "Guardar", saveIcon = "save", extraActions, aviso, avisoTone = "info",
                        onPrev, onNext, tabs, footer, children, size = "lg",
                        portal = false, onMinimize, minimized = false, onRestore, busy = false }: {
  title: ReactNode;
  sub?: ReactNode;
  icon?: string;
  tone?: "normal" | "danger";    // chip del título: ámbar (normal) | rojo (danger)
  onClose: () => void;
  onSave?: () => void;           // si se pasa, muestra la acción primaria Guardar (ícono) en la cabecera
  saving?: boolean;              // guardando: bloquea cierre y deshabilita Guardar (anti-doble-envío, §5)
  canSave?: boolean;             // habilita/deshabilita Guardar
  saveLabel?: string;            // tooltip/nombre accesible de Guardar
  saveIcon?: string;             // ícono de Guardar (por defecto "save")
  extraActions?: ReactNode;      // íconos de acción extra en la cabecera (a la izquierda de Guardar)
  aviso?: ReactNode;             // franja inferior SOLO para avisos
  avisoTone?: "info" | "warn" | "err" | "ok";
  onPrev?: () => void;           // navegar al registro anterior (undefined = deshabilitado)
  onNext?: () => void;           // navegar al registro siguiente (undefined = deshabilitado)
  tabs?: ReactNode;
  footer?: ReactNode;            // (compat) footer libre; preferir onSave + aviso
  children: ReactNode;
  size?: "lg" | "md" | "xl";
  portal?: boolean;              // renderizar en document.body (sobrevive a cambios de página)
  onMinimize?: () => void;       // si se pasa, muestra el botón minimizar (─)
  minimized?: boolean;           // true = colapsado a píldora flotante
  onRestore?: () => void;        // restaurar desde la píldora
  busy?: boolean;                // alias de saving (compat)
}) {
  const bloq = saving || busy;   // operación en curso: bloquea Escape/cerrar/Guardar
  const [nudge, setNudge] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tok = useRef<symbol>(Symbol("modal"));
  const titleId = useId();
  const subId = useId();
  // §5/§6: foco atrapado, foco inicial, retorno de foco y bloqueo de scroll de fondo
  // (inactivo si está minimizado: el usuario está trabajando en otra pantalla).
  // Foco inicial = primer campo del CUERPO (las acciones viven en la cabecera, que
  // va antes en el DOM); si el cuerpo no tiene campos, cae al primer foco útil.
  useDialogChrome(cardRef, {
    active: !minimized,
    initialFocus: () => cardRef.current?.querySelector<HTMLElement>(
      '.modal-body input:not([disabled]):not([tabindex="-1"]),.modal-body select:not([disabled]):not([tabindex="-1"]),.modal-body textarea:not([disabled]):not([tabindex="-1"]),.modal-body a[href],.modal-body [tabindex]:not([tabindex="-1"])') || null,
  });

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
      if (e.key === "Escape") { if (!bloq) onClose(); return; }   // ocupado: Escape bloqueado
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && onSave && canSave && !bloq) { e.preventDefault(); onSave(); return; }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); onPrev?.(); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); onNext?.(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, onSave, canSave, minimized, bloq]);

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
           aria-labelledby={titleId} aria-describedby={sub ? subId : undefined} aria-busy={bloq || undefined}
           onAnimationEnd={() => nudge && setNudge(false)}>
        <div className="modal-head modal-drag" onMouseDown={startDrag}>
          <img className="mh-brand" src="/assets/logo-icono-ocre.png" alt="" aria-hidden="true" title="Arrastra para mover" />
          <div className="mh-txt" title="Arrastra para mover">
            <div className="mh-t" id={titleId}>{title}</div>
            {sub && <div className="mh-s" id={subId}>{sub}</div>}
          </div>
          <div className="mh-acts" onMouseDown={(e) => e.stopPropagation()}>
            {(onPrev || onNext) && <>
              <button className="mh-act" disabled={!onPrev} onClick={onPrev} aria-label="Anterior"><Icon name="chevron-left" size={18} /><span className="mh-tip">Anterior · Alt+←</span></button>
              <button className="mh-act" disabled={!onNext} onClick={onNext} aria-label="Siguiente"><Icon name="chevron-right" size={18} /><span className="mh-tip">Siguiente · Alt+→</span></button>
              <div className="mh-sep" />
            </>}
            {extraActions}
            {extraActions && <div className="mh-sep" />}
            {onSave && (
              <button className={"mh-act " + (tone === "danger" ? "danger" : "save")} onClick={onSave} disabled={bloq || !canSave} aria-label={saveLabel}>
                <Icon name={saving ? "hourglass" : saveIcon} size={18} /><span className="mh-tip">{saveLabel} · Ctrl+Enter</span>
              </button>
            )}
            {onMinimize && <button className="mh-act" onClick={onMinimize} disabled={bloq} aria-label="Minimizar"><Icon name="minus" size={16} /><span className="mh-tip">Minimizar</span></button>}
            <button className="mh-act close" onClick={() => !bloq && onClose()} disabled={bloq} aria-label="Cerrar"><Icon name="x" size={18} /><span className="mh-tip">Cerrar</span></button>
          </div>
        </div>
        {tabs && <div className="tabs">{tabs}</div>}
        <div className="modal-body">{children}</div>
        {aviso ? <div className={"modal-aviso " + avisoTone}><Icon name={avisoTone === "err" ? "alert" : avisoTone === "ok" ? "check" : "info"} size={15} />{aviso}</div>
         : footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
      </div>
    </div>
  );
  return portal ? createPortal(vista, document.body) : vista;
}
