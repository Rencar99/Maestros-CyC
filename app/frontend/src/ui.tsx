import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";

/* ---------------- Comportamiento de diálogo (Estándar Modal CyC §5/§6) ------
 * Hook compartido: bloquea el scroll del fondo, atrapa el foco (Tab/Shift+Tab),
 * pone el foco inicial y lo devuelve al control que abrió el diálogo al cerrar.
 * Lo usan el Modal genérico y el ConfirmModal (no se reimplementa en cada uno). */
let _scrollLocks = 0;
let _scrollPrev = "";
function _lockScroll() {
  if (_scrollLocks === 0) { _scrollPrev = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  _scrollLocks++;
}
function _unlockScroll() {
  _scrollLocks = Math.max(0, _scrollLocks - 1);
  if (_scrollLocks === 0) document.body.style.overflow = _scrollPrev;
}
const _FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogChrome(
  ref: { current: HTMLElement | null },
  opts: { active?: boolean; initialFocus?: () => HTMLElement | null } = {},
) {
  const activo = opts.active !== false;
  useEffect(() => {
    if (!activo) return;
    const previo = document.activeElement as HTMLElement | null;
    _lockScroll();
    const node = ref.current;
    const foco = () => (node ? Array.from(node.querySelectorAll<HTMLElement>(_FOCUSABLE))
      .filter((el) => el.offsetParent !== null) : []);
    // Foco inicial: el indicado, si no el primer control útil, si no el diálogo.
    const inicial = opts.initialFocus?.() || foco()[0] || node;
    setTimeout(() => inicial?.focus?.(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !node) return;
      const f = foco();
      if (!f.length) { e.preventDefault(); node.focus(); return; }
      const [a, z] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      _unlockScroll();
      previo?.focus?.();   // §6: devolver el foco al control que abrió el diálogo
    };
  }, [activo]); // eslint-disable-line
}

/* ---------------- Iconos (trazo fino 1.5, estilo Cardona Apps) ------------- */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    clientes: <><path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>,
    resp: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    cat: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
    check: <path d="M20 6L9 17l-5-5" />,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
    down: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></>,
    info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
    eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>,
    "eye-off": <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></>,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    x: <path d="M18 6L6 18M6 6l12 12" />,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 7L2 7" /></>,
    "map-pin": <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
    box: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96L12 12l8.73-5.04M12 22V12" /></>,
    tag: <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" /></>,
    briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
    folder: <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>,
    "arrow-up": <><path d="M12 19V5M5 12l7-7 7 7" /></>,
    "chevron-right": <path d="M9 18l6-6-6-6" />,
    "chevron-left": <path d="M15 18l-6-6 6-6" />,
    "chevron-down": <path d="M6 9l6 6 6-6" />,
    hourglass: <><path d="M6 2h12M6 22h12M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V2M6 22v-4a6 6 0 0 1 6-6 6 6 0 0 1 6 6v4" /></>,
    "check-circle": <><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    alert: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    refresh: <><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>,
    "clipboard-check": <><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /><path d="M9 14l2 2 4-4" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
    db: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></>,
    broom: <><path d="M19.36 2.72l1.42 1.42-5.72 5.71c1.07 1.54 1.22 3.39.32 4.59L9.06 8.5c1.2-.9 3.05-.75 4.59.32l5.71-5.72z" /><path d="M5.93 17.57c-2.01-2.01-3.24-4.41-3.58-6.65l4.88-2.09 7.44 7.44-2.09 4.88c-2.24-.34-4.64-1.57-6.65-3.58z" /></>,
    "shield-check": <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>,
    coins: <><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="M16.71 13.88l.7.71-2.82 2.82" /></>,
    globe: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
    files: <><path d="M15.5 2H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6.5z" /><path d="M15 2v5h5" /><path d="M5 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
    landmark: <><line x1="3" y1="22" x2="21" y2="22" /><line x1="6" y1="18" x2="6" y2="11" /><line x1="10" y1="18" x2="10" y2="11" /><line x1="14" y1="18" x2="14" y2="11" /><line x1="18" y1="18" x2="18" y2="11" /><polygon points="12 2 20 7 4 7" /></>,
    "arrow-down": <><path d="M12 5v14M5 12l7 7 7-7" /></>,
    list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

/* Encabezado de sección con el ícono del menú en ámbar (#f7931e) — estándar C&C. */
export function SecTitle({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "#f7931e", display: "inline-flex" }}><Icon name={icon} size={19} /></span>{children}
    </h3>
  );
}

