import { api } from "../api";
import { Ciiu } from "../types";
import { AsyncCombo } from "./AsyncCombo";

/** Combo de búsqueda de actividades CIIU (por código o nombre). Devuelve el
 *  código al elegir. Mecánica común en AsyncCombo. */
export function CiiuCombo({ value, onChange, placeholder = "Código o nombre…" }: {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
}) {
  return (
    <AsyncCombo<Ciiu>
      value={value}
      buscar={(q) => api.get(`/catalogos/ciiu/buscar?q=${encodeURIComponent(q)}`)}
      label={(c) => `${c.codigo} — ${c.descripcion}`}
      renderOpt={(c) => <><b>{c.codigo}</b><span>{c.descripcion}</span></>}
      getKey={(c) => c.codigo}
      codeOf={(c) => c.codigo}
      onPick={(c) => onChange(c.codigo)}
      placeholder={placeholder}
    />
  );
}
