<script lang="ts">
  import AsistenciaPage from "../AsistenciaPage.svelte";
  import InformePage from "../InformePage.svelte";

  type SubTab = "tomar" | "informe";

  let {
    pageActive = false,
    subTabRequest = null as string | null,
  }: { pageActive?: boolean; subTabRequest?: string | null } = $props();

  // Siempre abre en "Tomar asistencia"; un subTabRequest (ej. quick-action del Dashboard)
  // puede abrir directamente el Informe.
  let activeSub: SubTab = $state("tomar");

  // Montaje perezoso: cada hijo se monta la primera vez que se visita y luego
  // queda oculto con display:none para preservar estado/drafts.
  let mountedRegistrar = $state(false);
  let mountedInforme = $state(false);

  // Peticiones externas + reset al entrar:
  // Cada vez que la página pasa de oculta a visible vuelve a "Tomar asistencia",
  // SALVO que exista una petición explícita de abrir el Informe
  // (ej. quick-action "Informe" del Dashboard).
  let wasPageActive = pageActive;
  $effect(() => {
    const pa = pageActive;
    const activated = pa && !wasPageActive;
    const req = subTabRequest;
    wasPageActive = pa;
    if (!pa) return;
    if (req === "informe") activeSub = "informe";
    else if (activated) activeSub = "tomar";
  });

  // Montaje perezoso según el sub-tab activo
  $effect(() => {
    if (activeSub === "tomar") mountedRegistrar = true;
    else mountedInforme = true;
  });

  function switchTo(tab: SubTab) {
    activeSub = tab;
  }
</script>

<div class="asistencia-main" style="height:100%;min-height:0">
  <div class="asistencia-subtabs">
    <button class="subtab-btn" class:active={activeSub === 'tomar'} onclick={() => switchTo('tomar')} type="button">
      <span class="subtab-icon">✏️</span>
      <span>Tomar asistencia</span>
    </button>
    <button class="subtab-btn" class:active={activeSub === 'informe'} onclick={() => switchTo('informe')} type="button">
      <span class="subtab-icon">📊</span>
      <span>Informe</span>
    </button>
  </div>

  <div style="flex:1;min-height:0;position:relative">
    {#if mountedRegistrar}
      <div style="display:{activeSub === 'tomar' ? 'block' : 'none'};height:100%">
        <AsistenciaPage visible={pageActive && activeSub === 'tomar'} />
      </div>
    {/if}
    {#if mountedInforme}
      <div style="display:{activeSub === 'informe' ? 'block' : 'none'};height:100%">
        <InformePage visible={pageActive && activeSub === 'informe'} />
      </div>
    {/if}
  </div>
</div>

<style>
  .asistencia-main {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .asistencia-subtabs {
    display: flex;
    gap: 4px;
    padding: 0.45rem 0.5rem;
    margin: 0.25rem 0.5rem 0;
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    width: fit-content;
  }
  .subtab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0.42rem 0.9rem;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: #94a3b8;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
  }
  .subtab-btn:hover:not(.active) {
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.05);
  }
  .subtab-btn:active:not(.active) {
    transform: scale(0.97);
  }
  .subtab-btn.active {
    background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.18), rgba(var(--primary-rgb), 0.06));
    border-color: rgba(var(--primary-rgb), 0.35);
    color: #f1f5f9;
    box-shadow: 0 2px 10px rgba(var(--primary-rgb), 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .subtab-btn:focus-visible {
    outline: none;
    border-color: rgba(148, 163, 184, 0.4);
  }
  .subtab-icon {
    font-size: 0.85rem;
    line-height: 1;
  }
  @media (max-width: 480px) {
    .subtab-btn span:last-child {
      font-size: 0.72rem;
    }
    .subtab-btn {
      padding: 0.38rem 0.65rem;
    }
  }
</style>
