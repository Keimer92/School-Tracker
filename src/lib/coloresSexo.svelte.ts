/**
 * coloresSexo.svelte.ts — color de fuente por sexo, configurable desde Ajustes.
 *
 * Antes estos dos colores vivían sueltos en cada página: `#60a5fa` (masculino)
 * y `#f472b6` (femenino) estaban escritos a mano en el CSS de AsistenciaPage,
 * en estilos inline de NotasPage, EstudiantesPage y en el resumen de
 * asistencia. Cambiarlos obligaba a cazarlos uno por uno, y era fácil que
 * quedara uno sin cambiar y la UI quedara mitad azul / mitad rosa.
 *
 * Acá hay una sola fuente. Las páginas leen `colorSexo('M')` y el color sale
 * de los ajustes sincronizables (`app_settings`), así que un cambio hecho en
 * un dispositivo llega al otro por el sync normal de la app.
 *
 * Es un módulo `.svelte.ts` (y no `.ts`) porque el color es `$state`: al leerlo
 * dentro de un template, Svelte registra la dependencia y la tabla se
 * repinta sola. Con un `let` normal, cambiar el color en Ajustes solo se vería
 * al recargar la página.
 */

import { getAppSettings, onAppSettingsChange } from "./appSettings";

export const COLOR_MASCULINO_POR_DEFECTO = "#60a5fa";
export const COLOR_FEMENINO_POR_DEFECTO = "#f472b6";

/** Espejo reactivo de los dos colores. */
let sexoM = $state(getAppSettings().sexoMColor || COLOR_MASCULINO_POR_DEFECTO);
let sexoF = $state(getAppSettings().sexoFColor || COLOR_FEMENINO_POR_DEFECTO);

/**
 * Suscripción permanent al store de ajustes.
 *
 * Se registra al importar el módulo (una sola vez) en vez de en cada
 * componente: hay seis páginas distintas que necesitan los colores y cada una
 * tendría que acordarse de desuscribirse al destruirse.
 * El store vive toda la vida de la app, así que la suscripción también.
 */
onAppSettingsChange((s) => {
  sexoM = s.sexoMColor || COLOR_MASCULINO_POR_DEFECTO;
  sexoF = s.sexoFColor || COLOR_FEMENINO_POR_DEFECTO;
});

/** Color de fuente para el sexo indicado (`'M'` / `'F'`). */
export function colorSexo(sexo: string | null | undefined): string {
  return sexo === "F" ? sexoF : sexoM;
}

/** Los dos colores, para pintar una vista previa de un vistazo. */
export function coloresSexo(): { m: string; f: string } {
  return { m: sexoM, f: sexoF };
}

/**
 * Versión de `colorSexo` para código NO reactivo: los generadores de PDF y
 * Excel.
 *
 * Estos se ejecutan al exportar, fuera de cualquier ciclo de render, así que no
 * hay dependencia que registrar y lo que interesa es leer el valor vigente.
 * Lee de `getAppSettings()` y NO del `$state` de arriba a propósito: el store
 * de ajustes ya está cargado cuando se exporta, y `getAppSettings()` devuelve
 * el default si el usuario nunca tocó el ajuste.
 *
 * Se exporta desde acá (y no se importa `colorSexo`) para que los PDF no
 * dependan del compilador de Svelte: `notasPdf.ts` se puede ejercitar en Node
 * plano (ver la nota de pruebas de PDF en AGENTS.md).
 */
export function colorSexoExport(sexo: string | null | undefined): string {
  const s = getAppSettings();
  if (sexo === "F") return s.sexoFColor || COLOR_FEMENINO_POR_DEFECTO;
  return s.sexoMColor || COLOR_MASCULINO_POR_DEFECTO;
}

/**
 * Escribe los dos colores como variables CSS en `<html>`.
 *
 * Es el mecanismo para las clases globales `.gender-m` / `.gender-f` de
 * `App.css`: en vez de que cada página pase el color por prop o por variable
 * inline, se define una vez en la raíz del documento y todas las hojas de
 * estilo lo heredan. Así una página nueva que use esas clases funciona sin
 * enterarse de que existe un ajuste de color.
 *
 * Es imperativo a propósito (`document.documentElement.style`): el `<html>` es
 * la raíz real del documento y no hay ningún punto de Svelte al que colgarlo.
 */
export function aplicarColoresSexo(s: { sexoMColor?: string; sexoFColor?: string }): void {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement.style;
  raiz.setProperty("--sexo-m", s.sexoMColor || COLOR_MASCULINO_POR_DEFECTO);
  raiz.setProperty("--sexo-f", s.sexoFColor || COLOR_FEMENINO_POR_DEFECTO);
}

/**
 * Versión translúcida del color, para fondos (`rgba` equivalente a un 12 %).
 *
 * Se usa donde el color va de fondo con texto encima. Convierte el hex a RGB
 * y aplica alfa: los usages son del tipo
 * `background:{colorSexo('M')}1a`, que ya funcionaba con hex, pero no con un
 * `rgba()` completo. Por eso se normaliza a hex de 6 dígitos antes de
 * concatenar.
 */
export function colorSexoAlfa(sexo: string | null | undefined, hexFinal: string): string {
  const hex = colorSexo(sexo).replace("#", "");
  const completo = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return `#${completo}${hexFinal}`;
}