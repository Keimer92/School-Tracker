<script lang="ts">
  import AsistenciaPage from "../AsistenciaPage.svelte";

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
  // Es el ÚNICO control del modo en Android: no hay barra arriba ni píldora
  // flotante. En escritorio el modo lo lleva el ModoToggle de la barra de
  // filtros del hijo (onModoChange).
  //
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

<div class="asistencia-main" style="height:100%;min-height:0">
  <div style="flex:1;min-height:0;position:relative" ontouchstart={onContentTouchStart} ontouchend={onContentTouchEnd}>
    <!--
      Un SOLO componente para los dos modos: `modo` decide si se escribe o solo
      se lee, y `visible` sigue siendo "este sub-tab está a la vista". Así la
      tabla, los filtros y las estadísticas existen una sola vez y se monta una
      sola vez (sin display:none por sub-tab): el estado/drafts vive en el hijo.

      No hay barra de sub-tabs ni píldora flotante: en escritorio el control es
      el ModoToggle dentro de la barra de filtros del hijo (que avisa por
      `onModoChange`) y en Android basta el swipe. Cualquier cosa que se ponga
      acá arriba vuelve a apilarse con el SearchFab y con los filtros, que es
      exactamente lo que se quitó.
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
</style>
