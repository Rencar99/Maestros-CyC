/* Lo que Maestros le presta a la grilla del kit.
 *
 * Este archivo es de Maestros: Sync-GrillaReactCyC.ps1 NO lo sobrescribe. Es el
 * único punto donde la copia del kit se amarra a los módulos de esta aplicación,
 * y donde se absorben las diferencias entre las dos.
 * Ver estandar-cyc\grilla-react\README.md.
 */
import { exportarExcel as exportarDeMaestros, type ExportOpts } from "../lib/exportExcel";

// En Maestros el icono vive en ui.tsx, no en components/Icon.
export { Icon } from "../ui";

/* La grilla del kit le pasa a `exportarExcel` dos opciones que el exportador de
 * Maestros todavía no conoce, porque nacieron en Descargas DIAN:
 *
 *   subtitulo  texto para la celda B3 del Excel (cosmético) -> se ignora
 *   entregar   devolver el archivo a la pantalla en vez de bajarlo a Descargas
 *
 * `subtitulo` se descarta sin ruido: el Excel sale con su rótulo de siempre.
 * `entregar` NO se puede descartar en silencio: la pantalla que lo use estaría
 * esperando el archivo para guardarlo en otro lado, y bajarlo a Descargas sería
 * hacer algo distinto de lo que pidió. Se avisa, y la grilla muestra el aviso.
 * Hoy ninguna pantalla de Maestros lo usa.
 */
type OpcionesDeLaGrilla = ExportOpts & {
  subtitulo?: string;
  entregar?: (archivo: Blob, filename: string) => Promise<void>;
};

export async function exportarExcel(opciones: OpcionesDeLaGrilla): Promise<void> {
  const { subtitulo: _subtitulo, entregar, ...soportadas } = opciones;
  if (entregar) {
    throw new Error(
      "Esta pantalla pide recibir el archivo, y el exportador de Maestros todavía " +
      "no lo entrega. Amplíe lib/exportExcel.ts con la opción «entregar».",
    );
  }
  return exportarDeMaestros(soportadas);
}

/* PENDIENTE: Maestros sí tiene avisos, pero como hook de contexto (`useToast()`
 * en ui.tsx), y la grilla espera una función que pueda llamar desde su
 * manejador. Mientras se tiende ese puente se usa el aviso del navegador. La
 * grilla lo llama en UN solo punto: cuando falla la exportación a Excel.
 */
export const toast = (mensaje: string) => window.alert(mensaje);
