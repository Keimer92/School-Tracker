/**
 * driveAutoBackup
 *
 * Scheduler híbrido de respaldos automáticos a Google Drive:
 *
 *   Capa 1 — Timer inteligente:
 *     backoff exponencial por éxito (base → 2x → 4x hasta max), reset a base
 *     tras un fallo, jitter ±jitterMin aleatorio.
 *
 *   Capa 2 — Triggers pasivos (no son writes de BD):
 *     - visibilitychange → visible (debounce 5s, throttle 15min)
 *     - visibilitychange → hidden (fire-and-forget, throttle 15min)
 *     - online / offline (pausar timer)
 *     - WiFi/red buena (4g o wifi, no saveData)
 *     - battery = cargando (leído vía gd_battery_status JNI)
 *     - boot de la app
 *     - cambio de cuenta (flush sincrónico antes de open_account_db)
 *
 *   Reglas globales:
 *     - Throttle 15 min entre subidas reales.
 *     - Backoff de reintentos: 5 → 15 → 60 min, notificar al 3er fallo.
 *     - Notificación Android nativa en éxito (si falló antes o >24h),
 *       3 fallos consecutivos, swap de cuenta, recordatorio >24h.
 *
 * Persistencia: una sola clave `drive_auto_backup_state` en localStorage.
 * Migración: si existe `drive_auto_backup_minutes` se consume una sola vez.
 */
import { invoke } from '@tauri-apps/api/core';
import { driveSyncService } from './driveSyncService';

const STATE_KEY = 'drive_auto_backup_state';
const LEGACY_KEY = 'drive_auto_backup_minutes';

interface NetworkConnection {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

interface BatteryStatus {
  charging: boolean;
  level: number;
  source: string;
}

/** Estado del planificador. Exportado para mostrarlo en Ajustes -> Depuración. */
export interface AutoBackupState {
  enabled: boolean;
  baseIntervalMin: number;
  maxIntervalMin: number;
  jitterMin: number;
  currentIntervalMin: number;
  onlyWifi: boolean;
  onlyWhenCharging: boolean;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMsg: string | null;
  consecutiveFails: number;
  nextRunAt: number | null;
  totalUploads: number;
}

export type TriggerReason =
  | 'timer'
  | 'visibility'
  | 'hidden'
  | 'online'
  | 'boot'
  | 'manual'
  | 'account_swap';

const THROTTLE_MIN = 15 * 60 * 1000; // 15 min entre subidas reales
const MAX_CONSECUTIVE_FAILS = 3;
const REMIND_24H_MS = 24 * 60 * 60 * 1000;

const DEFAULT_STATE: AutoBackupState = {
  enabled: true,
  baseIntervalMin: 60,
  maxIntervalMin: 360,
  jitterMin: 15,
  currentIntervalMin: 60,
  onlyWifi: true,
  onlyWhenCharging: false,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMsg: null,
  consecutiveFails: 0,
  nextRunAt: null,
  totalUploads: 0,
};

let state: AutoBackupState = { ...DEFAULT_STATE };
let timerHandle: ReturnType<typeof setTimeout> | null = null;
let visibilityDebounce: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let isStarted = false;

function loadState(): AutoBackupState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AutoBackupState>;
      return { ...DEFAULT_STATE, ...parsed };
    }
    // Migración desde la clave legacy (drive_auto_backup_minutes)
    const legacy = parseInt(localStorage.getItem(LEGACY_KEY) || '', 10);
    if (Number.isFinite(legacy) && legacy > 0) {
      const migrated: AutoBackupState = {
        ...DEFAULT_STATE,
        baseIntervalMin: legacy,
        currentIntervalMin: legacy,
      };
      localStorage.setItem(STATE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
  } catch (e) {
    console.warn('[AutoBackup] Error leyendo estado, usando defaults:', e);
  }
  return { ...DEFAULT_STATE };
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[AutoBackup] Error guardando estado:', e);
  }
}

function jitter(): number {
  const j = state.jitterMin;
  if (j <= 0) return 0;
  return Math.floor(Math.random() * j * 60_000);
}

function isGoodNetwork(): boolean {
  if (!state.onlyWifi) return true;
  const c = (navigator as unknown as { connection?: NetworkConnection })
    .connection;
  if (!c) return true; // sin API → asumir bien
  if (c.saveData) return false;
  if (c.type === 'wifi') return true;
  const t = c.effectiveType;
  if (t === '4g') return true;
  if (t === 'wifi') return true;
  // 3g/2g/slow-2g/edge → rechazar
  return false;
}

async function isCharging(): Promise<boolean> {
  try {
    const b = await invoke<BatteryStatus>('gd_battery_status');
    return !!b.charging;
  } catch {
    return true; // si falla, no bloquear
  }
}

