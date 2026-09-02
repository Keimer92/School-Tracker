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

  function close() { open = false; }
</script>

{#if open && isAndroidMobile}
  <div class="modal-overlay" onclick={close} style="z-index:2000">
    <div class="modal-content filters-solid" onclick={(e) => e.stopPropagation()}
      style="width:min(380px, calc(100vw - 32px));max-width:min(380px, calc(100vw - 32px));max-height:85vh;overflow-y:auto;padding:1.25rem;text-align:left;position:relative">
      <button type="button" onclick={close} title="Cerrar"
        style="position:absolute;top:.6rem;right:.6rem;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#1e293b;color:#e2e8f0;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
      <h3 style="margin:0 0 1rem;color:#f1f5f9;font-size:1.05rem;padding-right:2.2rem">{title}</h3>
      <div style="display:flex;flex-direction:column;gap:0.75rem">
        <FilterGroup label="Año lectivo:" {isMobile}>
          <select class="filter-select filter-select-solid" style="width:100%"
            value={selectedAno} onchange={(e) => onChangeAno(Number((e.target as HTMLSelectElement).value))}>
            {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Colegio:" {isMobile}>
          <select class="filter-select filter-select-solid" style="width:100%"
            value={selectedColegio} onchange={(e) => onChangeColegio(Number((e.target as HTMLSelectElement).value))}>
            {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Grado:" {isMobile}>
          <select class="filter-select filter-select-solid" style="width:100%"
            value={selectedGrado} onchange={(e) => onChangeGrado(Number((e.target as HTMLSelectElement).value))}>
            {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Sección:" {isMobile}>
          <select class="filter-select filter-select-solid" style="width:100%"
            value={selectedSeccion} onchange={(e) => onChangeSeccion(Number((e.target as HTMLSelectElement).value))}>
            {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Sexo:" {isMobile}>
          <select class="filter-select filter-select-solid" style="width:100%"
            value={selectedSexo} onchange={(e) => onChangeSexo((e.target as HTMLSelectElement).value)}>
            <option value="">Todos</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </FilterGroup>
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
