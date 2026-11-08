import { useEffect, useRef, type CSSProperties, type TextareaHTMLAttributes } from "react";

/** Textarea que se ajusta solo a la altura de su contenido: sin espacio muerto
 *  ni scroll interno; crece y se encoge al editar. Pensado para los editores de
 *  plantillas de Configuración. El `value` debe ser controlado por el padre. */
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "ref"> & {
  value: string;
  minRows?: number;
};

export function AutoTextarea({ value, minRows = 2, style, onChange, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  // Re-mide al montar y cada vez que cambia el contenido (incluida la carga async).
  useEffect(() => { fit(); }, [value]);
  const estilo: CSSProperties = {
    width: "100%", resize: "none", overflow: "hidden",
    fontFamily: "inherit", lineHeight: 1.5, ...style,
  };
  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      onChange={(e) => { onChange?.(e); fit(); }}
      style={estilo}
      {...rest}
    />
  );
}
