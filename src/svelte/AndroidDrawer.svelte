<script lang="ts">
  import appIcon from "../assets/app-icon.png";
  import { emit } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { driveSyncService, syncManager } from "../lib/driveSyncService";

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
  // Progreso del respaldo instantáneo/automático (barra del chip del header)
  let driveUp = $state<{ loaded: number; total: number; pct: number } | null>(null);
  let driveUltimo = $state<{ when: string | null; bytes: number | null }>({ when: null, bytes: null });

  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function fmtMomento(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => syncManager.subscribe((s) => {
    driveUp = s.uploadProgress ?? null;
    driveUltimo = { when: s.lastUpload ?? null, bytes: s.lastUploadBytes ?? null };
  }));

  /** Nube es sección del rail de Ajustes, no un tab. */
  async function abrirNube() {
    try {
      await emit("open-ajustes", { section: "nube" });
    } catch (e) {
      console.warn("[Drawer] no se pudo abrir la sección Nube:", e);
      onNavigate("cloud");
    }
  }

  // El respaldo de Drive ya NO se dispara desde acá: el botón es informativo
  // y el guardado corre por el temporizador automático (o desde CloudPage).
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
  <!-- Indicador de Drive (solo informativo: no dispara respaldo al tocar) -->
  <div
    class="mobile-drive-btn"
    class:respaldando={respaldando || !!driveUp}
    title={driveUp
      ? `Subiendo a Drive: ${fmtBytes(driveUp.loaded)} / ${fmtBytes(driveUp.total)} (${driveUp.pct}%)`
      : (driveUltimo.when ? `Último respaldo: ${fmtMomento(driveUltimo.when)}${driveUltimo.bytes ? ` · ${fmtBytes(driveUltimo.bytes)}` : ''}` : 'Respaldo automático de Google Drive')}
  >
    {#if driveUp}
      <span class="drive-ring" style="--pct: {driveUp.pct}"></span>
      <span class="drive-pct">{driveUp.pct}%</span>
    {:else if respaldando}
      <span class="drive-spinner"></span>
      <span>Drive</span>
    {:else}
      <span class="drive-dot" class:ok={!!driveUltimo.when}></span>
      <span>Drive</span>
      {#if driveUltimo.when}
        <span class="drive-meta">{fmtMomento(driveUltimo.when)}{driveUltimo.bytes ? ` · ${fmtBytes(driveUltimo.bytes)}` : ''}</span>
      {/if}
    {/if}
    {#if driveUp}
      <span class="drive-bar"><span style="width: {driveUp.pct}%;"></span></span>
    {/if}
  </div>
  <!-- Card/chip de nube a la derecha del título (tap → pestaña Nube) -->
  <button
    class="mobile-sync-chip"
    class:ok={d1Status === 'success' || d1Status === 'idle'}
    class:syncing={d1Status === 'syncing'}
    class:err={d1Status === 'error' || d1Status === 'offline'}
    onclick={() => { void abrirNube(); }}
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
    position: relative;
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
  .drive-dot.ok {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.55);
  }
  .drive-meta {
    font-size: 0.5rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: #64748b;
  }
  /* Anillo + barra de progreso de la subida a Drive */
  .drive-ring {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: conic-gradient(#38bdf8 calc(var(--pct) * 1%), rgba(255, 255, 255, 0.12) 0);
    -webkit-mask: radial-gradient(circle, transparent 45%, #000 47%);
    mask: radial-gradient(circle, transparent 45%, #000 47%);
    flex-shrink: 0;
  }
  .drive-pct {
    font-size: 0.55rem;
    color: #7dd3fc;
    font-weight: 700;
  }
  .drive-bar {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 3px;
    height: 2px;
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .drive-bar > span {
    display: block;
    height: 100%;
    border-radius: 1px;
    background: linear-gradient(90deg, #38bdf8, #818cf8);
    transition: width 0.2s ease;
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
