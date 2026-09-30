<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
import SelectChip from "./SelectChip.svelte";
  import FilterActions from "./FilterActions.svelte";

  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; instrumento?: string; criterios: Criterio[]; }
  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }

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

  /** Máximo de indicadores que pueden sumar: 5 x 20 pts = 100 pts de evaluación. */
  const MAX_ACTIVOS = 5;
  const MAX_PTS_POR_INDICADOR = 20;

  /** Suma de puntos de un indicador (sus criterios). */
  function puntosDe(ind: Indicador): number {
    return ind.criterios.reduce((s, c) => s + Number(c.puntajeMaximo || 0), 0);
  }

  /**
   * Etiqueta de solo lectura: el activo/inactivo se decide desde NotasPage.
   * Aquí solo se informa si el indicador suma y cuántos puntos vale.
   */
  function etiquetaEstado(ind: Indicador): { texto: string; color: string; fondo: string; title: string } {
    const pts = puntosDe(ind);
    if (ind.activo) {
      const excede = !isQualitative && pts > MAX_PTS_POR_INDICADOR;
      return {
        texto: `🟢 Sumando · ${isQualitative ? 'Cualitativo' : pts + ' pts'}`,
        color: excede ? '#fca5a5' : '#4ade80',
        fondo: excede ? 'rgba(239,68,68,0.12)' : 'rgba(74,222,128,0.12)',
        title: excede
          ? `Este indicador activo suma ${pts} pts y el máximo por indicador es ${MAX_PTS_POR_INDICADOR}. Corrígelo antes de calificar.`
          : `Indicador activo: sus notas suman al total de la evaluación. Se cambia desde NotasPage.`
      };
    }
    return {
      texto: `⚪ Inactivo · ${isQualitative ? 'no suma' : pts + ' pts'}`,
      color: '#94a3b8',
      fondo: 'rgba(148,163,184,0.1)',
      title: `Indicador inactivo: sus notas NO suman al total, pero se conservan. Se activa desde NotasPage.`
    };
  }

  onMount(() => {
    // La preferencia `evaluaciones-view-mode` quedó sin uso: ahora la vista de
    // panel es la única. Se limpia la clave vieja para no dejar basura persistida.
    localStorage.removeItem("evaluaciones-view-mode");
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
    // untrack es OBLIGATORIO aquí: fetchConfig es async y antes de su primer
    // await lee `hayCambios` / `comboCargado`, que dependen de `indicadores`.
    // Sin untrack, escribir un caracter en un descriptor cambiaría esos valores
    // -> el efecto se re-ejecutaría -> recargaría desde la BD y pisaría el texto.
    if (selectedGrado && selectedAsignatura && selectedCorte && selectedAno) {
      untrack(() => { void fetchConfig(); });
    }
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
    const combo = `${selectedAno}-${selectedGrado}-${selectedAsignatura}-${selectedCorte}`;
    // Cambiar de grado/asignatura/corte/año con ediciones sin guardar las perdería:
    // se pregunta antes de cargar otra combinación.
    if (hayCambios && comboCargado !== '' && combo !== comboCargado) {
      const ok = await ask(
        "Tienes cambios sin guardar en esta configuración.\n\nSi continúas se perderán.",
        { title: '💾 Cambios sin guardar', kind: 'warning', okLabel: 'Guardar y continuar', cancelLabel: 'Descartar y continuar' }
      );
      if (ok) await handleSaveConfig();
    }
    loading = true;
    try {
      indicadores = await invoke<Indicador[]>("get_evaluation_config", { gradoId: selectedGrado, asignaturaId: selectedAsignatura, corteEvaluativoId: selectedCorte, anoLectivoId: selectedAno });
      configBaseline = snapshotConfig(indicadores);
      comboCargado = combo;
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al cargar configuración: " + error, type: "error" });
    } finally { loading = false; }
  }

  function handleUpdateIndicadorDesc(id: number, desc: string) {
    indicadores = indicadores.map(i => i.id === id ? { ...i, descripcion: desc } : i);
  }

  /**
   * Instantánea de lo que está guardado en la BD (descripciones y puntos).
   * El botón Guardar se habilita solo mientras el estado actual difiere de aquí.
   */
  function snapshotConfig(lista: Indicador[]): string {
    // Se ordena por id para que un simple cambio de orden de la consulta
    // (por ejemplo tras numerar de nuevo los criterios) NO cuente como cambio.
    const porId = (a: { id: number }, b: { id: number }) => a.id - b.id;
    return JSON.stringify([...lista].sort(porId).map(i => ({
      id: i.id,
      d: i.descripcion,
      c: [...i.criterios].sort(porId).map(c => [c.id, c.descripcion, Number(c.puntajeMaximo) || 0])
    })));
  }
  let configBaseline = $state('');
  let comboCargado = $state('');
  let hayCambios = $derived(configBaseline !== '' && snapshotConfig(indicadores) !== configBaseline);
  let recienGuardado = $state(false);
  let guardando = $state(false);

  function handleUpdateCriterio(indicadorId: number, criterioId: number, field: "descripcion" | "puntajeMaximo", value: string | number) {
    indicadores = indicadores.map(ind => {
      if (ind.id !== indicadorId) return ind;
      return { ...ind, criterios: ind.criterios.map(crit => crit.id === criterioId ? { ...crit, [field]: value } : crit) };
    });
  }

  async function handleSaveConfig() {
    if (!hayCambios || guardando) return;
    const problemas: string[] = [];
    if (!isQualitative) {
      for (const ind of indicadores) {
        if (!ind.activo) continue;
        const total = puntosDe(ind);
        if (total > MAX_PTS_POR_INDICADOR) {
          problemas.push(`Indicador ${ind.orden}: ${total} pts (máximo ${MAX_PTS_POR_INDICADOR})`);
        }
      }
      if (activeCount > MAX_ACTIVOS) {
        problemas.push(`Hay ${activeCount} indicadores sumando y el máximo es ${MAX_ACTIVOS} (${MAX_ACTIVOS} × ${MAX_PTS_POR_INDICADOR} = 100 pts). Desactiva uno desde NotasPage.`);
      }
    }
    if (problemas.length > 0) {
      await emit("show-toast", { message: `⚠️ No se guardó:\n${problemas.join('\n')}`, type: "error" });
      return;
    }
    guardando = true;
    try {
      for (const ind of indicadores) {
        await invoke("update_indicador", { id: ind.id, descripcion: ind.descripcion, activo: ind.activo });
        for (const crit of ind.criterios) {
          await invoke("update_criterio", { id: crit.id, descripcion: crit.descripcion, puntajeMaximo: Number(crit.puntajeMaximo) });
        }
      }
      configBaseline = snapshotConfig(indicadores);
      recienGuardado = true;
      setTimeout(() => { recienGuardado = false; }, 1600);
      // Hay que marcar LAS DOS tablas: el guardado escribe indicadores y criterios.
      // Antes solo se marcaba 'indicador' y el sync D1 se salvaba porque el push
      // es por cursor (updated_at) sobre todas las tablas, pero 'criterio'
      // quedaba sin marcar y el rastro de sync no reflejaba lo que se guardo.
      onDataChange('indicador');
      onDataChange('criterio');
      await emit("notas-updated", { timestamp: Date.now() });
      await emit("show-toast", { message: "✅ Configuración guardada", type: "success" });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
    } finally { guardando = false; }
  }
</script>

<div class="page-container">
  <div class="category-grid" style="display: block;">
    <div class="ev-sticky-header" style="{isMobile ? 'position: sticky; top: 0; z-index: 60; background: rgba(10, 14, 20, 0.95); border-radius: 0 0 12px 12px; padding-bottom: 0.1rem;' : ''}">
      <FilterContainer {isMobile}>
        <FilterGroup label="Año:" {isMobile} flex={isMobile ? '1 1 0' : '0 1 auto'}>
          <SelectChip
            label="Seleccionar año lectivo"
            value={selectedAno}
            onchange={(v) => { selectedAno = Number(v); }}
            options={anos.map(a => ({ value: a.id, label: a.nombre }))} />
        </FilterGroup>
        <FilterGroup label="Grado:" {isMobile} flex={isMobile ? '1 1 0' : '0 1 auto'}>
          <SelectChip
            label="Seleccionar grado"
            value={selectedGrado}
            onchange={(v) => { selectedGrado = Number(v); }}
            options={grados.map(g => ({ value: g.id, label: g.nombre }))} />
        </FilterGroup>
        <FilterGroup label="Asignatura:" {isMobile} flex={isMobile ? '1 1 0' : '0 1 auto'}>
          <SelectChip
            label="Seleccionar asignatura"
            value={selectedAsignatura}
            onchange={(v) => { selectedAsignatura = Number(v); }}
            disabled={asignaturas.length === 0}
            placeholder="Sin asignaturas"
            options={asignaturas.map(a => ({ value: a.id, label: a.nombre }))} />
        </FilterGroup>
        <FilterGroup label="Corte:" {isMobile} flex={isMobile ? '1 1 0' : '0 1 auto'}>
          <SelectChip
            label="Seleccionar corte evaluativo"
            value={selectedCorte}
            onchange={(v) => { selectedCorte = Number(v); }}
            options={cortes.map(c => ({ value: c.id, label: c.nombre }))} />
        </FilterGroup>
        {#if !isMobile}
          <FilterActions>
            {#if hayCambios}
              <span title="Hay cambios sin guardar" style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.5rem; border-radius: 999px; background: rgba(251,191,36,0.14); border: 1px solid rgba(251,191,36,0.35); color: #fbbf24; font-size: 0.7rem; font-weight: 700; white-space: nowrap;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #fbbf24;"></span>Sin guardar
              </span>
            {/if}
            <button
              class="primary"
              onclick={handleSaveConfig}
              disabled={!hayCambios || loading || guardando || asignaturas.length === 0}
              style="padding: 0.6rem 1.4rem; font-size: 0.9rem; font-weight: 700; background: {hayCambios ? (recienGuardado ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #16a34a, #22c55e)') : 'rgba(148,163,184,0.5)'}; color: #fff; border: none; border-radius: 10px; cursor: {hayCambios ? 'pointer' : 'default'}; opacity: {hayCambios ? 1 : 0.65}; box-shadow: {hayCambios ? '0 4px 14px rgba(34,197,94,0.35)' : 'none'}; transition: all 0.2s ease; white-space: nowrap;">
              {loading ? '⏳...' : guardando ? '💾 Guardando...' : recienGuardado ? '✓ Guardado' : hayCambios ? '💾 Guardar cambios' : 'Sin cambios'}
            </button>
          </FilterActions>
        {/if}
        {#if isMobile}
          <div style="flex: 1 1 100%; display: flex; justify-content: flex-end; align-items: center; gap: 0.4rem; margin-top: 0.15rem;">
            <button
              class="primary"
              onclick={handleSaveConfig}
              disabled={!hayCambios || loading || guardando || asignaturas.length === 0}
              title={hayCambios ? 'Guardar cambios' : 'No hay cambios que guardar'}
              style="padding: 0.35rem 0.75rem; font-size: 0.75rem; flex-shrink: 0; white-space: nowrap; background: {hayCambios ? (recienGuardado ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #16a34a, #22c55e)') : 'rgba(148,163,184,0.5)'}; color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: {hayCambios ? 'pointer' : 'default'}; opacity: {hayCambios ? 1 : 0.65}; transition: all 0.2s ease;">
              {loading ? '⏳' : guardando ? '💾' : recienGuardado ? '✓' : '💾'}
            </button>
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
            <span>Indicadores que suman: <strong>{activeCount}</strong> / {MAX_ACTIVOS}</span>
            {#if !isQualitative}
              <span style="margin-left: 1rem;">Puntaje: <strong>{puntosActivos}</strong> / {maxScore} pts</span>
            {/if}
            <span style="margin-left: 1rem; font-size: 0.72rem; color: #64748b;">{isQualitative ? 'Editable aquí: descripciones (el puntaje no aplica en cualitativo).' : 'Editable aquí: descripciones y puntos.'} Cuáles suman se decide en NotasPage.</span>
            {#if hayCambios}
              <span style="margin-left: 1rem; font-size: 0.72rem; color: #fbbf24; font-weight: 700;">· ⚠️ Cambios sin guardar</span>
            {:else if recienGuardado}
              <span style="margin-left: 1rem; font-size: 0.72rem; color: #4ade80; font-weight: 700;">· ✓ Guardado</span>
            {/if}
          </div>

          {#if !isQualitative}
            <div class="ev-score-bar">
              <div class="ev-score-fill" style="width: {scoreRatio * 100}%;"></div>
            </div>
          {/if}
        </div>
      {/if}

      {#if isMobile}
        <div class="accordion-container">
            {#each indicadores as ind (ind.id)}
              {@const expanded = accordionOpen.has(ind.id)}
              {@const est = etiquetaEstado(ind)}
              <div id="indicador-{ind.id}" class="accordion-item" class:active={ind.activo} class:inactive={!ind.activo} class:expanded>
                <div class="accordion-header" onclick={() => { const next = new Set(accordionOpen); if (next.has(ind.id)) next.delete(ind.id); else next.add(ind.id); accordionOpen = next; }}>
                  <div class="accordion-header-left">
                    <span title={est.title} style="display: inline-flex; align-items: center; padding: 0.1rem 0.35rem; border-radius: 999px; background: {est.fondo}; color: {est.color}; font-size: 0.6rem; font-weight: 700; white-space: nowrap; flex-shrink: 0;">{est.texto}</span>
                    <div class="indicador-badge" class:active={ind.activo} class:inactive={!ind.activo}>{ind.orden}</div>
                    <span>{ind.descripcion || `Indicador ${ind.orden}`}</span>
                  </div>
                  <div class="accordion-header-right">
                    <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : puntosDe(ind) + ' pts'}</span>
                    <span class="accordion-chevron" class:open={expanded}>▶</span>
                  </div>
                </div>
                {#if expanded}
                  <div class="accordion-body">
                    <!-- Descripción del INDICADOR. Antes solo existía en la vista
                         split de escritorio, así que en móvil no había forma de
                         editarla al desplegar. -->
                    <div class="criterio-row" style="margin-bottom:0.45rem;">
                      <span class="criterio-label">Indicador</span>
                      <input
                        type="text"
                        value={ind.descripcion}
                        oninput={(e) => handleUpdateIndicadorDesc(ind.id, (e.target as HTMLInputElement).value)}
                        placeholder="Descripción del indicador..."
                        class="criterio-input"
                        style="font-weight:600;" />
                    </div>
                    {#each ind.criterios as crit (crit.id)}
                      <div class="criterio-row">
                        <span class="criterio-label">Crit. {crit.orden}</span>
                        <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} placeholder="Descripción..." class="criterio-input" />
                        <!-- En cualitativo el puntaje no interviene (el peso por
                             criterio es fijo 7/7/6 = 20), asi que se oculta en vez
                             de mostrarse deshabilitado. -->
                        {#if !isQualitative}
                          <div class="criterio-score">
                            <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(ind.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} class="criterio-puntaje" />
                            <span class="criterio-pts">pts</span>
                          </div>
                        {/if}
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
                {@const est = etiquetaEstado(ind)}
                <div id="indicador-{ind.id}" class="split-item" class:active={ind.activo} class:inactive={!ind.activo} class:selected={expandedIndicador === ind.id} onclick={() => expandedIndicador = ind.id}>
                  <div class="split-item-row">
                    <span title={est.title} style="display: inline-flex; align-items: center; padding: 0.1rem 0.4rem; border-radius: 999px; background: {est.fondo}; color: {est.color}; font-size: 0.62rem; font-weight: 700; white-space: nowrap; flex-shrink: 0;">{est.texto}</span>
                    <div class="indicador-badge" class:active={ind.activo} class:inactive={!ind.activo}>{ind.orden}</div>
                    <span class="split-item-desc">{ind.descripcion || `Indicador ${ind.orden}`}</span>
                    <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : puntosDe(ind) + ' pts'}</span>
                  </div>
                </div>
              {/each}
            </div>
            <div class="split-detail">
              {#if selected}
                {@const estSel = etiquetaEstado(selected)}
                <div class="split-detail-header">
                  <h3>Indicador {selected.orden}</h3>
                  <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <span title={estSel.title} style="display: inline-flex; align-items: center; padding: 0.2rem 0.55rem; border-radius: 999px; background: {estSel.fondo}; color: {estSel.color}; font-size: 0.7rem; font-weight: 700; border: 1px solid {estSel.color}33;">{estSel.texto}</span>
                    <span class="status-tag" class:qualitative={isQualitative} class:quantitative={!isQualitative}>{isQualitative ? 'Cualitativo' : puntosDe(selected) + ' pts'}</span>
                    <span style="font-size: 0.62rem; color: #64748b;">Se activa o desactiva desde NotasPage</span>
                  </div>
                </div>
                <input type="text" value={selected.descripcion} oninput={(e) => handleUpdateIndicadorDesc(selected.id, (e.target as HTMLInputElement).value)} placeholder="Descripción del indicador..." class="split-detail-desc" />
                <div class="split-detail-criterios">
                  {#each selected.criterios as crit (crit.id)}
                    <div class="criterio-row">
                      <span class="criterio-label">Crit. {crit.orden}</span>
                      <input type="text" value={crit.descripcion} oninput={(e) => handleUpdateCriterio(selected.id, crit.id, "descripcion", (e.target as HTMLInputElement).value)} placeholder="Descripción..." class="criterio-input" />
                      <!-- Ver nota en la vista accordion: en cualitativo no se
                           muestra el puntaje. -->
                      {#if !isQualitative}
                        <div class="criterio-score">
                          <input type="number" value={crit.puntajeMaximo} oninput={(e) => handleUpdateCriterio(selected.id, crit.id, "puntajeMaximo", Number((e.target as HTMLInputElement).value))} class="criterio-puntaje" />
                          <span class="criterio-pts">pts</span>
                        </div>
                      {/if}
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
  </div>
</div>

<style>
  :global(.sticky-filters) {
    overflow: visible !important;
  }
  :global(.filters-row) {
    overflow: visible !important;
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
      padding: 0.5rem !important;
      margin-bottom: 0.1rem !important;
    }
    :global(.filters-row) {
      gap: 0.4rem !important;
      padding: 0.4rem !important;
    }
    :global(.filter-select) {
      padding: 0.5rem 0.8rem !important;
      font-size: 0.85rem !important;
      min-height: 38px !important;
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
