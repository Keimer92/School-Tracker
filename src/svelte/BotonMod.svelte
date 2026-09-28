<script lang="ts">
  import { tonoBoton, type Tono } from "../lib/botones";

  let { opts }: {
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
