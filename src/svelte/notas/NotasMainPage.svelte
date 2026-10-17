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

  // Sin swipe: el modo se cambia con el `ModoToggle` visible que el hijo dibuja
  // en Android (misma pieza que en escritorio) y que avisa por `onModoChange`.
  // Antes el swipe era el único control en Android y un toque dentro del área de
  // notas podía leerse como navegación; con el control a la vista, el gesto sobra.
</script>

<div class="notas-main" style="height:100%;min-height:0">
  <div style="flex:1;min-height:0;position:relative">
    <!--
      No hay barra de sub-tabs ni píldora flotante: el control es el ModoToggle
      que NotasPage dibuja dentro de su barra de filtros (escritorio y Android,
      este último en variante grande) y que avisa por `onModoChange`. Cualquier
      cosa que se ponga acá arriba vuelve a apilarse con los filtros, que es
      exactamente lo que se quitó.

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
