<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import { ask } from "@tauri-apps/plugin-dialog";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SearchInput from "./SearchInput.svelte";
  import PageLayout from "./PageLayout.svelte";
  import ScrollableTable from "./ScrollableTable.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }
  interface EstudianteAsistencia { id: number; nombre: string; sexo: string; estado: string | null; observacion: string | null; }

  let anos: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);

  let selectedAno = $state(Number(localStorage.getItem("selectedAno")) || 0);
  let selectedColegio = $state(Number(localStorage.getItem("selectedColegio")) || 0);
  let selectedGrado = $state(Number(localStorage.getItem("selectedGrado")) || 0);
  let selectedSeccion = $state(Number(localStorage.getItem("selectedSeccion")) || 0);
  let selectedSexo = $state(localStorage.getItem("selectedSexo") || "");
  let selectedFecha = $state(sessionStorage.getItem("asistencia_selectedFecha_v2") || sessionStorage.getItem("asistencia_selectedFecha") || getLocalDateISOString());
  let searchTerm = $state("");

  let colegioConfig: any = $state(null);
  let isFechaHabilitada = $state(true);
  let estudiantes: EstudianteAsistencia[] = $state([]);
  let loading = $state(false);
  let saving = $state(false);
  let hasUnsavedChanges = $state(false);
  let pressingStatus: string | null = $state(null);
  let showSummaryModal = $state<{ show: boolean; type: string; stats: { total: number; m: number; f: number } | null }>({ show: false, type: "", stats: null });
  let selectedStudentDetail: EstudianteAsistencia | null = $state(null);
  let showClearConfirm = $state(false);
  let expandedObs: Record<number, boolean> = $state({});
  let obsModalStudent: EstudianteAsistencia | null = $state(null);
  let refreshingSilent = $state(false);

  let isMobile = $state(false);
  let isAndroid = $state(/Android/i.test(navigator.userAgent));
  let isWindows = $state(/Windows/i.test(navigator.userAgent));
  let isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));

  let draft: Record<number, { estado: string | null; observacion: string | null }> = {};
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  let totalEstudiantes = $derived(estudiantes.length);
  let totalM = $derived(estudiantes.filter(e => e.sexo === 'M').length);
  let totalF = $derived(estudiantes.filter(e => e.sexo === 'F').length);

  function getStats(estado: string | null) {
    const filtered = estudiantes.filter(e => e.estado === estado);
    return { total: filtered.length, m: filtered.filter(e => e.sexo === 'M').length, f: filtered.filter(e => e.sexo === 'F').length };
  }
  let statsP = $derived(getStats('P'));
  let statsA = $derived(getStats('A'));
  let statsJ = $derived(getStats('J'));

  let filteredEstudiantes = $derived(estudiantes.filter(est => est.nombre.toLowerCase().includes(searchTerm.toLowerCase())));

  function syncDraftToStorage() {
    if (Object.keys(draft).length > 0) sessionStorage.setItem("asistencia_draft", JSON.stringify(draft));
    else sessionStorage.removeItem("asistencia_draft");
  }

  onMount(() => {
    const savedDraft = sessionStorage.getItem("asistencia_draft");
    if (savedDraft) {
      try { draft = JSON.parse(savedDraft); if (Object.keys(draft).length > 0) hasUnsavedChanges = true; }
      catch (e) { console.error("Error cargando borrador:", e); }
    }
    const checkMobile = () => { isMobile = window.innerWidth <= 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('schooltracker-sync', () => { if (hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => refreshingSilent = true, 300); });

    let at: ReturnType<typeof setTimeout>;
    const u1 = listen("asistencia-updated", () => { if (hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => refreshingSilent = true, 500); });
    const u2 = listen("student-updated", () => { if (hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => { refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }, 500); });
    const u3 = listen("catalog-updated", () => { if (hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => { fetchCatalogs(); fetchColegioConfig(); if (selectedColegio && selectedAno) fetchGrados(); refreshingSilent = true; }, 500); });
    const u4 = listen("subjects-updated", () => { if (hasUnsavedChanges) return; fetchColegioConfig(); });
    fetchCatalogs();
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('schooltracker-sync', () => {});
      u1.then(f => f()); u2.then(f => f()); u3.then(f => f()); u4.then(f => f());
    };
  });

  $effect(() => {
    if (selectedColegio && selectedAno) { fetchGrados(); fetchColegioConfig(); }
    else { grados = []; selectedGrado = 0; }
  });

  $effect(() => {
    if (!selectedFecha || !colegioConfig) { isFechaHabilitada = true; return; }
    const date = new Date(selectedFecha + "T12:00:00");
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const habilitado = colegioConfig[dayNames[date.getDay()]] !== false;
    isFechaHabilitada = habilitado;
    if (!habilitado) estudiantes = [];
  });

  $effect(() => {
    if (selectedGrado && selectedColegio && selectedAno) fetchSecciones();
    else { secciones = []; selectedSeccion = 0; }
  });

  $effect(() => {
    if (selectedAno) localStorage.setItem("selectedAno", String(selectedAno));
    if (selectedColegio) localStorage.setItem("selectedColegio", String(selectedColegio));
    if (selectedGrado) localStorage.setItem("selectedGrado", String(selectedGrado));
    if (selectedSeccion) localStorage.setItem("selectedSeccion", String(selectedSeccion));
    localStorage.setItem("selectedSexo", selectedSexo);
    sessionStorage.setItem("asistencia_selectedFecha_v2", selectedFecha);
    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion && selectedFecha && isFechaHabilitada) fetchEstudiantes();
  });

  async function fetchCatalogs() {
    try {
      const [anosData, colegiosData, recommendedColegioId] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_colegios"),
        invoke<number>("get_recommended_colegio"),
      ]);
      const activeAno = anosData.find(a => a.activo)?.id || (anosData.length > 0 ? anosData[0].id : 0);
      let colegioToSelect = 0;
      if (recommendedColegioId && recommendedColegioId > 0) colegioToSelect = recommendedColegioId;
      else colegioToSelect = colegiosData.find(c => c.activo)?.id || (colegiosData.length > 0 ? colegiosData[0].id : 0);
      anos = anosData; colegios = colegiosData; selectedAno = activeAno; selectedColegio = colegioToSelect;
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  }

  async function fetchGrados() {
    try {
      const data = await invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: selectedColegio, anoLectivoId: selectedAno });
      grados = data;
      if (data.length > 0) { if (!data.some(g => g.id === selectedGrado)) selectedGrado = data[0].id; }
      else selectedGrado = 0;
    } catch (error) {
      console.error("Error fetching grados:", error);
      await emit("show-toast", { message: "❌ Error al cargar grados: " + error, type: "error" });
    }
  }

  async function fetchColegioConfig() {
    try { colegioConfig = await invoke("get_colegio_dias_asistencia", { colegioId: selectedColegio }); }
    catch (error) {
      console.error("Error fetching colegio config:", error);
      await emit("show-toast", { message: "❌ Error al cargar configuración del colegio: " + error, type: "error" });
    }
  }

  async function fetchSecciones() {
    try {
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: selectedGrado, colegioId: selectedColegio, anoLectivoId: selectedAno });
      secciones = data;
      if (data.length > 0) { if (!data.some(s => s.id === selectedSeccion)) selectedSeccion = data[0].id; }
      else selectedSeccion = 0;
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: "❌ Error al cargar secciones: " + error, type: "error" });
    }
  }

  async function fetchEstudiantes() {
    if (!refreshingSilent) loading = true;
    refreshingSilent = false;
    try {
      const data = await invoke<EstudianteAsistencia[]>("get_asistencia_estudiantes", {
        fecha: selectedFecha, anoLectivoId: selectedAno, colegioId: selectedColegio,
        gradoId: selectedGrado, seccionId: selectedSeccion, sexo: selectedSexo || null,
      });
      estudiantes = data.map(est => {
        const d = draft[est.id];
        if (d) return { ...est, estado: d.estado !== undefined ? d.estado : est.estado, observacion: d.observacion !== undefined ? d.observacion : est.observacion };
        return est;
      });
    } catch (error) {
      console.error("Error fetching students:", error);
      await emit("show-toast", { message: "❌ Error al cargar estudiantes: " + error, type: "error" });
    } finally { loading = false; }
  }

  async function saveChanges(updated: EstudianteAsistencia[]) {
    saving = true;
    try {
      const records = updated.filter(est => est.estado && ['P', 'A', 'J'].includes(est.estado)).map(est => ({ estudianteId: est.id, fecha: selectedFecha, estado: est.estado, observacion: est.observacion || '' }));
      if (records.length === 0) {
        const intentClear = updated.every(est => !est.estado || est.estado === '-');
        if (intentClear) {
          try {
            await invoke("delete_asistencia_batch", { estudianteIds: updated.map(est => est.id), fecha: selectedFecha });
            draft = {}; syncDraftToStorage(); hasUnsavedChanges = false; saving = false;
            await emit("show-toast", { message: "✅ Asistencia limpiada correctamente", type: "success" });
            onDataChange('asistencia');
            await emit("asistencia-updated");
          } catch (error) {
            console.error("Error al limpiar asistencia:", error);
            await emit("show-toast", { message: "❌ Error al limpiar asistencia: " + error, type: "error" });
            saving = false;
          }
        } else { saving = false; await emit("show-toast", { message: "⚠️ No hay asistencias marcadas para guardar.", type: "warning" }); }
        return;
      }
      await invoke("save_asistencia", { records });
      draft = {}; syncDraftToStorage(); hasUnsavedChanges = false; saving = false;
      await emit("show-toast", { message: "✅ Asistencia guardada localmente", type: "success" });
      onDataChange('asistencia');
      await emit("asistencia-updated");
    } catch (error) {
      console.error("Error saving attendance:", error);
      await emit("show-toast", { message: "❌ Error al guardar asistencia: " + error, type: "error" });
      saving = false;
    }
  }

  function handleEstadoChange(estudianteId: number, estado: string) {
    const current = estudiantes.find(est => est.id === estudianteId)?.estado;
    const newEstado = current === estado ? null : estado;
    draft[estudianteId] = { ...draft[estudianteId], estado: newEstado };
    syncDraftToStorage();
    estudiantes = estudiantes.map(est => est.id === estudianteId ? { ...est, estado: newEstado } : est);
    hasUnsavedChanges = true;
  }

  function handleObservacionChange(estudianteId: number, observacion: string) {
    draft[estudianteId] = { ...draft[estudianteId], observacion };
    syncDraftToStorage();
    estudiantes = estudiantes.map(est => est.id === estudianteId ? { ...est, observacion } : est);
    hasUnsavedChanges = true;
  }

  function marcarTodos(estado: string) {
    estudiantes.forEach(est => { draft[est.id] = { ...draft[est.id], estado }; });
    syncDraftToStorage();
    estudiantes = estudiantes.map(est => ({ ...est, estado }));
    hasUnsavedChanges = true;
  }

  function confirmClearAllStatus() {
    estudiantes.forEach(est => { draft[est.id] = { estado: "-", observacion: '' }; });
    syncDraftToStorage();
    estudiantes = estudiantes.map(est => ({ ...est, estado: "-", observacion: '' }));
    hasUnsavedChanges = true;
    showClearConfirm = false;
    emit("show-toast", { message: "🧹 Asistencia limpiada. Recuerda guardar los cambios.", type: "info" });
  }

  function handleManualSave() { saveChanges(estudiantes); }

  function limpiarAsistencia() { showClearConfirm = true; }

  function handleCardClick(type: string, stats: { total: number; m: number; f: number }) {
    showSummaryModal = { show: true, type, stats };
  }

  function toggleObs(est: EstudianteAsistencia) {
    if (obsModalStudent?.id === est.id) { obsModalStudent = null; expandedObs = {}; }
    else { obsModalStudent = est; expandedObs = { [est.id]: true }; }
  }

  async function handleFilterChange(setter: (v: any) => void, value: any) {
    if (hasUnsavedChanges) {
      const answer = await ask('Tienes cambios sin guardar. ¿Deseas guardarlos antes de continuar?', { title: 'Cambios sin guardar', kind: 'warning', okLabel: 'Guardar', cancelLabel: 'Descartar' });
      if (answer) {
        await saveChanges(estudiantes); hasUnsavedChanges = false; setter(value);
      } else { draft = {}; syncDraftToStorage(); hasUnsavedChanges = false; setter(value); }
    } else { setter(value); }
  }

  function handleLongPressStart(estado: string) {
    if (longPressTimer) return;
    pressingStatus = estado;
    longPressTimer = setTimeout(() => {
      marcarTodos(estado); pressingStatus = null; longPressTimer = null;
      const card = document.querySelector(`.summary-card.${estado.toLowerCase()}`);
      if (card) { card.classList.add('pulse-feedback'); setTimeout(() => card.classList.remove('pulse-feedback'), 500); }
    }, 1500);
  }

  function handleLongPressEnd() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    pressingStatus = null;
  }
