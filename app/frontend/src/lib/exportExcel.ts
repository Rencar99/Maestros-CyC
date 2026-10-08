// exceljs se carga bajo demanda (import dinámico) para no inflar el bundle:
// solo se descarga cuando el usuario realmente exporta a .xlsx.
import type ExcelJSNS from "exceljs";

/**
 * Estándar de exportación a Excel de las apps Cardona & co.
 *
 * Layout (todo empieza en B2, con margen en la columna A y la fila 1):
 *   B2  → título "Cardona & Co."
 *   B3  → nombre del conjunto + nº de registros + fecha
 *   B5  → tabla NATIVA de Excel (con autofiltro y filas alternadas)
 * Cada columna se formatea por su tipo: money = número con separador de miles,
 * date = AAAA-MM-DD, code = texto (conserva ceros/NITs largos), resto general.
 */
export type ExpColType = "text" | "code" | "date" | "money" | "status" | "actions";

export interface ExpColumn {
  header: string;
  type?: ExpColType;
}

export interface ExportOpts {
  filename: string;           // "Certificados 2026-09-16.xlsx"
  hoja: string;               // nombre de la pestaña, p.ej. "Certificados"
  dataset: string;            // rótulo de lo exportado, p.ej. "Certificados"
  columnas: ExpColumn[];
  filas: (string | number | Date | null)[][];
  formato: "xlsx" | "csv";
}

const NAVY = "FF0836C7";       // azul corporativo
const HEAD_BG = "FF0B2A5B";    // encabezado de tabla (navy)
const INK_2 = "FF5D6B7E";

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function descargar(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportarCSV(opts: ExportOpts) {
  const sep = ";";   // es-CO: Excel abre columnas con punto y coma
  const esc = (v: string | number | Date | null) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [opts.columnas.map((c) => esc(c.header)).join(sep),
    ...opts.filas.map((f) => f.map(esc).join(sep))];
  const csv = "﻿" + lineas.join("\r\n");   // BOM → Excel respeta UTF-8
  descargar(new Blob([csv], { type: "text/csv;charset=utf-8" }), opts.filename);
}

export async function exportarExcel(opts: ExportOpts): Promise<void> {
  if (opts.formato === "csv") { exportarCSV(opts); return; }

  const ExcelJS: typeof ExcelJSNS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cardona & co."; wb.created = new Date();
  const ws = wb.addWorksheet(opts.hoja.slice(0, 31) || "Datos");

  const C0 = 2;                       // primera columna = B
  const n = opts.columnas.length;
  const cLast = C0 + n - 1;
  ws.getColumn(1).width = 2.5;        // margen izquierdo (columna A)

  // Título "Cardona & Co."
  ws.mergeCells(2, C0, 2, cLast);
  const t = ws.getCell(2, C0);
  t.value = "Cardona & Co.";
  t.font = { name: "Calibri", size: 16, bold: true, color: { argb: NAVY } };
  t.alignment = { vertical: "middle" };
  ws.getRow(2).height = 22;

  // Subtítulo: qué se exportó + conteo + fecha
  ws.mergeCells(3, C0, 3, cLast);
  const s = ws.getCell(3, C0);
  s.value = `${opts.dataset} · ${opts.filas.length} registro(s) · ${new Date().toISOString().slice(0, 10)}`;
  s.font = { name: "Calibri", size: 11, color: { argb: INK_2 } };

  // Tabla nativa en la fila 5
  const hRow = 5;
  const ref = colLetter(C0) + hRow;
  ws.addTable({
    name: "Tabla_" + (opts.hoja.replace(/[^A-Za-z0-9]/g, "") || "Datos"),
    ref,
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: opts.columnas.map((c) => ({ name: c.header, filterButton: true })),
    rows: opts.filas.length ? opts.filas : [opts.columnas.map(() => null)],
  });

  // Encabezado con identidad (navy + texto blanco)
  const head = ws.getRow(hRow);
  head.height = 18;
  for (let i = 0; i < n; i++) {
    const cell = head.getCell(C0 + i);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle" };
  }

  // Formato y ancho por columna según su tipo
  opts.columnas.forEach((c, i) => {
    const col = ws.getColumn(C0 + i);
    let maxLen = c.header.length;
    for (const f of opts.filas) {
      const v = f[i];
      const len = v == null ? 0 : (v instanceof Date ? 10 : String(v).length);
      if (len > maxLen) maxLen = len;
    }
    col.width = Math.min(50, Math.max(10, maxLen + 2));
    const fmt = c.type === "money" ? '"$" #,##0'
      : c.type === "date" ? "yyyy-mm-dd"
      : c.type === "code" ? "@" : undefined;
    for (let r = hRow + 1; r <= hRow + opts.filas.length; r++) {
      const cell = ws.getCell(r, C0 + i);
      if (fmt) cell.numFmt = fmt;
      if (c.type === "money") cell.alignment = { horizontal: "right" };
      else if (c.type === "code" || c.type === "date" || c.type === "status") cell.alignment = { horizontal: "center" };
    }
  });

  // Congelar título + encabezado (y el margen izquierdo)
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: hRow, showGridLines: false }];

  const buf = await wb.xlsx.writeBuffer();
  descargar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), opts.filename);
}
