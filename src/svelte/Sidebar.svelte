<script lang="ts">
  import CloudCards from './CloudCards.svelte';
  import appIcon from '../assets/app-icon.png';

  export type Tab = "dashboard" | "notas" | "estudiantes" | "evaluaciones" | "ajustes" | "asistencia" | "cloud" | "account";

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
      <img class="sidebar-app-icon" src={appIcon} alt="School Tracker" draggable="false" />
      <div class="mode-info">
        <span class="mode-label">SCHOOL</span>
        <div class="mode-name-line">
          <span class="mode-name">TRACKER</span>
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

    <div class="sidebar-section-header">NOTAS</div>
    <button class="sidebar-button {activeTab === 'notas' ? 'active' : ''}" onclick={() => onTabChange('notas')} type="button">
      <span>📓</span><span>Notas</span>
    </button>
    <button class="sidebar-button {activeTab === 'evaluaciones' ? 'active' : ''}" onclick={() => onTabChange('evaluaciones')} type="button">
      <span>📝</span><span>Evaluaciones</span>
    </button>
    <button class="sidebar-button {activeTab === 'estudiantes' ? 'active' : ''}" onclick={() => onTabChange('estudiantes')} type="button">
      <span>👨‍🎓</span><span>Estudiantes</span>
    </button>

    <div class="sidebar-section-header">GENERALES</div>
    <button class="sidebar-button {activeTab === 'ajustes' ? 'active' : ''}" onclick={() => onTabChange('ajustes')} type="button">
      <span>⚙️</span><span>Ajustes Generales</span>
    </button>
    <button class="sidebar-button {activeTab === 'cloud' ? 'active' : ''}" onclick={() => onTabChange('cloud')} type="button">
      <span>☁️</span><span>Nube</span>
    </button>
    <button class="sidebar-button {activeTab === 'account' ? 'active' : ''}" onclick={() => onTabChange('account')} type="button">
      <span>👤</span><span>Cuentas</span>
    </button>
  </div>

  {#if !isMobile}
    <CloudCards onTabChange={onTabChange} />
  {/if}

  <div class="sidebar-section-header" style="padding-top: 6px;">APARIENCIA</div>
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

  /* Cards de nube dentro del drawer: alineadas y sin desbordes */
  .drawer-cloud {
    padding: 0 12px 10px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .drawer-cloud :global(.cloud-widget) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    margin-top: 0;
    padding-top: 0.25rem;
  }
  .drawer-cloud :global(.cloud-head) {
    min-width: 0;
  }
  .drawer-cloud :global(.cloud-title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-cloud :global(.cloud-chip),
  .drawer-cloud :global(.cloud-time-inline) {
    flex-shrink: 0;
  }
  .drawer-cloud :global(.cloud-chip) {
    font-size: 0.55rem;
    padding: 2px 6px;
    letter-spacing: 0.03em;
  }
  /* Card de respaldo Drive en el drawer móvil: compacta y sin desbordes */
  .drawer-cloud {
    padding: 0 12px 8px;
    min-width: 0;
  }
  .drawer-cloud :global(.cloud-widget) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    margin-top: 0;
    padding-top: 0.25rem;
    padding-bottom: 0;
  }
</style>