<script lang="ts">
  /**
   * Selector de idioma (Español / English).
   *
   * Va en los MISMOS dos lugares que `BrowserPicker` (WelcomePage y Ajustes):
   * el idioma hay que poder elegirlo ANTES de entrar a la app, y si la única
   * entrada viviera en Ajustes el usuario no podría cambiarlo en el primer
   * arranque, que es justo cuando más lo necesita.
   *
   * El estado vive en `i18n.svelte.ts` (rune `$state`), así que cambiar el
   * idioma re-renderiza TODA la app sin que este componente tenga que
   // suscribirse ni emitir nada.
   */
  import { LOCALES, getLocale, setLocale, t } from "../lib/i18n.svelte";

  let { compacto = false }: { compacto?: boolean } = $props();

  let expandido = $state(false);
  const actual = $derived(getLocale());

  /** Las etiquetas se traducen con `t()`, no con `ETIQUETAS`: así el selector
   *  se lee en el idioma activo y el usuario reconoce el suyo. */
  const opciones = $derived(
    LOCALES.map((o) => ({ ...o, label: t(o.id === 'es' ? 'idioma.es' : 'idioma.en') }))
  );
</script>

{#if compacto}
  <div class="lang-picker-compact">
    <button class="lang-toggle" onclick={() => (expandido = !expandido)} title={t('idioma.titulo')}>
      <span>🌐 {t('idioma.titulo')}: {actual === 'es' ? 'Español' : 'English'}</span>
      <span class="lang-caret" class:abierto={expandido}>▾</span>
    </button>
    {#if expandido}
      <div class="lang-chips">
        {#each opciones as o (o.id)}
          <button class="lang-chip" class:activo={actual === o.id} onclick={() => setLocale(o.id)}>
            {o.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="lang-picker-full">
    <div class="lang-chips">
      {#each opciones as o (o.id)}
        <button class="lang-chip" class:activo={actual === o.id} onclick={() => setLocale(o.id)}>
          {o.label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .lang-picker-compact {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }
  .lang-picker-full {
    margin-top: 0.9rem;
  }

  .lang-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94a3b8;
    backdrop-filter: blur(10px);
    transition: all 0.2s ease;
  }
  .lang-toggle:hover {
    border-color: rgba(96, 165, 250, 0.45);
    color: #e2e8f0;
  }
  .lang-caret {
    display: inline-block;
    transition: transform 0.2s ease;
    font-size: 0.7rem;
  }
  .lang-caret.abierto {
    transform: rotate(180deg);
  }

  .lang-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .lang-picker-compact .lang-chips {
    justify-content: center;
  }

  .lang-chip {
    padding: 0.5rem 0.95rem;
    border-radius: 10px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    transition: all 0.2s ease;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94a3b8;
  }
  .lang-chip:hover {
    border-color: rgba(96, 165, 250, 0.45);
    color: #e2e8f0;
  }
  .lang-chip.activo {
    background: rgba(96, 165, 250, 0.22);
    border-color: rgba(96, 165, 250, 0.7);
    color: #bfdbfe;
    box-shadow: 0 2px 10px rgba(96, 165, 250, 0.18);
  }
</style>
