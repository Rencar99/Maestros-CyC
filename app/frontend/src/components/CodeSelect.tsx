import { useState } from "react";
import { api } from "../api";
import { Icon, useToast } from "../ui";

export interface CodeItem { codigo: string; descripcion: string; }

/** Select alimentado por un catálogo POR CÓDIGO (código + descripción), con botón
 *  "＋" para crear un ítem nuevo en vivo (sin salir de la ficha) y dejarlo
 *  seleccionado. Hermano de CatSelect (ese es para catálogos por id). */
export function CodeSelect({ path, items, onItems, value, onChange, disabled, placeholder = "—", maxCod = 4, noAdd }: {
  path: string;
  items: CodeItem[];
  onItems: (nuevo: CodeItem) => void;
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxCod?: number;
  noAdd?: boolean;
}) {
  const toast = useToast();
  const [creando, setCreando] = useState(false);
  const [cod, setCod] = useState("");
  const [desc, setDesc] = useState("");

  const crear = async () => {
    const c = cod.trim().toUpperCase();
    const d = desc.trim();
    if (!c) { setCreando(false); setCod(""); setDesc(""); return; }
    try {
      const nuevo: CodeItem = await api.post(`/catalogos/${path}`, { codigo: c, descripcion: d });
      onItems(nuevo);
      onChange(nuevo.codigo);
      setCreando(false); setCod(""); setDesc("");
      toast("Creado ✓");
    } catch (e: any) { toast(e.message, true); }
  };

  if (creando) {
    return (
      <div className="catsel-row">
        <input autoFocus value={cod} placeholder="Cód." maxLength={maxCod} style={{ width: 64, textTransform: "uppercase" }}
          onChange={(e) => setCod(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setCreando(false); setCod(""); setDesc(""); } }} />
        <input value={desc} placeholder="Descripción" style={{ flex: 1 }}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crear(); } if (e.key === "Escape") { setCreando(false); setCod(""); setDesc(""); } }} />
        <button type="button" className="icon-btn" title="Crear" onClick={crear}><Icon name="check" size={16} /></button>
        <button type="button" className="icon-btn" title="Cancelar" onClick={() => { setCreando(false); setCod(""); setDesc(""); }}><Icon name="x" size={15} /></button>
      </div>
    );
  }
  return (
    <div className="catsel-row">
      <select style={{ flex: 1 }} value={value ?? ""} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">{placeholder}</option>}
        {items.map((it) => <option key={it.codigo} value={it.codigo}>{it.codigo} — {it.descripcion}</option>)}
      </select>
      {!noAdd && <button type="button" className="icon-btn add-plus" title="Crear nuevo" onClick={() => setCreando(true)} disabled={disabled}><Icon name="plus" size={16} /></button>}
    </div>
  );
}
