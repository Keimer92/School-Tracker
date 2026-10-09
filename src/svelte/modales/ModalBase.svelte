<script lang="ts">
  /**
   * ModalBase — caparazón de modal reusable (glass, con título y botón ✕).
   *
   * Envuelve overlays + contenido y deja el contenido a cargo del llamador vía
   * el snippet `children`. Lo usan `ModalNubeD1` y `ModalNubeDrive` (los dos
   * panels que reemplazaron a CloudPage) y sirve para cualquier modal futuro
   * del sistema sin reescribir el marco.
   *
   * Decisiones que importan:
   *  · `use:portalToBody`: `.modal-overlay` es `position: fixed` y tiene
   *    `backdrop-filter`; dentro de un contenedor con `transform` o
   *    `backdrop-filter` (los paneles glass del rail, la sidebar) quedaría
   *    confinado al ancestro y descentrado. Ver AGENTS.md → `position: fixed`.
   *  · `onpointerdown` + `e.target === e.currentTarget` para cerrar con el
   *    fondo: en Android el `<select>` es un popup nativo que re-despacha un
   *    `click` sintético sobre el fondo y cerraría el modal sin elegir nada
   *    (GOTCHA documentado en AGENTS.md → modales unificados).
   *  · `registerBackHandler`: la pila de back de Android y la tecla Escape
   *    global de escritorio pasan por `handleBack()`, así que con esto el modal
   *    se cierra con el botón físico y con Escape sin código extra.
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
    children,
  }: {
    /** Mientras sea `false` no se renderiza nada. */
    abierto: boolean;
    titulo: string;
    /** Texto atenuado al lado del título (ej. "(Sincronización bilateral)"). */
    subtitulo?: string;
    onCerrar: () => void;
    ancho?: string;
    children: Snippet;
  } = $props();

  // Back de Android / Escape de escritorio: cierra este modal y consume el
  // evento (`true`). Al desmontarse el efecto se desregistra solo.
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
    <div class="modal-content mb-card" style="max-width: {ancho}; width: 100%;">
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
    background: var(--card-bg);
    border-radius: 20px;
    border: 1px solid var(--card-border);
    overflow: hidden;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
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

  /* En pantallas angostas el modal ocupa todo el ancho útil sin márgenes
     grandes: el overlay ya pone padding y el card no necesita más. */
  @media (max-width: 600px) {
    .mb-cuerpo { padding: 0.9rem 1rem 1.1rem; }
  }
</style>