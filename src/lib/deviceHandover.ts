/**
 * Traspaso del dispositivo a otro usuario.
 *
 * Reemplaza al antigo "cambiar de cuenta". En vez de alternar entre cuentas
 * guardadas (cada una con su archivo `.db`), el dispositivo se deja limpio y
 * vuelve al Welcome para que la siguiente persona entre con su propia cuenta.
 *
 * El orden NO es negociable:
 *   1. Respaldo a Drive. Si falla, se aborta: no se borra nada.
 *   2. Parar los sync, para que nada escriba durante el borrado.
 *   3. `desvincular_cuenta`: quita el marcador de cuenta activa, **borra
 *      `d1_config`** y reabre `school.db`. Borrar `d1_config` es lo que evita
 *      que el usuario siguiente herede el `schoolKey` de esta persona y termine
 *      leyendo/escribiendo sus datos en la nube.
 *   4. `reset_local_database`: vacía las tablas y re-siembra los defaults.
 *   5. `clear_app_initialized`: baja la bandera de "app configurada", para que
 *      el arranque CAIGA en el Welcome y no entre directo a la aplicación.
 *   6. Limpiar el estado del frontend y recargar.
 *
 * El paso 5 no es opcional ni cosmético: `reset_local_database` CONSERVA
 * `app_meta` a propósito (no quiere desvincular la nube), así que deja
 * `initialized = 'true'`, y además `seed_default_data` vuelve a sembrar
 * `ano_lectivo`. Con cualquiera de las dos cosas `is_app_initialized` devuelve
 * `true` y la app entra directo a la aplicación: el Welcome nunca aparece.
 *
 * Lo que NO se borra: el archivo `.db` de la cuenta anterior, que queda en disco
 * como red de seguridad (el respaldo de Drive ya es la copia de recuperación).
 * Borrarlo es opcional y debe pedir confirmación aparte.
 */

import { t } from './i18n.svelte';

/** Claves de localStorage que identifican a la persona que se va. */
const CLAVES_A_LIMPIAR = [
  'schooltracker-google-drive-settings',
  'stp_current_account',
  'stp_account_profiles',
  'stp_cloud_idtoken',
  'periodic_sync_interval_seconds',
];

export interface ResultadoTraspaso {
  ok: boolean;
  /** Ruta del respaldo subido a Drive, si se llegó a subir. */
  respaldo?: string;
  /** Motivo por el que se abortó, si no se completó. */
  motivo?: string;
}

/**
 * Deja el dispositivo como recién instalado. No borra el archivo de la cuenta
 * anterior en disco.
 */
export async function traspasarDispositivo(opts?: {
  /** Se llama antes de borrar, con la ruta del respaldo para mostrarla. */
  onEtapa?: (etapa: string, detalle?: string) => void;
  /** Confirma el borrado. Si devuelve false, no se hace nada. */
  confirmar?: () => Promise<boolean>;
}): Promise<ResultadoTraspaso> {
  const { onEtapa, confirmar } = opts ?? {};

  if (confirmar) {
    const ok = await confirmar();
    if (!ok) return { ok: false, motivo: t('traspaso.cancelado') };
  }

  // ── 1. Respaldo a Drive. Es la única red de recuperación: si falla, abortar.
  let respaldo = '';
  try {
    onEtapa?.(t('traspaso.etapa.respaldandoDrive'));
    const { driveSyncService } = await import('./driveSyncService');
    await driveSyncService.pushAll();
    respaldo = driveSyncService.latestFileName();
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[Traspaso] falló el respaldo a Drive:', e);
    return {
      ok: false,
      motivo: t('traspaso.sinRespaldoDrive', { error: msg }),
    };
  }

  // ── 2. Frenar todo lo que pueda escribir mientras se borra.
  onEtapa?.(t('traspaso.etapa.deteniendoSync'));
  try { const { syncService } = await import('./syncService'); await syncService.stopPeriodicSync(); } catch {}
  try { const { stopWsSync } = await import('./wsSyncService'); stopWsSync(); } catch {}
  try { const { driveSyncService } = await import('./driveSyncService'); driveSyncService.stopPeriodicSync(); } catch {}
  // El respaldo instantáneo se frena desactivándolo: es la vía pública que
  // cancela su propio temporizador de debounce.
  try { const { setInstantBackupEnabled } = await import('./driveInstantBackup'); setInstantBackupEnabled(false); } catch {}

  // ── 3. Quitar el vínculo con la nube y reabrir la base por defecto.
  //    `desvincular_cuenta` borra `d1_config`, así que el siguiente usuario no
  //    hereda el namespace de esta persona.
  onEtapa?.(t('traspaso.etapa.desvinculando'));
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('desvincular_cuenta');
  } catch (e) {
    console.error('[Traspaso] falló desvincular_cuenta:', e);
    return {
      ok: false,
      motivo: t('traspaso.sinDesvinculacion', { respaldo }),
    };
  }

  // ── 4. Vaciar los datos locales.
  onEtapa?.(t('traspaso.etapa.borrandoLocal'));
  try {
    await invoke('reset_local_database');
  } catch (e: any) {
    console.error('[Traspaso] falló reset_local_database:', e);
    return {
      ok: false,
      motivo: t('traspaso.sinBorrarLocal', { respaldo, error: e?.message || e }),
    };
  }

  // ── 5. Bajar la bandera de "app configurada".
  //
  // Sin esto el Welcome NO aparece. `reset_local_database` conserva `app_meta`
  // (a propósito, para no desvincular la nube) y `seed_default_data` vuelve a
  // sembrar `ano_lectivo`; con cualquiera de las dos, `is_app_initialized`
  // devuelve true y la app entra directo. Es la razón real por la que esta
  // acción se llamaba "traspaso" pero no volvía a la portada.
  try {
    await invoke('clear_app_initialized');
  } catch (e) {
    // No es fatal: el `.db` anterior queda en disco y el Welcome se puede
    // alcanzar igual. Se avisa porque el síntoma sería "no me volvió al inicio".
    console.warn('[Traspaso] no se pudo limpiar el flag de app inicializada:', e);
  }

  // ── 6. Estado del frontend y recarga.
  onEtapa?.(t('traspaso.reiniciando'));
  for (const k of CLAVES_A_LIMPIAR) {
    try { localStorage.removeItem(k); } catch { /* ignorable */ }
  }
  try { sessionStorage.clear(); } catch { /* ignorable */ }

  // Recargar deja la app como recién instalada: sin cuenta activa, Welcome
  // adelante y la base recién sembrada.
  setTimeout(() => { try { location.reload(); } catch { /* ignorable */ } }, 400);

  return { ok: true, respaldo };
}
