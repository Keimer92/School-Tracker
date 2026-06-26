<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import FilterActions from "./FilterActions.svelte";

  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; criterios: Criterio[]; }
  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  type ViewMode = "modern-cards" | "accordion" | "split-panel" | "refined";

  const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
    { key: "modern-cards", label: "Moderno", icon: "🎴" },
    { key: "accordion", label: "Acordeón", icon: "📋" },
    { key: "split-panel", label: "Panel", icon: "⛶" },
    { key: "refined", label: "Clásico", icon: "🎨" },
  ];

  let grados: CategoryItem[] = $state([]);
  let asignaturas: CategoryItem[] = $state([]);
  let cortes: CategoryItem[] = $state([]);
  let selectedGrado = $state(0);
  let selectedAsignatura = $state(0);
  let selectedCorte = $state(0);
  let indicadores: Indicador[] = $state([]);
  let loading = $state(false);
  let isQualitative = $state(false);
  let isMobile = $state(false);
  let viewMode = $state<ViewMode>("split-panel");
  let expandedIndicador = $state<number | null>(null);
  let accordionOpen = $state<Set<number>>(new Set());

  let filteredActiveIndicadores = $derived(indicadores.filter(i => i.activo));
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
    if (saved) viewMode = saved;
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) viewMode = "accordion";
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
      const [gData, cData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados"),
        invoke<CategoryItem[]>("get_cortes"),
      ]);
      grados = gData;
      cortes = cData;
      if (cData.length > 0) selectedCorte = cData[0].id;
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

  async function handleToggleIndicador(indicador: Indicador) {
    const activeCount = indicadores.filter(i => i.activo).length;
    if (!indicador.activo && activeCount >= 5) {
      await emit("show-toast", { message: "⚠️ Solo pueden haber 5 indicadores activos.", type: "warning" });
      return;
    }
    try {
      await invoke("update_indicador", { id: indicador.id, descripcion: indicador.descripcion, activo: !indicador.activo });
      indicadores = indicadores.map(i => i.id === indicador.id ? { ...i, activo: !i.activo } : i);
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
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
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
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
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
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
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("notas-updated", { timestamp: Date.now() });
      await emit("show-toast", { message: "✅ Configuración guardada", type: "success" });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
    }
  }
</script>

<div class="page-container">
  <div class="category-grid" style="display: block;">
    <FilterContainer {isMobile}>
      <FilterGroup label="Grado:" {isMobile}>
        <select class="filter-select" bind:value={selectedGrado} aria-label="Seleccionar grado">
          {#each grados as g}
            <option value={g.id}>{g.nombre}</option>
          {/each}
        </select>
      </FilterGroup>
      <FilterGroup label="Asignatura:" {isMobile}>
        <select class="filter-select" bind:value={selectedAsignatura} disabled={asignaturas.length === 0} aria-label="Seleccionar asignatura">
          {#if asignaturas.length === 0}
            <option value="0">Sin asignaturas</option>
          {/if}
          {#each asignaturas as a}
            <option value={a.id}>{a.nombre}</option>
          {/each}
        </select>
      </FilterGroup>
      <FilterGroup label="Corte:" {isMobile}>
        <select class="filter-select" bind:value={selectedCorte} aria-label="Seleccionar corte evaluativo">
          {#each cortes as c}
            <option value={c.id}>{c.nombre}</option>
          {/each}
        </select>
      </FilterGroup>
      <FilterActions>
        <button class="primary" onclick={handleSaveConfig} disabled={loading || asignaturas.length === 0} style="padding: 0.5rem 1rem; font-size: 0.85rem;">
          {loading ? '⏳...' : '💾'}
        </button>
      </FilterActions>
    </FilterContainer>

    <div style="display:flex;justify-content:center;margin-bottom:0.75rem">
      <div class="ev-view-toggle">
        {#each VIEW_MODES as { key, label, icon }}
          <button class="ev-view-btn" class:active={viewMode === key} onclick={() => handleViewModeChange(key)} title={label}>
            <span class="ev-view-icon">{icon}</span>
            {#if !isMobile}<span class="ev-view-label">{label}</span>{/if}
          </button>
        {/each}
      </div>
    </div>

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

      {#if viewMode === "modern-cards"}
        <div class="ev-cards-container">
          {#each indicadores as ind (ind.id)}
            <div id="indicador-{ind.id}" class="indicador-card" class:active={ind.activo} class:inactive={!ind.activo}>
              <div class="indicador-header">
                <div class="indicador-header-left">
                  <label class="switch" title={ind.activo ? "Desactivar" : "Activar"}>
                    <input type="checkbox" checked={ind.activo} onchange={() => handleToggleIndicador(ind)} />
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
              {#if ind.activo}
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
              {/if}
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
                  <label class="switch" title={ind.activo ? "Desactivar" : "Activar"}>
                    <input type="checkbox" checked={ind.activo} onchange={(e) => { e.stopPropagation(); handleToggleIndicador(ind); }} />
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
                  {#if ind.activo}
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
                  {:else}
                    <div class="accordion-empty">Indicador inactivo — activa el switch para editar criterios</div>
                  {/if}
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
                      <input type="checkbox" checked={ind.activo} onchange={(e) => { e.stopPropagation(); handleToggleIndicador(ind); }} />
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
                      <input type="checkbox" checked={ind.activo} onchange={(e) => { e.stopPropagation(); handleToggleIndicador(ind); }} />
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
                      <input type="checkbox" checked={selected.activo} onchange={() => handleToggleIndicador(selected)} />
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
                  {#if selected.activo}
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
                  {:else}
                    <div class="accordion-empty">Indicador inactivo — activa el switch para editar criterios</div>
                  {/if}
                </div>
              {:else}
                <div class="accordion-empty">Selecciona un indicador de la lista</div>
              {/if}
            </div>
          </div>
        {/if}
      {:else if viewMode === "refined"}
        <div class="ev-cards-container">
          {#each indicadores as ind (ind.id)}
            <div id="indicador-{ind.id}" class="refined-card" class:active={ind.activo} class:inactive={!ind.activo}>
              <div class="refined-header">
                <div class="refined-header-top">
                  <div class="refined-header-left">
                    <label class="switch">
                      <input type="checkbox" checked={ind.activo} onchange={() => handleToggleIndicador(ind)} />
                      <span class="slider round"></span>
                    </label>
                    <span class="refined-num">Ind. {ind.orden}</span>
                  </div>
                  {#if !ind.activo}
                    <span class="status-tag inactive">Inactivo</span>
                  {:else}
                    <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : '20 pts'}</span>
                  {/if}
                </div>
                <input type="text" value={ind.descripcion} oninput={(e) => handleUpdateIndicadorDesc(ind.id, (e.target as HTMLInputElement).value)} onblur={() => handleBlurIndicador(ind)} placeholder="Descripción del indicador..." class="refined-desc-input" />
              </div>
              {#if ind.activo}
                <div class="refined-body">
                  {#each ind.criterios as crit (crit.id)}
                    <div class="refined-criterio">
                      <span class="refined-crit-label">Crit. {crit.orden}</span>
                      <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} onblur={() => handleBlurCriterio(crit)} placeholder="Descripción..." class="refined-crit-input" />
                      <div class="refined-crit-score">
                        <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} onblur={() => handleBlurCriterio(crit)} disabled={isQualitative} class="refined-crit-puntaje" />
                        <span class="criterio-pts">pts</span>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
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
</style>
