<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { d1SyncManager, syncManager } from '../lib/syncService';
  import { driveSyncService } from '../lib/driveSyncService';
  import { openCloudPanel } from '../lib/cloudPanels.svelte';
  import { d1Conectado } from '../lib/d1Connection.svelte';
  import { t } from '../lib/i18n.svelte';
  import type { D1Status } from '../lib/syncService';

  let {
    compact = false,
    ocultarD1 = false,
  } = $props<{
    compact?: boolean;
    /** Oculta la card de Nube D1 (p. ej. drawer móvil, donde hay chip en el header). */
    ocultarD1?: boolean;
  }>();

  /**
   * The cloud is no longer a page: each card opens ITS panel (Cloudflare D1 or
   * Drive). Both used to navigate to the "Nube" section of the Configuración
   * rail, which no longer exists; the state now lives in
   * `lib/cloudPanels.svelte.ts` and the modals are mounted once in App.svelte.
   */
  const abrirD1 = () => openCloudPanel('d1');
  const abrirDrive = () => openCloudPanel('drive');

  interface CloudD1State {
    status: D1Status;
    lastSync: string | null;
    message: string | null;
    lastResult: { pushed: unknown; pulled: Record<string, number>; deletedApplied: number } | null;
  }
  interface CloudDriveState {
    lastUpload: string | null;
    lastDownload: string | null;
    uploadProgress: { loaded: number; total: number; pct: number } | null;
    lastUploadBytes: number | null;
  }

  let d1 = $state<CloudD1State>(d1SyncManager.getState() as CloudD1State);
  let drive = $state<CloudDriveState>({ lastUpload: null, lastDownload: null, uploadProgress: null, lastUploadBytes: null });
  let respaldando = $state(false);

  /** Relee el estado del singleton (refuerzo si la suscripción no notificó). */
  function refrescarEstadoDrive() {
    const s = syncManager.getState();
    drive = {
      lastUpload: s.lastUpload ?? null,
      lastDownload: s.lastDownload ?? null,
      uploadProgress: s.uploadProgress ?? null,
      lastUploadBytes: s.lastUploadBytes ?? null,
    };
  }

  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  /** La card es informativa: el texto explica el estado, no ofrece acción. */
  function driveCardTitle(): string {
    let conectado = false;
    try {
      const s = localStorage.getItem('schooltracker-google-drive-settings');
      conectado = !!(s && JSON.parse(s)?.accessToken);
    } catch {}
    return conectado ? t('ccards.driveActivo') : t('ccards.driveSinVincular');
  }

  let lastSyncSeen: string | null = null;
  let justSynced = $state(false);

  $effect(() => {
    const cur = d1.lastSync;
    if (cur && cur !== lastSyncSeen) {
      lastSyncSeen = cur;
      justSynced = true;
      // OJO: se llama `timer`, no `t`: `t` es la funcion de i18n importada arriba
      // y un `const t` local la taparia en todo este scope (GOTCHA de AGENTS.md).
      const timer = setTimeout(() => { justSynced = false; }, 2500);
      return () => clearTimeout(timer);
    }
  });

  const pushedTotal = $derived(sumCounts(d1.lastResult?.pushed));
  const pulledTotal = $derived(sumCounts(d1.lastResult?.pulled));

  let unsubD1: (() => void) | null = null;
  let unsubDrive: (() => void) | null = null;

  onMount(() => {
    unsubD1 = d1SyncManager.subscribe((s) => { d1 = s as CloudD1State; });
    unsubDrive = syncManager.subscribe((s) => {
      drive = {
        lastUpload: s.lastUpload ?? null,
        lastDownload: s.lastDownload ?? null,
        uploadProgress: s.uploadProgress ?? null,
        lastUploadBytes: s.lastUploadBytes ?? null,
      };
    });
  });

  onDestroy(() => {
    unsubD1?.();
    unsubDrive?.();
  });

  function sumCounts(v: unknown): number {
    if (!v || typeof v !== 'object') return 0;
    return Object.values(v as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  // Disconnected (switch in the D1 panel) wins over the status: while it is off
  // the state stays 'idle' and the card would otherwise show a green "OK" that
  // is a lie — nothing is syncing.
  const d1ConectadoAhora = $derived(d1Conectado());

  const d1Chip = $derived.by(() => {
    if (!d1ConectadoAhora) return t('ccards.estado.desconectado');
    switch (d1.status) {
      case 'syncing': return t('ccards.estado.syncing');
      case 'success': return t('ccards.estado.ok');
      case 'error': return t('ccards.estado.error');
      case 'offline': return t('ccards.estado.offline');
      default: return t('ccards.estado.espera');
    }
  });

  // Short labels stay literal: they are near-universal abbreviations and
  // translating them changes the chip width (see ccards.* in es.ts).
  const d1ChipShort = $derived.by(() => {
    if (!d1ConectadoAhora) return 'Off';
    switch (d1.status) {
      case 'syncing': return 'Sync';
      case 'success': return 'OK';
      case 'error': return 'Err';
      case 'offline': return 'Off';
      default: return 'Esp';
    }
  });
</script>

<div class="cloud-widget {compact ? 'compact' : ''}">
  {#if !ocultarD1}
  <div
    class="cloud-card clickable {justSynced ? 'flash' : ''}"
    class:d1-ok={d1ConectadoAhora && (d1.status === 'success' || d1.status === 'idle')}
    class:d1-off={!d1ConectadoAhora}
    onclick={abrirD1}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirD1(); } }}
    role="button"
    tabindex="0"
    title={t('ccards.irNube')}
  >
    <div class="cloud-head">
      <span class="cloud-dot {d1ConectadoAhora ? d1.status : 'd1-off'}"></span>
      <span class="cloud-title">{t('ccards.nubeD1')}</span>
      <span class="cloud-chip {d1ConectadoAhora ? d1.status : 'd1-off'}">{compact ? d1ChipShort : d1Chip}</span>
    </div>
    {#if !compact}
      {#if d1.status === 'syncing'}
        <div class="cloud-line syncing-line"><span class="mini-spinner"></span> {t('ccards.sincronizando')}</div>
      {:else if d1.lastResult}
        <div class="cloud-line metrics">
          <span class="metric up">▲ {pushedTotal}</span>
          <span class="metric down">▼ {pulledTotal}</span>
          <span class="metric del">✕ {d1.lastResult.deletedApplied}</span>
        </div>
      {:else if d1.lastSync}
        <div class="cloud-line muted">{t('ccards.ultimaSync', { hora: fmtTime(d1.lastSync) })}</div>
      {:else}
        <div class="cloud-line muted">{t('ccards.sinSincronizar')}</div>
      {/if}
    {/if}
  </div>
  {/if}

  <!--
    Drive card: opens the Drive panel (it used to be read-only and the manual
    backup was forced from CloudPage; removing that page left no way in). The tap
    does NOT trigger a backup: it opens the panel, where "Crear respaldo" and
    the list live. Live upload progress is still shown while one is running.
  -->
  <div
    class="cloud-card drive-card clickable {respaldando || drive.uploadProgress ? 'respaldando' : ''}"
    onclick={abrirDrive}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirDrive(); } }}
    role="button"
    tabindex="0"
    title={drive.uploadProgress
      ? t('ccards.subiendoDrive', { actual: fmtBytes(drive.uploadProgress.loaded), total: fmtBytes(drive.uploadProgress.total), pct: drive.uploadProgress.pct })
      : (drive.lastUploadBytes ? t('ccards.ultimoRespaldo', { tam: fmtBytes(drive.lastUploadBytes), titulo: driveCardTitle() }) : driveCardTitle())}
  >
    <div class="cloud-head">
      <span class="cloud-dot drive" class:active={!!drive.lastUpload}></span>
      <span class="cloud-title">{respaldando ? t('ccards.subiendo') : (compact || ocultarD1 ? t('ccards.drive') : t('ccards.respaldoDrive'))}</span>
      {#if drive.uploadProgress}
        <span class="cloud-time-inline" style="color:#7dd3fc;">{drive.uploadProgress.pct}%</span>
        <span class="mini-spinner"></span>
      {:else if respaldando}
        <span class="mini-spinner"></span>
      {:else}
        <span class="cloud-time-inline">
          {drive.lastUpload ? fmtTime(drive.lastUpload) : ''}
          {#if drive.lastUploadBytes}<span style="opacity:0.75;">· {fmtBytes(drive.lastUploadBytes)}</span>{/if}
        </span>
      {/if}
    </div>
    {#if drive.uploadProgress}
      <div class="drive-progress" title={t('ccards.progresoDe', { actual: fmtBytes(drive.uploadProgress.loaded), total: fmtBytes(drive.uploadProgress.total) })}>
        <div class="drive-progress-bar" style="width: {drive.uploadProgress.pct}%;"></div>
      </div>
      <div class="drive-progress-label">{fmtBytes(drive.uploadProgress.loaded)} / {fmtBytes(drive.uploadProgress.total)} → Drive</div>
    {/if}
  </div>
</div>

<style>
  .cloud-widget {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: auto;
    padding: 0.75rem 0 0.5rem;
  }

  .cloud-card {
    background: rgba(255, 255, 255, 0.02);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    padding: 0.6rem 0.75rem;
    transition: all 0.25s ease;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  /* Only the actionable cards change border on hover. */
  .cloud-card.clicable:hover {
    border-color: rgba(var(--primary-rgb), 0.35);
    background: rgba(255, 255, 255, 0.045);
  }

  .cloud-card.respaldando {
    border-color: rgba(var(--primary-rgb), 0.45);
    background: rgba(var(--primary-rgb), 0.05);
  }

  .cloud-card.flash {
    animation: cloudFlash 1.2s ease;
  }

  @keyframes cloudFlash {
    0% {
      box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.45);
      border-color: rgba(var(--primary-rgb), 0.6);
    }
    100% {
      box-shadow: 0 0 0 14px rgba(var(--primary-rgb), 0);
      border-color: rgba(255, 255, 255, 0.06);
    }
  }

  .cloud-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .cloud-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-bright);
  }
  .drive-card .cloud-title { letter-spacing: 0.04em; }
  .cloud-time-inline {
    flex-shrink: 0;
    font-size: 0.6rem;
    color: #64748b;
  }

  .cloud-chip {
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
  }

  .cloud-chip.success {
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.35);
    background: rgba(34, 197, 94, 0.1);
  }

  .cloud-chip.error {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.1);
  }

  .cloud-chip.syncing {
    color: var(--primary-color);
    border-color: rgba(var(--primary-rgb), 0.4);
    background: rgba(var(--primary-rgb), 0.12);
  }

  .cloud-chip.offline {
    color: #eab308;
    border-color: rgba(234, 179, 8, 0.35);
    background: rgba(234, 179, 8, 0.1);
  }

  .cloud-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #64748b;
    flex-shrink: 0;
    box-shadow: 0 0 6px rgba(100, 116, 139, 0.5);
  }

  .cloud-dot.success {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.7);
  }

  .cloud-dot.error {
    background: #ef4444;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.7);
  }

  .cloud-dot.offline {
    background: #eab308;
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.6);
  }

  .cloud-dot.syncing {
    background: var(--primary-color);
    box-shadow: 0 0 10px rgba(var(--primary-rgb), 0.8);
    animation: dotPulse 1s ease-in-out infinite;
  }

  .cloud-dot.drive {
    background: #4f8ef7;
    box-shadow: 0 0 6px rgba(79, 142, 247, 0.5);
  }

  .cloud-dot.drive.active {
    box-shadow: 0 0 8px rgba(79, 142, 247, 0.8);
  }

  .cloud-dot.d1-off {
    background: #475569;
    box-shadow: 0 0 6px rgba(71, 85, 105, 0.5);
  }

  .cloud-chip.d1-off {
    color: #94a3b8;
    border-color: rgba(148, 163, 184, 0.3);
    background: rgba(148, 163, 184, 0.1);
  }

  @keyframes dotPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.45); opacity: 0.65; }
  }

  .cloud-line {
    margin-top: 0.45rem;
    font-size: 0.7rem;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cloud-line.muted {
    color: var(--text-muted);
  }

  .cloud-line.metrics {
    gap: 0.5rem;
    font-weight: 600;
  }

  .metric.up { color: #22c55e; }
  .metric.down { color: #3b82f6; }
  .metric.del { color: #f472b6; }

  .syncing-line {
    color: var(--primary-color);
  }

  .mini-spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(var(--primary-rgb), 0.25);
    border-top-color: var(--primary-color);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .cloud-time {
    margin-top: 0.4rem;
    font-size: 0.62rem;
    color: var(--text-muted);
  }

  .cloud-time-inline {
    font-size: 0.6rem;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  @media (max-width: 1024px) {
    .cloud-widget:not(.compact) {
      gap: 0.4rem;
      padding: 0.5rem 0 0.4rem;
    }
    .cloud-widget:not(.compact) .cloud-card {
      padding: 0.5rem 0.6rem;
      border-radius: 12px;
    }
    .cloud-widget:not(.compact) .cloud-title {
      font-size: 0.62rem;
    }
    .cloud-widget:not(.compact) .cloud-chip {
      font-size: 0.5rem;
      padding: 2px 5px;
    }
    .cloud-widget:not(.compact) .cloud-line {
      margin-top: 0.35rem;
      font-size: 0.62rem;
    }
    .cloud-widget:not(.compact) .cloud-time {
      margin-top: 0.3rem;
      font-size: 0.58rem;
    }
  }

  .cloud-widget.compact {
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0;
    margin-left: auto;
    padding: 0;
    max-width: 100%;
  }

  .cloud-widget.compact .cloud-card {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    white-space: nowrap;
  }

  .cloud-widget.compact .cloud-head {
    gap: 0.25rem;
  }

  .cloud-widget.compact .cloud-title {
    flex: 0 0 auto;
    font-size: 0.5rem;
  }

  .cloud-widget.compact .cloud-chip {
    font-size: 0.42rem;
    padding: 1px 4px;
  }

  .cloud-widget.compact .cloud-time-inline {
    font-size: 0.46rem;
  }

  .cloud-widget.compact .cloud-dot {
    width: 5px;
    height: 5px;
  }

  @media (max-width: 1024px) {
    .cloud-widget.compact {
      gap: 0.28rem;
    }
    .cloud-widget.compact .cloud-card {
      gap: 0.2rem;
      padding: 0.12rem 0.4rem;
    }
    .cloud-widget.compact .cloud-title {
      font-size: 0.47rem;
    }
    .cloud-widget.compact .cloud-chip {
      font-size: 0.4rem;
      padding: 0 3px;
    }
    .cloud-widget.compact .cloud-time-inline {
      font-size: 0.44rem;
    }
  }

  /* ── Progreso de subida a Drive (chip del sidebar) ── */
  .drive-progress {
    margin-top: 0.4rem;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }
  .drive-progress-bar {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, #38bdf8, #818cf8);
    transition: width 0.2s ease;
  }
  .drive-progress-label {
    margin-top: 0.2rem;
    font-size: 0.55rem;
    color: #7dd3fc;
    white-space: nowrap;
  }
  .cloud-widget.compact .drive-progress-label {
    font-size: 0.45rem;
  }
</style>
