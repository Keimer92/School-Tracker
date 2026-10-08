<script lang="ts">
  /**
   * Selector de idioma (Español / English). Dos modos:
   *
   *  - `flotante`: botón 🌐 fijo en la esquina con un popover. Es el que usa
   *    WelcomePage: aparece en TODAS las vistas (portada, asistente, nube) y
   *    en TODAS las plataformas, incluida Android.
   *  - completo (sin props): chips siempre visibles, para Ajustes.
   *
   * Va en los MISMOS dos lugares que `BrowserPicker` (WelcomePage y Ajustes):
   * el idioma hay que poder elegirlo ANTES de entrar a la app, y si la única
   * entrada viviera en Ajustes el usuario no podría cambiarlo en el primer
   * arranque, que es justo cuando más lo necesita.
   *
   * El estado vive en `i18n.svelte.ts` (rune `$state`), así que cambiar el
   * idioma re-renderiza TODA la app sin que este componente tenga que
   * suscribirse ni emitir nada.
   */
  import { LOCALES, getLocale, setLocale, t } from "../lib/i18n.svelte";

  let { flotante = false }: { flotante?: boolean } = $props();

  let expandido = $state(false);
  const actual = $derived(getLocale());

  /** Las etiquetas se traducen con `t()`, no con `ETIQUETAS`: así el selector
   *  se lee en el idioma activo y el usuario reconoce el suyo. */
  const opciones = $derived(
    LOCALES.map((o) => ({ ...o, label: t(o.id === 'es' ? 'idioma.es' : 'idioma.en') }))
  );

  // Cerrar el popover al tocar afuera o con Escape. Solo mientras esté abierto,
  // así no hay listener huérfano cuando está cerrado.
  $effect(() => {
    if (!expandido || !flotante) return;
    const fuera = (ev: PointerEvent) => {
      // `nodo` y no `t`: el nombre `t` taparía la función de traducción `t()`.
      // `closest` vive en `Element`, no en `Node`, por eso el `instanceof`.
      const nodo = ev.target;
      if (nodo instanceof Element && nodo.closest('.lang-float')) return;
      expandido = false;
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') expandido = false; };
    document.addEventListener('pointerdown', fuera, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fuera, true);
      document.removeEventListener('keydown', esc);
    };
  });
</script>

{#if flotante}
  <!-- El botón va con `position: fixed` (ver la nota en el CSS): así queda
       anclado aunque la vista haga scroll. El popover es `absolute` contra
       `.lang-float`, que ya es el bloque contenedor. -->
  <div class="lang-float">
    <button
      class="lang-float-btn"
      class:abierto={expandido}
      onclick={() => (expandido = !expandido)}
      title={t('idioma.titulo')}
      aria-label={t('idioma.titulo')}
      aria-expanded={expandido}
    >
      🌐
    </button>
    {#if expandido}
      <div class="lang-popover" role="dialog" aria-label={t('idioma.titulo')}>
        <div class="lang-pop-head">
          <span class="lang-pop-ico">🌐</span>
          <span>{t('idioma.titulo')}</span>
        </div>
        <div class="lang-pop-list">
          {#each opciones as o (o.id)}
            <button
              class="lang-pop-item"
              class:activo={actual === o.id}
              onclick={() => { setLocale(o.id); expandido = false; }}
            >
              <span class="lang-pop-check">{actual === o.id ? '✓' : ''}</span>
              <span>{o.label}</span>
            </button>
          {/each}
        </div>
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
  /* ── Modo flotante (popover) ─────────────────────────────────────────── */
  /* `fixed` y NO `absolute`: `.welcome-page` tiene `overflow-y:auto`, así que
     con `absolute` el botón se iría con el scroll del asistente.
     Es seguro porque NINGÚN ancestro tiene `transform` ni `backdrop-filter`
     (`.app-layout` es grid/flex puro y `.welcome-page` solo pinta fondo): si
     alguno lo tuviera se volvería bloque contenedor y el popover se confinaría
     (GOTCHA de AGENTS.md). Aun así la degradación sería benigna, porque
     `.app-layout` ocupa todo el viewport.
     El `fixed` NO lo recorta el `overflow` de `.welcome-page`: ese overflow
     solo recorta a sus descendientes cuyo bloque contenedor está en la cadena,
     y acá el bloque contenedor es la ventana. */
  .lang-float {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 60;
  }

  .lang-float-btn {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #cbd5e1;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    transition: all 0.2s ease;
  }
  .lang-float-btn:hover,
  .lang-float-btn.abierto {
    border-color: rgba(96, 165, 250, 0.55);
    background: rgba(96, 165, 250, 0.16);
    color: #bfdbfe;
  }

  .lang-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 168px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(20, 24, 31, 0.92);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 18px 44px -12px rgba(0, 0, 0, 0.6);
    animation: langPop 0.14s ease-out;
  }
  @keyframes langPop {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .lang-pop-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 8px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #64748b;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    margin-bottom: 6px;
  }
  .lang-pop-ico { font-size: 0.75rem; }

  .lang-pop-list { display: flex; flex-direction: column; gap: 3px; }

  .lang-pop-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 9px;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 600;
    text-align: left;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid transparent;
    color: #94a3b8;
    transition: all 0.18s ease;
  }
  .lang-pop-item:hover {
    background: rgba(255, 255, 255, 0.07);
    color: #e2e8f0;
  }
  .lang-pop-item.activo {
    background: rgba(96, 165, 250, 0.2);
    border-color: rgba(96, 165, 250, 0.55);
    color: #bfdbfe;
  }

  .lang-pop-check {
    width: 12px;
    font-size: 0.75rem;
    color: #60a5fa;
    flex-shrink: 0;
  }

  /* En móvil, más holgado para el dedo. */
  @media (max-width: 600px) {
    .lang-float { top: 0.6rem; right: 0.6rem; }
    .lang-float-btn { width: 42px; height: 42px; }
    .lang-pop-item { padding: 11px 12px; font-size: 0.9rem; }
  }

  /* ── Modo completo (chips siempre visibles, para Ajustes) ────────────── */
  .lang-picker-full {
    margin-top: 0.9rem;
  }

  .lang-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
