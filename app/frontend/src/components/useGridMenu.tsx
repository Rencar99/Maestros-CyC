import { useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu, type MenuItem } from "./ContextMenu";

/** Menú emergente (clic derecho estilo Excel) reutilizable para cualquier grilla del
 *  DataGrid. Ubica la fila por `tr[data-k]` (= getKey) y deja que el llamador arme las
 *  acciones con `items(row)`. Reemplaza la columna "Acciones".
 *
 *  Uso:  const { onContextMenu, menu } = useGridMenu({ rows, getKey, items });
 *        <div onContextMenu={onContextMenu}> <DataGrid .../> </div> {menu} */
export function useGridMenu<T>(opts: {
  rows: T[];
  getKey: (r: T) => string | number;
  items: (r: T) => MenuItem[];
}): { onContextMenu: (e: ReactMouseEvent) => void; menu: ReactNode } {
  const [ctx, setCtx] = useState<{ x: number; y: number; row: T } | null>(null);

  const onContextMenu = (e: ReactMouseEvent) => {
    const tr = (e.target as HTMLElement).closest("tr[data-k]");
    const k = tr?.getAttribute("data-k");
    if (k == null) return;
    const row = opts.rows.find((r) => String(opts.getKey(r)) === k);
    if (!row) return;
    const its = opts.items(row);
    if (!its.length) return;              // fila sin acciones: deja el menú nativo
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, row });
  };

  const menu = ctx
    ? <ContextMenu x={ctx.x} y={ctx.y} items={opts.items(ctx.row)} onClose={() => setCtx(null)} />
    : null;
  return { onContextMenu, menu };
}
