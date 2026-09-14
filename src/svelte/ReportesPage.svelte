<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { join, tempDir, documentDir } from "@tauri-apps/api/path";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SearchFab from "./SearchFab.svelte";
  import PageLayout from "./PageLayout.svelte";
  import FiltersModalAndroid from "./FiltersModalAndroid.svelte";
  import { registerBackHandler } from "../lib/androidBack";
  import { loadAppSettings, onAppSettingsChange } from "../lib/appSettings";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; instrumento?: string; criterios: Criterio[]; }
  interface Estudiante { id: number; nombre: string; sexo: string; grado: string; seccion: string; }
  interface EstudianteReporte extends Estudiante {
    notasIndicadores: Record<number, number>;
    notasCualitativasIndicadores: Record<number, string>;
    notasCriterios?: Record<number, number>;
    notaFinal: number;
    notaFinalCualitativa?: string;
  }
  interface GradeConfig { id: string; color: string; minimo: number; }

  // Visible = la página contenedora está activa Y este es el sub-tab seleccionado.
  let { visible = true }: { visible?: boolean } = $props();

  let anos: CategoryItem[] = $state([]);
  let cortes: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let asignaturas: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);
  let gradeConfigs: GradeConfig[] = $state([]);

  let selectedAno = $state(0);
  let showAnoDropdown = $state(localStorage.getItem('stp_show_ano_dropdown') !== 'false');
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
  let silentRefresh = $state(false);
  let activeSlide = $state<'tabla' | 'estadisticas'>(typeof window !== 'undefined' && window.innerWidth <= 768 ? 'tabla' : 'estadisticas');
  let isMobile = $state(false);
  let isAndroid = $state(false);
  const isWindows = /Windows/i.test(navigator.userAgent);
  const isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));
  let showFiltersModal = $state(false);
  $effect(() => {
    if (showFiltersModal) {
      return registerBackHandler(() => { showFiltersModal = false; return true; });
    }
  });
  let printHtml: string | null = $state(null);
  let exportandoMasivo = $state(false);
  let expandedStudentId = $state(-1);
  let progresoMasivo = $state('');
  let loadId = 0;

  let isQualitative = $derived.by(() => {
    const grado = grados.find(g => g.id === selectedGrado);
    const asignatura = asignaturas.find(a => a.id === selectedAsignatura);
    return (grado?.cualitativo || false) || (asignatura?.cualitativo || false);
  });

  let multiplicadores: { id: string; multiplicador: number }[] = $state([]);
  let notaMapping = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const m of multiplicadores) map[m.id] = m.multiplicador;
    return map;
  });
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

  function valorToQualitativo(valor: number, puntajeMaximo: number): string {
    const candidates = [
      { grade: 'AA' as const, saved: Math.round(puntajeMaximo * notaMapping.AA) },
      { grade: 'AS' as const, saved: Math.round(puntajeMaximo * notaMapping.AS) },
      { grade: 'AF' as const, saved: Math.round(puntajeMaximo * notaMapping.AF) },
      { grade: 'AI' as const, saved: Math.round(puntajeMaximo * notaMapping.AI) },
    ];
    const match = candidates.find(c => c.saved === Math.round(valor));
    if (match) return match.grade;
    const ratio = valor / (puntajeMaximo || 1);
    if (ratio >= 0.90) return 'AA';
    if (ratio >= 0.70) return 'AS';
    if (ratio >= 0.50) return 'AF';
    return 'AI';
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
    window.addEventListener('schooltracker-sync', () => { silentRefresh = true; refreshTrigger++; });
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        activeSlide = activeSlide === 'tabla' ? 'estadisticas' : 'tabla';
      }
    });
    // Cargar configuraciones syncronizables
    loadAppSettings().then(s => { showAnoDropdown = s.showAnoDropdown; });
    const unsubSettings = onAppSettingsChange(s => { showAnoDropdown = s.showAnoDropdown; });

    const unsubGradeConfigs = listen("grade-configs-updated", async () => {
      try { gradeConfigs = await invoke<GradeConfig[]>("get_grade_configs"); } catch (e) { console.error("Error refreshing grade configs:", e); }
      try { multiplicadores = await invoke<{ id: string; multiplicador: number }[]>("get_multiplicadores"); } catch (e) { console.error("Error refreshing multiplicadores:", e); }
    });
    const unsubNotas = listen("notas-updated", () => { silentRefresh = true; refreshTrigger++; });
    const unsubStudents = listen("student-updated", () => { silentRefresh = true; refreshTrigger++; });
    const unsubCatalogs = listen("catalog-updated", () => { silentRefresh = true; refreshTrigger++; });

    fetchInitialCatalogs();

    return () => {
      unsubSettings();
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
    if (cortes.length > 0 && selectedGrado > 0 && selectedSeccion > 0 && (selectedCorte > 0 || specialCorte) && selectedAsignatura > 0) {
      if (refreshTrigger > 0) refreshTrigger = 0;
      const lid = ++loadId;
      if (!silentRefresh) loading = true;
      silentRefresh = false;
      fetchReporte(lid).finally(() => { if (loadId === lid) loading = false; });
    } else {
      refreshTrigger = 0;
      estudiantes = []; configIndicadores = []; loading = false; silentRefresh = false;
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
    refreshTrigger++;
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
      try { multiplicadores = await invoke<{ id: string; multiplicador: number }[]>("get_multiplicadores"); } catch (e) { console.error("Error fetching multiplicadores:", e); }
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

      const indicadoresArrays = await Promise.all(cortesIds.map(cId =>
        invoke<Indicador[]>("get_evaluation_config", { gradoId: selectedGrado, asignaturaId: selectedAsignatura, corteEvaluativoId: cId, anoLectivoId: selectedAno })
      ));
      if (lid !== loadId) return;

      const mergedMap = new Map<number, { ind: Indicador; criteriaMap: Map<number, Criterio> }>();
      for (const arr of indicadoresArrays) {
        for (const ind of arr) {
          if (!mergedMap.has(ind.id)) {
            mergedMap.set(ind.id, { ind: { ...ind, criterios: [] }, criteriaMap: new Map() });
          }
          const entry = mergedMap.get(ind.id)!;
          for (const crit of ind.criterios) {
            if (!entry.criteriaMap.has(crit.id)) {
              entry.criteriaMap.set(crit.id, crit);
            }
          }
        }
      }
      const indicadores: Indicador[] = Array.from(mergedMap.values()).map(entry => ({
        ...entry.ind,
        criterios: Array.from(entry.criteriaMap.values())
      }));

      if (indicadores.length === 0) {
        configIndicadores = []; estudiantes = [];
        await emit("show-toast", { message: "⚠️ No hay indicadores configurados.", type: "warning" });
        return;
      }
      configIndicadores = indicadores.filter(ind => ind.activo);

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
                    labelsCualitativosCorte.push(valorToQualitativo(valor, crit.puntajeMaximo));
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
                  labelsInd.push(valorToQualitativo(valor, crit.puntajeMaximo));
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
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const names = selectedNames;
      const date = new Date().toLocaleDateString();
      const margins = { top: 10, bottom: 10, left: 10, right: 10 };
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("Reporte de Notas", doc.internal.pageSize.getWidth() / 2, 15, { align: "center" });
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

      const mostrarIndicadores = false;
      const tableHeaders = ["Estudiante", "Sexo", ...(mostrarIndicadores ? configIndicadores.map(ind => `Ind. ${ind.orden}`) : []), "Nota Final"];
      const tableRows = estudiantes.map(est => [
        est.nombre, est.sexo,
        ...(mostrarIndicadores ? configIndicadores.map(ind => {
          const nota = est.notasIndicadores[ind.id] || 0;
          const label = est.notasCualitativasIndicadores[ind.id] || "";
          if (label === "-" || label === "") return "-";
          if (isQualitative) return label;
          return `${nota}${label ? ` ${label}` : ''}`;
        }) : []),
        (est.notaFinalCualitativa === "-" || !est.notaFinalCualitativa) ? "-" : (isQualitative ? (est.notaFinalCualitativa || '-') : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
      ]);

      autoTable(doc, {
        startY: yPos + 5, margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [tableHeaders], body: tableRows, theme: 'grid',
        headStyles: { fillColor: [107, 114, 128], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 15, halign: 'center' } },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index >= 2) {
            const est = estudiantes[data.row.index];
            let colorHex = "";
            if (data.column.index === tableHeaders.length - 1) {
              colorHex = est.notaFinalCualitativa === "-" ? "#64748b" : getNoteColor(est.notaFinal, est.notaFinalCualitativa, totalPuntajeMaximoConfig);
            } else if (mostrarIndicadores) {
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
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_');
      const fileName = `Notas ${sanitize(names.colegio)} ${sanitize(names.grado)} - Seccion ${sanitize(names.seccion)}.pdf`;
      const docsPath = await documentDir(); const folderName = "School Tracker";
      const subfolder = `${sanitize(names.ano)} - ${sanitize(names.corte)} - ${sanitize(names.asignatura)}`;
      const sep = isAndroid ? '/' : '\\';
      const fp = docsPath + sep + folderName + sep + subfolder;
      const fullPath = fp + sep + fileName;
      await mkdir(fp, { recursive: true }).catch(e => console.log("mkdir:", e));
      await writeFile(fullPath, new Uint8Array(pdfData));
      const folderPath = fp.replace(/\\/g, '/');
      if (isAndroid) { try { await invoke('share_pdf', { path: fullPath.replace(/\\/g, '/') }); } catch {} }
      else { try { await openUrl("file:///" + folderPath); } catch {} }
      await emit("show-toast", { message: "✅ PDF guardado en Documents/School Tracker/" + subfolder, type: 'success' });
    } catch (error) {
      console.error("Error al generar PDF:", error);
      await emit("show-toast", { message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), type: 'error' });
    }
  }

  async function exportToPDFMasivo() {
    if (!selectedColegio || !selectedAno || !selectedAsignatura) {
      await emit("show-toast", { message: "⚠️ Seleccione colegio, año y asignatura para exportación masiva", type: 'warning' });
      return;
    }
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
    if (cortesIds.length === 0 || (cortesIds.length === 1 && cortesIds[0] === 0)) {
      await emit("show-toast", { message: "⚠️ Seleccione un corte evaluativo", type: 'warning' });
      return;
    }

    try {
      exportandoMasivo = true;
      progresoMasivo = 'Preparando...';
      const names = selectedNames;
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_');
      const docsPath = await documentDir();
      const folderName = "School Tracker";
      const subfolder = `${sanitize(names.ano)} - ${sanitize(names.corte)} - ${sanitize(names.asignatura)}`;
      const sep = isAndroid ? '/' : '\\';
      const baseDir = docsPath + sep + folderName + sep + subfolder;
      await mkdir(baseDir, { recursive: true });

      const gradosList: CategoryItem[] = await invoke("get_grados_by_colegio", { colegioId: selectedColegio, anoLectivoId: selectedAno });
      if (!gradosList || gradosList.length === 0) {
        await emit("show-toast", { message: "⚠️ No se encontraron grados para este colegio", type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      const pairs: { gradoId: number; gradoNombre: string; seccionId: number; seccionNombre: string }[] = [];
      for (const grado of gradosList) {
        const seccionesList: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: grado.id, colegioId: selectedColegio, anoLectivoId: selectedAno });
        for (const sec of seccionesList) {
          pairs.push({ gradoId: grado.id!, gradoNombre: grado.nombre, seccionId: sec.id!, seccionNombre: sec.nombre });
        }
      }

      if (pairs.length === 0) {
        await emit("show-toast", { message: "⚠️ No se encontraron secciones con estudiantes", type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      let processed = 0;
      for (const pair of pairs) {
        processed++;
        progresoMasivo = `${processed}/${pairs.length} - ${pair.gradoNombre} Seccion ${pair.seccionNombre}`;

        const listaEstudiantes: any[] = await invoke("get_estudiantes_by_filters", { gradoId: pair.gradoId, seccionId: pair.seccionId });
        if (!listaEstudiantes || listaEstudiantes.length === 0) continue;

        const notasResults = await Promise.all(cortesIds.map(cId =>
          invoke<any[]>("get_notas_by_filters", { gradoId: pair.gradoId, seccionId: pair.seccionId, corteId: cId, asignaturaId: selectedAsignatura })
        ));

        const notasGlobales: Record<number, Record<number, Record<number, number>>> = {};
        notasResults.forEach((notasCorte, idx) => {
          const cId = cortesIds[idx];
          notasGlobales[cId] = {};
          notasCorte.forEach((n: any) => {
            if (!notasGlobales[cId][n.estudianteId]) notasGlobales[cId][n.estudianteId] = {};
            notasGlobales[cId][n.estudianteId][n.criterioId] = n.valor;
          });
        });

        const indicadoresArrays = await Promise.all(cortesIds.map(cId =>
          invoke<any[]>("get_evaluation_config", { gradoId: pair.gradoId, asignaturaId: selectedAsignatura, corteEvaluativoId: cId, anoLectivoId: selectedAno })
        ));
        const indicadores: any[] = [];
        const seenInd = new Set<number>();
        for (const arr of indicadoresArrays) {
          for (const ind of arr) {
            if (!seenInd.has(ind.id)) { seenInd.add(ind.id); indicadores.push(ind); }
          }
        }

        const esCualitativo = gradosList.find(g => g.id === pair.gradoId)?.cualitativo || false;

        const reporteData = listaEstudiantes.map((est: any) => {
          let totalSuma = 0, totalMaximo = 0, haIngresado = false;
          const labelsCualitativos: string[] = [];
          cortesIds.forEach(cId => {
            const notasCriterios = notasGlobales[cId]?.[est.id] || {};
            indicadores.forEach((ind: any) => {
              (ind.criterios || []).forEach((crit: any) => {
                const valor = notasCriterios[crit.id];
                if (valor !== undefined) {
                  totalSuma += valor; haIngresado = true; totalMaximo += crit.puntajeMaximo || 0;
                  if (esCualitativo) {
                    labelsCualitativos.push(valorToQualitativo(valor, crit.puntajeMaximo || 0));
                  }
                }
              });
            });
          });
          let notaFinal = -1, notaFinalQual = "-";
          if (haIngresado) {
            const pct = (totalSuma / (totalMaximo || 1)) * 100;
            notaFinal = esCualitativo ? pct : Math.round(totalSuma);
            notaFinalQual = esCualitativo ? calcularNotaCualitativaFinal(labelsCualitativos) : getQualitativeLabel(pct);
          }
          return { ...est, notaFinal, notaFinalQual };
        });

        const { default: jsPDF } = await import("jspdf");
        const { default: autoTable } = await import("jspdf-autotable");
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const date = new Date().toLocaleDateString();
        const margins = { top: 10, bottom: 10, left: 10, right: 10 };
        doc.setFont("helvetica", "bold"); doc.setFontSize(16);
        doc.text(`Notas ${names.colegio}`, doc.internal.pageSize.getWidth() / 2, 15, { align: "center" });
        doc.setFontSize(10); doc.setTextColor(0);
        const filterInfo = [
          ["Grado:", pair.gradoNombre, "Sección:", pair.seccionNombre],
          ["Asignatura:", names.asignatura, "Corte:", names.corte],
          ["Año Lectivo:", names.ano, "Fecha:", date],
        ];
        let yPos = 25;
        filterInfo.forEach(row => {
          doc.setFont("helvetica", "bold"); doc.text(row[0], margins.left + 10, yPos);
          doc.setFont("helvetica", "normal"); doc.text(row[1], margins.left + 35, yPos);
          doc.setFont("helvetica", "bold"); doc.text(row[2], doc.internal.pageSize.getWidth() / 2 + 5, yPos);
          doc.setFont("helvetica", "normal"); doc.text(row[3], doc.internal.pageSize.getWidth() / 2 + 30, yPos);
          yPos += 6;
        });

        const tableHeaders = ["Estudiante", "Sexo", "Nota Final"];
        const tableRows = reporteData.map((est: any) => [
          est.nombre, est.sexo,
          (!est.notaFinalQual || est.notaFinalQual === "-") ? "-"
            : esCualitativo ? est.notaFinalQual
              : `${Math.round(est.notaFinal)}${est.notaFinalQual ? ` (${est.notaFinalQual})` : ''}`
        ]);

        autoTable(doc, {
          startY: yPos + 5, margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
          head: [tableHeaders], body: tableRows, theme: 'grid',
          headStyles: { fillColor: [107, 114, 128], textColor: 255, fontStyle: 'bold' },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 15, halign: 'center' } },
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 2) {
              const est = reporteData[data.row.index];
              const colorHex = (!est.notaFinalQual || est.notaFinalQual === "-") ? "#64748b"
                : getNoteColor(est.notaFinal, est.notaFinalQual, totalPuntajeMaximoConfig);
              const [r, g, b] = hexToRgb(colorHex);
              data.cell.styles.textColor = [r, g, b];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 10;
        const conNotas = reporteData.filter((e: any) => e.notaFinal >= 0);
        let promedioText = "-";
        if (conNotas.length > 0) {
          if (esCualitativo) { promedioText = calcularNotaCualitativaFinal(conNotas.map((e: any) => e.notaFinalQual || 'AI')); }
          else {
            const prom = conNotas.reduce((s: number, e: any) => s + e.notaFinal, 0) / conNotas.length;
            promedioText = `${Math.round(prom)}${getQualitativeLabel(prom) ? ` (${getQualitativeLabel(prom)})` : ''}`;
          }
        }
        doc.setFontSize(11); doc.text(`Total Estudiantes: ${reporteData.length}`, margins.left + 10, finalY);
        doc.text(`Promedio Grupal: ${promedioText}`, doc.internal.pageSize.getWidth() / 2 + 15, finalY);

        const pdfData = doc.output('arraybuffer');
        const fileName = `Notas ${sanitize(names.colegio)} ${sanitize(pair.gradoNombre)} - Seccion ${sanitize(pair.seccionNombre)}.pdf`;
        const fullPath = baseDir + sep + fileName;
        await writeFile(fullPath, new Uint8Array(pdfData));
      }

      exportandoMasivo = false;
      await emit("show-toast", { message: `✅ ${processed} PDFs generados en Documents/School Tracker/${subfolder}`, type: 'success' });
      if (!isAndroid) { try { await openUrl("file:///" + baseDir.replace(/\\/g, '/')); } catch {} }
    } catch (error) {
      console.error("Error en exportación masiva:", error);
      exportandoMasivo = false;
      await emit("show-toast", { message: "❌ Error en exportación masiva: " + (error instanceof Error ? error.message : String(error)), type: 'error' });
    }
  }

  let showClipboardMenu = $state(false);

  function toggleClipboardMenu(e: MouseEvent) {
    e.stopPropagation();
    showClipboardMenu = !showClipboardMenu;
  }

  function closeClipboardMenu() {
    showClipboardMenu = false;
  }

  function getNotaFinalValue(est: EstudianteReporte): string {
    if (!est.notaFinalCualitativa || est.notaFinalCualitativa === '-') return '-';
    if (isQualitative) return est.notaFinalCualitativa;
    return String(Math.round(est.notaFinal));
  }

  async function copyFullTable() {
    if (filteredReporte.length === 0) return;
    const headers = ['Estudiante', 'Sexo'];
    if (!specialCorte) {
      configIndicadores.forEach(ind => headers.push(`Ind. ${ind.orden}`));
    }
    headers.push('Nota Final');
    const rows = filteredReporte.map(est => {
      const cells = [est.nombre, est.sexo];
      if (!specialCorte) {
        configIndicadores.forEach(ind => {
          const nota = est.notasIndicadores[ind.id] || 0;
          const label = est.notasCualitativasIndicadores[ind.id] || '';
          if (label === '-' || label === '') cells.push('-');
          else cells.push(isQualitative ? label : String(Math.round(nota)));
        });
      }
      cells.push(getNotaFinalValue(est));
      return cells.join('\t');
    });
    const tsv = [headers.join('\t'), ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      await emit('show-toast', { message: `✅ ${filteredReporte.length} registros copiados. Pega en Excel (Ctrl+V).`, type: 'success' });
    } catch (e) {
      await emit('show-toast', { message: `❌ Error al copiar: ${e}`, type: 'error' });
    }
    showClipboardMenu = false;
  }

  async function copyFinalGradesOnly() {
    if (filteredReporte.length === 0) return;
    const values = filteredReporte.map(getNotaFinalValue).join('\n');
    try {
      await navigator.clipboard.writeText(values);
      await emit('show-toast', { message: `✅ ${filteredReporte.length} notas copiadas. Pega en Excel (Ctrl+V).`, type: 'success' });
    } catch (e) {
      await emit('show-toast', { message: `❌ Error al copiar: ${e}`, type: 'error' });
    }
    showClipboardMenu = false;
  }

  $effect(() => {
    if (showClipboardMenu) {
      const dispose = registerBackHandler(() => { showClipboardMenu = false; return true; });
      const handler = () => { showClipboardMenu = false; };
      const timer = setTimeout(() => window.addEventListener('click', handler), 0);
      return () => { clearTimeout(timer); window.removeEventListener('click', handler); dispose(); };
    }
  });

  async function handlePrintWithIframe() {
    if (estudiantes.length === 0) { await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' }); return; }
    try {
      await emit("show-toast", { message: "✅ Preparando reporte...", type: 'success' });
      const names = selectedNames; const date = new Date().toLocaleDateString();
      const mostrarIndicadores = false;
      const headers = ["Estudiante", "Sexo", ...(mostrarIndicadores ? configIndicadores.map(ind => `Ind. ${ind.orden}`) : []), "Nota Final"];
      const rows = estudiantes.map(est => {
        const cells = [est.nombre, est.sexo,
          ...(mostrarIndicadores ? configIndicadores.map(ind => {
            const nota = est.notasIndicadores[ind.id] || 0; const label = est.notasCualitativasIndicadores[ind.id] || "";
            if (label === "-" || label === "") return "-";
            return isQualitative ? label : `${nota}${label ? ` ${label}` : ''}`;
          }) : []),
          (est.notaFinalCualitativa === "-" || !est.notaFinalCualitativa) ? "-" : (isQualitative ? (est.notaFinalCualitativa || '-') : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
        ];
        return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      }).join('');

      printHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Arial,sans-serif;padding:20px;color:#000}h2{margin:0 0 10px 0;text-align:center}
        .info{margin-bottom:15px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:5px}
        table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #ddd;padding:6px;text-align:center;color:#000}
        th{background-color:#6b7280;color:white}tr:nth-child(even){background-color:#f9f9f9}td:first-child{text-align:left}
        @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        th{background-color:#6b7280!important}tr:nth-child(even){background-color:#f9f9f9!important}}
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
{#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder="Buscar..." />{/if}


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
    @media (max-width:768px){
      .statistics-slide-container.active{overflow-y:auto;-webkit-overflow-scrolling:touch;max-height:calc(100dvh - 170px)}
    }
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .reportes-tabs { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-elevated); border-radius: 10px; border: 1px solid var(--border); }
    .reportes-tab { padding: 0.2rem 0.6rem; border-radius: 8px; border: none; background: transparent; color: var(--text-muted); font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
    .reportes-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
    .reportes-tab.active { background: var(--bg-active); color: var(--text-bright); }
    .table-row-hover:hover{background-color:rgba(255,255,255,0.04)!important}
    .filter-select{width:100%;background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.1);color:white;padding:0.6rem;border-radius:8px;outline:none;cursor:pointer}
    .filter-select:focus{border-color:var(--primary-color)}
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
            <div class="reportes-tabs">
              <button class="reportes-tab" class:active={activeSlide === 'tabla'} onclick={() => activeSlide = 'tabla'}>Tabla</button>
              <button class="reportes-tab" class:active={activeSlide === 'estadisticas'} onclick={() => activeSlide = 'estadisticas'}>Stats</button>
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
                    style="padding:8px 16px;background-color:var(--primary-color);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">🖨️ Imprimir</button>
                  <button onclick={() => printHtml = null} style="padding:8px 16px;background-color:#64748b;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">Cerrar</button>
                </div>
              </div>
              <iframe srcdoc={printHtml} style="flex:1;width:100%;border:none" title="Print Preview" />
            </div>
          </div>
        {/if}

        {#if isAndroidMobile}
          <div style="width:100%;padding:0.1rem 0 0.3rem;">
            <input bind:value={searchTerm} placeholder="🔍 Buscar..."
              style="width:100%;height:38px;padding:0 0.8rem;font-size:0.82rem;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;box-sizing:border-box;" />
          </div>
          <div class="category-card" style="padding: 0.5rem; margin-bottom: 0.5rem; display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
            <button type="button" onclick={() => { showFiltersModal = true; }}
              style="height:38px;padding:0 0.8rem;font-size:0.78rem;background:rgba(96,165,250,0.18);color:#bfdbfe;border:1px solid rgba(96,165,250,0.4);border-radius:8px;display:flex;align-items:center;justify-content:center;gap:5px;font-weight:600;cursor:pointer;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span>🔍</span>
              <span style="overflow:hidden;text-overflow:ellipsis;">
                {(colegios.find(c => c.id === selectedColegio)?.nombre)?.split(' ')[0] || 'Colegio'} · {grados.find(g => g.id === selectedGrado)?.nombre || 'Grado'} · {secciones.find(s => s.id === selectedSeccion)?.nombre || 'Sección'}{selectedSexo ? ` · ${selectedSexo === 'M' ? 'Masc' : 'Fem'}` : ''}
              </span>
            </button>
          </div>
          <div class="category-card" style="padding: 0.5rem; margin-bottom: 0.5rem; display:flex;gap:0.3rem;align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
            {#if !isAndroid}
              <button onclick={handlePrintWithIframe} disabled={estudiantes.length === 0 || loading}
                style="height:42px;padding:0 0.4rem;font-size:0.75rem;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{estudiantes.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);flex-shrink:0;white-space:nowrap;opacity:{estudiantes.length === 0 || loading ? 0.7 : 1}"
                title="Imprimir">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </button>
            {/if}
            <button onclick={exportToPDF} disabled={estudiantes.length === 0 || loading}
              style="height:42px;padding:0 0.4rem;font-size:0.75rem;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{estudiantes.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(239,68,68,0.4);flex-shrink:0;white-space:nowrap;opacity:{estudiantes.length === 0 || loading ? 0.7 : 1}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </button>
            <button onclick={exportToPDFMasivo} disabled={exportandoMasivo || !selectedColegio || !selectedAno || !selectedAsignatura}
              style="height:42px;padding:0 0.4rem;font-size:0.75rem;background-color:#6366f1;color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{exportandoMasivo || !selectedColegio || !selectedAno || !selectedAsignatura ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(99,102,241,0.4);flex-shrink:0;white-space:nowrap;opacity:{exportandoMasivo || !selectedColegio || !selectedAno || !selectedAsignatura ? 0.7 : 1}">
              📚
            </button>
            <div style="position:relative;flex-shrink:0">
              <button onclick={toggleClipboardMenu} disabled={filteredReporte.length === 0 || loading}
                style="height:42px;padding:0 0.4rem;font-size:0.75rem;background:linear-gradient(135deg,#a855f7,#9333ea);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{filteredReporte.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(168,85,247,0.4);flex-shrink:0;white-space:nowrap;opacity:{filteredReporte.length === 0 || loading ? 0.7 : 1}"
                title="Copiar al portapapeles">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              {#if showClipboardMenu}
                <div onclick={(e) => e.stopPropagation()} style="position:absolute;top:calc(100% + 4px);right:0;min-width:240px;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);padding:0.4rem;z-index:200;overflow:hidden;animation:fadeIn 0.15s ease-out">
                  <button onclick={copyFullTable}
                    style="display:flex;align-items:center;gap:8px;width:100%;padding:0.65rem 0.75rem;font-size:0.8rem;background:transparent;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;white-space:nowrap"
                    onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'}
                    onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    Estudiantes + Nota Final
                  </button>
                  <button onclick={copyFinalGradesOnly}
                    style="display:flex;align-items:center;gap:8px;width:100%;padding:0.65rem 0.75rem;font-size:0.8rem;background:transparent;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;white-space:nowrap"
                    onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'}
                    onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    Solo Nota Final
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {:else}
        <FilterContainer {isMobile} style="padding:0.5rem">
          {#if showAnoDropdown}
          <FilterGroup label="Año:" {isMobile}>
            <select class="filter-select" bind:value={selectedAno} style="width:100%">
              {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
            </select>
          </FilterGroup>
          {/if}
          <FilterGroup label="Corte:" {isMobile}>
            <select class="filter-select" style="width:100%"
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
            <select class="filter-select" bind:value={selectedColegio} style="width:100%">
              {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Grado:" {isMobile}>
            <select class="filter-select" bind:value={selectedGrado} style="width:100%">
              {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Sección:" {isMobile}>
            <select class="filter-select" bind:value={selectedSeccion} style="width:100%">
              {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <FilterGroup label="Sexo:" {isMobile}>
            <select class="filter-select" bind:value={selectedSexo} style="width:100%">
              <option value="">Todos</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </FilterGroup>
          <FilterGroup label="Asignatura:" {isMobile}>
            <select class="filter-select" bind:value={selectedAsignatura} disabled={asignaturas.length === 0} style="width:100%">
              {#each asignaturas as a}<option value={a.id}>{a.nombre}</option>{/each}
            </select>
          </FilterGroup>
          <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'};{isMobile ? 'overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;' : ''}">
            {#if !isAndroid}
              <button onclick={handlePrintWithIframe} disabled={estudiantes.length === 0 || loading}
                style="height:42px;padding:0 {isMobile ? '0.4rem' : '1.25rem'};font-size:{isMobile ? '0.75rem' : '0.85rem'};background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{estudiantes.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);flex-shrink:0;white-space:nowrap;opacity:{estudiantes.length === 0 || loading ? 0.7 : 1}"
                title={(isMobile || isAndroid) ? 'Compartir PDF' : 'Imprimir'}>
                <svg width="{isMobile ? '12' : '14'}" height="{isMobile ? '12' : '14'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                {#if !isMobile}Imprimir{/if}
              </button>
            {/if}
            <button onclick={exportToPDF} disabled={estudiantes.length === 0 || loading}
              style="height:42px;padding:0 {isMobile ? '0.4rem' : '1.25rem'};font-size:{isMobile ? '0.75rem' : '0.85rem'};background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{estudiantes.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(239,68,68,0.4);flex-shrink:0;white-space:nowrap;opacity:{estudiantes.length === 0 || loading ? 0.7 : 1}">
              <svg width="{isMobile ? '12' : '14'}" height="{isMobile ? '12' : '14'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              {#if !isMobile}PDF{/if}
            </button>
            <button onclick={exportToPDFMasivo} disabled={exportandoMasivo || !selectedColegio || !selectedAno || !selectedAsignatura}
              style="height:42px;padding:0 {isMobile ? '0.4rem' : '1.25rem'};font-size:{isMobile ? '0.75rem' : '0.85rem'};background-color:#6366f1;color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{exportandoMasivo || !selectedColegio || !selectedAno || !selectedAsignatura ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(99,102,241,0.4);flex-shrink:0;white-space:nowrap;opacity:{exportandoMasivo || !selectedColegio || !selectedAno || !selectedAsignatura ? 0.7 : 1}">
              {exportandoMasivo ? progresoMasivo : '📚 Exportar Todo'}
            </button>
            <div style="position:relative;flex-shrink:0">
              <button onclick={toggleClipboardMenu} disabled={filteredReporte.length === 0 || loading}
                style="height:42px;padding:0 {isMobile ? '0.4rem' : '1.25rem'};font-size:{isMobile ? '0.75rem' : '0.85rem'};background:linear-gradient(135deg,#a855f7,#9333ea);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{filteredReporte.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(168,85,247,0.4);flex-shrink:0;white-space:nowrap;opacity:{filteredReporte.length === 0 || loading ? 0.7 : 1}"
                title="Copiar al portapapeles">
                <svg width="{isMobile ? '12' : '14'}" height="{isMobile ? '12' : '14'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {#if !isMobile}Copiar{/if}
              </button>
              {#if showClipboardMenu}
                <div onclick={(e) => e.stopPropagation()} style="position:absolute;top:calc(100% + 4px);right:0;min-width:240px;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);padding:0.4rem;z-index:200;overflow:hidden;animation:fadeIn 0.15s ease-out">
                  <button onclick={copyFullTable}
                    style="display:flex;align-items:center;gap:8px;width:100%;padding:0.65rem 0.75rem;font-size:0.8rem;background:transparent;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;white-space:nowrap"
                    onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'}
                    onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                    Estudiantes + Nota Final
                  </button>
                  <button onclick={copyFinalGradesOnly}
                    style="display:flex;align-items:center;gap:8px;width:100%;padding:0.65rem 0.75rem;font-size:0.8rem;background:transparent;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;white-space:nowrap"
                    onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'}
                    onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                    Solo Nota Final
                  </button>
                </div>
              {/if}
            </div>
            <div style="flex:1;min-width:100px">
            </div>
          </div>
        </FilterContainer>
        {/if}
      </div>
    {/snippet}

    <div style="position:relative;flex:1;min-height:400px;display:flex;flex-direction:column;overflow:hidden">
      {#if loading}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem">
          <div class="loading-spinner" style="width:50px;height:50px;border:4px solid rgba(var(--primary-rgb),0.1);border-top:4px solid var(--primary-color);border-radius:50%;animation:spin 1s linear infinite;margin-bottom:1rem"></div>
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
          {#if isMobile}
            <div style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:0 0.3rem">
              {#each filteredReporte as estudiante, idx}
                {@const isExpanded = expandedStudentId === estudiante.id}
                {@const finalColor = (estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)}
                <div onclick={() => expandedStudentId = isExpanded ? -1 : estudiante.id}
                  style="margin-bottom:0.3rem;border-radius:12px;border:1px solid rgba(255,255,255,{isExpanded ? '0.12' : '0.06'});background:{isExpanded ? 'rgba(30,41,59,0.8)' : 'rgba(15,23,42,0.5)'};overflow:hidden;cursor:pointer;transition:all 0.2s ease">
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.7rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;min-width:0;flex:1">
                      <div style="font-size:0.75rem;color:#64748b;min-width:28px;text-align:center;">{idx + 1}</div>
                      <div style="font-size:0.85rem;color:#f1f5f9;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{estudiante.nombre}</div>
                      <span style="font-size:0.65rem;color:#94a3b8;background:rgba(255,255,255,0.05);padding:0.1rem 0.4rem;border-radius:4px;flex-shrink:0">{estudiante.sexo}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0;">
                      <span style="font-size:0.85rem;font-weight:bold;color:{finalColor}">
                        {#if isQualitative}
                          {estudiante.notaFinalCualitativa || '-'}
                        {:else}
                          {estudiante.notaFinalCualitativa && estudiante.notaFinalCualitativa !== "-" ? `${Math.round(estudiante.notaFinal)} (${estudiante.notaFinalCualitativa})` : '-'}
                        {/if}
                      </span>
                      <span style="font-size:0.65rem;color:#64748b;transition:transform 0.2s ease;{isExpanded ? 'transform:rotate(180deg);' : ''}">▼</span>
                    </div>
                  </div>
                  {#if isExpanded}
                    <div style="border-top:1px solid rgba(255,255,255,0.06);padding:0.5rem 0.7rem;">
                      {#if !specialCorte}
                        {#each configIndicadores as ind}
                          {@const nota = estudiante.notasIndicadores[ind.id] || 0}
                          {@const label = estudiante.notasCualitativasIndicadores[ind.id] || ''}
                          {@const isMissing = label === "-" || label === ""}
                          {@const noteColor = isMissing ? '#64748b' : getNoteColor(isQualitative ? 0 : nota, label, getIndicatorMaxScore(ind.id))}
                          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                            <div style="display:flex;align-items:center;gap:0.3rem;min-width:0;flex:1">
                              <div style="width:4px; height:4px; border-radius:50%; background:{noteColor}; flex-shrink:0;"></div>
                              <span style="font-size:0.75rem;color:#94a3b8;">Ind. {ind.orden}</span>
                              {#if ind.descripcion}
                                <span style="font-size:0.65rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">— {ind.descripcion}</span>
                              {/if}
                            </div>
                            <span style="font-size:0.8rem;font-weight:bold;color:{noteColor};flex-shrink:0;">
                              {#if isQualitative}
                                {isMissing ? '-' : label}
                              {:else}
                                {isMissing ? '-' : `${Math.round(nota)}${label ? ` ${label}` : ''}`}
                              {/if}
                            </span>
                          </div>
                        {/each}
                      {:else}
                        <div style="padding:0.35rem 0;font-size:0.75rem;color:#64748b;">
                          Vista de nota final consolidada — no hay indicadores individuales
                        </div>
                      {/if}
                      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0 0.2rem;margin-top:0.2rem;border-top:1px solid rgba(var(--primary-rgb),0.15);">
                        <span style="font-size:0.8rem;color:var(--text-secondary);font-weight:bold;">Nota Final</span>
                        <span style="font-size:0.9rem;font-weight:bold;color:{finalColor};">
                          {#if isQualitative}
                            {estudiante.notaFinalCualitativa || '-'}
                          {:else}
                            {estudiante.notaFinalCualitativa && estudiante.notaFinalCualitativa !== "-" ? `${Math.round(estudiante.notaFinal)} (${estudiante.notaFinalCualitativa})` : '-'}
                          {/if}
                        </span>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
          <div class="category-card table-card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;flex:1;min-height:0">
            <div class="notas-table-container" style="overflow:auto;padding:0;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;border:1px solid rgba(255,255,255,0.1);border-radius:8px;flex:1;min-height:0">
              <table style="width:100%;min-width:max-content;border-collapse:separate;border-spacing:0">
                <thead style="position:sticky;top:0;z-index:100">
                  <tr>
                    <th style="padding:1rem;text-align:left;background-color:#1e293b;border-bottom:2px solid rgba(255,255,255,0.1);color:var(--text-secondary);position:sticky;left:0;z-index:110">Estudiante</th>
                    <th style="padding:1rem;text-align:center;background-color:rgba(255,255,255,0.05);border-bottom:2px solid rgba(255,255,255,0.1);color:#94a3b8">Sexo</th>
                    {#if !specialCorte}
                      {#each configIndicadores as ind}
                        <th title={ind.descripcion} style="padding:1rem;text-align:center;background-color:rgba(255,255,255,0.05);border-bottom:2px solid rgba(255,255,255,0.1);color:var(--text-secondary);font-size:0.85rem;cursor:help">
                          Ind. {ind.orden}
                        </th>
                      {/each}
                    {/if}
                    <th style="padding:1rem;text-align:center;background-color:rgba(var(--primary-rgb),0.1);border-bottom:2px solid rgba(var(--primary-rgb),0.3);color:var(--text-secondary);font-weight:bold">Nota Final</th>
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
                          <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);color:{noteColor}">
                            {#if isQualitative}
                              <span style="font-weight:{isMissing ? 'normal' : 'bold'};color:{noteColor}">{isMissing ? "-" : label}</span>
                            {:else}
                              <span style="font-weight:{isMissing ? 'normal' : 'bold'};color:{noteColor}">{isMissing ? "-" : `${Math.round(nota)}${label ? ` ${label}` : ''}`}</span>
                            {/if}
                          </td>
                        {/each}
                      {/if}
                      <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);font-weight:bold;color:{(estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)};background-color:rgba(var(--primary-rgb),0.05)">
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
          {/if}
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
            {#each configIndicadores.filter(i => i.activo) as ind}
              <div class="summary-card" style="border-left:3px solid var(--primary-color)">
                <span class="summary-label">Ind. {ind.orden}</span>
                <span class="summary-value" style="font-size:0.7rem;color:var(--text-secondary);font-weight:400;line-height:1.2;word-break:break-word">{ind.descripcion || "Sin descripción"}</span>
              </div>
            {/each}
            {#if configIndicadores.filter(i => i.activo).length === 0}
              <div class="summary-card" style="grid-column:1/-1">
                <span class="summary-label" style="color:#64748b;font-style:italic">No hay indicadores activos configurados.</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </PageLayout>

  <FiltersModalAndroid
    bind:open={showFiltersModal}
    {isAndroidMobile} {isMobile}
    showAno={showAnoDropdown}
    bind:anos bind:colegios bind:grados bind:secciones
    bind:selectedAno bind:selectedColegio bind:selectedGrado bind:selectedSeccion bind:selectedSexo
  >
    {#snippet extras()}
      <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
        <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Corte:</label>
        <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
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
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
        <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Asignatura:</label>
        <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
          bind:value={selectedAsignatura} disabled={asignaturas.length === 0}>
          {#each asignaturas as a}<option value={a.id}>{a.nombre}</option>{/each}
        </select>
      </div>
    {/snippet}
  </FiltersModalAndroid>
</div>
