/**
 * nubeModales.svelte.ts — Estado global de los modales de nube.
 *
 * Nube dejó de ser una página del rail de Configuración: el contenido de
 * CloudPage vive ahora en dos modales (`ModalNubeD1` y `ModalNubeDrive`) que
 * se abren desde donde haga falta (cards del sidebar, chips del header en
 * Android, accesos futuros).
 *
 * El estado es UN solo `let` con `$state` en un módulo `.svelte.ts` (y NO en un
 * `.ts` común) por el mismo motivo que `i18n.svelte.ts`: leído dentro de un
 * template o de un `$derived` queda registrado como dependencia, así que
 * Svelte re-renderiza solo al abrir o cerrar.
 *
 * Con un `let` normal en un `.ts` común, abrir el modal no re-renderizaría
 * nada y el componente quedaría invisible (sin error de compilación: el
 * proyecto tiene `fail-on-warnings=false` y `$state` acepta cualquier cosa).
 */

export type PanelNube = 'd1' | 'drive';

let abierto: PanelNube | null = $state(null);

/** Abre un panel de nube. Volver a abrir el mismo no lo duplica. */
export function abrirNube(panel: PanelNube) {
  abierto = panel;
}

/** Cierra el modal de nube que esté abierto (o no hace nada si no hay). */
export function cerrarNube() {
  abierto = null;
}

/** Panel abierto ahora mismo, o `null`. */
export function panelNubeAbierto(): PanelNube | null {
  return abierto;
}

/** `true` si el panel pedido es el que está abierto. */
export function panelNubeVisible(panel: PanelNube): boolean {
  return abierto === panel;
}