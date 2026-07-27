<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SearchInput from "./SearchInput.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; criterios: Criterio[]; }
  interface Estudiante { id: number; nombre: string; gradoId: number; seccionId: number; grado: string; seccion: string; }
  interface NotaEstudiante { estudianteId: number; estudianteNombre: string; notas: Record<number, number>; }

  let anos: CategoryItem[] = $state([]);
  let cortes: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let asignaturas: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);

  let selectedAno = $state(0);
  let selectedCorte = $state(0);
  let selectedColegio = $state(0);
  let selectedAsignatura = $state(Number(localStorage.getItem('notas-last-asignatura')) || 0);
  let selectedGrado = $state(Number(localStorage.getItem('notas-last-grado')) || 0);
  let selectedSeccion = $state(0);
  let selectedSexo = $state("");
  let searchTerm = $state("");

  let indicadores: Indicador[] = $state([]);
  let estudiantes: Estudiante[] = $state([]);
  let notas: NotaEstudiante[] = $state([]);
  let gradeConfigs: { id: string; nombre: string; color: string; minimo: number }[] = $state([]);
  let multiplicadores: { id: string; multiplicador: number }[] = $state([]);

  let loading = $state(false);
  let saving = $state(false);
  let hasUnsavedChanges = $state(false);
  let highlightColor = $state(localStorage.getItem('student-highlight-color') || '#4ade80');

  let showDeleteModal = $state(false);
  let deleteMode: 'all' | 'student' | 'indicator' = $state('all');
  let deleteStudentId = $state(0);
  let deleteIndicatorId = $state(0);
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);

  let showDistribuirModal = $state(false);
  let distribuirTargets: Record<number, string> = $state({});
  let distribuirOverwrite = $state(true);
  let distribuirInputs = new Map<number, HTMLInputElement>();

  function regDistInput(node: HTMLInputElement, id: number) {
    distribuirInputs.set(id, node);
    return { destroy() { distribuirInputs.delete(id); } };
  }

  let isMobile = $state(false);
  let currentStudentIdx = $state(0);
  let showStudentList = $state(false);

  let history: Record<string, string>[] = $state([]);
  let redoStack: Record<string, string>[] = $state([]);

  let rowVersionTick = $state(0);
  let refreshTrigger = $state(0);

  let notasCualitativas: Record<string, string> = $state({});
  let notasCuantitativas: Record<string, number> = {};
  let inputsRef = new Map<string, HTMLInputElement>();
  let cellSnapshot: Record<string, string> | null = null;
  let hasUnsavedRef = false;
  let pendingRefreshOnSave = $state(false);
  let nextRefreshSilent = false;
  let loadId = 0;
  let touchStartX = 0;
  let isUndoRedoAction = false;

  // Filters ref for async callbacks
  let filtersRef = { ano: 0, corte: 0, colegio: 0, asignatura: 0, grado: 0, seccion: 0, sexo: "" };

  // Derived
  let isQualitative = $derived.by(() => {
    const grado = grados.find(g => g.id === selectedGrado);
    const asignatura = asignaturas.find(a => a.id === selectedAsignatura);
    return (grado?.cualitativo === true) || (asignatura?.cualitativo === true);
  });

  let allowedQualitativeGrades = $derived(isQualitative
    ? ['AA', 'AS', 'AF']
    : ['AA', 'AS', 'AF', 'AI']
  );

  let allCriterios = $derived(indicadores.flatMap(ind => ind.criterios));
  let criterioIndexMap = $derived(new Map(allCriterios.map((c, i) => [c.id, i])));
  let totalColumns = $derived(allCriterios.length);
  let studentIndexMap = $derived(new Map(estudiantes.map((e, i) => [e.id, i])));
  let activeIndicadores = $derived(indicadores.filter(i => i.activo));

  let filteredNotas = $derived.by(() => {
    if (!searchTerm) return notas;
    const term = searchTerm.toLowerCase();
    return notas.filter(n => n.estudianteNombre.toLowerCase().includes(term));
  });

  let sortedGradeConfigs = $derived.by(() => {
    const defaultConfigs = [
      { id: 'AA', color: '#22c55e', minimo: 90 },
      { id: 'AS', color: '#6b7280', minimo: 70 },
      { id: 'AF', color: '#eab308', minimo: 50 },
      { id: 'AI', color: '#ef4444', minimo: 0 },
    ];
    const configs = gradeConfigs.length > 0 ? gradeConfigs : defaultConfigs;
    return [...configs].sort((a, b) => b.minimo - a.minimo);
  });

  // Constants
  let notaMapping = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const m of multiplicadores) map[m.id] = m.multiplicador;
    return map;
  });
  const qualitativeWeights: Record<string, number> = { AA: 4, AS: 3, AF: 2, AI: 1 };
  const reverseQualitativeWeights: Record<number, string> = { 4: 'AA', 3: 'AS', 2: 'AF', 1: 'AI' };

  // Helpers
  function getMidPctForGrade(grade: string): number {
    const sortedConfigs = [...(gradeConfigs.length > 0 ? gradeConfigs : [
      { id: 'AA', nombre: 'AA', color: '#22c55e', minimo: 90 },
      { id: 'AS', nombre: 'AS', color: '#6b7280', minimo: 70 },
      { id: 'AF', nombre: 'AF', color: '#eab308', minimo: 50 },
      { id: 'AI', nombre: 'AI', color: '#ef4444', minimo: 0 },
    ])].sort((a, b) => a.minimo - b.minimo);
    const idx = sortedConfigs.findIndex(c => c.id === grade);
    if (idx === -1) return 50;
    const min = sortedConfigs[idx].minimo;
    const nextMin = idx < sortedConfigs.length - 1 ? sortedConfigs[idx + 1].minimo : 101;
    return Math.round((min + (nextMin - 1)) / 2);
  }

  function getGradeFromScore(score: number) {
    const config = sortedGradeConfigs.find(c => score >= c.minimo);
    if (config) return config;
    if (isQualitative) return { id: 'AF', color: '#eab308', minimo: 0 };
    return { id: 'AI', color: '#ef4444', minimo: 0 };
  }

  function getGradeConfig(gradeValue: string) {
    const trimmedValue = gradeValue.trim().toUpperCase();
    const config = gradeConfigs.find(gc => gc.id === trimmedValue);
    return config || null;
  }

  function getGradeColor(value: string, maxScore?: number): string {
    if (!value) return '#94a3b8';
    const upperValue = value.trim().toUpperCase();
    if (['AA', 'AS', 'AF', 'AI'].includes(upperValue)) {
      const config = getGradeConfig(upperValue);
      if (config) return config.color;
      if (upperValue === 'AA') return '#22c55e';
      if (upperValue === 'AS') return '#6b7280';
      if (upperValue === 'AF') return '#eab308';
      if (upperValue === 'AI') return '#ef4444';
      return '#94a3b8';
    }
    if (maxScore !== undefined && !isNaN(parseFloat(value))) {
      const score = parseFloat(value);
      const normalizedScore = (score / maxScore) * 100;
      const config = getGradeFromScore(normalizedScore);
      return config ? config.color : '#94a3b8';
    }
    return '#94a3b8';
  }

  function calcularTotalIndicador(estudianteNotas: Record<number, number>, indicador: Indicador): number {
    return indicador.criterios.reduce((sum, criterio) => sum + (estudianteNotas[criterio.id] || 0), 0);
  }

  function calcularTotalFinal(estudianteNotas: Record<number, number>): number {
    if (isQualitative) return 0;
    return indicadores.filter(i => i.activo).reduce((sum, ind) => sum + calcularTotalIndicador(estudianteNotas, ind), 0);
  }

  function calcularPctActual(estudianteId: number): number {
    const maxTotal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
    if (maxTotal === 0) return 0;
    const rawTotal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => {
      const qv = notasCualitativas[`${estudianteId}-${c.id}`];
      if (qv && ['AA', 'AS', 'AF', 'AI'].includes(qv)) return s + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
      return s;
    }, 0), 0);
    return Math.round((rawTotal / maxTotal) * 100);
  }

  function calcularPctPreview(estudianteId: number, targetStr: string | undefined): number {
    if (!targetStr || targetStr.trim() === '') return calcularPctActual(estudianteId);
    let targetPct: number;
    if (isQualitative && ['AA', 'AS', 'AF', 'AI'].includes(targetStr.trim().toUpperCase())) {
      targetPct = getMidPctForGrade(targetStr.trim().toUpperCase());
    } else {
      targetPct = parseFloat(targetStr);
      if (isNaN(targetPct) || targetPct < 0) return calcularPctActual(estudianteId);
    }
    if (activeIndicadores.length === 0) return 0;
    const indInfos: { weight: number; c1: Criterio; c2: Criterio; c3: Criterio }[] = [];
    let maxTotal = 0;
    for (const ind of activeIndicadores) {
      const c1 = ind.criterios[0];
      const c2 = ind.criterios[1];
      const c3 = ind.criterios[2];
      if (!c1 || !c2 || !c3) continue;
      const w = c1.puntajeMaximo + c2.puntajeMaximo + c3.puntajeMaximo;
      maxTotal += w;
      indInfos.push({ weight: w, c1, c2, c3 });
    }
    if (maxTotal === 0) return 0;
    const grades = ['AA', 'AS', 'AF', 'AI'];
    const gs = (c: Criterio, g: string) => Math.round(c.puntajeMaximo * (notaMapping[g] || 0));
    const valCombos: [string, string, string][] = [];
    for (const g3 of grades) {
      const g3Idx = grades.indexOf(g3);
      for (const g1 of grades.slice(g3Idx)) {
        for (const g2 of grades.slice(g3Idx)) {
          valCombos.push([g1, g2, g3]);
        }
      }
    }
    const targetRaw = Math.round((Math.min(targetPct, 100) / 100) * maxTotal);
    let predictedTotal = 0;
    let runningError = 0;
    for (const ii of indInfos) {
      const { c1, c2, c3 } = ii;
      const indTarget = (ii.weight / maxTotal) * targetRaw + runningError;
      let bestCombo: [string, string, string] | null = null;
      let bestDiff = Infinity;
      for (const [g1, g2, g3] of valCombos) {
        const diff = Math.abs(gs(c1, g1) + gs(c2, g2) + gs(c3, g3) - indTarget);
        if (diff < bestDiff) { bestDiff = diff; bestCombo = [g1, g2, g3]; }
      }
      if (!bestCombo) continue;
      const [chosen1, chosen2, chosen3] = bestCombo;
      const actualTotal = gs(c1, chosen1) + gs(c2, chosen2) + gs(c3, chosen3);
      predictedTotal += actualTotal;
      runningError += indTarget - actualTotal;
    }
    return Math.round((predictedTotal / maxTotal) * 100);
  }

  function distribuirNotas() {
    if (activeIndicadores.length === 0 || filteredNotas.length === 0) return;
    const indInfos: { weight: number; c1: Criterio; c2: Criterio; c3: Criterio }[] = [];
    let maxTotal = 0;
    for (const ind of activeIndicadores) {
      const c1 = ind.criterios[0];
      const c2 = ind.criterios[1];
      const c3 = ind.criterios[2];
      if (!c1 || !c2 || !c3) continue;
      const w = c1.puntajeMaximo + c2.puntajeMaximo + c3.puntajeMaximo;
      maxTotal += w;
      indInfos.push({ weight: w, c1, c2, c3 });
    }
    if (maxTotal === 0) return;
    const grades = ['AA', 'AS', 'AF', 'AI'];
    const gs = (c: Criterio, g: string) => Math.round(c.puntajeMaximo * (notaMapping[g] || 0));
    const valCombos: [string, string, string][] = [];
    for (const g3 of grades) {
      const g3Idx = grades.indexOf(g3);
      for (const g1 of grades.slice(g3Idx)) {
        for (const g2 of grades.slice(g3Idx)) {
          valCombos.push([g1, g2, g3]);
        }
      }
    }
    let updatedCount = 0;
    let errorMessages: string[] = [];
    for (const estNota of filteredNotas) {
      const targetStr = distribuirTargets[estNota.estudianteId];
      if (!targetStr || targetStr.trim() === '') continue;
      if (isQualitative && ['AA', 'AS', 'AF', 'AI'].includes(targetStr.trim().toUpperCase())) {
        const grade = targetStr.trim().toUpperCase();
        for (const ii of indInfos) {
          const { c1, c2, c3 } = ii;
          const k1 = `${estNota.estudianteId}-${c1.id}`;
          const k2 = `${estNota.estudianteId}-${c2.id}`;
          const k3 = `${estNota.estudianteId}-${c3.id}`;
          if (distribuirOverwrite) {
            notasCualitativas[k1] = grade;
            notasCualitativas[k2] = grade;
            notasCualitativas[k3] = 'AA';
          } else {
            if (!notasCualitativas[k1]) notasCualitativas[k1] = grade;
            if (!notasCualitativas[k2]) notasCualitativas[k2] = grade;
            if (!notasCualitativas[k3]) notasCualitativas[k3] = 'AA';
          }
        }
        updatedCount++;
        continue;
      }
      const targetPct = parseFloat(targetStr);
      if (isNaN(targetPct) || targetPct < 0) continue;
      const targetRaw = Math.round((Math.min(targetPct, 100) / 100) * maxTotal);
      let runningError = 0;
      for (const ii of indInfos) {
        const { c1, c2, c3 } = ii;
        const indTarget = (ii.weight / maxTotal) * targetRaw + runningError;
        let bestCombo: [string, string, string] | null = null;
        let bestDiff = Infinity;
        for (const [g1, g2, g3] of valCombos) {
          const diff = Math.abs(gs(c1, g1) + gs(c2, g2) + gs(c3, g3) - indTarget);
          if (diff < bestDiff) { bestDiff = diff; bestCombo = [g1, g2, g3]; }
        }
        if (!bestCombo) continue;
        const [chosen1, chosen2, chosen3] = bestCombo;
        const actualTotal = gs(c1, chosen1) + gs(c2, chosen2) + gs(c3, chosen3);
        runningError += indTarget - actualTotal;
        const k1 = `${estNota.estudianteId}-${c1.id}`;
        const k2 = `${estNota.estudianteId}-${c2.id}`;
        const k3 = `${estNota.estudianteId}-${c3.id}`;
        if (distribuirOverwrite) {
          notasCualitativas[k1] = chosen1;
          notasCualitativas[k2] = chosen2;
          notasCualitativas[k3] = chosen3;
        } else {
          if (!notasCualitativas[k1]) notasCualitativas[k1] = chosen1;
          if (!notasCualitativas[k2]) notasCualitativas[k2] = chosen2;
          if (!notasCualitativas[k3]) notasCualitativas[k3] = chosen3;
        }
      }
      updatedCount++;
    }
    if (updatedCount > 0) {
      hasUnsavedChanges = true;
      hasUnsavedRef = true;
      emit("show-toast", { message: `✅ Notas distribuidas para ${updatedCount} estudiante(s)`, type: 'success' });
    }
    if (errorMessages.length > 0) {
      emit("show-toast", { message: errorMessages.join(' | '), type: 'warning' });
    }
    showDistribuirModal = false;
    distribuirTargets = {};
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

  // Undo/Redo
  function updateInputsUI(targetState: Record<string, string>) {
    notasCualitativas = { ...targetState };
    inputsRef.forEach((inputEl, inputKey) => {
      const parts = inputKey.split('-');
      if (parts.length === 4) {
        const estId = parseInt(parts[1]);
        const critIdx = parseInt(parts[3]);
        const criterio = allCriterios[critIdx];
        if (criterio) {
          const key = `${estId}-${criterio.id}`;
          const val = targetState[key] || '';
          if (inputEl.value !== val) inputEl.value = val;
        }
      }
    });
    rowVersionTick++;
  }

  function undo() {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const currentRedoStack = [{ ...notasCualitativas }, ...redoStack];
    redoStack = currentRedoStack;
    history = newHistory;
    isUndoRedoAction = true;
    updateInputsUI(previousState);
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => { ind.criterios.forEach(crit => {
        const key = `${est.id}-${crit.id}`;
        const qualValue = previousState[key] || '';
        let numValue = 0;
        if (['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
          const percentage = notaMapping[qualValue];
          numValue = crit.puntajeMaximo * percentage;
        }
        studentNotas[crit.id] = numValue;
      }); });
      return { estudianteId: est.id, estudianteNombre: est.nombre, notas: studentNotas };
    });
    notas = newNotas;
    hasUnsavedChanges = true;
  }

  function redo() {
    if (redoStack.length === 0) return;
    const nextState = redoStack[0];
    redoStack = redoStack.slice(1);
    history = [...history, { ...notasCualitativas }];
    isUndoRedoAction = true;
    updateInputsUI(nextState);
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => { ind.criterios.forEach(crit => {
        const key = `${est.id}-${crit.id}`;
        const qualValue = nextState[key] || '';
        let numValue = 0;
        if (['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
          const percentage = notaMapping[qualValue];
          numValue = crit.puntajeMaximo * percentage;
        }
        studentNotas[crit.id] = numValue;
      }); });
      return { estudianteId: est.id, estudianteNombre: est.nombre, notas: studentNotas };
    });
    notas = newNotas;
    hasUnsavedChanges = true;
  }

  // Input handlers
  function handleNotaChange(estudianteId: number, criterioId: number, value: string) {
    const normalizedValue = value.toUpperCase();
    if (normalizedValue.length > 2) return;
    if (normalizedValue !== '' && !/^[A-Z]*$/.test(normalizedValue)) return;
    const key = `${estudianteId}-${criterioId}`;
    notasCualitativas[key] = normalizedValue;
    const idx = criterioIndexMap.get(criterioId);
    const criterio = idx !== undefined ? allCriterios[idx] : undefined;
    if (!criterio) return;
    const finalNotes = ['AA', 'AS', 'AF', 'AI'];
    let numValue = 0;
    if (finalNotes.includes(normalizedValue)) {
      const percentage = notaMapping[normalizedValue];
      numValue = criterio.puntajeMaximo * percentage;
    } else if (normalizedValue === 'A') {
      numValue = 0;
    }
    notasCuantitativas[key] = Math.round(numValue);
    if (!hasUnsavedRef) { hasUnsavedRef = true; hasUnsavedChanges = true; }
  }

  function handleInputFocus() {
    if (!cellSnapshot) cellSnapshot = { ...notasCualitativas };
  }

  function handleInputBlur(estudianteId: number, criterioId: number, value: string) {
    if (!cellSnapshot) return;
    const key = `${estudianteId}-${criterioId}`;
    const oldValue = cellSnapshot[key] || '';
    const newValue = value.toUpperCase();
    if (oldValue !== newValue) {
      const newSnapshot = { ...cellSnapshot };
      const newHistory = [...history, newSnapshot];
      if (newHistory.length > 50) newHistory.shift();
      history = newHistory;
      redoStack = [];
      if (!hasUnsavedRef) { hasUnsavedRef = true; hasUnsavedChanges = true; }
    }
    cellSnapshot = null;
  }

  // Keyboard navigation
  function handleKeyDown(e: KeyboardEvent, estudianteId: number, criterioIndex: number) {
    const rowIndex = studentIndexMap.get(estudianteId);
    if (rowIndex === undefined) return;
    let nextRow = rowIndex;
    let nextCol = criterioIndex;
    if (isQualitative && /^[aAsSfFiI]$/.test(e.key)) {
      const currentCriterio = allCriterios[criterioIndex];
      if (currentCriterio) {
        const key = `${estudianteId}-${currentCriterio.id}`;
        const currentVal = (notasCualitativas[key] || '').toUpperCase();
        if (currentVal.length >= 2) handleNotaChange(estudianteId, currentCriterio.id, '');
      }
      return;
    }
    switch (e.key) {
      case 'Delete': case 'Backspace':
        e.preventDefault();
        const currentCriterio = allCriterios[criterioIndex];
        if (currentCriterio) {
          const key = `${estudianteId}-${currentCriterio.id}`;
          notasCualitativas[key] = '';
          (e.target as HTMLInputElement).value = '';
          handleNotaChange(estudianteId, currentCriterio.id, '');
        }
        return;
      case 'ArrowRight': if (criterioIndex < totalColumns - 1) nextCol++; break;
      case 'ArrowLeft': if (criterioIndex > 0) nextCol--; break;
      case 'ArrowDown': if (rowIndex < estudiantes.length - 1) nextRow++; break;
      case 'ArrowUp': if (rowIndex > 0) nextRow--; break;
      default: return;
    }
    e.preventDefault();
    const nextEstudiante = estudiantes[nextRow];
    if (!nextEstudiante) return;
    const nextCriterio = allCriterios[nextCol];
    if (nextCriterio) {
      const key = `row-${nextEstudiante.id}-col-${nextCol}`;
      inputsRef.get(key)?.focus();
    }
  }

  // Navigation helpers
  function goPrevStudent() { currentStudentIdx = Math.max(0, currentStudentIdx - 1); }
  function goNextStudent() { currentStudentIdx = Math.min(filteredNotas.length - 1, currentStudentIdx + 1); }

  function handleTouchStart(e: TouchEvent) { touchStartX = e.touches[0].clientX; }
  function handleTouchEnd(e: TouchEvent) {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 50) { if (diff > 0) goPrevStudent(); else goNextStudent(); }
  }

  // CRUD operations
  async function fetchGradeConfigs() {
    try {
      const configs = await invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs");
      gradeConfigs = configs;
      refreshTrigger++;
    } catch (error) { console.error("[fetchGradeConfigs] Error:", error); }
  }

  async function fetchMultiplicadores() {
    try {
      const data = await invoke<{ id: string; multiplicador: number }[]>("get_multiplicadores");
      multiplicadores = data;
    } catch (error) { console.error("[fetchMultiplicadores] Error:", error); }
  }

  async function fetchCatalogs() {
    try {
      const [anosData, cortesData, colegiosData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_cortes"),
        invoke<CategoryItem[]>("get_colegios"),
      ]);
      const activeAno = anosData.find(a => a.activo)?.id || (anosData.length > 0 ? anosData[0].id : 0);
      const activeCorte = cortesData.find(c => c.activo)?.id || (cortesData.length > 0 ? cortesData[0].id : 0);
      const activeColegio = colegiosData.find(c => c.activo)?.id || (colegiosData.length > 0 ? colegiosData[0].id : 0);
      anos = anosData;
      cortes = cortesData;
      colegios = colegiosData;
      if (!selectedAno) selectedAno = activeAno;
      if (!selectedCorte) selectedCorte = activeCorte;
      if (!selectedColegio) selectedColegio = activeColegio;
    } catch (error) { console.error("Error fetching catalogs:", error); }
  }

  async function fetchGradosYAsignaturas() {
    try {
      const [gradosData, asignaturasData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: selectedColegio, anoLectivoId: selectedAno }),
        invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: selectedColegio }),
      ]);
      grados = gradosData;
      const firstGradoId = gradosData.length > 0 ? gradosData[0].id : 0;
      if (gradosData.length > 0) selectedGrado = firstGradoId; else selectedGrado = 0;
      let filteredAsignaturas = asignaturasData;
      if (firstGradoId > 0) {
        try {
          const subjectsByGrade = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: firstGradoId });
          if (subjectsByGrade.length > 0) filteredAsignaturas = subjectsByGrade.filter(sg => asignaturasData.some(ca => ca.id === sg.id));
        } catch (e) { console.log("Comando get_subjects_by_grade no disponible, usando globales"); }
      }
      const sortedAsignaturas = [...filteredAsignaturas].sort((a, b) => a.nombre.localeCompare(b.nombre));
      asignaturas = sortedAsignaturas;
      if (sortedAsignaturas.length > 0) selectedAsignatura = sortedAsignaturas[0].id;
      else {
        selectedAsignatura = 0;
        await emit("show-toast", { message: `⚠️ El colegio ${colegios.find(c => c.id === selectedColegio)?.nombre} no tiene asignaturas asignadas.`, type: 'warning' });
      }
    } catch (error) { console.error("Error fetching grados y asignaturas:", error); }
  }

  async function fetchSecciones() {
    try {
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", {
        gradoId: selectedGrado, colegioId: selectedColegio, anoLectivoId: selectedAno
      });
      secciones = data;
      if (data.length > 0) {
        const stillExists = data.some(s => s.id === selectedSeccion);
        if (!stillExists) selectedSeccion = data[0].id;
      } else selectedSeccion = 0;
      loadNotas(selectedAno, selectedCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion);
    } catch (error) { console.error("Error fetching secciones:", error); }
  }

  async function fetchConfiguracionEvaluacion(silent = false): Promise<Indicador[]> {
    const isActuallySilent = silent || nextRefreshSilent;
    if (!isActuallySilent) loading = true;
    const { corte, asignatura, grado } = filtersRef;
    try {
      const data = await invoke<Indicador[]>("get_evaluation_config", { gradoId: grado, asignaturaId: asignatura, corteEvaluativoId: corte });
      indicadores = data;
      return data;
    } catch (error) {
      console.error("Error fetching evaluation config:", error);
      if (!silent) await emit("show-toast", { message: "❌ Error al cargar configuración de evaluación: " + error, type: 'error' });
      return [];
    } finally { if (!silent) loading = false; }
  }

  async function fetchEstudiantes(currentIndicadores?: Indicador[], silent = false, preFetchedData?: { estudiantes: Estudiante[]; notas: { estudianteId: number; criterioId: number; valor: number }[] }) {
    const isActuallySilent = silent || nextRefreshSilent;
    if (!isActuallySilent) loading = true;
    nextRefreshSilent = false;
    const indToUse = currentIndicadores || indicadores;
    const { corte, asignatura, grado, seccion, sexo } = filtersRef;
    notasCuantitativas = {};
    try {
      const [dataRaw, notasGuardadas] = preFetchedData
        ? [preFetchedData.estudiantes, preFetchedData.notas]
        : await Promise.all([
            invoke<Estudiante[]>("get_estudiantes_by_filters", { gradoId: grado, seccionId: seccion }),
            invoke<{ estudianteId: number; criterioId: number; valor: number }[]>("get_notas_by_filters", { gradoId: grado, seccionId: seccion, corteId: corte, asignaturaId: asignatura })
          ]);
      const data = sexo ? dataRaw.filter(est => (est as any).sexo === sexo) : dataRaw;
      estudiantes = data;
      const notasMap: Record<string, string> = {};
      const cuantitativasMap: Record<number, Record<number, number>> = {};
      data.forEach(est => { cuantitativasMap[est.id] = {}; });
      notasGuardadas.forEach(n => {
        const key = `${n.estudianteId}-${n.criterioId}`;
        const criterio = indToUse.flatMap(ind => ind.criterios).find(c => c.id === n.criterioId);
        if (criterio) {
          const candidates = [
            { grade: 'AA', saved: Math.round(criterio.puntajeMaximo * (notaMapping.AA || 1.0)) },
            { grade: 'AS', saved: Math.round(criterio.puntajeMaximo * (notaMapping.AS || 0.85)) },
            { grade: 'AF', saved: Math.round(criterio.puntajeMaximo * (notaMapping.AF || 0.65)) },
            { grade: 'AI', saved: Math.round(criterio.puntajeMaximo * (notaMapping.AI || 0.40)) },
          ];
          const match = candidates.find(c => c.saved === n.valor);
          let qualValue = match ? match.grade : "";
          if (!qualValue) {
            const ratio = n.valor / criterio.puntajeMaximo;
            if (ratio >= 0.90) qualValue = "AA";
            else if (ratio >= 0.70) qualValue = "AS";
            else if (ratio >= 0.50) qualValue = "AF";
            else if (ratio >= 0.30) qualValue = "AI";
          }
          if (qualValue) notasMap[key] = qualValue;
        }
        if (cuantitativasMap[n.estudianteId]) cuantitativasMap[n.estudianteId][n.criterioId] = n.valor;
      });
      if (isActuallySilent) { history = []; redoStack = []; hasUnsavedChanges = false; hasUnsavedRef = false; }
      notas = data.map(est => ({
        estudianteId: est.id,
        estudianteNombre: est.nombre,
        notas: cuantitativasMap[est.id] || {}
      }));
      notasCualitativas = { ...notasMap };
      if (isActuallySilent) {
        setTimeout(() => {
          allCriterios.forEach((criterio, critIdx) => {
            data.forEach(est => {
              const key = `${est.id}-${criterio.id}`;
              const inputKey = `row-${est.id}-col-${critIdx}`;
              const inputEl = inputsRef.get(inputKey);
              if (inputEl) {
                const val = notasMap[key] || '';
                if (inputEl.value !== val) inputEl.value = val;
              }
            });
          });
          rowVersionTick++;
        }, 100);
      }
    } catch (error) {
      console.error("Error fetching estudiantes:", error);
      if (!silent) await emit("show-toast", { message: "❌ Error al cargar estudiantes: " + error, type: 'error' });
    } finally { if (!silent) loading = false; }
  }

  // Save
  async function handleGuardarNotas() {
    if (notas.length === 0) { await emit("show-toast", { message: "⚠️ No hay estudiantes para guardar notas", type: 'info' }); return; }
    const saveCorteId = selectedCorte;
    const saveAsignaturaId = selectedAsignatura;
    const notasActualizadas = notas.map(notaEst => {
      const updatedNotas: Record<number, number> = { ...notaEst.notas };
      indicadores.forEach(ind => { ind.criterios.forEach(crit => {
        const key = `${notaEst.estudianteId}-${crit.id}`;
        const qualValue = notasCualitativas[key];
        if (qualValue && ['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
          const percentage = notaMapping[qualValue];
          updatedNotas[crit.id] = Math.round(crit.puntajeMaximo * percentage);
        } else {
          const refValue = notasCuantitativas[key];
          if (refValue !== undefined) updatedNotas[crit.id] = refValue;
        }
      }); });
      return { ...notaEst, notas: updatedNotas };
    });
    const hasIncomplete = Object.values(notasCualitativas).some(v => v === 'A');
    if (hasIncomplete) {
      await emit("show-toast", { message: "⚠️ Hay notas incompletas (solo 'A'). Por favor complételas (AA, AS, AF, AI) o bórrelas antes de guardar.", type: 'error' });
      return;
    }
    for (const notaEst of notasActualizadas) {
      for (const indicador of indicadores) {
        if (!indicador.activo) continue;
        if (isQualitative) continue;
        const totalIndicador = calcularTotalIndicador(notaEst.notas, indicador);
        if (totalIndicador > 20) {
          await emit("show-toast", { message: `⚠️ El estudiante ${notaEst.estudianteNombre} tiene ${totalIndicador} pts en el Indicador ${indicador.orden} (máximo 20)`, type: 'error' });
          return;
        }
      }
    }
    saving = true;
    try {
      const notasParaGuardar = notasActualizadas.map(notaEst => ({
        estudianteId: notaEst.estudianteId,
        notas: Object.entries(notaEst.notas).map(([criterioId, valor]) => ({ criterioId: parseInt(criterioId), valor }))
      }));
      await invoke("save_notas_estudiantes", { notas: notasParaGuardar, corteId: saveCorteId, asignaturaId: saveAsignaturaId });
      history = [];
      redoStack = [];
      hasUnsavedRef = false;
      hasUnsavedChanges = false;
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; nextRefreshSilent = true; refreshTrigger++; }
      saving = false;
      await emit("show-toast", { message: "✅ Notas guardadas localmente", type: "success" });
      onDataChange('nota');
      setTimeout(() => fetchEstudiantes(undefined, true), 200);
    } catch (error) {
      console.error("Error saving notes:", error);
      await emit("show-toast", { message: "❌ Error al guardar notas: " + error, type: "error" });
      saving = false;
    }
  }

  // Delete
  async function handleDeleteNotas() {
    try {
      deleting = true;
      const delCorteId = selectedCorte;
      const delAsignaturaId = selectedAsignatura;
      await invoke<number>("delete_notas", {
        corteEvaluativoId: delCorteId,
        asignaturaId: delAsignaturaId,
        estudianteId: deleteMode === 'student' ? deleteStudentId : 0,
        criterioId: deleteMode === 'indicator' ? deleteIndicatorId : 0,
      });
      showDeleteModal = false;
      showDeleteConfirm = false;
      await emit("show-toast", { message: `✅ Notas eliminadas`, type: "success" });
      history = [];
      redoStack = [];
      hasUnsavedChanges = false;
      hasUnsavedRef = false;
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; nextRefreshSilent = true; refreshTrigger++; }
      onDataChange('nota');
      setTimeout(() => fetchEstudiantes(undefined, true), 200);
    } catch (error) {
      console.error("Error deleting notas:", error);
      await emit("show-toast", { message: "❌ Error al eliminar notas: " + error, type: "error" });
    } finally { deleting = false; }
  }

  function openDeleteConfirm() {
    if (deleteMode === 'student' && !deleteStudentId) { emit("show-toast", { message: "⚠️ Seleccione un estudiante", type: "warning" }); return; }
    if (deleteMode === 'indicator' && !deleteIndicatorId) { emit("show-toast", { message: "⚠️ Seleccione un indicador", type: "warning" }); return; }
    showDeleteConfirm = true;
  }

  function registerInput(node: HTMLInputElement, key: string) {
    inputsRef.set(key, node);
    return { destroy() { inputsRef.delete(key); } };
  }

  // Effects
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty('--highlight-color', highlightColor);
    const hex = highlightColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    root.style.setProperty('--highlight-bg', `rgba(${r}, ${g}, ${b}, 0.2)`);
  });

  $effect(() => {
    filtersRef = { ano: selectedAno, corte: selectedCorte, colegio: selectedColegio, asignatura: selectedAsignatura, grado: selectedGrado, seccion: selectedSeccion, sexo: selectedSexo };
  });

  $effect(() => {
    currentStudentIdx = 0;
  });

  $effect(() => {
    if (selectedColegio && selectedAno) {
      grados = [];
      asignaturas = [];
      secciones = [];
      selectedGrado = 0;
      selectedSeccion = 0;
      selectedAsignatura = 0;
      estudiantes = [];
      notas = [];
      fetchGradosYAsignaturas();
    } else {
      grados = [];
      asignaturas = [];
      selectedGrado = 0;
      selectedAsignatura = 0;
    }
  });

  $effect(() => {
    if (selectedGrado && selectedColegio && selectedAno) fetchSecciones();
    else { secciones = []; selectedSeccion = 0; }
  });

  async function loadNotas(ano: number, corte: number, colegio: number, asignatura: number, grado: number, seccion: number) {
    if (!(ano > 0 && corte > 0 && colegio > 0 && asignatura > 0 && grado > 0 && seccion > 0)) return;
    const currentLoadId = ++loadId;
    loading = true;
    try {
      const [currentIndicadores, estudiantesData, notasData] = await Promise.all([
        fetchConfiguracionEvaluacion(true),
        invoke<Estudiante[]>("get_estudiantes_by_filters", { gradoId: grado, seccionId: seccion }),
        invoke<{ estudianteId: number; criterioId: number; valor: number }[]>("get_notas_by_filters", { gradoId: grado, seccionId: seccion, corteId: corte, asignaturaId: asignatura })
      ]);
      if (currentLoadId !== loadId) return;
      await fetchEstudiantes(currentIndicadores, true, { estudiantes: estudiantesData, notas: notasData });
      if (currentLoadId !== loadId) return;
      history = [];
      redoStack = [];
    } catch (error) {
      console.error("Error loading data:", error);
      if (currentLoadId === loadId) await emit("show-toast", { message: "❌ Error al cargar datos: " + error, type: 'error' });
    } finally { if (currentLoadId === loadId) loading = false; }
  }

  $effect(() => {
    const ano = selectedAno;
    const corte = selectedCorte;
    const colegio = selectedColegio;
    const asignatura = selectedAsignatura;
    const grado = selectedGrado;
    const seccion = selectedSeccion;
    if (ano > 0 && corte > 0 && colegio > 0 && asignatura > 0 && grado > 0 && seccion > 0) {
      loadNotas(ano, corte, colegio, asignatura, grado, seccion);
    } else {
      estudiantes = [];
      notas = [];
    }
  });

  $effect(() => {
    if (refreshTrigger > 0 && !hasUnsavedRef && selectedAno > 0 && selectedCorte > 0 && selectedColegio > 0 && selectedAsignatura > 0 && selectedGrado > 0 && selectedSeccion > 0) {
      refreshTrigger = 0;
      fetchEstudiantes(undefined, true);
    }
  });

  onMount(() => {
    fetchGradeConfigs();
    fetchMultiplicadores();
    fetchCatalogs();

    const checkMobile = () => { isMobile = window.innerWidth <= 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const lockOrientation = async () => {
      try {
        if (window.innerWidth <= 768 && screen.orientation && ('lock' in screen.orientation)) {
          // @ts-ignore
          await screen.orientation.lock("landscape");
        }
      } catch (err) { console.warn("No se pudo bloquear la orientación:", err); }
    };
    lockOrientation();

    // Keyboard shortcuts
    const handleKeyDownGlobal = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
      else if (e.ctrlKey && e.key === 'g') { e.preventDefault(); handleGuardarNotas(); }
    };
    window.addEventListener('keydown', handleKeyDownGlobal);

    // Event listeners
    let studentTimeout: ReturnType<typeof setTimeout>;
    let notasTimeout: ReturnType<typeof setTimeout>;
    let catalogTimeout: ReturnType<typeof setTimeout>;

    const u1 = listen("student-updated", () => {
      if (hasUnsavedRef) { pendingRefreshOnSave = true; return; }
      clearTimeout(studentTimeout);
      studentTimeout = setTimeout(() => { nextRefreshSilent = true; refreshTrigger++; }, 500);
    });

    const u2 = listen("notas-updated", () => {
      if (hasUnsavedRef) { pendingRefreshOnSave = true; return; }
      clearTimeout(notasTimeout);
      notasTimeout = setTimeout(() => { nextRefreshSilent = true; refreshTrigger++; }, 500);
    });

    const u3 = listen("catalog-updated", () => {
      if (hasUnsavedRef) { pendingRefreshOnSave = true; return; }
      clearTimeout(catalogTimeout);
      catalogTimeout = setTimeout(() => {
        nextRefreshSilent = true;
        refreshTrigger++;
      }, 500);
    });

    // Grade config listener
    const u4 = listen("grade-configs-updated", () => fetchGradeConfigs());
    const u5 = listen("highlight-color-updated", (event: any) => { highlightColor = event.payload; });
    const u6 = listen("indicadores-updated", async () => {
      const newInd = await fetchConfiguracionEvaluacion(true);
      await fetchEstudiantes(newInd, true);
    });

    const onSync = () => {
      if (hasUnsavedRef) return;
      clearTimeout(notasTimeout);
      notasTimeout = setTimeout(() => { nextRefreshSilent = true; refreshTrigger++; }, 300);
    };
    window.addEventListener('schooltracker-sync', onSync);

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('keydown', handleKeyDownGlobal);
      window.removeEventListener('schooltracker-sync', onSync);
      try {
        if (screen.orientation && ('unlock' in screen.orientation)) {
          // @ts-ignore
          screen.orientation.unlock();
        }
      } catch (err) { console.warn("No se pudo desbloquear la orientación:", err); }
      u1.then(f => f());
      u2.then(f => f());
      u3.then(f => f());
      u4.then(f => f());
      u5.then(f => f());
      u6.then(f => f());
    };
  });
