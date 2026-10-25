import { Icon } from "../ui";

export const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Selector de período (mes + año) estándar de la firma. */
export function PeriodoPicker({ mes, anio, onMes, onAnio, title = "Período" }: {
  mes: number; anio: number; onMes: (m: number) => void; onAnio: (a: number) => void; title?: string;
}) {
  return (
    <span className="fact-period" title={title}>
      <Icon name="calendar" size={16} />
      <select value={mes} onChange={(e) => onMes(Number(e.target.value))}>
        {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <input className="fp-year" value={anio} onChange={(e) => onAnio(Number(e.target.value) || anio)} />
    </span>
  );
}
