<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { join, tempDir, documentDir } from "@tauri-apps/api/path";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import { registerBackHandler } from "../lib/androidBack";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import FilterActions from "./FilterActions.svelte";
  import SearchFab from "./SearchFab.svelte";
  import PageLayout from "./PageLayout.svelte";
  import DatePickerGlass from "./DatePickerGlass.svelte";
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

  // Visible = la página contenedora está activa Y este es el sub-tab seleccionado.
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

  let isMobile = $state(false);
  let isAndroid = $state(false);
  let isWindows = $state(false);
  let isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));

  let periodo = $state<"diario" | "semanal" | "mensual">("diario");
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
    silentRefresh = true;
    fetchReporte();
  });
  let printHtml: string | null = $state(null);

  let colegioNombre = $derived(colegios.find(c => c.id === selectedColegio)?.nombre || "");
  let gradoNombre = $derived(grados.find(g => g.id === selectedGrado)?.nombre || "");
  let seccionNombre = $derived(secciones.find(s => s.id === selectedSeccion)?.nombre || "");

  // ── Modo semanal: popover mes + semanas ──
  const pad2 = (n: number) => String(n).padStart(2, '0');
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
  function nombreMes(m: number): string {
    return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][m] ?? '';
  }

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

    const unsub1 = listen("asistencia-updated", () => { silentRefresh = true; fetchReporte(); });
    const unsub2 = listen("student-updated", () => { silentRefresh = true; fetchReporte(); });
    const unsub3 = listen("catalog-updated", () => refreshTrigger++);

    fetchCatalogs();

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('schooltracker-sync', onSync);
      unsub1.then(f => f());
      unsub2.then(f => f());
      unsub3.then(f => f());
    };
  });

  function onSync() { silentRefresh = true; refreshTrigger++; }

  $effect(() => {
    const hoy = new Date();
    const base = new Date(fechaBase + "T12:00:00");
    if (periodo === "diario") {
      fechaInicio = fechaBase;
      fechaFin = fechaBase;
    } else if (periodo === "semanal") {
      const day = base.getDay();
      const diff = base.getDate() - day + (day === 0 ? -6 : 1);
      const lunes = new Date(base.setDate(diff));
      const domingo = new Date(lunes);
      domingo.setDate(lunes.getDate() + 6);
      fechaInicio = getLocalDateISOString(lunes);
      fechaFin = getLocalDateISOString(domingo);
    } else if (periodo === "mensual") {
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

  function getFechasUnicas() {
    const fechasSet = new Set<string>();
    if (colegioConfig && (periodo === "semanal" || periodo === "mensual")) {
      const inicio = new Date(fechaInicio + "T12:00:00");
      const fin = new Date(fechaFin + "T12:00:00");
      const temp = new Date(inicio);
      const diasMap: Record<number, boolean> = {
        0: colegioConfig.domingo, 1: colegioConfig.lunes, 2: colegioConfig.martes,
        3: colegioConfig.miercoles, 4: colegioConfig.jueves, 5: colegioConfig.viernes, 6: colegioConfig.sabado,
      };
      while (temp <= fin) {
        if (diasMap[temp.getDay()]) fechasSet.add(getLocalDateISOString(temp));
        temp.setDate(temp.getDate() + 1);
      }
    } else {
      reporte.forEach(item => { item.fechas.forEach(f => { const [fecha] = f.split(':'); fechasSet.add(fecha); }); });
      if (periodo === "diario" && fechasSet.size === 0) fechasSet.add(fechaBase);
    }
    return Array.from(fechasSet).sort();
  }

  let fechasColumnas = $derived(getFechasUnicas());

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

  async function exportToPDF() {
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
      const margins = { top: 10, bottom: 10, left: 10, right: 10 };
      doc.setFontSize(16);
      doc.text("Reporte", margins.left + 4, 15);
      doc.setFontSize(10);
      doc.text(`Colegio: ${colegioNombre}`, margins.left + 4, 22);
      doc.text(`Grado: ${gradoNombre} - Sección: ${seccionNombre}`, margins.left + 4, 27);
      doc.text(`Periodo: ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})`, margins.left + 4, 32);
      if (selectedSexo) doc.text(`Filtro Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}`, margins.left + 4, 37);

      let headers: string[], body: any[][];
      if (periodo === "diario") {
        headers = ["Estudiante", "Sexo", "Estado", "Observación"];
        body = reporteFiltrado.map(est => [est.nombre, est.sexo, getEstadoEnFecha(est, fechaInicio) === '-' ? 'Sin registro' : getEstadoEnFecha(est, fechaInicio), getObservacionEnFecha(est, fechaInicio)]);
      } else {
        const fechasCols = getFechasUnicas();
        headers = ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
        body = reporteFiltrado.map(est => {
          const p = est.fechas.filter(f => f.endsWith(':P')).length;
          const a = est.fechas.filter(f => f.endsWith(':A')).length;
          const j = est.fechas.filter(f => f.endsWith(':J')).length;
          return [est.nombre, est.sexo, ...fechasCols.map(f => getEstadoEnFecha(est, f)), p, a, j];
        });
      }

      autoTable(doc, {
        startY: selectedSexo ? 42 : 37,
        margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [headers], body,
        styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { fillColor: [16, 185, 129] },
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            const val = String(data.cell.raw);
            if (val === 'P') data.cell.styles.textColor = [16, 185, 129];
            if (val === 'A') data.cell.styles.textColor = [239, 68, 68];
            if (val === 'J') data.cell.styles.textColor = [155, 89, 182];
          }
        }
      });

      const pdfData = doc.output('arraybuffer');
      const fileName = `Asistencia_${gradoNombre}_${seccionNombre}_${fechaInicio}.pdf`;
      const docsPath = await documentDir();
      const folderName = "SchoolTrackerPro";
      const sep = isAndroid ? '/' : '\\';
      const folderPath = docsPath + sep + folderName;
      const filePath = folderPath + sep + fileName;
      await mkdir(folderPath, { recursive: true }).catch(e => console.log("mkdir:", e));
      await writeFile(filePath, new Uint8Array(pdfData));
      const fPath = filePath.replace(/\\/g, '/');
      if (isAndroid) {
        try { await invoke('share_pdf', { path: fPath }); } catch { }
        await emit("show-toast", { message: "✅ PDF guardado en Documents/SchoolTrackerPro", type: 'success' });
      } else {
        await openUrl("file:///" + folderPath.replace(/\\/g, "/"));
        await emit("show-toast", { message: "✅ PDF guardado en Documents/SchoolTrackerPro", type: 'success' });
      }
    } catch (error) {
      console.error("Error al exportar PDF:", error);
      await emit("show-toast", { message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), type: 'error' });
    }
  }

  async function handlePrintWithIframe() {
    if (reporteFiltrado.length === 0) { await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' }); return; }
    try {
      await emit("show-toast", { message: "✅ Preparando reporte...", type: 'success' });
      let headers: string[], rows: string;
      if (periodo === "diario") {
        headers = ["Estudiante", "Sexo", "Estado", "Observación"];
        rows = reporteFiltrado.map(est => {
          const estado = getEstadoEnFecha(est, fechaInicio);
          const obs = getObservacionEnFecha(est, fechaInicio);
          const estadoClass = estado === 'P' ? 'estado-P' : estado === 'A' ? 'estado-A' : estado === 'J' ? 'estado-J' : '';
          return `<tr><td>${est.nombre}</td><td>${est.sexo}</td><td class="${estadoClass}">${estado === '-' ? '' : estado}</td><td>${obs}</td></tr>`;
        }).join('');
      } else {
        const fechasCols = getFechasUnicas();
        headers = ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
        rows = reporteFiltrado.map(est => {
          const p = est.fechas.filter(f => f.endsWith(':P')).length;
          const a = est.fechas.filter(f => f.endsWith(':A')).length;
          const j = est.fechas.filter(f => f.endsWith(':J')).length;
          return `<tr><td>${est.nombre}</td><td>${est.sexo}</td>${fechasCols.map(f => {
            const estado = getEstadoEnFecha(est, f);
            const cls = estado === 'P' ? 'estado-P' : estado === 'A' ? 'estado-A' : estado === 'J' ? 'estado-J' : '';
            return `<td class="${cls}">${estado}</td>`;
          }).join('')}<td class="estado-P">${p}</td><td class="estado-A">${a}</td><td class="estado-J">${j}</td></tr>`;
        }).join('');
      }
      printHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Arial,sans-serif;padding:20px}h2{margin:0 0 10px 0}.info{margin-bottom:15px;font-size:12px}
        table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #ddd;padding:6px;text-align:center}
        th{background-color:#10b981;color:white}tr:nth-child(even){background-color:#f9f9f9}
        .estado-P{color:#10b981;font-weight:bold}.estado-A{color:#ef4444;font-weight:bold}.estado-J{color:#f59e0b;font-weight:bold}
        @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        th{background-color:#10b981!important}tr:nth-child(even){background-color:#f9f9f9!important}
        .estado-P{color:#10b981!important}.estado-A{color:#ef4444!important}.estado-J{color:#f59e0b!important}}
      </style></head><body>
        <h2>Reporte de Asistencia</h2>
        <div class="info">
          <p><strong>Colegio:</strong> ${colegioNombre}</p>
          <p><strong>Grado:</strong> ${gradoNombre} - Sección: ${seccionNombre}</p>
          <p><strong>Período:</strong> ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})${selectedSexo ? ` - Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}` : ''}</p>
        </div>
        <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    } catch (error) {
      console.error("Error generando reporte:", error);
      await emit("show-toast", { message: "❌ Error al generar el reporte", type: 'error' });
    }
  }

  async function handlePrint() {
    if (reporteFiltrado.length === 0) { await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' }); return; }
    try {
      await emit("show-toast", { message: "✅ Preparando impresión...", type: 'success' });
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
      const margins = { top: 10, bottom: 10, left: 10, right: 10 };
      doc.setFontSize(16);
      doc.text("Reporte", margins.left + 4, 15);
      doc.setFontSize(10);
      doc.text(`Colegio: ${colegioNombre}`, margins.left + 4, 22);
      doc.text(`Grado: ${gradoNombre} - Sección: ${seccionNombre}`, margins.left + 4, 27);
      doc.text(`Periodo: ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})`, margins.left + 4, 32);
      if (selectedSexo) doc.text(`Filtro Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}`, margins.left + 4, 37);

      let headers: string[], body: any[][];
      if (periodo === "diario") {
        headers = ["Estudiante", "Sexo", "Estado", "Observación"];
        body = reporteFiltrado.map(est => [est.nombre, est.sexo, getEstadoEnFecha(est, fechaInicio) === '-' ? 'Sin registro' : getEstadoEnFecha(est, fechaInicio), getObservacionEnFecha(est, fechaInicio)]);
      } else {
        const fechasCols = getFechasUnicas();
        headers = ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
        body = reporteFiltrado.map(est => {
          const p = est.fechas.filter(f => f.endsWith(':P')).length;
          const a = est.fechas.filter(f => f.endsWith(':A')).length;
          const j = est.fechas.filter(f => f.endsWith(':J')).length;
          return [est.nombre, est.sexo, ...fechasCols.map(f => getEstadoEnFecha(est, f)), p, a, j];
        });
      }

      autoTable(doc, {
        startY: selectedSexo ? 42 : 37,
        margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [headers], body,
        styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { fillColor: [16, 185, 129] },
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            const val = String(data.cell.raw);
            if (val === 'P') data.cell.styles.textColor = [16, 185, 129];
            if (val === 'A') data.cell.styles.textColor = [239, 68, 68];
            if (val === 'J') data.cell.styles.textColor = [155, 89, 182];
          }
        }
      });

      const pdfBuf = doc.output('arraybuffer');
      const dir = await tempDir();
      const pth = await join(dir, `reporte_asistencia_${Date.now()}.pdf`);
      await writeFile(pth, new Uint8Array(pdfBuf));
      const fPath = pth.replace(/\\/g, '/');
      const fileUrl = fPath.startsWith('/') ? `file://${fPath}` : `file:///${fPath}`;
      try {
        if (isAndroid || isMobile) {
          try {
            if (isAndroid) { await invoke('share_pdf', { path: fPath }); await emit("show-toast", { message: "✅ Abriendo opciones...", type: 'success' }); }
            else throw new Error("Plataforma móvil no soportada");
          } catch (shareError) {
            console.error("Error en share_pdf:", shareError);
            await emit("show-toast", { message: "⚠️ Error nativo: " + String(shareError), type: 'error' });
            return;
          }
        } else {
          await invoke('print_pdf', { path: fPath });
          await emit("show-toast", { message: "✅ Enviado a impresora", type: 'success' });
        }
      } catch (error) {
        if (isAndroid) { await emit("show-toast", { message: "❌ Error al imprimir en Android: " + String(error), type: 'error' }); return; }
        await openUrl(fileUrl);
        await emit("show-toast", { message: "✅ Reporte generado. Abriendo visor de PDF...", type: 'success' });
      }
    } catch (error) {
      console.error("Error al imprimir:", error);
      await emit("show-toast", { message: "❌ Error al imprimir: " + (error instanceof Error ? error.message : String(error)), type: 'error' });
    }
  }
</script>
<SearchFab bind:value={searchTerm} placeholder="Buscar..." />


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
  </style>

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile}>
        <FilterGroup label="Período:" {isMobile}>
          <select class="filter-select" bind:value={periodo} style="width:100%">
            <option value="diario">Diario</option>
            <option value="semanal">Semanal</option>
            <option value="mensual">Mensual</option>
          </select>
        </FilterGroup>

        {#if periodo === "diario"}
          <FilterGroup label="Fecha:" {isMobile}>
            <DatePickerGlass bind:value={fechaBase} />
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
        {:else}
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

        <FilterGroup label="Año Lectivo:" {isMobile}>
          <select class="filter-select" bind:value={selectedAno} style="width:100%">
            {#each anos as a}
              <option value={a.id}>{a.nombre}</option>
            {/each}
          </select>
        </FilterGroup>

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

        <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'}">
          {#if !isAndroid}
            <button onclick={handlePrintWithIframe} disabled={reporteFiltrado.length === 0 || loading}
              style="height:42px;padding:0 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;flex-shrink:0;gap:6px;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:{reporteFiltrado.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);letter-spacing:0.3px;white-space:nowrap;opacity:{reporteFiltrado.length === 0 || loading ? 0.7 : 1}"
              title={isMobile ? "Compartir reporte" : "Imprimir reporte"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimir
            </button>
          {/if}
          <button onclick={exportToPDF} disabled={reporteFiltrado.length === 0 || loading}
            style="height:42px;padding:0 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,#ef4444,#dc2626);display:flex;align-items:center;justify-content:center;flex-shrink:0;gap:8px;border:none;border-radius:8px;color:white;font-weight:700;cursor:pointer;transition:all 0.2s ease;box-shadow:0 2px 8px rgba(239,68,68,0.3);letter-spacing:0.3px;white-space:nowrap;transition:all 0.15s"
            onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
            onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            onmousedown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
            onmouseup={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
            title="Exportar a PDF">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            PDF
          </button>
          <div style="flex:1;min-width:100px">
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
        <div><strong>Período:</strong> {periodo}</div>
        <div><strong>Fecha:</strong> {fechaInicio} al {fechaFin}</div>
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
      {:else if periodo === "diario"}
        {#if isAndroidMobile}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each reporteFiltrado as item, index}
              {@const estado = getEstadoEnFecha(item, fechaInicio)}
              {@const obs = getObservacionEnFecha(item, fechaInicio)}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="font-size:1rem;flex-shrink:0">{item.sexo === 'F' ? '👩' : '👨'}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick={() => selectedStudentDetail = item}>{item.nombre}</span>
                  <button class="obs-toggle-btn" class:has-obs={!!obs} onclick={() => obs ? emit("show-toast", { message: `Observación de ${item.nombre}: ${obs}`, type: 'info' }) : undefined}
                    title={obs ? "Ver observación" : "Sin observaciones"} disabled={!obs}
                    style="width:30px;height:30px;min-width:30px;font-size:0.9rem;flex-shrink:0;opacity:{obs ? 1 : 0.3}">
                    {obs ? '📝' : '💬'}
                  </button>
                </div>
                <div style="display:flex;gap:0.4rem;margin-bottom:0.3rem">
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{estado === 'P' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)'};border:{estado === 'P' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)'};color:{estado === 'P' ? '#10b981' : '#94a3b8'}">
                    <input type="radio" name={`asist-${item.id}`} checked={estado === 'P'} onchange={() => {}} style="display:none" /><span>Presente</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{estado === 'A' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'};border:{estado === 'A' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)'};color:{estado === 'A' ? '#ef4444' : '#94a3b8'}">
                    <input type="radio" name={`asist-${item.id}`} checked={estado === 'A'} onchange={() => {}} style="display:none" /><span>Ausente</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{estado === 'J' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'};border:{estado === 'J' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)'};color:{estado === 'J' ? '#f59e0b' : '#94a3b8'}">
                    <input type="radio" name={`asist-${item.id}`} checked={estado === 'J'} onchange={() => {}} style="display:none" /><span>Justificado</span>
                  </label>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible">
            <thead>
              <tr>
                <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
                <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Estudiante</th>
                <th style="width:100px;position:sticky;top:0;background:#1e293b;z-index:10">Asistencia</th>
                <th style="width:65px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">Obs</th>
              </tr>
            </thead>
            <tbody>
              {#each reporteFiltrado as item, index}
                {@const estado = getEstadoEnFecha(item, fechaInicio)}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left;overflow:hidden">
                    <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;width:100%" onclick={() => selectedStudentDetail = item}>
                      <span style="font-size:1.1rem;flex-shrink:0">{item.sexo === 'F' ? '👩' : '👨'}</span>
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{item.nombre}</span>
                    </div>
                    <div style="font-size:0.7rem;opacity:0.6;margin-left:22px">{item.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                  </td>
                  <td>
              <div style="display:flex;gap:6px;justify-content:center">
                  <label class="asistencia-btn" class:p={estado === 'P'}>
                    <input type="radio" name={`asist-${item.id}`} checked={estado === 'P'} onchange={() => {}} style="display:none" />Presente
                  </label>
                  <label class="asistencia-btn" class:a={estado === 'A'}>
                    <input type="radio" name={`asist-${item.id}`} checked={estado === 'A'} onchange={() => {}} style="display:none" />Ausente
                  </label>
                  <label class="asistencia-btn" class:j={estado === 'J'}>
                    <input type="radio" name={`asist-${item.id}`} checked={estado === 'J'} onchange={() => {}} style="display:none" />Justificado
                  </label>
              </div>
                  </td>
                  <td style="text-align:center;padding:0.2rem">
                    {#if getObservacionEnFecha(item, fechaInicio)}
                      <button class="obs-toggle-btn has-obs" onclick={() => emit("show-toast", { message: `Observación de ${item.nombre}: ${getObservacionEnFecha(item, fechaInicio)}`, type: 'info' })} title="Ver observación">📝</button>
                    {:else}
                      <button class="obs-toggle-btn" disabled style="opacity:0.3;cursor:default;background:transparent;box-shadow:none;border:1px solid rgba(255,255,255,0.05)" title="Sin observaciones">💬</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
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
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10;min-width:200px">Estudiante</th>
              {#each fechasColumnas as f}
                <th style="min-width:105px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;font-size:0.7rem;font-weight:600;padding:0.3rem 0.15rem">
                  {new Date(f + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }).replace('.','').replace(',','')}
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
                {#each fechasColumnas as f}
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
              {#each fechasColumnas as f}
                <th style="font-size:0.7rem;white-space:nowrap;position:sticky;top:0;background:#1e293b;z-index:10;min-width:48px;padding:0.35rem 0.45rem">
                  <div style="font-size:0.6rem;opacity:0.7">{new Date(f + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' })}</div>
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
                {#each fechasColumnas as f}
                  {@const est = getEstadoEnFecha(item, f)}
                  <td>
                    <div class="ciclo-cell" class:estado-p={est === 'P'} class:estado-a={est === 'A'} class:estado-j={est === 'J'}>{est}</div>
                  </td>
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
            <div style="background:rgba(96,165,250,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:4px">
              <span style="color:#60a5fa;font-size:0.8rem">Masculino</span>
              <span style="font-size:1.2rem;font-weight:bold;color:#60a5fa">{showSummaryModal.stats?.m}</span>
            </div>
            <div style="background:rgba(244,114,182,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:4px">
              <span style="color:#f472b6;font-size:0.8rem">Femenino</span>
              <span style="font-size:1.2rem;font-weight:bold;color:#f472b6">{showSummaryModal.stats?.f}</span>
            </div>
          </div>
        </div>
        <button class="primary" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }} style="margin-top:1.5rem;width:100%">Cerrar</button>
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
