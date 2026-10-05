<script lang="ts">
  /**
   * Selector de navegador para el login de Google.
   *
   * Vive en un componente propio (y no dentro de AjustesPage) por una razón
   * concreta: **el login arranca en el WelcomePage, que se ve ANTES de poder
   * entrar a Ajustes**. Con el selector solo en Ajustes, el usuario que suffer
   * el problema de Edge no tiene forma de cambiarlo nunca, porque justamente
   * no puede pasar el WelcomePage. Por eso se muestra en los dos lugares:
   * la portada (compacta) y Ajustes → General (con la nota de Windows).
   *
   * Además muestra la ruta exacta del ejecutable que se va a usar: sin eso el
   * usuario no tiene forma de saber si la preferencia se aplicó o si el
   * navegador elegido no está instalado.
   */
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    OPCIONES_NAVEGADOR,
    getNavegadorLogin,
    setNavegadorLogin,
    type NavegadorLogin,
  } from "../lib/oauthBrowser";
  import { t } from "../lib/i18n.svelte";

  /** `compact` = una línea desplegable (portada). `completo` = card con nota. */
  let { compacto = false }: { compacto?: boolean } = $props();

  /** Los nombres de los navegadores se traducen como claves `nav.*`: el
   *  "Firefox" / "Google Chrome" son marcas y no cambian, pero "Predeterminado
   *  del sistema" sí. El mapa evita hacer `t()` dynamico con un string libre. */
  const CLAVE_I18N: Record<string, Parameters<typeof t>[0]> = {
    default: 'nav.default',
    firefox: 'nav.firefox',
    chrome: 'nav.chrome',
    edge: 'nav.edge',
    brave: 'nav.brave',
  };

  let elegido = $state<NavegadorLogin>(getNavegadorLogin());
  let expandido = $state(false);
  /** Ruta del ejecutable que Rust resolvió, o '' si no lo encontró. */
  let rutaResuelta = $state<string>('');

  async function resolver() {
    try {
      rutaResuelta = await invoke<string>('gd_resolve_browser', { browser: elegido });
    } catch {
      rutaResuelta = '';
    }
  }

  function elegir(id: NavegadorLogin) {
    elegido = id;
    setNavegadorLogin(id);
    void resolver();
  }

  const etiqueta = $derived(
    OPCIONES_NAVEGADOR.find((o) => o.id === elegido)
      ? t(CLAVE_I18N[OPCIONES_NAVEGADOR.find((o) => o.id === elegido)!.id])
      : t("nav.default")
  );

  onMount(resolver);
</script>

{#if compacto}
  <!-- Portada del Welcome: una sola línea, desplegable. No compite con las
       tarjetas de entrada, que es lo que el usuario tiene que ver primero. -->
  <div class="nav-picker-compact">
    <button
      class="nav-toggle"
      onclick={() => (expandido = !expandido)}
      title="Con qué navegador se abre el inicio de sesión con Google"
    >
      <span>🌐 {t("nav.compacto", { nombre: etiqueta })}</span>
      <span class="nav-caret" class:abierto={expandido}>▾</span>
    </button>
    {#if expandido}
      <div class="nav-chips">
        {#each OPCIONES_NAVEGADOR as op (op.id)}
          <button class="nav-chip" class:activo={elegido === op.id} onclick={() => elegir(op.id)}>
            {t(CLAVE_I18N[op.id])}
          </button>
        {/each}
        <p class="nav-nota">
          {#if elegido === 'default'}
            {t("nav.usaraSistema")}
          {:else if rutaResuelta}
            {t("nav.seAbrira", { ruta: rutaResuelta })}
          {:else}
            {t("nav.noEncontrado")}
          {/if}
        </p>
      </div>
    {/if}
  </div>
{:else}
  <div class="nav-picker-full">
    <div class="nav-chips">
      {#each OPCIONES_NAVEGADOR as op (op.id)}
        <button class="nav-chip" class:activo={elegido === op.id} onclick={() => elegir(op.id)}>
          {t(CLAVE_I18N[op.id])}
        </button>
      {/each}
    </div>
    {#if elegido !== 'default'}
      <p class="nav-nota">
        {#if rutaResuelta}
          {t("nav.seAbrira", { ruta: rutaResuelta })}
        {:else}
          ⚠️ {t("nav.noEncontrado")}
        {/if}
      </p>
    {:else}
      <p class="nav-nota">
        {t("nav.notaWindows", { http: 'http', https: 'https' })}
      </p>
    {/if}
  </div>
{/if}

<style>
  .nav-picker-compact {
    margin-top: 1.1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }
  .nav-picker-full {
    margin-top: 1rem;
  }

  .nav-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 600;
    /* glassmorphism, igual que el resto de la portada */
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94a3b8;
    backdrop-filter: blur(10px);
    transition: all 0.2s ease;
  }
  .nav-toggle:hover {
    border-color: rgba(96, 165, 250, 0.45);
    color: #e2e8f0;
  }
  .nav-caret {
    display: inline-block;
    transition: transform 0.2s ease;
    font-size: 0.7rem;
  }
  .nav-caret.abierto {
    transform: rotate(180deg);
  }

  .nav-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    /* En la portada los chips se centran; en Ajustes arrancan a la izquierda. */
    justify-content: inherit;
  }
  .nav-picker-compact .nav-chips {
    justify-content: center;
    max-width: 460px;
  }

  .nav-chip {
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
  .nav-chip:hover {
    border-color: rgba(96, 165, 250, 0.45);
    color: #e2e8f0;
  }
  .nav-chip.activo {
    background: rgba(96, 165, 250, 0.22);
    border-color: rgba(96, 165, 250, 0.7);
    color: #bfdbfe;
    box-shadow: 0 2px 10px rgba(96, 165, 250, 0.18);
  }

  .nav-nota {
    margin: 0.85rem 0 0 0;
    color: #64748b;
    font-size: 0.75rem;
    line-height: 1.55;
    text-align: inherit;
  }
  .nav-picker-compact .nav-nota {
    text-align: center;
  }
  .nav-nota code {
    font-size: 0.72rem;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    padding: 0.05rem 0.3rem;
    color: #94a3b8;
    word-break: break-all;
  }
  /* La ruta del ejecutable viene dentro de un parametro `{ruta}`, no en su
     propio `<code>`: si se rompe el texto en varios <code>, la traduccion deja
     de ser una interpolacion simple. Se resalta con un `::first-line` no, asi
     que se resuelve deixando que el break-word haga su trabajo. */
</style>
