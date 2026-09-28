<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { join, tempDir, documentDir } from "@tauri-apps/api/path";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import { generarPdfAsistencia } from "../lib/asistenciaPdf";
  import type { TablaAsistenciaPdf } from "../lib/asistenciaPdf";
  import { registerBackHandler } from "../lib/androidBack";
  import { loadAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import FiltersModalAndroid from "./FiltersModalAndroid.svelte";
  import FilterActions from "./FilterActions.svelte";
  import SearchFab from "./SearchFab.svelte";
  import PageLayout from "./PageLayout.svelte";
  import ScrollableTable from "./ScrollableTable.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }
  interface AsistenciaReporteItem {
    id: number; nombre: string; sexo: string;
    fechas: string[]; observaciones: string[];
  }
  interface ColegioDiasAsistencia {
    colegioId: number; lunes: boolean; martes: boolean; miercoles: boolean;
    jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean;
  }
  interface DiaSinClase { id: number; colegio_id: number; grado_id: number | null; seccion_id: number | null; fecha: string; descripcion: string; }

  // Visible = la página contenedora está activa Y este es el sub-tab seleccionado.
  let { visible = true }: { visible?: boolean } = $props();

  let anos: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);

  let selectedAno = $state(Number(localStorage.getItem("selectedAno")) || 0);
  let showAnoDropdown = $state(localStorage.getItem('stp_show_ano_dropdown') !== 'false');
  let selectedColegio = $state(Number(localStorage.getItem("selectedColegio")) || 0);
  let selectedGrado = $state(Number(localStorage.getItem("selectedGrado")) || 0);
  let selectedSeccion = $state(Number(localStorage.getItem("selectedSeccion")) || 0);
  let selectedSexo = $state(localStorage.getItem("selectedSexo") || "");

  let isMobile = $state(false);
  let isAndroid = $state(false);
  let isWindows = $state(false);
  let isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));

  let periodo = $state<"semanal" | "mensual">("mensual");
  let fechaBase = $state(sessionStorage.getItem("asistencia_selectedFecha_v2") || getLocalDateISOString());
  let mesSeleccionado = $state(new Date().getMonth() + 1);
  let anoSeleccionado = $state(new Date().getFullYear());
  let searchTerm = $state("");
  let fechaInicio = $state("");
  let fechaFin = $state("");

  let reporte: AsistenciaReporteItem[] = $state([]);
  let colegioConfig: ColegioDiasAsistencia | null = $state(null);
  let loading = $state(false);
  let refreshTrigger = $state(0);
  let silentRefresh = $state(false);
  let fetching = $state(false);
  let refreshQueued = $state(false);

  let showSummaryModal = $state<{ show: boolean; type: string; stats: { total: number; m: number; f: number } | null }>({ show: false, type: "", stats: null });
  let selectedStudentDetail: AsistenciaReporteItem | null = $state(null);
  let showFiltersModal = $state(false);

  $effect(() => {
    if (!visible) return;
    if (selectedStudentDetail) {
      return registerBackHandler(() => { selectedStudentDetail = null; return true; });
    }
  });

  $effect(() => {
    if (!visible) return;
    if (showSummaryModal.show) {
      return registerBackHandler(() => { showSummaryModal = { ...showSummaryModal, show: false }; return true; });
    }
  });

  $effect(() => {
    if (showFiltersModal && isAndroidMobile) {
      return registerBackHandler(() => { showFiltersModal = false; return true; });
    }
  });

  // Refresco silencioso al volver a verse (transición oculto → visible)
  let wasVisible = visible;
  $effect(() => {
    const nowVisible = visible;
    const prev = wasVisible;
    wasVisible = nowVisible;
    if (!nowVisible || prev) return;
    silentRefresh = true;
    fetchReporte();
  });
  let printHtml: string | null = $state(null);

  let colegioNombre = $derived(colegios.find(c => c.id === selectedColegio)?.nombre || "");
  let gradoNombre = $derived(grados.find(g => g.id === selectedGrado)?.nombre || "");
  let seccionNombre = $derived(secciones.find(s => s.id === selectedSeccion)?.nombre || "");

  // ── Modo semanal: popover mes + semanas ──
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  function lunesDeISO(iso: string): string {
    const b = new Date(iso + 'T12:00:00');
    const off = (b.getDay() + 6) % 7;
    b.setDate(b.getDate() - off);
    return `${b.getFullYear()}-${pad2(b.getMonth() + 1)}-${pad2(b.getDate())}`;
  }

  interface SemanaOpt { n: number; lunes: string; rango: string }

  // Semanas del mes seleccionado — DERIVED PURO (sin efectos que escriban
  // fechaBase: un $effect que leyera+escribiera creaba un bucle que rompía
  // la reactividad del componente).
  let semanasOpts = $derived.by(() => {
    const primerDia = `${anoSeleccionado}-${pad2(mesSeleccionado)}-01`;
    const lunes0 = lunesDeISO(primerDia);
    const fin = new Date(anoSeleccionado, mesSeleccionado, 0);
    const finISO = `${fin.getFullYear()}-${pad2(fin.getMonth() + 1)}-${pad2(fin.getDate())}`;

    const opts: SemanaOpt[] = [];
    let lu = lunes0;
    let n = 1;
    while (lu <= finISO) {
      opts.push({ n, lunes: lu, rango: `${fmtDM(lu)} – ${fmtDM(sumaDias(lu, 6))}` });
      lu = sumaDias(lu, 7);
      n++;
    }
    return opts;
  });

  let popSemanaAbierta = $state(false);
  let popRootEl: HTMLElement | null = $state(null);

  function sumaDias(iso: string, n: number): string {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function fmtDM(iso: string): string {
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }
  /** Fecha completa dd/mm/aaaa para los encabezados de PDF e impresión. */
  function fmtDMY(iso: string): string {
    if (!iso || iso.length < 10) return iso || '';
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  }
  function nombreMes(m: number): string {
    return MESES[m - 1] ?? '';
  }
  /** Fecha en texto largo: "01 de Septiembre". */
  function fechaLarga(iso: string): string {
    if (!iso || iso.length < 10) return iso || '';
    return `${iso.slice(8, 10)} de ${nombreMes(Number(iso.slice(5, 7)))}`;
  }
  /**
   * Rango del período para los encabezados, entre paréntesis y con el mes en
   * texto: "(01 de Septiembre al 30 de Septiembre)". Se usan las fechas reales
   * del período, así que en el mes en curso termina el día de hoy y no el último
   * día del mes: no se anuncian días que aún no tienen asistencia registrada.
   */
  let encabezadoPeriodo = $derived(
    `(${fechaLarga(fechaInicio)} al ${fechaLarga(fechaFin)})`
  );

  /** Etiqueta del período: "Septiembre" (mensual) o "Semana 3 Septiembre" (semanal). */
  let periodoEtiqueta = $derived.by(() => {
    if (periodo === 'semanal') return `Semana ${semanaActiva} ${nombreMes(mesSeleccionado)}`;
    return nombreMes(mesSeleccionado);
  });

  /** Etiqueta corta del período, para mostrar en el botón. */
  let resumenPeriodo = $derived(
    periodo === 'semanal' ? `Semana ${semanaActiva}` : `${nombreMes(mesSeleccionado)} ${anoSeleccionado}`
  );

  let semanaActiva = $derived.by(() => {
    const lu = lunesDeISO(fechaBase);
    const match = semanasOpts.find(s => s.lunes === lu);
    return match?.n ?? (fechaBase >= (semanasOpts[0]?.lunes ?? '') ? 1 : semanasOpts.length || 1);
  });

  function elegirSemanaInforme(s: SemanaOpt) {
    fechaBase = s.lunes;
    popSemanaAbierta = false;
  }

  function cerrarPopSemana() { popSemanaAbierta = false; }

  /** Cambia el mes del popover y alinea fechaBase a ese mes si quedó fuera. */
  function cambiarMesSemInforme(d: number) {
    let m = mesSeleccionado + d;
    let a = anoSeleccionado;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    mesSeleccionado = m;
    anoSeleccionado = a;
    const s0 = semanasOpts[0];
    if (s0 && !(fechaBase >= s0.lunes && fechaBase <= sumaDias(s0.lunes, 6))) {
      fechaBase = s0.lunes;
    }
  }

  // Cierre por clic fuera + Back de Android mientras el popover esté abierto
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

  onMount(() => {
    const checkMobile = () => {
      isMobile = window.innerWidth <= 768;
      isAndroid = /Android/i.test(navigator.userAgent);
      isWindows = /Windows/i.test(navigator.userAgent);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('schooltracker-sync', onSync);
    // Cargar configuraciones syncronizables
    loadAppSettings().then(s => { showAnoDropdown = s.showAnoDropdown; });
    const unsubSettings = onAppSettingsChange(s => { showAnoDropdown = s.showAnoDropdown; });

    const unsub1 = listen("asistencia-updated", () => { silentRefresh = true; fetchReporte(); });
    const unsub2 = listen("student-updated", () => { silentRefresh = true; fetchReporte(); });
    const unsub3 = listen("catalog-updated", () => refreshTrigger++);

    fetchCatalogs();

    return () => {
      unsubSettings();
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('schooltracker-sync', onSync);
      unsub1.then(f => f());
      unsub2.then(f => f());
      unsub3.then(f => f());
    };
  });

  function onSync() { silentRefresh = true; refreshTrigger++; }

  // ── Días sin clases (marcados desde AsistenciaPage, por sección o colegio) ──
  let diasSinClases = $state<DiaSinClase[]>([]);
  function esSinClases(fecha: string): boolean {
    return diasSinClases.some(d => d.fecha === fecha);
  }
  async function fetchDiasSinClases() {
    if (!selectedColegio || !selectedSeccion || !fechaInicio || !fechaFin) { diasSinClases = []; return; }
    try {
      diasSinClases = await invoke<DiaSinClase[]>('get_dias_sin_clases', {
        colegioId: selectedColegio, gradoId: selectedGrado, seccionId: selectedSeccion,
        fechaInicio, fechaFin,
      });
    } catch (e) { console.error('Error cargando días sin clases:', e); }
  }
  $effect(() => {
    // Deps: colegio/sección y rango del período
    void selectedColegio; void selectedSeccion; void fechaInicio; void fechaFin;
    fetchDiasSinClases();
  });
  /** Nota para PDF/impresión con los días sin clases del período. */
  let diasSinClasesNota = $derived.by(() => {
    const marcados = diasSinClases.filter(d => d.fecha >= fechaInicio && d.fecha <= fechaFin);
    if (marcados.length === 0) return '';
    return 'Sin clases: ' + marcados.map(d => `${fmtDM(d.fecha)} (${d.descripcion})`).join(', ');
  });
  /**
   * Marca el primer día (lunes) de cada semana en la vista mensual, para dibujar
   * el separador vertical entre semanas. La primera columna nunca lleva línea:
   * aunque el mes empiece en lunes, una línea al borde izquierdo sobra.
   */
  function esInicioSemana(iso: string, indice: number): boolean {
    if (indice <= 0) return false;
    return new Date(iso + 'T12:00:00').getDay() === 1;
  }

  function motivoSinClases(fecha: string): string {
    return diasSinClases.find(d => d.fecha === fecha)?.descripcion || 'Sin clases';
  }
  function motivoSinClasesEn(fecha: string): string { return motivoSinClases(fecha); }

  $effect(() => {
    const hoy = new Date();
    if (periodo === "semanal") {
      const base = new Date(fechaBase + "T12:00:00");
      const day = base.getDay();
      const diff = base.getDate() - day + (day === 0 ? -6 : 1);
      const lunes = new Date(base.setDate(diff));
      const domingo = new Date(lunes);
      domingo.setDate(lunes.getDate() + 6);
      fechaInicio = getLocalDateISOString(lunes);
      fechaFin = getLocalDateISOString(domingo);
    } else {
      const primerDia = new Date(anoSeleccionado, mesSeleccionado - 1, 1);
      fechaInicio = getLocalDateISOString(primerDia);
      if (anoSeleccionado === hoy.getFullYear() && mesSeleccionado === hoy.getMonth() + 1) {
        fechaFin = getLocalDateISOString(hoy);
      } else {
        fechaFin = getLocalDateISOString(new Date(anoSeleccionado, mesSeleccionado, 0));
      }
    }
  });

  $effect(() => {
    if (selectedColegio && selectedAno) {
      fetchGrados();
      fetchColegioConfig(selectedColegio);
    }
  });

  $effect(() => {
    if (selectedGrado && selectedColegio && selectedAno) fetchSecciones();
  });

  $effect(() => {
    if (selectedAno) localStorage.setItem("selectedAno", String(selectedAno));
    if (selectedColegio) localStorage.setItem("selectedColegio", String(selectedColegio));
    if (selectedGrado) localStorage.setItem("selectedGrado", String(selectedGrado));
    if (selectedSeccion) localStorage.setItem("selectedSeccion", String(selectedSeccion));
    localStorage.setItem("selectedSexo", selectedSexo);
    if (fechaBase) sessionStorage.setItem("asistencia_selectedFecha_v2", fechaBase);
    const timeout = setTimeout(() => {
      if (selectedAno && selectedColegio && selectedGrado && selectedSeccion && fechaInicio && fechaFin) fetchReporte();
    }, 150);
    return () => clearTimeout(timeout);
  });

  async function fetchCatalogs() {
    try {
      const [anosData, colegiosData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_colegios"),
      ]);
      const activeAno = anosData.find(a => a.activo)?.id || (anosData.length > 0 ? anosData[0].id : 0);
      const activeColegio = colegiosData.find(c => c.activo)?.id || (colegiosData.length > 0 ? colegiosData[0].id : 0);
      anos = anosData;
      colegios = colegiosData;
      selectedAno = activeAno;
      selectedColegio = activeColegio;
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  }

  async function fetchGrados() {
    try {
      const gradosData = await invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: Number(selectedColegio), anoLectivoId: Number(selectedAno) });
      grados = gradosData;
      if (gradosData.length > 0) {
        if (!gradosData.some(g => g.id === selectedGrado)) selectedGrado = gradosData[0].id;
      } else { selectedGrado = 0; }
    } catch (error) {
      console.error("Error fetching grados:", error);
      await emit("show-toast", { message: "❌ Error al cargar grados: " + error, type: "error" });
    }
  }

  async function fetchSecciones() {
    try {
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: Number(selectedGrado), colegioId: Number(selectedColegio), anoLectivoId: Number(selectedAno) });
      secciones = data;
      if (data.length > 0) {
        if (!data.some(s => s.id === selectedSeccion)) selectedSeccion = data[0].id;
      } else { selectedSeccion = 0; }
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: "❌ Error al cargar secciones: " + error, type: "error" });
    }
  }

  async function fetchColegioConfig(colegioId: number) {
    try {
      colegioConfig = await invoke<ColegioDiasAsistencia>("get_colegio_dias_asistencia", { colegioId });
    } catch (error) { console.error("Error fetching colegio config:", error); }
  }

  async function fetchReporte() {
    if (fetching) { refreshQueued = true; return; }
    if (!selectedAno || !selectedColegio || !selectedGrado || !selectedSeccion || !fechaInicio || !fechaFin) return;
    fetching = true;
    if (!silentRefresh) loading = true;
    silentRefresh = false;
    try {
      reporte = await invoke<AsistenciaReporteItem[]>("get_asistencia_rango", {
        fechaInicio, fechaFin, anoLectivoId: Number(selectedAno), colegioId: Number(selectedColegio), gradoId: Number(selectedGrado), seccionId: Number(selectedSeccion),
      });
    } catch (error) {
      console.error("Error fetching attendance report:", error);
      await emit("show-toast", { message: "❌ Error al cargar reporte: " + error, type: "error" });
    } finally {
      loading = false;
      fetching = false;
      if (refreshQueued) { refreshQueued = false; fetchReporte(); }
    }
  }

  function getFechasUnicas(incluirSinClases = false) {
    const fechasSet = new Set<string>();
    if (colegioConfig) {
      const inicio = new Date(fechaInicio + "T12:00:00");
      const fin = new Date(fechaFin + "T12:00:00");
      const temp = new Date(inicio);
      const diasMap: Record<number, boolean> = {
        0: colegioConfig.domingo, 1: colegioConfig.lunes, 2: colegioConfig.martes,
        3: colegioConfig.miercoles, 4: colegioConfig.jueves, 5: colegioConfig.viernes, 6: colegioConfig.sabado,
      };
      while (temp <= fin) {
        const iso = getLocalDateISOString(temp);
        // Los días marcados sin clases no cuentan como columnas de asistencia
        if (diasMap[temp.getDay()] && (incluirSinClases || !esSinClases(iso))) fechasSet.add(iso);
        temp.setDate(temp.getDate() + 1);
      }
    } else {
      reporte.forEach(item => { item.fechas.forEach(f => { const [fecha] = f.split(':'); fechasSet.add(fecha); }); });
    }
    return Array.from(fechasSet).sort();
  }

  let fechasColumnas = $derived(getFechasUnicas());
  /** Todas las días hábiles del período (incluye los sin clases, para pintarlos). */
  let fechasVisibles = $derived(getFechasUnicas(true));
  /** Todo el período quedó marcado sin clases: no hay ninguna columna de asistencia. */
  let dscPeriodoVacio = $derived(
    fechasColumnas.length === 0 && diasSinClases.some(d => d.fecha >= fechaInicio && d.fecha <= fechaFin)
  );

  let reporteFiltrado = $derived.by(() => {
    let f = reporte;
    if (selectedSexo) f = f.filter(item => item.sexo === selectedSexo);
    if (searchTerm) f = f.filter(item => item.nombre.toLowerCase().includes(searchTerm.toLowerCase()));
    return f;
  });

  function getEstadoEnFecha(item: AsistenciaReporteItem, fecha: string) {
    const found = item.fechas.find(f => f.startsWith(fecha));
    return found ? found.split(':')[1] : "-";
  }

  function getObservacionEnFecha(item: AsistenciaReporteItem, fecha: string) {
    const found = item.observaciones?.find(f => f.startsWith(fecha));
    return found ? found.split(':').slice(1).join(':') : "";
  }

  function getEstadoColor(estado: string) {
    switch (estado) { case 'P': return '#10b981'; case 'A': return '#ef4444'; case 'J': return '#f59e0b'; default: return 'transparent'; }
  }

  function handleCardClick(type: string, stats: { total: number; m: number; f: number } | null) {
    showSummaryModal = { show: true, type, stats };
  }

  function getAsistenciaStats(estado: string) {
    let countM = 0, countF = 0;
    reporteFiltrado.forEach(est => {
      const pCount = est.fechas.filter(f => f.endsWith(`:${estado}`)).length;
      if (est.sexo === 'M') countM += pCount;
      if (est.sexo === 'F') countF += pCount;
    });
    return { total: countM + countF, m: countM, f: countF };
  }

  let statsTotal = $derived({ total: reporteFiltrado.length, m: reporteFiltrado.filter(e => e.sexo === 'M').length, f: reporteFiltrado.filter(e => e.sexo === 'F').length });
  let statsP = $derived(getAsistenciaStats('P'));
  let statsA = $derived(getAsistenciaStats('A'));
  let statsJ = $derived(getAsistenciaStats('J'));


  interface ParAsistencia {
    colegioId: number; colegioNombre: string;
    gradoId: number; gradoNombre: string;
    seccionId: number; seccionNombre: string;
  }

  let exportandoMasivo = $state(false);
  let progresoMasivo = $state('');

  /**
   * Un solo PDF con una hoja por cada grado/seccion de TODOS los colegios del
   * año lectivo seleccionado. El nombre del archivo lleva el período:
   * `Asistencia_Septiembre_2026.pdf` (mensual) o
   * `Asistencia_Semana3_Septiembre_2026.pdf` (semanal).
   */
  async function exportarPdfAsistencia() {
    if (!selectedAno || !fechaInicio || !fechaFin) {
      await emit("show-toast", { message: "⚠️ Seleccione año y período", type: 'warning' });
      return;
    }

    try {
      exportandoMasivo = true;
      progresoMasivo = 'Preparando...';

      const anoNombre = anos.find(a => a.id === selectedAno)?.nombre || String(selectedAno);
      const colegiosScope: CategoryItem[] = colegios;
      if (colegiosScope.length === 0) {
        await emit("show-toast", { message: "⚠️ No hay colegios para exportar", type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      const pares: ParAsistencia[] = [];
      for (const col of colegiosScope) {
        const gradosList: CategoryItem[] = await invoke("get_grados_by_colegio", { colegioId: col.id, anoLectivoId: Number(selectedAno) });
        for (const grado of gradosList) {
          const seccionesList: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: grado.id, colegioId: col.id, anoLectivoId: Number(selectedAno) });
          for (const sec of seccionesList) {
            pares.push({
              colegioId: col.id, colegioNombre: col.nombre,
              gradoId: grado.id!, gradoNombre: grado.nombre,
              seccionId: sec.id!, seccionNombre: sec.nombre,
            });
          }
        }
      }
      if (pares.length === 0) {
        await emit("show-toast", { message: "⚠️ No se encontraron grados con secciones", type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      const configCache = new Map<number, ColegioDiasAsistencia | null>();
      const tablas: TablaAsistenciaPdf[] = [];

      for (let i = 0; i < pares.length; i++) {
        const p = pares[i];
        progresoMasivo = `${i + 1}/${pares.length} - ${p.gradoNombre} Seccion ${p.seccionNombre}`;

        if (!configCache.has(p.colegioId)) {
          try { configCache.set(p.colegioId, await invoke<ColegioDiasAsistencia>("get_colegio_dias_asistencia", { colegioId: p.colegioId })); }
          catch { configCache.set(p.colegioId, null); }
        }
        const cfg = configCache.get(p.colegioId) || null;
        const sinClases: DiaSinClase[] = await invoke<DiaSinClase[]>("get_dias_sin_clases", {
          colegioId: p.colegioId, gradoId: p.gradoId, seccionId: p.seccionId, fechaInicio, fechaFin,
        }).catch(() => [] as DiaSinClase[]);

        const estudiantes: AsistenciaReporteItem[] = await invoke("get_asistencia_rango", {
          fechaInicio, fechaFin, anoLectivoId: Number(selectedAno),
          colegioId: p.colegioId, gradoId: p.gradoId, seccionId: p.seccionId,
        });
        const filas = selectedSexo ? estudiantes.filter(e => e.sexo === selectedSexo) : estudiantes;
        if (filas.length === 0) continue;

        const notaSinClases = sinClases
          .filter(d => d.fecha >= fechaInicio && d.fecha <= fechaFin)
          .map(d => `${fmtDM(d.fecha)} (${d.descripcion})`).join(', ');

        const fechasCols = columnasDePeriodo(cfg, sinClases);
        tablas.push({
          titulo: `${p.gradoNombre} - Sección ${p.seccionNombre}`,
          subtitulo: `${p.colegioNombre} · Año lectivo ${anoNombre}`,
          layout: 'fechas',
          headers: ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"],
          body: filas.map(est => {
            const estados = fechasCols.map(f => getEstadoEnFecha(est, f));
            const cuenta = (e: string) => estados.filter(x => x === e).length;
            return [est.nombre, est.sexo, ...estados, cuenta('P'), cuenta('A'), cuenta('J')];
          }),
          nota: notaSinClases || undefined,
          chip: `Sección: ${p.gradoNombre} - ${p.seccionNombre}`,
        });
      }

      if (tablas.length === 0) {
        await emit("show-toast", { message: "⚠️ No se encontraron estudiantes en el período", type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      progresoMasivo = 'Generando PDF...';
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_');

      const lineas = [`Período ${encabezadoPeriodo}`];
      if (selectedSexo) lineas.push(`Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}`);

      const bytes = await generarPdfAsistencia(
        { titulo: 'Reporte de Asistencia', lineas },
        tablas
      );

      const docsPath = await documentDir();
      const folderName = "School Tracker";
      const subfolder = `${sanitize(anoNombre)} - Asistencia ${sanitize(periodoEtiqueta)}`;
      const sep = isAndroid ? '/' : '\\';
      const baseDir = docsPath + sep + folderName + sep + subfolder;
      await mkdir(baseDir, { recursive: true }).catch(e => console.log("mkdir:", e));

      const fileName = `Asistencia ${sanitize(periodoEtiqueta)} ${sanitize(anoNombre)}.pdf`;
      const filePath = baseDir + sep + fileName;
      await writeFile(filePath, bytes);

      exportandoMasivo = false;
      const destino = isAndroid ? "Descargas/School Tracker" : "Documents/School Tracker";
      if (isAndroid) {
        const ruta = await invoke<string>('guardar_en_descargas', {
          path: filePath, mime: 'application/pdf', carpeta: `${folderName}/${subfolder}`, nombre: fileName,
        }).catch(() => "");
        if (ruta) {
          try { await invoke('share_pdf', { path: ruta }); } catch { }
          await emit("show-toast", { message: `✅ ${tablas.length} hojas en ${destino}/${subfolder}`, type: 'success' });
        } else {
          await emit("show-toast", { message: `✅ PDF en la app (no se pudo copiar a Descargas)`, type: 'warning' });
        }
      } else {
        await openUrl("file:///" + baseDir.replace(/\\/g, "/"));
        await emit("show-toast", { message: `✅ ${tablas.length} hojas en ${destino}/${subfolder}`, type: 'success' });
      }
    } catch (error) {
      console.error("Error al exportar PDF de asistencia:", error);
      exportandoMasivo = false;
      await emit("show-toast", { message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), type: 'error' });
    }
  }

  /**
   * Columnas de fechas del período para un grado/seccion: solo días hábiles del
   * colegio y excluye los marcados como sin clases (no cuentan P/A/J).
   */
  function columnasDePeriodo(cfg: ColegioDiasAsistencia | null, sinClases: DiaSinClase[]): string[] {
    const diasMap: Record<number, boolean> = {
      0: cfg?.domingo ?? true, 1: cfg?.lunes ?? true, 2: cfg?.martes ?? true,
      3: cfg?.miercoles ?? true, 4: cfg?.jueves ?? true, 5: cfg?.viernes ?? true, 6: cfg?.sabado ?? true,
    };
    const marcadas = new Set(sinClases.map(d => d.fecha));
    const out: string[] = [];
    const temp = new Date(fechaInicio + "T12:00:00");
    const fin = new Date(fechaFin + "T12:00:00");
    while (temp <= fin) {
      const iso = getLocalDateISOString(temp);
      if (diasMap[temp.getDay()] && !marcadas.has(iso)) out.push(iso);
      temp.setDate(temp.getDate() + 1);
    }
    return out;
  }

  async function handlePrintWithIframe() {
    if (reporteFiltrado.length === 0) { await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' }); return; }
    try {
      await emit("show-toast", { message: "✅ Preparando reporte...", type: 'success' });
      const anoNombrePrint = anos.find(a => a.id === selectedAno)?.nombre || String(selectedAno);
      const fechasCols = getFechasUnicas();
      const headers = ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
      const rows = reporteFiltrado.map(est => {
        const p = est.fechas.filter(f => f.endsWith(':P')).length;
        const a = est.fechas.filter(f => f.endsWith(':A')).length;
        const j = est.fechas.filter(f => f.endsWith(':J')).length;
        return `<tr><td class="nombre">${est.nombre}</td><td>${est.sexo}</td>${fechasCols.map(f => {
          const estado = getEstadoEnFecha(est, f);
          const cls = estado === 'P' ? 'estado-P' : estado === 'A' ? 'estado-A' : estado === 'J' ? 'estado-J' : '';
          return `<td class="${cls}">${estado}</td>`;
        }).join('')}<td class="estado-P">${p}</td><td class="estado-A">${a}</td><td class="estado-J">${j}</td></tr>`;
      }).join('');
      printHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Helvetica,Arial,sans-serif;padding:12px;color:#111827}
        .cab{display:flex;gap:7px;align-items:flex-start;margin-bottom:5px}
        .barra{width:4px;align-self:stretch;min-height:26px;background:#10b981;border-radius:2px}
        .titulo{font-size:18px;font-weight:700;color:#111827;line-height:1.15}
        .subtitulo{font-size:11px;color:#4b5563;font-weight:600;margin-top:2px}
        .chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 8px}
        .chip{background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:5px;padding:3px 8px;font-size:9.5px;font-weight:600;white-space:nowrap}
        .chip-neutro{background:#f9fafb;border-color:#d1d5db;color:#374151}
        .chip-alerta{background:#fffbeb;border-color:#fcd34d;color:#92400e}
        table{border-collapse:collapse;width:100%;font-size:8.5px;table-layout:auto}
        thead{display:table-header-group}
        th,td{border:1.4px solid #111827;padding:3px 4px;text-align:center;line-height:1.15}
        th{background:#d1fae5;color:#064e3b;font-weight:700;white-space:nowrap}
        th:first-child{text-align:left}
        td.nombre{color:#000;font-weight:700;text-align:left;white-space:nowrap}
        tbody tr:nth-child(even){background:#f7fdfa}
        .estado-P{color:#047857;font-weight:700}
        .estado-A{color:#b91c1c;font-weight:700}
        .estado-J{color:#a16207;font-weight:700}
        @page{size:letter landscape;margin:8mm}
        @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        th{background:#d1fae5!important}tbody tr:nth-child(even){background:#f7fdfa!important}
        .estado-P{color:#047857!important}.estado-A{color:#b91c1c!important}.estado-J{color:#a16207!important}
        tr{page-break-inside:avoid}}
      </style></head><body>
        <div class="cab">
          <div class="barra"></div>
          <div>
            <div class="titulo">${gradoNombre} - Sección ${seccionNombre}</div>
            <div class="subtitulo">${colegioNombre} · Año lectivo ${anoNombrePrint}</div>
          </div>
        </div>
        <div class="chips">
          <span class="chip">Reporte de Asistencia</span>
          <span class="chip">Período ${encabezadoPeriodo}</span>
          <span class="chip chip-neutro">Sección: ${gradoNombre} - ${seccionNombre}</span>
          ${selectedSexo ? `<span class="chip chip-neutro">Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}</span>` : ''}
          ${diasSinClasesNota ? `<span class="chip chip-alerta">${diasSinClasesNota}</span>` : ''}
        </div>
        <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    } catch (error) {
      console.error("Error generando reporte:", error);
      await emit("show-toast", { message: "❌ Error al generar el reporte", type: 'error' });
    }
  }

</script>
{#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder="Buscar..." />{/if}


<div class="page-container" style="height: 100%; min-height: 0;">
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
    @media(max-width:600px){.ireport-grid{grid-template-columns:repeat(2,1fr)}}
    .asistencia-btn{padding:0.3rem 0.75rem;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#94a3b8;white-space:nowrap;transition:all 0.15s cubic-bezier(0.4,0,0.2,1)}
    .asistencia-btn:active{transform:scale(0.95)}
    .asistencia-btn.p{background:rgba(16,185,129,0.15)!important;border-color:#10b981!important;color:#10b981!important}
    .asistencia-btn.a{background:rgba(239,68,68,0.15)!important;border-color:#ef4444!important;color:#ef4444!important}
    .asistencia-btn.j{background:rgba(245,158,11,0.15)!important;border-color:#f59e0b!important;color:#f59e0b!important}
    .semanal-status{display:inline-block;padding:0.25rem 0.4rem;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:default;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#94a3b8;transition:all 0.15s ease;white-space:nowrap;text-align:center;user-select:none;width:100%;box-sizing:border-box}
    .semanal-status.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .semanal-status.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .semanal-status.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .ciclo-cell{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;cursor:default;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#64748b;margin:0 auto}
    .ciclo-cell.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .ciclo-cell.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .ciclo-cell.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    .mensual-chip-row{display:flex;gap:2px;overflow-x:auto;padding-bottom:0.2rem}
    .mensual-chip{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#64748b;transition:all 0.15s ease}
    .mensual-chip.estado-p{background:rgba(16,185,129,0.15);border-color:#10b981;color:#10b981}
    .mensual-chip.estado-a{background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444}
    .mensual-chip.estado-j{background:rgba(245,158,11,0.15);border-color:#f59e0b;color:#f59e0b}
    @media(max-width:480px){.obs-toggle-btn{width:26px!important;height:26px!important;min-width:26px!important;font-size:0.7rem!important}}
    .table-container::-webkit-scrollbar{width:6px}
    .table-container::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);border-radius:3px}
    .table-container::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:3px}
    .table-container::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
    /* Separador de semanas en la vista mensual: línea vertical antes del lunes */
    .sep-semana{border-left:2px solid rgba(148,163,184,0.5)!important}
    .custom-table thead th{position:sticky;top:0;z-index:10;background:#1e293b!important}
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
    .dsc-banner{display:flex;align-items:center;gap:1rem;margin:.5rem 1rem;padding:1.1rem 1.3rem;border-radius:16px;background:linear-gradient(135deg,rgba(245,158,11,.14),rgba(245,158,11,.04));backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(245,158,11,.28);animation:dsc-in .25s cubic-bezier(.34,1.3,.64,1)}
    @keyframes dsc-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
    .dsc-icon{width:50px;height:50px;border-radius:14px;background:rgba(245,158,11,.16);border:1px solid rgba(245,158,11,.32);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0}
    .dsc-badge{display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.62rem;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.35);color:#fbbf24;white-space:nowrap}
    .dsc-th{background:#2b2410!important;color:#fbbf24!important}
    .dsc-col{background:linear-gradient(180deg,rgba(245,158,11,.10),rgba(245,158,11,.02));text-align:center;vertical-align:middle;color:#f59e0b;font-weight:700;padding:.5rem .35rem;min-width:70px}
    .dsc-motivo{display:block;font-size:.62rem;line-height:1.35;word-break:break-word;margin-top:2px}
  </style>

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile} style="padding:{isAndroidMobile ? '0.5rem' : ''}">
        <div style="display:flex;{isAndroidMobile ? 'flex-wrap:wrap' : 'flex-wrap:nowrap'};gap:0.4rem;width:100%;align-items:flex-end">
          {#if !isAndroidMobile}
            <FilterGroup label="Período:" {isMobile}>
              <select class="filter-select" bind:value={periodo} style="width:100%">
                <option value="mensual">Mensual</option>
                <option value="semanal">Semanal</option>
              </select>
            </FilterGroup>
          {/if}

          {#if periodo === "semanal"}
            {#if !isAndroidMobile}
              <FilterGroup label="Semana de:" {isMobile}>
                <div class="pop-wrap" bind:this={popRootEl}>
                  <button type="button" class="filter-select pop-trigger" onclick={() => popSemanaAbierta = !popSemanaAbierta}>
                    <span>Semana {semanaActiva} · {semanasOpts.find(s => s.n === semanaActiva)?.rango ?? ''}</span>
                    <span class="pop-caret">▾</span>
                  </button>

                  {#if popSemanaAbierta}
                    <div class="pop-panel" tabindex="-1">
                      <div class="pop-mes">
                        <button type="button" class="pop-nav" onclick={() => cambiarMesSemInforme(-1)} title="Mes anterior">‹</button>
                        <span class="pop-mes-txt">{nombreMes(mesSeleccionado)} {anoSeleccionado}</span>
                        <button type="button" class="pop-nav" onclick={() => cambiarMesSemInforme(1)} title="Mes siguiente">›</button>
                      </div>

                      <div class="pop-sems">
                        {#each semanasOpts as s (s.lunes)}
                          <button
                            type="button"
                            class="pop-sem"
                            class:sel={semanaActiva === s.n}
                            onclick={() => elegirSemanaInforme(s)}
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
            {/if}
          {:else}
            {#if !isAndroidMobile}
              <FilterGroup label="Mes:" {isMobile}>
                <select class="filter-select" bind:value={mesSeleccionado} style="width:100%">
                  <option value={1}>Enero</option><option value={2}>Febrero</option><option value={3}>Marzo</option>
                  <option value={4}>Abril</option><option value={5}>Mayo</option><option value={6}>Junio</option>
                  <option value={7}>Julio</option><option value={8}>Agosto</option><option value={9}>Septiembre</option>
                  <option value={10}>Octubre</option><option value={11}>Noviembre</option><option value={12}>Diciembre</option>
                </select>
              </FilterGroup>
              <FilterGroup label="Año:" {isMobile}>
                <select class="filter-select" bind:value={anoSeleccionado} style="width:100%">
                  {#each Array(5) as _, i}
                    {@const year = new Date().getFullYear() - 2 + i}
                    <option value={year}>{year}</option>
                  {/each}
                </select>
              </FilterGroup>
            {/if}
          {/if}

          {#if isAndroidMobile}
            <div style="width:100%;padding:0.1rem 0 0.3rem;">
              <input bind:value={searchTerm} placeholder="🔍 Buscar..."
                style="width:100%;height:38px;padding:0 0.8rem;font-size:0.82rem;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;box-sizing:border-box;" />
            </div>
            <button onclick={() => showFiltersModal = true} title="Filtros (Período · Año · Colegio · Grado · Sección · Sexo · Semana/Mes)"
              style="width:100%;height:42px;padding:0 0.9rem;font-size:0.85rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:#e2e8f0;border-radius:8px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.15s;white-space:nowrap;margin-bottom:0.3rem"
              onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
              onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}>
              <span>🔍</span>
              <span style="overflow:hidden;text-overflow:ellipsis;">{(colegios.find(c => c.id === selectedColegio)?.nombre)?.split(' ')[0] || 'Colegio'} · {grados.find(g => g.id === selectedGrado)?.nombre || 'Grado'} · {secciones.find(s => s.id === selectedSeccion)?.nombre || 'Sección'}</span>
            </button>
          {:else}
            {#if showAnoDropdown}
            <FilterGroup label="Año Lectivo:" {isMobile}>
              <select class="filter-select" bind:value={selectedAno} style="width:100%">
                {#each anos as a}
                  <option value={a.id}>{a.nombre}</option>
                {/each}
              </select>
            </FilterGroup>
            {/if}

            <FilterGroup label="Colegio:" {isMobile}>
              <select class="filter-select" bind:value={selectedColegio} style="width:100%">
                {#each colegios as c}
                  <option value={c.id}>{c.nombre}</option>
                {/each}
              </select>
            </FilterGroup>

            <FilterGroup label="Grado:" {isMobile}>
              <select class="filter-select" bind:value={selectedGrado} style="width:100%">
                {#each grados as g}
                  <option value={g.id}>{g.nombre}</option>
                {/each}
              </select>
            </FilterGroup>

            <FilterGroup label="Sección:" {isMobile}>
              <select class="filter-select" bind:value={selectedSeccion} style="width:100%">
                {#each secciones as s}
                  <option value={s.id}>{s.nombre}</option>
                {/each}
              </select>
            </FilterGroup>

            <FilterGroup label="Sexo:" {isMobile}>
              <select class="filter-select" bind:value={selectedSexo} style="width:100%">
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </FilterGroup>
          {/if}

          <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'}">
            {#if !isAndroid}
              <button onclick={handlePrintWithIframe} disabled={reporteFiltrado.length === 0 || loading}
                style="height:42px;padding:0 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;flex-shrink:0;gap:6px;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:{reporteFiltrado.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);letter-spacing:0.3px;white-space:nowrap;opacity:{reporteFiltrado.length === 0 || loading ? 0.7 : 1}"
                title={isMobile ? "Compartir reporte" : "Imprimir reporte"}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Imprimir
              </button>
            {/if}
            <button onclick={exportarPdfAsistencia} disabled={exportandoMasivo || !selectedAno}
              title="Genera un único PDF con una hoja por cada grado y sección de todos los colegios del año lectivo, para el período y la asignatura seleccionados"
              style="height:42px;padding:0 {isMobile ? '0.55rem' : '0.95rem'};display:flex;align-items:center;gap:0.5rem;flex-shrink:0;border:1px solid rgba(129,140,248,0.5);border-radius:10px;background:linear-gradient(135deg,rgba(99,102,241,0.28),rgba(56,189,248,0.22));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#e0e7ff;font-weight:700;font-size:{isMobile ? '0.78rem' : '0.8rem'};cursor:{exportandoMasivo || !selectedAno ? 'default' : 'pointer'};box-shadow:0 6px 18px rgba(79,70,229,0.28);white-space:nowrap;opacity:{exportandoMasivo || !selectedAno ? 0.65 : 1};transition:transform 0.15s ease,box-shadow 0.2s ease,background 0.2s ease"
              onmouseenter={(e) => { if (!exportandoMasivo) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              onmousedown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
              onmouseup={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}>
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(99,102,241,0.45);color:#c7d2fe;flex-shrink:0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </span>
              {#if isMobile}
                <span>{exportandoMasivo ? progresoMasivo : 'PDF'}</span>
              {:else}
                <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;gap:1px;min-width:0">
                  <span>{exportandoMasivo ? progresoMasivo : 'Exportar Todo'}</span>
                  <span style="font-size:0.6rem;font-weight:600;color:#a5b4fc;letter-spacing:0.2px;max-width:150px;overflow:hidden;text-overflow:ellipsis">{exportandoMasivo ? 'Generando PDF' : resumenPeriodo}</span>
                </span>
              {/if}
            </button>
            <div style="flex:1;min-width:100px">
            </div>
          </div>
        </div>
      </FilterContainer>
    {/snippet}

    <div style="display:none" class="print-header">
      <div class="print-title">Reporte de Asistencia</div>
      <div class="print-grid">
        <div><strong>Colegio:</strong> {colegioNombre}</div>
        <div><strong>Grado:</strong> {gradoNombre}</div>
        <div><strong>Sección:</strong> {seccionNombre}</div>
        <div><strong>Período:</strong> {encabezadoPeriodo}</div>
      </div>
    </div>

    {#if isMobile && reporteFiltrado.length > 0}
      <div style="margin-top:0;margin-left:-0.4rem;margin-right:-0.4rem;padding:0.5rem 0.4rem 0.2rem;width:calc(100% + 0.8rem);border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:0.5rem;align-items:stretch">
        <div style="display:flex;align-items:center;justify-content:center;gap:0.8rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.6rem;flex:0 0 auto">
          <div style="display:flex;align-items:center;gap:2px">
            <span style="color:#f472b6;font-weight:bold;font-size:0.8rem">F:</span>
            <span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsTotal.f}</span>
          </div>
          <div style="display:flex;align-items:center;gap:2px">
            <span style="color:#60a5fa;font-weight:bold;font-size:0.8rem">M:</span>
            <span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsTotal.m}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-around;gap:0.3rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.3rem;flex:1;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none">
          <div onclick={() => handleCardClick('Total', statsTotal)} style="display:flex;align-items:center;gap:2px;cursor:pointer">
            <span style="color:#06b6d4;font-weight:bold;font-size:0.8rem">E:</span>
            <span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsTotal.total}</span>
          </div>
          <div onclick={() => handleCardClick('Presentes', statsP)} style="display:flex;align-items:center;gap:2px;cursor:pointer">
            <span style="color:#10b981;font-weight:bold;font-size:0.8rem">P:</span>
            <span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsP.total}</span>
          </div>
          <div onclick={() => handleCardClick('Ausentes', statsA)} style="display:flex;align-items:center;gap:2px;cursor:pointer">
            <span style="color:#ef4444;font-weight:bold;font-size:0.8rem">A:</span>
            <span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsA.total}</span>
          </div>
          <div onclick={() => handleCardClick('Justificados', statsJ)} style="display:flex;align-items:center;gap:2px;cursor:pointer">
            <span style="color:#f59e0b;font-weight:bold;font-size:0.8rem">J:</span>
            <span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsJ.total}</span>
          </div>
        </div>
      </div>
    {/if}

    {#if !isMobile && reporteFiltrado.length > 0}
      <div class="ireport-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.4rem;margin:0.5rem 0;padding:0;width:100%;max-width:100%">
        <div class="summary-card" onclick={() => handleCardClick('Total', statsTotal)}>
          <div class="card-accent" style="background:#06b6d4"></div>
          <span class="card-icon">📋</span>
          <span class="card-value">{statsTotal.total}</span>
          <span class="card-label">Total</span>
          <div class="card-gender"><span class="gender-m">M:{statsTotal.m}</span><span class="gender-f">F:{statsTotal.f}</span></div>
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
      </div>
    {/if}

    {#if dscPeriodoVacio}
      <div class="dsc-banner">
        <div class="dsc-icon">🚫</div>
        <div style="flex:1;min-width:0;text-align:left">
          <h3 style="margin:0 0 .25rem;color:#fbbf24;font-size:1.05rem">No hubo clases en todo el período</h3>
          <p style="margin:0;color:#e2e8f0;font-size:.88rem;font-weight:600">{diasSinClasesNota.replace('Sin clases: ', '')}</p>
          <p style="margin:.25rem 0 0;color:#94a3b8;font-size:.75rem;text-transform:capitalize">{fechaInicio} al {fechaFin}</p>
        </div>
        <span class="dsc-badge">{(() => { const c = diasSinClases.find(d => d.fecha >= fechaInicio && d.fecha <= fechaFin); return c ? (c.grado_id === null ? '🏫 Todo el colegio' : '🚪 Esta sección') : ''; })()}</span>
      </div>
    {/if}

    <ScrollableTable>
      {#if loading}
        <div class="loading-container">Cargando reporte...</div>
      {:else if reporteFiltrado.length === 0}
        <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px;margin:0 1rem">
          <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📊'}</div>
          <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? 'No se encontraron resultados' : 'No hay datos para mostrar'}</h4>
          <p style="color:#94a3b8;max-width:400px;margin:0 auto">
            {searchTerm ? `No se encontró ningún estudiante que coincida con "${searchTerm}"` : 'No se encontraron registros de asistencia para los filtros seleccionados.'}
          </p>
          {#if searchTerm}
            <button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">Limpiar búsqueda</button>
          {/if}
        </div>
      {:else if isAndroidMobile}
        <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
          {#each reporteFiltrado as item, index}
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
              <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                <span style="font-size:1rem;flex-shrink:0">{item.sexo === 'F' ? '👩' : '👨'}</span>
                <span style="flex:1;font-weight:bold;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{item.nombre}</span>
              </div>
              {#if periodo === 'semanal'}
                <div style="display:flex;gap:0.4rem;overflow-x:auto;padding-bottom:0.2rem">
                  {#each fechasColumnas as fecha}
                    {@const est = getEstadoEnFecha(item, fecha)}
                    {@const dayName = new Date(fecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' }).replace('.','')}
                    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;min-width:68px">
                      <span style="font-size:0.55rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.2px;white-space:nowrap">{dayName}</span>
                      <div class="semanal-status" class:estado-p={est === 'P'} class:estado-a={est === 'A'} class:estado-j={est === 'J'}>
                        {est === 'P' ? 'Pres' : est === 'A' ? 'Aus' : est === 'J' ? 'Just' : '—'}
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="mensual-chip-row">
                  {#each fechasColumnas as fecha}
                    {@const est = getEstadoEnFecha(item, fecha)}
                    <div class="mensual-chip" class:estado-p={est === 'P'} class:estado-a={est === 'A'} class:estado-j={est === 'J'}
                      title={new Date(fecha + "T12:00:00").toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}>
                      {new Date(fecha + "T12:00:00").getDate()}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else if periodo === "semanal"}
        <table class="custom-table" style="width:100%;margin:0;overflow:visible">
          <thead>
            <tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10;width:220px">Estudiante</th>
              {#each fechasVisibles as f}
                <th class:dsc-th={esSinClases(f)}
                  style="min-width:105px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;font-size:0.7rem;font-weight:600;padding:0.3rem 0.15rem"
                  title={esSinClases(f) ? motivoSinClasesEn(f) : undefined}>
                  {esSinClases(f) ? '🚫 ' : ''}{new Date(f + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }).replace('.','').replace(',','')}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each reporteFiltrado as item, index}
              <tr>
                <td><span class="student-number-badge">{index + 1}</span></td>
                <td style="text-align:left">
                  <span style="font-weight:bold;font-size:0.85rem;cursor:pointer;white-space:normal;word-break:break-word;line-height:1.25" onclick={() => selectedStudentDetail = item}>{item.nombre}</span>
                  <div style="font-size:0.65rem;opacity:0.6">{item.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                </td>
                {#each fechasVisibles as f}
                  {#if esSinClases(f)}
                    {#if index === 0}
                      <td class="dsc-col" rowspan={reporteFiltrado.length}>
                        <span style="font-size:1.1rem">🚫</span>
                        <span class="dsc-motivo">{motivoSinClasesEn(f)}</span>
                      </td>
                    {/if}
                  {:else}
                    {@const est = getEstadoEnFecha(item, f)}
                    {@const obs = getObservacionEnFecha(item, f)}
                    <td style="text-align:center;padding:0.15rem;min-width:105px">
                      <div class="semanal-status" class:estado-p={est === 'P'} class:estado-a={est === 'A'} class:estado-j={est === 'J'}
                        title={est === 'P' ? 'Presente' : est === 'A' ? 'Ausente' : est === 'J' ? 'Justificado' : 'Sin registro'}>
                        {est === 'P' ? 'Presente' : est === 'A' ? 'Ausente' : est === 'J' ? 'Justificado' : '—'}
                      </div>
                      {#if obs}
                        <div class="semanal-obs" style="cursor:default" title={`Observación: ${obs}`}>{obs}</div>
                      {/if}
                    </td>
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <table class="custom-table" style="width:100%;margin:0;overflow:visible">
          <thead>
            <tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10;min-width:200px">Estudiante</th>
              {#each fechasVisibles as f, iFecha}
                <th class:dsc-th={esSinClases(f)} class:sep-semana={esInicioSemana(f, iFecha)}
                  style="font-size:0.7rem;white-space:nowrap;position:sticky;top:0;background:#1e293b;z-index:10;min-width:48px;padding:0.35rem 0.45rem"
                  title={esSinClases(f) ? motivoSinClasesEn(f) : undefined}>
                  <div style="font-size:0.6rem;opacity:0.7">{esSinClases(f) ? '🚫 ' : ''}{new Date(f + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' })}</div>
                  {f.split('-').slice(1).reverse().join('/')}
                </th>
              {/each}
              <th style="width:{isAndroidMobile ? '24px' : '30px'};position:sticky;top:0;background:#1e293b;z-index:10">P</th>
              <th style="width:{isAndroidMobile ? '24px' : '30px'};position:sticky;top:0;background:#1e293b;z-index:10">A</th>
              <th style="width:{isAndroidMobile ? '24px' : '30px'};position:sticky;top:0;background:#1e293b;z-index:10">J</th>
            </tr>
          </thead>
          <tbody>
            {#each reporteFiltrado as item, index}
              {@const p = item.fechas.filter(f => f.endsWith(':P')).length}
              {@const a = item.fechas.filter(f => f.endsWith(':A')).length}
              {@const j = item.fechas.filter(f => f.endsWith(':J')).length}
              <tr>
                <td><span class="student-number-badge">{index + 1}</span></td>
                <td style="text-align:left;overflow:hidden">
                  <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;width:100%" onclick={() => selectedStudentDetail = item}>
                    <span style="font-size:1.1rem;flex-shrink:0">{item.sexo === 'F' ? '👩' : '👨'}</span>
                    <span style="white-space:normal;word-break:break-word;line-height:1.25">{item.nombre}</span>
                  </div>
                  <div style="font-size:0.7rem;opacity:0.6;margin-left:22px">{item.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                </td>
                {#each fechasVisibles as f, iFecha}
                  {#if esSinClases(f)}
                    {#if index === 0}
                      <td class="dsc-col" rowspan={reporteFiltrado.length} style="min-width:48px">
                        <span style="font-size:0.9rem">🚫</span>
                        <span class="dsc-motivo" style="font-size:.55rem">{motivoSinClasesEn(f)}</span>
                      </td>
                    {/if}
                  {:else}
                    {@const est = getEstadoEnFecha(item, f)}
                    <td class:sep-semana={esInicioSemana(f, iFecha)}>
                      <div class="ciclo-cell" class:estado-p={est === 'P'} class:estado-a={est === 'A'} class:estado-j={est === 'J'}>{est}</div>
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
  </PageLayout>

  {#if showSummaryModal.show}
    <div class="modal-overlay" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }}>
      <div class="modal-content category-card" style="width:300px;max-width:85%;padding:1.2rem;text-align:center" onclick={(e) => e.stopPropagation()}>
        <h3 style="margin-top:0;color:var(--primary-color);font-size:1.2rem;margin-bottom:1rem">📊 {showSummaryModal.type}</h3>
        <div style="display:flex;flex-direction:column;gap:0.8rem">
          <div style="background:rgba(255,255,255,0.05);padding:0.8rem;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="color:#94a3b8">Total:</span>
            <span style="font-size:1.3rem;font-weight:bold;color:#fff">{showSummaryModal.stats?.total}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem">
            <div style="background:rgba(96,165,250,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:2px">
              <span style="color:#60a5fa;font-size:0.8rem">Masculino</span>
              <span style="font-size:1.2rem;font-weight:bold;color:#60a5fa">{showSummaryModal.stats?.m}</span>
            </div>
            <div style="background:rgba(244,114,182,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:2px">
              <span style="color:#f472b6;font-size:0.8rem">Femenino</span>
              <span style="font-size:1.2rem;font-weight:bold;color:#f472b6">{showSummaryModal.stats?.f}</span>
            </div>
          </div>
        </div>
        <button class="primary" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }} style="margin-top:1.5rem;width:100%">Cerrar</button>
      </div>
    </div>
  {/if}

  <!-- Modal de filtros Android: componente reutilizable con extras (Período, Semana, Mes/Año). -->
  <FiltersModalAndroid
    bind:open={showFiltersModal}
    {isAndroidMobile}
    {isMobile}
    showAno={showAnoDropdown}
    bind:anos bind:colegios bind:grados bind:secciones
    bind:selectedAno bind:selectedColegio bind:selectedGrado bind:selectedSeccion bind:selectedSexo
  >
    {#snippet extras()}
      <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
        <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Período:</label>
        <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px" bind:value={periodo}>
          <option value="mensual">Mensual</option>
          <option value="semanal">Semanal</option>
        </select>
      </div>
      {#if periodo === "semanal"}
        <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
          <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Semana de:</label>
          <button type="button" class="filter-select filter-select-solid pop-trigger"
            onclick={() => { showFiltersModal = false; setTimeout(() => popSemanaAbierta = true, 50); }}
            style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px;text-align:left;cursor:pointer">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">Semana {semanaActiva} · {semanasOpts.find(s => s.n === semanaActiva)?.rango ?? ''}</span>
          </button>
        </div>
      {/if}
      {#if periodo === "mensual"}
        <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
          <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Mes:</label>
          <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px" bind:value={mesSeleccionado}>
            <option value={1}>Enero</option><option value={2}>Febrero</option><option value={3}>Marzo</option>
            <option value={4}>Abril</option><option value={5}>Mayo</option><option value={6}>Junio</option>
            <option value={7}>Julio</option><option value={8}>Agosto</option><option value={9}>Septiembre</option>
            <option value={10}>Octubre</option><option value={11}>Noviembre</option><option value={12}>Diciembre</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
          <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Año:</label>
          <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px" bind:value={anoSeleccionado}>
            {#each Array(5) as _, i}
              {@const year = new Date().getFullYear() - 2 + i}
              <option value={year}>{year}</option>
            {/each}
          </select>
        </div>
      {/if}
    {/snippet}
  </FiltersModalAndroid>

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

  {#if printHtml}
    <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;padding:20px">
      <div style="background-color:white;border-radius:12px;width:100%;max-width:900px;height:90vh;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:15px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background-color:#f8fafc">
          <span style="font-size:16px;font-weight:600;color:#1e293b">Vista Previa de Impresión</span>
          <div style="display:flex;gap:10px">
            <button onclick={() => { const iframe = document.querySelector('iframe'); if (iframe?.contentWindow) iframe.contentWindow.print(); }}
              style="padding:8px 16px;background-color:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">🖨️ Imprimir</button>
            <button onclick={() => printHtml = null} style="padding:8px 16px;background-color:#64748b;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">Cerrar</button>
          </div>
        </div>
        <iframe srcdoc={printHtml} style="flex:1;width:100%;border:none" title="Print Preview" />
      </div>
    </div>
  {/if}
</div>