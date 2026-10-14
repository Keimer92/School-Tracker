<script lang="ts">
  /**
   * ModalBase — reusable glass modal shell (title + close button).
   *
   * Wraps overlay + card and leaves the content to the caller via the
   * `children` snippet. It backs `ModalNubeD1` and `ModalNubeDrive` (the two
   * panels that replaced CloudPage) and is the shell to reuse for any future
   * modal in the app.
   *
   * Decisions that matter:
   *  · `use:portalToBody`: `.modal-overlay` is `position: fixed` and uses
   *    `backdrop-filter`. Inside a container with `transform`/`backdrop-filter`
   *    (the glass rail panels, the sidebar) it would be confined to that ancestor
   *    and end up off-centre. See AGENTS.md → `position: fixed` gotcha.
   *  · `onpointerdown` + `e.target === e.currentTarget` to close on backdrop
   *    tap: on Android a `<select>` is a native popup that re-dispatches a
   *    synthetic `click` on whatever is under it, closing the modal without a
   *    selection ever being made (gotcha in AGENTS.md → unified modals).
   *  · `registerBackHandler`: the Android back button and the desktop Escape key
   *    both go through `handleBack()`, so registering here makes the modal close
   *    on either without extra code.
   */
  import type { Snippet } from 'svelte';
  import { portalToBody } from '../../lib/portalToBody';
  import { registerBackHandler } from '../../lib/androidBack';
  import { t } from '../../lib/i18n.svelte';

  let {
    abierto = false,
    titulo,
    subtitulo = '',
    onCerrar,
    ancho = '520px',
    anchoMaximo = ancho,
    ajustarAltura = false,
    children,
  }: {
    /** Nothing is rendered while this is `false`. */
    abierto: boolean;
    titulo: string;
    /** Dimmed text next to the title (e.g. "(bilateral sync)"). */
    subtitulo?: string;
    onCerrar: () => void;
    ancho?: string;
    /**
     * Techo del ancho, por si el panel necesita tomar todo el disponible sin
     * dejar de ser usable en un monitor grande. Por defecto igual a `ancho`.
     */
    anchoMaximo?: string;
    /**
     * El panel crece hasta llenar la ALTURA de la pantalla en vez de usar el
     * `max-height` fijo del cuerpo. Para paneles largos (el de Drive, con su
     * lista de respaldos) evita el scroll anidado: la card se estira y el
     * contenido que no entra scrollea adentro, pero el recuadro ya ocupa toda la
     * pantalla y no queda un borde de página asomando debajo.
     */
    ajustarAltura?: boolean;
    children: Snippet;
  } = $props();

  // Android back / desktop Escape: closes this modal and consumes the event
  // (`true`). The effect unregisters itself when the modal goes away.
  $effect(() => {
    if (!abierto) return;
    return registerBackHandler(() => { onCerrar(); return true; });
  });
</script>

{#if abierto}
  <div
    class="modal-overlay"
    use:portalToBody
    onpointerdown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
    role="presentation"
  >
    <div class="modal-content mb-card" class:mb-alto={ajustarAltura}
      style="max-width: {anchoMaximo}; width: 100%;">
      <div class="mb-head">
        <div class="mb-titulos">
          <h3 class="mb-titulo">{titulo}</h3>
          {#if subtitulo}<span class="mb-sub">{subtitulo}</span>{/if}
        </div>
        <button class="mb-x" onclick={onCerrar} aria-label={t('comun.cerrar')} type="button">✕</button>
      </div>
      <div class="mb-cuerpo">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .mb-card {
    /* Fondo PROPIO y opaco, no `--card-bg`.
       Ese token es el glass de las cards de la app (alfa 0.6 en oscuro) y para
       un modal queda demasiado transparente: se ve el contenido de la página
       detrás del texto y los valores de Drive/Cloudflare se leen con ruido. Un
       modal va POR ENCIMA de todo lo demás, así que necesita contraste propio.

       Se mantiene `backdrop-filter` por el borde y las esquinas redondeadas, pero
       ya no tiene que cargar con la legibilidad.

       El tema claro lo sobrescribe con `:global()` más abajo. */
    background: linear-gradient(180deg, #1b222d 0%, #12161d 100%);
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.7);
    overflow: hidden;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
  }

  /* `:global()` porque la clase viene de este scope pero el atributo
     `data-theme` vive en `<html>`: sin global, el selector no llegaría. */
  :global(:root[data-theme="light"]) .mb-card {
    background: linear-gradient(180deg, #ffffff 0%, #f4f5f7 100%);
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.28);
  }

  .mb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1.1rem 1.25rem 0.9rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .mb-titulos {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .mb-titulo {
    margin: 0;
    color: var(--text-primary);
    font-size: 1.05rem;
    font-weight: 700;
  }

  .mb-sub {
    font-size: 0.65rem;
    color: #64748b;
  }

  .mb-x {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #cbd5e1;
    font-size: 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .mb-x:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #f1f5f9;
  }

  .mb-cuerpo {
    padding: 1.1rem 1.25rem 1.25rem;
    max-height: min(70vh, 640px);
    overflow-y: auto;
  }

  /*
    Modo "ajustar altura" (Drive): la card es una columna flex de altura completa
    dentro del viewport y el cuerpo scrollea.

    `flex: 1 1 auto` + `min-height: 0` en el cuerpo es el detalle que hace que
    funcione: sin `min-height: 0`, un hijo flex no baja de su altura intrínseca y
    el `overflow-y: auto` no kicks, dejando que la card crezca fuera de pantalla.
    El `-8px` del padding inferior es para no quedarle hueco abajo cuando el
    contenido es corto.
  */
  .mb-card.mb-alto {
    max-height: calc(100dvh - 2rem);
    display: flex;
    flex-direction: column;
  }
  .mb-card.mb-alto .mb-head { flex-shrink: 0; }
  .mb-card.mb-alto .mb-cuerpo {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* Con el panel al alto completo el padding lateral estorba más que ayuda:
     en un teléfono angosto se pierde ancho útil para el contenido. */
  @media (max-width: 600px) {
    .mb-card.mb-alto { max-height: calc(100dvh - 1rem); }
    .mb-card.mb-alto .mb-cuerpo { padding: 0.85rem 0.85rem 1rem; }
  }

  /* On narrow screens the overlay already provides the padding; the card must
     not add more, otherwise the content column gets too narrow. */
  @media (max-width: 600px) {
    .mb-cuerpo { padding: 0.9rem 1rem 1.1rem; }
  }
</style>