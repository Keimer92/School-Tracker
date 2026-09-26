<script lang="ts">
  import appIcon from "../assets/app-icon.png";
  import { emit } from "@tauri-apps/api/event";
  import { driveSyncService } from "../lib/driveSyncService";

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

  let respaldando = $state(false);

  async function respaldoManualDrive() {
    if (respaldando) return;
    let conectado = false;
    try {
      const s = localStorage.getItem('schooltracker-google-drive-settings');
      conectado = !!(s && JSON.parse(s)?.accessToken);
    } catch {}
    if (!conectado) { onNavigate('cloud'); return; }
    respaldando = true;
    try {
      await driveSyncService.pushAll();
      await emit("show-toast", { message: "✅ Respaldo subido a Google Drive", type: "success" });
    } catch (e) {
      console.error('Respaldo manual a Drive falló:', e);
      await emit("show-toast", { message: "❌ Error al crear respaldo: " + (e instanceof Error ? e.message : String(e)), type: "error" });
    } finally { respaldando = false; }
  }
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
  <!-- Botón de respaldo Drive (tap → respaldo directo o va a Nube si no conectado) -->
  <button
    class="mobile-drive-btn"
    class:respaldando
    onclick={respaldoManualDrive}
    title={respaldando ? 'Creando respaldo...' : 'Crear respaldo en Drive'}
  >
    {#if respaldando}
      <span class="drive-spinner"></span>
    {:else}
      <span class="drive-dot"></span>
    {/if}
    <span>Drive</span>
  </button>
  <!-- Card/chip de nube a la derecha del título (tap → pestaña Nube) -->
  <button
    class="mobile-sync-chip"
    class:ok={d1Status === 'success' || d1Status === 'idle'}
    class:syncing={d1Status === 'syncing'}
    class:err={d1Status === 'error' || d1Status === 'offline'}
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

  /* Con !important porque en <640px una regla global de App.css
     (p, span, div... { font-size: 0.95rem !important }) recorta el glyph. */
  .mobile-menu-btn .menu-icon {
    font-size: 1.9rem !important;
    line-height: 1;
    display: block;
  }

  /* Botón de Drive en el header */
  .mobile-drive-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid rgba(79, 142, 247, 0.3);
    background: rgba(79, 142, 247, 0.08);
    color: #93c5fd;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .mobile-drive-btn:hover {
    background: rgba(79, 142, 247, 0.15);
    border-color: rgba(79, 142, 247, 0.5);
  }

  .mobile-drive-btn.respaldando {
    border-color: rgba(79, 142, 247, 0.5);
    background: rgba(79, 142, 247, 0.15);
  }

  .drive-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4f8ef7;
    box-shadow: 0 0 6px rgba(79, 142, 247, 0.5);
  }

  .drive-spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(79, 142, 247, 0.25);
    border-top-color: #4f8ef7;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
