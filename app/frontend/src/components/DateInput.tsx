import { useRef } from "react";
import { Icon } from "../ui";

/** Campo de fecha AAAA-MM-DD (estándar de la firma) con botón de calendario nativo.
 *  Reutilizable (Cartera, Responsables, …). El texto manda; el input date oculto
 *  solo abre el selector. */
export function DateInput({ value, onChange, disabled, placeholder = "AAAA-MM-DD" }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) {
  const nat = useRef<HTMLInputElement>(null);
  const abrir = () => {
    const el = nat.current; if (!el) return;
    try { (el as any).showPicker ? (el as any).showPicker() : el.click(); } catch { el.click(); }
  };
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  return (
    <div className="dinp">
      <input className="dinp-txt" value={value} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="dinp-cal" disabled={disabled} onClick={abrir} aria-label="Abrir calendario"><Icon name="calendar" size={15} /></button>
      <input ref={nat} type="date" className="dinp-native" tabIndex={-1} aria-hidden="true"
        value={iso} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
