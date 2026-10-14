<script lang="ts">
  /**
   * Barra superior de Android (reemplaza el header + drawer, 2026-10).
   *
   * Antes eran DOS piezas: un `AndroidDrawer` que pintaba el header (hamburguesa,
   * título y dos pills de nube) y el `Sidebar` en modo `drawer`, que aparecía
   * tapado con un transform. En un teléfono eso costaba un toque extra para
   * cualquier cosa y el header quedaba tan lleno que la card de Drive tapaba el
   * texto "School Tracker".
   *
   * Ahora es UNA sola fila: los iconos de las páginas quedan siempre a la vista
   * y las cards de nube van al final, después de Configuración (que es donde se
   * termina de leer la barra).
   *
   * ⚠️ La barra NO lleva el título de la app: cada botón es una página, y el
   * espacio horizontal en un teléfono es el recurso escaso. La identidad de la app
   * ya está en el ícono del launcher y en el splash del WelcomePage.
   *
   * Glassmorphism según el estilo de la app: `rgba(255,255,255,0.03)` de fondo,
   * `backdrop-filter: blur(20px)`, borde `rgba(255,255,255,0.07)`. El botón activo
   * se distingue por el color de acento, NO por el relleno sólido, para que los
   * cinco pesos visualmente iguales (es lo que hace que un control segmentado
   * pase desapercibido en vez de leerse).
   */
  import appIcon from "../assets/app-icon.png";
  import { onMount } from "svelte";
  import { syncManager } from "../lib/driveSyncService";
  import { openCloudPanel } from "../lib/cloudPanels.svelte";
  import { tagLocale, t } from "../lib/i18n.svelte";

  type Tab = "dashboard" | "asistencia" | "notas" | "estudiantes" | "ajustes";

  interface Props {
    activeTab: Tab;
    d1Status?: string;
    onTabChange: (tab: Tab) => void;
  }

  let { activeTab, d1Status = "idle", onTabChange }: Props = $props();

  /**
   * `$derived`, no `const`: las etiquetas usan `t()` y con `const` quedarían
   * congeladas en el idioma del arranque. Los `id` son claves de dominio (los
   * mismos que usa `activeTab`), NO se traducen.
   */
  const PAGINAS = $derived([
    { id: "dashboard" as const, icono: "🏠", etiqueta: t('sb.inicio') },
    { id: "asistencia" as const, icono: "📅", etiqueta: t('sb.asistencia') },
    { id: "notas" as const, icono: "📓", etiqueta: t('sb.notas') },
    { id: "estudiantes" as const, icono: "👨‍🎓", etiqueta: t('sb.estudiantes') },
    { id: "ajustes" as const, icono: "⚙️", etiqueta: t('sb.configuracion') },
  ]);

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
    return d.toLocaleString(tagLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => syncManager.subscribe((s) => {
    driveUp = s.uploadProgress ?? null;
    driveUltimo = { when: s.lastUpload ?? null, bytes: s.lastUploadBytes ?? null };
  }));

  const abrirD1 = () => openCloudPanel('d1');
  const abrirDrive = () => openCloudPanel('drive');
</script>