function shouldThrottle(): boolean {
  if (!state.lastSuccessAt) return false;
  return Date.now() - state.lastSuccessAt < THROTTLE_MIN;
}

async function canRunNow(
  reason: TriggerReason,
  options: { skipThrottle?: boolean; skipBattery?: boolean } = {}
): Promise<{ ok: boolean; reason?: string }> {
  // `setEnabled(false)` solo limpiaba el timer, pero los triggers pasivos
  // (boot/visibility/online/hidden) seguían empujando: apagar el respaldo
  // automático en Ajustes no lo apagaba de verdad.
  if (!state.enabled) return { ok: false, reason: 'disabled' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  if (!options.skipThrottle && shouldThrottle())
    return { ok: false, reason: 'throttled' };
  if (!isGoodNetwork()) return { ok: false, reason: 'slow_network' };
  if (!options.skipBattery && state.onlyWhenCharging) {
    if (!(await isCharging())) return { ok: false, reason: 'not_charging' };
  }
  if (await driveSyncService.hasLocalChanges()) return { ok: true };
  return { ok: false, reason: 'no_changes' };
}

async function notifyAndroid(title: string, body: string) {
  try {
    await invoke('gd_show_notification', { title, body });
  } catch (e) {
    console.debug('[AutoBackup] notificación omitida:', e);
  }
}

function shouldNotifySuccess(): boolean {
  // Notificar si veníamos de fallo o si el último éxito fue hace >24h
  if (state.consecutiveFails > 0) return true;
  if (state.lastSuccessAt && Date.now() - state.lastSuccessAt > REMIND_24H_MS)
    return true;
  return false;
}

async function recordSuccess(reason: TriggerReason) {
  const wasFailing = state.consecutiveFails > 0;
  state.lastSuccessAt = Date.now();
  state.lastErrorAt = null;
  state.lastErrorMsg = null;
  state.consecutiveFails = 0;
  state.totalUploads += 1;
  // Backoff exponencial por éxito
  const next = Math.min(state.currentIntervalMin * 2, state.maxIntervalMin);
  state.currentIntervalMin = Math.max(state.baseIntervalMin, next);
  saveState();
  console.debug(
    `[AutoBackup] success via ${reason}, next in ${state.currentIntervalMin}±${state.jitterMin} min`
  );
  if (wasFailing || shouldNotifySuccess()) {
    await notifyAndroid(
      '☁️ Respaldo guardado',
      `Última copia: ${new Date().toLocaleTimeString()}`
    );
  }
}

function recordFailure(err: string) {
  state.lastErrorAt = Date.now();
  state.lastErrorMsg = err;
  state.consecutiveFails += 1;
  // Resetear backoff a base
  state.currentIntervalMin = state.baseIntervalMin;
  saveState();
  console.warn(`[AutoBackup] fail #${state.consecutiveFails}: ${err}`);
  if (state.consecutiveFails === MAX_CONSECUTIVE_FAILS) {
    void notifyAndroid(
      '❌ Respaldo a Drive falló 3 veces',
      err.slice(0, 120)
    );
  }
}

function scheduleNextRun() {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  // OJO: el guard es `isStarted` + `state.enabled`, NUNCA `isRunning`.
  // `start()` hace `isRunning = false` y llama a `scheduleNextRun()` justo
  // después, así que con `!isRunning` en el guard el temporizador NUNCA se
  // armaba: la "capa 1" (timer adaptativo) estaba muerta desde siempre y solo
  // funcionaban los triggers pasivos (boot/visibility/online). Peor: en el
  // `finally` de `runOnce` el rearmado tampoco pasaba, así que ni siquiera
  // después de un timer disparado se reprogramaba el siguiente.
  // El estado que decide si tiene que haber timer es `enabled`, no si hay una
  // subida en vuelo (`isRunning`).
  if (!isStarted || !state.enabled) return;
  const baseMs = state.currentIntervalMin * 60_000;
  const delay = baseMs + jitter();
  state.nextRunAt = Date.now() + delay;
  saveState();
  timerHandle = setTimeout(() => {
    void notifyTrigger('timer');
  }, delay);
  console.debug(
    `[AutoBackup] next run scheduled in ${Math.round(delay / 60_000)} min`
  );
}

async function runOnce(reason: TriggerReason): Promise<{ ran: boolean; reason?: string }> {
  // Para triggers no-timer: si el timer ya se está ejecutando, no duplicar.
  if (isRunning && reason !== 'timer') {
    return { ran: false, reason: 'busy' };
  }
  isRunning = true;
  // Si el catch arma un timer de reintento corto (5/15/60 min), el `finally` NO
  // debe reprogramar el intervalo normal encima: se perdería el backoff y se
  // reintentaría al ritmo normal, que es justo lo contrario de lo que se busca.
  let retryArmed = false;
  try {
    const can = await canRunNow(reason, {
      // El timer ignora batería; los triggers manuales sí la respetan
      skipBattery: reason === 'timer',
    });
    if (!can.ok) {
      console.debug(`[AutoBackup] skip ${reason}: ${can.reason}`);
      return { ran: false, reason: can.reason };
    }
    try {
      await driveSyncService.forcePushAllSilent();
      await recordSuccess(reason);
      return { ran: true };
    } catch (e) {
      recordFailure(String((e as Error)?.message || e));
      // Backoff de reintentos: 5, 15, 60 min
      const backoffs = [5, 15, 60];
      const mins = backoffs[Math.min(state.consecutiveFails - 1, backoffs.length - 1)];
      if (timerHandle) clearTimeout(timerHandle);
      timerHandle = setTimeout(() => void notifyTrigger('timer'), mins * 60_000);
      retryArmed = true;
      return { ran: false, reason: 'push_failed' };
    }
  } finally {
    isRunning = false;
    if (reason === 'timer' && !retryArmed) scheduleNextRun();
  }
}

async function notifyTrigger(reason: TriggerReason) {
  // No rearma el timer acá: `runOnce` ya lo hace en su `finally` cuando el
  // motivo es 'timer'. Llamarlo dos veces aplicaba el jitter dos veces y
  // reiniciaba la cuenta regresiva.
  await runOnce(reason);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    // Debounce para no competir con el sync D1 que también reacciona.
    if (visibilityDebounce) clearTimeout(visibilityDebounce);
    visibilityDebounce = setTimeout(() => {
      void notifyTrigger('visibility');
      checkReminder();
    }, 5_000);
  } else {
    if (visibilityDebounce) {
      clearTimeout(visibilityDebounce);
      visibilityDebounce = null;
    }
    // Al irse a background: subir fire-and-forget si hay cambios.
    void (async () => {
      try {
        const can = await canRunNow('hidden', { skipThrottle: false });
        if (!can.ok) return;
        await driveSyncService.pushAllSilent();
      } catch (e) {
        console.debug('[AutoBackup] hidden push omitido:', e);
      }
    })();
  }
}

