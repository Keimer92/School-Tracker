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
  interface DiaEstado { estado: string | null; observacion: string | null; }

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
  let pendingRefreshOnSave = $state(false);
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

  type AsistenciaPeriodo = "diario" | "semanal" | "mensual";
  let periodo = $state<AsistenciaPeriodo>((localStorage.getItem("asistencia_periodo") as AsistenciaPeriodo) || "diario");

  let estudiantesMulti: Array<{ id: number; nombre: string; codigo: string; sexo: string; dias: Record<string, DiaEstado> }> = $state([]);
  let fechasPeriodo: string[] = $state([]);
  let draftMulti: Record<number, Record<string, DiaEstado>> = $state({});
  let mesSeleccionado = $state(new Date().getMonth() + 1);
  let anoSeleccionado = $state(new Date().getFullYear());
  let mesesOptions = $derived(Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleDateString('es-ES', { month: 'long' }) })));
  let anosOptions = $derived(anos.length > 0 ? anos.filter(a => a.activo || Number(a.nombre) >= 2020) : [{ id: new Date().getFullYear(), nombre: String(new Date().getFullYear()) }]);

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
  let filteredEstudiantesMulti = $derived(estudiantesMulti.filter(est => est.nombre.toLowerCase().includes(searchTerm.toLowerCase())));

  function syncDraftToStorage() {
    if (Object.keys(draft).length > 0) sessionStorage.setItem("asistencia_draft", JSON.stringify(draft));
    else sessionStorage.removeItem("asistencia_draft");
  }

  function syncDraftMultiToStorage() {
    if (Object.keys(draftMulti).length > 0) sessionStorage.setItem("asistencia_draft_multi", JSON.stringify(draftMulti));
    else sessionStorage.removeItem("asistencia_draft_multi");
  }

  function computeWeekDates(baseDate: string): string[] {
    const base = new Date(baseDate + "T12:00:00");
    const day = base.getDay();
    const diff = base.getDate() - day + (day === 0 ? -6 : 1);
    const lunes = new Date(base);
    lunes.setDate(diff);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      dates.push(getLocalDateISOString(d));
    }
    return dates;
  }

  function computeMonthDates(mes: number, ano: number): string[] {
    const primerDia = new Date(ano, mes - 1, 1);
    const ultimoDia = new Date(ano, mes, 0);
    const dates: string[] = [];
    const temp = new Date(primerDia);
    while (temp <= ultimoDia) {
      dates.push(getLocalDateISOString(temp));
      temp.setDate(temp.getDate() + 1);
    }
    return dates;
  }

  function getFechasPeriodo(): string[] {
    if (periodo === "semanal") return computeWeekDates(selectedFecha);
    if (periodo === "mensual") return computeMonthDates(mesSeleccionado, anoSeleccionado);
    return [selectedFecha];
  }

  function getDiasHabilitados(fechas: string[]): string[] {
    if (!colegioConfig) return fechas;
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return fechas.filter(f => {
      const d = new Date(f + "T12:00:00");
      return colegioConfig[dayNames[d.getDay()]] !== false;
    });
  }

  onMount(() => {
    const savedDraft = sessionStorage.getItem("asistencia_draft");
    if (savedDraft) {
      try { draft = JSON.parse(savedDraft); if (Object.keys(draft).length > 0) hasUnsavedChanges = true; }
      catch (e) { console.error("Error cargando borrador:", e); }
    }
    const savedDraftMulti = sessionStorage.getItem("asistencia_draft_multi");
    if (savedDraftMulti) {
      try { draftMulti = JSON.parse(savedDraftMulti); if (Object.keys(draftMulti).length > 0) hasUnsavedChanges = true; }
      catch (e) { console.error("Error cargando borrador multi:", e); }
    }
    const checkMobile = () => { isMobile = window.innerWidth <= 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('schooltracker-sync', () => { if (hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => refreshingSilent = true, 300); });

    let at: ReturnType<typeof setTimeout>;
    const u1 = listen("asistencia-updated", () => { if (hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => refreshingSilent = true, 500); });
    const u2 = listen("student-updated", () => { if (hasUnsavedChanges) { pendingRefreshOnSave = true; return; } clearTimeout(at); at = setTimeout(() => { refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }, 500); });
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
    if (periodo === "diario") {
      if (!selectedFecha || !colegioConfig) { isFechaHabilitada = true; return; }
      const date = new Date(selectedFecha + "T12:00:00");
      const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
      const habilitado = colegioConfig[dayNames[date.getDay()]] !== false;
      isFechaHabilitada = habilitado;
      if (!habilitado) estudiantes = [];
    } else {
      isFechaHabilitada = true;
    }
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
    localStorage.setItem("asistencia_periodo", periodo);
    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion) {
      if (periodo === "diario") {
        if (selectedFecha && isFechaHabilitada) fetchEstudiantes();
      } else {
        fetchEstudiantesMulti();
      }
    }
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

  async function fetchEstudiantesMulti() {
    if (!refreshingSilent) loading = true;
    refreshingSilent = false;
    try {
      const fechas = getDiasHabilitados(getFechasPeriodo());
      fechasPeriodo = fechas;
      const data = await invoke<Array<{ id: number; nombre: string; codigo: string; sexo: string; dias: Array<{ fecha: string; estado: string | null; observacion: string | null }> }>>("get_asistencia_estudiantes_rango", {
        fechaInicio: fechas[0], fechaFin: fechas[fechas.length - 1],
        gradoId: selectedGrado, seccionId: selectedSeccion, sexo: selectedSexo || null,
      });
      estudiantesMulti = data.map(est => {
        const diasRecord: Record<string, DiaEstado> = {};
        for (const d of est.dias) {
          diasRecord[d.fecha] = { estado: d.estado, observacion: d.observacion };
        }
        const savedDraft = draftMulti[est.id];
        if (savedDraft) {
          for (const fecha of fechas) {
            if (savedDraft[fecha]) {
              diasRecord[fecha] = { ...diasRecord[fecha], ...savedDraft[fecha] };
            }
          }
        }
        return { id: est.id, nombre: est.nombre, codigo: est.codigo, sexo: est.sexo, dias: diasRecord };
      });
    } catch (error) {
      console.error("Error fetching multi students:", error);
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
            if (pendingRefreshOnSave) { pendingRefreshOnSave = false; refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }
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
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }
      await emit("show-toast", { message: "✅ Asistencia guardada localmente", type: "success" });
      onDataChange('asistencia');
      await emit("asistencia-updated");
    } catch (error) {
      console.error("Error saving attendance:", error);
      await emit("show-toast", { message: "❌ Error al guardar asistencia: " + error, type: "error" });
      saving = false;
    }
  }

  async function saveChangesMulti() {
    saving = true;
    try {
      const records: Array<{ estudianteId: number; fecha: string; estado: string; observacion: string }> = [];
      for (const est of estudiantesMulti) {
        for (const fecha of fechasPeriodo) {
          const d = est.dias[fecha];
          const draftD = draftMulti[est.id]?.[fecha];
          const estado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null);
          const obs = draftD?.observacion !== undefined ? draftD.observacion : (d?.observacion || '');
          if (estado && ['P', 'A', 'J'].includes(estado)) {
            records.push({ estudianteId: est.id, fecha, estado, observacion: obs || '' });
          }
        }
      }
      if (records.length === 0) {
        saving = false;
        await emit("show-toast", { message: "⚠️ No hay asistencias marcadas para guardar.", type: "warning" });
        return;
      }
      await invoke("save_asistencia", { records });
      draftMulti = {}; syncDraftMultiToStorage(); hasUnsavedChanges = false; saving = false;
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }
      await emit("show-toast", { message: "✅ Asistencia guardada localmente", type: "success" });
      onDataChange('asistencia');
      await emit("asistencia-updated");
    } catch (error) {
      console.error("Error saving multi attendance:", error);
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

  function handleEstadoChangeMulti(estudianteId: number, fecha: string, estado: string) {
    const est = estudiantesMulti.find(e => e.id === estudianteId);
    if (!est) return;
    const current = est.dias[fecha]?.estado || null;
    const currentDraft = draftMulti[estudianteId]?.[fecha]?.estado;
    const effectiveCurrent = currentDraft !== undefined ? currentDraft : current;
    const newEstado = effectiveCurrent === estado ? null : estado;
    if (!draftMulti[estudianteId]) draftMulti[estudianteId] = {};
    draftMulti[estudianteId][fecha] = { estado: newEstado, observacion: est.dias[fecha]?.observacion || null };
    syncDraftMultiToStorage();
    estudiantesMulti = estudiantesMulti.map(e => {
      if (e.id !== estudianteId) return e;
      const newDias = { ...e.dias, [fecha]: { ...e.dias[fecha], estado: newEstado } };
      return { ...e, dias: newDias };
    });
    hasUnsavedChanges = true;
  }

  function handleObservacionChange(estudianteId: number, observacion: string) {
    draft[estudianteId] = { ...draft[estudianteId], observacion };
    syncDraftToStorage();
    estudiantes = estudiantes.map(est => est.id === estudianteId ? { ...est, observacion } : est);
    hasUnsavedChanges = true;
  }

  function handleObservacionChangeMulti(estudianteId: number, fecha: string, observacion: string) {
    if (!draftMulti[estudianteId]) draftMulti[estudianteId] = {};
    const existing = estudiantesMulti.find(e => e.id === estudianteId)?.dias[fecha];
    draftMulti[estudianteId][fecha] = { estado: draftMulti[estudianteId][fecha]?.estado ?? existing?.estado ?? null, observacion };
    syncDraftMultiToStorage();
    estudiantesMulti = estudiantesMulti.map(e => {
      if (e.id !== estudianteId) return e;
      return { ...e, dias: { ...e.dias, [fecha]: { ...e.dias[fecha], observacion } } };
    });
    hasUnsavedChanges = true;
  }

  function marcarTodos(estado: string) {
    if (periodo === "diario") {
      estudiantes.forEach(est => { draft[est.id] = { ...draft[est.id], estado }; });
      syncDraftToStorage();
      estudiantes = estudiantes.map(est => ({ ...est, estado }));
    } else {
      for (const est of estudiantesMulti) {
        for (const fecha of fechasPeriodo) {
          if (!draftMulti[est.id]) draftMulti[est.id] = {};
          draftMulti[est.id][fecha] = { ...draftMulti[est.id][fecha], estado };
        }
      }
      syncDraftMultiToStorage();
      estudiantesMulti = estudiantesMulti.map(est => {
        const newDias = { ...est.dias };
        for (const fecha of fechasPeriodo) {
          newDias[fecha] = { ...newDias[fecha], estado };
        }
        return { ...est, dias: newDias };
      });
    }
    hasUnsavedChanges = true;
  }

  function confirmClearAllStatus() {
    if (periodo === "diario") {
      estudiantes.forEach(est => { draft[est.id] = { estado: "-", observacion: '' }; });
      syncDraftToStorage();
      estudiantes = estudiantes.map(est => ({ ...est, estado: "-", observacion: '' }));
    } else {
      for (const est of estudiantesMulti) {
        for (const fecha of fechasPeriodo) {
          if (!draftMulti[est.id]) draftMulti[est.id] = {};
          draftMulti[est.id][fecha] = { estado: "-", observacion: '' };
        }
      }
      syncDraftMultiToStorage();
      estudiantesMulti = estudiantesMulti.map(est => {
        const newDias = { ...est.dias };
        for (const fecha of fechasPeriodo) {
          newDias[fecha] = { estado: "-", observacion: '' };
        }
        return { ...est, dias: newDias };
      });
    }
    hasUnsavedChanges = true;
    showClearConfirm = false;
    emit("show-toast", { message: "🧹 Asistencia limpiada. Recuerda guardar los cambios.", type: "info" });
  }

  function handleManualSave() {
    if (periodo === "diario") {
      saveChanges(estudiantes);
    } else {
      saveChangesMulti();
    }
  }

  function limpiarAsistencia() { showClearConfirm = true; }

  function handleCardClick(type: string, stats: { total: number; m: number; f: number }) {
    showSummaryModal = { show: true, type, stats };
  }

  function toggleObs(est: EstudianteAsistencia) {
    if (obsModalStudent?.id === est.id) { obsModalStudent = null; expandedObs = {}; }
    else { obsModalStudent = est; expandedObs = { [est.id]: true }; }
  }

  function cicloEstado(estudianteId: number, fecha: string) {
    const est = estudiantesMulti.find(e => e.id === estudianteId);
    if (!est) return;
    const current = est.dias[fecha]?.estado || null;
    const currentDraft = draftMulti[estudianteId]?.[fecha]?.estado;
    const effective = currentDraft !== undefined ? currentDraft : current;
    const next = effective === 'P' ? 'A' : effective === 'A' ? 'J' : effective === 'J' ? null : 'P';
    if (!draftMulti[estudianteId]) draftMulti[estudianteId] = {};
    draftMulti[estudianteId][fecha] = { estado: next, observacion: est.dias[fecha]?.observacion || null };
    syncDraftMultiToStorage();
    estudiantesMulti = estudiantesMulti.map(e => {
      if (e.id !== estudianteId) return e;
      return { ...e, dias: { ...e.dias, [fecha]: { ...e.dias[fecha], estado: next } } };
    });
    hasUnsavedChanges = true;
  }

  function getObsMulti(estudianteId: number, fecha: string): string {
    const est = estudiantesMulti.find(e => e.id === estudianteId);
    if (!est) return '';
    const d = est.dias[fecha];
    const draftD = draftMulti[estudianteId]?.[fecha];
    return draftD?.observacion !== undefined ? draftD.observacion : (d?.observacion || '');
  }

  async function handleFilterChange(setter: (v: any) => void, value: any) {
    if (hasUnsavedChanges) {
      const answer = await ask('Tienes cambios sin guardar. ¿Deseas guardarlos antes de continuar?', { title: 'Cambios sin guardar', kind: 'warning', okLabel: 'Guardar', cancelLabel: 'Descartar' });
      if (answer) {
        if (periodo === "diario") { await saveChanges(estudiantes); } else { await saveChangesMulti(); }
        hasUnsavedChanges = false; setter(value);
      } else {
        draft = {}; syncDraftToStorage(); draftMulti = {}; syncDraftMultiToStorage(); hasUnsavedChanges = false;
        if (pendingRefreshOnSave) { pendingRefreshOnSave = false; refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }
        setter(value);
      }
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

  function getActiveStudentCount(): number {
    if (periodo === "diario") return estudiantes.length;
    return estudiantesMulti.length;
  }

  function getMultiStats(estado: string) {
    let total = 0, m = 0, f = 0;
    for (const est of estudiantesMulti) {
      for (const fecha of fechasPeriodo) {
        const d = est.dias[fecha];
        const draftD = draftMulti[est.id]?.[fecha];
        const effective = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null);
        if (effective === estado) {
          total++;
          if (est.sexo === 'M') m++;
          else f++;
        }
      }
    }
    return { total, m, f };
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
    .dia-cell{display:flex;gap:1px;align-items:center;justify-content:center}
    .dia-cell .dia-opt{width:18px!important;height:22px!important;font-size:0.6rem!important;min-width:18px!important;padding:0!important;border-radius:3px!important;display:flex;align-items:center;justify-content:center;border:1px solid transparent;cursor:pointer;font-weight:700;transition:all 0.1s;background:rgba(255,255,255,0.05);color:#64748b}
    .dia-cell .dia-opt.active-p{background:rgba(16,185,129,0.2);border-color:#10b981;color:#10b981}
    .dia-cell .dia-opt.active-a{background:rgba(239,68,68,0.2);border-color:#ef4444;color:#ef4444}
    .dia-cell .dia-opt.active-j{background:rgba(245,158,11,0.2);border-color:#f59e0b;color:#f59e0b}
    .ciclo-cell{width:28px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.15s;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#64748b;margin:0 auto}
    .ciclo-cell.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .ciclo-cell.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .ciclo-cell.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .semanal-card-days{display:flex;gap:0.3rem;overflow-x:auto;padding-bottom:0.2rem}
    .semanal-day-chip{display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;min-width:48px}
    .semanal-day-label{font-size:0.55rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.2px;white-space:nowrap}
    .semanal-day-btns{display:flex;gap:1px}
    .semanal-day-btns button{width:20px;height:20px;font-size:0.55rem;font-weight:700;border:none;border-radius:3px;cursor:pointer;transition:all 0.1s;background:rgba(255,255,255,0.05);color:#64748b;display:flex;align-items:center;justify-content:center;padding:0}
    .semanal-day-btns button.active-p{background:rgba(16,185,129,0.2);color:#10b981}
    .semanal-day-btns button.active-a{background:rgba(239,68,68,0.2);color:#ef4444}
    .semanal-day-btns button.active-j{background:rgba(245,158,11,0.2);color:#f59e0b}
    .mensual-chip-row{display:flex;gap:2px;overflow-x:auto;padding-bottom:0.2rem}
    .mensual-chip{width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;cursor:pointer;flex-shrink:0;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#64748b;transition:all 0.1s}
    .mensual-chip.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .mensual-chip.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .mensual-chip.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
  </style>

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile} style="padding:{isAndroidMobile ? '0.5rem' : '0.4rem'}">
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;width:100%">
          <FilterGroup label="Período:" {isMobile}>
            <select class="filter-select" bind:value={periodo} style="width:100%">
              <option value="diario">Diario</option>
              <option value="semanal">Semanal</option>
              <option value="mensual">Mensual</option>
            </select>
          </FilterGroup>
          {#if periodo === "mensual"}
            <FilterGroup label="Mes:" {isMobile}>
              <select class="filter-select" style="width:100%;min-width:100px"
                value={mesSeleccionado} onchange={(e) => mesSeleccionado = Number((e.target as HTMLSelectElement).value)}>
                {#each mesesOptions as m}<option value={m.value}>{m.label}</option>{/each}
              </select>
            </FilterGroup>
            <FilterGroup label="Año:" {isMobile}>
              <select class="filter-select" style="width:100%;min-width:90px"
                value={anoSeleccionado} onchange={(e) => anoSeleccionado = Number((e.target as HTMLSelectElement).value)}>
                {#each anosOptions as a}<option value={Number(a.nombre)}>{a.nombre}</option>{/each}
              </select>
            </FilterGroup>
          {:else}
            <FilterGroup label={periodo === 'semanal' ? 'Semana:' : 'Fecha:'} {isMobile}>
              <input type="date" lang="es-ES" class="filter-select" class:invalid-date={!isFechaHabilitada}
                style="width:100%;min-width:130px;border:{!isFechaHabilitada ? '1px solid #ef4444' : ''};color:{!isFechaHabilitada ? '#ef4444' : 'inherit'}"
                bind:value={selectedFecha} onclick={(e) => (e.target as HTMLInputElement).showPicker()} />
            </FilterGroup>
          {/if}
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
        </div>
        <div style="display:flex;gap:0.3rem;align-items:flex-end;flex-wrap:wrap;margin-top:0.3rem">
          <button onclick={handleManualSave} disabled={!hasUnsavedChanges || saving}
            style="height:42px;padding:0 1.25rem;font-size:0.85rem;background-color:{hasUnsavedChanges && !saving ? 'var(--primary-color)' : (saving ? '#059669' : 'rgba(148,163,184,0.5)')};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{hasUnsavedChanges && !saving ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{hasUnsavedChanges && !saving ? '0 4px 14px rgba(var(--primary-rgb), 0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{hasUnsavedChanges || saving ? 1 : 0.7}">
            {#if saving}<span class="saving-dot"></span><span>{isAndroidMobile ? '' : 'Guardando'}</span>{:else}<span>💾</span><span>{isAndroidMobile ? '' : 'Guardar'}</span>{/if}
          </button>
          <button onclick={limpiarAsistencia} disabled={getActiveStudentCount() === 0}
            style="height:42px;padding:0 1.25rem;font-size:0.85rem;background-color:{getActiveStudentCount() > 0 ? '#ef4444' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};transition:all 0.3s ease;box-shadow:{getActiveStudentCount() > 0 ? '0 4px 14px rgba(239,68,68,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{getActiveStudentCount() > 0 ? 1 : 0.7}">
            <span>🧹</span><span>{isAndroidMobile ? '' : 'Limpiar'}</span>
          </button>
          <div style="display:flex;gap:2px;align-items:stretch;flex-shrink:0">
            <button onclick={() => marcarTodos('P')} disabled={getActiveStudentCount() === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:38px;background:{getActiveStudentCount() > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {getActiveStudentCount() > 0 ? 'rgba(16,185,129,0.3)' : 'transparent'};color:#10b981;border-radius:8px;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{getActiveStudentCount() > 0 ? 1 : 0.5}"
              title="Marcar todos como Presente">P</button>
            <button onclick={() => marcarTodos('A')} disabled={getActiveStudentCount() === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:38px;background:{getActiveStudentCount() > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {getActiveStudentCount() > 0 ? 'rgba(239,68,68,0.3)' : 'transparent'};color:#ef4444;border-radius:8px;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{getActiveStudentCount() > 0 ? 1 : 0.5}"
              title="Marcar todos como Ausente">A</button>
            <button onclick={() => marcarTodos('J')} disabled={getActiveStudentCount() === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:38px;background:{getActiveStudentCount() > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {getActiveStudentCount() > 0 ? 'rgba(245,158,11,0.3)' : 'transparent'};color:#f59e0b;border-radius:8px;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{getActiveStudentCount() > 0 ? 1 : 0.5}"
              title="Marcar todos como Justificado">J</button>
          </div>
          <div style="flex:1;min-width:100px">
            <SearchInput bind:value={searchTerm} onChange={(v: string) => searchTerm = v} placeholder="Buscar..." {isMobile} height="42px" />
          </div>
        </div>
      </FilterContainer>
    {/snippet}

    {#if periodo === "diario"}
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
    {:else}
      {#if isAndroidMobile && filteredEstudiantesMulti.length > 0}
        <div style="margin-top:0;margin-left:-0.4rem;margin-right:-0.4rem;padding:0.5rem 0.4rem 0.2rem;width:calc(100%+0.8rem);border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:0.5rem;align-items:stretch">
          <div style="display:flex;align-items:center;justify-content:center;gap:0.8rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.6rem;flex:0 0 auto">
            <div style="display:flex;align-items:center;gap:2px"><span style="color:#f472b6;font-weight:bold;font-size:0.8rem">F:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{filteredEstudiantesMulti.filter(e => e.sexo === 'F').length}</span></div>
            <div style="display:flex;align-items:center;gap:2px"><span style="color:#60a5fa;font-weight:bold;font-size:0.8rem">M:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{filteredEstudiantesMulti.filter(e => e.sexo === 'M').length}</span></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-around;gap:0.3rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.3rem;flex:1;user-select:none">
            <div onclick={() => handleCardClick('Total', { total: filteredEstudiantesMulti.length, m: filteredEstudiantesMulti.filter(e => e.sexo === 'M').length, f: filteredEstudiantesMulti.filter(e => e.sexo === 'F').length })} style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#06b6d4;font-weight:bold;font-size:0.8rem">E:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{filteredEstudiantesMulti.length}</span>
            </div>
            {#each ['P', 'A', 'J'] as estado}
              {@const st = getMultiStats(estado)}
              <div onclick={() => handleCardClick(estado === 'P' ? 'Presentes' : estado === 'A' ? 'Ausentes' : 'Justificados', st)}
                style="display:flex;align-items:center;gap:2px;cursor:pointer;position:relative">
                <span style="color:{estado === 'P' ? '#10b981' : estado === 'A' ? '#ef4444' : '#f59e0b'};font-weight:bold;font-size:0.8rem">{estado}:</span>
                <span style="color:#fff;font-weight:bold;font-size:0.9rem">{st.total}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if !isAndroidMobile && filteredEstudiantesMulti.length > 0}
        <div class="asistencia-summary" style="margin:0.5rem 0;padding:0 0.4rem;width:100%;max-width:100%">
          <div class="summary-card students" onclick={() => handleCardClick('Total', { total: filteredEstudiantesMulti.length, m: filteredEstudiantesMulti.filter(e => e.sexo === 'M').length, f: filteredEstudiantesMulti.filter(e => e.sexo === 'F').length })}>
            <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
              <span><span style="color:#06b6d4">E</span>: {filteredEstudiantesMulti.length}</span>
              <span class="gender-m">M: {filteredEstudiantesMulti.filter(e => e.sexo === 'M').length}</span><span class="gender-f">F: {filteredEstudiantesMulti.filter(e => e.sexo === 'F').length}</span>
            </div>
          </div>
          {#each ['P', 'A', 'J'] as estado}
            {@const st = getMultiStats(estado)}
            <div class="summary-card {estado.toLowerCase()}" onclick={() => handleCardClick(estado === 'P' ? 'Presentes' : estado === 'A' ? 'Ausentes' : 'Justificados', st)}
              style="cursor:pointer;user-select:none">
              <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
                <span><span style="color:{estado === 'P' ? '#10b981' : estado === 'A' ? '#ef4444' : '#f59e0b'}">{estado}</span>: {st.total}</span>
                <span class="gender-m">M: {st.m}</span><span class="gender-f">F: {st.f}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <ScrollableTable>
        {#if loading}
          <div class="loading-state">Cargando estudiantes...</div>
        {:else if fechasPeriodo.length === 0}
          <div style="padding:40px;text-align:center;background:rgba(239,68,68,0.1);border-radius:12px;border:1px dashed #ef4444;color:#ef4444">
            <h3>📅 Sin días hábiles</h3>
            <p>No hay días hábiles configurados para el período seleccionado.</p>
          </div>
        {:else if filteredEstudiantesMulti.length === 0}
          <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px;margin:0 1rem">
            <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📋'}</div>
            <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? 'No se encontraron resultados' : 'No hay estudiantes para mostrar'}</h4>
            <p style="color:#94a3b8;max-width:400px;margin:0 auto">{searchTerm ? `No se encontró ningún estudiante que coincida con "${searchTerm}"` : 'No se encontraron estudiantes para los filtros seleccionados.'}</p>
            {#if searchTerm}<button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">Limpiar búsqueda</button>{/if}
          </div>
        {:else if isAndroidMobile && periodo === "semanal"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each filteredEstudiantesMulti as est, index}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="font-size:1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{est.nombre}</span>
                </div>
                <div class="semanal-card-days">
                  {#each fechasPeriodo as fecha}
                    {@const dayName = new Date(fecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' }).replace('.','')}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <div class="semanal-day-chip">
                      <span class="semanal-day-label">{dayName}</span>
                      <div class="semanal-day-btns">
                        <button class:active-p={effectiveEstado === 'P'} onclick={() => handleEstadoChangeMulti(est.id, fecha, 'P')}>P</button>
                        <button class:active-a={effectiveEstado === 'A'} onclick={() => handleEstadoChangeMulti(est.id, fecha, 'A')}>A</button>
                        <button class:active-j={effectiveEstado === 'J'} onclick={() => handleEstadoChangeMulti(est.id, fecha, 'J')}>J</button>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if isAndroidMobile && periodo === "mensual"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each filteredEstudiantesMulti as est, index}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="font-size:1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{est.nombre}</span>
                </div>
                <div class="mensual-chip-row">
                  {#each fechasPeriodo as fecha}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <div class="mensual-chip" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                      onclick={() => cicloEstado(est.id, fecha)}
                      title={new Date(fecha + "T12:00:00").toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}>
                      {new Date(fecha + "T12:00:00").getDate()}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if periodo === "semanal"}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible">
            <thead><tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Estudiante</th>
              {#each fechasPeriodo as fecha}
                <th style="min-width:65px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">
                  {new Date(fecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }).replace('.','').replace(',','')}
                </th>
              {/each}
              <th style="width:40px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">Obs</th>
            </tr></thead>
            <tbody>
              {#each filteredEstudiantesMulti as est, index}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left;overflow:hidden;max-width:120px">
                    <span style="font-weight:bold;font-size:0.85rem;cursor:pointer" onclick={() => selectedStudentDetail = est as any}>{est.nombre}</span>
                    <div style="font-size:0.65rem;opacity:0.6">{est.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                  </td>
                  {#each fechasPeriodo as fecha}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <td style="text-align:center;padding:0.2rem">
                      <div class="dia-cell">
                        <button class="dia-opt" class:active-p={effectiveEstado === 'P'} onclick={() => handleEstadoChangeMulti(est.id, fecha, 'P')}>P</button>
                        <button class="dia-opt" class:active-a={effectiveEstado === 'A'} onclick={() => handleEstadoChangeMulti(est.id, fecha, 'A')}>A</button>
                        <button class="dia-opt" class:active-j={effectiveEstado === 'J'} onclick={() => handleEstadoChangeMulti(est.id, fecha, 'J')}>J</button>
                      </div>
                    </td>
                  {/each}
                  <td style="text-align:center;padding:0.2rem">
                    <button class="obs-toggle-btn" class:has-obs={!!getObsMulti(est.id, fechasPeriodo[0])}
                      onclick={() => {}}
                      style="width:24px;height:24px;min-width:24px;font-size:0.7rem;padding:0;border-radius:4px"
                      title="Observaciones">💬</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if periodo === "mensual"}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible">
            <thead><tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Estudiante</th>
              {#each fechasPeriodo as fecha}
                <th style="width:28px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;font-size:0.65rem;font-weight:600;padding:0.15rem">
                  {new Date(fecha + "T12:00:00").getDate()}
                </th>
              {/each}
            </tr></thead>
            <tbody>
              {#each filteredEstudiantesMulti as est, index}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left;overflow:hidden;max-width:100px">
                    <span style="font-weight:bold;font-size:0.8rem;cursor:pointer" onclick={() => selectedStudentDetail = est as any}>{est.nombre.split(' ')[0]}</span>
                  </td>
                  {#each fechasPeriodo as fecha}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <td style="text-align:center;padding:0.1rem">
                      <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                        onclick={() => cicloEstado(est.id, fecha)}>
                        {effectiveEstado || '-'}
                      </div>
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </ScrollableTable>
    {/if}
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