/* ---------------- Interruptor (toggle) sí/no ------------------------------ */
export function Toggle({ checked, onChange, label, color = "blue", disabled, title }: {
  checked: boolean; onChange: (v: boolean) => void; label?: ReactNode;
  color?: "blue" | "green"; disabled?: boolean; title?: string;
}) {
  return (
    <label className={"tgl" + (checked ? " on " + color : "") + (disabled ? " dis" : "")} title={title}>
      {label && <span className="tgl-lb">{label}</span>}
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="tgl-tr"><span className="tgl-kn" /></span>
    </label>
  );
}

/* ---------------- Toast ---------------------------------------------------- */
type ToastFn = (msg: string, err?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean } | null>(null);
  const show = useCallback<ToastFn>((msg, err = false) => {
    setT({ msg, err });
    window.setTimeout(() => setT(null), 2200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={"toast on" + (t.err ? " err" : "")}>{t.msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------------- Confirmación (MsgBox propio) ---------------------------- */
/** Resultado tri-estado: "si" (acción primaria) · "no" (opción intermedia/descartar) · "cancelar". */
export type ConfirmResult = "si" | "no" | "cancelar";
export interface ConfirmOpts { titulo?: string; mensaje: string; confirmar?: string; cancelar?: string; descartar?: string; peligro?: boolean; soloAceptar?: boolean; }
type ConfirmFn = (opts: ConfirmOpts) => Promise<ConfirmResult>;
const ConfirmCtx = createContext<ConfirmFn>(async () => "cancelar");
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<(ConfirmOpts & { resolve: (v: ConfirmResult) => void }) | null>(null);
  const [nudge, setNudge] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const confirmar = useCallback<ConfirmFn>((opts) =>
    new Promise<ConfirmResult>((resolve) => setSt({ ...opts, resolve })), []);
  const cerrar = (v: ConfirmResult) => { st?.resolve(v); setSt(null); };
  // §6: en confirmaciones destructivas el foco inicial va a la acción que NO ejecuta.
  useDialogChrome(cardRef, {
    active: !!st,
    initialFocus: () => cardRef.current?.querySelector<HTMLElement>(
      st?.peligro && !st?.soloAceptar ? "[data-cyc-cancel]" : "[data-cyc-primary]") || null,
  });
  // Escape = cancelar (como la × ); el clic en el fondo NO cierra (solo avisa con un "shake").
  useEffect(() => {
    if (!st) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cerrar("cancelar"); } };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }); // eslint-disable-line
  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      {st && (
        <div className="confirm-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) setNudge(true); }}>
          <div ref={cardRef} className={"confirm-card" + (nudge ? " nudge" : "")} onMouseDown={(e) => e.stopPropagation()}
               role="alertdialog" aria-modal="true" aria-labelledby="cfm-title" aria-describedby="cfm-msg"
               onAnimationEnd={() => nudge && setNudge(false)}>
            <div className="modal-head">
              <img className="mh-brand" src="/assets/logo-icono-ocre.png" alt="" aria-hidden="true" />
              <div className="mh-txt"><div className="mh-t" id="cfm-title">{st.titulo || (st.peligro ? "Confirmar eliminación" : "Confirmar")}</div></div>
              <div className="mh-acts">
                {!st.soloAceptar && <button className="mh-act" data-cyc-cancel onClick={() => cerrar("cancelar")} aria-label={st.cancelar || "Cancelar"}><Icon name="x" size={18} /><span className="mh-tip">{st.cancelar || "Cancelar"}</span></button>}
                {st.descartar && <button className="mh-btn" onClick={() => cerrar("no")}>{st.descartar}</button>}
                <button className={"mh-btn " + (st.peligro ? "danger" : "save")} data-cyc-primary onClick={() => cerrar("si")}>
                  <Icon name={st.peligro ? "trash" : "check"} size={15} />{st.confirmar || "Aceptar"}
                </button>
              </div>
            </div>
            <div className="confirm-body"><p className="confirm-msg" id="cfm-msg">{st.mensaje}</p></div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ---------------- Formatos es-CO ------------------------------------------ */
export function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return "$" + n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