function onOnline() {
  if (!navigator.onLine) return;
  void notifyTrigger('online');
}

function onOffline() {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
}

let lastReminderAt: number | null = null;
async function checkReminder() {
  if (!state.lastSuccessAt) return;
  if (Date.now() - state.lastSuccessAt < REMIND_24H_MS) return;
  if (lastReminderAt && Date.now() - lastReminderAt < 6 * 60 * 60 * 1000) return;
  if (!(await driveSyncService.hasLocalChanges())) return;
  lastReminderAt = Date.now();
  await notifyAndroid(
    '⚠️ Cambios sin respaldar',
    'Tienes cambios locales con más de 24h sin subir a Drive.'
  );
}

function start() {
  if (isStarted) return;
  isStarted = true;
  isRunning = false;
  state = loadState();
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  scheduleNextRun();
  // Disparador de boot (con pequeño delay para no competir con el mount)
  setTimeout(() => void notifyTrigger('boot'), 4_000);
  console.debug('[AutoBackup] scheduler iniciado', state);
}

function stop() {
  if (!isStarted) return;
  isStarted = false;
  isRunning = false;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  if (visibilityDebounce) {
    clearTimeout(visibilityDebounce);
    visibilityDebounce = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  console.debug('[AutoBackup] scheduler detenido');
}

async function flushBeforeAccountSwap(): Promise<void> {
  // Pausar timer durante el swap
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  try {
    if (await driveSyncService.hasLocalChanges()) {
      try {
        await driveSyncService.forcePushAll();
        await recordSuccess('account_swap');
        await notifyAndroid(
          '📤 Cuenta anterior respaldada',
          'Subido a Drive antes del cambio de cuenta.'
        );
      } catch (e) {
        console.warn('[AutoBackup] flushBeforeAccountSwap falló:', e);
      }
    }
  } finally {
    // Reanudar timer con el estado actual (sin próximo inmediato)
    scheduleNextRun();
  }
}

function getState(): Readonly<AutoBackupState> {
  return { ...state };
}

function setEnabled(enabled: boolean) {
  state.enabled = enabled;
  saveState();
  if (!enabled) {
    if (timerHandle) {
      clearTimeout(timerHandle);
      timerHandle = null;
    }
  } else {
    scheduleNextRun();
  }
}

export const driveAutoBackup = {
  start,
  stop,
  notifyTrigger,
  runOnce,
  flushBeforeAccountSwap,
  getState,
  setEnabled,
  isStarted: () => isStarted,
};