</script>

<div class="page-container" style="height:100%;min-height:0">
  <style>
    .asistencia-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-top:0.5rem}
    .summary-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.5rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60px;transition:all 0.2s ease;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
    .summary-label{font-size:0.65rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.025em;margin-bottom:2px;display:block!important}
    .summary-value{font-size:1.1rem;font-weight:700;color:#fff;line-height:1}
    .gender-labels{display:flex;gap:0.4rem;margin-top:4px;font-size:0.6rem;font-weight:600}
    .gender-f{color:#f472b6}.gender-m{color:#60a5fa}
    .summary-card.students{border-left:3px solid var(--primary-color)}.summary-card.p{border-left:3px solid #10b981}
    .summary-card.a{border-left:3px solid #ef4444}.summary-card.j{border-left:3px solid #f59e0b}
    .summary-card.pressing{transform:scale(0.95);background:rgba(255,255,255,0.1)}
    .pressing-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(3px);pointer-events:none}
    .mass-marking-spinner{width:60px;height:60px;border:5px solid rgba(255,255,255,0.1);border-left-color:var(--primary-color);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:1rem;box-shadow:0 0 15px rgba(var(--primary-rgb), 0.5)}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:600px){.asistencia-summary{grid-template-columns:repeat(2,1fr)}}
    .asistencia-opt{width:26px!important;height:26px!important;font-size:0.7rem!important;min-width:26px!important;flex-shrink:0!important}
    .obs-toggle-btn{width:28px!important;height:28px!important;min-width:28px!important;font-size:0.8rem!important}
    .custom-table thead th{position:sticky;top:0;z-index:10;background:#1e293b!important}
  </style>

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile} style="padding:{isAndroidMobile ? '0.5rem' : '0.4rem'}">
        <FilterGroup label="Fecha:" {isMobile}>
          <input type="date" lang="es-ES" class="filter-select" class:invalid-date={!isFechaHabilitada}
            style="width:100%;border:{!isFechaHabilitada ? '1px solid #ef4444' : ''};color:{!isFechaHabilitada ? '#ef4444' : 'inherit'}"
            bind:value={selectedFecha} onclick={(e) => (e.target as HTMLInputElement).showPicker()} />
        </FilterGroup>
        <FilterGroup label="Año:" {isMobile}>
          <select class="filter-select" style="width:100%"
            value={selectedAno} onchange={(e) => handleFilterChange((v: number) => selectedAno = v, Number((e.target as HTMLSelectElement).value))}>
            {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Colegio:" {isMobile}>
          <select class="filter-select" style="width:100%"
            value={selectedColegio} onchange={(e) => handleFilterChange((v: number) => selectedColegio = v, Number((e.target as HTMLSelectElement).value))}>
            {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Grado:" {isMobile}>
          <select class="filter-select" style="width:100%"
            value={selectedGrado} onchange={(e) => handleFilterChange((v: number) => selectedGrado = v, Number((e.target as HTMLSelectElement).value))}>
            {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Sección:" {isMobile}>
          <select class="filter-select" style="width:100%"
            value={selectedSeccion} onchange={(e) => handleFilterChange((v: number) => selectedSeccion = v, Number((e.target as HTMLSelectElement).value))}>
            {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
          </select>
        </FilterGroup>
        <FilterGroup label="Sexo:" {isMobile}>
          <select class="filter-select" style="width:100%"
            value={selectedSexo} onchange={(e) => handleFilterChange((v: string) => selectedSexo = v, (e.target as HTMLSelectElement).value)}>
            <option value="">Todos</option><option value="M">Masculino</option><option value="F">Femenino</option>
          </select>
        </FilterGroup>
        <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isAndroidMobile ? '1 1 100%' : '0 0 auto'}">
          <div style="flex:1;min-width:80px">
            <SearchInput bind:value={searchTerm} onChange={(v: string) => searchTerm = v} placeholder="Buscar..." {isMobile} />
          </div>
          <button onclick={handleManualSave} disabled={!hasUnsavedChanges || saving}
            style="height:42px;padding:0 1.25rem;font-size:0.85rem;background-color:{hasUnsavedChanges && !saving ? 'var(--primary-color)' : (saving ? '#059669' : 'rgba(148,163,184,0.5)')};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{hasUnsavedChanges && !saving ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{hasUnsavedChanges && !saving ? '0 4px 14px rgba(var(--primary-rgb), 0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{hasUnsavedChanges || saving ? 1 : 0.7}">
            {#if saving}<span class="saving-dot"></span><span>{isAndroidMobile ? '' : 'Guardando'}</span>{:else}<span>💾</span><span>{isAndroidMobile ? '' : 'Guardar'}</span>{/if}
          </button>
          <button onclick={limpiarAsistencia} disabled={estudiantes.length === 0}
            style="height:42px;padding:0 1.25rem;font-size:0.85rem;background-color:{estudiantes.length > 0 ? '#ef4444' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{estudiantes.length > 0 ? 'pointer' : 'not-allowed'};transition:all 0.3s ease;box-shadow:{estudiantes.length > 0 ? '0 4px 14px rgba(239,68,68,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{estudiantes.length > 0 ? 1 : 0.7}">
            <span>🧹</span><span>{isAndroidMobile ? '' : 'Limpiar'}</span>
          </button>
          <div style="display:flex;gap:2px;align-items:stretch;flex-shrink:0">
            <button onclick={() => marcarTodos('P')} disabled={estudiantes.length === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:38px;background:{estudiantes.length > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {estudiantes.length > 0 ? 'rgba(16,185,129,0.3)' : 'transparent'};color:#10b981;border-radius:8px;cursor:{estudiantes.length > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{estudiantes.length > 0 ? 1 : 0.5}"
              title="Marcar todos como Presente">P</button>
            <button onclick={() => marcarTodos('A')} disabled={estudiantes.length === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:38px;background:{estudiantes.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {estudiantes.length > 0 ? 'rgba(239,68,68,0.3)' : 'transparent'};color:#ef4444;border-radius:8px;cursor:{estudiantes.length > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{estudiantes.length > 0 ? 1 : 0.5}"
              title="Marcar todos como Ausente">A</button>
            <button onclick={() => marcarTodos('J')} disabled={estudiantes.length === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:38px;background:{estudiantes.length > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {estudiantes.length > 0 ? 'rgba(245,158,11,0.3)' : 'transparent'};color:#f59e0b;border-radius:8px;cursor:{estudiantes.length > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{estudiantes.length > 0 ? 1 : 0.5}"
              title="Marcar todos como Justificado">J</button>
          </div>
        </div>
      </FilterContainer>
    {/snippet}

    {#if isAndroidMobile && filteredEstudiantes.length > 0}
      <div style="margin-top:0;margin-left:-0.4rem;margin-right:-0.4rem;padding:0.5rem 0.4rem 0.2rem;width:calc(100%+0.8rem);border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:0.5rem;align-items:stretch">
        <div style="display:flex;align-items:center;justify-content:center;gap:0.8rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.6rem;flex:0 0 auto">
          <div style="display:flex;align-items:center;gap:2px"><span style="color:#f472b6;font-weight:bold;font-size:0.8rem">F:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{totalF}</span></div>
          <div style="display:flex;align-items:center;gap:2px"><span style="color:#60a5fa;font-weight:bold;font-size:0.8rem">M:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{totalM}</span></div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-around;gap:0.3rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.3rem;flex:1;user-select:none">
          <div onclick={() => handleCardClick('Total', { total: totalEstudiantes, m: totalM, f: totalF })} style="display:flex;align-items:center;gap:2px;cursor:pointer">
            <span style="color:#06b6d4;font-weight:bold;font-size:0.8rem">E:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{totalEstudiantes}</span>
          </div>
          <div onclick={() => handleCardClick('Presentes', statsP)} onmousedown={() => handleLongPressStart('P')} onmouseup={handleLongPressEnd} onmouseleave={handleLongPressEnd}
            ontouchstart={(e) => { e.preventDefault(); handleLongPressStart('P'); }} ontouchend={handleLongPressEnd}
            style="display:flex;align-items:center;gap:2px;cursor:pointer;position:relative">
            <span style="color:#10b981;font-weight:bold;font-size:0.8rem">P:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsP.total}</span>
          </div>
          <div onclick={() => handleCardClick('Ausentes', statsA)} onmousedown={() => handleLongPressStart('A')} onmouseup={handleLongPressEnd} onmouseleave={handleLongPressEnd}
            ontouchstart={(e) => { e.preventDefault(); handleLongPressStart('A'); }} ontouchend={handleLongPressEnd}
            style="display:flex;align-items:center;gap:2px;cursor:pointer;position:relative">
            <span style="color:#ef4444;font-weight:bold;font-size:0.8rem">A:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsA.total}</span>
          </div>
          <div onclick={() => handleCardClick('Justificados', statsJ)} onmousedown={() => handleLongPressStart('J')} onmouseup={handleLongPressEnd} onmouseleave={handleLongPressEnd}
            ontouchstart={(e) => { e.preventDefault(); handleLongPressStart('J'); }} ontouchend={handleLongPressEnd}
            style="display:flex;align-items:center;gap:2px;cursor:pointer;position:relative">
            <span style="color:#f59e0b;font-weight:bold;font-size:0.8rem">J:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsJ.total}</span>
          </div>
        </div>
      </div>
    {/if}

    {#if !isAndroidMobile && filteredEstudiantes.length > 0}
      <div class="asistencia-summary" style="margin:0.5rem 0;padding:0 0.4rem;width:100%;max-width:100%">
        <div class="summary-card students" onclick={() => handleCardClick('Total', { total: totalEstudiantes, m: totalM, f: totalF })}>
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#06b6d4">E</span>: {totalEstudiantes}</span>
            <span class="gender-m">M: {totalM}</span><span class="gender-f">F: {totalF}</span>
          </div>
        </div>
        <div class="summary-card p" class:pressing={pressingStatus === 'P'} onclick={() => handleCardClick('Presentes', statsP)}
          onmousedown={() => handleLongPressStart('P')} onmouseup={handleLongPressEnd} onmouseleave={handleLongPressEnd}
          ontouchstart={(e) => { e.preventDefault(); handleLongPressStart('P'); }} ontouchend={handleLongPressEnd} oncontextmenu={(e) => e.preventDefault()}
          style="cursor:pointer;user-select:none" title="Mantén presionado para marcar todos como Presente">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#10b981">P</span>: {statsP.total}</span>
            <span class="gender-m">M: {statsP.m}</span><span class="gender-f">F: {statsP.f}</span>
          </div>
        </div>
        <div class="summary-card a" class:pressing={pressingStatus === 'A'} onclick={() => handleCardClick('Ausentes', statsA)}
          onmousedown={() => handleLongPressStart('A')} onmouseup={handleLongPressEnd} onmouseleave={handleLongPressEnd}
          ontouchstart={(e) => { e.preventDefault(); handleLongPressStart('A'); }} ontouchend={handleLongPressEnd} oncontextmenu={(e) => e.preventDefault()}
          style="cursor:pointer;user-select:none" title="Mantén presionado para marcar todos como Ausente">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#ef4444">A</span>: {statsA.total}</span>
            <span class="gender-m">M: {statsA.m}</span><span class="gender-f">F: {statsA.f}</span>
          </div>
        </div>
        <div class="summary-card j" class:pressing={pressingStatus === 'J'} onclick={() => handleCardClick('Justificados', statsJ)}
          onmousedown={() => handleLongPressStart('J')} onmouseup={handleLongPressEnd} onmouseleave={handleLongPressEnd}
          ontouchstart={(e) => { e.preventDefault(); handleLongPressStart('J'); }} ontouchend={handleLongPressEnd} oncontextmenu={(e) => e.preventDefault()}
          style="cursor:pointer;user-select:none" title="Mantén presionado para marcar todos como Justificado">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#f59e0b">J</span>: {statsJ.total}</span>
            <span class="gender-m">M: {statsJ.m}</span><span class="gender-f">F: {statsJ.f}</span>
          </div>
        </div>
      </div>
    {/if}

    <ScrollableTable>
      {#if loading}
        <div class="loading-state">Cargando estudiantes...</div>
      {:else if !isFechaHabilitada}
        <div style="padding:40px;text-align:center;background:rgba(239,68,68,0.1);border-radius:12px;border:1px dashed #ef4444;color:#ef4444">
          <h3>📅 Día no laborable</h3>
          <p>El colegio seleccionado no tiene habilitada la toma de asistencia para los días <strong>{new Date(selectedFecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'long' })}</strong>.</p>
        </div>
      {:else if filteredEstudiantes.length === 0}
        <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px;margin:0 1rem">
          <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📋'}</div>
          <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? 'No se encontraron resultados' : 'No hay estudiantes para mostrar'}</h4>
          <p style="color:#94a3b8;max-width:400px;margin:0 auto">{searchTerm ? `No se encontró ningún estudiante que coincida con "${searchTerm}"` : 'No se encontraron estudiantes para los filtros seleccionados.'}</p>
          {#if searchTerm}<button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">Limpiar búsqueda</button>{/if}
        </div>
      {:else if isAndroidMobile}
        <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
          {#each filteredEstudiantes as est, index}
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
              <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                <span style="font-size:1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick={() => selectedStudentDetail = est}>{est.nombre}</span>
                <button class="obs-toggle-btn" class:has-obs={!!est.observacion} class:active={!!expandedObs[est.id]}
                  onclick={() => toggleObs(est)} title="Observaciones" style="width:30px;height:30px;min-width:30px;font-size:0.9rem;flex-shrink:0">{est.observacion ? '📝' : '💬'}</button>
              </div>
              <div style="display:flex;gap:0.4rem">
                <label onclick={() => handleEstadoChange(est.id, 'P')} style="flex:1;height:36px;font-size:0.85rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:bold;background:{est.estado === 'P' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'P' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'P' ? '#10b981' : '#94a3b8'}">
                  <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'P'} onchange={() => handleEstadoChange(est.id, 'P')} style="display:none" /><span>P</span>
                </label>
                <label onclick={() => handleEstadoChange(est.id, 'A')} style="flex:1;height:36px;font-size:0.85rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:bold;background:{est.estado === 'A' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'A' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'A' ? '#ef4444' : '#94a3b8'}">
                  <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'A'} onchange={() => handleEstadoChange(est.id, 'A')} style="display:none" /><span>A</span>
                </label>
                <label onclick={() => handleEstadoChange(est.id, 'J')} style="flex:1;height:36px;font-size:0.85rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:bold;background:{est.estado === 'J' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'J' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'J' ? '#f59e0b' : '#94a3b8'}">
                  <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'J'} onchange={() => handleEstadoChange(est.id, 'J')} style="display:none" /><span>J</span>
                </label>
              </div>
              {#if expandedObs[est.id]}
                <div style="margin-top:0.4rem">
                  <input type="text" placeholder="Observación..." value={est.observacion || ''} oninput={(e) => handleObservacionChange(est.id, (e.target as HTMLInputElement).value)}
                    style="width:100%;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#fff;font-size:0.8rem;outline:none;box-sizing:border-box" />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <table class="custom-table" style="width:100%;margin:0;overflow:visible">
          <thead><tr>
            <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
            <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Estudiante</th>
            <th style="width:100px;position:sticky;top:0;background:#1e293b;z-index:10">Asistencia</th>
            <th style="width:65px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">Obs</th>
          </tr></thead>
          <tbody>
            {#each filteredEstudiantes as est, index}
              <tr>
                <td><span class="student-number-badge">{index + 1}</span></td>
                <td style="text-align:left;overflow:hidden">
                  <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;width:100%" onclick={() => selectedStudentDetail = est}>
                    <span style="font-size:1.1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{est.nombre}</span>
                  </div>
                  <div style="font-size:0.7rem;opacity:0.6;margin-left:22px">{est.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                </td>
                <td>
                  <div class="asistencia-options-mobile" style="display:flex;gap:2px">
                    <label class="asistencia-opt" class:active={est.estado === 'P'} class:p={est.estado === 'P'} style="display:flex;align-items:center;justify-content:center"
                      onclick={() => handleEstadoChange(est.id, 'P')}>
                      <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'P'} onchange={() => handleEstadoChange(est.id, 'P')} style="display:none" /><span>P</span>
                    </label>
                    <label class="asistencia-opt" class:active={est.estado === 'A'} class:a={est.estado === 'A'} style="display:flex;align-items:center;justify-content:center"
                      onclick={() => handleEstadoChange(est.id, 'A')}>
                      <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'A'} onchange={() => handleEstadoChange(est.id, 'A')} style="display:none" /><span>A</span>
                    </label>
                    <label class="asistencia-opt" class:active={est.estado === 'J'} class:j={est.estado === 'J'} style="display:flex;align-items:center;justify-content:center"
                      onclick={() => handleEstadoChange(est.id, 'J')}>
                      <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'J'} onchange={() => handleEstadoChange(est.id, 'J')} style="display:none" /><span>J</span>
                    </label>
                  </div>
                </td>
                <td style="text-align:center;padding:0.2rem">
                  <button class="obs-toggle-btn" class:has-obs={!!est.observacion} class:active={!!expandedObs[est.id]}
                    onclick={() => toggleObs(est)} title="Observaciones">{est.observacion ? '📝' : '💬'}</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </ScrollableTable>
  </PageLayout>

  {#if showSummaryModal.show}
    <div class="modal-overlay" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }}>
      <div class="modal-content category-card" style="width:300px;max-width:85%;padding:1.2rem;text-align:center" onclick={(e) => e.stopPropagation()}>
        <h3 style="margin-top:0;color:var(--primary-color);font-size:1.2rem;margin-bottom:1rem">📊 {showSummaryModal.type}</h3>
        <div style="display:flex;flex-direction:column;gap:0.8rem">
          <div style="background:rgba(255,255,255,0.05);padding:0.8rem;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="color:#94a3b8">Total:</span><span style="font-size:1.3rem;font-weight:bold;color:#fff">{showSummaryModal.stats?.total}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem">
            <div style="background:rgba(96,165,250,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:4px">
              <span style="color:#60a5fa;font-size:0.8rem">Masculino</span><span style="font-size:1.2rem;font-weight:bold;color:#60a5fa">{showSummaryModal.stats?.m}</span>
            </div>
            <div style="background:rgba(244,114,182,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:4px">
              <span style="color:#f472b6;font-size:0.8rem">Femenino</span><span style="font-size:1.2rem;font-weight:bold;color:#f472b6">{showSummaryModal.stats?.f}</span>
            </div>
          </div>
        </div>
        <button class="primary" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }} style="margin-top:1.5rem;width:100%">Cerrar</button>
      </div>
    </div>
  {/if}

  {#if showClearConfirm}
    <div class="modal-overlay">
      <div class="modal-content category-card" style="width:400px;max-width:90%;padding:1.5rem">
        <h3 style="margin-top:0;color:#f87171">⚠️ Confirmar Limpieza</h3>
        <div style="margin:1.5rem 0;color:#e2e8f0;font-size:0.95rem;line-height:1.5">¿Está seguro de limpiar todos los estados de asistencia seleccionados?</div>
        <div style="display:flex;justify-content:flex-end;gap:1rem">
          <button class="cancel" onclick={() => showClearConfirm = false}>Cancelar</button>
          <button class="primary" onclick={confirmClearAllStatus} style="background-color:#ef4444">Limpiar Todo</button>
        </div>
      </div>
    </div>
  {/if}

  {#if selectedStudentDetail}
    <div class="modal-overlay" onclick={() => selectedStudentDetail = null}>
      <div class="modal-content category-card" onclick={(e) => e.stopPropagation()} style="width:400px;max-width:90%;padding:1.5rem;text-align:center;display:flex;flex-direction:column;gap:1rem">
        <div style="width:60px;height:60px;border-radius:50%;background-color:var(--primary-light);color:var(--primary-color);display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin:0 auto">👤</div>
        <div>
          <h3 style="margin:0.5rem 0;color:#fff;font-size:1.2rem">{selectedStudentDetail.nombre}</h3>
          <div style="display:inline-block;padding:0.3rem 0.8rem;border-radius:20px;background:{selectedStudentDetail.sexo === 'M' ? 'rgba(96,165,250,0.1)' : 'rgba(244,114,182,0.1)'};color:{selectedStudentDetail.sexo === 'M' ? '#60a5fa' : '#f472b6'};font-size:0.85rem;font-weight:600;margin-top:0.3rem">{selectedStudentDetail.sexo === 'M' ? 'Masculino' : 'Femenino'}</div>
        </div>
        <button class="primary" onclick={() => selectedStudentDetail = null} style="margin-top:1rem;width:100%">Cerrar</button>
      </div>
    </div>
  {/if}

  {#if pressingStatus}
    <div class="pressing-overlay">
      <div class="mass-marking-spinner"></div>
      <div style="color:white;font-weight:bold;font-size:1.1rem;text-shadow:0 2px 10px rgba(0,0,0,0.5);text-align:center;padding:0 2rem">
        Marcando todos como {pressingStatus === 'P' ? 'Presentes' : pressingStatus === 'A' ? 'Ausentes' : 'Justificados'}...
      </div>
    </div>
  {/if}

  {#if obsModalStudent}
    <div class="modal-overlay" onclick={() => obsModalStudent = null}>
      <div class="modal-content category-card" onclick={(e) => e.stopPropagation()} style="width:350px;max-width:90%;padding:1.2rem;text-align:left;position:relative">
        <button onclick={() => obsModalStudent = null}
          onmouseenter={(e) => { (e.target as HTMLElement).style.color = '#ef4444'; (e.target as HTMLElement).style.background = 'rgba(239,68,68,0.1)'; }}
          onmouseleave={(e) => { (e.target as HTMLElement).style.color = '#94a3b8'; (e.target as HTMLElement).style.background = 'transparent'; }}
          style="position:absolute;top:10px;right:10px;background:transparent;border:none;color:#94a3b8;font-size:1rem;cursor:pointer;padding:6px 10px;border-radius:6px;transition:all 0.2s">✕</button>
        <h3 style="margin-top:0;margin-bottom:1rem;font-size:1rem;color:#94a3b8;padding-right:20px">📝 Observación - {obsModalStudent.nombre.split(' ')[0]}</h3>
        <textarea style="width:100%;min-height:100px;padding:0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(15,23,42,0.6);color:#fff;font-size:0.9rem;resize:vertical;box-sizing:border-box"
          value={obsModalStudent.observacion || ''} placeholder="Escribe una observación..."
          oninput={(e) => { const v = (e.target as HTMLTextAreaElement).value; handleObservacionChange(obsModalStudent!.id, v); obsModalStudent = { ...obsModalStudent!, observacion: v }; }} />
        <div style="display:flex;gap:0.5rem;margin-top:1rem">
          <button class="primary" onclick={() => obsModalStudent = null} style="flex:1">✓ Listo</button>
          {#if obsModalStudent.observacion}
            <button onclick={() => { handleObservacionChange(obsModalStudent!.id, ''); obsModalStudent = null; }}
              style="background:rgba(239,68,68,0.2);border:1px solid #ef4444;border-radius:6px;padding:0.5rem 1rem;color:#ef4444;cursor:pointer">🗑️</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
