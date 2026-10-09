<script lang="ts">
  /**
   * ModalNubeD1 — panel de Cloudflare D1 (sincronización bilateral).
   *
   * Reemplaza la card de Cloudflare que vivía dentro de CloudPage. Se abre
   * desde `abrirNube('d1')` (store en `lib/nubeModales.svelte.ts`) y se monta
   * una sola vez en App.svelte, así que cualquier parte del sistema puede
   * abrirlo sin duplicar estado.
   *
   * Vista minimalista a propósito: el sync es automático y no se administra acá.
   * Queda lo que sirve cuando algo se rompe — última sincronización, botón de
   * sincronizar y el diagnóstico del error — más la importación del `.key`.
   * Lo que se sacó de la versión anterior (intervalo, regenerar ID, "sync
   * completo", probar, desconectar) sigue en Depuración o directamente no hace
   * falta: tocar esas cosas a mano es la forma más rápida de romper el sync.
   */
  import { invoke } from '@tauri-apps/api/core';
  import { emit } from '@tauri-apps/api/event';
  import { open, ask } from '@tauri-apps/plugin-dialog';
  import { onMount } from 'svelte';
  import {
    d1SyncService, d1SyncManager, SYNC_PERIODICO_MIN, type D1Config,
  } from '../../lib/d1SyncService';
  import { invalidateD1Cache } from '../../lib/syncService';
  import { panelNubeVisible, cerrarNube } from '../../lib/nubeModales.svelte';
  import { t, tagLocale } from '../../lib/i18n.svelte';
  import ModalBase from './ModalBase.svelte';

  let d1Cfg = $state<D1Config | null>(null);
  let d1SyncState = $state({
    status: 'idle' as string,
    lastSync: null as string | null,
    message: null as string | null,
  });
  let isD1Syncing = $state(false);
  let isImporting = $state(false);

  /** Diagnóstico: lo llena `d1SyncService` en `window.__d1LastError`. */
  let d1ErrorDetalle = $state('');

  function refreshD1ErrorDetalle() {
    const d = (window as any).__d1LastError;
    if (!d) { d1ErrorDetalle = ''; return; }
    d1ErrorDetalle = `[${d.ts}] online=${d.online}\nMENSAJE:\n${d.mensaje}\n\nERROR COMPLETO (JSON):\n${d.completo || '(sin detalle)'}`;
  }

  async function copiarD1Error() {
    try {
      await navigator.clipboard.writeText(d1ErrorDetalle || (window as any).__d1LastError?.mensaje || '');
      await emit('show-toast', { message: t('cloud.copiarDiagnostico'), type: 'success' });
    } catch (e) {
      await emit('show-toast', { message: t('cloud.error.generico', { e: String(e) }), type: 'error' });
    }
  }

  async function loadD1Config() {
    try { d1Cfg = await d1SyncService.getConfig(); } catch { d1Cfg = null; }
  }

  /**
   * Sincronización manual: push + pull.
   *
   * `force: true` saltea el freno de reintentos del push: si el usuario aprieta
   * "Sincronizar" a propósito, no se le hace esperar a que venza la espera que
   * dejó el último push fallido (ver AGENTS.md → freno de reintentos de D1).
   */
  async function syncD1() {
    if (isD1Syncing) return;
    isD1Syncing = true;
    try {
      await invoke('d1_sync_all', { force: true });
      await emit('show-toast', { message: t('cloud.toast.syncCompleta'), type: 'success' });
    } catch (e) {
      console.error('[D1] sync manual falló:', e);
      await emit('show-toast', { message: t('cloud.error.sync', { e: String(e) }), type: 'error' });
    } finally { isD1Syncing = false; }
  }

  /**
   * Importa un `.key` generado por `cloudflare-sync/scripts/generate-key.mjs`.
   *
   * El archivo es `{ workerUrl, schoolKey }`. Se lee con `gd_read_file_base64`
   * (comando Rust) en vez de `readTextFile` del plugin-fs porque las
   * capabilities NO incluyen `fs:allow-read-text-file`, y así el path puede ser
   * cualquiera (el scope de `fs:allow-read-file` solo cubre AppData/Downloads/
   * Documents/Home/Temp).
   */
  async function importarKey() {
    if (isImporting) return;
    let ruta: string | null = null;
    try {
      ruta = await open({
        title: t('d1m.importTitulo'),
        filters: [{ name: t('d1m.filtro'), extensions: ['key', 'json'] }],
        multiple: false,
      });
    } catch (e) {
      await emit('show-toast', { message: t('d1m.error.dialogo', { e: String(e) }), type: 'error' });
      return;
    }
    if (!ruta || typeof ruta !== 'string') return;

    isImporting = true;
    try {
      const b64 = await invoke<string>('gd_read_file_base64', { path: ruta });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const texto = new TextDecoder().decode(bytes);

      let cfg: any;
      try { cfg = JSON.parse(texto); }
      catch { throw new Error(t('d1m.error.formato')); }
      if (!cfg?.workerUrl || !cfg?.schoolKey) throw new Error(t('d1m.error.formato'));

      // Protección anti-mezcla: si ya hay una conexión y el archivo apunta a
      // OTRA nube, reemplazar a ciegas deja cursores y device_id de la nube
      // vieja mezclados con los datos nuevos. Se avisa y, si acepta, se borra la
      // config primero (device_id nuevo + cursores en cero).
      if (d1Cfg && (d1Cfg.workerUrl !== cfg.workerUrl || d1Cfg.schoolKey !== cfg.schoolKey)) {
        const ok = await ask(t('d1m.ask.reemplazarMsg'), {
          title: t('d1m.ask.reemplazarTitulo'),
          kind: 'warning',
          okLabel: t('d1m.ask.reemplazarOk'),
          cancelLabel: t('comun.cancelar'),
        });
        if (!ok) return;
        await d1SyncService.clearConfig();
      }

      await d1SyncService.saveConfig(cfg.workerUrl, cfg.schoolKey);
      invalidateD1Cache();
      await loadD1Config();
      await emit('show-toast', { message: t('d1m.toast.importado'), type: 'success' });

      // El primer sync tras importar es best-effort: la clave YA quedó guardada,
      // así que un fallo de red no puede revertir lo importado.
      try {
        await invoke('d1_sync_all', { force: true });
      } catch (e) {
        console.warn('[D1] el sync tras importar falló:', e);
        await emit('show-toast', { message: t('d1m.error.syncTrasImportar', { e: String(e) }), type: 'warning' });
      }
    } catch (e) {
      await emit('show-toast', {
        message: t('d1m.error.importar', { e: e instanceof Error ? e.message : String(e) }),
        type: 'error',
      });
    } finally { isImporting = false; }
  }

  /** `stp_f83f…7290` → `••••••7290`: se ven los últimos 4 para poder compararlo. */
  function claveMascarada(clave: string | undefined | null): string {
    if (!clave) return '—';
    return `••••••${clave.slice(-4)}`;
  }

  onMount(() => {
    const unsub = d1SyncManager.subscribe((s) => {
      d1SyncState = s as typeof d1SyncState;
      if (s.status === 'error') refreshD1ErrorDetalle();
    });
    void loadD1Config();
    return unsub;
  });

  const abierto = $derived(panelNubeVisible('d1'));
