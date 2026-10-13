<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import CloudCards from './CloudCards.svelte';
  import appIcon from '../assets/app-icon.png';
  import { t } from '../lib/i18n.svelte';

  // Nube y Cuenta ya no son tabs ni secciones: la nube se abre en modales desde
  // las cards de abajo y la página de Cuenta se eliminó.
  export type Tab = "dashboard" | "notas" | "estudiantes" | "ajustes" | "asistencia";

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

  // `$derived`, no `const`: los labels usan `t()`, y con `const` se quedarían
  // en el idioma del arranque (no da error de compilación). El id de dominio
  // (claro/oscuro/sistema) NO se traduce: viaja a localStorage.
  const themeOptions = $derived([
    { id: "claro", label: t('sb.tema.claro'), icon: "☀️" },
    { id: "oscuro", label: t('sb.tema.oscuro'), icon: "🌙" },
    { id: "sistema", label: t('sb.tema.sistema'), icon: "💻" },
  ] as const);

  /**
   * Acordeón de Configuración (escritorio).
   *
   * Reemplaza al rail que vivía dentro de ConfiguracionPage. El rail ocupaba
   * una columna fija de 64/252 px y competía con el contenido; ahora el botón
   * ⚙️ del sidebar despliega la lista y no ocupa nada cuando está cerrada.
   *
   * El hover SOLO despliega; elegir una sección es lo que cambia de página
   * (decisión del usuario, ver el hilo de implementación). Por eso el desplegable
   * se cierra solo al tocar una página PRINCIPAL: si se cerrara al elegir
   * cualquier sección, dentro de Configuración no habría forma de pasar de una
   * sección a otra sin dos clicks.
   */
  let ajustesAbierto = $state(false);
  let ajustesFijado = $state(false);

  /**
   * ¿Este dispositivo tiene hover real?
   *
   * En táctil no hay hover: un toque dispararía `mouseenter` al tocar y la lista
   * se abriría mientras el usuario navega. Mismo criterio que usaba el rail.
   */
  const PUEDE_HOVER = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /** Canales de secciones de Configuración, para el acordeón del sidebar. */
  const SECCIONES_AJUSTES = $derived([
    { grupo: t('cfg.grupo.academico'), items: [
      { id: 'evaluaciones', label: t('cfg.sec.evaluaciones'), icono: '✏️', color: '#c084fc' },
      { id: 'notas', label: t('cfg.sec.notas'), icono: '⭐', color: '#fbbf24' },
      { id: 'multiplicadores', label: t('cfg.sec.multiplicadores'), icono: '✖️', color: '#a78bfa' },
      { id: 'ano-lectivo', label: t('cfg.sec.ano-lectivo'), icono: '📅', color: '#818cf8' },
      { id: 'corte', label: t('cfg.sec.corte'), icono: '✂️', color: '#f472b6' },
      { id: 'asignaturas', label: t('cfg.sec.asignaturas'), icono: '📚', color: '#60a5fa' },
      { id: 'colegios', label: t('cfg.sec.colegios'), icono: '🏫', color: '#34d399' },
      { id: 'grados', label: t('cfg.sec.grados'), icono: '📊', color: '#fb923c' },
      { id: 'secciones', label: t('cfg.sec.secciones'), icono: '👥', color: '#a78bfa' },
    ]},
    { grupo: t('cfg.grupo.aplicacion'), items: [
      { id: 'general', label: t('cfg.sec.general'), icono: '⚙️', color: '#60a5fa' },
      ...(isAndroid ? [{ id: 'notificaciones', label: t('cfg.sec.notificaciones'), icono: '🔔', color: '#fbbf24' }] : []),
    ]},
    { grupo: t('cfg.grupo.sistema'), items: [
      { id: 'debug', label: t('cfg.sec.debug'), icono: '🐛', color: '#ef4444' },
      { id: 'info', label: t('cfg.sec.info'), icono: '📖', color: '#a78bfa' },
    ]},
  ]);

  /** Elegir una sección: abre Configuración en ella y deja el acordejo fijo. */
  function irASeccion(id: string) {
    ajustesAbierto = false;
    ajustesFijado = true;
    emit('open-ajustes', { section: id });
  }

  function irAPagina(tab: Tab) {
    // Cerrar al tocar una página principal es lo que pidió el usuario: fuera de
    // Configuración, el acordeón sobraría tapando el sidebar.
    if (tab !== 'ajustes') { ajustesAbierto = false; ajustesFijado = false; }
    onTabChange(tab);
  }
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
    <div class="sidebar-section-header">{t('sb.principal')}</div>
    <button class="sidebar-button {activeTab === 'dashboard' ? 'active' : ''}" onclick={() => irAPagina('dashboard')} type="button">
      <span>🏠</span><span>{t('sb.inicio')}</span>
    </button>
    <button class="sidebar-button {activeTab === 'asistencia' ? 'active' : ''}" onclick={() => irAPagina('asistencia')} type="button">
      <span>📅</span><span>{t('sb.asistencia')}</span>
    </button>
    <button class="sidebar-button {activeTab === 'notas' ? 'active' : ''}" onclick={() => irAPagina('notas')} type="button">
      <span>📓</span><span>{t('sb.notas')}</span>
    </button>
    <button class="sidebar-button {activeTab === 'estudiantes' ? 'active' : ''}" onclick={() => irAPagina('estudiantes')} type="button">
      <span>👨‍🎓</span><span>{t('sb.estudiantes')}</span>
    </button>

    <div class="sidebar-section-header">{t('sb.generales')}</div>

    <!--
      ACORDEÓN DE CONFIGURACIÓN (solo escritorio).

      El `onmouseenter`/`onmouseleave` va sobre un contenedor que ABRUYE Y CIERRA
      la lista, no solo el botón: si el cursor baja a la lista y sale por el
      costado, sin este contenedor el desplegable se cerraría antes de poder
      elegir nada.

      `PUEDE_HOVER` evita que en táctil un toque abra la lista por accidente
      (mismo criterio que el rail anterior).
    -->
    <div
      class="acc-wrap"
      onmouseenter={() => { if (PUEDE_HOVER) ajustesAbierto = true; }}
      onmouseleave={() => { if (PUEDE_HOVER) ajustesAbierto = false; }}
    >
      <button
        class="sidebar-button {activeTab === 'ajustes' ? 'active' : ''}"
        class:acc-abierto={ajustesAbierto || ajustesFijado}
        onclick={() => {
          // Click alterna el acordeón Y entra a Configuración en la sección por
          // defecto. Un solo gesto para el caso común ("quiero Ajustes"), sin
          // obligar a desplegar primero.
          if (activeTab !== 'ajustes') { ajustesAbierto = true; onTabChange('ajustes'); }
          else { ajustesAbierto = !ajustesAbierto; ajustesFijado = false; }
        }}
        type="button"
      >
        <span>⚙️</span><span>{t('sb.configuracion')}</span>
        <span class="acc-flecha" class:acc-flecha-on={ajustesAbierto || ajustesFijado}>›</span>
      </button>

      {#if ajustesAbierto || ajustesFijado}
        <div class="acc-lista">
          {#each SECCIONES_AJUSTES as grupo (grupo.grupo)}
            <div class="acc-grupo">{grupo.grupo}</div>
            {#each grupo.items as s (s.id)}
              <button class="acc-item" style="--acento:{s.color}" onclick={() => irASeccion(s.id)} type="button" title={s.label}>
                <span class="acc-icono">{s.icono}</span>
                <span class="acc-label">{s.label}</span>
              </button>
            {/each}
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if !isMobile}
    <CloudCards />
  {/if}

  <div class="sidebar-section-header" style="padding-top: 6px;">{t('sb.apariencia')}</div>
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
  /* ── Acordeón de Configuración ──────────────────────────────────────────
     El desplegable va en `position: absolute` y NO en el flujo: si ocupara
     altura, el sidebar empuja hacia abajo las cards de nube y el selector de
     tema al abrirse, y eso se ve como un salto. Flota encima. */
  .acc-wrap { position: relative; }

  .acc-flecha {
    margin-left: auto;
    font-size: 0.9rem;
    opacity: 0.5;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
  .acc-flecha-on { transform: rotate(90deg); opacity: 0.9; }
  .sidebar-button.acc-abierto { border-color: rgba(255,255,255,0.16); }

  .acc-lista {
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    z-index: 40;
    width: 100%;
    min-width: 190px;
    max-height: 62vh;
    overflow-y: auto;
    padding: 5px;
    background: rgba(20, 26, 38, 0.97);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    box-shadow: 0 18px 40px -10px rgba(0,0,0,0.6);
    display: flex;
    flex-direction: column;
    gap: 1px;
    animation: acc-aparece 0.16s ease;
  }
  @keyframes acc-aparece {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .acc-grupo {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    padding: 7px 8px 3px;
    font-weight: 700;
  }

  .acc-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.42rem 0.5rem;
    border: none;
    border-left: 3px solid var(--acento);
    background: transparent;
    border-radius: 8px;
    color: #cbd5e1;
    font-size: 0.76rem;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    min-width: 0;
  }
  .acc-item:hover { background: rgba(255,255,255,0.07); color: #f1f5f9; }
  .acc-icono { flex-shrink: 0; font-size: 0.85rem; }
  .acc-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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