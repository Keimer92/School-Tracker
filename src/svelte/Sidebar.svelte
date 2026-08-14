<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { d1SyncManager, syncManager } from '../lib/syncService';
  import type { D1Status } from '../lib/syncService';

  export type Tab = "dashboard" | "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe" | "cloud";

  let {
    activeTab,
    drawerOpen,
    isMobile,
    onTabChange,
    toggleDrawer,
    onDrawerClose,
    themeMode,
    setThemeMode,
  } = $props<{
    activeTab: Tab;
    drawerOpen: boolean;
    isMobile: boolean;
    onTabChange: (tab: Tab) => void;
    toggleDrawer: () => void;
    onDrawerClose: () => void;
    themeMode: string;
    setThemeMode: (mode: string) => void;
  }>();

  interface CloudD1State {
    status: D1Status;
    lastSync: string | null;
    message: string | null;
    lastResult: { pushed: unknown; pulled: Record<string, number>; deletedApplied: number } | null;
  }
  interface CloudDriveState {
    lastUpload: string | null;
    lastDownload: string | null;
  }

  let d1 = $state<CloudD1State>(d1SyncManager.getState() as CloudD1State);
  let drive = $state<CloudDriveState>({ lastUpload: null, lastDownload: null });

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
    unsubDrive = syncManager.subscribe((s) => { drive = { lastUpload: s.lastUpload ?? null, lastDownload: s.lastDownload ?? null }; });
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

  const themeOptions = [
    { id: "claro", label: "Claro", icon: "☀️" },
    { id: "oscuro", label: "Oscuro", icon: "🌙" },
    { id: "sistema", label: "Sistema", icon: "💻" },
  ] as const;
</script>

<nav
  class="sidebar {isMobile ? 'drawer' : ''} {drawerOpen ? 'open' : ''}"
  onclick={(e) => e.stopPropagation()}
  style="pointer-events: auto;"
>
  <div class="sidebar-header-integrated">
    <div class="mode-badge">
      <span class="glow-icon-notas">📚</span>
      <div class="mode-info">
        <span class="mode-label">SCHOOL</span>
        <div class="mode-name-line">
          <span class="mode-name">TRACKER</span>
          <span class="mode-pro">PRO</span>
        </div>
      </div>
    </div>
    {#if isMobile}
      <button class="drawer-close-btn" onclick={toggleDrawer}>✕</button>
    {/if}
  </div>
  <div class="sidebar-nav">
    <div class="sidebar-section-header">INICIO</div>
    <button class="sidebar-button {activeTab === 'dashboard' ? 'active' : ''}" onclick={() => onTabChange('dashboard')} type="button">
      <span>🏠</span><span>Inicio</span>
    </button>

    <div class="sidebar-section-header">ASISTENCIA</div>
    <button class="sidebar-button {activeTab === 'asistencia' ? 'active' : ''}" onclick={() => onTabChange('asistencia')} type="button">
      <span>📅</span><span>Asistencia</span>
    </button>
    <button class="sidebar-button {activeTab === 'informe' ? 'active' : ''}" onclick={() => onTabChange('informe')} type="button">
      <span>📊</span><span>Informe</span>
    </button>

    <div class="sidebar-section-header">NOTAS</div>
    <button class="sidebar-button {activeTab === 'notas' ? 'active' : ''}" onclick={() => onTabChange('notas')} type="button">
      <span>📓</span><span>Notas</span>
    </button>
    <button class="sidebar-button {activeTab === 'reportes' ? 'active' : ''}" onclick={() => onTabChange('reportes')} type="button">
      <span>📋</span><span>Reportes</span>
    </button>
    <button class="sidebar-button {activeTab === 'evaluaciones' ? 'active' : ''}" onclick={() => onTabChange('evaluaciones')} type="button">
      <span>📝</span><span>Evaluaciones</span>
    </button>
    <button class="sidebar-button {activeTab === 'estudiantes' ? 'active' : ''}" onclick={() => onTabChange('estudiantes')} type="button">
      <span>👨‍🎓</span><span>Estudiantes</span>
    </button>

    <div class="sidebar-section-header">GENERALES</div>
    <button class="sidebar-button {activeTab === 'globales' ? 'active' : ''}" onclick={() => onTabChange('globales')} type="button">
      <span>🌐</span><span>Globales</span>
    </button>
    <button class="sidebar-button {activeTab === 'ajustes' ? 'active' : ''}" onclick={() => onTabChange('ajustes')} type="button">
      <span>⚙️</span><span>Ajustes</span>
    </button>
  </div>

  <div class="cloud-widget">
    <div
      class="cloud-card {justSynced ? 'flash' : ''}"
      class:d1-ok={d1.status === 'success' || d1.status === 'idle'}
      onclick={() => onTabChange('cloud')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTabChange('cloud'); } }}
      role="button"
      tabindex="0"
      title="Ir a Nube"
    >
      <div class="cloud-head">
        <span class="cloud-dot {d1.status}"></span>
        <span class="cloud-title">Nube D1</span>
        <span class="cloud-chip {d1.status}">{d1Chip}</span>
      </div>
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
    </div>

    <div
      class="cloud-card drive-card"
      onclick={() => onTabChange('cloud')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTabChange('cloud'); } }}
      role="button"
      tabindex="0"
      title="Ir a Nube"
    >
      <div class="cloud-head">
        <span class="cloud-dot drive" class:active={!!drive.lastUpload}></span>
        <span class="cloud-title">Respaldo Drive</span>
      </div>
      <div class="cloud-time">Último respaldo: {drive.lastUpload ? fmtTime(drive.lastUpload) : 'sin hacer'}</div>
    </div>
  </div>

  <div class="sidebar-section-header" style="padding-top: 12px;">APARIENCIA</div>
  <div class="theme-selector">
    {#each themeOptions as opt}
      <button
        class="theme-btn"
        class:active={themeMode === opt.id}
        onclick={() => setThemeMode(opt.id)}
        type="button"
        title={opt.label}
      >
        <span>{opt.icon}</span>
      </button>
    {/each}
  </div>
</nav>

<style>
  .theme-selector {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--bg-hover);
    border-radius: 12px;
    border: 1px solid var(--border-light);
    margin-top: 4px;
  }

  .theme-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 4px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 0.9rem;
  }

  .theme-btn:hover {
    background: var(--bg-active);
  }

  .theme-btn.active {
    background: var(--primary-light);
    border-color: var(--primary-color);
  }

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

  .cloud-card:hover {
    border-color: rgba(var(--primary-rgb), 0.35);
    background: rgba(255, 255, 255, 0.045);
  }

  .cloud-card.drive-card {
    cursor: pointer;
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
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-bright);
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

  @media (max-width: 1024px) {
    .cloud-widget {
      gap: 0.4rem;
      padding: 0.5rem 0 0.4rem;
    }
    .cloud-card {
      padding: 0.5rem 0.6rem;
      border-radius: 12px;
    }
    .cloud-title {
      font-size: 0.62rem;
    }
    .cloud-chip {
      font-size: 0.5rem;
      padding: 2px 5px;
    }
    .cloud-line {
      margin-top: 0.35rem;
      font-size: 0.62rem;
    }
    .cloud-time {
      margin-top: 0.3rem;
      font-size: 0.58rem;
    }
  }
</style>