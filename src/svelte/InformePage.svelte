<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { join, tempDir, documentDir } from "@tauri-apps/api/path";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import jsPDF from "jspdf";
  import autoTable from "jspdf-autotable";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import FilterActions from "./FilterActions.svelte";
  import SearchInput from "./SearchInput.svelte";
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
  let fetching = $state(false);
  let refreshQueued = $state(false);

  let showSummaryModal = $state<{ show: boolean; type: string; stats: { total: number; m: number; f: number } | null }>({ show: false, type: "", stats: null });
  let selectedStudentDetail: AsistenciaReporteItem | null = $state(null);
  let printHtml: string | null = $state(null);

  let colegioNombre = $derived(colegios.find(c => c.id === selectedColegio)?.nombre || "");
  let gradoNombre = $derived(grados.find(g => g.id === selectedGrado)?.nombre || "");
  let seccionNombre = $derived(secciones.find(s => s.id === selectedSeccion)?.nombre || "");

  onMount(() => {
    const checkMobile = () => {
      isMobile = window.innerWidth <= 768;
      isAndroid = /Android/i.test(navigator.userAgent);
      isWindows = /Windows/i.test(navigator.userAgent);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('schooltracker-sync', onSync);

    const unsub1 = listen("asistencia-updated", () => fetchReporte());
    const unsub2 = listen("student-updated", () => fetchReporte());
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

  function onSync() { refreshTrigger++; }

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
    loading = true;
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
      const headers = ["Estudiante", "Sexo", "Estado", "Observación"];
      const rows = reporteFiltrado.map(est => {
        const estado = getEstadoEnFecha(est, fechaInicio);
        const obs = getObservacionEnFecha(est, fechaInicio);
        const estadoClass = estado === 'P' ? 'estado-P' : estado === 'A' ? 'estado-A' : estado === 'J' ? 'estado-J' : '';
        return `<tr><td>${est.nombre}</td><td>${est.sexo}</td><td class="${estadoClass}">${estado === '-' ? '' : estado}</td><td>${obs}</td></tr>`;
      }).join('');
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

<div class="page-container" style="height: 100%; min-height: 0;">
  <style>
    .asistencia-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-top:0.5rem}
    .summary-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.5rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60px;transition:all 0.2s ease;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
    .summary-label{font-size:0.65rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.025em;margin-bottom:2px;display:block!important}
    .summary-value{font-size:1.1rem;font-weight:700;color:#fff;line-height:1}
    .gender-labels{display:flex;gap:0.4rem;margin-top:4px;font-size:0.6rem;font-weight:600}
    .gender-f{color:#f472b6}.gender-m{color:#60a5fa}
    .summary-card.students{border-left:3px solid var(--primary-color)}
    .summary-card.p{border-left:3px solid #10b981}
    .summary-card.a{border-left:3px solid #ef4444}
    .summary-card.j{border-left:3px solid #f59e0b}
    @media(max-width:600px){.asistencia-summary{grid-template-columns:repeat(2,1fr)}}
    .asistencia-opt{width:28px!important;height:28px!important;font-size:0.75rem!important;min-width:28px!important;flex-shrink:0!important}
    .asistencia-options{gap:3px!important}
    @media(max-width:480px){.asistencia-opt{width:24px!important;height:24px!important;font-size:0.65rem!important;min-width:24px!important}
    .obs-toggle-btn{width:26px!important;height:26px!important;min-width:26px!important;font-size:0.7rem!important}}
    .table-container::-webkit-scrollbar{width:6px}
    .table-container::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);border-radius:3px}
    .table-container::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:3px}
    .table-container::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
    .custom-table thead th{position:sticky;top:0;z-index:10;background:#1e293b!important}
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

        {#if periodo !== "mensual"}
          <FilterGroup label={periodo === "diario" ? "Fecha:" : "Semana de:"} {isMobile}>
            <input type="date" class="filter-select" bind:value={fechaBase} style="width:100%" onclick={(e) => (e.target as HTMLInputElement).showPicker()} />
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
          <div style="flex:1;min-width:80px">
            <SearchInput bind:value={searchTerm} onChange={(v: string) => searchTerm = v} placeholder="Buscar..." {isMobile} />
          </div>
          {#if !isAndroid}
            <button class="secondary" onclick={handlePrintWithIframe} disabled={reporteFiltrado.length === 0 || loading}
              style="padding:0.3rem 0.6rem;font-size:0.75rem;height:28px;background-color:#10b981;display:flex;align-items:center;justify-content:center;flex-shrink:0"
              title={isMobile ? "Compartir reporte" : "Imprimir reporte"}>
              {isMobile ? "📤" : "🖨️"}
            </button>
          {/if}
          <button class="secondary" onclick={exportToPDF} disabled={reporteFiltrado.length === 0 || loading}
            style="padding:0.3rem 0.6rem;font-size:0.75rem;height:28px;background-color:#ef4444;display:flex;align-items:center;justify-content:center;flex-shrink:0"
            title="Exportar a PDF">
            📄 PDF
          </button>
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
      <div class="asistencia-summary" style="margin:0.5rem 0;padding:0 0.4rem;width:100%;max-width:100%">
        <div class="summary-card students" onclick={() => handleCardClick('Total', statsTotal)} style="cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#06b6d4">E</span>: {statsTotal.total}</span>
            <span class="gender-m">M: {statsTotal.m}</span>
            <span class="gender-f">F: {statsTotal.f}</span>
          </div>
        </div>
        <div class="summary-card p" onclick={() => handleCardClick('Presentes', statsP)} style="cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#10b981">P</span>: {statsP.total}</span>
            <span class="gender-m">M: {statsP.m}</span>
            <span class="gender-f">F: {statsP.f}</span>
          </div>
        </div>
        <div class="summary-card a" onclick={() => handleCardClick('Ausentes', statsA)} style="cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#ef4444">A</span>: {statsA.total}</span>
            <span class="gender-m">M: {statsA.m}</span>
            <span class="gender-f">F: {statsA.f}</span>
          </div>
        </div>
        <div class="summary-card j" onclick={() => handleCardClick('Justificados', statsJ)} style="cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-weight:bold;font-size:0.95rem">
            <span><span style="color:#f59e0b">J</span>: {statsJ.total}</span>
            <span class="gender-m">M: {statsJ.m}</span>
            <span class="gender-f">F: {statsJ.f}</span>
          </div>
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
                <div style="display:flex;gap:0.4rem">
              {#each ['P', 'A', 'J'] as tipo}
                {@const colors: Record<string, { bg: string; border: string; text: string }> = { P: { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', text: '#10b981' }, A: { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', text: '#ef4444' }, J: { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', text: '#f59e0b' }}}
                {@const c = colors[tipo]}
                {@const active = estado === tipo}
                <label style="flex:0 0 auto;height:36px;font-size:0.85rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:bold;background:{active ? c.bg : 'rgba(255,255,255,0.05)'};border:{active ? `1px solid ${c.border}` : '1px solid rgba(255,255,255,0.1)'};color:{active ? c.text : '#94a3b8'};transition:all 0.2s ease">
                  <input type="radio" name={`asist-${item.id}`} checked={estado === tipo} onchange={() => { /* No action needed in report view */ }} style="display:none" />
                  {tipo}
                </label>
              {/each}
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
              <div class="asistencia-options" style="display:flex;pointer-events:{isAndroid ? 'none' : 'auto'};opacity:{isAndroid ? 0.8 : 1}">  
                {#each ['P', 'A', 'J'] as tipo}
                  <label class="asistencia-opt" class:active={estado === tipo} class:p={tipo === 'P'} class:a={tipo === 'A'} class:j={tipo === 'J'} style="display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:8px;font-weight:bold;transition:all 0.2s ease;flex:0 0 auto">
                    <input type="radio" name={`asist-${item.id}`} checked={estado === tipo} onchange={() => { /* No action needed in report view */ }} style="display:none" />
                    <span>{tipo}</span>
                  </label>
                {/each}
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
      {:else}
        <table class="custom-table" style="width:100%;margin:0;overflow:visible">
          <thead>
            <tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">Estudiante</th>
              {#each fechasColumnas as f}
                <th style="font-size:0.7rem;white-space:nowrap;position:sticky;top:0;background:#1e293b;z-index:10">
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
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{item.nombre}</span>
                  </div>
                  <div style="font-size:0.7rem;opacity:0.6;margin-left:22px">{item.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                </td>
                {#each fechasColumnas as f}
                  {@const est = getEstadoEnFecha(item, f)}
                  <td style="color:{getEstadoColor(est)};font-weight:bold;font-size:0.8rem">
                    <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:4px;background-color:{getEstadoColor(est)};color:{est === '-' ? 'rgba(255,255,255,0.2)' : 'white'};font-size:0.8rem;font-weight:bold">{est}</span>
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
