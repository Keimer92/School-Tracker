import { syncService } from "./syncService";
import { markDirty, markClean, getDirtyTables } from "./dirtyTracker";
import { scheduleInstantBackup } from "./driveInstantBackup";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTables = new Set<string>();
let isFlushing = false;
const DEBOUNCE_MS = 2000;

async function flush() {
  if (isFlushing) return;
  isFlushing = true;
  try {
    // Drena la cola: si llegan cambios durante el sync (p.ej. varias acciones
    // inmediatas seguidas), se procesan en el mismo flush para no disparar syncs redundantes.
    while (pendingTables.size > 0) {
      const tables = [...pendingTables];
      pendingTables = new Set();
      await syncService.syncAllSilent();
      tables.forEach(t => markClean(t));
    }
  } catch (e) {
    console.warn('[AutoSync] Error en sync:', e);
  } finally {
    isFlushing = false;
    // Respaldo instantáneo a Google Drive: se dispara desde aquí para que TODAS
    // las escrituras de la BD (notas, asistencia, estudiantes, catálogos,
    // indicadores, días sin clases, calificaciones...) acaben respaldadas en
    // Drive. Va en `finally` para que también se dispare si el sync D1 falló.
    scheduleInstantBackup();
    if (pendingTables.size > 0 && !debounceTimer) {
      debounceTimer = setTimeout(flush, 300);
    }
  }
}

export function onDataChange(table?: string, opts?: { immediate?: boolean }) {
  if (table) {
    pendingTables.add(table);
    markDirty(table);
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  if (opts?.immediate) {
    // Dispara el sync ya, sin esperar el debounce (acciones críticas: guardar notas,
    // asistencia, estudiante...). Si hay un flush en curso, el pending se absorbe en él.
    flush();
  } else {
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  }
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
    debounceTimer = null;
  }
  flush();
}
