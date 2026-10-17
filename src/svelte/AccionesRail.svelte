<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * AccionesRail — fila de acciones en Android que sí scrollea de lado.
   *
   * A diferencia de `BtnRail` (rejilla que envuelve), esta fila mantiene una sola
   * línea con `overflow-x`. Se usa donde los botones son anchos y pocos (p. ej.
   * los PDF de Reportes), y el resumen de filtros cambia según la página.
   */
  let {
    children,
    estilo = "",
  }: { children: Snippet; estilo?: string } = $props();
</script>

<div class="acciones-rail" style={estilo}>{@render children()}</div>

<style>
  .acciones-rail {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
    padding-bottom: 0.15rem;
  }
</style>
