<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * BtnRail — riel de BOTONES para Android: rejilla de 3 columnas que envuelve.
   *
   * Reemplaza la fila con `overflow-x:auto` (scroll lateral): en un teléfono las
   * acciones de la derecha ni se veían. Con la rejilla se ven todas de entrada,
   * en 2 filas si hacen falta (6 botones → 3 + 3), con la etiqueta recortada con
   * elipsis en vez de forzar la columna a crecer.
   *
   * ⚠️ `:global(.btn-mod…)` porque `.btn-mod` es el nodo raíz de `BotonMod` y NO
   * lleva el hash de scope de la página que lo usa.
   *
   * ⚠️ Los botones deben ir SIN `compacto`: ese prop inyecta `padding` en el
   * `style` en línea y ganaría al padding reducido de esta rejilla.
   */
  let {
    children,
    estilo = "",
  }: { children: Snippet; estilo?: string } = $props();
</script>

<div class="btn-rail" style={estilo}>{@render children()}</div>

<style>
  .btn-rail {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  .btn-rail :global(.btn-mod) {
    width: 100%;
    padding: 0 0.45rem;
    font-size: 0.74rem;
  }
  .btn-rail :global(.btn-mod .txt) {
    min-width: 0;
    overflow: hidden;
  }
  .btn-rail :global(.btn-mod .txt > span:first-child) {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .btn-rail :global(.btn-mod .sub) {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
