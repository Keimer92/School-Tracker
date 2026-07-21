import { syncService } from "./syncService";
import { markDirty, markClean, getDirtyTables } from "./dirtyTracker";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTables = new Set<string>();
const DEBOUNCE_MS = 2000;

async function flush() {
  debounceTimer = null;
  const tables = [...pendingTables];
  pendingTables = new Set();
  try {
    await syncService.syncAllSilent();
    tables.forEach(t => markClean(t));
  } catch (e) {
    console.warn('[AutoSync] Error en sync:', e);
  }
}

export function onDataChange(table?: string) {
  if (table) {
    pendingTables.add(table);
    markDirty(table);
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flush, DEBOUNCE_MS);
}

export function cancelPendingSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingTables = new Set();
}

export function flushNow() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    flush();
  }
}