</script>

<ModalBase
  {abierto}
  titulo={t('d1m.titulo')}
  subtitulo={t('cloud.sync.subtitle')}
  ancho="520px"
  onCerrar={cerrarNube}
>
  {#if d1Cfg}
    {#if d1SyncState.message && d1SyncState.status !== 'error'}
      <div class="aviso">
        {d1SyncState.message}
      </div>
    {/if}

    <div class="fila-principal">
      <button class="btn-sync" onclick={syncD1} disabled={isD1Syncing} title={t('cloud.sync.title')} type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F6821F" stroke-width="2" stroke-linecap="round" style={isD1Syncing ? 'animation: d1m-spin 1s linear infinite;' : ''}><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        <span>{isD1Syncing ? t('cloud.sync.btn.syncing') : t('cloud.sync.btn.sync')}</span>
      </button>
      <div class="info-sync">
        <span class="info-sync-line">
          {t('cloud.sync.ultima')}
          <strong>{d1SyncState.lastSync ? new Date(d1SyncState.lastSync).toLocaleString(tagLocale()) : '—'}</strong>
        </span>
        <span class="info-sync-auto">{t('cloud.sync.auto', { n: SYNC_PERIODICO_MIN })}</span>
      </div>
    </div>

    {#if d1SyncState.status === 'error' && d1SyncState.message}
      <div class="caja-error">
        <div class="caja-error-titulo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {t('cloud.errorSync.titulo')}
        </div>
        <p class="caja-error-msg">{d1SyncState.message}</p>
        <button class="btn-diag" onclick={copiarD1Error} type="button">{t('cloud.copiarDiagnostico')}</button>
      </div>
    {/if}

    <!-- Conexión activa + importación. La clave va enmascarada: alcanza para
         reconocerla, no para filtrarla en una captura de pantalla. -->
    <div class="pie-conexion">
      <div class="conexion-datos">
        <span class="conexion-item">
          <span class="conexion-label">{t('d1m.worker')}</span>
          <span class="conexion-valor mono" title={d1Cfg.workerUrl}>{d1Cfg.workerUrl}</span>
        </span>
        <span class="conexion-item">
          <span class="conexion-label">{t('d1m.clave')}</span>
          <span class="conexion-valor mono">{claveMascarada(d1Cfg.schoolKey)}</span>
        </span>
      </div>
      <button class="btn-importar" onclick={importarKey} disabled={isImporting} type="button">
        {isImporting ? t('d1m.importando') : t('d1m.importar')}
      </button>
    </div>
  {:else}
    <div class="vacio">
      <div class="vacio-ico">☁️</div>
      <p class="vacio-txt">{t('d1m.vacio')}</p>
      <button class="btn-importar grande" onclick={importarKey} disabled={isImporting} type="button">
        {isImporting ? t('d1m.importando') : t('d1m.importar')}
      </button>
      <p class="vacio-hint">{t('d1m.vacioHint')}</p>
    </div>
  {/if}
</ModalBase>

<style>
  @keyframes d1m-spin { to { transform: rotate(360deg); } }

  .aviso {
    margin-bottom: 0.75rem;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.75rem;
    border-left: 3px solid #f6821f;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text-secondary);
  }

  .fila-principal {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn-sync {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 0.85rem;
    height: 36px;
    border-radius: 9px;
    border: 1px solid rgba(246, 130, 31, 0.25);
    background: rgba(246, 130, 31, 0.08);
    color: #fdba74;
    cursor: pointer;
    opacity: 1;
    transition: all 0.2s ease;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .btn-sync:disabled { opacity: 0.5; cursor: default; }
  .btn-sync:not(:disabled):hover { background: rgba(246, 130, 31, 0.15); }

  .info-sync {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .info-sync-line { color: #94a3b8; font-size: 0.72rem; }
  .info-sync-line strong { color: #e2e8f0; }
  .info-sync-auto { color: #64748b; font-size: 0.68rem; }

  .caja-error {
    margin-top: 0.85rem;
    padding: 0.9rem 1rem;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 14px;
  }
  .caja-error-titulo {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 0.75rem;
    color: #fca5a5;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
  }
  .caja-error-msg {
    margin: 0;
    padding: 0.6rem 0.7rem;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.1);
    color: #fecaca;
    font-size: 0.74rem;
    line-height: 1.5;
    border-left: 3px solid #ef4444;
    word-break: break-word;
  }
  .btn-diag {
    margin-top: 0.5rem;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    border: 1px solid rgba(59, 130, 246, 0.3);
    background: rgba(59, 130, 246, 0.1);
    color: #93c5fd;
    cursor: pointer;
    font-size: 0.68rem;
    font-weight: 600;
  }

  .pie-conexion {
    margin-top: 1rem;
    padding-top: 0.85rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .conexion-datos {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .conexion-item { display: flex; align-items: baseline; gap: 0.4rem; min-width: 0; }
  .conexion-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #64748b;
    flex-shrink: 0;
  }
  .conexion-valor {
    font-size: 0.72rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono { font-family: monospace; }

  .btn-importar {
    padding: 0.35rem 0.75rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: #cbd5e1;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 600;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }
  .btn-importar:not(:disabled):hover { background: rgba(255, 255, 255, 0.1); color: #f1f5f9; }
  .btn-importar:disabled { opacity: 0.5; cursor: default; }
  .btn-importar.grande { padding: 0.6rem 1.4rem; font-size: 0.85rem; }

  .vacio { text-align: center; padding: 0.5rem 0.25rem 0.25rem; }
  .vacio-ico { font-size: 2.2rem; margin-bottom: 0.5rem; }
  .vacio-txt { margin: 0 0 0.9rem; color: #94a3b8; font-size: 0.82rem; line-height: 1.5; }
  .vacio-hint { margin: 0.7rem 0 0; color: #64748b; font-size: 0.68rem; line-height: 1.5; }
</style>