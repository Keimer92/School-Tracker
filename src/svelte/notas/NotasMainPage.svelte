<script lang="ts">
  import NotasPage from "../NotasPage.svelte";

  type SubTab = "registrar" | "reportes";

  let {
    pageActive = false,
    subTabRequest = null as string | null,
  }: { pageActive?: boolean; subTabRequest?: string | null } = $props();

  // Siempre abre en "Registrar"; un subTabRequest (ej. quick-action del Dashboard)
  // puede abrir directamente los Reportes.
  let activeSub: SubTab = $state("registrar");

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

  function switchTo(tab: SubTab) {
    activeSub = tab;
  }

  // ── Swipe horizontal para alternar sub-tabs (solo Android, solo en vertical) ──
  // Es el ÚNICO control del modo en Android: no hay barra arriba ni píldora
  // flotante. En escritorio el modo lo lleva el ModoToggle de la barra de
  // filtros de cada hijo (onModoChange).
  //
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
    // Solo en vertical (portrait) se alternan sub-tabs con swipe.
    if (window.innerHeight <= window.innerWidth) return;
    const toque = e.changedTouches[0];
    const dx = toque.clientX - swipeStartX;
    const dy = toque.clientY - swipeStartY;
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && activeSub === "registrar") switchTo("reportes");
      else if (dx > 0 && activeSub === "reportes") switchTo("registrar");
    }
  }
</script>

<div class="notas-main" style="height:100%;min-height:0">
  <div style="flex:1;min-height:0;position:relative" ontouchstart={onContentTouchStart} ontouchend={onContentTouchEnd}>
    <!--
      No hay barra de sub-tabs ni píldora flotante: en escritorio el control es
      el ModoToggle dentro de la barra de filtros de NotasPage (que avisa por
      `onModoChange`) y en Android basta el swipe. Cualquier cosa que se ponga
      acá arriba vuelve a apilarse con los filtros, que es exactamente lo que se
      quitó.

      Un SOLO hijo: `modo` decide qué mitad se renderiza dentro de NotasPage
      (mismo patrón que AsistenciaMainPage con AsistenciaPage). No hay montaje
      perezoso ni display:none por sub-tab: el borrador de "Registrar" y las
      dos cadenas de carga viven en el mismo componente.
    -->
    <NotasPage modo={activeSub} onModoChange={switchTo} visible={pageActive} />
  </div>
</div>

<style>
  .notas-main {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
</style>
