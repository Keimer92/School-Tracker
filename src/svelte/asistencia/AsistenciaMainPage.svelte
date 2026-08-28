<script lang="ts">
  import AsistenciaPage from "../AsistenciaPage.svelte";
  import InformePage from "../InformePage.svelte";

  type SubTab = "tomar" | "informe";

  let {
    pageActive = false,
    subTabRequest = null as string | null,
  }: { pageActive?: boolean; subTabRequest?: string | null } = $props();

  // Siempre abre en "Tomar asistencia"; un subTabRequest (ej. quick-action del Dashboard)
  // puede abrir directamente el Informe.
  let activeSub: SubTab = $state("tomar");

  // Montaje perezoso: cada hijo se monta la primera vez que se visita y luego
  // queda oculto con display:none para preservar estado/drafts.
  let mountedRegistrar = $state(false);
  let mountedInforme = $state(false);

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

  // Montaje perezoso según el sub-tab activo
  $effect(() => {
    if (activeSub === "tomar") mountedRegistrar = true;
    else mountedInforme = true;
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
    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeEligible = !isSwipeBlockedTarget(e);
  }

  function onContentTouchEnd(e: TouchEvent) {
    if (!isAndroidUA) return;
    if (!swipeEligible) { swipeEligible = false; return; }
    swipeEligible = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && activeSub === "tomar") switchTo("informe");
      else if (dx > 0 && activeSub === "informe") switchTo("tomar");
    }
  }
</script>

<div class="asistencia-main" class:mobile={isAndroidUA} style="height:100%;min-height:0">
  <div class="asistencia-subtabs">
    <button class="subtab-btn" class:active={activeSub === 'tomar'} onclick={() => switchTo('tomar')} type="button">
      <span class="subtab-icon">✏️</span>
      <span>Tomar asistencia</span>
    </button>
    <button class="subtab-btn" class:active={activeSub === 'informe'} onclick={() => switchTo('informe')} type="button">
      <span class="subtab-icon">📊</span>
      <span>Informe</span>
    </button>
  </div>

  <div style="flex:1;min-height:0;position:relative" ontouchstart={onContentTouchStart} ontouchend={onContentTouchEnd}>
    {#if isAndroidUA}
      <div class="asistencia-subtabs-float">
        <button class="subtab-btn" class:active={activeSub === 'tomar'} onclick={() => switchTo('tomar')} type="button" aria-label="Tomar asistencia">
          <span class="subtab-icon">✏️</span>
        </button>
        <button class="subtab-btn" class:active={activeSub === 'informe'} onclick={() => switchTo('informe')} type="button" aria-label="Informe">
          <span class="subtab-icon">📊</span>
        </button>
      </div>
    {/if}
    {#if mountedRegistrar}
      <div style="display:{activeSub === 'tomar' ? 'block' : 'none'};height:100%">
        <AsistenciaPage visible={pageActive && activeSub === 'tomar'} />
      </div>
    {/if}
    {#if mountedInforme}
      <div style="display:{activeSub === 'informe' ? 'block' : 'none'};height:100%">
        <InformePage visible={pageActive && activeSub === 'informe'} />
      </div>
    {/if}
  </div>
</div>

<style>
  .asistencia-main {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .asistencia-subtabs {
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
  .asistencia-subtabs-float {
    display: none;
  }
  .asistencia-main.mobile .asistencia-subtabs {
    display: none;
  }
  .asistencia-main.mobile .asistencia-subtabs-float {
    display: flex;
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
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
  @media (max-width: 480px) {
    .subtab-btn span:last-child {
      font-size: 0.72rem;
    }
    .subtab-btn {
      padding: 0.38rem 0.65rem;
    }
  }
</style>