<div class="topbar">
  <img class="tb-logo" src={appIcon} alt="" draggable="false" />

  <!-- Páginas. Cada botón es un destino directo: no hay menú que abrir. -->
  <nav class="tb-paginas">
    {#each PAGINAS as p (p.id)}
      <button
        type="button"
        class="tb-btn"
        class:act={activeTab === p.id}
        onclick={() => onTabChange(p.id)}
        aria-current={activeTab === p.id ? 'page' : undefined}
        title={p.etiqueta}
      >
        <span class="tb-ico">{p.icono}</span>
        <span class="tb-txt">{p.etiqueta}</span>
      </button>
    {/each}
  </nav>

  <!--
    Cards de nube, al FINAL de la barra. Antes eran dos pills pegadas al título y
    la de Drive (que además lleva la hora del último respaldo) tapaba el texto
    "School Tracker"; ahora la fila es solo navegación y estos dos quedan al
    final, con ancho fijo para que no roben espacio a los iconos de página.
  -->
  <div class="tb-nube">
    <!-- Nube D1: punto de estado + tap abre el panel -->
    <button
      type="button"
      class="tb-chip"
      class:ok={d1Status === 'success' || d1Status === 'idle'}
      class:syncing={d1Status === 'syncing'}
      class:err={d1Status === 'error' || d1Status === 'offline'}
      onclick={abrirD1}
      title={t('d1m.conectar.titulo')}
      aria-label={t('d1m.conectar.titulo')}
    >
      <span class="tb-dot"></span><span>☁️</span>
    </button>

    <!-- Drive: muestra el progreso de subida o la fecha del último respaldo -->
    <button
      type="button"
      class="tb-chip tb-drive"
      onclick={abrirDrive}
      title={driveUp
        ? t('ccards.subiendoDrive', { actual: fmtBytes(driveUp.loaded), total: fmtBytes(driveUp.total), pct: driveUp.pct })
        : (driveUltimo.when
          ? t('drawer.ultimoRespaldo', { momento: fmtMomento(driveUltimo.when), tam: driveUltimo.bytes ? ` · ${fmtBytes(driveUltimo.bytes)}` : '' })
          : t('drawer.driveDesc'))}
      aria-label={t('ccards.drive')}
    >
      {#if driveUp}
        <span class="tb-ring" style="--pct: {driveUp.pct}"></span>
        <span class="tb-pct">{driveUp.pct}%</span>
      {:else}
        <span class="tb-dot ok" class:ok={!!driveUltimo.when}></span>
        <span>💾</span>
      {/if}
      {#if driveUp}
        <span class="tb-bar"><span style="width: {driveUp.pct}%;"></span></span>
      {/if}
    </button>
  </div>
</div>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: calc(var(--sat, env(safe-area-inset-top, 0px)) + 6px) 8px 6px;
    box-sizing: border-box;
    /* Glass según el resto de la app */
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: 0 2px 14px rgba(0, 0, 0, 0.22);
    /* Fijo arriba: el contenido scrollea por debajo, como el header anterior.
       `position: fixed` + ancestro con `backdrop-filter` no se mezclan: esta barra
       es el elemento glass de primer nivel, no un descendiente de otro. */
    flex-shrink: 0;
  }

  .tb-logo {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    flex-shrink: 0;
    margin-right: 2px;
  }

  .tb-paginas {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tb-paginas::-webkit-scrollbar { display: none; width: 0; height: 0; }

  .tb-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    flex: 1 1 0;
    min-width: 44px;
    /* 44px es el mínimo táctil comfortable en Android: por debajo los aciertos
       fallan en dedos grandes. */
    min-height: 44px;
    padding: 4px 2px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.18s ease, background 0.18s ease, border-color 0.18s ease;
  }
  .tb-btn:active { transform: scale(0.94); }
  .tb-btn:hover:not(.act) { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; }

  /* Activo: fondo tenue + borde de acento. Sin relleno sólido, para que los
     cinco botones pesen lo mismo y el activo se lea sin gritar. */
  .tb-btn.act {
    background: rgba(var(--primary-rgb), 0.16);
    border-color: rgba(var(--primary-rgb), 0.42);
    color: #f1f5f9;
    box-shadow: 0 2px 10px rgba(var(--primary-rgb), 0.2);
  }

  .tb-ico { font-size: 1.05rem; line-height: 1.1; }

  /* Etiqueta corta: en un teléfono el ancho manda, y el nombre completo de
     "Configuración" no cabe al lado de cuatro iconos más. */
  .tb-txt {
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.1px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-nube {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding-left: 6px;
    margin-left: 2px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .tb-chip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #cbd5e1;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.15s ease, background 0.2s ease, border-color 0.2s ease;
  }
  .tb-chip:active { transform: scale(0.94); }

  .tb-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #94a3b8;
    flex-shrink: 0;
  }
  .tb-chip.ok .tb-dot { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.5); }
  .tb-chip.syncing .tb-dot { background: #f59e0b; animation: tbPulse 1s ease-in-out infinite; }
  .tb-chip.err .tb-dot { background: #ef4444; box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }
  @keyframes tbPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

  .tb-ring {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: conic-gradient(#38bdf8 calc(var(--pct) * 1%), rgba(255, 255, 255, 0.12) 0);
    -webkit-mask: radial-gradient(circle, transparent 45%, #000 47%);
    mask: radial-gradient(circle, transparent 45%, #000 47%);
    flex-shrink: 0;
  }
  .tb-pct { font-size: 0.55rem; color: #7dd3fc; font-weight: 700; }
  .tb-bar {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 3px;
    height: 2px;
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .tb-bar > span {
    display: block;
    height: 100%;
    border-radius: 1px;
    background: linear-gradient(90deg, #38bdf8, #818cf8);
    transition: width 0.2s ease;
  }

  /* En pantallas muy angostas se oculta el TEXTO de los botones y quedan solo los
     iconos: es lo que mantiene los dos chips de nube dentro de la pantalla sin
     que la fila scrollee. El `title` sigue estando para el tooltip. */
  @media (max-width: 400px) {
    .tb-txt { display: none; }
    .tb-btn { min-width: 38px; }
  }
</style>