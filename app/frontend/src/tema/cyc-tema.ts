// Tema CyC (kit compartido): MODO (auto/claro/oscuro) + PALETA (navy/azul/verde/grafito),
// independientes y persistentes por equipo (localStorage). Todo se aplica como atributos en
// <html> (data-theme / data-palette); el CSS hace el resto con los tokens de cyc-tema.css.
//
// Cada aplicativo se identifica en su <html> (ver ESTANDAR_TEMA_CYC.md):
//   data-tema-app="sd"          prefijo de las llaves (sd_modo, sd_paleta) y del evento (sd:tema)
//   data-tema-base="navy"       paleta de la casa del aplicativo
//   data-tema-modo-base="auto"  modo para quien nunca tocó el selector (auto | claro | oscuro)
// El arranque lo hace el script en línea de index.html (sin parpadeo); este módulo mantiene
// el estado en caliente. No editar la copia del aplicativo: se replica con Sync-TemaCyC.ps1.

export type Modo = "auto" | "claro" | "oscuro";
export type Paleta = "navy" | "azul" | "verde" | "grafito";

export const PALETAS: { id: Paleta; nombre: string; swatch: string }[] = [
  { id: "navy", nombre: "Navy", swatch: "#17294A" },
  { id: "azul", nombre: "Azul", swatch: "#0836c7" },
  { id: "verde", nombre: "Verde", swatch: "#4e9433" },
  { id: "grafito", nombre: "Grafito", swatch: "#4b5563" },
];
const IDS: string[] = PALETAS.map((p) => p.id);

function attr(n: string, def: string): string {
  try { return document.documentElement.getAttribute(n) || def; } catch { return def; }
}
const app = (): string => attr("data-tema-app", "cyc");
export const paletaBase = (): Paleta => {
  const b = attr("data-tema-base", "navy");
  return (IDS.includes(b) ? b : "navy") as Paleta;
};
const modoBase = (): Modo => {
  const m = attr("data-tema-modo-base", "auto");
  return m === "claro" || m === "oscuro" ? m : "auto";
};
const K_MODO = () => app() + "_modo";
const K_PAL = () => app() + "_paleta";
/** Nombre del evento que se dispara al cambiar el tema (p. ej. "sd:tema"). */
export const EVENTO_TEMA = (): string => app() + ":tema";

export function leerModo(): Modo {
  try { const v = localStorage.getItem(K_MODO()); if (v === "claro" || v === "oscuro" || v === "auto") return v; } catch { /* sin almacenamiento */ }
  return modoBase();
}
export function leerPaleta(): Paleta {
  try { const v = localStorage.getItem(K_PAL()); if (v && IDS.includes(v)) return v as Paleta; } catch { /* sin almacenamiento */ }
  return paletaBase();
}

/** ¿El sistema (Windows) pide oscuro ahora mismo? */
export function sistemaOscuro(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}

/** Modo efectivo (resuelve "auto" contra el sistema). */
export function modoEfectivo(m: Modo = leerModo()): "claro" | "oscuro" {
  return m === "auto" ? (sistemaOscuro() ? "oscuro" : "claro") : m;
}

/** Pinta los atributos en <html> según modo y paleta. */
export function aplicarTema(modo: Modo = leerModo(), paleta: Paleta = leerPaleta()): void {
  const r = document.documentElement;
  r.setAttribute("data-theme", modoEfectivo(modo));
  r.setAttribute("data-palette", paleta);
  forzarRepintado();
}

/**
 * Algunos GPU / versiones de Edge no vuelven a pintar las capas compuestas (menú lateral
 * `position:sticky`, franja superior) cuando el color llega por una variable heredada:
 * el valor calculado ya es el nuevo pero la textura se queda con el viejo. Un cambio de
 * estilo DIRECTO en el elemento sí obliga a re-rasterizar: se suelta el inline, se lee el
 * color de la paleta actual y se fija como inline.
 */
const SELS_MARCA = ".side, .ctx-band";
function forzarRepintado(): void {
  requestAnimationFrame(() => {
    document.querySelectorAll<HTMLElement>(SELS_MARCA).forEach((el) => {
      el.style.backgroundColor = "";
      const color = getComputedStyle(el).backgroundColor;
      el.style.backgroundColor = color;
    });
  });
}

function avisar(): void {
  try { window.dispatchEvent(new CustomEvent(EVENTO_TEMA(), { detail: { modo: leerModo(), paleta: leerPaleta() } })); } catch { /* ignore */ }
}
export function guardarModo(m: Modo): void {
  try { localStorage.setItem(K_MODO(), m); } catch { /* ignore */ }
  aplicarTema(m);
  avisar();
}
export function guardarPaleta(p: Paleta): void {
  try { localStorage.setItem(K_PAL(), p); } catch { /* ignore */ }
  aplicarTema(undefined, p);
  avisar();
}

/** En modo "auto", sigue a Windows en vivo. Devuelve el des-suscriptor. */
export function escucharSistema(): () => void {
  let mq: MediaQueryList;
  try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return () => {}; }
  const h = () => { if (leerModo() === "auto") { aplicarTema(); avisar(); } };
  try { mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }
  catch { mq.addListener(h); return () => mq.removeListener(h); }
}

/** Lee un token de color ya resuelto (para gráficas que pintan por atributo SVG o canvas). */
export function colorToken(nombre: string, def = ""): string {
  try { return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || def; } catch { return def; }
}
