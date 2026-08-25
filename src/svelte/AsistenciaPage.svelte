<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import { ask } from "@tauri-apps/plugin-dialog";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SearchFab from "./SearchFab.svelte";
  import PageLayout from "./PageLayout.svelte";
  import ScrollableTable from "./ScrollableTable.svelte";
  import DatePickerGlass from "./DatePickerGlass.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }
  interface EstudianteAsistencia { id: number; nombre: string; codigo: string; sexo: string; estado: string | null; observacion: string | null; }
  interface DiaEstado { estado: string | null; observacion: string | null; }
  interface DiaSinClase { id: number; colegio_id: number; grado_id: number | null; seccion_id: number | null; fecha: string; descripcion: string; }

  // Visible = la página contenedora está activa Y este es el sub-tab seleccionado.
  // Controla el registro del back-handler y el refresco silencioso al volver a verse.
  let { visible = true }: { visible?: boolean } = $props();

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
  let showSummaryModal = $state<{ show: boolean; type: string; stats: { total: number; m: number; f: number } | null }>({ show: false, type: "", stats: null });
  let selectedStudentDetail: EstudianteAsistencia | null = $state(null);

  $effect(() => {
    if (!visible) return;
    if (selectedStudentDetail) {
      return registerBackHandler(() => { selectedStudentDetail = null; return true; });
    }
  });

  // Refresco silencioso al volver a verse (transición oculto → visible)
  let wasVisible = visible;
  $effect(() => {
    const nowVisible = visible;
    const prev = wasVisible;
    wasVisible = nowVisible;
    if (!nowVisible || prev) return;
    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion) {
      refreshingSilent = true;
      if (periodo === "diario") {
        if (selectedFecha && isFechaHabilitada) fetchEstudiantes();
      } else {
        fetchEstudiantesMulti();
      }
    }
  });
  let showClearConfirm = $state(false);
  let expandedObs: Record<number, boolean> = $state({});
  let obsModalStudent: EstudianteAsistencia | null = $state(null);
  let refreshingSilent = $state(false);
  let skipNextRefresh = $state(false);
  let monthlyPcts = $state<Record<number, number>>({});

  let isMobile = $state(false);
  let isAndroid = $state(/Android/i.test(navigator.userAgent));
  let isWindows = $state(/Windows/i.test(navigator.userAgent));
  let isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));
  let pageVisible = $state(true);

  let draft: Record<number, { estado: string | null; observacion: string | null }> = {};

  type AsistenciaPeriodo = "diario" | "semanal" | "mensual";
  let periodo = $state<AsistenciaPeriodo>((localStorage.getItem("asistencia_periodo") as AsistenciaPeriodo) || "diario");

  let estudiantesMulti: Array<{ id: number; nombre: string; codigo: string; sexo: string; dias: Record<string, DiaEstado> }> = $state([]);
  let fechasPeriodo: string[] = $state([]);
  let draftMulti: Record<number, Record<string, DiaEstado>> = $state({});
  let mesSeleccionado = $state(new Date().getMonth() + 1);
  let anoSeleccionado = $state(new Date().getFullYear());
  let mesesOptions = $derived(Array.from({ length: 12 }, (_, i) => {
    const raw = new Date(2000, i, 1).toLocaleDateString('es-ES', { month: 'long' });
    return { value: i + 1, label: raw.charAt(0).toUpperCase() + raw.slice(1) };
  }));
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
  let asistenciaPct = $derived(totalEstudiantes > 0 ? Math.round(statsP.total / totalEstudiantes * 100) : 0);
  let totalPosibleMulti = $derived(estudiantesMulti.length * fechasPeriodo.length);

  let filteredEstudiantes = $derived(estudiantes.filter(est => est.nombre.toLowerCase().includes(searchTerm.toLowerCase())));
  let filteredEstudiantesMulti = $derived(estudiantesMulti.filter(est => est.nombre.toLowerCase().includes(searchTerm.toLowerCase())));

  // ── Modo semanal: popover mes + semanas ──
  const pad2 = (n: number) => String(n).padStart(2, '0');
  function lunesDeISO(iso: string): string {
    const b = new Date(iso + "T12:00:00");
    const off = (b.getDay() + 6) % 7;
    b.setDate(b.getDate() - off);
    return `${b.getFullYear()}-${pad2(b.getMonth() + 1)}-${pad2(b.getDate())}`;
  }
  function sumaDiasISO(iso: string, n: number): string {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function fmtDM(iso: string): string {
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }

  interface SemanaOpt { n: number; lunes: string; domingo: string; rango: string }

  // Semanas del mes seleccionado — DERIVED PURO (sin efectos que escriban):
  // un $effect que lee+escribe selectedFecha aquí creaba un bucle que rompía
  // la reactividad del componente (selects congelados, semanas vacías).
  let semanasOpts = $derived.by(() => {
    const primerDia = `${anoSeleccionado}-${pad2(mesSeleccionado)}-01`;
    const off = (new Date(primerDia + 'T12:00:00').getDay() + 6) % 7;
    const lunes0 = sumaDiasISO(primerDia, -off);
    const finISO = sumaDiasISO(`${anoSeleccionado}-${pad2(mesSeleccionado)}-${new Date(anoSeleccionado, mesSeleccionado, 0).getDate()}`, 0);

    const opts: SemanaOpt[] = [];
    let lu = lunes0;
    let n = 1;
    while (lu <= finISO) {
      const dom = sumaDiasISO(lu, 6);
      opts.push({ n, lunes: lu, domingo: dom, rango: `${fmtDM(lu)} – ${fmtDM(dom)}` });
      lu = sumaDiasISO(lu, 7);
      n++;
    }
    return opts;
  });

  let popSemanaAbierta = $state(false);
  let popRootEl: HTMLElement | null = $state(null);

  let semanaActiva = $derived(
    semanasOpts.find(s => selectedFecha >= s.lunes && selectedFecha <= sumaDiasISO(s.lunes, 6))?.n ?? 1
  );

  function elegirSemana(s: SemanaOpt) {
    selectedFecha = s.lunes;
    popSemanaAbierta = false;
  }

  /** Cambia el mes del popover y alinea la fecha a ese mes si quedó fuera. */
  function cambiarMesSem(d: number) {
    let m = mesSeleccionado + d;
    let a = anoSeleccionado;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    mesSeleccionado = m;
    anoSeleccionado = a;
    const s0 = semanasOpts[0];
    if (s0 && !(selectedFecha >= s0.lunes && selectedFecha <= sumaDiasISO(s0.lunes, 6))) {
      selectedFecha = s0.lunes;
    }
  }

  function cerrarPopSemana() { popSemanaAbierta = false; }

  // Cierre por clic fuera + Back de Android
  $effect(() => {
    if (!popSemanaAbierta) return;
    const fuera = (e: Event) => {
      if (popRootEl && !popRootEl.contains(e.target as Node)) cerrarPopSemana();
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  });
  $effect(() => {
    if (!popSemanaAbierta) return;
    return registerBackHandler(() => { cerrarPopSemana(); return true; });
  });

  let nombreMesSel = $derived(
    ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][mesSeleccionado - 1] ?? ''
  );


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
      if (colegioConfig[dayNames[d.getDay()]] === false) return false;
      return !esDiaSinClases(f);
    });
  }

  // ── Días sin clases (feriados / sin actividad) por sección o colegio ──
  let diasSinClases = $state<DiaSinClase[]>([]);
  let popSinClasesAbierta = $state(false);
  let popSinClasesEl: HTMLElement | null = $state(null);
  let sinClasesDescripcion = $state('');
  let sinClasesGuardando = $state(false);

  function coberturaSinClases(fecha: string): DiaSinClase | undefined {
    return diasSinClases.find(d => d.fecha === fecha && (
      (d.grado_id === null && d.seccion_id === null) ||
      (d.grado_id === selectedGrado && d.seccion_id === selectedSeccion)
    ));
  }
  function esDiaSinClases(fecha: string): boolean { return !!coberturaSinClases(fecha); }

  async function fetchDiasSinClases() {
    if (!selectedColegio || !selectedSeccion) { diasSinClases = []; return; }
    try {
      const fechas = getFechasPeriodo();
      diasSinClases = await invoke<DiaSinClase[]>('get_dias_sin_clases', {
        colegioId: selectedColegio, gradoId: selectedGrado, seccionId: selectedSeccion,
        fechaInicio: fechas[0], fechaFin: fechas[fechas.length - 1],
      });
    } catch (e) { console.error('Error cargando días sin clases:', e); }
  }

  // ¿El período actual (diario/semanal) está totalmente marcado como sin clases?
  let sinClasesActivo = $derived.by(() => {
    if (periodo === 'mensual') return false;
    const objetivos = getDiasHabilitadosBase(getFechasPeriodo());
    return objetivos.length > 0 && objetivos.every(f => esDiaSinClases(f));
  });
  // true si la cobertura viene de una marca a nivel colegio (todas las fechas)
  let sinClasesNivelColegio = $derived.by(() => {
    const objetivos = getDiasHabilitadosBase(getFechasPeriodo());
    return objetivos.length > 0 && objetivos.every(f => {
      const d = diasSinClases.find(x => x.fecha === f);
      return !!d && d.grado_id === null && d.seccion_id === null;
    });
  });

  /** Días hábiles según configuración semanal del colegio, SIN filtrar días sin clases. */
  function getDiasHabilitadosBase(fechas: string[]): string[] {
    if (!colegioConfig) return fechas;
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return fechas.filter(f => colegioConfig[dayNames[new Date(f + "T12:00:00").getDay()]] !== false);
  }
  /** Fechas objetivo del botón: días hábibles de la semana/día actual. */
  function fechasObjetivoSinClases(): string[] {
    const base = getDiasHabilitadosBase(getFechasPeriodo());
    // En semanal solo se marcan los días que aún no están cubiertos por otra marca
    return base;
  }

  /** Días hábiles del período para pintar la tabla (incluye los sin clases con su marca). */
  let fechasVisibles = $derived.by(() => {
    return getDiasHabilitadosBase(getFechasPeriodo()).map(f => ({
      fecha: f,
      sinClases: esDiaSinClases(f),
    }));
  });
  function motivoSinClasesEn(fecha: string): string {
    return coberturaSinClases(fecha)?.descripcion || 'Sin clases';
  }

  function handleSinClasesClick() {
    if (sinClasesActivo) { desactivarSinClases(); return; }
    sinClasesDescripcion = '';
    popSinClasesAbierta = !popSinClasesAbierta;
  }

  async function activarSinClases(nivelColegio: boolean) {
    const motivo = sinClasesDescripcion.trim();
    if (!motivo) { emit("show-toast", { message: "⚠️ El motivo es obligatorio", type: "warning" }); return; }
    const objetivos = fechasObjetivoSinClases();
    if (objetivos.length === 0) return;
    const alcanceTxt = nivelColegio ? 'TODO el colegio' : 'solo esta sección';
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} al ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(`¿Marcar ${rangoTxt} como día(s) sin clases?\n\nAlcance: ${alcanceTxt}\nMotivo: ${motivo}`, { title: 'Marcar sin clases', kind: 'warning', okLabel: 'Sí, marcar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await invoke('set_dias_sin_clases', {
        colegioId: selectedColegio, gradoId: nivelColegio ? null : selectedGrado,
        seccionId: nivelColegio ? null : selectedSeccion,
        fechas: objetivos, descripcion: motivo, activo: true,
      });
      onDataChange('dia_sin_clases');
      popSinClasesAbierta = false;
      sinClasesDescripcion = '';
      await fetchDiasSinClases();
      emit("show-toast", { message: `🚫 ${nivelColegio ? 'Colegio' : 'Sección'}: ${objetivos.length} día(s) sin clases (${motivo})`, type: "success" });
    } catch (e) {
      console.error('Error marcando días sin clases:', e);
      await emit("show-toast", { message: "❌ Error al marcar días sin clases: " + e, type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  async function desactivarSinClases() {
    const objetivos = fechasObjetivoSinClases().filter(f => esDiaSinClases(f));
    if (objetivos.length === 0) return;
    // Si la cobertura completa viene de una marca de colegio, la quitamos a ese nivel
    const nivelColegio = objetivos.every(f => {
      const d = diasSinClases.find(x => x.fecha === f);
      return !!d && d.grado_id === null && d.seccion_id === null;
    });
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} al ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(`¿Reactivar las clases para ${rangoTxt}?\n\nSe quitará la marca de "${nivelColegio ? 'todo el colegio' : 'esta sección'}".`, { title: 'Reactivar clases', kind: 'info', okLabel: 'Sí, reactivar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await invoke('set_dias_sin_clases', {
        colegioId: selectedColegio, gradoId: nivelColegio ? null : selectedGrado,
        seccionId: nivelColegio ? null : selectedSeccion,
        fechas: objetivos, descripcion: '', activo: false,
      });
      onDataChange('dia_sin_clases');
      await fetchDiasSinClases();
      emit("show-toast", { message: "✅ Clases reactivadas para el período", type: "success" });
    } catch (e) {
      console.error('Error reactivando clases:', e);
      await emit("show-toast", { message: "❌ Error al reactivar clases: " + e, type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  // Cierre por clic fuera + Back de Android para el popover de sin clases
  $effect(() => {
    if (!popSinClasesAbierta) return;
    const fuera = (e: Event) => {
      if (popSinClasesEl && !popSinClasesEl.contains(e.target as Node)) popSinClasesAbierta = false;
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  });
  $effect(() => {
    if (!popSinClasesAbierta) return;
    return registerBackHandler(() => { popSinClasesAbierta = false; return true; });
  });

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

    const onVisibilityChange = () => { pageVisible = !document.hidden; };
    document.addEventListener('visibilitychange', onVisibilityChange);
    pageVisible = !document.hidden;

    function triggerRefresh() {
      if (selectedAno && selectedColegio && selectedGrado && selectedSeccion) {
        if (periodo === "diario") {
          if (selectedFecha && isFechaHabilitada) fetchEstudiantes();
        } else {
          fetchEstudiantesMulti();
        }
      }
    }

    window.addEventListener('schooltracker-sync', () => { if (!pageVisible || hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => { refreshingSilent = true; triggerRefresh(); }, 300); });

    let at: ReturnType<typeof setTimeout>;
    const u1 = listen("asistencia-updated", () => { if (!pageVisible || hasUnsavedChanges) return; if (skipNextRefresh) { skipNextRefresh = false; return; } clearTimeout(at); at = setTimeout(() => { refreshingSilent = true; triggerRefresh(); }, 500); });
    const u2 = listen("student-updated", () => { if (!pageVisible) return; if (hasUnsavedChanges) { pendingRefreshOnSave = true; return; } clearTimeout(at); at = setTimeout(() => { refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); triggerRefresh(); }, 500); });
    const u3 = listen("catalog-updated", () => { if (!pageVisible || hasUnsavedChanges) return; clearTimeout(at); at = setTimeout(() => { fetchCatalogs(); fetchColegioConfig(); if (selectedColegio && selectedAno) fetchGrados(); refreshingSilent = true; triggerRefresh(); }, 500); });
    const u4 = listen("subjects-updated", () => { if (hasUnsavedChanges) return; fetchColegioConfig(); });
    fetchCatalogs();
    return () => {
      window.removeEventListener('resize', checkMobile);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
      // Día sin clases (feriado / marca manual) se trata igual que día inhábil
      const sinClases = esDiaSinClases(selectedFecha);
      isFechaHabilitada = habilitado && !sinClases;
      if (!habilitado || sinClases) estudiantes = [];
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
      fetchDiasSinClases();
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
      fetchMonthlyPct();
    } catch (error) {
      console.error("Error fetching students:", error);
      await emit("show-toast", { message: "❌ Error al cargar estudiantes: " + error, type: "error" });
    } finally { loading = false; }
  }

  async function fetchMonthlyPct() {
    if (!selectedGrado || !selectedSeccion) return;
    try {
      const data = await invoke<Array<{ estudianteId: number; pct: number }>>("get_monthly_attendance_pct", {
        gradoId: selectedGrado, seccionId: selectedSeccion, fecha: selectedFecha,
      });
      const map: Record<number, number> = {};
      for (const item of data) {
        map[item.estudianteId] = item.pct;
      }
      monthlyPcts = map;
    } catch (error) {
      console.error("Error fetching monthly pct:", error);
    }
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
            onDataChange('asistencia', { immediate: true });
            skipNextRefresh = true;
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
      onDataChange('asistencia', { immediate: true });
      skipNextRefresh = true;
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
      onDataChange('asistencia', { immediate: true });
      skipNextRefresh = true;
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
    return draftD?.observacion ?? d?.observacion ?? '';
  }

  /** Cuenta cuántos días del período tienen ese estado (incluye borrador sin guardar). */
  function countMultiEstados(estId: number, estado: string): number {
    const est = estudiantesMulti.find(e => e.id === estId);
    if (!est) return 0;
    let n = 0;
    for (const f of fechasPeriodo) {
      const draftD = draftMulti[estId]?.[f];
      const eff = draftD?.estado !== undefined ? draftD.estado : (est.dias[f]?.estado || null);
      if (eff === estado) n++;
    }
    return n;
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
<SearchFab bind:value={searchTerm} placeholder="Buscar..." />


<div class="page-container" style="height:100%;min-height:0">
  <style>
    .summary-card{background:rgba(255,255,255,0.02);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:0.5rem 0.25rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60px;min-width:0;transition:all 0.25s cubic-bezier(0.4,0,0.2,1);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;position:relative;overflow:hidden;cursor:pointer}
    .summary-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,0.12);background:rgba(255,255,255,0.04)}
    .card-accent{position:absolute;top:0;left:0;right:0;height:3px;border-radius:12px 12px 0 0}
    .card-icon{font-size:1rem;margin-bottom:2px;line-height:1}
    .card-value{font-size:1.05rem;font-weight:700;color:#fff;line-height:1.2}
    .card-value.small{font-size:0.9rem}
    .card-label{font-size:0.5rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;font-weight:600}
    .card-gender{display:flex;gap:0.3rem;margin-top:2px;font-size:0.5rem;font-weight:600}
    .gender-f{color:#f472b6}.gender-m{color:#60a5fa}
    .pct-value{font-size:1.1rem;font-weight:800;line-height:1}
    .progress-bar-bg{width:100%;max-width:44px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:3px;overflow:hidden}
    .progress-bar-fill{height:100%;border-radius:2px;transition:width 0.6s ease}
    @media(max-width:600px){.asist-summary-grid-mob{grid-template-columns:repeat(2,1fr)}}
    .asistencia-opt{width:38px!important;height:38px!important;font-size:0.85rem!important;min-width:38px!important;flex-shrink:0!important;border-radius:10px!important;border:1px solid rgba(255,255,255,0.08)!important;background:rgba(255,255,255,0.03)!important;transition:all 0.15s cubic-bezier(0.4,0,0.2,1)!important;cursor:pointer!important}
    .asistencia-opt.p{background:rgba(16,185,129,0.15)!important;border-color:#10b981!important;color:#10b981!important}
    .asistencia-opt.a{background:rgba(239,68,68,0.15)!important;border-color:#ef4444!important;color:#ef4444!important}
    .asistencia-opt.j{background:rgba(245,158,11,0.15)!important;border-color:#f59e0b!important;color:#f59e0b!important}
    .asistencia-opt:active{transform:scale(0.92)}
    .obs-toggle-btn{width:34px!important;height:34px!important;min-width:34px!important;font-size:0.9rem!important;border-radius:8px!important}
    .custom-table thead th{position:sticky;top:0;z-index:10;background:#1e293b!important}
    .ciclo-cell{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.15s ease;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#64748b;margin:0 auto}
    .ciclo-cell:hover{border-color:rgba(255,255,255,0.2);background:rgba(255,255,255,0.06)}
    .ciclo-cell:active{transform:scale(0.92)}
    .ciclo-cell.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .ciclo-cell.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .ciclo-cell.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .mensual-chip-row{display:flex;gap:2px;overflow-x:auto;padding-bottom:0.2rem}
    .mensual-chip{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;cursor:pointer;flex-shrink:0;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#64748b;transition:all 0.15s ease}
    .mensual-chip:hover{border-color:rgba(255,255,255,0.2);background:rgba(255,255,255,0.06)}
    .mensual-chip:active{transform:scale(0.9)}
    .mensual-chip.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .mensual-chip.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .mensual-chip.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .asistencia-btn{padding:0.3rem 0.75rem;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#94a3b8;white-space:nowrap;transition:all 0.15s cubic-bezier(0.4,0,0.2,1)}
    .asistencia-btn:active{transform:scale(0.95)}
    .asistencia-btn.p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .asistencia-btn.a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .asistencia-btn.j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .pct-indicator{font-size:0.85rem;font-weight:700;white-space:nowrap}
    .obs-inline{width:100%;padding:0.3rem 0.5rem;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.3);color:#fff;font-size:0.75rem;outline:none;box-sizing:border-box;transition:border-color 0.2s}
    .obs-inline:focus{border-color:var(--primary-color)}
    .semanal-status{display:inline-block;padding:0.25rem 0.4rem;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#94a3b8;transition:all 0.15s ease;white-space:nowrap;text-align:center;user-select:none;width:100%;box-sizing:border-box}
    .semanal-status:active{transform:scale(0.95)}
    .semanal-status.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .semanal-status.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .semanal-status.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .semanal-obs{width:100%;padding:0.2rem 0.35rem;border-radius:4px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.2);color:#fff;font-size:0.6rem;outline:none;box-sizing:border-box;margin-top:2px;transition:border-color 0.2s}
    .semanal-obs:focus{border-color:var(--primary-color)}
    .pop-wrap{position:relative;display:block;width:100%}
    .pop-trigger{display:flex;align-items:center;justify-content:space-between;gap:.4rem;text-align:left;cursor:pointer}
    .pop-caret{color:#64748b;font-size:.7rem;flex-shrink:0}
    .pop-panel{position:absolute;top:calc(100% + 6px);left:0;width:min(280px,calc(100vw - 40px));box-sizing:border-box;padding:.75rem;border-radius:16px;background:rgba(13,20,36,.975);backdrop-filter:blur(24px) saturate(1.3);-webkit-backdrop-filter:blur(24px) saturate(1.3);border:1px solid rgba(255,255,255,.16);box-shadow:0 24px 60px -12px rgba(0,0,0,.7);z-index:1200;outline:none;animation:pop-in .18s cubic-bezier(.34,1.3,.64,1)}
    @keyframes pop-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
    .pop-mes{display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem}
    .pop-nav{width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#cbd5e1;font-size:.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s ease}
    .pop-nav:hover{background:rgba(255,255,255,.09);color:#fff}
    .pop-mes-txt{font-weight:700;font-size:.8rem;background-image:linear-gradient(90deg,#f472b6,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
    .pop-sems{display:flex;flex-direction:column;gap:3px;max-height:240px;overflow-y:auto}
    .pop-sem{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.5rem .6rem;border:none;border-radius:10px;background:transparent;color:#cbd5e1;font-size:.76rem;font-weight:600;cursor:pointer;text-align:left;transition:all .14s ease;-webkit-tap-highlight-color:transparent;border-left:2px solid transparent}
    .pop-sem:hover{background:rgba(244,114,182,.12);color:#fff}
    .pop-sem.sel{background:linear-gradient(135deg,rgba(236,113,182,.22),rgba(34,211,238,.16));border-left-color:#f472b6;color:#fff}
    .pop-sem-n{font-weight:700}
    .pop-sem-rango{color:#94a3b8;font-size:.68rem}
    .dsc-banner{display:flex;align-items:center;gap:1rem;margin:1rem;padding:1.1rem 1.3rem;border-radius:16px;background:linear-gradient(135deg,rgba(245,158,11,.14),rgba(245,158,11,.04));backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(245,158,11,.28);animation:dsc-in .25s cubic-bezier(.34,1.3,.64,1)}
    @keyframes dsc-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
    .dsc-icon{width:50px;height:50px;border-radius:14px;background:rgba(245,158,11,.16);border:1px solid rgba(245,158,11,.32);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0}
    .dsc-badge{display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.62rem;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.35);color:#fbbf24;white-space:nowrap}
    .dsc-th{background:#2b2410!important;color:#fbbf24!important}
    .dsc-col{background:linear-gradient(180deg,rgba(245,158,11,.10),rgba(245,158,11,.02));text-align:center;vertical-align:middle;color:#f59e0b;font-weight:700;padding:.5rem .35rem;min-width:70px}
  </style>

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile} style="padding:{isAndroidMobile ? '0.5rem' : '0.4rem'}">
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;width:100%;align-items:flex-end">
          <FilterGroup label="Período:" {isMobile}>
            <select class="filter-select" bind:value={periodo} style="width:100%">
              <option value="diario">Diario</option>
              <option value="semanal">Semanal</option>
              <option value="mensual">Mensual</option>
            </select>
          </FilterGroup>
          {#if periodo === "diario"}
            <FilterGroup label="Fecha:" {isMobile}>
              <DatePickerGlass bind:value={selectedFecha} />
            </FilterGroup>
          {:else if periodo === "semanal"}
            <FilterGroup label="Semana de:" {isMobile}>
              <div class="pop-wrap" bind:this={popRootEl}>
                <button type="button" class="filter-select pop-trigger" onclick={() => popSemanaAbierta = !popSemanaAbierta}>
                  <span>Semana {semanaActiva} · {semanasOpts.find(s => s.n === semanaActiva)?.rango ?? ''}</span>
                  <span class="pop-caret">▾</span>
                </button>

                {#if popSemanaAbierta}
                  <div class="pop-panel" tabindex="-1">
                    <div class="pop-mes">
                      <button class="pop-nav" onclick={() => cambiarMesSem(-1)} title="Mes anterior">‹</button>
                      <span class="pop-mes-txt">{nombreMesSel} {anoSeleccionado}</span>
                      <button class="pop-nav" onclick={() => cambiarMesSem(1)} title="Mes siguiente">›</button>
                    </div>

                    <div class="pop-sems">
                      {#each semanasOpts as s (s.n)}
                        <button
                          type="button"
                          class="pop-sem"
                          class:sel={semanaActiva === s.n}
                          onclick={() => elegirSemana(s)}
                        >
                          <span class="pop-sem-n">Semana {s.n}</span>
                          <span class="pop-sem-rango">{s.rango}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </FilterGroup>
          {:else}
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
          <div style="display:flex;gap:0.4rem;align-items:stretch;flex-shrink:0;{isAndroidMobile ? 'flex:1 1 100%;width:100%' : ''}">
          {#if periodo !== 'mensual'}
            <div class="pop-wrap" bind:this={popSinClasesEl}>
              <button type="button" onclick={handleSinClasesClick} disabled={sinClasesGuardando || !selectedSeccion}
                style="height:42px;padding:0 1rem;font-size:0.85rem;background:{sinClasesActivo ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.03)'};border:1px solid {sinClasesActivo ? '#f59e0b' : 'rgba(255,255,255,0.08)'};color:{sinClasesActivo ? '#f59e0b' : '#94a3b8'};border-radius:8px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.15s;white-space:nowrap;opacity:{sinClasesGuardando ? 0.6 : 1}">
                <span>{sinClasesActivo ? '🏫' : '🚫'}</span><span>{isAndroidMobile ? '' : (sinClasesActivo ? 'Sin clases' : 'No hubo clases')}</span>
              </button>

              {#if popSinClasesAbierta}
                <div class="pop-panel" tabindex="-1" style="left:auto;right:0;width:min(300px,calc(100vw - 40px))">
                  <div class="pop-mes"><span class="pop-mes-txt">Motivo del día sin clases</span></div>
                  <input class="obs-inline" placeholder="Ej: Feriado nacional (obligatorio)"
                    bind:value={sinClasesDescripcion}
                    onkeydown={(e) => { if (e.key === 'Enter' && sinClasesDescripcion.trim()) activarSinClases(false); }} />
                  <div style="display:flex;flex-direction:column;gap:3px;margin-top:.55rem">
                    <button type="button" class="pop-sem sel" style="justify-content:center;border-radius:10px" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando}
                      onclick={() => activarSinClases(false)}>
                      🚪 Marcar solo esta sección
                    </button>
                    <button type="button" class="pop-sem sel" style="justify-content:center;border-radius:10px" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando}
                      onclick={() => activarSinClases(true)}>
                      🏫 Marcar todo el colegio
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          <button onclick={limpiarAsistencia} disabled={getActiveStudentCount() === 0}
            style="height:42px;padding:0 1.25rem;font-size:0.85rem;background-color:{getActiveStudentCount() > 0 ? '#ef4444' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};transition:all 0.3s ease;box-shadow:{getActiveStudentCount() > 0 ? '0 4px 14px rgba(239,68,68,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{getActiveStudentCount() > 0 ? 1 : 0.7}">
            <span>🧹</span><span>{isAndroidMobile ? '' : 'Limpiar'}</span>
          </button>
          <div style="display:flex;gap:2px;align-items:stretch;flex-shrink:0">
            <button onclick={() => marcarTodos('P')} disabled={getActiveStudentCount() === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:42px;background:{getActiveStudentCount() > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {getActiveStudentCount() > 0 ? 'rgba(16,185,129,0.3)' : 'transparent'};color:#10b981;border-radius:8px;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{getActiveStudentCount() > 0 ? 1 : 0.5}"
              title="Marcar todos como Presente">P</button>
            <button onclick={() => marcarTodos('A')} disabled={getActiveStudentCount() === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:42px;background:{getActiveStudentCount() > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {getActiveStudentCount() > 0 ? 'rgba(239,68,68,0.3)' : 'transparent'};color:#ef4444;border-radius:8px;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{getActiveStudentCount() > 0 ? 1 : 0.5}"
              title="Marcar todos como Ausente">A</button>
            <button onclick={() => marcarTodos('J')} disabled={getActiveStudentCount() === 0}
              style="padding:0.4rem 0.7rem;font-size:0.8rem;height:42px;background:{getActiveStudentCount() > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.3)'};border:1px solid {getActiveStudentCount() > 0 ? 'rgba(245,158,11,0.3)' : 'transparent'};color:#f59e0b;border-radius:8px;cursor:{getActiveStudentCount() > 0 ? 'pointer' : 'not-allowed'};font-weight:700;white-space:nowrap;transition:all 0.15s;opacity:{getActiveStudentCount() > 0 ? 1 : 0.5}"
              title="Marcar todos como Justificado">J</button>
          </div>
          <button onclick={handleManualSave} disabled={!hasUnsavedChanges || saving}
            style="height:42px;padding:0 {isAndroidMobile ? '0.9rem' : '1.25rem'};font-size:0.85rem;background-color:{hasUnsavedChanges && !saving ? 'var(--primary-color)' : (saving ? '#059669' : 'rgba(148,163,184,0.5)')};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{hasUnsavedChanges && !saving ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{hasUnsavedChanges && !saving ? '0 4px 14px rgba(var(--primary-rgb), 0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{hasUnsavedChanges || saving ? 1 : 0.7}">
            {#if saving}<span class="saving-dot"></span><span>{isAndroidMobile ? '' : 'Guardando'}</span>{:else}<span>💾</span><span>{isAndroidMobile ? '' : 'Guardar'}</span>{/if}
          </button>
          <div style="flex:1;min-width:{isAndroidMobile ? '0' : '100px'};{isAndroidMobile ? 'flex-basis:56px;max-width:40vw' : ''}">
          </div>
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
            <div onclick={() => handleCardClick('Presentes', statsP)}
              style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#10b981;font-weight:bold;font-size:0.8rem">P:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsP.total}</span>
            </div>
            <div onclick={() => handleCardClick('Ausentes', statsA)}
              style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#ef4444;font-weight:bold;font-size:0.8rem">A:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsA.total}</span>
            </div>
            <div onclick={() => handleCardClick('Justificados', statsJ)}
              style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#f59e0b;font-weight:bold;font-size:0.8rem">J:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsJ.total}</span>
            </div>
          </div>
        </div>
      {/if}

      {#if !isAndroidMobile && filteredEstudiantes.length > 0}
        <div class="asist-summary-grid-mob" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0.4rem;margin:0.5rem 0;padding:0;width:100%;max-width:100%">
          <div class="summary-card" onclick={() => handleCardClick('Total', { total: totalEstudiantes, m: totalM, f: totalF })}>
            <div class="card-accent" style="background:#06b6d4"></div>
            <span class="card-icon">📋</span>
            <span class="card-value">{totalEstudiantes}</span>
            <span class="card-label">Total</span>
            <div class="card-gender"><span class="gender-m">M:{totalM}</span><span class="gender-f">F:{totalF}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick('Presentes', statsP)}>
            <div class="card-accent" style="background:#10b981"></div>
            <span class="card-icon">✅</span>
            <span class="card-value">{statsP.total}</span>
            <span class="card-label">Presentes</span>
            <div class="card-gender"><span class="gender-m">M:{statsP.m}</span><span class="gender-f">F:{statsP.f}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick('Ausentes', statsA)}>
            <div class="card-accent" style="background:#ef4444"></div>
            <span class="card-icon">❌</span>
            <span class="card-value">{statsA.total}</span>
            <span class="card-label">Ausentes</span>
            <div class="card-gender"><span class="gender-m">M:{statsA.m}</span><span class="gender-f">F:{statsA.f}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick('Justificados', statsJ)}>
            <div class="card-accent" style="background:#f59e0b"></div>
            <span class="card-icon">⚠️</span>
            <span class="card-value">{statsJ.total}</span>
            <span class="card-label">Justificados</span>
            <div class="card-gender"><span class="gender-m">M:{statsJ.m}</span><span class="gender-f">F:{statsJ.f}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick('Asistencia', { total: asistenciaPct, m: 0, f: 0 })}>
            <div class="card-accent" style="background:#8b5cf6"></div>
            <span class="card-icon">📊</span>
            <span class="pct-value" style="color:{asistenciaPct >= 90 ? '#10b981' : asistenciaPct >= 70 ? '#f59e0b' : '#ef4444'}">{asistenciaPct}%</span>
            <span class="card-label">Asistencia</span>
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:{asistenciaPct}%;background:{asistenciaPct >= 90 ? '#10b981' : asistenciaPct >= 70 ? '#f59e0b' : '#ef4444'}"></div></div>
          </div>
        </div>
      {/if}

      <ScrollableTable>
        {#if loading}
          <div class="loading-state">Cargando estudiantes...</div>
        {:else if !isFechaHabilitada && periodo === 'diario' && esDiaSinClases(selectedFecha)}
          {@const cov = coberturaSinClases(selectedFecha)}
          <div class="dsc-banner">
            <div class="dsc-icon">🚫</div>
            <div style="flex:1;min-width:0;text-align:left">
              <h3 style="margin:0 0 .25rem;color:#fbbf24;font-size:1.05rem">No hubo clases este día</h3>
              <p style="margin:0;color:#e2e8f0;font-size:.88rem;font-weight:600">{cov?.descripcion || 'Día marcado sin clases'}</p>
              <p style="margin:.25rem 0 0;color:#94a3b8;font-size:.75rem;text-transform:capitalize">{new Date(selectedFecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <span class="dsc-badge">{cov?.grado_id === null ? '🏫 Todo el colegio' : '🚪 Esta sección'}</span>
          </div>
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
            {#each filteredEstudiantes as est, index (est.id)}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="font-size:1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick={() => selectedStudentDetail = est}>{est.nombre}</span>
                </div>
                <div style="display:flex;gap:0.4rem;margin-bottom:0.3rem">
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'P' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'P' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'P' ? '#10b981' : '#94a3b8'}">
                    <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'P'} onchange={() => handleEstadoChange(est.id, 'P')} style="display:none" /><span>Presente</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'A' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'A' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'A' ? '#ef4444' : '#94a3b8'}">
                    <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'A'} onchange={() => handleEstadoChange(est.id, 'A')} style="display:none" /><span>Ausente</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'J' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'J' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'J' ? '#f59e0b' : '#94a3b8'}">
                    <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'J'} onchange={() => handleEstadoChange(est.id, 'J')} style="display:none" /><span>Justificado</span>
                  </label>
                </div>
                <input type="text" placeholder="Observación..." value={est.observacion || ''} oninput={(e) => handleObservacionChange(est.id, (e.target as HTMLInputElement).value)}
                  style="width:100%;padding:0.35rem 0.6rem;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.3);color:#fff;font-size:0.78rem;outline:none;box-sizing:border-box" />
              </div>
            {/each}
          </div>
        {:else}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible;table-layout:fixed">
            <thead><tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Estudiante</th>
              <th style="width:310px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">Asistencia</th>
              <th style="width:140px;text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Observación</th>
              <th style="width:60px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">% Mes</th>
            </tr></thead>
            <tbody>
              {#each filteredEstudiantes as est, index (est.id)}
                {@const pct = monthlyPcts[est.id] ?? -1}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left">
                    <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:8px" onclick={() => selectedStudentDetail = est}>
                      <span style="font-size:1.1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                      <span style="white-space:nowrap">{est.nombre}</span>
                    </div>
                    <div style="font-size:0.7rem;opacity:0.6;margin-left:30px">{est.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                  </td>
                  <td style="text-align:center">
                    <div style="display:flex;gap:6px;justify-content:center">
                      <label class="asistencia-btn" class:p={est.estado === 'P'}>
                        <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'P'} onchange={() => handleEstadoChange(est.id, 'P')} style="display:none" />Presente
                      </label>
                      <label class="asistencia-btn" class:a={est.estado === 'A'}>
                        <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'A'} onchange={() => handleEstadoChange(est.id, 'A')} style="display:none" />Ausente
                      </label>
                      <label class="asistencia-btn" class:j={est.estado === 'J'}>
                        <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'J'} onchange={() => handleEstadoChange(est.id, 'J')} style="display:none" />Justificado
                      </label>
                    </div>
                  </td>
                  <td style="text-align:left;padding:0.1rem">
                    <input type="text" placeholder="Obs..." class="obs-inline"
                      value={est.observacion || ''} oninput={(e) => handleObservacionChange(est.id, (e.target as HTMLInputElement).value)} />
                  </td>
                  <td style="text-align:center;padding:0.1rem">
                    {#if pct >= 0}
                      <span class="pct-indicator" style="color:{pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444'}">{pct}%</span>
                    {:else}
                      <span class="pct-indicator" style="color:#64748b">—</span>
                    {/if}
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
        {@const totalMM = filteredEstudiantesMulti.filter(e => e.sexo === 'M').length}
        {@const totalFM = filteredEstudiantesMulti.filter(e => e.sexo === 'F').length}
        {@const pctMulti = totalPosibleMulti > 0 ? Math.round(getMultiStats('P').total / totalPosibleMulti * 100) : 0}
        <div class="asist-summary-grid-mob" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0.4rem;margin:0.5rem 0;padding:0;width:100%;max-width:100%">
          <div class="summary-card" onclick={() => handleCardClick('Total', { total: filteredEstudiantesMulti.length, m: totalMM, f: totalFM })}>
            <div class="card-accent" style="background:#06b6d4"></div>
            <span class="card-icon">📋</span>
            <span class="card-value">{filteredEstudiantesMulti.length}</span>
            <span class="card-label">Estudiantes</span>
            <div class="card-gender"><span class="gender-m">M:{totalMM}</span><span class="gender-f">F:{totalFM}</span></div>
          </div>
          {#each ['P', 'A', 'J'] as estado}
            {@const st = getMultiStats(estado)}
            <div class="summary-card" onclick={() => handleCardClick(estado === 'P' ? 'Presentes' : estado === 'A' ? 'Ausentes' : 'Justificados', st)}
              style="cursor:pointer;user-select:none">
              <div class="card-accent" style="background:{estado === 'P' ? '#10b981' : estado === 'A' ? '#ef4444' : '#f59e0b'}"></div>
              <span class="card-icon">{estado === 'P' ? '✅' : estado === 'A' ? '❌' : '⚠️'}</span>
              <span class="card-value">{st.total}</span>
              <span class="card-label">{estado === 'P' ? 'Presentes' : estado === 'A' ? 'Ausentes' : 'Justificados'}</span>
              <div class="card-gender"><span class="gender-m">M:{st.m}</span><span class="gender-f">F:{st.f}</span></div>
            </div>
          {/each}
          <div class="summary-card" onclick={() => handleCardClick('Asistencia', { total: pctMulti, m: 0, f: 0 })}>
            <div class="card-accent" style="background:#8b5cf6"></div>
            <span class="card-icon">📊</span>
            <span class="pct-value" style="color:{pctMulti >= 90 ? '#10b981' : pctMulti >= 70 ? '#f59e0b' : '#ef4444'}">{pctMulti}%</span>
            <span class="card-label">Asistencia</span>
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:{pctMulti}%;background:{pctMulti >= 90 ? '#10b981' : pctMulti >= 70 ? '#f59e0b' : '#ef4444'}"></div></div>
          </div>
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
            {#each filteredEstudiantesMulti as est, index (est.id)}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="font-size:1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{est.nombre}</span>
                </div>
                <div style="display:flex;gap:0.4rem;overflow-x:auto;padding-bottom:0.2rem">
                  {#each fechasPeriodo as fecha}
                    {@const dayName = new Date(fecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' }).replace('.','')}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;min-width:68px">
                      <span style="font-size:0.55rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.2px;white-space:nowrap">{dayName}</span>
                      <div class="semanal-status" style="font-size:0.6rem;padding:0.15rem 0.3rem" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                        onclick={() => cicloEstado(est.id, fecha)}>
                        {effectiveEstado === 'P' ? 'Pres' : effectiveEstado === 'A' ? 'Aus' : effectiveEstado === 'J' ? 'Just' : '—'}
                      </div>
                      <input type="text" placeholder="..." class="semanal-obs" style="width:100%;padding:0.1rem 0.25rem;font-size:0.5rem"
                        value={getObsMulti(est.id, fecha)}
                        oninput={(e) => handleObservacionChangeMulti(est.id, fecha, (e.target as HTMLInputElement).value)} />
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if isAndroidMobile && periodo === "mensual"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each filteredEstudiantesMulti as est, index (est.id)}
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
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10;min-width:200px">Estudiante</th>
              {#each fechasVisibles as fv (fv.fecha)}
                <th class:dsc-th={fv.sinClases}
                  style="min-width:105px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;font-size:0.7rem;font-weight:600;padding:0.3rem 0.15rem"
                  title={fv.sinClases ? motivoSinClasesEn(fv.fecha) : undefined}>
                  {fv.sinClases ? '🚫 ' : ''}{new Date(fv.fecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }).replace('.','').replace(',','')}
                </th>
              {/each}
            </tr></thead>
            <tbody>
              {#each filteredEstudiantesMulti as est, index (est.id)}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left">
                    <span style="font-weight:bold;font-size:0.85rem;cursor:pointer;white-space:normal;word-break:break-word;line-height:1.25" onclick={() => selectedStudentDetail = est as any}>{est.nombre}</span>
                    <div style="font-size:0.65rem;opacity:0.6">{est.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                  </td>
                  {#each fechasVisibles as fv (fv.fecha)}
                    {#if fv.sinClases}
                      {#if index === 0}
                        <td class="dsc-col" rowspan={filteredEstudiantesMulti.length}>
                          <span style="font-size:1.1rem">🚫</span>
                          <span class="dsc-motivo">{motivoSinClasesEn(fv.fecha)}</span>
                        </td>
                      {/if}
                    {:else}
                      {@const d = est.dias[fv.fecha]}
                      {@const draftD = draftMulti[est.id]?.[fv.fecha]}
                      {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                      <td style="text-align:center;padding:0.15rem;min-width:105px">
                        <div class="semanal-status" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                          onclick={() => cicloEstado(est.id, fv.fecha)}
                          title={effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : 'Sin marcar'}>
                          {effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : '—'}
                        </div>
                        <input type="text" placeholder="Obs..." class="semanal-obs"
                          value={getObsMulti(est.id, fv.fecha)}
                          oninput={(e) => handleObservacionChangeMulti(est.id, fv.fecha, (e.target as HTMLInputElement).value)} />
                      </td>
                    {/if}
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if periodo === "mensual"}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible">
            <thead><tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10;min-width:200px">Estudiante</th>
              {#each fechasVisibles as fv (fv.fecha)}
                <th class:dsc-th={fv.sinClases}
                  style="font-size:0.7rem;white-space:nowrap;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;min-width:48px;padding:0.35rem 0.45rem"
                  title={fv.sinClases ? motivoSinClasesEn(fv.fecha) : undefined}>
                  <div style="font-size:0.6rem;opacity:0.7">{fv.sinClases ? '🚫 ' : ''}{new Date(fv.fecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' })}</div>
                  {fv.fecha.split('-').slice(1).reverse().join('/')}
                </th>
              {/each}
              <th style="width:{isAndroidMobile ? '24px' : '30px'};position:sticky;top:0;background:#1e293b;z-index:10">P</th>
              <th style="width:{isAndroidMobile ? '24px' : '30px'};position:sticky;top:0;background:#1e293b;z-index:10">A</th>
              <th style="width:{isAndroidMobile ? '24px' : '30px'};position:sticky;top:0;background:#1e293b;z-index:10">J</th>
            </tr></thead>
            <tbody>
              {#each filteredEstudiantesMulti as est, index (est.id)}
                {@const p = countMultiEstados(est.id, 'P')}
                {@const a = countMultiEstados(est.id, 'A')}
                {@const j = countMultiEstados(est.id, 'J')}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left;overflow:hidden">
                    <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;width:100%" onclick={() => selectedStudentDetail = est as any}>
                      <span style="font-size:1.1rem;flex-shrink:0">{est.sexo === 'F' ? '👩' : '👨'}</span>
                      <span style="white-space:normal;word-break:break-word;line-height:1.25">{est.nombre}</span>
                    </div>
                    <div style="font-size:0.7rem;opacity:0.6;margin-left:22px">{est.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                  </td>
                  {#each fechasVisibles as fv (fv.fecha)}
                    {#if fv.sinClases}
                      {#if index === 0}
                        <td class="dsc-col" rowspan={filteredEstudiantesMulti.length} style="min-width:48px">
                          <span style="font-size:0.9rem">🚫</span>
                          <span class="dsc-motivo" style="font-size:.55rem">{motivoSinClasesEn(fv.fecha)}</span>
                        </td>
                      {/if}
                    {:else}
                      {@const d = est.dias[fv.fecha]}
                      {@const draftD = draftMulti[est.id]?.[fv.fecha]}
                      {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                      <td style="text-align:center;padding:0.15rem">
                        <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                          onclick={() => cicloEstado(est.id, fv.fecha)}
                          title={new Date(fv.fecha + "T12:00:00").toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ': ' + (effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : 'Sin marcar')}>
                          {effectiveEstado ?? '-'}
                        </div>
                      </td>
                    {/if}
                  {/each}
                  <td style="color:#4caf50;font-weight:bold">{p}</td>
                  <td style="color:#f44336;font-weight:bold">{a}</td>
                  <td style="color:#ff9800;font-weight:bold">{j}</td>
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