</script>

<div class="page-container" style="height: 100%; min-height: 0;">
  <div class="category-grid" style="display: block;">
    <FilterContainer {isMobile}>
      <FilterGroup label="Año Lectivo:" {isMobile}>
        <select class="filter-select" style="width:100%" bind:value={selectedAno}>
          {#each anos as a}
            <option value={a.id}>{a.nombre}</option>
          {/each}
        </select>
      </FilterGroup>

      <FilterGroup label="Corte:" {isMobile}>
        <select class="filter-select" style="width:100%" bind:value={selectedCorte}>
          {#each cortes as c}
            <option value={c.id}>{c.nombre}</option>
          {/each}
        </select>
      </FilterGroup>

      <FilterGroup label="Colegio:" {isMobile}>
        <select class="filter-select" style="width:100%" bind:value={selectedColegio}>
          {#each colegios as col}
            <option value={col.id}>{col.nombre}</option>
          {/each}
        </select>
      </FilterGroup>

      <FilterGroup label="Grado:" {isMobile}>
        <select class="filter-select" style="width:100%"
          value={selectedGrado}
          onchange={(e) => { selectedGrado = Number(e.target.value); localStorage.setItem('notas-last-grado', String(selectedGrado)); }}>
          {#each grados as g}
            <option value={g.id}>{g.nombre}</option>
          {/each}
        </select>
      </FilterGroup>

      <FilterGroup label="Sección:" {isMobile}>
        <select class="filter-select" style="width:100%" bind:value={selectedSeccion}>
          {#each secciones as s}
            <option value={s.id}>{s.nombre}</option>
          {/each}
        </select>
      </FilterGroup>

      <FilterGroup label="Sexo:" {isMobile}>
        <select class="filter-select" style="width:100%" bind:value={selectedSexo}>
          <option value="">Todos</option>
          <option value="M">Masculino</option>
          <option value="F">Femenino</option>
        </select>
      </FilterGroup>

      <FilterGroup label="Asignatura:" {isMobile}>
        <select class="filter-select" style="width:100%"
          value={selectedAsignatura}
          onchange={(e) => { selectedAsignatura = Number(e.target.value); localStorage.setItem('notas-last-asignatura', String(selectedAsignatura)); }}>
          {#each asignaturas as a}
            <option value={a.id}>{a.nombre}</option>
          {/each}
        </select>
      </FilterGroup>

        <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '1 1 auto'}">
          <div style="flex:1;min-width:100px">
            <SearchInput value={searchTerm} onChange={(v) => searchTerm = v} placeholder="Buscar..." {isMobile} height="42px" />
          </div>
          <button onclick={undo} disabled={history.length === 0}
            style="height:42px;padding:0 1rem;font-size:0.85rem;background-color:{history.length > 0 ? '#f59e0b' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{history.length > 0 ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{history.length > 0 ? '0 4px 14px rgba(245,158,11,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{history.length > 0 ? 1 : 0.7}"
            title="Deshacer (Ctrl+Z)">
            <span>↩️</span>
            {#if !isMobile}<span>Deshacer</span>{/if}
          </button>
          <button onclick={redo} disabled={redoStack.length === 0}
            style="height:42px;padding:0 1rem;font-size:0.85rem;background-color:{redoStack.length > 0 ? '#f59e0b' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{redoStack.length > 0 ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{redoStack.length > 0 ? '0 4px 14px rgba(245,158,11,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{redoStack.length > 0 ? 1 : 0.7}"
            title="Rehacer (Ctrl+Y)">
            <span>↪️</span>
            {#if !isMobile}<span>Rehacer</span>{/if}
          </button>
          <button onclick={() => { distribuirTargets = {}; distribuirOverwrite = true; showDistribuirModal = true; }} disabled={activeIndicadores.length === 0 || filteredNotas.length === 0}
            style="height:42px;padding:0 1rem;font-size:0.85rem;background-color:{activeIndicadores.length > 0 && filteredNotas.length > 0 ? '#8b5cf6' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{activeIndicadores.length > 0 && filteredNotas.length > 0 ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{activeIndicadores.length > 0 && filteredNotas.length > 0 ? '0 4px 14px rgba(139,92,246,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{activeIndicadores.length > 0 && filteredNotas.length > 0 ? 1 : 0.7}"
            title="Distribuir notas automáticamente">
            <span>✨</span>
            {#if !isMobile}<span>Distribuir</span>{/if}
          </button>
          <button onclick={handleGuardarNotas} disabled={!hasUnsavedChanges || saving || estudiantes.length === 0}
            style="height:42px;padding:0 1rem;font-size:0.85rem;background-color:{!hasUnsavedChanges ? 'rgba(148,163,184,0.5)' : (saving ? '#059669' : '#10b981')};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{(!hasUnsavedChanges || saving || estudiantes.length === 0) ? 'default' : 'pointer'};transition:all 0.3s ease;box-shadow:{hasUnsavedChanges && !saving && estudiantes.length > 0 ? '0 4px 14px rgba(16,185,129,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{(hasUnsavedChanges && !saving && estudiantes.length > 0) ? 1 : 0.7}"
            title="Guardar Notas (Ctrl+G)">
            <span>{saving ? '⏳' : '💾'}</span>
            {#if !isMobile}<span>{saving ? 'Guardando...' : (hasUnsavedChanges ? 'Guardar' : 'Sin cambios')}</span>{/if}
          </button>
          <button onclick={() => {
            if (!selectedCorte || !selectedAsignatura) { emit("show-toast", { message: "⚠️ Seleccione un corte y asignatura primero", type: "warning" }); return; }
            deleteMode = 'all'; deleteStudentId = 0; deleteIndicatorId = 0; showDeleteModal = true;
          }} disabled={estudiantes.length === 0}
            style="height:42px;padding:0 1rem;font-size:0.85rem;background-color:{estudiantes.length > 0 ? '#ef4444' : 'rgba(148,163,184,0.5)'};color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{estudiantes.length > 0 ? 'pointer' : 'default'};transition:all 0.3s ease;box-shadow:{estudiantes.length > 0 ? '0 4px 14px rgba(239,68,68,0.4)' : 'none'};flex-shrink:0;white-space:nowrap;opacity:{estudiantes.length > 0 ? 1 : 0.7}"
            title="Eliminar notas">
            <span>🗑️</span>
            {#if !isMobile}<span>Eliminar</span>{/if}
          </button>
        </div>
    </FilterContainer>

    {#if loading}
      <div style="text-align: center; padding: {isMobile ? '0.5rem' : '2rem'}; font-size: {isMobile ? '0.75rem' : '1rem'};">Cargando datos...</div>
    {/if}

    <!-- Mobile: Card View -->
    {#if isMobile && !loading && estudiantes.length > 0}
      <div class="category-card" style="flex: 1; min-height: 0; width: 100%; max-width: 100%; overflow: hidden; display: flex; flex-direction: column; padding: 0.3rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem; margin-bottom: 0.3rem; background: rgba(15, 23, 42, 0.6); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); user-select: none;">
          <button onclick={goPrevStudent} disabled={currentStudentIdx === 0}
            style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: {currentStudentIdx === 0 ? '#475569' : '#e2e8f0'}; border-radius: 10px; padding: 0.5rem 0.7rem; font-size: 1.1rem; cursor: {currentStudentIdx === 0 ? 'not-allowed' : 'pointer'}; opacity: {currentStudentIdx === 0 ? 0.4 : 1}; display: flex; align-items: center; justify-content: center; min-width: 40px;">◀</button>
          <div style="flex: 1; text-align: center; min-width: 0; padding: 0 0.5rem; cursor: pointer;" onclick={() => showStudentList = true}>
            <div style="font-weight: bold; font-size: 0.95rem; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              {filteredNotas[currentStudentIdx]?.estudianteNombre || ''}
            </div>
            <div style="font-size: 0.7rem; color: #64748b; margin-top: 2px;">
              {currentStudentIdx + 1} de {filteredNotas.length} — tap para lista
            </div>
          </div>
          <button onclick={goNextStudent} disabled={currentStudentIdx >= filteredNotas.length - 1}
            style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: {currentStudentIdx >= filteredNotas.length - 1 ? '#475569' : '#e2e8f0'}; border-radius: 10px; padding: 0.5rem 0.7rem; font-size: 1.1rem; cursor: {currentStudentIdx >= filteredNotas.length - 1 ? 'not-allowed' : 'pointer'}; opacity: {currentStudentIdx >= filteredNotas.length - 1 ? 0.4 : 1}; display: flex; align-items: center; justify-content: center; min-width: 40px;">▶</button>
        </div>

        <div style="flex: 1; overflow: auto; padding: 0 0.15rem; -webkit-overflow-scrolling: touch;"
          ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
          {#if filteredNotas[currentStudentIdx]}
            {@const est = filteredNotas[currentStudentIdx]}
            <div>
              {#each activeIndicadores as ind}
                    <div style="margin-bottom: 0.5rem; border-radius: 12px; border: 1px solid rgba(var(--primary-rgb), 0.25); background: rgba(30, 41, 59, 0.5); overflow: hidden;">
                  <div style="padding: 0.4rem 0.6rem; background: rgba(var(--primary-rgb), 0.1); border-bottom: 1px solid rgba(var(--primary-rgb), 0.15); display: flex; justify-content: space-between; align-items: center;">
                    <div style="color: var(--text-secondary); font-weight: bold; font-size: 0.8rem;">Indicador {ind.orden}</div>
                    <div style="color: {(() => {
                      const totalInd = ind.criterios.reduce((sum, c) => {
                        const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                        if (qv && ['AA','AS','AF','AI'].includes(qv)) return sum + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                        return sum;
                      }, 0);
                      const maxInd = ind.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0);
                      const esc = maxInd > 0 ? (totalInd / maxInd) * 100 : 0;
                      const qualGrade = isQualitative ? calcularNotaCualitativaFinal(ind.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')) : (getGradeFromScore(esc)?.id || 'AI');
                      return qualGrade ? getGradeColor(qualGrade) : '#94a3b8';
                    })()}; font-weight: bold; font-size: 0.75rem;">
                      {(() => {
                        const totalInd = ind.criterios.reduce((sum, c) => {
                          const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                          if (qv && ['AA','AS','AF','AI'].includes(qv)) return sum + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                          return sum;
                        }, 0);
                        const maxInd = ind.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0);
                        const esc = maxInd > 0 ? (totalInd / maxInd) * 100 : 0;
                        const qualGrade = isQualitative ? calcularNotaCualitativaFinal(ind.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')) : (getGradeFromScore(esc)?.id || 'AI');
                        return isQualitative ? qualGrade : `${Math.round(totalInd)} (${qualGrade})`;
                      })()}
                    </div>
                  </div>
                  {#each ind.criterios as crit}
                    <div style="padding: 0.4rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.04); display: flex; flex-direction: column;">
                      <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 0.3rem; display: flex; justify-content: space-between;">
                        <span>Criterio {crit.orden}{crit.descripcion ? ': ' + crit.descripcion : ''}</span>
                        {#if !isQualitative}<span style="color: #4ade80;">máx {crit.puntajeMaximo}</span>{/if}
                      </div>
                      <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        {#each allowedQualitativeGrades as grade}
                          {@const currentKey = `${est.estudianteId}-${crit.id}`}
                          {@const currentVal = notasCualitativas[currentKey] || ''}
                          {@const isSelected = currentVal === grade}
                          {@const gradeColor = getGradeColor(grade)}
                          <button
                            onclick={() => {
                              if (!cellSnapshot) cellSnapshot = { ...notasCualitativas };
                              handleNotaChange(est.estudianteId, crit.id, isSelected ? '' : grade);
                              const oldVal = cellSnapshot[currentKey] || '';
                              const newVal = isSelected ? '' : grade;
                              if (oldVal !== newVal) {
                                const snap = { ...cellSnapshot };
                                const newHist = [...history, snap];
                                if (newHist.length > 50) newHist.shift();
                                history = newHist;
                                redoStack = [];
                              }
                              cellSnapshot = null;
                              rowVersionTick++;
                            }}
                            style="flex: 1; min-width: 52px; padding: 0.5rem 0.3rem; border-radius: 8px; border: 2px solid {gradeColor}; background: {isSelected ? gradeColor : 'transparent'}; color: {isSelected ? '#fff' : gradeColor}; font-weight: bold; font-size: 0.8rem; cursor: pointer; text-align: center; transition: all 0.15s ease;"
                          >{grade}</button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {/each}

              <!-- Nota final -->
              <div style="margin-top: 0.5rem; padding: 0.6rem; border-radius: 12px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(34, 197, 94, 0.3); display: flex; justify-content: space-between; align-items: center;">
                <div style="color: #94a3b8; font-weight: bold; font-size: 0.85rem;">Nota Final</div>
                <div style="color: {(() => {
                  const rawFinal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => {
                    const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                    if (qv && ['AA','AS','AF','AI'].includes(qv)) return s + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                    return s;
                  }, 0), 0);
                  const maxTotal = activeIndicadores.reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
                  const escFinal = maxTotal > 0 ? (rawFinal / maxTotal) * 100 : 0;
                  const qualFinal = isQualitative ? calcularNotaCualitativaFinal(activeIndicadores.map(i => calcularNotaCualitativaFinal(i.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')))) : (getGradeFromScore(escFinal)?.id || 'AI');
                  return qualFinal ? getGradeColor(qualFinal) : '#94a3b8';
                })()}; font-weight: bold; font-size: 1.1rem;">
                  {(() => {
                    const rawFinal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => {
                      const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                      if (qv && ['AA','AS','AF','AI'].includes(qv)) return s + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                      return s;
                    }, 0), 0);
                    const maxTotal = activeIndicadores.reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
                    const escFinal = maxTotal > 0 ? (rawFinal / maxTotal) * 100 : 0;
                    const qualFinal = isQualitative ? calcularNotaCualitativaFinal(activeIndicadores.map(i => calcularNotaCualitativaFinal(i.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')))) : (getGradeFromScore(escFinal)?.id || 'AI');
                    return qualFinal;
                  })()}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Mobile: Student List Modal -->
    {#if isMobile && showStudentList}
      <div style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: flex-end; justify-content: center;">
        <div onclick={() => showStudentList = false} style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"></div>
        <div style="position: relative; background: linear-gradient(180deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.99)); border: 1px solid rgba(255,255,255,0.08); border-bottom: none; border-radius: 20px 20px 0 0; width: 100%; max-height: 70vh; display: flex; flex-direction: column; box-shadow: 0 -10px 40px rgba(0,0,0,0.5);">
          <div style="padding: 1rem 1rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
            <div>
              <div style="color: #f1f5f9; font-weight: bold; font-size: 1rem;">Estudiantes</div>
              <div style="color: #64748b; font-size: 0.75rem;">{filteredNotas.length} estudiantes</div>
            </div>
            <button onclick={() => showStudentList = false} style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; border-radius: 10px; padding: 0.3rem 0.7rem; font-size: 0.85rem; cursor: pointer;">✕</button>
          </div>
          <div style="flex: 1; overflow: auto; padding: 0.3rem 0; -webkit-overflow-scrolling: touch;">
            {#each filteredNotas as est, idx}
              {@const isCurrent = idx === currentStudentIdx}
              {@const rawFinal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => {
                const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                if (qv && ['AA','AS','AF','AI'].includes(qv)) return s + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                return s;
              }, 0), 0)}
              {@const maxTotal = activeIndicadores.reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0)}
              {@const escFinal = maxTotal > 0 ? (rawFinal / maxTotal) * 100 : 0}
              {@const grade = getGradeFromScore(escFinal)?.id || ''}
              {@const color = grade ? getGradeColor(grade) : '#64748b'}
              <div onclick={() => { currentStudentIdx = idx; showStudentList = false; }}
                style="display: flex; align-items: center; gap: 0.6rem; padding: 0.7rem 1rem; background: {isCurrent ? 'rgba(var(--primary-rgb), 0.1)' : 'transparent'}; border-bottom: 1px solid rgba(255,255,255,0.03); cursor: pointer; transition: background 0.1s;">
                <div style="width: 28px; height: 28px; border-radius: 50%; background: {isCurrent ? '#6366f1' : 'rgba(255,255,255,0.06)'}; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.75rem; color: {isCurrent ? '#fff' : '#94a3b8'}; flex-shrink: 0;">{idx + 1}</div>
                <div style="flex: 1; font-weight: {isCurrent ? 'bold' : 'normal'}; font-size: 0.85rem; color: {isCurrent ? '#e2e8f0' : '#cbd5e1'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{est.estudianteNombre}</div>
                {#if grade}
                  <div style="color: {color}; font-weight: bold; font-size: 0.85rem;">{grade}</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Desktop: Table View -->
    {#if !isMobile && !loading && estudiantes.length > 0}
      <div class="category-card" style="flex: 1; min-height: 0; width: 100%; max-width: 100%; overflow: hidden; display: flex; flex-direction: column; padding: 0.75rem;">
        <div class="category-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-shrink: 0;">
          <h3 style="margin: 0; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;">
            📝 Estudiantes <span style="opacity: 0.7; font-size: 0.8em;">({filteredNotas.length})</span>
          </h3>
          <div style="font-size: 0.9rem; color: #94a3b8; display: flex; align-items: center; gap: 0.2rem;">
            <span>Indicadores Activos:</span>
            <span style="font-weight: bold; color: #fff;">{activeIndicadores.length}/5</span>
          </div>
        </div>

        <div class="notas-table-container" style="flex: 1; min-height: 0; overflow: auto; padding: 0; width: 100%; max-width: 100%; -webkit-overflow-scrolling: touch; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
          <table class="notas-table" style="width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; font-size: 0.7rem;">
            <thead style="position: sticky; top: 0; z-index: 100;">
              <tr style="background: #1e293b;">
                <th style="padding: 0.3rem; text-align: center; font-weight: bold; color: #94a3b8; position: sticky; left: 0; z-index: 110; background: #1e293b; border-bottom: 2px solid rgba(255,255,255,0.1); width: 35px;">Nº</th>
                <th style="padding: 0.3rem; text-align: left; font-weight: bold; color: #94a3b8; position: sticky; left: 35px; z-index: 110; background: #1e293b; border-bottom: 2px solid rgba(255,255,255,0.1); min-width: 130px; max-width: 150px;">Estudiante</th>
                {#each activeIndicadores as ind}
                  <th colspan={ind.criterios.length + 1} style="padding: 0.2rem; text-align: center; font-weight: bold; border-bottom: 2px solid rgba(255,255,255,0.1);">
                    <div title={ind.descripcion} style="background: rgba(var(--primary-rgb), 0.15); padding: 0.2rem; border-radius: 4px; border: 1px solid rgba(var(--primary-rgb), 0.4); color: var(--text-secondary); cursor: help;">
                      <div style="font-weight: bold; font-size: 0.7rem;">Ind. {ind.orden}</div>
                    </div>
                  </th>
                {/each}
                <th style="padding: 0.3rem; text-align: center; font-weight: bold; color: #4ade80; background: #1e293b; border-bottom: 2px solid rgba(34, 197, 94, 0.4); position: sticky; right: 0; z-index: 110; width: 60px;">
                  <div style="font-weight: bold; font-size: 0.7rem;">Final</div>
                  <div style="font-size: 0.55rem; color: #94a3b8;">{isQualitative ? 'Cual.' : '100'}</div>
                </th>
              </tr>
              <tr style="background: #1e293b;">
                <th style="position: sticky; left: 0; z-index: 110; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.1);"></th>
                <th style="position: sticky; left: 35px; z-index: 110; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.1);"></th>
                {#each activeIndicadores as ind}
                  {#each ind.criterios as crit}
                    <th title={crit.descripcion} style="padding: 0.2rem; text-align: center; color: #94a3b8; font-size: 0.65rem; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: help;">
                      <div style="font-weight: bold;">C{crit.orden}</div>
                      {#if !isQualitative}<div style="font-size: 0.55rem; color: #4ade80;">{crit.puntajeMaximo}</div>{/if}
                    </th>
                  {/each}
                  <th style="padding: 0.2rem; text-align: center; color: #94a3b8; font-weight: bold; background: rgba(var(--primary-rgb), 0.08); border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="color: #4ade80; font-size: 0.65rem;">{isQualitative ? 'Cual.' : 'Tot'}</div>
                  </th>
                {/each}
                <th style="padding: 0.2rem; text-align: center; color: #94a3b8; font-weight: bold; background: #1e293b; position: sticky; right: 0; z-index: 110; border-bottom: 1px solid rgba(34, 197, 94, 0.4);">
                  <div style="color: #4ade80; font-size: 0.65rem;">{isQualitative ? 'Cual.' : 'Tot'}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {#each filteredNotas as est, index}
                <tr class="notas-row" style="border-bottom: 2px solid rgba(255,255,255,0.08);">
                  <td class="sticky-cell student-number" style="padding: 0.3rem; text-align: center; position: sticky; left: 0; z-index: 5; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.65rem;">{index + 1}</td>
                  <td class="sticky-cell student-name" style="padding: 0.3rem; position: sticky; left: 35px; z-index: 5; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="font-weight: bold; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;">{est.estudianteNombre}</div>
                  </td>
                  {#each activeIndicadores as ind}
                    {#each ind.criterios as crit}
                      {@const criterioIndex = criterioIndexMap.get(crit.id) ?? 0}
                      {@const inputKey = `row-${est.estudianteId}-col-${criterioIndex}`}
                      {@const key = `${est.estudianteId}-${crit.id}`}
                      {@const currentQualitativeValue = notasCualitativas[key] || ''}
                      <td style="padding: 0.15rem; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <input
                          type="text"
                          value={currentQualitativeValue}
                          oninput={(e) => {
                            if (!hasUnsavedRef) { hasUnsavedRef = true; hasUnsavedChanges = true; }
                            let rawVal = (e.target as HTMLInputElement).value.toUpperCase();
                            const val = rawVal.slice(0, 2);
                            const firstChar = val.charAt(0);
                            const isValidFirstChar = firstChar === '' || firstChar === 'A';
                            if (!isValidFirstChar) {
                              (e.target as HTMLInputElement).value = '';
                              notasCualitativas[key] = '';
                              (e.target as HTMLInputElement).style.borderColor = '#ef4444';
                              (e.target as HTMLInputElement).style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                              setTimeout(() => { (e.target as HTMLInputElement).style.borderColor = ''; (e.target as HTMLInputElement).style.backgroundColor = ''; }, 1000);
                              return;
                            }
                            const secondChar = val.charAt(1);
                            const isValidSecondChar = secondChar === '' || ['A', 'S', 'F', 'I'].includes(secondChar);
                            if (!isValidSecondChar) {
                              (e.target as HTMLInputElement).value = val.charAt(0);
                              notasCualitativas[key] = val.charAt(0);
                              (e.target as HTMLInputElement).style.borderColor = '#ef4444';
                              (e.target as HTMLInputElement).style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                              setTimeout(() => { (e.target as HTMLInputElement).style.borderColor = ''; (e.target as HTMLInputElement).style.backgroundColor = ''; }, 1000);
                            } else {
                              notasCualitativas[key] = val;
                              (e.target as HTMLInputElement).value = val;
                            }
                            rowVersionTick++;
                          }}
                          onkeydown={(e) => handleKeyDown(e, est.estudianteId, criterioIndex)}
                          onfocus={(e) => {
                            handleInputFocus();
                            (e.target as HTMLInputElement).select();
                          }}
                          onblur={(e) => {
                            const val = (e.target as HTMLInputElement).value.toUpperCase();
                            const isValid = val === '' || ['AA', 'AS', 'AF', 'AI'].includes(val);
                            if (!isValid) {
                              (e.target as HTMLInputElement).value = '';
                              notasCualitativas[key] = '';
                              handleInputBlur(est.estudianteId, crit.id, '');
                            } else {
                              notasCualitativas[key] = val;
                              handleInputBlur(est.estudianteId, crit.id, val);
                            }
                          }}
                          use:registerInput={inputKey}
                          style="width: 48px; padding: 0.15rem; font-size: {isQualitative ? '0.85rem' : '0.75rem'}; text-align: center; background: {isQualitative ? 'rgba(139, 92, 246, 0.1)' : 'rgba(255,255,255,0.03)'}; border: 2px solid {currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : (isQualitative ? 'rgba(139, 92, 256, 0.4)' : 'rgba(255,255,255,0.1)')}; border-radius: 4px; color: {currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : (isQualitative ? '#a78bfa' : 'white')}; text-transform: uppercase; font-weight: {currentQualitativeValue ? 'bold' : 'normal'}; outline: none;"
                          maxlength={2}
                        />
                      </td>
                    {/each}
                    <td style="padding: 0.2rem; text-align: center; font-weight: bold; background: {ind.activo ? 'rgba(var(--primary-rgb), 0.05)' : 'rgba(100, 116, 139, 0.08)'}; border-bottom: 1px solid rgba(255,255,255,0.05);">
                      {#each [ind] as indicador}
                        {@const totalIndicador = indicador.criterios.reduce((sum, c) => {
                          const qualValue = notasCualitativas[`${est.estudianteId}-${c.id}`];
                          if (qualValue && ['AA','AS','AF','AI'].includes(qualValue)) return sum + Math.round(c.puntajeMaximo * (notaMapping[qualValue] || 0));
                          return sum;
                        }, 0)}
                        {@const totalIndicadorRedondeado = Math.round(totalIndicador)}
                        {@const maximoIndicador = indicador.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0)}
                        {@const totalEscalado = maximoIndicador > 0 ? (totalIndicador / maximoIndicador) * 100 : 0}
                        {@const gradeConfig = getGradeFromScore(totalEscalado)}
                        {@const qualitativeGrade = isQualitative ? calcularNotaCualitativaFinal(indicador.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')) : (gradeConfig?.id || 'AI')}
                        {@const displayColor = indicador.activo ? (qualitativeGrade ? getGradeColor(qualitativeGrade) : '#94a3b8') : '#64748b'}
                        <div style="color: {displayColor}; font-size: 0.75rem; font-weight: bold;">
                          {isQualitative ? qualitativeGrade : `${totalIndicadorRedondeado}${qualitativeGrade ? ` (${qualitativeGrade})` : ''}`}
                        </div>
                      {/each}
                    </td>
                  {/each}
                  <td style="padding: 0.2rem; text-align: center; font-weight: bold; background: #1e293b; position: sticky; right: 0; z-index: 5; border-bottom: 1px solid rgba(34, 197, 94, 0.2); white-space: nowrap; min-width: 50px;">
                    {#each [{ id: 0 }]}
                      {@const rawTotalFinal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => {
                        const qualValue = notasCualitativas[`${est.estudianteId}-${c.id}`];
                        if (qualValue && ['AA','AS','AF','AI'].includes(qualValue)) return s + Math.round(c.puntajeMaximo * (notaMapping[qualValue] || 0));
                        return s;
                      }, 0), 0)}
                      {@const totalFinal = Math.round(rawTotalFinal)}
                      {@const maximoTotal = activeIndicadores.reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0)}
                      {@const totalEscaladoFinal = maximoTotal > 0 ? (rawTotalFinal / maximoTotal) * 100 : 0}
                      {@const gradeConfig = getGradeFromScore(totalEscaladoFinal)}
                      {@const qualitativeFinal = isQualitative ? calcularNotaCualitativaFinal(activeIndicadores.map(i => calcularNotaCualitativaFinal(i.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')))) : (gradeConfig?.id || 'AI')}
                      {@const displayColor = qualitativeFinal ? getGradeColor(qualitativeFinal) : '#94a3b8'}
                      <div style="color: {displayColor}; font-size: 0.8rem; font-weight: bold; padding: 0.15rem 0.3rem; border-radius: 4px; display: inline-block;">
                        {isQualitative ? qualitativeFinal : `${totalFinal}${qualitativeFinal ? ` (${qualitativeFinal})` : ''}`}
                      </div>
                    {/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <!-- Empty States -->
    {#if !loading}
      {#if estudiantes.length > 0 && filteredNotas.length === 0}
        <div style="text-align: center; padding: 5rem 2rem; border: 2px dashed rgba(255, 255, 255, 0.1); border-radius: 16px; margin: 1rem 0;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🔍</div>
          <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">No se encontraron resultados</h4>
          <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">No se encontró ningún estudiante que coincida con "{searchTerm}"</p>
          <button class="secondary" onclick={() => searchTerm = ""} style="margin-top: 1.5rem; padding: 0.5rem 1rem;">Limpiar búsqueda</button>
        </div>
      {:else if estudiantes.length === 0 && selectedGrado > 0 && selectedSeccion > 0}
        <div style="text-align: center; padding: 5rem 2rem; border: 2px dashed rgba(255, 255, 255, 0.1); border-radius: 16px; margin: 1rem 0;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">👥</div>
          <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">No hay estudiantes para mostrar</h4>
          <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">
            No hay estudiantes registrados para {grados.find(g => g.id === selectedGrado)?.nombre} - {secciones.find(s => s.id === selectedSeccion)?.nombre}.
            Por favor, registre estudiantes en la sección de Estudiantes.
          </p>
        </div>
      {:else if !selectedGrado || !selectedSeccion}
        <div style="text-align: center; padding: 5rem 2rem; border: 2px dashed rgba(255, 255, 255, 0.1); border-radius: 16px; margin: 1rem 0;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
          <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">Seleccione los filtros</h4>
          <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">
            Seleccione un año, corte, colegio, asignatura, grado y sección para ver y calificar a los estudiantes.
          </p>
        </div>
      {/if}
    {/if}

    <!-- Distribuir Modal -->
    {#if showDistribuirModal}
      <div style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div onclick={() => showDistribuirModal = false} style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"></div>
        <div style="position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 20px; padding: 1.5rem; max-width: 640px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.6);">
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
            <div style="width: 44px; height: 44px; border-radius: 14px; background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.2); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;">✨</div>
            <div>
              <h3 style="margin: 0; color: #f1f5f9; font-size: 1.15rem; font-weight: 700;">Distribuir notas automáticamente</h3>
               <p style="margin: 0.2rem 0 0; color: #94a3b8; font-size: 0.75rem;">{isQualitative ? 'C1 y C2 = nota objetivo, C3 = AA. Solo AA, AS, AF disponibles.' : 'Ingrese el porcentaje total deseado (0-100). C1/2/3 se calculan automáticamente.'}</p>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0 0.75rem;">
            <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.8rem; color: #cbd5e1;">
              <input type="checkbox" checked={distribuirOverwrite} onchange={() => distribuirOverwrite = !distribuirOverwrite} style="accent-color: #8b5cf6;" />
              Sobrescribir notas existentes
            </label>
            <span style="color: #64748b; font-size: 0.75rem;">|</span>
            <span style="color: {distribuirOverwrite ? '#64748b' : '#22c55e'}; font-size: 0.75rem;">{distribuirOverwrite ? 'Se reemplazarán todas las notas' : 'Solo se llenarán criterios vacíos'}</span>
          </div>
          <div style="overflow: auto; flex: 1; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
              <thead>
                <tr style="position: sticky; top: 0; z-index: 1;">
                  <th style="text-align: left; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">#</th>
                  <th style="text-align: left; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">Estudiante</th>
                  <th style="text-align: center; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">Actual</th>
                  {#if isQualitative}
                    <th style="text-align: center; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">Meta</th>
                  {/if}
                  <th style="text-align: center; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #a78bfa; font-weight: 600; border-bottom: 1px solid rgba(139,92,246,0.15);">→ Resultante</th>
                  <th style="text-align: center; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">{isQualitative ? 'Nota objetivo' : 'Nuevo total (0-100)'}</th>
                </tr>
              </thead>
              <tbody>
                {#each filteredNotas as est, idx}
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 0.3rem 0.6rem; color: #64748b; text-align: left;">{idx + 1}</td>
                    <td style="padding: 0.3rem 0.6rem; color: #e2e8f0; font-weight: 500;">{est.estudianteNombre}</td>
                    <td style="padding: 0.3rem 0.6rem; text-align: center; white-space: nowrap;">
                      {#if isQualitative}
                        {@const pctActual = calcularPctActual(est.estudianteId)}
                        {@const gradeActual = getGradeFromScore(pctActual)?.id || ''}
                        <span style="color: {gradeActual ? getGradeColor(gradeActual) : '#94a3b8'}; font-weight: 600;">{gradeActual}</span>
                        <span style="font-size:0.7rem;color:#64748b;margin-left:2px;">({pctActual}%)</span>
                      {:else}
                        {@const pctActual = calcularPctActual(est.estudianteId)}
                        {@const gradeActual = getGradeFromScore(pctActual)?.id || ''}
                        <span style="color: {gradeActual ? getGradeColor(gradeActual) : '#94a3b8'}; font-weight: 600;">{pctActual}%</span>
                      {/if}
                    </td>
                    {#if isQualitative}
                      <td style="padding: 0.3rem 0.6rem; text-align: center; color: #94a3b8; font-weight: 600;">
                        {#if distribuirTargets[est.estudianteId] && ['AA','AS','AF','AI'].includes(distribuirTargets[est.estudianteId]!.trim().toUpperCase())}
                          {getMidPctForGrade(distribuirTargets[est.estudianteId]!.trim().toUpperCase())}%
                        {:else}
                          -
                        {/if}
                      </td>
                    {/if}
                    <td style="padding: 0.3rem 0.6rem; text-align: center; font-weight: 600; white-space: nowrap;">
                      {#if isQualitative && distribuirTargets[est.estudianteId] && ['AA','AS','AF','AI'].includes(distribuirTargets[est.estudianteId]!.trim().toUpperCase())}
                        {@const pctPrev = calcularPctPreview(est.estudianteId, distribuirTargets[est.estudianteId])}
                        {@const gradePrev = getGradeFromScore(pctPrev)?.id || ''}
                        <span style="color: {gradePrev ? getGradeColor(gradePrev) : '#a78bfa'}">{gradePrev}</span>
                        <span style="font-size:0.7rem;color:#64748b;margin-left:2px;">({pctPrev}%)</span>
                      {:else}
                        {@const pctPrev = calcularPctPreview(est.estudianteId, distribuirTargets[est.estudianteId])}
                        {@const gradePrev = getGradeFromScore(pctPrev)?.id || ''}
                        <span style="color: {gradePrev ? getGradeColor(gradePrev) : '#a78bfa'}">{pctPrev}%</span>
                      {/if}
                    </td>
                    <td style="padding: 0.15rem 0.3rem; text-align: center;">
                      {#if isQualitative}
                        <div style="display:flex;gap:3px;justify-content:center;flex-wrap:nowrap">
                           {#each allowedQualitativeGrades as grade}
                             {@const isSelected = distribuirTargets[est.estudianteId]?.trim().toUpperCase() === grade}
                            {@const gradeColor = getGradeColor(grade)}
                            <button
                              onclick={() => {
                                distribuirTargets[est.estudianteId] = isSelected ? '' : grade;
                                distribuirTargets = distribuirTargets;
                              }}
                              style="width:36px;padding:0.2rem 0;border-radius:6px;border:2px solid {gradeColor};background:{isSelected ? gradeColor : 'transparent'};color:{isSelected ? '#fff' : gradeColor};font-weight:bold;font-size:0.72rem;cursor:pointer;text-align:center;transition:all 0.15s ease;"
                            >{grade}</button>
                          {/each}
                        </div>
                      {:else}
                        <input type="number" min="0" max="100" value={distribuirTargets[est.estudianteId] ?? ''}
                          use:regDistInput={est.estudianteId}
                          oninput={(e) => { const v = (e.target as HTMLInputElement).value; distribuirTargets[est.estudianteId] = v; distribuirTargets = distribuirTargets; }}
                          onkeydown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const dir = e.key === 'ArrowUp' ? -1 : 1; const next = filteredNotas[idx + dir]; if (next) distribuirInputs.get(next.estudianteId)?.focus(); } }}
                          style="width:65px;padding:0.25rem 0.4rem;border-radius:6px;border:1px solid rgba(139,92,246,0.3);background:rgba(15,23,42,0.6);color:#e2e8f0;font-size:0.8rem;text-align:center;outline:none;" />
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div style="display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
            <button onclick={() => showDistribuirModal = false}
              style="padding: 0.5rem 1rem; border-radius: 10px; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-weight: 600; font-size: 0.82rem; cursor: pointer;">Cancelar</button>
            <button onclick={distribuirNotas}
              style="padding: 0.5rem 1.2rem; border-radius: 10px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border: none; color: white; font-weight: 700; font-size: 0.82rem; cursor: pointer; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);">
              ✨ Aplicar
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Delete Modal -->
    {#if showDeleteModal}
      <div style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div onclick={() => showDeleteModal = false} style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"></div>
        <div style="position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 20px; padding: 2rem; max-width: 520px; width: 100%; box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05);">
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem;">
            <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.2); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">🗑️</div>
            <div>
              <h3 style="margin: 0; color: #f1f5f9; font-size: 1.2rem; font-weight: 700;">Eliminar Notas</h3>
              <p style="margin: 0.25rem 0 0; color: #94a3b8; font-size: 0.8rem;">Esta acción no se puede deshacer</p>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem;">
            <!-- Option: Todas -->
            <div onclick={() => deleteMode = 'all'}
              style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; padding: 0.85rem 1rem; border-radius: 12px; background: {deleteMode === 'all' ? 'rgba(239, 68, 68, 0.08)' : 'transparent'}; border: {deleteMode === 'all' ? '1.5px solid rgba(239, 68, 68, 0.4)' : '1.5px solid rgba(255,255,255,0.06)'}; transition: all 0.2s ease;">
              <div style="width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; border: {deleteMode === 'all' ? '6px solid #ef4444' : '2px solid rgba(255,255,255,0.2)'}; background: {deleteMode === 'all' ? '#ef4444' : 'transparent'};"></div>
              <div>
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">Todas las notas mostradas</div>
                <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">Elimina todas las notas del corte y asignatura actuales</div>
              </div>
            </div>

            <!-- Option: Por estudiante -->
            <div onclick={() => { deleteMode = 'student'; deleteStudentId = 0; }}
              style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; padding: 0.85rem 1rem; border-radius: 12px; background: {deleteMode === 'student' ? 'rgba(var(--primary-rgb), 0.08)' : 'transparent'}; border: {deleteMode === 'student' ? '1.5px solid rgba(var(--primary-rgb), 0.4)' : '1.5px solid rgba(255,255,255,0.06)'};">
              <div style="width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; border: {deleteMode === 'student' ? '6px solid var(--primary-color)' : '2px solid rgba(255,255,255,0.2)'}; background: {deleteMode === 'student' ? 'var(--primary-color)' : 'transparent'};"></div>
              <div style="flex: 1;">
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">Por estudiante</div>
                <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">Elimina todas las notas de un estudiante específico</div>
                {#if deleteMode === 'student'}
                  <select value={deleteStudentId} onchange={(e) => deleteStudentId = Number(e.target.value)} onclick={(e) => e.stopPropagation()}
                    style="width: 100%; margin-top: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 0.82rem; cursor: pointer; outline: none;">
                    <option value={0}>Seleccione estudiante...</option>
                    {#each filteredNotas as n}
                      <option value={n.estudianteId}>{n.estudianteNombre}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            </div>

            <!-- Option: Por indicador -->
            <div onclick={() => { deleteMode = 'indicator'; deleteIndicatorId = 0; }}
              style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; padding: 0.85rem 1rem; border-radius: 12px; background: {deleteMode === 'indicator' ? 'rgba(245, 158, 11, 0.08)' : 'transparent'}; border: {deleteMode === 'indicator' ? '1.5px solid rgba(245, 158, 11, 0.4)' : '1.5px solid rgba(255,255,255,0.06)'};">
              <div style="width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; border: {deleteMode === 'indicator' ? '6px solid #f59e0b' : '2px solid rgba(255,255,255,0.2)'}; background: {deleteMode === 'indicator' ? '#f59e0b' : 'transparent'};"></div>
              <div style="flex: 1;">
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">Por indicador</div>
                <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">Elimina todas las notas de un indicador específico</div>
                {#if deleteMode === 'indicator'}
                  <select value={deleteIndicatorId} onchange={(e) => deleteIndicatorId = Number(e.target.value)} onclick={(e) => e.stopPropagation()}
                    style="width: 100%; margin-top: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 0.82rem; cursor: pointer; outline: none;">
                    <option value={0}>Seleccione indicador...</option>
                    {#each indicadores.filter(i => i.activo) as ind}
                      <option value={ind.id}>Indicador {ind.orden}: {ind.descripcion || `Indicador ${ind.orden}`}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 1rem;">
            <button onclick={() => showDeleteModal = false}
              style="padding: 0.6rem 1.2rem; border-radius: 10px; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.15s ease;">Cancelar</button>
            <button onclick={openDeleteConfirm} disabled={deleting}
              style="padding: 0.6rem 1.4rem; border-radius: 10px; background: {deleting ? 'rgba(239, 68, 68, 0.5)' : 'linear-gradient(135deg, #ef4444, #dc2626)'}; border: none; color: white; font-weight: 700; font-size: 0.85rem; cursor: {deleting ? 'not-allowed' : 'pointer'}; transition: all 0.2s ease; box-shadow: {deleting ? 'none' : '0 4px 14px rgba(239, 68, 68, 0.35)'};">
              {deleting ? 'Eliminando...' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <ConfirmDialog
      isOpen={showDeleteConfirm}
      title="🗑️ Confirmar eliminación"
      message={deleteMode === 'all' ? '¿Está seguro de eliminar TODAS las notas mostradas para este corte y asignatura? Esta acción no se puede deshacer.' : deleteMode === 'student' ? `¿Está seguro de eliminar todas las notas de "${filteredNotas.find(n => n.estudianteId === deleteStudentId)?.estudianteNombre || ''}" para este corte y asignatura?` : `¿Está seguro de eliminar todas las notas del ${indicadores.find(i => i.id === deleteIndicatorId) ? `Indicador ${indicadores.find(i => i.id === deleteIndicatorId)!.orden}` : 'indicador seleccionado'} para este corte y asignatura?`}
      confirmText="Sí, eliminar"
      cancelText="Cancelar"
      variant="danger"
      onConfirm={handleDeleteNotas}
      onCancel={() => showDeleteConfirm = false}
    />
  </div>
</div>
