/**
 * d1Connection.svelte.ts — Cloudflare D1 connect/disconnect switch.
 *
 * WHY: restoring a `.db` from Google Drive is not enough on its own. The restore
 * path calls `d1_reset_device_id`, which clears the `last_sync` cursor, so the
 * very next sync does a FULL pull of the cloud database and puts the older cloud
 * rows back on top of the freshly restored data. Nothing in the sync itself can
 * tell "the cloud is right" from "the cloud is stale".
 *
 * So the user gets an explicit switch: disconnect = this device neither pushes
 * nor pulls, Drive keeps backing up normally, and the restored database stays
 * the source of truth. Reconnecting does a full push first so the local database
 * wins over whatever the cloud had.
 *
 * The flag lives in `localStorage` ON PURPOSE, not in the SQLite `d1_config`:
 *  · it is a per-device decision, not data that should travel to the cloud;
 *  · a backup restored from Drive carries its own `d1_config`, so a flag stored
 *    there would silently flip itself back when the user restores that backup;
 *  · it survives app restarts, which is the whole point ("it stays off until I
 *    turn it back on").
 *
 * This module is deliberately dependency-free (no service imports) so every
 * layer can read the flag without creating an import cycle. Turning the switch
 * actually stops/starts the machinery lives in `syncService.setD1Connected()`.
 *
 * `$state` in a `.svelte.ts` module (not a plain `.ts`) so reading it from a
 * template re-renders when it changes — same reason as `i18n.svelte.ts`.
 */

const KEY = 'stp_d1_conectado';

function leer(): boolean {
  try {
    // Only an explicit "false" disconnects; anything else keeps the previous
    // behaviour (connected) so a corrupted/empty value never silently stops
    // the sync.
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

let conectado = $state(leer());

/** Reactive read: `d1Conectado()` inside a template or `$derived`. */
export function d1Conectado(): boolean {
  return conectado;
}

/**
 * Persists the flag ONLY. Use `syncService.setD1Connected()` to also stop/start
 * the periodic timer and the WebSocket.
 */
export function persistirD1Conectado(v: boolean) {
  conectado = v;
  try { localStorage.setItem(KEY, v ? 'true' : 'false'); } catch { /* private mode */ }
}