/**
 * d1SyncNotify
 *
 * Avisa con un toast cuando una sincronización con Cloudflare D1 movió datos de
 * verdad. En Android la app pasa ratos en segundo plano y el único indicio de
 * que algo llegó era la card de la nube, a la que hay que ir a propósito; el
 * toast lo cuenta en el momento.
 *
 * Diseño (calcado de `driveInstantBackup` para no inventar otra convención para
 * lo mismo: es el otro flujo que avisa "se subió/bajó algo" y ya tiene resuelto
 * el anti-spam):
 *   - **Solo Android.** En escritorio la card de la nube está siempre a la vista.
 *   - **Solo si HUBO cambios** (push, pull o borrados aplicados). Un tick sin
 *     cambios no avisa: los disparadores pasivos (visibilitychange, online, WS,
 *     tick de 20 min) correrían un toast cada pocos minutos y el aviso perdería
 *     todo su valor.
 *   - **Anti-spam**: mínimo 45 s entre avisos, y los que caen dentro de la
 *     ventana se consolidan en un "{n} sincronizaciones".
 *
 * ⚠️ NO llamar a `notificarSyncD1` desde los triggers: es un aviso, no un
 * orquestador. Se llama en el único embudo real, `syncAllSilent`.
 */
import { emit } from '@tauri-apps/api/event';
import { esAndroid } from './platform';
import { t } from './i18n.svelte';
import type { D1SyncResult } from './d1SyncService';

/** Separación mínima entre dos toasts de sincronización. */
const TOAST_MIN_GAP_MS = 45_000;

let ultimoToastAt = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let syncsDesdeToast = 0;

interface CuentaSync {
  subidos: number;
  bajados: number;
  borrados: number;
}

function contar(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  return (Object.values(obj as Record<string, unknown>) as unknown[]).reduce<number>(
    (a, b) => a + Number(b || 0),
    0
  );
}

function cuentasDe(result: D1SyncResult | null | undefined): CuentaSync {
  return {
    subidos: contar(result?.pushed),
    bajados: contar(result?.pulled),
    borrados: Number(result?.deletedApplied || 0),
  };
}

/** "↑12 ↓3 🗑2", con solo las partes que existen. */
function detalleDe(c: CuentaSync): string {
  const partes: string[] = [];
  if (c.subidos > 0) partes.push(`↑${c.subidos}`);
  if (c.bajados > 0) partes.push(`↓${c.bajados}`);
  if (c.borrados > 0) partes.push(`🗑${c.borrados}`);
  return partes.join(' ');
}

let ultimoDetalle = '';

function mostrarToast() {
  const n = syncsDesdeToast;
  syncsDesdeToast = 0;
  ultimoToastAt = Date.now();
  const mensaje = n > 1
    ? t('d1n.sincronizados', { n })
    : t('d1n.sincronizado', { detalle: ultimoDetalle });
  void emit('show-toast', { message: mensaje, type: 'success' });
}

/**
 * Avisa (con anti-spam) que la nube movió datos. No hace nada fuera de Android
 * ni cuando el resultado no movió nada.
 *
 * El caso "push omitido por el freno de reintentos" NO se avisa: no se envió
 * nada, y avisar de una sincronización que no ocurrió es peor que no avisar.
 * Si además hubo pull, `pulled` > 0 y el aviso sale igual (que es lo correcto:
 * los datos bajaron).
 */
export function notificarSyncD1(result: D1SyncResult | null | undefined): void {
  if (!esAndroid()) return;
  const c = cuentasDe(result);
  if (c.subidos + c.bajados + c.borrados === 0) return;
  ultimoDetalle = detalleDe(c);
  syncsDesdeToast++;
  if (toastTimer) return; // ya hay un aviso consolidado programado
  const gap = Date.now() - ultimoToastAt;
  if (gap >= TOAST_MIN_GAP_MS) {
    mostrarToast();
    return;
  }
  toastTimer = setTimeout(() => {
    toastTimer = null;
    mostrarToast();
  }, TOAST_MIN_GAP_MS - gap);
}
