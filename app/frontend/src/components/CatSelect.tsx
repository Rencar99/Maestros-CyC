import { useState } from "react";
import { api } from "../api";
import { Icon, useToast } from "../ui";

export interface Cat { id: number; descripcion: string; activo: boolean; }

/** Select alimentado por un catálogo, con botón "＋" para crear un ítem nuevo
 *  en vivo (sin salir de la ficha) y dejarlo seleccionado.
 *  - by="id": el valor es el id (FK). by="descripcion": el valor es el texto. */
export function CatSelect({ path, items, onItems, value, onChange, by = "id", disabled, placeholder = "—", noAdd }: {
  path: string;
  items: Cat[];
  onItems: (nuevo: Cat) => void;
  value: string | number | null;
  onChange: (v: string | number | null) => void;
  by?: "id" | "descripcion";
  disabled?: boolean;
  placeholder?: string;
  noAdd?: boolean;
}) {
  const toast = useToast();
  const [creando, setCreando] = useState(false);
  const [txt, setTxt] = useState("");

  const crear = async () => {
    const d = txt.trim();
    if (!d) { setCreando(false); setTxt(""); return; }
    try {
      const nuevo: Cat = await api.post(`/catalogos/${path}`, { descripcion: d, activo: true });
      onItems(nuevo);
      onChange(by === "id" ? nuevo.id : nuevo.descripcion);
      setCreando(false); setTxt("");
      toast("Creado ✓");
    } catch (e: any) { toast(e.message, true); }
  };

  if (creando) {
    return (
      <div className="catsel-row">
        <input autoFocus value={txt} placeholder="Nuevo…" style={{ flex: 1 }}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crear(); } if (e.key === "Escape") { setCreando(false); setTxt(""); } }} />
        <button type="button" className="icon-btn" title="Crear" onClick={crear}><Icon name="check" size={16} /></button>
        <button type="button" className="icon-btn" title="Cancelar" onClick={() => { setCreando(false); setTxt(""); }}><Icon name="x" size={15} /></button>
      </div>
    );
  }
  return (
    <div className="catsel-row">
      <select style={{ flex: 1 }} value={value ?? ""} disabled={disabled}
        onChange={(e) => onChange(e.target.value ? (by === "id" ? Number(e.target.value) : e.target.value) : null)}>
        <option value="">{placeholder}</option>
        {items.map((it) => <option key={it.id} value={by === "id" ? it.id : it.descripcion}>{it.descripcion}</option>)}
      </select>
      {!noAdd && <button type="button" className="icon-btn add-plus" title="Crear nuevo" onClick={() => setCreando(true)} disabled={disabled}><Icon name="plus" size={16} /></button>}
    </div>
  );
}
