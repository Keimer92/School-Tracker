/**
 * driveInstantBackup
 *
 * Respaldo instantáneo a Google Drive tras CUALQUIER escritura en la base de
 * datos (guardar notas, asistencia, estudiantes, catálogos, indicadores, días
 * sin clases, calificaciones...). Se engancha al único embudo de
 * notificaciones de cambios del proyecto: `onDataChange()` en `autoSync.ts`.
 *
 * Diseño:
 *   - Debounce de 5 s: agrupa ráfagas de guardados (p. ej. several estudiantes
 *     followed en seconds) en UNA sola subida. Bajado de 12 s a 5 s (2026-09).
 *   - Sin push en curso: si llega un cambio mientras sube, se encola para
 *     repetir al terminar (nunca se pierde un cambio).
 *   - No crea archivos nuevos: `driveSyncService.pushLatestBackup()` actualiza
 *     el archivo estable "..._latest.db" en Drive. Los snapshots con timestamp
 *     los crea el planificador `driveAutoBackup` (cada 60 min, adaptativo) y la
 *     retención mantiene 2 archivos en total por cuenta.
 *   - Notificación visual: avisa con un toast al terminar (momento + MB) y al
 *     fallar. Con anti-spam: como se dispara tras cada guardado, los avisos se
 *     agrupan (máx. 1 cada 45 s) y si hubo varios se resume "N respaldos".
 *   - Se puede apagar desde Ajustes: `drive_instant_backup_enabled` = 'false'.
 */
import { emit } from '@tauri-apps/api/event';
import { driveSyncService, syncManager } from './driveSyncService';
import { t, getLocale } from './i18n.svelte';
import { fmtHoraNica } from './fecha';

const ENABLED_KEY = 'drive_instant_backup_enabled';
/** Espera de inactividad antes de subir (agrupa guardados seguidos). */
const DEBOUNCE_MS = 5_000;
/** Separación mínima entre dos toasts de "respaldo actualizado". */
const TOAST_MIN_GAP_MS = 45_000;
/** Separación mínima entre dos avisos de error. */
const TOAST_ERROR_GAP_MS = 150_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let queued = false;
/** Último resultado, para diagnóstico desde consola. */
let lastResult: { at: string; ok: boolean; reason?: string } | null = null;

// ── Avisos (toast) ──
let ultimoToastAt = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let respaldosDesdeToast = 0;
let ultimoErrorToastAt = 0;

function fmtBytes(n: number): string {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function horaActual(): string {
  return fmtHoraNica(new Date(), getLocale());
}

function mostrarToastExito() {
  const n = respaldosDesdeToast;
  respaldosDesdeToast = 0;
  ultimoToastAt = Date.now();
  const bytes = syncManager.getState().lastUploadBytes;
  const tam = bytes ? ` · ${fmtBytes(bytes)}` : '';
  const mensaje = n > 1
    ? t('dib.actualizados', { n, tam })
    : t('dib.actualizado', { tam, hora: horaActual() });
  void emit('show-toast', { message: mensaje, type: 'success' });
}

/** Avisa del respaldo automatico, sin spamear si se guardó varias veces seguidas. */
function notificarExito() {
  respaldosDesdeToast++;
  if (toastTimer) return; // ya hay un aviso consolidado programado
  const gap = Date.now() - ultimoToastAt;
  if (gap >= TOAST_MIN_GAP_MS) {
    mostrarToastExito();
    return;
  }
  toastTimer = setTimeout(() => { toastTimer = null; mostrarToastExito(); }, TOAST_MIN_GAP_MS - gap);
}

function notificarError(motivo: string) {
  const now = Date.now();
  if (now - ultimoErrorToastAt < TOAST_ERROR_GAP_MS) return;
  ultimoErrorToastAt = now;
  void emit('show-toast', { message: t('dib.errorRespaldar', { motivo }), type: 'error' });
}

// ── Falta de conexión: UN aviso por episodio, después silencio total ──
//
// Antes, cada guardado con el teléfono sin wifi/datos lanzaba el toast
// "No se pudo respaldar en Drive: Failed to fetch". El usuario pidió lo
// contrario: enterarse UNA vez de que no hay conexión y que los guardados
// sigan fallando en silencio hasta que vuelva la red.
let sinConexionAvisada = false;

/** ¿El fallo es de red (sin wifi/datos) y no de la app/Drive? */
function esErrorDeRed(motivo: string): boolean {
  // `navigator.onLine` no es 100 % fiable (en Android puede decir true sin
  // ruta real), así que además se inspecciona el mensaje del fallo.
  if (!navigator.onLine) return true;
  const m = (motivo || '').toLowerCase();
  return /failed to fetch|network ?request failed|networkerror|load failed|net::|err_|econn|connection|socket|dns|timed? ?out|timeout|os error 10054|offline|sin conexi|error de red/.test(m);
}

/** Avisa que no hay internet, una sola vez por corte. */
function avisarSinConexionUnaVez() {
  if (sinConexionAvisada) return;
  sinConexionAvisada = true;
  console.debug('[DriveInstant] sin conexión: aviso único; los guardados siguen en silencio');
  void emit('show-toast', { message: t('dib.sinConexion'), type: 'info' });
}

/** Al volver la red se rearma el aviso para el próximo corte. */
function marcarConexionRestaurada() {
  sinConexionAvisada = false;
}

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
    // Se avisa UNA vez por corte y se sigue intentando en cada guardado: si la
    // red vuelve mientras tanto, la subida ocurre sola y sin mensajes extra.
    avisarSinConexionUnaVez();
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
      marcarConexionRestaurada();
      console.debug(
        `[DriveInstant] respaldo ${res.created ? 'creado' : 'actualizado'} en ${Date.now() - t0} ms`
      );
      notificarExito();
    } else {
      // 'offline' / 'no_drive' no son fallos: no se avisa para no molestar.
      console.debug(`[DriveInstant] omitido: ${res.reason}`);
      if (res.reason === 'offline') {
        avisarSinConexionUnaVez();
      } else if (res.reason === 'no_drive') {
        // Se quedó sin token: el usuario debe vincular Drive otra vez.
        notificarError(t('dib.motivo.revincular'));
      } else if (res.reason === 'base_vacia') {
        // La base local no tiene datos. Se AVISA porque si no el usuario cree
        // que está respaldando y no lo está: es exactamente el caso en el que
        // un respaldo bueno se perdería.
        notificarError(t('dib.motivo.baseVacia'));
      }
    }
  } catch (e) {
    const motivo = String((e as Error)?.message || e);
    lastResult = { at: new Date().toISOString(), ok: false, reason: motivo };
    console.warn('[DriveInstant] falló el respaldo instantáneo:', e);
    // Sin conexión NO es un error para mostrar: ya se avisó una vez (o se avisa
    // ahora) y a partir de ahí los guardados fallan en silencio, como se pidió.
    if (esErrorDeRed(motivo)) {
      avisarSinConexionUnaVez();
    } else {
      notificarError(motivo);
    }
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
  // Al recuperar la red se rearma el aviso único. El respaldo pendiente lo
  // dispara el propio flujo de guardado (o el siguiente cambio), no este listener:
  // subir sin cambios no aporta nada.
  window.addEventListener('online', () => {
    marcarConexionRestaurada();
  });
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
