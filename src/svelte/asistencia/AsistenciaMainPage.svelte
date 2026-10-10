<script lang="ts">
  import AsistenciaPage from "../AsistenciaPage.svelte";
  import { t } from "../../lib/i18n.svelte";

  type SubTab = "tomar" | "informe";

  let {
    pageActive = false,
    subTabRequest = null as string | null,
  }: { pageActive?: boolean; subTabRequest?: string | null } = $props();

  // Siempre abre en "Tomar asistencia"; un subTabRequest (ej. quick-action del Dashboard)
  // puede abrir directamente el Informe.
  let activeSub: SubTab = $state("tomar");

  // Peticiones externas + reset al entrar:
  // Cada vez que la página pasa de oculta a visible vuelve a "Tomar asistencia",
  // SALVO que exista una petición explícita de abrir el Informe
  // (ej. quick-action "Informe" del Dashboard).
  let wasPageActive = pageActive;
  $effect(() => {
    const pa = pageActive;
    const activated = pa && !wasPageActive;
    const req = subTabRequest;
    wasPageActive = pa;
    if (!pa) return;
    if (req === "informe") activeSub = "informe";
    else if (activated) activeSub = "tomar";
  });

  function switchTo(tab: SubTab) {
    activeSub = tab;
  }

  // ── Swipe horizontal para alternar sub-tabs (solo Android) ──
  // Deslizar a la izquierda → Informe · Deslizar a la derecha → Tomar asistencia.
  // Se ignora el gesto si inicia dentro de un elemento con scroll horizontal propio
  // (chips mensuales, filas semanales, tablas anchas) o dentro de un modal/overlay fijo.
  let isAndroidUA = /Android/i.test(navigator.userAgent);
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeEligible = false;

  function isSwipeBlockedTarget(e: Event): boolean {
    const path = e.composedPath ? (e.composedPath() as EventTarget[]) : [];
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      const st = getComputedStyle(node);
      // Modales/overlays fijos de las páginas hijas
      if (st.position === "fixed") {
        const z = parseInt(st.zIndex, 10);
        if (!Number.isNaN(z) && z >= 100) return true;
      }
      // Áreas con scroll horizontal propio
      if ((st.overflowX === "auto" || st.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 4) {
        return true;
      }
    }
    return false;
  }

  function onContentTouchStart(e: TouchEvent) {
    if (!isAndroidUA || e.touches.length !== 1) { swipeEligible = false; return; }
    // Se llama `toque`, no `t`: `t` es la funcion de i18n (GOTCHA de AGENTS.md).
    const toque = e.touches[0];
    swipeStartX = toque.clientX;
    swipeStartY = toque.clientY;
    swipeEligible = !isSwipeBlockedTarget(e);
  }

  function onContentTouchEnd(e: TouchEvent) {
    if (!isAndroidUA) return;
    if (!swipeEligible) { swipeEligible = false; return; }
    swipeEligible = false;
    const toque = e.changedTouches[0];
    const dx = toque.clientX - swipeStartX;
    const dy = toque.clientY - swipeStartY;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && activeSub === "tomar") switchTo("informe");
      else if (dx > 0 && activeSub === "informe") switchTo("tomar");
    }
  }
</script>

<div class="asistencia-main" class:mobile={isAndroidUA} style="height:100%;min-height:0">
  <div style="flex:1;min-height:0;position:relative" ontouchstart={onContentTouchStart} ontouchend={onContentTouchEnd}>
    {#if isAndroidUA}
      <div class="asistencia-subtabs-float">
        <button class="subtab-btn" class:active={activeSub === 'tomar'} onclick={() => switchTo('tomar')} type="button" aria-label={t('subtab.tomarAsistencia')}>
          <span class="subtab-icon">✏️</span>
        </button>
        <button class="subtab-btn" class:active={activeSub === 'informe'} onclick={() => switchTo('informe')} type="button" aria-label={t('subtab.informe')}>
          <span class="subtab-icon">📊</span>
        </button>
      </div>
    {/if}
    <!--
      Un SOLO componente para los dos modos: `modo` decide si se escribe o solo
      se lee, y `visible` sigue siendo "este sub-tab está a la vista". Así la
      tabla, los filtros y las estadísticas existen una sola vez y se monta una
      sola vez (sin display:none por sub-tab): el estado/drafts vive en el hijo.

      En escritorio NO hay barra de sub-tabs arriba: el control vive dentro de
      la barra de filtros del hijo (ModoToggle), que es quien avisa del cambio
      vía `onModoChange`. Dejarlo acá volvía a crear una segunda barra pegada al
      SearchFab y a los filtros, y la página se veía pesada.
    -->
    <AsistenciaPage modo={activeSub} onModoChange={switchTo} visible={pageActive} />
  </div>
</div>

<style>
  .asistencia-main {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .subtab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0.42rem 0.9rem;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: #94a3b8;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
  }
  .subtab-btn:hover:not(.active) {
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.05);
  }
  .subtab-btn:active:not(.active) {
    transform: scale(0.97);
  }
  .subtab-btn.active {
    background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.18), rgba(var(--primary-rgb), 0.06));
    border-color: rgba(var(--primary-rgb), 0.35);
    color: #f1f5f9;
    box-shadow: 0 2px 10px rgba(var(--primary-rgb), 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .subtab-btn:focus-visible {
    outline: none;
    border-color: rgba(148, 163, 184, 0.4);
  }
  .subtab-icon {
    font-size: 0.85rem;
    line-height: 1;
  }
  /* En escritorio no hay barra de sub-tabs: el modo lo controla el
     ModoToggle de la barra de filtros del hijo. En Android ese control no se
     renderiza (altura escasa), así que acá queda la píldora flotante
     icons-only, que no ocupa espacio en el layout y sigue soportando swipe. */
  .asistencia-subtabs-float {
    display: none;
  }
  .asistencia-main.mobile .asistencia-subtabs-float {
    display: flex;
    position: absolute;
    bottom: 0.75rem;
    left: 0.75rem;
    right: auto;
    z-index: 50;
    gap: 4px;
    padding: 4px;
    background: rgba(15, 23, 42, 0.82);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  }
  .asistencia-main.mobile .asistencia-subtabs-float .subtab-btn {
    padding: 0.4rem 0.6rem;
  }
</style>
