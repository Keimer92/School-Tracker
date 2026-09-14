<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import FilterActions from "./FilterActions.svelte";

  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; instrumento?: string; criterios: Criterio[]; }
  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  type ViewMode = "modern-cards" | "accordion" | "split-panel";

  const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
    { key: "split-panel", label: "Panel", icon: "⛶" },
    { key: "modern-cards", label: "Moderno", icon: "🎴" },
    { key: "accordion", label: "Acordeón", icon: "📋" },
  ];

  let grados: CategoryItem[] = $state([]);
  let asignaturas: CategoryItem[] = $state([]);
  let cortes: CategoryItem[] = $state([]);
  let anos: CategoryItem[] = $state([]);
  let selectedAno = $state(0);
  let selectedGrado = $state(0);
  let selectedAsignatura = $state(0);
  let selectedCorte = $state(0);
  let indicadores: Indicador[] = $state([]);
  let loading = $state(false);
  let isQualitative = $state(false);
  let isMobile = $state(false);
  const isAndroid = /Android/i.test(navigator.userAgent);
  let viewMode = $state<ViewMode>("split-panel");
  let expandedIndicador = $state<number | null>(null);
  let accordionOpen = $state<Set<number>>(new Set());

  let filteredActiveIndicadores = $derived(indicadores.filter(i => i.activo));
  let activeCount = $derived(filteredActiveIndicadores.length);
  let puntosActivos = $derived(
    filteredActiveIndicadores.reduce((sum, ind) => {
      if (isQualitative) return sum;
      return sum + ind.criterios.reduce((s, c) => s + Number(c.puntajeMaximo), 0);
    }, 0)
  );

  function handleViewModeChange(mode: ViewMode) {
    viewMode = mode;
    localStorage.setItem("evaluaciones-view-mode", mode);
    expandedIndicador = null;
    accordionOpen = new Set();
  }

  onMount(() => {
    const saved = localStorage.getItem("evaluaciones-view-mode") as ViewMode | null;
    if (saved === "refined") { viewMode = "split-panel"; localStorage.setItem("evaluaciones-view-mode", "split-panel"); }
    else if (saved) viewMode = saved;
    if (isAndroid) viewMode = "modern-cards";
    const checkMobile = () => { isMobile = window.innerWidth <= 768; };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    fetchCatalogs();
    const unsub = listen("subjects-updated", async () => {
      if (selectedGrado) {
        try {
          const data = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado });
          const sorted = data.sort((a, b) => a.nombre.localeCompare(b.nombre));
          asignaturas = sorted;
          if (sorted.length > 0 && !sorted.some(a => a.id === selectedAsignatura)) {
            selectedAsignatura = sorted[0].id;
          }
        } catch (e) { console.error("Error refreshing subjects:", e); }
      }
    });
    return () => {
      window.removeEventListener("resize", checkMobile);
      unsub.then(f => f());
    };
  });

  $effect(() => {
    if (selectedGrado && selectedAsignatura && selectedCorte) { fetchConfig(); }
    else { indicadores = []; }
  });

  $effect(() => {
    if (selectedGrado) {
      const grado = grados.find(g => g.id === selectedGrado);
      isQualitative = grado?.cualitativo || false;
      invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado })
        .then(data => {
          const sorted = data.sort((a, b) => a.nombre.localeCompare(b.nombre));
          asignaturas = sorted;
          selectedAsignatura = sorted.length > 0 ? sorted[0].id : 0;
        })
        .catch(async (err) => {
          console.error("Error fetching subjects:", err);
          await emit("show-toast", { message: "❌ Error al cargar asignaturas: " + err, type: "error" });
          asignaturas = [];
          selectedAsignatura = 0;
          isQualitative = false;
        });
    } else {
      asignaturas = [];
      selectedAsignatura = 0;
      isQualitative = false;
    }
  });

  async function fetchCatalogs() {
    try {
      const [gData, cData, aData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados"),
        invoke<CategoryItem[]>("get_cortes"),
        invoke<CategoryItem[]>("get_anos"),
      ]);
      grados = gData;
      cortes = cData;
      anos = aData;
      const activeCorte = cData.find(c => c.activo);
      if (activeCorte) selectedCorte = activeCorte.id;
      else if (cData.length > 0) selectedCorte = cData[0].id;
      const activeAno = aData.find(a => a.activo);
      if (activeAno) selectedAno = activeAno.id;
      else if (aData.length > 0) selectedAno = aData[0].id;
      if (gData.length > 0) { selectedGrado = gData[0].id; isQualitative = gData[0].cualitativo || false; }
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  }

  async function fetchConfig() {
    loading = true;
    try {
      indicadores = await invoke<Indicador[]>("get_evaluation_config", { gradoId: selectedGrado, asignaturaId: selectedAsignatura, corteEvaluativoId: selectedCorte });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al cargar configuración: " + error, type: "error" });
    } finally { loading = false; }
  }

  function handleToggleClick(e: Event, indicador: Indicador) {
    if (!indicador.activo && activeCount >= 5) {
      e.preventDefault();
      emit("show-toast", { message: "❌ Límite alcanzado: solo pueden haber 5 indicadores activos. Desactive uno antes de activar otro.", type: "error" });
    }
  }

  async function handleToggleIndicador(indicador: Indicador) {
    try {
      await invoke("update_indicador", { id: indicador.id, descripcion: indicador.descripcion, activo: !indicador.activo });
      indicadores = indicadores.map(i => i.id === indicador.id ? { ...i, activo: !i.activo } : i);
      onDataChange('indicador');
      await emit("notas-updated", { timestamp: Date.now() });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al actualizar: " + error, type: "error" });
    }
  }

  function handleUpdateIndicadorDesc(id: number, desc: string) {
    indicadores = indicadores.map(i => i.id === id ? { ...i, descripcion: desc } : i);
  }

  async function handleBlurIndicador(indicador: Indicador) {
    try {
      await invoke("update_indicador", { id: indicador.id, descripcion: indicador.descripcion, activo: indicador.activo });
      onDataChange('indicador');
      await emit("notas-updated", { timestamp: Date.now() });
    } catch (error) {
      console.error("Error saving description", error);
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
    }
  }

  function handleUpdateCriterio(indicadorId: number, criterioId: number, field: "descripcion" | "puntajeMaximo", value: string | number) {
    indicadores = indicadores.map(ind => {
      if (ind.id !== indicadorId) return ind;
      return { ...ind, criterios: ind.criterios.map(crit => crit.id === criterioId ? { ...crit, [field]: value } : crit) };
    });
  }

  async function handleBlurCriterio(criterio: Criterio) {
    try {
      await invoke("update_criterio", { id: criterio.id, descripcion: criterio.descripcion, puntajeMaximo: Number(criterio.puntajeMaximo) });
      onDataChange('indicador');
      await emit("notas-updated", { timestamp: Date.now() });
    } catch (error) {
      console.error("Error saving criterio", error);
      await emit("show-toast", { message: "❌ Error al guardar criterio: " + error, type: "error" });
    }
  }

  async function handleSaveConfig() {
    const problemas: string[] = [];
    let primerIndicadorConProblema: Indicador | null = null;
    if (!isQualitative) {
      for (const ind of indicadores) {
        if (!ind.activo) continue;
        const total = ind.criterios.reduce((sum, crit) => sum + Number(crit.puntajeMaximo), 0);
        if (total > 20) {
          problemas.push(`Indicador ${ind.orden}: ${total} pts (máximo 20)`);
          if (!primerIndicadorConProblema) primerIndicadorConProblema = ind;
        }
      }
    }
    if (problemas.length > 0) {
      await emit("show-toast", { message: `⚠️ Errores:\n${problemas.join('\n')}`, type: "error" });
      return;
    }
    try {
      for (const ind of indicadores) {
        await invoke("update_indicador", { id: ind.id, descripcion: ind.descripcion, activo: ind.activo });
        for (const crit of ind.criterios) {
          await invoke("update_criterio", { id: crit.id, descripcion: crit.descripcion, puntajeMaximo: Number(crit.puntajeMaximo) });
        }
      }
      onDataChange('indicador');
      await emit("notas-updated", { timestamp: Date.now() });
      await emit("show-toast", { message: "✅ Configuración guardada", type: "success" });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
    }
  }
