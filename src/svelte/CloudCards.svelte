<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { emit } from '@tauri-apps/api/event';
  import { d1SyncManager, syncManager } from '../lib/syncService';
  import { driveSyncService } from '../lib/driveSyncService';
  import type { D1Status } from '../lib/syncService';

  let {
    compact = false,
    ocultarD1 = false,
    onTabChange,
  } = $props<{
    compact?: boolean;
    /** Oculta la card de Nube D1 (p. ej. drawer móvil, donde hay chip en el header). */
    ocultarD1?: boolean;
    onTabChange: (tab: string) => void;
  }>();

  /**
   * Nube ya no es un tab: es una sección del rail de Ajustes Generales.
   * Se sigue usando onTabChange como fallback por si el consumidor no escucha
   * el evento, pero la vía principal es `open-ajustes`.
   */
  async function abrirNube() {
    try {
      await emit('open-ajustes', { section: 'nube' });
    } catch (e) {
      console.warn('[CloudCards] no se pudo abrir la sección Nube:', e);
      onTabChange('cloud');
    }
  }

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
    return conectado ? 'Respaldo automático activo' : 'Drive sin vincular';
  }

  let lastSyncSeen: string | null = null;
  let justSynced = $state(false);

  $effect(() => {
    const cur = d1.lastSync;
    if (cur && cur !== lastSyncSeen) {
      lastSyncSeen = cur;
      justSynced = true;
      const t = setTimeout(() => { justSynced = false; }, 2500);
      return () => clearTimeout(t);
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

  const d1Chip = $derived.by(() => {
    switch (d1.status) {
      case 'syncing': return 'Sincronizando';
      case 'success': return 'Conectado';
      case 'error': return 'Error';
      case 'offline': return 'Offline';
      default: return 'En espera';
    }
  });

  const d1ChipShort = $derived.by(() => {
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
    class:d1-ok={d1.status === 'success' || d1.status === 'idle'}
    onclick={() => { void abrirNube(); }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void abrirNube(); } }}
    role="button"
    tabindex="0"
    title="Ir a Nube"
  >
    <div class="cloud-head">
      <span class="cloud-dot {d1.status}"></span>
      <span class="cloud-title">Nube D1</span>
      <span class="cloud-chip {d1.status}">{compact ? d1ChipShort : d1Chip}</span>
    </div>
    {#if !compact}
      {#if d1.status === 'syncing'}
        <div class="cloud-line syncing-line"><span class="mini-spinner"></span> Sincronizando con la nube...</div>
      {:else if d1.lastResult}
        <div class="cloud-line metrics">
          <span class="metric up">▲ {pushedTotal}</span>
          <span class="metric down">▼ {pulledTotal}</span>
          <span class="metric del">✕ {d1.lastResult.deletedApplied}</span>
        </div>
      {:else if d1.lastSync}
        <div class="cloud-line muted">Última sync: {fmtTime(d1.lastSync)}</div>
      {:else}
        <div class="cloud-line muted">Sin sincronizar aún</div>
      {/if}
    {/if}
  </div>
  {/if}

  <!--
    Card de Drive SOLO informativa (decisión 2026-09): ya no dispara el
    respaldo manual al hacer clic. El respaldo corre por el temporizador
    automático y, si se quiere forzar uno, se hace desde CloudPage.
    Se conserva el progreso de subida en vivo cuando hay una en curso.
  -->
  <div
    class="cloud-card drive-card {respaldando || drive.uploadProgress ? 'respaldando' : ''}"
    title={drive.uploadProgress
      ? `Subiendo a Drive: ${fmtBytes(drive.uploadProgress.loaded)} / ${fmtBytes(drive.uploadProgress.total)} (${drive.uploadProgress.pct}%)`
      : (drive.lastUploadBytes ? `Último respaldo: ${fmtBytes(drive.lastUploadBytes)} · ` : '') + driveCardTitle()}
  >
    <div class="cloud-head">
      <span class="cloud-dot drive" class:active={!!drive.lastUpload}></span>
      <span class="cloud-title">{respaldando ? 'Subiendo…' : (compact || ocultarD1 ? 'Drive' : 'Respaldo Drive')}</span>
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
      <div class="drive-progress" title="{fmtBytes(drive.uploadProgress.loaded)} de {fmtBytes(drive.uploadProgress.total)}">
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

  /* Solo las cards accionables cambian el borde al pasar el cursor. La de Drive
     es informativa desde 2026-09: sin cursor ni hover, para no sugerir un clic
     que ya no hace nada. */
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
