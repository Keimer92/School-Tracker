<script lang="ts">
  export type Tab = "dashboard" | "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe" | "cloud";

  export let activeTab: Tab;
  export let drawerOpen: boolean;
  export let isMobile: boolean;
  export let onTabChange: (tab: Tab) => void;
  export let toggleDrawer: () => void;
  export let onDrawerClose: () => void;
  export let themeMode: string;
  export let setThemeMode: (mode: string) => void;

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
    <button class="sidebar-button {activeTab === 'cloud' ? 'active' : ''}" onclick={() => onTabChange('cloud')} type="button">
      <span>☁️</span><span>Nube</span>
    </button>
  </div>

  <div class="sidebar-section-header" style="margin-top: auto; padding-top: 12px;">APARIENCIA</div>
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
</style>