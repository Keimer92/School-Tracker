<script lang="ts">
  import NotasPage from "../NotasPage.svelte";
  import ReportesPage from "../ReportesPage.svelte";

  type SubTab = "registrar" | "reportes";

  let {
    pageActive = false,
    subTabRequest = null as string | null,
  }: { pageActive?: boolean; subTabRequest?: string | null } = $props();

  // Siempre abre en "Registrar"; un subTabRequest (ej. quick-action del Dashboard)
  // puede abrir directamente los Reportes.
  let activeSub: SubTab = $state("registrar");

  // Montaje perezoso: cada hijo se monta la primera vez que se visita y luego
  // queda oculto con display:none para preservar estado.
  let mountedRegistrar = $state(false);
  let mountedReportes = $state(false);

  // Peticiones externas + reset al entrar:
  // Cada vez que la página pasa de oculta a visible vuelve a "Registrar",
  // SALVO que exista una petición explícita de abrir Reportes.
  let wasPageActive = pageActive;
  $effect(() => {
    const pa = pageActive;
    const activated = pa && !wasPageActive;
    const req = subTabRequest;
    wasPageActive = pa;
    if (!pa) return;
    if (req === "reportes") activeSub = "reportes";
    else if (activated) activeSub = "registrar";
  });

  // Montaje perezoso según el sub-tab activo
  $effect(() => {
    if (activeSub === "registrar") mountedRegistrar = true;
    else mountedReportes = true;
  });

  function switchTo(tab: SubTab) {
    activeSub = tab;
  }

  // ── Swipe horizontal para alternar sub-tabs (solo Android, solo en vertical) ──
  // Deslizar a la izquierda → Reportes · Deslizar a la derecha → Registrar.
  // En modo horizontal (landscape) el swipe está DESHABILITADO: la tabla de notas
  // usa scroll horizontal propio y el gesto conflictúa con la navegación de sub-tabs.
  // Se ignora el gesto si inicia dentro de un elemento con scroll horizontal propio
  // o dentro de un modal/overlay fijo. Nota: en la vista de captura de Notas (vertical),
  // el deslizamiento horizontal ya navega entre estudiantes (el hijo consume ese gesto).
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
    // Sin swipe lateral en modo horizontal (landscape): la tabla de notas usa
    // scroll horizontal propio y el gesto conflictúa con la navegación de sub-tabs.
    if (window.innerHeight <= window.innerWidth) { swipeEligible = false; return; }
    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeEligible = !isSwipeBlockedTarget(e);
  }

  function onContentTouchEnd(e: TouchEvent) {
    if (!isAndroidUA) return;
    if (!swipeEligible) { swipeEligible = false; return; }
    swipeEligible = false;
    // Solo en vertical (portrait) se alternan sub-tabs con swipe.
    if (window.innerHeight <= window.innerWidth) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && activeSub === "registrar") switchTo("reportes");
      else if (dx > 0 && activeSub === "reportes") switchTo("registrar");
    }
  }
</script>

<div class="notas-main" class:mobile={isAndroidUA} style="height:100%;min-height:0">
  <div class="notas-subtabs">
    <button class="subtab-btn" class:active={activeSub === 'registrar'} onclick={() => switchTo('registrar')} type="button">
      <span class="subtab-icon">✏️</span>
      <span>Registrar</span>
    </button>
    <button class="subtab-btn" class:active={activeSub === 'reportes'} onclick={() => switchTo('reportes')} type="button">
      <span class="subtab-icon">📊</span>
      <span>Reportes</span>
    </button>
  </div>

  <div style="flex:1;min-height:0;position:relative" ontouchstart={onContentTouchStart} ontouchend={onContentTouchEnd}>
    {#if isAndroidUA}
      <div class="notas-subtabs-float">
        <button class="subtab-btn" class:active={activeSub === 'registrar'} onclick={() => switchTo('registrar')} type="button" aria-label="Registrar">
          <span class="subtab-icon">✏️</span>
        </button>
        <button class="subtab-btn" class:active={activeSub === 'reportes'} onclick={() => switchTo('reportes')} type="button" aria-label="Reportes">
          <span class="subtab-icon">📊</span>
        </button>
      </div>
    {/if}
    {#if mountedRegistrar}
      <div style="display:{activeSub === 'registrar' ? 'block' : 'none'};height:100%">
        <NotasPage visible={pageActive && activeSub === 'registrar'} />
      </div>
    {/if}
    {#if mountedReportes}
      <div style="display:{activeSub === 'reportes' ? 'block' : 'none'};height:100%">
        <ReportesPage visible={pageActive && activeSub === 'reportes'} />
      </div>
    {/if}
  </div>
</div>

<style>
  .notas-main {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .notas-subtabs {
    display: flex;
    gap: 4px;
    padding: 0.45rem 0.5rem;
    margin: 0.25rem 0.5rem 0;
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    width: fit-content;
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
  /* En Android la barra de pestañas se oculta para ahorrar espacio vertical:
     se alterna con swipe o con este conmutador flotante (icons-only, absoluto). */
  .notas-subtabs-float {
    display: none;
  }
  .notas-main.mobile .notas-subtabs {
    display: none;
  }
  .notas-main.mobile .notas-subtabs-float {
    display: flex;
    position: fixed;
    bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
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
  .notas-main.mobile .notas-subtabs-float .subtab-btn {
    padding: 0.4rem 0.6rem;
  }
  @media (max-width: 480px) {
    .subtab-btn span:last-child {
      font-size: 0.72rem;
    }
    .subtab-btn {
      padding: 0.38rem 0.65rem;
    }
  }
</style>