</script>

<div class="page-container">
  <div class="category-grid" style="display: block;">
    <div class="ev-sticky-header" style="{isMobile ? 'position: sticky; top: 0; z-index: 60; background: rgba(10, 14, 20, 0.95); border-radius: 0 0 12px 12px; padding-bottom: 0.1rem;' : ''}">
      <FilterContainer {isMobile}>
        <FilterGroup label="Año:" {isMobile} flex={isMobile ? '1 1 0' : undefined}>
          <select class="filter-select" bind:value={selectedAno} aria-label="Seleccionar año lectivo"
            style="width:100%">
            {#each anos as a}
              <option value={a.id}>{a.nombre}</option>
            {/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Grado:" {isMobile} flex={isMobile ? '1 1 0' : undefined}>
          <select class="filter-select" bind:value={selectedGrado} aria-label="Seleccionar grado"
            style="width:100%">
            {#each grados as g}
              <option value={g.id}>{g.nombre}</option>
            {/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Asignatura:" {isMobile} flex={isMobile ? '1 1 0' : undefined}>
          <select class="filter-select" bind:value={selectedAsignatura} disabled={asignaturas.length === 0} aria-label="Seleccionar asignatura"
            style="width:100%">
            {#if asignaturas.length === 0}
              <option value="0">Sin asignaturas</option>
            {/if}
            {#each asignaturas as a}
              <option value={a.id}>{a.nombre}</option>
            {/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Corte:" {isMobile} flex={isMobile ? '1 1 0' : undefined}>
          <select class="filter-select" bind:value={selectedCorte} aria-label="Seleccionar corte evaluativo"
            style="width:100%">
            {#each cortes as c}
              <option value={c.id}>{c.nombre}</option>
            {/each}
          </select>
        </FilterGroup>
        {#if !isMobile}
          <FilterActions>
            <button class="primary" onclick={handleSaveConfig} disabled={loading || asignaturas.length === 0} style="padding: 0.5rem 1rem; font-size: 0.85rem;">
              {loading ? '⏳...' : '💾'}
            </button>
          </FilterActions>
        {/if}
        {#if isMobile}
          <div style="flex: 1 1 100%; display: flex; justify-content: flex-end; align-items: center; gap: 0.4rem; margin-top: 0.15rem;">
            <button class="primary" onclick={handleSaveConfig} disabled={loading || asignaturas.length === 0} style="padding: 0.35rem 0.75rem; font-size: 0.75rem; flex-shrink: 0; white-space: nowrap;">
              {loading ? '⏳...' : '💾'}
            </button>
            {#if !isAndroid}
              <div class="ev-view-toggle">
                {#each VIEW_MODES as { key, label, icon }}
                  <button class="ev-view-btn" class:active={viewMode === key} onclick={() => handleViewModeChange(key)} title={label}>
                    <span class="ev-view-icon">{icon}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if indicadores.length > 0}
              <div class="ev-score-pill">
                <span>Activos:</span>
                <strong>{activeCount}/5</strong>
              </div>
            {/if}
          </div>
        {/if}
      </FilterContainer>
    </div>

    {#if !isMobile && !isAndroid}
      <div style="display:flex;justify-content:center;margin-bottom:0.75rem">
        <div class="ev-view-toggle">
          {#each VIEW_MODES as { key, label, icon }}
            <button class="ev-view-btn" class:active={viewMode === key} onclick={() => handleViewModeChange(key)} title={label}>
              <span class="ev-view-icon">{icon}</span>
              <span class="ev-view-label">{label}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="ev-loading">
        <div class="ev-loading-spinner"></div>
        <span>Cargando configuración...</span>
      </div>
    {:else if indicadores.length === 0}
      <div class="ev-empty">
        <div class="ev-empty-icon">⚙️</div>
        <h4>No hay configuración de evaluación</h4>
        <p>
          {!selectedGrado || !selectedAsignatura || !selectedCorte
            ? 'Seleccione un grado, asignatura y corte para configurar.'
            : 'No se encontró configuración para la combinación seleccionada.'}
        </p>
      </div>
    {:else}
      {@const activeCount = filteredActiveIndicadores.length}
      {@const maxScore = isQualitative ? activeCount * 20 : 100}
      {@const scoreRatio = maxScore > 0 ? Math.min(puntosActivos / maxScore, 1) : 0}
      {#if !isMobile}
        <div class="ev-score-summary">
          <div class="ev-score-text">
            <span>Activos: <strong>{activeCount}</strong> / 5</span>
            {#if !isQualitative}
              <span style="margin-left: 1rem;">Puntaje: <strong>{puntosActivos}</strong> / {maxScore} pts</span>
            {/if}
          </div>
          {#if !isQualitative}
            <div class="ev-score-bar">
              <div class="ev-score-fill" style="width: {scoreRatio * 100}%;"></div>
            </div>
          {/if}
        </div>
      {/if}

      {#if viewMode === "modern-cards"}
        <div class="ev-cards-container">
          {#each indicadores as ind (ind.id)}
            <div id="indicador-{ind.id}" class="indicador-card" class:active={ind.activo} class:inactive={!ind.activo}>
              <div class="indicador-header">
                <div class="indicador-header-left">
                    <label class="switch" title={ind.activo ? "Desactivar" : (activeCount >= 5 ? "Límite de 5 activos" : "Activar")}>
                    <input type="checkbox" checked={ind.activo} onclick={(e) => handleToggleClick(e, ind)} onchange={() => handleToggleIndicador(ind)} />
                    <span class="slider round"></span>
                  </label>
                  <div class="indicador-badge" class:active={ind.activo} class:inactive={!ind.activo}>{ind.orden}</div>
                  <input type="text" value={ind.descripcion} oninput={(e) => handleUpdateIndicadorDesc(ind.id, (e.target as HTMLInputElement).value)} onblur={() => handleBlurIndicador(ind)} placeholder="Descripción del indicador..." class="indicador-desc-input" />
                </div>
                <div class="indicador-header-right">
                  {#if !ind.activo}
                    <span class="status-tag inactive">Inactivo</span>
                  {:else}
                    <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : '20 pts'}</span>
                  {/if}
                </div>
              </div>
              <div class="indicador-body">
                  {#each ind.criterios as crit (crit.id)}
                    <div class="criterio-row">
                      <span class="criterio-label">Crit. {crit.orden}</span>
                      <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} onblur={() => handleBlurCriterio(crit)} placeholder="Descripción del criterio..." class="criterio-input" />
                      <div class="criterio-score">
                        <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} onblur={() => handleBlurCriterio(crit)} disabled={isQualitative} class="criterio-puntaje" />
                        <span class="criterio-pts">pts</span>
                      </div>
                    </div>
                  {/each}
                </div>
            </div>
          {/each}
        </div>
      {:else if viewMode === "accordion"}
        <div class="accordion-container">
          {#each indicadores as ind (ind.id)}
            {@const expanded = accordionOpen.has(ind.id)}
            <div id="indicador-{ind.id}" class="accordion-item" class:active={ind.activo} class:inactive={!ind.activo} class:expanded>
              <div class="accordion-header" onclick={() => { const next = new Set(accordionOpen); if (next.has(ind.id)) next.delete(ind.id); else next.add(ind.id); accordionOpen = next; }}>
                <div class="accordion-header-left">
                  <label class="switch" title={ind.activo ? "Desactivar" : (activeCount >= 5 ? "Límite de 5 activos" : "Activar")}>
                    <input type="checkbox" checked={ind.activo} onclick={(e) => { e.stopPropagation(); handleToggleClick(e, ind); }} onchange={(e) => { e.stopPropagation(); handleToggleIndicador(ind); }} />
                    <span class="slider round"></span>
                  </label>
                  <div class="indicador-badge" class:active={ind.activo} class:inactive={!ind.activo}>{ind.orden}</div>
                  <input type="text" value={ind.descripcion} oninput={(e) => handleUpdateIndicadorDesc(ind.id, (e.target as HTMLInputElement).value)} onblur={() => handleBlurIndicador(ind)} placeholder="Descripción..." class="indicador-desc-input" onclick={(e) => e.stopPropagation()} />
                </div>
                <div class="accordion-header-right">
                  {#if !ind.activo}
                    <span class="status-tag inactive">Inactivo</span>
                  {:else}
                    <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : '20 pts'}</span>
                  {/if}
                  <span class="accordion-chevron" class:open={expanded}>▶</span>
                </div>
              </div>
              {#if expanded}
                <div class="accordion-body">
                  {#each ind.criterios as crit (crit.id)}
                    <div class="criterio-row">
                      <span class="criterio-label">Crit. {crit.orden}</span>
                      <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} onblur={() => handleBlurCriterio(crit)} placeholder="Descripción..." class="criterio-input" />
                      <div class="criterio-score">
                        <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} onblur={() => handleBlurCriterio(crit)} disabled={isQualitative} class="criterio-puntaje" />
                        <span class="criterio-pts">pts</span>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else if viewMode === "split-panel"}
        {#if isMobile}
          <div class="accordion-container">
            {#each indicadores as ind (ind.id)}
              {@const expanded = accordionOpen.has(ind.id)}
              <div id="indicador-{ind.id}" class="accordion-item" class:active={ind.activo} class:inactive={!ind.activo} class:expanded>
                <div class="accordion-header" onclick={() => { const next = new Set(accordionOpen); if (next.has(ind.id)) next.delete(ind.id); else next.add(ind.id); accordionOpen = next; }}>
                  <div class="accordion-header-left">
<label class="switch">
                        <input type="checkbox" checked={ind.activo} onclick={(e) => { e.stopPropagation(); handleToggleClick(e, ind); }} onchange={(e) => { e.stopPropagation(); handleToggleIndicador(ind); }} />
                        <span class="slider round"></span>
                      </label>
                      <div class="indicador-badge" class:active={ind.activo} class:inactive={!ind.activo}>{ind.orden}</div>
                      <span>{ind.descripcion || `Indicador ${ind.orden}`}</span>
                  </div>
                  <div class="accordion-header-right">
                    {#if !ind.activo}
                      <span class="status-tag inactive">Inactivo</span>
                    {:else}
                      <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : '20 pts'}</span>
                    {/if}
                    <span class="accordion-chevron" class:open={expanded}>▶</span>
                  </div>
                </div>
                {#if expanded}
                  <div class="accordion-body">
                    {#each ind.criterios as crit (crit.id)}
                      <div class="criterio-row">
                        <span class="criterio-label">Crit. {crit.orden}</span>
                        <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} onblur={() => handleBlurCriterio(crit)} placeholder="Descripción..." class="criterio-input" />
                        <div class="criterio-score">
                          <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} onblur={() => handleBlurCriterio(crit)} disabled={isQualitative} class="criterio-puntaje" />
                          <span class="criterio-pts">pts</span>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          {@const selected = indicadores.find(i => i.id === expandedIndicador) || indicadores[0] || null}
          <div class="split-layout">
            <div class="split-list">
              {#each indicadores as ind (ind.id)}
                <div id="indicador-{ind.id}" class="split-item" class:active={ind.activo} class:inactive={!ind.activo} class:selected={expandedIndicador === ind.id} onclick={() => expandedIndicador = ind.id}>
                  <div class="split-item-row">
                    <label class="switch">
                      <input type="checkbox" checked={ind.activo} onclick={(e) => { e.stopPropagation(); handleToggleClick(e, ind); }} onchange={(e) => { e.stopPropagation(); handleToggleIndicador(ind); }} />
                      <span class="slider round"></span>
                    </label>
                    <div class="indicador-badge" class:active={ind.activo} class:inactive={!ind.activo}>{ind.orden}</div>
                    <span class="split-item-desc">{ind.descripcion || `Indicador ${ind.orden}`}</span>
                    {#if !ind.activo}
                      <span class="status-tag inactive">Inactivo</span>
                    {:else}
                      <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : '20 pts'}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            <div class="split-detail">
              {#if selected}
                <div class="split-detail-header">
                  <h3>Indicador {selected.orden}</h3>
                  <div style="display: flex; align-items: center; gap: 0.75rem;">
<label class="switch">
                        <input type="checkbox" checked={selected.activo} onclick={(e) => handleToggleClick(e, selected)} onchange={() => handleToggleIndicador(selected)} />
                        <span class="slider round"></span>
                      </label>
                    {#if !selected.activo}
                      <span class="status-tag inactive">Inactivo</span>
                    {:else}
                      <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : '20 pts'}</span>
                    {/if}
                  </div>
                </div>
                <input type="text" value={selected.descripcion} oninput={(e) => handleUpdateIndicadorDesc(selected.id, (e.target as HTMLInputElement).value)} onblur={() => handleBlurIndicador(selected)} placeholder="Descripción del indicador..." class="split-detail-desc" />
                <div class="split-detail-criterios">
                  {#each selected.criterios as crit (crit.id)}
                    <div class="criterio-row">
                      <span class="criterio-label">Crit. {crit.orden}</span>
                      <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(selected.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} onblur={() => handleBlurCriterio(crit)} placeholder="Descripción..." class="criterio-input" />
                      <div class="criterio-score">
                        <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(selected.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} onblur={() => handleBlurCriterio(crit)} disabled={isQualitative} class="criterio-puntaje" />
                        <span class="criterio-pts">pts</span>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="accordion-empty">Selecciona un indicador de la lista</div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>

<style>
  :global(.sticky-filters) {
    overflow: visible !important;
  }
  :global(.filters-row) {
    overflow: visible !important;
  }
  :global(.ev-view-toggle) {
    display: inline-flex; padding: 0.4rem; gap: 0.3rem;
    background: var(--bg-elevated); border-radius: 14px;
    border: 1px solid var(--border);
  }
  :global(.ev-view-btn) {
    display: flex; align-items: center; gap: 0.3rem;
    padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 10px;
    border: none; background: transparent;
    color: var(--text-muted); cursor: pointer; font-weight: 600;
    transition: all 0.2s ease; white-space: nowrap;
  }
  :global(.ev-view-btn:hover) {
    background: var(--bg-hover); color: var(--text-primary);
  }
  :global(.ev-view-btn.active) {
    background: var(--bg-active); color: var(--text-bright);
    box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.08);
  }
  :global(.ev-score-pill) {
    display: flex; align-items: center; gap: 0.3rem;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 999px; padding: 0.3rem 0.65rem;
    font-size: 0.7rem; color: var(--text-primary, #e2e8f0);
    white-space: nowrap; flex-shrink: 0;
  }
  :global(.ev-score-pill span) {
    color: var(--text-muted, #64748b);
  }
  @media (max-width: 640px) {
    :global(.sticky-filters) {
      padding: 0.2rem !important;
      margin-bottom: 0.1rem !important;
    }
    :global(.filters-row) {
      gap: 0.15rem !important;
      padding: 0.05rem !important;
    }
    :global(.filter-select) {
      padding: 0.3rem 0.4rem !important;
      font-size: 0.8rem !important;
    }
    :global(.ev-view-toggle) {
      padding: 0.2rem !important;
      gap: 0.15rem !important;
    }
    :global(.ev-view-btn) {
      padding: 0.3rem 0.45rem !important;
      font-size: 0.7rem !important;
    }
    :global(.ev-view-icon) {
      font-size: 0.8rem !important;
    }
    :global(.ev-score-pill) {
      padding: 0.2rem 0.5rem !important;
      font-size: 0.65rem !important;
    }
    :global(.ev-score-pill span) {
      font-size: 0.65rem !important;
    }
  }
</style>
