<script lang="ts">
  /**
   * FiltersModalAndroid
   *
   * Modal sólido (no glassmorphism) con los filtros de catálogo de cualquier
   * página. En Android el modal reemplaza los selects inline para ahorrar
   * espacio vertical. Los dropdowns de Período y los selectores concretos de
   * fecha (DatePicker / popover semana / selects Mes+Año) NO se incluyen
   * aquí: esos quedan en la barra de filtros principal porque cambian el
   * contenido principal de la página.
   *
   * El modal expone slots con `let:` para que el padre inyecte filtros
   * opcionales (ej. Semana, Mes/Año) si los necesita.
   *
   * Eventos:
   *   close → el usuario cerró el modal
   */
  import FilterGroup from './FilterGroup.svelte';
  import { t } from '../lib/i18n.svelte';

  interface CategoryItem { id: number; nombre: string; }

  let {
    open = $bindable(false),
    isAndroidMobile = false,
    isMobile = false,
    title = '🔍 Filtros',

    // Selects de catálogo (bindable para que el padre vea los cambios
    // y los $effect de cascada —fetchGrados, fetchSecciones— se disparen)
    anos = $bindable([] as CategoryItem[]),
    colegios = $bindable([] as CategoryItem[]),
    grados = $bindable([] as CategoryItem[]),
    secciones = $bindable([] as CategoryItem[]),
    selectedAno = $bindable(0),
    selectedColegio = $bindable(0),
    selectedGrado = $bindable(0),
    selectedSeccion = $bindable(0),
    selectedSexo = $bindable(''),

    // Slots extra (ej. Período, Semana, Mes/Año)
    extras,
    showAno = true,
  }: {
    open: boolean;
    isAndroidMobile: boolean;
    isMobile: boolean;
    title?: string;
    anos: CategoryItem[];
    colegios: CategoryItem[];
    grados: CategoryItem[];
    secciones: CategoryItem[];
    selectedAno: number;
    selectedColegio: number;
    selectedGrado: number;
    selectedSeccion: number;
    selectedSexo: string;
    extras?: import('svelte').Snippet;
    showAno?: boolean;
  } = $props();

  // Dentro del modal siempre mostramos labels (hay espacio) y usamos
  // altura/separación consistentes, independientemente de isMobile.
  const modalSelectStyle = 'height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px';

  /**
   * Cierre por toque en el fondo. Dos defensas, y las dos hacen falta:
   *
   * 1. `pointerdown`, NO `click`. En el WebView de Android el `<select>` se
   *    pinta como un popup NATIVO del sistema (ventana aparte). Cuando el
   *    usuario elige una opción y ese popup se cierra, el WebView re-despacha
   *    un evento sintético sobre lo que hay en esas coordenadas, y su target
   *    ya no es el `<select>`: cae en el fondo del modal. Ese sintético es un
   *    `click` (el `pointerdown` ocurrió ANTES de que se abriera el popup), así
   *    que escuchando `pointerdown` el evento fantasma nunca llega. Con
   *    `onclick={close}` a secas el modal se cerraba solo al tocar cualquier
   *    desplegable de Período.
   * 2. `e.target === e.currentTarget`: solo cierra si el toque es
   *    DIRECTAMENTE sobre el fondo. Un toque que venga de un hijo (select,
   *    botón, scroll) tiene otro target y no debe cerrar. Es el mismo patrón
   *    que usa el popover de semana en `AsistenciaPage.svelte` (línea ~1991).
   */
  function cerrarEnFondo(e: PointerEvent) {
    if (e.target === e.currentTarget) close();
  }

  function close() { open = false; }

  // `$derived`, no el default del prop: el default se evalúa una sola vez al
  // crear el componente y con el idioma cambiado quedaría el título viejo.
  // Ningún consumidor pasa `title` hoy, así que este derived es el que manda.
  const titulo = $derived(title || t('est.filtros.titulo'));
</script>

{#if open && isAndroidMobile}
  <div class="modal-overlay" onpointerdown={cerrarEnFondo} style="z-index:2000">
    <div class="modal-content filters-solid"
      style="width:min(380px, calc(100vw - 32px));max-width:min(380px, calc(100vw - 32px));max-height:85vh;overflow-y:auto;padding:1rem;text-align:left;position:relative">
      <button type="button" onclick={close} title={t('est.filtros.cerrar')}
        style="position:absolute;top:.5rem;right:.5rem;width:28px;height:28px;border-radius:7px;border:1px solid rgba(255,255,255,.2);background:#1e293b;color:#e2e8f0;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
      <h3 style="margin:0 0 .75rem;color:#f1f5f9;font-size:1rem;padding-right:2rem">{titulo}</h3>
      <div class="filters-grid">
        {#if showAno && anos.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('est.filtro.ano')}</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              bind:value={selectedAno}>
              {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        {#if colegios.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('est.filtro.colegio')}</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              bind:value={selectedColegio}>
              {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        {#if grados.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('est.filtro.grado')}</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              bind:value={selectedGrado}>
              {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        {#if secciones.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('est.filtro.seccion')}</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              bind:value={selectedSeccion}>
              {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        <div class="filter-group" style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
          <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('est.filtro.sexo')}</label>
          <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
            bind:value={selectedSexo}>
            <option value="">{t('est.todos')}</option>
            <option value="M">{t('est.masculino')}</option>
            <option value="F">{t('est.femenino')}</option>
          </select>
        </div>
        {#if extras}{@render extras()}{/if}
      </div>
      <button class="primary" onclick={close} style="margin-top:.9rem;width:100%;height:36px;font-size:0.85rem">{t('est.filtro.aplicar')}</button>
    </div>
  </div>
{/if}

<style>
  .filters-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  /* Android en landscape: distribuir los filtros horizontalmente para que
     el modal use el ancho disponible en vez de apilarse verticalmente. */
  @media (orientation: landscape) and (max-height: 500px) {
    :global(.modal-overlay) {
      align-items: stretch !important;
      padding: 0.5rem !important;
    }
    :global(.modal-content.filters-solid) {
      width: min(720px, calc(100vw - 24px)) !important;
      max-width: min(720px, calc(100vw - 24px)) !important;
      max-height: calc(100vh - 16px) !important;
    }
    .filters-grid {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.5rem 0.6rem;
    }
    :global(.filters-solid .filter-group) {
      flex: 1 1 calc(50% - 0.3rem) !important;
      min-width: 160px;
    }
  }
  /* Modal de filtros Android: fondo opaco para que los selects se lean bien
     (el glassmorphism vuelve los dropdowns casi invisibles en WebView Android). */
  :global(.filters-solid) {
    background: #1e293b !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    border: 1px solid rgba(148, 163, 184, 0.35) !important;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6) !important;
    border-radius: 18px !important;
  }
  :global(.filters-solid .filter-select-solid) {
    background: #0f172a !important;
    border: 1px solid rgba(148, 163, 184, 0.45) !important;
    color: #f1f5f9 !important;
    font-weight: 600 !important;
    appearance: none !important;
    -webkit-appearance: none !important;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e") !important;
    background-repeat: no-repeat !important;
    background-position: right 0.6rem center !important;
    background-size: 14px !important;
    padding-right: 1.8rem !important;
  }
  :global(.filters-solid .filter-select-solid:focus) {
    border-color: var(--primary-color, #3b82f6) !important;
    outline: none !important;
  }
  :global(.filters-solid .filter-select-solid option) {
    background: #0f172a !important;
    color: #f1f5f9 !important;
  }
</style>
