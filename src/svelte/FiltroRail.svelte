<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * FiltroRail — riel de filtros INLINE para Android.
   *
   * Es el patrón que reemplazó a los modales de filtros (`FiltersModalAndroid`) en
   * `NotasPage` y que ahora comparten Asistencia y Estudiantes: los `<select>` de
   * catálogo viven en la propia página, sin el rodeo Filtros → elegir → Aplicar.
   *
   * En el WebView de Android un `<select>` abre el popup NATIVO del sistema, así
   * que sacarlos del modal no reintroduce el bug del "cierre fantasma" (ese bug
   * era del overlay del modal, no del select).
   *
   * ⚠️ El riel es una REJILLA QUE ENVUELVE (`display:grid` +
   * `repeat(auto-fit,minmax(84px,1fr))`), NO un `flex` de una fila con
   * `overflow-x`. Con scroll lateral en un teléfono de 360px solo quedaban ~3 de
   * los 7 filtros a la vista: los de la derecha existían pero no se descubrían.
   *
   * Los hijos se pasan como snippet, así que el CSS de los `<select>` va con
   * `:global(...)`: el nodo lo acuña el PADRE, no este componente.
   */
  let {
    children,
    estilo = "",
  }: { children: Snippet; estilo?: string } = $props();
</script>

<div class="filtro-rail" style={estilo}>{@render children()}</div>

<style>
  .filtro-rail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
    gap: 0.3rem;
  }
  .filtro-rail :global(select) {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 1.35rem 0 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    border-radius: 8px;
    background-color: #0f172a;
    border: 1px solid rgba(148, 163, 184, 0.35);
    color: #f1f5f9;
    appearance: none;
    -webkit-appearance: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 0.35rem center;
    background-size: 12px;
  }
  .filtro-rail :global(select:focus) {
    border-color: var(--primary-color);
    outline: none;
  }
  .filtro-rail :global(select option),
  .filtro-rail :global(select optgroup) {
    background: #0f172a;
    color: #f1f5f9;
  }
</style>
