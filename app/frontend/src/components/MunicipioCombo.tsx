import { api } from "../api";
import { Municipio } from "../types";
import { AsyncCombo } from "./AsyncCombo";

/** Combo de búsqueda de municipios DANE (por código o nombre). Devuelve el
 *  municipio completo al elegir. Mecánica común en AsyncCombo. */
export function MunicipioCombo({ value, onChange, placeholder = "Código o municipio…" }: {
  value: string;
  onChange: (m: Municipio) => void;
  placeholder?: string;
}) {
  return (
    <AsyncCombo<Municipio>
      value={value}
      buscar={(q) => api.get(`/catalogos/municipio/buscar?q=${encodeURIComponent(q)}`)}
      label={(m) => `${m.codigo} — ${m.nombre}`}
      renderOpt={(m) => <><b>{m.codigo}</b><span>{m.nombre} · {m.departamento}</span></>}
      getKey={(m) => m.codigo}
      codeOf={(m) => m.codigo}
      onPick={onChange}
      placeholder={placeholder}
    />
  );
}
