<script lang="ts">
  import { tonoBoton, type Tono } from "../lib/botones";

  let { opts, ref = $bindable(null) }: {
    opts: {
      onclick: () => void;
      disabled?: boolean;
      icono: string;
      etiqueta: string;
      sub?: string;
      tono: Tono;
      title?: string;
      compacto?: boolean;
    };
    /**
     * Referencia al <button> real. Necesaria cuando el consumidor ancla un
     * popover a su botón: `onclick` no recibe el evento, así que sin esto no
     * habría forma de conocer la posición en pantalla.
     * `$bindable` es obligatorio: sin él la asignación de `bind:this` se
     * descarta en silencio y el anclaje cae a (0,0).
     */
    ref?: HTMLElement | null;
  } = $props();
</script>

<!--
  Botón glass "moderno e informativo": gradiente translúcido con backdrop-filter,
  borde del color de acento, icono en chip y etiqueta de dos líneas (acción +
  dato útil del estado actual). `compacto` aprieta el padding para las barras
  horizontales de móvil.
-->
<button
  type="button"
  class="btn-mod"
  bind:this={ref}
  onclick={opts.onclick}
  disabled={opts.disabled ?? false}
  title={opts.title ?? ''}
  style={tonoBoton(opts.tono) + (opts.compacto ? ';padding:0 0.55rem' : '')}
>
  <span class="chip">{opts.icono}</span>
  <span class="txt">
    <span>{opts.etiqueta}</span>
    {#if opts.sub}<span class="sub">{opts.sub}</span>{/if}
  </span>
</button>
