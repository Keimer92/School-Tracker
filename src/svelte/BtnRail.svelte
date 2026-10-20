<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * BtnRail — riel de BOTONES para Android: rejilla que ENVUELVE (3 columnas por
   * defecto, configurable con `columnas`).
   *
   * Reemplaza la fila con `overflow-x:auto` (scroll lateral): en un teléfono las
   * acciones de la derecha ni se veían. Con la rejilla se ven todas de entrada,
   * con la etiqueta recortada con elipsis en vez de forzar la columna a crecer.
   *
   * Con `compacto` el botón se apila (icono arriba, etiqueta abajo), pierde la
   * línea de detalle (`sub`) y reduce su tamaño: es lo que permite meter 4
   * botones en UNA sola fila (ver `NotasPage`).
   *
   * ⚠️ `:global(.btn-mod…)` porque `.btn-mod` es el nodo raíz de `BotonMod` y NO
   * lleva el hash de scope de la página que lo usa.
   *
   * ⚠️ Los botones deben ir SIN `compacto` (el prop de `BotonMod`): ese prop
   * inyecta `padding` en el `style` en línea y ganaría al padding reducido de
   * esta rejilla.
   */
  let {
    children,
    estilo = "",
    columnas = 3,
    compacto = false,
  }: {
    children: Snippet;
    estilo?: string;
    /** Columnas de la rejilla (por defecto 3). Con 4 entra en una sola fila. */
    columnas?: number;
    /**
     * Variante compacta (Asistencia/Notas en Android): botón apilado
     * (icono arriba, etiqueta abajo), SIN la línea de detalle (`sub`) y con
     * tipografía/padding reducidos. Es lo que permite meter 4 botones en una
     * sola fila en un teléfono.
     */
    compacto?: boolean;
  } = $props();
</script>

<div class="btn-rail" class:compacto style="--btn-cols:{columnas};{estilo}">{@render children()}</div>

<style>
  .btn-rail {
    display: grid;
    grid-template-columns: repeat(var(--btn-cols, 3), minmax(0, 1fr));
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
  /* Variante compacta: 4 botones en una sola fila. Se replica el lenguaje de
     `.android-actions.acc-grid` de AsistenciaPage (apilado, sin `sub`) para que
     ambas páginas se vean igual. */
  .btn-rail.compacto :global(.btn-mod) {
    flex-direction: column;
    justify-content: center;
    gap: 0.1rem;
    min-height: 36px;
    height: auto;
    padding: 0.28rem 0.2rem;
    border-radius: 9px;
    font-size: 0.62rem;
  }
  .btn-rail.compacto :global(.btn-mod .chip) {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    font-size: 0.7rem;
  }
  .btn-rail.compacto :global(.btn-mod .txt) {
    align-items: center;
  }
  .btn-rail.compacto :global(.btn-mod .sub) {
    display: none;
  }
</style>
