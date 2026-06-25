<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { join, tempDir, documentDir } from "@tauri-apps/api/path";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import jsPDF from "jspdf";
  import autoTable from "jspdf-autotable";
  import * as XLSX from "xlsx";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SearchInput from "./SearchInput.svelte";
  import PageLayout from "./PageLayout.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; criterios: Criterio[]; }
  interface Estudiante { id: number; nombre: string; sexo: string; grado: string; seccion: string; }
  interface EstudianteReporte extends Estudiante {
    notasIndicadores: Record<number, number>;
    notasCualitativasIndicadores: Record<number, string>;
    notasCriterios?: Record<number, number>;
    notaFinal: number;
    notaFinalCualitativa?: string;
  }
  interface GradeConfig { id: string; color: string; minimo: number; }

  let anos: CategoryItem[] = $state([]);
  let cortes: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let asignaturas: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);
  let gradeConfigs: GradeConfig[] = $state([]);

  let selectedAno = $state(0);
  let selectedCorte = $state(0);
  let specialCorte = $state("");
  let selectedColegio = $state(0);
  let selectedAsignatura = $state(0);
  let selectedGrado = $state(0);
  let selectedSeccion = $state(0);
  let selectedSexo = $state("");
  let searchTerm = $state("");

  let estudiantes: EstudianteReporte[] = $state([]);
  let configIndicadores: Indicador[] = $state([]);
  let loading = $state(false);
  let refreshTrigger = $state(0);
  let activeSlide = $state<'tabla' | 'estadisticas'>('tabla');
  let isMobile = $state(false);
  let isAndroid = $state(false);
  let printHtml: string | null = $state(null);
  let loadId = 0;

  let isQualitative = $derived.by(() => {
    const grado = grados.find(g => g.id === selectedGrado);
    const asignatura = asignaturas.find(a => a.id === selectedAsignatura);
    return (grado?.cualitativo || false) || (asignatura?.cualitativo || false);
  });

  const notaMapping: Record<string, number> = { AA: 1.0, AS: 0.85, AF: 0.65, AI: 0.40 };
  const qualitativeWeights: Record<string, number> = { AA: 4, AS: 3, AF: 2, AI: 1 };
  const reverseQualitativeWeights: Record<number, string> = { 4: 'AA', 3: 'AS', 2: 'AF', 1: 'AI' };

  let filteredReporte = $derived.by(() => {
    if (!searchTerm) return estudiantes;
    const term = searchTerm.toLowerCase();
    return estudiantes.filter(est => est.nombre.toLowerCase().includes(term));
  });

  let totalPuntajeMaximoConfig = $derived(
    configIndicadores.reduce((total, ind) => {
      if (!ind.activo) return total;
      return total + ind.criterios.reduce((sum, crit) => sum + (crit.puntajeMaximo || 0), 0);
    }, 0)
  );

  let estudiantesConNotas = $derived(estudiantes.filter(e => e.notaFinal >= 0));
  let tieneEstudiantesConNotas = $derived(estudiantesConNotas.length > 0);
  let promedioGrupalNum = $derived.by(() => {
    if (!tieneEstudiantesConNotas) return 0;
    return estudiantesConNotas.reduce((s, e) => s + e.notaFinal, 0) / estudiantesConNotas.length;
  });
  let promedioGrupalLabel = $derived.by(() => {
    if (!tieneEstudiantesConNotas) return "-";
    if (isQualitative) return calcularNotaCualitativaFinal(estudiantesConNotas.map(e => e.notaFinalCualitativa || 'AI'));
    const lbl = getQualitativeLabel(promedioGrupalNum);
    return `${Math.round(promedioGrupalNum)}${lbl ? ` (${lbl})` : ''}`;
  });
  let promedioGrupalColor = $derived.by(() => {
    if (!tieneEstudiantesConNotas) return '#64748b';
    let lab: string | undefined;
    if (isQualitative) lab = calcularNotaCualitativaFinal(estudiantesConNotas.map(e => e.notaFinalCualitativa || 'AI'));
    return getNoteColor(promedioGrupalNum, lab, totalPuntajeMaximoConfig);
  });

  function getQualitativeLabel(score: number): string {
    if (!gradeConfigs || gradeConfigs.length === 0) return 'AI';
    const sortedConfigs = [...gradeConfigs].sort((a, b) => {
      if (b.minimo !== a.minimo) return b.minimo - a.minimo;
      return a.id.localeCompare(b.id);
    });
    const config = sortedConfigs.find(c => score >= c.minimo - 0.01);
    return config ? config.id : (gradeConfigs.find(c => c.id === 'AI')?.id || 'AI');
  }

  function getPorcentajeFinal(nota: number, maximo: number) {
    if (maximo <= 0) return 0;
    return (nota / maximo) * 100;
  }

  function calcularNotaCualitativaFinal(notasQual: string[]): string {
    if (notasQual.length === 0) return '';
    const validNotes = notasQual.filter(n => ['AA', 'AS', 'AF', 'AI'].includes(n));
    if (validNotes.length === 0) return '';
    const counts: Record<string, number> = {};
    let maxCount = 0;
    validNotes.forEach(n => { counts[n] = (counts[n] || 0) + 1; if (counts[n] > maxCount) maxCount = counts[n]; });
    const modes = Object.keys(counts).filter(n => counts[n] === maxCount);
    if (modes.length === 1 && maxCount > 1) return modes[0];
    const weights = validNotes.map(n => qualitativeWeights[n]);
    const sum = weights.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / weights.length);
    return reverseQualitativeWeights[average] || 'AI';
  }

  function getNoteColor(score: number, label?: string, maxScore?: number): string {
    if (isQualitative && label) {
      const config = gradeConfigs.find(c => c.id === label);
      if (config) return config.color;
    }
    if (gradeConfigs.length === 0) return score >= 60 ? '#4ade80' : '#f87171';
    const scorePercent = maxScore && maxScore > 0 ? (score / maxScore) * 100 : score;
    const sortedConfigs = [...gradeConfigs].sort((a, b) => b.minimo - a.minimo);
    const config = sortedConfigs.find(c => scorePercent >= c.minimo);
    return config ? config.color : '#f87171';
  }

  function getIndicatorMaxScore(indicatorId: number) {
    const indicator = configIndicadores.find(ind => ind.id === indicatorId);
    return indicator ? indicator.criterios.reduce((sum, crit) => sum + (crit.puntajeMaximo || 0), 0) : 0;
  }

  function getNoteColorWithPercent(score: number, label?: string, isIndicator = false, indicatorId?: number) {
    if (isIndicator && indicatorId) return getNoteColor(score, label, getIndicatorMaxScore(indicatorId));
    return getNoteColor(score, label, totalPuntajeMaximoConfig);
  }

  function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
  }

  let selectedNames = $derived.by(() => {
    let corteNombre = cortes.find(c => c.id === selectedCorte)?.nombre || "";
    if (specialCorte === "1S") corteNombre = "1er Semestre";
    else if (specialCorte === "2S") corteNombre = "2do Semestre";
    else if (specialCorte === "NF") corteNombre = "Nota Final";
    return {
      ano: anos.find(a => a.id === selectedAno)?.nombre || "",
      corte: corteNombre,
      colegio: colegios.find(c => c.id === selectedColegio)?.nombre || "",
      asignatura: asignaturas.find(a => a.id === selectedAsignatura)?.nombre || "",
      grado: grados.find(g => g.id === selectedGrado)?.nombre || "",
      seccion: secciones.find(s => s.id === selectedSeccion)?.nombre || ""
    };
  });

  onMount(() => {
    const checkMobile = () => { isMobile = window.innerWidth <= 768; isAndroid = /Android/i.test(navigator.userAgent); };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('schooltracker-sync', () => refreshTrigger++);
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        activeSlide = activeSlide === 'tabla' ? 'estadisticas' : 'tabla';
      }
    });

    const unsubGradeConfigs = listen("grade-configs-updated", async () => {
      try { gradeConfigs = await invoke<GradeConfig[]>("get_grade_configs"); } catch (e) { console.error("Error refreshing grade configs:", e); }
    });
    const unsubNotas = listen("notas-updated", () => refreshTrigger++);
    const unsubStudents = listen("student-updated", () => refreshTrigger++);
    const unsubCatalogs = listen("catalog-updated", () => fetchInitialCatalogs());

    fetchInitialCatalogs();

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('schooltracker-sync', () => {});
      window.removeEventListener('keydown', () => {});
      unsubGradeConfigs.then(f => f());
      unsubNotas.then(f => f());
      unsubStudents.then(f => f());
      unsubCatalogs.then(f => f());
    };
  });

  $effect(() => {
    if (selectedColegio > 0 && selectedAno > 0) fetchGradosYAsignaturas();
    else { grados = []; asignaturas = []; selectedGrado = 0; selectedAsignatura = 0; }
  });

  $effect(() => {
    if (selectedGrado > 0 && selectedColegio > 0 && selectedAno > 0) fetchSecciones();
    else { secciones = []; selectedSeccion = 0; }
  });

  $effect(() => {
    const lid = ++loadId;
    if (selectedGrado > 0 && selectedSeccion > 0 && (selectedCorte > 0 || specialCorte) && selectedAsignatura > 0) {
      loading = true;
      fetchReporte(lid).finally(() => { if (loadId === lid) loading = false; });
    } else { estudiantes = []; configIndicadores = []; loading = false; }
  });

  async function fetchInitialCatalogs() {
    try {
      const [anosData, cortesData, colegiosData, configsData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_cortes"),
        invoke<CategoryItem[]>("get_colegios"),
        invoke<GradeConfig[]>("get_grade_configs"),
      ]);
      const activeAno = anosData.length > 0 ? (anosData.find(a => a.activo)?.id || anosData[0].id) : 0;
      const activeCorte = cortesData.length > 0 ? (cortesData.find(c => c.activo)?.id || cortesData[0].id) : 0;
      const activeColegio = colegiosData.length > 0 ? (colegiosData.find(c => c.activo)?.id || colegiosData[0].id) : 0;
      anos = anosData;
      cortes = cortesData;
      colegios = colegiosData;
      gradeConfigs = configsData;
      selectedAno = activeAno;
      selectedCorte = activeCorte;
      selectedColegio = activeColegio;
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  }

  async function fetchGradosYAsignaturas() {
    try {
      const [gradosData, asignaturasData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: selectedColegio, anoLectivoId: selectedAno }),
        invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: selectedColegio }),
      ]);
      let finalAsignaturas = asignaturasData;
      if (asignaturasData.length === 0) {
        try { finalAsignaturas = await invoke<CategoryItem[]>("get_all_subjects"); } catch {}
      }
      grados = gradosData;
      if (gradosData.length > 0 && !gradosData.some(g => g.id === selectedGrado)) selectedGrado = gradosData[0].id || 0;
      else if (gradosData.length === 0) selectedGrado = 0;
      let filteredAsignaturas = finalAsignaturas;
      if (selectedGrado > 0) {
        try {
          const subjectsByGrade = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado });
          if (subjectsByGrade.length > 0) filteredAsignaturas = subjectsByGrade.filter(sg => finalAsignaturas.some(ca => ca.id === sg.id));
        } catch {}
      }
      asignaturas = filteredAsignaturas;
      if (filteredAsignaturas.length > 0 && !filteredAsignaturas.some(a => a.id === selectedAsignatura)) selectedAsignatura = filteredAsignaturas[0].id || 0;
      else if (filteredAsignaturas.length === 0) selectedAsignatura = 0;
    } catch (error) {
      console.error("Error fetching grados y asignaturas:", error);
      await emit("show-toast", { message: "❌ Error al cargar grados y asignaturas: " + error, type: "error" });
    }
  }

  async function fetchSecciones() {
    try {
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: selectedGrado, colegioId: selectedColegio, anoLectivoId: selectedAno });
      secciones = data;
      if (data.length > 0 && !data.some(s => s.id === selectedSeccion)) selectedSeccion = data[0].id || 0;
      else if (data.length === 0) selectedSeccion = 0;
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: "❌ Error al cargar secciones: " + error, type: "error" });
    }
  }

  async function fetchReporte(lid: number) {
    try {
      let cortesIds: number[] = [];
      if (specialCorte === "1S") {
        const c1 = cortes.find(c => c.nombre.toLowerCase().includes("1er"))?.id;
        const c2 = cortes.find(c => c.nombre.toLowerCase().includes("2do"))?.id;
        if (c1) cortesIds.push(c1); if (c2) cortesIds.push(c2);
      } else if (specialCorte === "2S") {
        const c3 = cortes.find(c => c.nombre.toLowerCase().includes("3er"))?.id;
        const c4 = cortes.find(c => c.nombre.toLowerCase().includes("4to"))?.id;
        if (c3) cortesIds.push(c3); if (c4) cortesIds.push(c4);
      } else if (specialCorte === "NF") { cortesIds = cortes.map(c => c.id); }
      else { cortesIds = [selectedCorte]; }
      if (cortesIds.length === 0) throw new Error("No se pudieron determinar los cortes evaluativos.");

      const indicadores = await invoke<Indicador[]>("get_evaluation_config", { gradoId: selectedGrado, asignaturaId: selectedAsignatura, corteEvaluativoId: cortesIds[0] });
      if (lid !== loadId) return;

      const activos = indicadores.filter(ind => ind.activo);
      if (activos.length === 0 && indicadores.length > 0) {
        await emit("show-toast", { message: "ℹ️ Mostrando todos los indicadores (algunos pueden estar inactivos).", type: "info" });
      } else if (indicadores.length === 0) {
        configIndicadores = []; estudiantes = [];
        await emit("show-toast", { message: "⚠️ No hay indicadores configurados.", type: "warning" });
        return;
      }
      configIndicadores = indicadores;

      const results = await Promise.all([
        invoke<any[]>("get_estudiantes_by_filters", { gradoId: selectedGrado, seccionId: selectedSeccion }),
        ...cortesIds.map(cId => invoke<any[]>("get_notas_by_filters", { gradoId: selectedGrado, seccionId: selectedSeccion, corteId: cId, asignaturaId: selectedAsignatura }))
      ]);
      if (lid !== loadId) return;

      const listaEstudiantes = results[0];
      const todasLasNotas = results.slice(1);
      const notasGlobales: Record<number, Record<number, Record<number, number>>> = {};
      todasLasNotas.forEach((notasCorte, index) => {
        const cId = cortesIds[index];
        notasGlobales[cId] = {};
        notasCorte.forEach((n: any) => {
          if (!notasGlobales[cId][n.estudianteId]) notasGlobales[cId][n.estudianteId] = {};
          notasGlobales[cId][n.estudianteId][n.criterioId] = n.valor;
        });
      });

      const reporte: EstudianteReporte[] = listaEstudiantes.map((est: any) => {
        const notasEstPorCorte: Record<number, number> = {};
        const tieneNotasEnCorte: Record<number, boolean> = {};
        const notasCualitativasEstPorCorte: Record<number, string> = {};
        cortesIds.forEach(cId => {
          const notasCriterios = notasGlobales[cId]?.[est.id] || {};
          let totalCorte = 0, totalMaximoCorte = 0, haIngresado = false;
          const labelsCualitativosCorte: string[] = [];
          indicadores.forEach(ind => {
            if (ind.activo) {
              ind.criterios.forEach(crit => {
                const valor = notasCriterios[crit.id];
                if (valor !== undefined) {
                  totalCorte += valor; haIngresado = true; totalMaximoCorte += crit.puntajeMaximo;
                  if (isQualitative) {
                    const ratio = valor / (crit.puntajeMaximo || 1);
                    let qualValue = "AI";
                    if (ratio >= 0.90) qualValue = "AA";
                    else if (ratio >= 0.70) qualValue = "AS";
                    else if (ratio >= 0.50) qualValue = "AF";
                    labelsCualitativosCorte.push(qualValue);
                  }
                }
              });
            }
          });
          if (haIngresado) {
            const pct = (totalCorte / (totalMaximoCorte || 1)) * 100;
            notasEstPorCorte[cId] = isQualitative ? pct : Math.round(totalCorte);
            tieneNotasEnCorte[cId] = true;
            notasCualitativasEstPorCorte[cId] = isQualitative
              ? calcularNotaCualitativaFinal(labelsCualitativosCorte)
              : getQualitativeLabel(pct);
          }
        });

        let notaFinalValue = 0, notaFinalCualitativa = "-";
        const cortesConNotas = cortesIds.filter(cId => tieneNotasEnCorte[cId]);
        if (cortesConNotas.length > 0) {
          const suma = cortesConNotas.reduce((s, cId) => s + notasEstPorCorte[cId], 0);
          const promedio = suma / cortesConNotas.length;
          if (isQualitative) {
            notaFinalCualitativa = calcularNotaCualitativaFinal(cortesConNotas.map(cId => notasCualitativasEstPorCorte[cId]));
            notaFinalValue = promedio;
          } else {
            notaFinalValue = Math.round(promedio);
            const maxUnCorte = indicadores.reduce((t, ind) => { if (!ind.activo) return t; return t + ind.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0); }, 0);
            notaFinalCualitativa = getQualitativeLabel(getPorcentajeFinal(promedio, maxUnCorte));
          }
        }

        const notasIndicadoresSimuladas: Record<number, number> = {};
        const notasCualitativasIndicadoresSimuladas: Record<number, string> = {};

        if (specialCorte) {
          cortesIds.forEach(cId => {
            if (tieneNotasEnCorte[cId]) {
              notasIndicadoresSimuladas[cId] = notasEstPorCorte[cId];
              notasCualitativasIndicadoresSimuladas[cId] = notasCualitativasEstPorCorte[cId];
            } else { notasCualitativasIndicadoresSimuladas[cId] = "-"; }
          });
        } else {
          const cId = cortesIds[0];
          const notasCriterios = notasGlobales[cId]?.[est.id] || {};
          indicadores.forEach(ind => {
            let totalIndicador = 0, totalMaximo = 0, countCriterios = 0;
            const labelsInd: string[] = [];
            ind.criterios.forEach(crit => {
              const valor = notasCriterios[crit.id];
              if (valor !== undefined) {
                totalIndicador += valor; totalMaximo += crit.puntajeMaximo; countCriterios++;
                if (isQualitative) {
                  const ratio = valor / (crit.puntajeMaximo || 1);
                  let qv = "AI";
                  if (ratio >= 0.90) qv = "AA"; else if (ratio >= 0.70) qv = "AS"; else if (ratio >= 0.50) qv = "AF";
                  labelsInd.push(qv);
                }
              }
            });
            if (countCriterios > 0) {
              const pct = (totalIndicador / (totalMaximo || 1)) * 100;
              notasIndicadoresSimuladas[ind.id] = isQualitative ? pct : Math.round(totalIndicador);
              notasCualitativasIndicadoresSimuladas[ind.id] = isQualitative ? calcularNotaCualitativaFinal(labelsInd) : getQualitativeLabel(pct);
            } else { notasCualitativasIndicadoresSimuladas[ind.id] = "-"; }
          });
        }

        return { ...est, notasIndicadores: notasIndicadoresSimuladas, notasCualitativasIndicadores: notasCualitativasIndicadoresSimuladas, notaFinal: notaFinalValue, notaFinalCualitativa };
      });

      if (specialCorte) {
        const indicadoresEspeciales = cortesIds.map((cId, idx) => ({
          id: cId, orden: idx + 1, descripcion: cortes.find(c => c.id === cId)?.nombre || `Corte ${idx + 1}`, activo: true, criterios: []
        }));
        configIndicadores = indicadoresEspeciales as any;
      }

      estudiantes = selectedSexo ? reporte.filter(est => est.sexo === selectedSexo) : reporte;
    } catch (error) {
      console.error("Error fetching reporte:", error);
      await emit("show-toast", { message: "❌ Error al cargar el reporte: " + error, type: 'error' });
    }
  }

  async function exportToPDF() {
    if (estudiantes.length === 0) return;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const names = selectedNames;
      const date = new Date().toLocaleDateString();
      const margins = { top: 10, bottom: 10, left: 10, right: 10 };
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("Reporte de Calificaciones", doc.internal.pageSize.getWidth() / 2, 15, { align: "center" });
      doc.setFontSize(10); doc.setTextColor(0);
      const filterInfo = [
        ["Colegio:", names.colegio, "Año Lectivo:", names.ano],
        ["Grado:", names.grado, "Sección:", names.seccion],
        ["Asignatura:", names.asignatura, "Corte:", names.corte],
        ["Fecha:", date, "Sexo:", selectedSexo === "M" ? "Masculino" : selectedSexo === "F" ? "Femenino" : "Todos"]
      ];
      let yPos = 25;
      filterInfo.forEach(row => {
        doc.setFont("helvetica", "bold"); doc.text(row[0], margins.left + 10, yPos);
        doc.setFont("helvetica", "normal"); doc.text(row[1], margins.left + 35, yPos);
        doc.setFont("helvetica", "bold"); doc.text(row[2], doc.internal.pageSize.getWidth() / 2 + 5, yPos);
        doc.setFont("helvetica", "normal"); doc.text(row[3], doc.internal.pageSize.getWidth() / 2 + 30, yPos);
        yPos += 6;
      });

      const tableHeaders = ["Estudiante", "Sexo", ...(specialCorte ? [] : configIndicadores.map(ind => `Ind. ${ind.orden}`)), "Nota Final"];
      const tableRows = estudiantes.map(est => [
        est.nombre, est.sexo,
        ...(specialCorte ? [] : configIndicadores.map(ind => {
          const nota = est.notasIndicadores[ind.id] || 0;
          const label = est.notasCualitativasIndicadores[ind.id] || "";
          if (label === "-" || label === "") return "-";
          if (isQualitative) return label;
          return `${nota}${label ? ` ${label}` : ''}`;
        })),
        (est.notaFinalCualitativa === "-" || !est.notaFinalCualitativa) ? "-" : (isQualitative ? (est.notaFinalCualitativa || '-') : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
      ]);

      autoTable(doc, {
        startY: yPos + 5, margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [tableHeaders], body: tableRows, theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 15, halign: 'center' } },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index >= 2) {
            const est = estudiantes[data.row.index];
            let colorHex = "";
            if (data.column.index === tableHeaders.length - 1) {
              colorHex = est.notaFinalCualitativa === "-" ? "#64748b" : getNoteColor(est.notaFinal, est.notaFinalCualitativa, totalPuntajeMaximoConfig);
            } else {
              const indicator = configIndicadores[data.column.index - 2];
              if (!indicator.activo) { colorHex = "#64748b"; } else {
                const label = est.notasCualitativasIndicadores[indicator.id] || (isQualitative ? 'AI' : '');
                if (label === "-") { colorHex = "#64748b"; } else {
                  colorHex = getNoteColor(isQualitative ? 0 : (est.notasIndicadores[indicator.id] || 0), label, getIndicatorMaxScore(indicator.id));
                }
              }
            }
            const [r, g, b] = hexToRgb(colorHex);
            data.cell.styles.textColor = [r, g, b];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      const finalY = (doc as any).lastAutoTable.finalY + 10;
      const conNotas = estudiantes.filter(e => e.notaFinal >= 0);
      let promedioText = "-";
      if (conNotas.length > 0) {
        if (isQualitative) { promedioText = calcularNotaCualitativaFinal(conNotas.map(e => e.notaFinalCualitativa || 'AI')); }
        else {
          const promedio = conNotas.reduce((s, e) => s + e.notaFinal, 0) / conNotas.length;
          promedioText = `${Math.round(promedio)}${getQualitativeLabel(getPorcentajeFinal(promedio, totalPuntajeMaximoConfig)) ? ` (${getQualitativeLabel(getPorcentajeFinal(promedio, totalPuntajeMaximoConfig))})` : ''}`;
        }
      }
      doc.setFontSize(11); doc.text(`Total Estudiantes: ${estudiantes.length}`, margins.left + 10, finalY);
      doc.text(`Promedio Grupal: ${promedioText}`, doc.internal.pageSize.getWidth() / 2 + 15, finalY);

      const pdfData = doc.output('arraybuffer');
      const fileName = `Reporte_${names.grado}_${names.seccion}_${names.asignatura}_${new Date().toISOString().split('T')[0]}.pdf`.replace(/\s+/g, '_');
      const docsPath = await documentDir(); const folderName = "SchoolTrackerPro";
      const sep = isAndroid ? '/' : '\\'; const fp = docsPath + sep + folderName; const fullPath = fp + sep + fileName;
      await mkdir(fp, { recursive: true }).catch(e => console.log("mkdir:", e));
      await writeFile(fullPath, new Uint8Array(pdfData));
      const fPath = fullPath.replace(/\\/g, '/');
      if (isAndroid) { try { await invoke('share_pdf', { path: fPath }); } catch {} }
      else { await openUrl("file:///" + fp.replace(/\\/g, "/")); }
      await emit("show-toast", { message: "✅ PDF guardado en Documents/SchoolTrackerPro", type: 'success' });
    } catch (error) {
      console.error("Error al generar PDF:", error);
      await emit("show-toast", { message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), type: 'error' });
    }
  }

  async function handlePrintWithIframe() {
    if (estudiantes.length === 0) { await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' }); return; }
    try {
      await emit("show-toast", { message: "✅ Preparando reporte...", type: 'success' });
      const names = selectedNames; const date = new Date().toLocaleDateString();
      const headers = ["Estudiante", "Sexo", ...(specialCorte ? [] : configIndicadores.map(ind => `Ind. ${ind.orden}`)), "Nota Final"];
      const rows = estudiantes.map(est => {
        const cells = [est.nombre, est.sexo,
          ...(specialCorte ? [] : configIndicadores.map(ind => {
            const nota = est.notasIndicadores[ind.id] || 0; const label = est.notasCualitativasIndicadores[ind.id] || "";
            if (label === "-" || label === "") return "-";
            return isQualitative ? label : `${nota}${label ? ` ${label}` : ''}`;
          })),
          (est.notaFinalCualitativa === "-" || !est.notaFinalCualitativa) ? "-" : (isQualitative ? (est.notaFinalCualitativa || '-') : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
        ];
        return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      }).join('');

      printHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Arial,sans-serif;padding:20px}h2{margin:0 0 10px 0;text-align:center}
        .info{margin-bottom:15px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:5px}
        table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #ddd;padding:6px;text-align:center}
        th{background-color:#3b82f6;color:white}tr:nth-child(even){background-color:#f9f9f9}td:first-child{text-align:left}
        @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        th{background-color:#3b82f6!important}tr:nth-child(even){background-color:#f9f9f9!important}}
      </style></head><body>
        <h2>Reporte de Calificaciones</h2>
        <div class="info">
          <p><strong>Colegio:</strong> ${names.colegio}</p><p><strong>Año Lectivo:</strong> ${names.ano}</p>
          <p><strong>Grado:</strong> ${names.grado} - Sección: ${names.seccion}</p><p><strong>Asignatura:</strong> ${names.asignatura}</p>
          <p><strong>Corte:</strong> ${names.corte}</p><p><strong>Fecha:</strong> ${date}${selectedSexo ? ` - Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}` : ''}</p>
        </div>
        <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    } catch (error) {
      console.error("Error generando reporte:", error);
      await emit("show-toast", { message: "❌ Error al generar el reporte", type: 'error' });
    }
  }
</script>

<div class="page-container" style="height:100%;min-height:0">
  <style>
    @media print {
      :root{color-scheme:light!important}
      *,*::before,*::after{background-color:white!important;background-image:none!important;color:black;box-shadow:none!important;text-shadow:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;position:static!important}
      html,body,#root,.app-layout,.main-content,.page-container{background:white!important;background-color:white!important;color:black!important;margin:0!important;padding:0!important;width:100%!important;height:auto!important;overflow:visible!important;display:block!important;position:static!important}
      nav,.sidebar,.navbar,.no-print,button,.filters-section,.background-decoration,.resizer,.loading-spinner,.input-container,.sidebar-nav,.sidebar-title,.filters-row,.category-card:not(.print-header):not(.table-card),.statistics-slide-container{display:none!important}
      .table-slide-container{display:block!important;opacity:1!important;visibility:visible!important}
      .print-header{display:block!important;visibility:visible!important;width:100%!important;margin-bottom:20px!important;border-bottom:2px solid black!important;padding-bottom:10px!important;position:relative!important}
      .print-title{text-align:center!important;font-size:20pt!important;font-weight:bold!important;margin-bottom:10px!important;color:black!important;display:block!important}
      .print-grid{display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px 20px!important;font-size:11pt!important;color:black!important}
      .category-card.table-card{display:block!important;background:white!important;padding:0!important;margin:0!important;border:none!important;box-shadow:none!important;position:relative!important}
      table{display:table!important;width:100%!important;border-collapse:collapse!important;border:1px solid black!important;margin-top:10px!important;color:black!important}
      thead{display:table-header-group!important}tr{page-break-inside:avoid!important}
      th,td{border:1px solid black!important;padding:6px 4px!important;text-align:center!important;background-color:white!important;position:static!important}
      th{background-color:#f2f2f2!important;font-weight:bold!important;color:black!important}
      td:first-child{text-align:left!important;padding-left:10px!important;font-weight:500!important;color:black!important}
      td[style*="color"],span[style*="color"]{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
      .main-content{padding:0!important}::-webkit-scrollbar{display:none!important}
    }
    .print-header{display:none}
    .table-slide-container,.statistics-slide-container{display:none}
    .table-slide-container.active{display:flex;flex-direction:column;flex:1;min-height:0}
    .statistics-slide-container.active{display:block}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .table-row-hover:hover{background-color:rgba(255,255,255,0.04)!important}
    .filter-select{width:100%;background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.1);color:white;padding:0.6rem;border-radius:8px;outline:none;cursor:pointer}
    .filter-select:focus{border-color:#3b82f6}
    .notas-table-container::-webkit-scrollbar{width:6px}
    .notas-table-container::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);border-radius:3px}
    .notas-table-container::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:3px}
    .notas-table-container::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
    .notas-table-container table thead th{background:#1e293b!important;position:sticky;top:0;z-index:100}
  </style>

  <div class="print-header" style="display:none">
    <div class="print-title">Reporte de Calificaciones</div>
    <div class="print-grid">
      <div><strong>Colegio:</strong> {selectedNames.colegio}</div>
      <div><strong>Año Lectivo:</strong> {selectedNames.ano}</div>
      <div><strong>Grado:</strong> {selectedNames.grado}</div>
      <div><strong>Sección:</strong> {selectedNames.seccion}</div>
      <div><strong>Asignatura:</strong> {selectedNames.asignatura}</div>
      <div><strong>Corte:</strong> {selectedNames.corte}</div>
      <div><strong>Fecha:</strong> {new Date().toLocaleDateString()}</div>
      <div><strong>Sexo:</strong> {selectedSexo === "M" ? "Masculino" : selectedSexo === "F" ? "Femenino" : "Todos"}</div>
    </div>
  </div>

  <PageLayout>
    {#snippet filters()}
      <div class="category-card sticky-filters" style="margin-bottom:1rem;padding:0.8rem;position:sticky;top:0;z-index:999;background:rgba(26,26,26,0.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 4px 12px rgba(0,0,0,0.2);border-radius:0 0 12px 12px;border:1px solid rgba(255,255,255,0.05);border-top:none">
        <div class="filters-row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;flex-wrap:wrap;gap:0.8rem">
          <div style="display:flex;align-items:center;gap:0.5rem;flex:1 1 auto">
            <h3 style="margin:0;color:#f1f5f9;display:flex;align-items:center;gap:0.3rem;font-size:1.1rem">📊 Reportes</h3>
            <div style="height:16px;width:1px;background-color:rgba(255,255,255,0.1)"></div>
            <p style="margin:0;color:#94a3b8;font-size:0.75rem" class="hide-mobile">Rendimiento</p>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
            <div style="display:flex;background:rgba(255,255,255,0.05);border-radius:10px;padding:2px;border:1px solid rgba(255,255,255,0.1)">
              <button onclick={() => activeSlide = 'tabla'} style="padding:0.2rem 0.6rem;border-radius:8px;border:none;background:{activeSlide === 'tabla' ? '#3b82f6' : 'transparent'};color:{activeSlide === 'tabla' ? 'white' : '#94a3b8'};font-size:0.7rem;font-weight:bold;cursor:pointer">Tabla</button>
              <button onclick={() => activeSlide = 'estadisticas'} style="padding:0.2rem 0.6rem;border-radius:8px;border:none;background:{activeSlide === 'estadisticas' ? '#3b82f6' : 'transparent'};color:{activeSlide === 'estadisticas' ? 'white' : '#94a3b8'};font-size:0.7rem;font-weight:bold;cursor:pointer">Stats</button>
            </div>
          </div>
        </div>

        {#if printHtml}
          <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;padding:20px">
            <div style="background-color:white;border-radius:12px;width:100%;max-width:900px;height:90vh;display:flex;flex-direction:column;overflow:hidden">
              <div style="padding:15px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background-color:#f8fafc">
                <span style="font-size:16px;font-weight:600;color:#1e293b">Vista Previa de Impresión</span>
                <div style="display:flex;gap:10px">
                  <button onclick={() => { const iframe = document.querySelector('iframe'); if (iframe?.contentWindow) iframe.contentWindow.print(); }}
                    style="padding:8px 16px;background-color:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">🖨️ Imprimir</button>
                  <button onclick={() => printHtml = null} style="padding:8px 16px;background-color:#64748b;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">Cerrar</button>
                </div>
              </div>
              <iframe srcdoc={printHtml} style="flex:1;width:100%;border:none" title="Print Preview" />
            </div>
          </div>
        {/if}

        <FilterContainer {isMobile} style="padding:0.5rem">
          <FilterGroup label="Año:" {isMobile}>
            <select class="filter-select" bind:value={selectedAno} style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px">
              {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Corte:" {isMobile}>
            <select class="filter-select" style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px"
              value={specialCorte || selectedCorte}
              onchange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (val === "1S" || val === "2S" || val === "NF") { specialCorte = val; selectedCorte = 0; }
                else { specialCorte = ""; selectedCorte = Number(val); }
              }}>
              <optgroup label="Cortes Individuales">
                {#each cortes as c}<option value={c.id}>{c.nombre}</option>{/each}
              </optgroup>
              <optgroup label="Promedios">
                <option value="1S">1er Semestre</option>
                <option value="2S">2do Semestre</option>
                <option value="NF">Nota Final</option>
              </optgroup>
            </select>
          </FilterGroup>
          <FilterGroup label="Colegio:" {isMobile}>
            <select class="filter-select" bind:value={selectedColegio} style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px">
              {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Grado:" {isMobile}>
            <select class="filter-select" bind:value={selectedGrado} style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px">
              {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Sección:" {isMobile}>
            <select class="filter-select" bind:value={selectedSeccion} style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px">
              {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Sexo:" {isMobile}>
            <select class="filter-select" bind:value={selectedSexo} style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px">
              <option value="">Todos</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </FilterGroup>
          <FilterGroup label="Asignatura:" {isMobile}>
            <select class="filter-select" bind:value={selectedAsignatura} disabled={asignaturas.length === 0} style="width:100%;padding:0.3rem 0.4rem;font-size:0.75rem;height:28px">
              {#each asignaturas as a}<option value={a.id}>{a.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'}">
            <div style="flex:1;min-width:80px">
              <SearchInput bind:value={searchTerm} onChange={(v: string) => searchTerm = v} placeholder="Buscar..." {isMobile} />
            </div>
            {#if !isAndroid}
              <button class="secondary" onclick={handlePrintWithIframe} disabled={estudiantes.length === 0 || loading}
                style="padding:0.3rem 0.6rem;font-size:0.75rem;height:28px;background-color:#10b981;display:flex;align-items:center;justify-content:center;flex-shrink:0"
                title={(isMobile || isAndroid) ? "Compartir PDF" : "Imprimir"}>
                {(isMobile || isAndroid) ? "📤" : "🖨️"}
              </button>
            {/if}
            <button class="primary" onclick={exportToPDF} disabled={estudiantes.length === 0 || loading}
              style="padding:0.3rem 0.6rem;font-size:0.75rem;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              PDF
            </button>
          </div>
        </FilterContainer>
      </div>
    {/snippet}

    <div style="position:relative;flex:1;min-height:400px;display:flex;flex-direction:column;overflow:hidden">
      {#if loading}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem">
          <div class="loading-spinner" style="width:50px;height:50px;border:4px solid rgba(59,130,246,0.1);border-top:4px solid #3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:1rem"></div>
          <p style="color:#94a3b8;font-weight:500">Generando reporte...</p>
        </div>
      {:else if filteredReporte.length === 0}
        <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px">
          <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📋'}</div>
          <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? 'No se encontraron resultados' : 'No hay datos para mostrar'}</h4>
          <p style="color:#94a3b8;max-width:400px;margin:0 auto">
            {searchTerm ? `No se encontró ningún estudiante que coincida con "${searchTerm}"` : 'Seleccione todos los filtros necesarios para generar el reporte.'}
          </p>
          {#if searchTerm}
            <button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">Limpiar búsqueda</button>
          {/if}
        </div>
      {:else}
        <div class="table-slide-container" class:active={activeSlide === 'tabla'} style="animation:{activeSlide === 'tabla' ? 'fadeIn 0.3s ease-out' : 'none'};display:flex;flex-direction:column;flex:1;min-height:0">
          <div class="category-card table-card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;flex:1;min-height:0">
            <div class="notas-table-container" style="overflow:auto;padding:0;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;border:1px solid rgba(255,255,255,0.1);border-radius:8px;flex:1;min-height:0">
              <table style="width:100%;min-width:max-content;border-collapse:separate;border-spacing:0">
                <thead style="position:sticky;top:0;z-index:100">
                  <tr>
                    <th style="padding:1rem;text-align:left;background-color:#1e293b;border-bottom:2px solid rgba(255,255,255,0.1);color:#93c5fd;position:sticky;left:0;z-index:110">Estudiante</th>
                    <th style="padding:1rem;text-align:center;background-color:rgba(255,255,255,0.05);border-bottom:2px solid rgba(255,255,255,0.1);color:#94a3b8">Sexo</th>
                    {#if !specialCorte}
                      {#each configIndicadores as ind}
                        <th title={ind.descripcion} style="padding:1rem;text-align:center;background-color:rgba(255,255,255,0.05);border-bottom:2px solid rgba(255,255,255,0.1);color:{ind.activo ? '#93c5fd' : '#64748b'};font-size:0.85rem;cursor:help">
                          Ind. {ind.orden}
                          {#if !ind.activo}<div style="font-size:0.7rem;color:#ef4444">(Inactivo)</div>{/if}
                        </th>
                      {/each}
                    {/if}
                    <th style="padding:1rem;text-align:center;background-color:rgba(59,130,246,0.1);border-bottom:2px solid rgba(59,130,246,0.3);color:#60a5fa;font-weight:bold">Nota Final</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredReporte as estudiante, idx}
                    <tr class="table-row-hover" style="background-color:{idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}">
                      <td style="padding:0.85rem 1rem;border-bottom:1px solid rgba(255,255,255,0.05);color:#f1f5f9;font-weight:500;position:sticky;left:0;background-color:{idx % 2 === 0 ? '#1e293b' : '#1a2234'};z-index:5">
                        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{estudiante.nombre}</div>
                      </td>
                      <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);color:#94a3b8">{estudiante.sexo}</td>
                      {#if !specialCorte}
                        {#each configIndicadores as ind}
                          {@const nota = estudiante.notasIndicadores[ind.id] || 0}
                          {@const label = estudiante.notasCualitativasIndicadores[ind.id] || (isQualitative ? '' : '')}
                          {@const isMissing = label === "-" || label === ""}
                          {@const noteColor = isMissing ? '#64748b' : getNoteColor(isQualitative ? 0 : nota, label, getIndicatorMaxScore(ind.id))}
                          <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);color:{ind.activo ? noteColor : '#64748b'};opacity:{ind.activo ? 1 : 0.6}">
                            {#if isQualitative}
                              <span style="font-weight:{isMissing ? 'normal' : 'bold'};color:{noteColor}">{isMissing ? "-" : label}</span>
                            {:else}
                              <span style="font-weight:{(ind.activo && !isMissing) ? 'bold' : 'normal'};color:{ind.activo ? noteColor : '#64748b'}">{isMissing ? "-" : `${Math.round(nota)}${label ? ` ${label}` : ''}`}</span>
                            {/if}
                          </td>
                        {/each}
                      {/if}
                      <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);font-weight:bold;color:{(estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)};background-color:rgba(59,130,246,0.05)">
                        {#if isQualitative}
                          <span style="color:{(estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)}">
                            {(!estudiante.notaFinalCualitativa || estudiante.notaFinalCualitativa === "-") ? "-" : estudiante.notaFinalCualitativa}
                          </span>
                        {:else}
                          <span style="color:{(estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)}">
                            {(estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? "-" : `${Math.round(estudiante.notaFinal)}${estudiante.notaFinalCualitativa ? ` (${estudiante.notaFinalCualitativa})` : ''}`}
                          </span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="statistics-slide-container" class:active={activeSlide === 'estadisticas'} style="animation:{activeSlide === 'estadisticas' ? 'fadeIn 0.3s ease-out' : 'none'}">
          <div class="asistencia-summary" style="margin:0;padding:0.5rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem">
            <div class="summary-card students">
              <span class="summary-label">{searchTerm ? 'Resultados' : 'Estudiantes'}</span>
              <span class="summary-value">{filteredReporte.length}</span>
              <div class="gender-labels">
                <span class="gender-m">M: {filteredReporte.filter(e => e.sexo === 'M').length}</span>
                <span class="gender-f">F: {filteredReporte.filter(e => e.sexo === 'F').length}</span>
              </div>
            </div>
            <div class="summary-card p">
              <span class="summary-label">Promedio Grupal</span>
              <div class="summary-value" style="color: {promedioGrupalColor}">
                {promedioGrupalLabel}
              </div>
            </div>
            <div class="category-card" style="padding:0.8rem;grid-column:1 / -1;margin-top:0.5rem">
              <h4 style="margin:0 0 0.8rem 0;color:#93c5fd;display:flex;align-items:center;gap:0.5rem;font-size:0.9rem">ℹ️ Detalle de Indicadores</h4>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.5rem;font-size:0.8rem">
                {#each configIndicadores.filter(i => i.activo) as ind}
                  <div style="padding:0.5rem;background:rgba(255,255,255,0.02);border-radius:6px;border:1px solid rgba(255,255,255,0.05)">
                    <strong style="color:#60a5fa">Ind. {ind.orden}:</strong> {ind.descripcion || "Sin descripción"}
                  </div>
                {/each}
                {#if configIndicadores.filter(i => i.activo).length === 0}
                  <p style="color:#64748b;font-style:italic">No hay indicadores activos configurados.</p>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </PageLayout>
</div>
