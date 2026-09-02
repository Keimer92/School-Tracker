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

  interface CategoryItem { id: number; nombre: string; }

  let {
    open = $bindable(false),
    isAndroidMobile = false,
    isMobile = false,
    title = '🔍 Filtros',

    // Selects de catálogo
    anos = [] as CategoryItem[],
    colegios = [] as CategoryItem[],
    grados = [] as CategoryItem[],
    secciones = [] as CategoryItem[],
    selectedAno = 0,
    selectedColegio = 0,
    selectedGrado = 0,
    selectedSeccion = 0,
    selectedSexo = '',

    onChangeAno = (v: number) => { selectedAno = v; },
    onChangeColegio = (v: number) => { selectedColegio = v; },
    onChangeGrado = (v: number) => { selectedGrado = v; },
    onChangeSeccion = (v: number) => { selectedSeccion = v; },
    onChangeSexo = (v: string) => { selectedSexo = v; },

    // Slots extra (ej. Período, Semana, Mes/Año)
    extras,
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
    onChangeAno?: (v: number) => void;
    onChangeColegio?: (v: number) => void;
    onChangeGrado?: (v: number) => void;
    onChangeSeccion?: (v: number) => void;
    onChangeSexo?: (v: string) => void;
    extras?: import('svelte').Snippet;
  } = $props();

  // Dentro del modal siempre mostramos labels (hay espacio) y usamos
  // altura/separación consistentes, independientemente de isMobile.
  const modalFlex = '1 1 100%';
  const modalGap = '4px';
  const modalLabelStyle = 'font-size: 0.7rem; color: #94a3b8; font-weight: 600;';
  const modalSelectStyle = 'height:38px;padding:0 0.6rem;font-size:0.85rem;border-radius:8px';

  function close() { open = false; }
</script>

{#if open && isAndroidMobile}
  <div class="modal-overlay" onclick={close} style="z-index:2000">
    <div class="modal-content filters-solid" onclick={(e) => e.stopPropagation()}
      style="width:min(380px, calc(100vw - 32px));max-width:min(380px, calc(100vw - 32px));max-height:85vh;overflow-y:auto;padding:1.25rem;text-align:left;position:relative">
      <button type="button" onclick={close} title="Cerrar"
        style="position:absolute;top:.6rem;right:.6rem;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#1e293b;color:#e2e8f0;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
      <h3 style="margin:0 0 1rem;color:#f1f5f9;font-size:1.05rem;padding-right:2.2rem">{title}</h3>
      <div style="display:flex;flex-direction:column;gap:0.6rem">
        <div class="filter-group" style="display:flex;flex-direction:column;gap:{modalGap};flex:{modalFlex}">
          {#if anos.length > 0}
            <label style={modalLabelStyle}>Año lectivo:</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              value={selectedAno} onchange={(e) => onChangeAno(Number((e.target as HTMLSelectElement).value))}>
              {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
            </select>
          {/if}
        </div>
        {#if colegios.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:{modalGap};flex:{modalFlex}">
            <label style={modalLabelStyle}>Colegio:</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              value={selectedColegio} onchange={(e) => onChangeColegio(Number((e.target as HTMLSelectElement).value))}>
              {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        {#if grados.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:{modalGap};flex:{modalFlex}">
            <label style={modalLabelStyle}>Grado:</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              value={selectedGrado} onchange={(e) => onChangeGrado(Number((e.target as HTMLSelectElement).value))}>
              {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        {#if secciones.length > 0}
          <div class="filter-group" style="display:flex;flex-direction:column;gap:{modalGap};flex:{modalFlex}">
            <label style={modalLabelStyle}>Sección:</label>
            <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
              value={selectedSeccion} onchange={(e) => onChangeSeccion(Number((e.target as HTMLSelectElement).value))}>
              {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
            </select>
          </div>
        {/if}
        <div class="filter-group" style="display:flex;flex-direction:column;gap:{modalGap};flex:{modalFlex}">
          <label style={modalLabelStyle}>Sexo:</label>
          <select class="filter-select filter-select-solid" style="width:100%;{modalSelectStyle}"
            value={selectedSexo} onchange={(e) => onChangeSexo((e.target as HTMLSelectElement).value)}>
            <option value="">Todos</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </div>
        {#if extras}{@render extras()}{/if}
      </div>
      <button class="primary" onclick={() => open = false} style="margin-top:1.25rem;width:100%">✓ Aplicar</button>
    </div>
  </div>
{/if}

<style>
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
