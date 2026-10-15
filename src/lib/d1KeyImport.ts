/**
 * Importación del archivo `.key` de Cloudflare.
 *
 * Vive en un módulo propio (y no dentro de `ModalNubeD1`) porque lo necesitan
 * DOS lugares: el modal de la nube y la portada del WelcomePage. Duplicarlo
 * Invitaría a que se desincronicen justo en la parte que protege los datos.
 *
 * ⚠️ El archivo `.key` ES la credencial: quien lo tiene entra al namespace sin
 * ninguna otra verificación. No es un archivo de configuración, tratalo como un
 * secreto (por eso está en `.gitignore`).
 */

import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { ask } from '@tauri-apps/plugin-dialog';
import { d1SyncService } from './d1SyncService';
import { invalidateD1Cache } from './syncService';
import { t } from './i18n.svelte';

export interface D1KeyConfig {
  workerUrl: string;
  schoolKey: string;
}

/**
 * Abre el selector, lee el `.key`, lo valida y guarda la config.
 *
 * Devuelve la config guardada, o `null` si el usuario canceló o algo falló (en
 * ese caso ya se emitió un toast con el motivo).
 *
 * El comando `gd_read_file_base64` se usa en vez del plugin-fs
 * (`readTextFile`) porque las capabilities no incluyen `fs:allow-read-text-file`
 * y el scope de `fs:allow-read-file` solo cubre AppData/Downloads/Documents/
 * Home/Temp: el `.key` puede estar en cualquier lado (Desktop, por ejemplo).
 */
export async function importarKeyDesdeArchivo(opts?: {
  /** Config actual, para preguntar antes de pisar una nube distinta. */
  actual?: D1KeyConfig | null;
}): Promise<D1KeyConfig | null> {
  let ruta: string | null = null;
  try {
    ruta = await open({
      title: t('d1m.importTitulo'),
      filters: [{ name: t('d1m.filtro'), extensions: ['key', 'json'] }],
      multiple: false,
    });
  } catch (e) {
    await emit('show-toast', { message: t('d1m.error.dialogo', { e: String(e) }), type: 'error' });
    return null;
  }
  if (!ruta || typeof ruta !== 'string') return null;

  try {
    const b64 = await invoke<string>('gd_read_file_base64', { path: ruta });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const texto = new TextDecoder().decode(bytes);

    let cfg: any;
    try { cfg = JSON.parse(texto); }
    catch { throw new Error(t('d1m.error.formato')); }
    if (!cfg?.workerUrl || !cfg?.schoolKey) throw new Error(t('d1m.error.formato'));

    // Protección anti-mezcla: si ya hay una nube configurada y el archivo apunta
    // a OTRA, reemplazarla en silencio deja los cursores y el device id viejos
    // mezclados con los datos nuevos. Se pregunta y, si aceptan, se limpia la
    // config (device id nuevo + cursores en cero).
    if (opts?.actual && (opts.actual.workerUrl !== cfg.workerUrl || opts.actual.schoolKey !== cfg.schoolKey)) {
      const ok = await ask(t('d1m.ask.reemplazarMsg'), {
        title: t('d1m.ask.reemplazarTitulo'),
        kind: 'warning',
        okLabel: t('d1m.ask.reemplazarOk'),
        cancelLabel: t('comun.cancelar'),
      });
      if (!ok) return null;
      await d1SyncService.clearConfig();
    }

    await d1SyncService.saveConfig(cfg.workerUrl, cfg.schoolKey);
    invalidateD1Cache();
    await emit('show-toast', { message: t('d1m.toast.importado'), type: 'success' });
    return { workerUrl: cfg.workerUrl, schoolKey: cfg.schoolKey };
  } catch (e) {
    await emit('show-toast', { message: t('d1m.error.importar', { e: e instanceof Error ? e.message : String(e) }), type: 'error' });
    return null;
  }
}

/**
 * Config de nube guardada en el `.key` o escrita a mano por el usuario.
 *
 * El `workerUrl` tiene default (el del proyecto), así que para entrar a un
 * namespace ajeno basta con la `schoolKey`. Útil cuando el usuario no tiene el
 * archivo `.key` a mano pero sí la clave.
 */
export async function conectarConKeyManual(workerUrl: string, schoolKey: string): Promise<boolean> {
  const wu = workerUrl.trim();
  const sk = schoolKey.trim();
  if (!sk) return false;
  try {
    await d1SyncService.saveConfig(wu || '', sk);
    invalidateD1Cache();
    return true;
  } catch (e) {
    await emit('show-toast', { message: t('d1m.error.importar', { e: e instanceof Error ? e.message : String(e) }), type: 'error' });
    return false;
  }
}
