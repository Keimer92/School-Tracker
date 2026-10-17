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
</script>

<div class="asistencia-main" style="height:100%;min-height:0">
  <div style="flex:1;min-height:0;position:relative">
    <!--
      Un SOLO componente para los dos modos: `modo` decide si se escribe o solo
      se lee, y `visible` sigue siendo "este sub-tab está a la vista". Así la
      tabla, los filtros y las estadísticas existen una sola vez y se monta una
      sola vez (sin display:none por sub-tab): el estado/drafts vive en el hijo.

      El modo se cambia con el MISMO `ModoToggle` que usa escritorio (ver la barra
      de filtros del hijo): visible también en Android. Se eliminó el swipe
      horizontal del wrapper (2026-10) para que el comportamiento sea igual al de
      Windows, igual que en Notas. Cualquier control extra acá arriba volvería a
      apilarse con el buscador y los filtros, que es justo lo que se quitó.
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
