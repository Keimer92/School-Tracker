<script lang="ts">
  import { tick } from 'svelte';
  import { registerBackHandler } from '../lib/androidBack';

  /**
   * Buscador de estudiantes — barra en el FLUJO, arriba del contenido.
   *
   * Antes era un FAB flotante en la esquina inferior derecha. Se cambió por dos
   * razones: tapaba la última fila de la tabla y, al ser `position: fixed`
   * (por necessity de no alterar el layout), cualquier barra nueva arriba
   * quedaba tapada o la tapaba a ella.
   *
   * Ahora es un input normal que ocupa su propia línea arriba del contenido,
   * igual que el buscador de Android: sin `fixed`, sin `z-index` y sin overlay,
   * así que no puede pisar nada.
   *
   * Uso: <SearchFab bind:value={searchTerm} placeholder="Buscar..." />
   */

  let {
    value = $bindable(''),
    placeholder = 'Buscar...',
  }: { value?: string; placeholder?: string } = $props();

  let inputEl: HTMLInputElement | null = $state(null);

  /** Enfoca el input. Lo usan los atajos externos. */
  export function abrir() {
    tick().then(() => inputEl?.focus());
  }

  export function cerrar() {
    inputEl?.blur();
  }

  function limpiar() {
    value = '';
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Escape primero borra lo escrito; si ya estaba vacío, solo suelta el foco.
      if (value) limpiar();
      else cerrar();
    }
  }

  // Android Back: si quedó texto escrito, lo borra en vez de cerrar la pantalla.
  $effect(() => {
    if (!value) return;
    return registerBackHandler(() => { limpiar(); return true; });
  });
</script>

<!-- `no-print`: el CSS de impresión de ReportesPage oculta `button`, pero esta
     barra es un `div` con un `input`. Sin esta clase se imprimiría el buscador
     con el texto de búsqueda arriba del reporte. -->
<div class="sfab-bar no-print" role="search">
  <span class="sfab-icon" aria-hidden="true">🔍</span>
  <input
    bind:this={inputEl}
    bind:value
    {placeholder}
    class="sfab-input"
    type="search"
    enterkeyhint="search"
    autocomplete="off"
    onkeydown={onKeydown}
  />
  {#if value}
    <!-- Escoba: el icono que se pidió para "borrar el texto escrito". Antes
         era una ✕, que se confunde con el botón de cerrar. -->
    <button class="sfab-clear" onclick={limpiar} title="Borrar texto escrito" aria-label="Borrar texto escrito">
      🧹
    </button>
  {/if}
</div>

<style>
  /* Barra en el flujo: es un hermano más del contenido, no un overlay.
     `align-self: stretch` + `max-width` la alinean con el ancho de las cards
     sin salirse de la caja flexible del padre. */
  .sfab-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    max-width: 420px;
    height: 38px;
    box-sizing: border-box;
    padding: 0 0.45rem 0 0.8rem;
    margin: 0 0 0.5rem;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: border-color 0.2s ease, background 0.2s ease;
  }
  .sfab-bar:focus-within {
    border-color: var(--primary-color, #3b82f6);
    background: rgba(255, 255, 255, 0.08);
  }

  .sfab-icon { font-size: 0.9rem; flex-shrink: 0; opacity: 0.7; }

  .sfab-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 0.82rem;
    font-family: inherit;
    height: 100%;
  }
  .sfab-input::placeholder { color: #64748b; }
  /* `type="search"` pinta una ✕ propia del navegador (WebView) que
     duplicaría la escoba. */
  .sfab-input::-webkit-search-cancel-button,
  .sfab-input::-webkit-search-decoration { -webkit-appearance: none; appearance: none; display: none; }

  .sfab-clear {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sfab-clear:hover { background: rgba(255, 255, 255, 0.1); }
  .sfab-clear:active { transform: scale(0.9); }
  .sfab-clear:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }

  @media (max-width: 640px) {
    .sfab-bar { max-width: none; }
  }
</style>