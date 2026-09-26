/**
 * driveInstantBackup
 *
 * Respaldo instantáneo a Google Drive tras CUALQUIER escritura en la base de
 * datos (guardar notas, asistencia, estudiantes, catálogos, indicadores, días
 * sin clases, calificaciones...). Se engancha al único embudo de
 * notificaciones de cambios del proyecto: `onDataChange()` en `autoSync.ts`.
 *
 * Diseño:
 *   - Debounce de 12 s: agrupa ráfagas de guardados (p. ej. several estudiantes
 *     followed en seconds) en UNA sola subida.
 *   - Sin push en curso: si llega un cambio mientras sube, se encola para
 *     repetir al terminar (nunca se pierde un cambio).
 *   - No crea archivos nuevos: `driveSyncService.pushLatestBackup()` actualiza
 *     el archivo estable "..._latest.db" en Drive. Los snapshots con timestamp
 *     los crea el planificador `driveAutoBackup` (cada 60 min, adaptativo) y la
 *     retención mantiene 2 archivos en total por cuenta.
 *   - Silencioso: no muestra toasts (un toast por guardado sería ruido); el
 *     tiempo de "Último respaldo" de la card de Drive se actualiza solo.
 *   - Se puede apagar desde Ajustes: `drive_instant_backup_enabled` = 'false'.
 */
import { driveSyncService } from './driveSyncService';

const ENABLED_KEY = 'drive_instant_backup_enabled';
/** Espera de inactividad antes de subir (agrupa guardados seguidos). */
const DEBOUNCE_MS = 12_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let queued = false;
/** Último resultado, para diagnóstico desde consola. */
let lastResult: { at: string; ok: boolean; reason?: string } | null = null;

function isEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setInstantBackupEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.warn('[DriveInstant] No se pudo guardar la preferencia:', e);
  }
  if (!enabled && debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function isInstantBackupEnabled(): boolean {
  return isEnabled();
}

/** ¿Hay Drive vinculado? (chequeo local, sin red: solo decide si encolar). */
function driveLinked(): boolean {
  try {
    const raw = localStorage.getItem('schooltracker-google-drive-settings');
    if (!raw) return false;
    const s = JSON.parse(raw);
    return !!(s?.refreshToken || s?.accessToken);
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  if (!isEnabled()) return;
  if (!navigator.onLine) {
    console.debug('[DriveInstant] sin conexión: se omite (el cambio se respaldará al volver)');
    return;
  }
  if (!driveLinked()) return;
  if (isRunning) {
    // Ya hay una subida en curso: se reagenda al terminar para no perder cambios.
    queued = true;
    return;
  }
  isRunning = true;
  const t0 = Date.now();
  try {
    const res = await driveSyncService.pushLatestBackup();
    lastResult = { at: new Date().toISOString(), ok: res.ok, reason: res.reason };
    if (res.ok) {
      console.debug(
        `[DriveInstant] respaldo ${res.created ? 'creado' : 'actualizado'} en ${Date.now() - t0} ms`
      );
    } else {
      console.debug(`[DriveInstant] omitido: ${res.reason}`);
    }
  } catch (e) {
    lastResult = { at: new Date().toISOString(), ok: false, reason: String((e as Error)?.message || e) };
    console.warn('[DriveInstant] falló el respaldo instantáneo:', e);
  } finally {
    isRunning = false;
    if (queued) {
      queued = false;
      scheduleInstantBackup();
    }
  }
}

/** Encola un respaldo instantáneo (debounce). Usar tras cada escritura en la BD. */
export function scheduleInstantBackup(): void {
  if (!isEnabled()) return;
  ensureListener();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void run();
  }, DEBOUNCE_MS);
}

/** Sube ahora mismo (sin esperar el debounce). */
export function runInstantBackupNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  return run();
}

/**
 * Al ocultar la app (minimizar / cambiar de app en Android) se ejecuta lo que
 * hubiera pendiente: los temporizadores del WebView se congelan en background,
 * así que sin esto un guardado seguido de un minimize se quedaría sin respaldar.
 */
function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    void run();
  }
}

let listening = false;
function ensureListener() {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      void run();
    }
  });
}

export function getInstantBackupState() {
  return {
    enabled: isEnabled(),
    debounceMs: DEBOUNCE_MS,
    isRunning,
    queued,
    lastResult,
    latestFileName: driveSyncService.latestFileName(),
  };
}
