<script lang="ts">
  import appIcon from "../assets/app-icon.png";

  interface Props {
    drawerOpen: boolean;
    d1Status?: string;
    toggleDrawer: () => void;
    closeDrawer: () => void;
    onNavigate: (tab: any) => void;
  }

  let {
    drawerOpen,
    d1Status = "idle",
    toggleDrawer,
    closeDrawer,
    onNavigate
  }: Props = $props();
</script>

<div class="mobile-header" class:encima-drawer={drawerOpen}>
  <!-- El botón queda VISIBLE con el drawer abierto: sirve para cerrarlo -->
  <button
    class="mobile-menu-btn {drawerOpen ? 'drawer-abierto' : ''}"
    onclick={toggleDrawer}
    aria-label={drawerOpen ? 'Cerrar menú' : 'Abrir menú'}
  >
    <span class="menu-icon">{drawerOpen ? '✕' : '☰'}</span>
  </button>
  <span class="mobile-title">
    <img class="mobile-title-icon" src={appIcon} alt="" draggable="false" />
    School Tracker
  </span>
  <!-- Card/chip de nube a la derecha del título (tap → pestaña Nube) -->
  <button
    class="mobile-sync-chip"
    class:connected={d1Status === 'connected' || d1Status === 'pushing' || d1Status === 'pulling'}
    class:syncing={d1Status === 'pushing' || d1Status === 'pulling'}
    class:error={d1Status === 'error'}
    onclick={() => onNavigate('cloud')}
    title="Estado Sincronización Nube D1"
  >
    <span class="msc-dot"></span><span>☁️</span>
  </button>
</div>

<div
  class="drawer-backdrop {drawerOpen ? '' : 'closed'}"
  onclick={closeDrawer}
  onkeydown={(e) => e.key === 'Escape' && closeDrawer()}
  role="button"
  tabindex="0"
></div>

<style>
  /* Botón hamburger/cierre del drawer móvil: área táctil amplia */
  .mobile-menu-btn {
    min-width: 10px;
    min-height: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-right: 1px;
    -webkit-tap-highlight-color: transparent;
  }

  .mobile-menu-btn .menu-icon {
    font-size: 1.6rem !important;
    line-height: 1;
    display: block;
  }
</style>
