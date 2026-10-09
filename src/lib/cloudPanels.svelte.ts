/**
 * cloudPanels.svelte.ts — Global state for the cloud modals.
 *
 * The cloud UI is no longer a page in the Configuración rail: the content that
 * used to live in CloudPage is now two modals (`ModalNubeD1` and
 * `ModalNubeDrive`), opened from wherever it makes sense (sidebar cards, the
 * Android header chips, future entry points).
 *
 * The state is a single `let` with `$state` inside a `.svelte.ts` module (NOT a
 * plain `.ts` one) for the same reason as `i18n.svelte.ts`: reading it inside a
 * template or a `$derived` registers the dependency, so Svelte re-renders on
 * open/close by itself.
 *
 * With a plain `let` in a normal `.ts` module, opening a modal would not
 * re-render anything and the panel would stay invisible — with no compile
 * error, because the project sets `fail-on-warnings=false`.
 */

/** Which panel the store currently points at. */
export type PanelCloud = 'd1' | 'drive';

let abierto: PanelCloud | null = $state(null);

/** Opens a cloud panel. Re-opening the same one is a no-op. */
export function openCloudPanel(panel: PanelCloud) {
  abierto = panel;
}

/** Closes whichever cloud panel is open (no-op when none is). */
export function closeCloudPanel() {
  abierto = null;
}

/** Panel currently open, or `null`. */
export function currentCloudPanel(): PanelCloud | null {
  return abierto;
}

/** `true` when the requested panel is the open one. */
export function isCloudPanelOpen(panel: PanelCloud): boolean {
  return abierto === panel;
}