<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { loadAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import FilterContainer from "./FilterContainer.svelte";
  import BotonMod from "./BotonMod.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SelectChip from "./SelectChip.svelte";
  import SearchFab from "./SearchFab.svelte";
  import FiltersModalAndroid from "./FiltersModalAndroid.svelte";
  import { generarInstrumentoPDF, generarInstrumentosTodosPDF, INSTRUMENTO_OPS, type InstrumentoInput, type InstrumentoTipo } from "../lib/instrumentosPdf";
  import { generarInstrumentoExcel, listarPlantillas, asegurarCarpetaPlantillas, abrirCarpetaPlantillas, plantillasDir, type ExcelInstrumentoInput } from "../lib/instrumentosExcel";
  import { readFile } from "@tauri-apps/plugin-fs";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { registerBackHandler } from "../lib/androidBack";

  // Visible = la página contenedora está activa Y este es el sub-tab seleccionado.
  let { visible = true }: { visible?: boolean } = $props();

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; instrumento: string; criterios: Criterio[]; }
  interface Estudiante { id: number; nombre: string; gradoId: number; seccionId: number; grado: string; seccion: string; }
  interface NotaEstudiante { estudianteId: number; estudianteNombre: string; notas: Record<number, number>; }
  /** Primeras 3 letras distribuibles de un indicador (C1, C2, C3) y su peso. */
  interface IndDist { weight: number; c1: Criterio; c2: Criterio; c3: Criterio; }

  let anos: CategoryItem[] = $state([]);
  let cortes: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let asignaturas: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);

  let selectedAno = $state(0);
  let showAnoDropdown = $state(localStorage.getItem('stp_show_ano_dropdown') !== 'false');
  let selectedCorte = $state(0);
  let selectedColegio = $state(0);
  let selectedAsignatura = $state(Number(localStorage.getItem('notas-last-asignatura')) || 0);
  let selectedGrado = $state(Number(localStorage.getItem('notas-last-grado')) || 0);
  let selectedSeccion = $state(0);
  let selectedSexo = $state("");
  let searchTerm = $state("");

  let indicadores: Indicador[] = $state([]);
  /**
   * Indicadores tal como los ve la SECCION actual: `activo` ya viene resuelto
   * (excepción de la sección si existe, si no el global). Todo el template y los
   * cálculos de notas leen este derivado, así que el cambio por sección es
   * automático en la tabla, los totales, la distribución y el guardado.
   */
  let indicadoresSeccion = $derived.by(() => {
    if (idsActivosSeccion === null) return indicadores;
    return indicadores.map(i => i.activo === idsActivos.includes(i.id) ? i : { ...i, activo: idsActivos.includes(i.id) });
  });
  let estudiantes: Estudiante[] = $state([]);
  let notas: NotaEstudiante[] = $state([]);
  let gradeConfigs: { id: string; nombre: string; color: string; minimo: number }[] = $state([]);
  let multiplicadores: { id: string; multiplicador: number }[] = $state([]);

  let loading = $state(false);
  let saving = $state(false);
  let highlightColor = $state(localStorage.getItem('student-highlight-color') || '#4ade80');

  let showDeleteModal = $state(false);
  let deleteMode: 'all' | 'student' | 'indicator' = $state('all');
  let deleteStudentId = $state(0);
  let deleteIndicatorId = $state(0);
  let deleting = $state(false);

  let showDistribuirModal = $state(false);

  // ── Comparación con cortes previos (solo lectura, dentro del modal de distribuir) ──
  // Global: al activarlo se añade una columna por cada corte anterior, en la misma fila.
  let mostrarComparacion = $state(true);
  let comparacionCortes = $state<Record<number, Record<number, number | null>>>({});
  let cargandoComparacion = $state(false);

  /** Cortes anteriores al seleccionado, en orden de creación (id ascendente). */
  let cortesPrecios = $derived.by(() => {
    const ordenados = [...cortes].sort((a, b) => a.id - b.id);
    const idx = ordenados.findIndex(c => c.id === selectedCorte);
    return idx <= 0 ? [] : ordenados.slice(0, idx);
  });

  function colorPctAnterior(pct: number | null): string {
    if (pct === null) return '#64748b';
    return getGradeColor(getGradeFromScore(pct)?.id || '');
  }

  /** Etiqueta corta para la cabecera de columna: "1er corte evaluativo" -> "1er". */
  function nombreCortoCorte(nombre: string): string {
    const n = nombre.trim();
    const m = n.match(/^(\S+)\s+corte\b/i) || n.match(/^corte\s+(\S+)/i);
    return m ? m[1] : n;
  }

  let corteActualNombre = $derived(cortes.find(c => c.id === selectedCorte)?.nombre || 'Corte actual');

  /** Chips de contexto del header del modal: colegio, grado, sección y asignatura (con el color de acento de cada categoría). */
  let contextoChips = $derived([
    { icon: '🏫', color: '#34d399', titulo: 'Colegio', label: colegios.find(c => c.id === selectedColegio)?.nombre || '' },
    { icon: '📊', color: '#fb923c', titulo: 'Grado', label: grados.find(g => g.id === selectedGrado)?.nombre || '' },
    { icon: '👥', color: '#a78bfa', titulo: 'Sección', label: secciones.find(s => s.id === selectedSeccion)?.nombre || '' },
    { icon: '📚', color: '#60a5fa', titulo: 'Asignatura', label: asignaturas.find(a => a.id === selectedAsignatura)?.nombre || '' },
  ]);

  /**
   * Carga la nota final (%) de cada estudiante en los cortes anteriores al actual.
   * Usa `get_pcts_por_corte`, que es SOLO LECTURA: no siembra indicadores ni
   * configuración (a diferencia de `get_evaluation_config`, que sí lo hace).
   */
  async function cargarComparacionCortes() {
    const previas = cortesPrecios;
    comparacionCortes = {};
    if (previas.length === 0 || selectedGrado === 0) return;
    cargandoComparacion = true;
    try {
      const filas = await invoke<{ corteId: number; estudianteId: number; pct: number }[]>(
        'get_pcts_por_corte',
        {
          gradoId: selectedGrado,
          seccionId: selectedSeccion,
          asignaturaId: selectedAsignatura,
          cortesIds: previas.map(c => c.id),
        }
      );
      const mapa: Record<number, Record<number, number | null>> = {};
      for (const c of previas) mapa[c.id] = {};
      for (const f of filas) {
        if (!mapa[f.corteId]) mapa[f.corteId] = {};
        mapa[f.corteId][f.estudianteId] = f.pct;
      }
      comparacionCortes = mapa;
    } catch (e) {
      console.error('[Comparación cortes] Error cargando cortes anteriores:', e);
      await emit('show-toast', { message: '❌ No se pudieron cargar las notas de cortes anteriores: ' + (e instanceof Error ? e.message : String(e)), type: 'error' });
    } finally { cargandoComparacion = false; }
  }

  // El histórico se carga al activar la comparación (perezoso), no al abrir el modal
  $effect(() => {
    if (!showDistribuirModal || !mostrarComparacion) return;
    untrack(() => void cargarComparacionCortes());
  });

  // ── Instrumentos de evaluación ──
  let showInstrumentosModal = $state(false);
  let generatingPdf = $state(false);
  let excelGenerating = $state(false);
  let mostrarAyudaExcel = $state(false);

  // Plantillas .xlsx en la carpeta fija Documents/SchoolTrackerPro/Plantillas
  // El nombre del archivo clasifica el tipo: debe contener Rubrica/Cotejo/Escala
  let plantillas = $state<{ nombre: string; ruta: string; tipo: InstrumentoTipo }[]>([]);
  let plantillaSel = $state(''); // '' = AUTO según el tipo del indicador
  let cargandoPlantillas = $state(false);

  async function recargarPlantillas() {
    cargandoPlantillas = true;
    try {
      await asegurarCarpetaPlantillas();
      plantillas = await listarPlantillas();
      if (!plantillas.some(p => p.nombre === plantillaSel)) {
        plantillaSel = '';
      }
    } finally { cargandoPlantillas = false; }
  }

  async function abrirCarpetaDePlantillas() {
    await abrirCarpetaPlantillas();
    setTimeout(() => void recargarPlantillas(), 800);
  }

  // Al abrir el modal: cargar lista de plantillas de la carpeta fija
  $effect(() => {
    if (showInstrumentosModal) void recargarPlantillas();
  });

  let distribuirTargets: Record<number, string> = $state({});
  let distribuirOverwrite = $state(true);
  /** true (por defecto) = C1, C2 y C3 se distribuyen. false = C3 queda fijo en AA. */
  let distribuirC3 = $state(true);
  let distribuirInputs = new Map<number, HTMLInputElement>();

  function regDistInput(node: HTMLInputElement, id: number) {
    distribuirInputs.set(id, node);
    return { destroy() { distribuirInputs.delete(id); } };
  }

  let isMobile = $state(false);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isWindows = /Windows/i.test(navigator.userAgent);
  const isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));
  let showFiltersModal = $state(false);
  $effect(() => {
    if (showFiltersModal) {
      return registerBackHandler(() => { showFiltersModal = false; return true; });
    }
  });
  let currentStudentIdx = $state(0);
  let showStudentList = $state(false);

  // Cerrar modales con Escape / back de Android
  $effect(() => {
    if (isMobile && showStudentList) {
      return registerBackHandler(() => { showStudentList = false; return true; });
    }
  });
  $effect(() => {
    if (showDistribuirModal) {
      return registerBackHandler(() => { showDistribuirModal = false; return true; });
    }
  });
  $effect(() => {
    if (showInstrumentosModal) {
      return registerBackHandler(() => { showInstrumentosModal = false; return true; });
    }
  });
  $effect(() => {
    if (showDeleteModal) {
      return registerBackHandler(() => { showDeleteModal = false; return true; });
    }
  });

  let notasScrollRef = $state<HTMLDivElement | null>(null);
  let notasScrollHeight = $state('');
  function updateNotasScrollHeight() {
    if (!isAndroid || !notasScrollRef) return;
    const rect = notasScrollRef.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const h = Math.max(100, Math.floor(vh - rect.top - 10));
    if (notasScrollHeight !== h + 'px') notasScrollHeight = h + 'px';
  }
  $effect(() => {
    if (isAndroid && isMobile && !loading && estudiantes.length > 0 && notasScrollRef) {
      const raf = requestAnimationFrame(updateNotasScrollHeight);
      const t1 = setTimeout(updateNotasScrollHeight, 60);
      const t2 = setTimeout(updateNotasScrollHeight, 300);
      return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
    }
  });
  $effect(() => {
    const idx = currentStudentIdx;
    if (isAndroid && notasScrollRef) notasScrollRef.scrollTop = 0;
  });

  let history: Record<string, string>[] = $state([]);
  let redoStack: Record<string, string>[] = $state([]);

  let rowVersionTick = $state(0);
  let refreshTrigger = $state(0);

  let notasCualitativas: Record<string, string> = $state({});
  let notasCuantitativas: Record<string, number> = {};

  /** Estado que coincide con lo guardado en la BD (se actualiza al cargar y al guardar). */
  let savedBaseline: Record<string, string> = $state({});

  /** Compara dos mapas de notas ignorando el orden y las claves vacías. */
  function notasIguales(a: Record<string, string>, b: Record<string, string>): boolean {
    const sinVacias = (m: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const k in m) { if (m[k]) out[k] = m[k]; }
      return out;
    };
    const ca = sinVacias(a);
    const cb = sinVacias(b);
    const ka = Object.keys(ca);
    if (ka.length !== Object.keys(cb).length) return false;
    return ka.every(k => ca[k] === cb[k]);
  }

  /**
   * Derivado: hay cambios SOLO si el estado actual difiere del guardado. Así
   * Guardar se deshabilita solo cuando se deshace un cambio o cuando se borra
   * lo que se había escrito en un input.
   */
  let hasUnsavedChanges = $derived.by(() => !notasIguales(notasCualitativas, savedBaseline));
  /** Cuántas notas difieren de la BD: alimenta el subtítulo del botón Guardar. */
  let cambiosPendientes = $derived.by(() => {
    let n = 0;
    for (const k in notasCualitativas) {
      if ((notasCualitativas[k] ?? '') !== (savedBaseline[k] ?? '')) n++;
    }
    for (const k in savedBaseline) {
      if (!(k in notasCualitativas)) n++;
    }
    return n;
  });

  let inputsRef = new Map<string, HTMLInputElement>();
  let cellSnapshot: Record<string, string> | null = null;

  // ── Popover de acciones (Instrumentos / Eliminar / Distribuir) ──
  // La barra de acciones quedaba muy apretada en horizontal, así que las tres
  // acciones de infrequently se agruparon tras un único botón. Sigue el mismo
  // patrón que el popover de indicador/criterio: anclaje por coordenadas del
  // botón, cierre al pulsar fuera, Escape, resize y back de Android.
  let popAcciones = $state<{ x: number; y: number; arriba: boolean } | null>(null);
  let popAccionesPanelEl = $state<HTMLDivElement | null>(null);
  let popAccionesBtn = $state<HTMLElement | null>(null);

  /** Se pone a true si el pointerdown ya cerró el popover, para que el click
   *  que viene después (el del propio botón) no lo vuelva a abrir. */
  let cerradoPorEsteClick = false;

  function togglePopAcciones() {
    if (cerradoPorEsteClick) { cerradoPorEsteClick = false; return; }
    if (popAcciones) { cerrarPopAcciones(); return; }
    const r = popAccionesBtn?.getBoundingClientRect();
    if (!r) { console.warn('[Acciones] botón sin referencia; no se puede anclar el popover'); return; }
    // Si no cabe abajo (p. ej. barra pegada al borde inferior), abre hacia arriba.
    const altoEstimado = 190;
    const abreArriba = r.bottom + altoEstimado > window.innerHeight && r.top > altoEstimado;
    popAcciones = {
      x: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - 250)),
      y: Math.round(abreArriba ? r.top - altoEstimado - 4 : r.bottom + 4),
      arriba: abreArriba,
    };
  }

  function cerrarPopAcciones() {
    popAcciones = null;
  }

  /** Ejecuta una acción del popover y lo cierra. */
  function accionPop(fn: () => void) {
    cerrarPopAcciones();
    fn();
  }

  $effect(() => {
    if (!popAcciones) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      // Clic sobre el propio disparador: no cerrar aquí, lo hace su onclick.
      if (t && popAccionesBtn?.contains(t)) return;
      if (t && popAccionesPanelEl?.contains(t)) return;
      cerradoPorEsteClick = true;
      cerrarPopAcciones();
      // Se libera tras el click para no swallow-ear el siguiente clic real.
      setTimeout(() => { cerradoPorEsteClick = false; }, 0);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrarPopAcciones(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cerrarPopAcciones);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cerrarPopAcciones);
    };
  });

  $effect(() => {
    if (!popAcciones) return;
    return registerBackHandler(() => { cerrarPopAcciones(); return true; });
  });

  // ── Popovers de indicador y criterio (clic en la cabecera) ──
  type PopoverTipo = 'indicador' | 'criterio';
  interface PopoverAbierto {
    tipo: PopoverTipo;
    indicadorId: number;
    criterioId: number;
    /** 'menu' = opciones del indicador; 'elegir' = selector de a quién desplazar. */
    modo: 'menu' | 'elegir';
    x: number;
    y: number;
    ancho: number;
  }
  let popover = $state<PopoverAbierto | null>(null);
  /** Elemento que abrió el popover y el panel, para no cerrarlo al pulsarlos. */
  let popoverTriggerEl = $state<HTMLElement | null>(null);
  let popoverPanelEl = $state<HTMLDivElement | null>(null);
  /** Cuando está activo, la nota masiva solo rellena celdas vacías. */
  let aplicarSoloVacias = $state(false);
  let procesandoAccion = $state(false);

  function abrirPopover(tipo: PopoverTipo, indId: number, critId: number, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    if (popover && popover.tipo === tipo && popover.indicadorId === indId && popover.criterioId === critId) {
      popover = null;
      return;
    }
    popoverTriggerEl = el;
    popover = {
      tipo, indicadorId: indId, criterioId: critId, modo: 'menu',
      x: r ? Math.round(r.left) : 0,
      y: r ? Math.round(r.bottom + 4) : 0,
      ancho: r ? Math.round(r.width) : 80
    };
  }

  function cerrarPopover() {
    popover = null;
    popoverTriggerEl = null;
  }

  // Cierra al pulsar fuera, en pointerdown para no bloquear el clic siguiente:
  // así se pasa de una cabecera a otra con un solo clic.
  $effect(() => {
    if (!popover) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (t && (popoverPanelEl?.contains(t) || popoverTriggerEl?.contains(t))) return;
      cerrarPopover();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrarPopover(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cerrarPopover);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cerrarPopover);
    };
  });

  $effect(() => {
    if (!popover) return;
    return registerBackHandler(() => { cerrarPopover(); return true; });
  });

  /** Indicador/criterio sobre el que está abierto el popover. */
  function popoverIndicador() {
    if (!popover) return null;
    return indicadoresSeccion.find(i => i.id === popover!.indicadorId) || null;
  }
  function popoverCriterio() {
    if (!popover) return null;
    const ind = popoverIndicador();
    return ind ? (ind.criterios.find(c => c.id === popover!.criterioId) || null) : null;
  }

  /**
   * Máximo de indicadores que pueden estar ACTIVOS a la vez. Al superarlo se
   * pide elegir a cuál desactivar (intercambio), nunca se borra nada.
   */
  const MAX_INDICADORES_ACTIVOS = 5;
  /** Regla de la evaluación: 5 indicadores activos × 20 pts = 100 pts. */
  const MAX_PTS_POR_INDICADOR = 20;

  /** Suma de puntos de los criterios de un indicador. */
  function puntosDeIndicador(ind: Indicador): number {
    return ind.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0);
  }

  /** Estudiantes con al menos una nota en los criterios de este indicador. */
  function estudiantesConNota(ind: Indicador): number {
    return notas.filter(n => ind.criterios.some(c => notasCualitativas[`${n.estudianteId}-${c.id}`])).length;
  }

  /** Marcar el indicador como activo/inactivo **en esta sección** (no afecta a las demás). */
  async function alternarActivoIndicador(ind: Indicador) {
    const activoEnSeccion = idsActivos.includes(ind.id);
    if (!activoEnSeccion && activeIndicadores.length >= MAX_INDICADORES_ACTIVOS) {
      // Ya está el cupo: en vez de activar y pasarse del límite, se pregunta
      // qué indicador activo se desactiva a cambio. El popover se transforma
      // en el selector en el mismo sitio.
      if (popover) popover = { ...popover, modo: 'elegir' };
      return;
    }
    aplicarActivo(ind, !activoEnSeccion);
  }

  /** Ejecuta el cambio de estado (con confirmación) o el intercambio completo. */
  async function aplicarActivo(ind: Indicador, nuevoEstado: boolean) {
    if (nuevoEstado) {
      const pts = puntosDeIndicador(ind);
      if (!isQualitative && pts > MAX_PTS_POR_INDICADOR) {
        await emit("show-toast", {
          message: `❌ El Indicador ${ind.orden} suma ${pts} pts y el máximo por indicador es ${MAX_PTS_POR_INDICADOR}.\nCorrige los puntos en Evaluaciones (pestaña Global → Evaluaciones) antes de activarlo.`,
          type: 'error'
        });
        return;
      }
    }
    cerrarPopover();
    const nombreSeccion = secciones.find(s => s.id === selectedSeccion)?.nombre || 'esta sección';
    const ok = await ask(
      nuevoEstado
        ? `¿Sumar el Indicador ${ind.orden} en la sección ${nombreSeccion}?\n\nSolo cambia en esta sección; las demás no se tocan.`
        : `¿Dejar de sumar el Indicador ${ind.orden} en la sección ${nombreSeccion}?\n\nSus notas dejan de sumar al total de esta sección, pero no se borra nada.`,
      { title: nuevoEstado ? '✔ Activar indicador' : '👁 Desactivar indicador', kind: 'info', okLabel: nuevoEstado ? 'Activar' : 'Desactivar', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      await invoke('set_indicador_colegio_seccion_activo', { colegioId: selectedColegio, seccionId: selectedSeccion, indicadorId: ind.id, activo: nuevoEstado });
      await cargarActivosDeSeccion(selectedSeccion);
      await emit("show-toast", { message: `✅ Indicador ${ind.orden} ${nuevoEstado ? 'suma' : 'no suma'} en la sección ${nombreSeccion}`, type: 'success' });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
    } finally { procesandoAccion = false; }
  }

  /** Vuelve a que esta sección use los indicadores globales por defecto. */
  async function restablecerActivosSeccion() {
    const n = seccionTieneExcepciones ? activeIndicadores.length : 0;
    const ok = await ask(
      `La sección volverá a usar los indicadores globales por defecto.\n\n` +
      `Se borran sus excepciones (quedan ${n} activo(s) en la BD local para esta sección).\n` +
      `Los indicadores, sus notas y los criterios NO se borran.`,
      { title: '↩ Restablecer a valores globales', kind: 'info', okLabel: 'Restablecer', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      const borradas = await invoke<number>('reset_indicadores_colegio_seccion', {
        colegioId: selectedColegio,
        seccionId: selectedSeccion,
        gradoId: selectedGrado,
        asignaturaId: selectedAsignatura,
        corteEvaluativoId: selectedCorte
      });

      await cargarActivosDeSeccion(selectedSeccion);
      await emit("show-toast", { message: `↩ ${borradas} excepción(es) borrada(s). La sección usa los valores globales.`, type: 'success' });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
    } finally { procesandoAccion = false; }
  }

  /**
   * Intercambio: activa el indicador elegido y desactiva otro que ya estaba
   * activo. NUNCA se borra nada — el indicador que sale conserva sus notas y
   * sus criterios, solo deja de sumar al total.
   */
  async function intercambiarActivo(nuevo: Indicador, saliente: Indicador) {
    const ptsNuevo = puntosDeIndicador(nuevo);
    if (!isQualitative && ptsNuevo > MAX_PTS_POR_INDICADOR) {
      cerrarPopover();
      await emit("show-toast", {
        message: `❌ El Indicador ${nuevo.orden} suma ${ptsNuevo} pts y el máximo por indicador es ${MAX_PTS_POR_INDICADOR}.\nCorrige sus puntos en Evaluaciones antes de activarlo.`,
        type: 'error'
      });
      return;
    }
    cerrarPopover();
    const conNotaSaliente = estudiantesConNota(saliente);
    const ok = await ask(
      `Intercambio de indicadores:\n\n` +
      `✔ Activar: Indicador ${nuevo.orden} "${nuevo.descripcion || ''}" (${isQualitative ? 'cualitativo' : ptsNuevo + ' pts'})\n` +
      `👁 Desactivar: Indicador ${saliente.orden} "${saliente.descripcion || ''}"${conNotaSaliente > 0 ? ` (conserva sus ${conNotaSaliente} nota(s))` : ''}\n\n` +
      `Los ${MAX_INDICADORES_ACTIVOS} activos seguirán sumando ${isQualitative ? '' : MAX_INDICADORES_ACTIVOS * MAX_PTS_POR_INDICADOR + ' pts'}.\n` +
      `El indicador desactivado NO se borra: sigue con sus notas y criterios,\n` +
      `solo deja de sumar al total. Puedes volver a activarlo cuando quieras.`,
      { title: '🔄 Intercambiar indicadores', kind: 'info', okLabel: 'Hacer cambio', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      await invoke('set_indicador_colegio_seccion_activo', { colegioId: selectedColegio, seccionId: selectedSeccion, indicadorId: saliente.id, activo: false });
      await invoke('set_indicador_colegio_seccion_activo', { colegioId: selectedColegio, seccionId: selectedSeccion, indicadorId: nuevo.id, activo: true });
      await cargarActivosDeSeccion(selectedSeccion);
      await emit("show-toast", { message: `🔄 En esta sección: {nuevo.orden} suma · {saliente.orden} no suma (conserva sus notas)`, type: 'success' });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: "❌ Error en el intercambio: " + e, type: "error" });
    } finally { procesandoAccion = false; }
  }

  /**
   * Vacía las notas de todos los criterios del indicador **en el corte y
   * asignatura actuales**, dejándolas listas para volver a llenar. El indicador
   * y sus criterios NO se borran nunca, y los demás cortes no se tocan.
   */
  async function vaciarNotasIndicador(ind: Indicador) {
    cerrarPopover();
    if (selectedCorte <= 0 || selectedAsignatura <= 0) {
      await emit("show-toast", { message: "⚠️ Selecciona corte y asignatura antes de vaciar", type: 'warning' });
      return;
    }
    const nombreCorte = cortes.find(c => c.id === selectedCorte)?.nombre || 'corte actual';
    const conNota = notas.filter(n => ind.criterios.some(c => notasCualitativas[`${n.estudianteId}-${c.id}`])).length;
    const ok = await ask(
      `Se borrarán las notas de los ${ind.criterios.length} criterio(s) del Indicador ${ind.orden} "${ind.descripcion || ''}".\n\n` +
      `· Solo en "${nombreCorte}" (${asignaturas.find(a => a.id === selectedAsignatura)?.nombre || 'la asignatura actual'}).\n` +
      `· ${conNota} estudiante(s) de esta vista quedan con las celdas vacías.\n` +
      `· Los demás cortes evaluativos NO se modifican.\n\n` +
      `El indicador y sus criterios se conservan; solo se vacían las notas.\nEsta acción no se puede deshacer.`,
      { title: '🧹 Vaciar notas del indicador', kind: 'warning', okLabel: 'Sí, vaciar este corte', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      const corteId = selectedCorte;
      const asignaturaId = selectedAsignatura;
      const borradas = await invoke<number>('vaciar_notas_indicador', { id: ind.id, corteId, asignaturaId });
      await emit("show-toast", { message: `🧹 Indicador ${ind.orden}: ${borradas} nota(s) vaciada(s) en ${nombreCorte}`, type: 'success' });
      await recargarIndicadoresYNotas();
    } catch (e) {
      await emit("show-toast", { message: "❌ Error al vaciar: " + e, type: "error" });
    } finally { procesandoAccion = false; }
  }

  /** Elimina un solo criterio (una columna) con todas sus notas. */
  async function eliminarCriterio(ind: Indicador, crit: Criterio) {
    cerrarPopover();
    const conNota = notas.filter(n => notasCualitativas[`${n.estudianteId}-${crit.id}`]).length;
    const ok = await ask(
      `Se eliminará el Criterio ${crit.orden} del Indicador ${ind.orden}.\n\n` +
      `· ${conNota} nota(s) se borrarán de TODOS los cortes evaluativos.\n` +
      `· En esta vista afecta a ${filteredNotas.length} estudiante(s).\n\nEsta acción no se puede deshacer.`,
      { title: '🗑 Eliminar criterio', kind: 'warning', okLabel: 'Sí, eliminar', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      await invoke('delete_criterio', { id: crit.id });
      await emit("show-toast", { message: `🗑 Criterio ${crit.orden} eliminado`, type: 'success' });
      await recargarIndicadoresYNotas();
    } catch (e) {
      await emit("show-toast", { message: "❌ Error al eliminar: " + e, type: "error" });
    } finally { procesandoAccion = false; }
  }

  /**
   * Aplica una letra a un criterio de todos los estudiantes visibles (el filtro
   * de búsqueda también cuenta). Con `aplicarSoloVacias` solo rellena las
   * celdas vacías. Es un solo paso de historial: se puede deshacer con Ctrl+Z.
   */
  async function aplicarNotaMasiva(ind: Indicador, crit: Criterio, letra: string) {
    const soloVacias = aplicarSoloVacias;
    cerrarPopover();
    const destino = notas.filter(n => soloVacias ? !notasCualitativas[`${n.estudianteId}-${crit.id}`] : true);
    if (destino.length === 0) {
      await emit("show-toast", { message: `ℹ️ No hay celdas vacías en C${crit.orden}`, type: 'info' });
      return;
    }
    const ok = await ask(
      `Se aplicará ${letra} al Criterio ${crit.orden} del Indicador ${ind.orden} ` +
      `a ${destino.length} estudiante(s)${soloVacias ? ' (solo celdas vacías)' : ' (sobrescribe)'}.\n\n` +
      `Recuerda que aún debes pulsar Guardar para escribirlo en la base de datos.`,
      { title: `✍ Nota masiva ${letra}`, kind: 'info', okLabel: `Aplicar ${letra}`, cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    pushHistory({ ...notasCualitativas });
    for (const n of destino) handleNotaChange(n.estudianteId, crit.id, letra);
    rowVersionTick++;
    await emit("show-toast", { message: `✍ ${letra} aplicado a ${destino.length} estudiante(s) en C${crit.orden}`, type: 'success' });
  }

  /** Recarga indicadores + notas del filtro actual (tras borrar estructura). */
  async function recargarIndicadoresYNotas() {
    savedBaseline = {};
    history = [];
    redoStack = [];
    hasUnsavedRef = false;
    const nuevos = await fetchConfiguracionEvaluacion(true);
    await fetchEstudiantes(nuevos, true);
  }

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

  let allCriterios = $derived(indicadoresSeccion.flatMap(ind => ind.criterios));
  let criterioIndexMap = $derived(new Map(allCriterios.map((c, i) => [c.id, i])));
  let totalColumns = $derived(allCriterios.length);
  let studentIndexMap = $derived(new Map(estudiantes.map((e, i) => [e.id, i])));

  /**
   * IDs de indicadores que suman **en la seccion seleccionada**. Viene del
   * backend, que ya aplica la herencia: si la seccion no tiene excepcion para
   * un indicador, manda el `indicador.activo` global. Mientras no haya
   * respuesta usamos el global, para que la tabla nunca se quede vacia.
   */
  let idsActivosSeccion = $state<number[] | null>(null);
  let idsActivosPorDefecto = $derived(indicadores.filter(i => i.activo).map(i => i.id));
  let idsActivos = $derived(idsActivosSeccion ?? idsActivosPorDefecto);
  /** true = esta seccion tiene excepciones propias sobre el global. */
  let seccionTieneExcepciones = $derived(
    indicadores.some(i => i.activo !== idsActivos.includes(i.id))
  );

  let activeIndicadores = $derived(indicadoresSeccion.filter(i => i.activo));

  async function cargarActivosDeSeccion(seccionId: number) {
    if (seccionId <= 0 || selectedColegio <= 0) { idsActivosSeccion = null; return; }
    try {
      const ids = await invoke<number[]>('get_indicadores_activos_colegio_seccion', {
        colegioId: selectedColegio,
        seccionId,
        gradoId: selectedGrado,
        asignaturaId: selectedAsignatura,
        corteEvaluativoId: selectedCorte
      });
      idsActivosSeccion = ids;
    } catch (e) {
      console.error('[Notas] No se pudieron cargar los activos del colegio/sección:', e);
      idsActivosSeccion = null;
    }
  }
  /** Máximo real de puntos = suma de los criterios de los indicadores ACTIVOS (8 indicadores = 160, no 100). */
  let maxPuntosTotales = $derived(
    activeIndicadores.reduce((s, i) => s + i.criterios.reduce((a, c) => a + (c.puntajeMaximo || 0), 0), 0)
  );

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
    return indicadoresSeccion.filter(i => i.activo).reduce((sum, ind) => sum + calcularTotalIndicador(estudianteNotas, ind), 0);
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

  const GRADES: string[] = ['AA', 'AS', 'AF', 'AI'];

  function valorCriterio(c: Criterio, g: string): number {
    return Math.round(c.puntajeMaximo * (notaMapping[g] || 0));
  }

  /** Toma los 3 primeros criterios de cada indicador activo y el máximo total global. */
  function construirIndInfos(): { indInfos: IndDist[]; maxTotal: number } {
    const indInfos: IndDist[] = [];
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
    return { indInfos, maxTotal };
  }

  /** Índice de calidad: 0 = AA (más alto) … 3 = AI (más bajo). */
  function pesoLetra(g: string): number {
    const i = GRADES.indexOf(g);
    return i === -1 ? 0 : i;
  }

  /**
   * Elige, por indicador, el combo de letras (C1, C2 y C3) que más se acerca al
   * total objetivo. Si `incluirC3` es false, C3 queda fijo en AA (comportamiento
   * anterior, donde solo C1 y C2 eran distribuibles). El error se acumula entre
   * indicadores para que la suma global sea lo más cercana posible a la meta.
   *
   * Monotonía: el desempeño nunca retrocede, siempre valor(C1) <= valor(C2) <=
   * valor(C3) entre los criterios que se distribuyen. Por eso una meta de 65
   * con pesos 7/7/6 resuelve AI/AF/AS y no AI/AS/AF: ambos suman 13, pero el
   * segundo dejaba al C2 por encima del C3.
   *
   * Desempate: se recorre primero el combo "preferido" (C1 con la letra más
   * baja y C2/C3 con las más altas) y la comparación es estricta, así que si
   * varias combinaciones dan la misma diferencia se queda con esa.
   */
  function elegirCombos(indInfos: IndDist[], maxTotal: number, targetRaw: number, incluirC3: boolean) {
    const opcionesC3 = incluirC3 ? GRADES : ['AA'];
    // C1 de menor a mayor valor; C2/C3 de mayor a menor.
    const ordenC1 = [...GRADES].reverse();
    const elegidos: { ind: IndDist; combo: [string, string, string] }[] = [];
    let predictedTotal = 0;
    let runningError = 0;
    for (const ii of indInfos) {
      const indTarget = (ii.weight / maxTotal) * targetRaw + runningError;
      let bestCombo: [string, string, string] | null = null;
      let bestDiff = Infinity;
      for (const g1 of ordenC1) {
        for (const g2 of GRADES) {
          for (const g3 of opcionesC3) {
            // Solo combos monótonos: el C2 no puede superar al C1, ni el C3 al C2.
            if (pesoLetra(g2) > pesoLetra(g1)) continue;
            if (incluirC3 && pesoLetra(g3) > pesoLetra(g2)) continue;
            const total = valorCriterio(ii.c1, g1) + valorCriterio(ii.c2, g2) + valorCriterio(ii.c3, g3);
            const diff = Math.abs(total - indTarget);
            if (diff < bestDiff) { bestDiff = diff; bestCombo = [g1, g2, g3]; }
          }
        }
      }
      if (!bestCombo) continue;
      const total = valorCriterio(ii.c1, bestCombo[0]) + valorCriterio(ii.c2, bestCombo[1]) + valorCriterio(ii.c3, bestCombo[2]);
      elegidos.push({ ind: ii, combo: bestCombo });
      predictedTotal += total;
      runningError += indTarget - total;
    }
    return { elegidos, predictedTotal };
  }

  /** Escribe la letra de un criterio respetando "solo llenar vacíos" si no se sobrescribe. */
  function aplicarNotaCriterio(estudianteId: number, criterio: Criterio, grade: string) {
    const key = `${estudianteId}-${criterio.id}`;
    if (distribuirOverwrite) notasCualitativas[key] = grade;
    else if (!notasCualitativas[key]) notasCualitativas[key] = grade;
  }

  function calcularPctPreview(estudianteId: number, targetStr: string | undefined): number {
    if (!targetStr || targetStr.trim() === '') return calcularPctActual(estudianteId);
    let targetPct: number;
    if (isQualitative && GRADES.includes(targetStr.trim().toUpperCase())) {
      targetPct = getMidPctForGrade(targetStr.trim().toUpperCase());
    } else {
      targetPct = parseFloat(targetStr);
      if (isNaN(targetPct) || targetPct < 0) return calcularPctActual(estudianteId);
    }
    if (activeIndicadores.length === 0) return 0;
    const { indInfos, maxTotal } = construirIndInfos();
    if (maxTotal === 0) return 0;
    const targetRaw = Math.round((Math.min(targetPct, 100) / 100) * maxTotal);
    const { predictedTotal } = elegirCombos(indInfos, maxTotal, targetRaw, distribuirC3);
    return Math.round((predictedTotal / maxTotal) * 100);
  }

  function distribuirNotas() {
    if (activeIndicadores.length === 0 || filteredNotas.length === 0) return;
    const { indInfos, maxTotal } = construirIndInfos();
    if (maxTotal === 0) return;
    let updatedCount = 0;
    for (const estNota of filteredNotas) {
      const targetStr = distribuirTargets[estNota.estudianteId];
      if (!targetStr || targetStr.trim() === '') continue;
      // Cualitativo: se reparte la letra objetivo entre C1 y C2 (y C3 si está activo)
      if (isQualitative && GRADES.includes(targetStr.trim().toUpperCase())) {
        const grade = targetStr.trim().toUpperCase();
        const g3 = distribuirC3 ? grade : 'AA';
        for (const ii of indInfos) {
          aplicarNotaCriterio(estNota.estudianteId, ii.c1, grade);
          aplicarNotaCriterio(estNota.estudianteId, ii.c2, grade);
          aplicarNotaCriterio(estNota.estudianteId, ii.c3, g3);
        }
        updatedCount++;
        continue;
      }
      // Cuantitativo: se busca el combo de letras más cercano al % objetivo
      const targetPct = parseFloat(targetStr);
      if (isNaN(targetPct) || targetPct < 0) continue;
      const targetRaw = Math.round((Math.min(targetPct, 100) / 100) * maxTotal);
      const { elegidos } = elegirCombos(indInfos, maxTotal, targetRaw, distribuirC3);
      for (const { ind: ii, combo } of elegidos) {
        aplicarNotaCriterio(estNota.estudianteId, ii.c1, combo[0]);
        aplicarNotaCriterio(estNota.estudianteId, ii.c2, combo[1]);
        aplicarNotaCriterio(estNota.estudianteId, ii.c3, combo[2]);
      }
      updatedCount++;
    }
    if (updatedCount > 0) {
      hasUnsavedRef = true;
      emit("show-toast", { message: `✅ Notas distribuidas para ${updatedCount} estudiante(s)`, type: 'success' });
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

  function previewQualitativeGrade(targetGrade: string): string {
    const g3 = distribuirC3 ? targetGrade : 'AA';
    const values: string[] = [];
    for (const ind of activeIndicadores) {
      if (ind.criterios[0]) values.push(targetGrade);
      if (ind.criterios[1]) values.push(targetGrade);
      if (ind.criterios[2]) values.push(g3);
    }
    return calcularNotaCualitativaFinal(values) || targetGrade;
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
    cellSnapshot = null;
    updateInputsUI(previousState);
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadoresSeccion.forEach(ind => { ind.criterios.forEach(crit => {
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
  }

  function redo() {
    if (redoStack.length === 0) return;
    const nextState = redoStack[0];
    redoStack = redoStack.slice(1);
    history = [...history, { ...notasCualitativas }];
    isUndoRedoAction = true;
    cellSnapshot = null;
    updateInputsUI(nextState);
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadoresSeccion.forEach(ind => { ind.criterios.forEach(crit => {
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
    hasUnsavedRef = true;
  }

  function handleInputFocus() {
    if (!cellSnapshot) cellSnapshot = { ...notasCualitativas };
  }

  /** Agrega un snapshot al historial (máx 50) y vacía el redo. */
  function pushHistory(snapshot: Record<string, string>) {
    const newHistory = [...history, snapshot];
    if (newHistory.length > 50) newHistory.shift();
    history = newHistory;
    redoStack = [];
    hasUnsavedRef = true;
  }

  /**
   * Cierra la edición en curso de una celda (blur o Ctrl+Z): compara el valor
   * actual contra el snapshot del focus y, si cambió, guarda el estado previo
   * en el historial. Si el valor quedó igual, no hay nada que deshacer.
   */
  function commitCellEdit(estudianteId: number, criterioIndex: number, value?: string) {
    if (!cellSnapshot) return;
    const criterio = allCriterios[criterioIndex];
    if (!criterio) { cellSnapshot = null; return; }
    const key = `${estudianteId}-${criterio.id}`;
    const inputEl = inputsRef.get(`row-${estudianteId}-col-${criterioIndex}`);
    const current = value !== undefined ? value : (inputEl ? inputEl.value : (notasCualitativas[key] || ''));
    const newValue = (current || '').toUpperCase();
    const oldValue = (cellSnapshot[key] || '').toUpperCase();
    if (oldValue !== newValue) pushHistory({ ...cellSnapshot });
    cellSnapshot = null;
  }

  function handleInputBlur(estudianteId: number, criterioId: number, value: string) {
    if (!cellSnapshot) return;
    const key = `${estudianteId}-${criterioId}`;
    const oldValue = cellSnapshot[key] || '';
    const newValue = value.toUpperCase();
    if (oldValue !== newValue) pushHistory({ ...cellSnapshot });
    cellSnapshot = null;
  }

  // Keyboard navigation
  function handleKeyDown(e: KeyboardEvent, estudianteId: number, criterioIndex: number) {
    // Ctrl+Z / Ctrl+Y dentro del input: lo maneja la app, no el navegador, para
    // que el texto del input y el estado no se desincronicen.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); commitCellEdit(estudianteId, criterioIndex); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); commitCellEdit(estudianteId, criterioIndex); redo(); return; }
      return;
    }
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
    if (Math.abs(diff) > 50) {
      // Este gesto pertenece a la navegación entre estudiantes: impedir que
      // el contenedor lo interprete como cambio de sub-tab.
      e.stopPropagation();
      if (diff > 0) goPrevStudent(); else goNextStudent();
    }
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
        } catch (e) { console.debug("Comando get_subjects_by_grade no disponible, usando globales"); }
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
      filtersRef = { ano: selectedAno, corte: selectedCorte, colegio: selectedColegio, asignatura: selectedAsignatura, grado: selectedGrado, seccion: selectedSeccion, sexo: selectedSexo };
      await cargarActivosDeSeccion(selectedSeccion);
      await loadNotas(selectedAno, selectedCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion);
    } catch (error) { console.error("Error fetching secciones:", error); }
  }

  /**
   * @param escribir `false` devuelve los indicadores SIN asignarlos a `indicadores`.
   *   Lo usa `loadNotas` para que las columnas nuevas y las filas nuevas caigan en
   *   el mismo lote de render (ver el comentario ahí). Con `true` se comporta como
   *   siempre: escribe y devuelve.
   */
  async function fetchConfiguracionEvaluacion(silent = false, escribir = true): Promise<Indicador[]> {
    const isActuallySilent = silent || nextRefreshSilent;
    if (!isActuallySilent) loading = true;
    const { corte, asignatura, grado } = filtersRef;
    try {
      const data = await invoke<Indicador[]>("get_evaluation_config", { gradoId: grado, asignaturaId: asignatura, corteEvaluativoId: corte, anoLectivoId: filtersRef.ano });
      if (escribir) indicadores = data;
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
      let mappedCount = 0;
      let unmatchedCount = 0;
      let unmatchedSamples: { estudianteId: number; criterioId: number; valor: number }[] = [];
      notasGuardadas.forEach(n => {
        const key = `${n.estudianteId}-${n.criterioId}`;
        const criterio = indToUse.flatMap(ind => ind.criterios).find(c => c.id === n.criterioId);
        if (criterio) {
          mappedCount++;
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
        } else {
          unmatchedCount++;
          if (unmatchedSamples.length < 5) unmatchedSamples.push({ estudianteId: n.estudianteId, criterioId: n.criterioId, valor: n.valor });
        }
        if (cuantitativasMap[n.estudianteId]) cuantitativasMap[n.estudianteId][n.criterioId] = n.valor;
      });
      if (isActuallySilent) { history = []; redoStack = []; savedBaseline = { ...notasMap }; hasUnsavedRef = false; }
      // Preservar el estudiante que el usuario está viendo durante refrescos
      const keepIdx = Math.min(currentStudentIdx, Math.max(0, data.length - 1));
      notas = data.map(est => ({
        estudianteId: est.id,
        estudianteNombre: est.nombre,
        notas: cuantitativasMap[est.id] || {}
      }));
      notasCualitativas = { ...notasMap };
      if (keepIdx > 0 && keepIdx < estudiantes.length) currentStudentIdx = keepIdx;
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
      /** Criterios que quedaron vacios y hay que borrar de la BD. */
      const borrados: number[] = [];
      indicadoresSeccion.forEach(ind => { ind.criterios.forEach(crit => {
        const key = `${notaEst.estudianteId}-${crit.id}`;
        const qualValue = notasCualitativas[key];
        if (qualValue && ['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
          const percentage = notaMapping[qualValue];
          updatedNotas[crit.id] = Math.round(crit.puntajeMaximo * percentage);
        } else if (!qualValue) {
          // Celda vacia: si tenia algo guardado, la fila se borra de verdad. Antes
          // el upsert la dejaba intacta y la nota reaparecia al recargar.
          if (savedBaseline[key] || notaEst.notas[crit.id] !== undefined) {
            borrados.push(crit.id);
            // Si se enviara en `notas`, el upsert volveria a insertarla.
            delete updatedNotas[crit.id];
          }
        }
      }); });
      return { ...notaEst, notas: updatedNotas, borrados };
    });
    const hasIncomplete = Object.values(notasCualitativas).some(v => v === 'A');
    if (hasIncomplete) {
      await emit("show-toast", { message: "⚠️ Hay notas incompletas (solo 'A'). Por favor complételas (AA, AS, AF, AI) o bórrelas antes de guardar.", type: 'error' });
      return;
    }
    for (const notaEst of notasActualizadas) {
      for (const indicador of indicadoresSeccion) {
        if (!indicador.activo) continue;
        if (isQualitative) continue;
        const totalIndicador = calcularTotalIndicador(notaEst.notas, indicador);
        if (totalIndicador > 20) {
          await emit("show-toast", { message: `⚠️ El estudiante ${notaEst.estudianteNombre} tiene ${totalIndicador} pts en el Indicador ${indicador.orden} (máximo 20)`, type: 'error' });
          return;
        }
      }
    }
    const okGuardar = await ask("¿Guardar las notas?\n\nSe registrarán los cambios en la base de datos local.", { title: "💾 Confirmar guardado", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar" });
    if (!okGuardar) return;
    saving = true;
    try {
      const notasParaGuardar = notasActualizadas.map(notaEst => ({
        estudianteId: notaEst.estudianteId,
        notas: Object.entries(notaEst.notas).map(([criterioId, valor]) => ({ criterioId: parseInt(criterioId), valor })),
        borrados: notaEst.borrados
      }));
      const totalBorrados = notasActualizadas.reduce((a, n) => a + n.borrados.length, 0);
      await invoke("save_notas_estudiantes", { notas: notasParaGuardar, corteId: saveCorteId, asignaturaId: saveAsignaturaId });
      savedBaseline = { ...notasCualitativas };
      history = [];
      redoStack = [];
      hasUnsavedRef = false;
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; nextRefreshSilent = true; refreshTrigger++; }
      saving = false;
      await emit("show-toast", {
        message: totalBorrados > 0
          ? `✅ Notas guardadas · ${totalBorrados} nota(s) borrada(s)`
          : `✅ Notas guardadas localmente`,
        type: 'success'
      });
      onDataChange('nota', { immediate: true });

      setTimeout(() => fetchEstudiantes(undefined, true), 200);
    } catch (error) {
      console.error("Error saving notes:", error);
      await emit("show-toast", { message: "❌ Error al guardar notas: " + error, type: "error" });
      saving = false;
    }
  }

  // Delete
  async function handleDeleteNotas() {
    if (deleteMode === 'student' && !deleteStudentId) { await emit("show-toast", { message: "⚠️ Seleccione un estudiante", type: "warning" }); return; }
    if (deleteMode === 'indicator' && !deleteIndicatorId) { await emit("show-toast", { message: "⚠️ Seleccione un indicador", type: "warning" }); return; }
    const mensaje = deleteMode === 'all'
      ? '¿Está seguro de eliminar TODAS las notas mostradas para este corte y asignatura? Esta acción no se puede deshacer.'
      : deleteMode === 'student'
        ? `¿Está seguro de eliminar todas las notas de "${filteredNotas.find(n => n.estudianteId === deleteStudentId)?.estudianteNombre || ''}" para este corte y asignatura?`
        : `¿Está seguro de eliminar todas las notas del ${indicadores.find(i => i.id === deleteIndicatorId) ? `Indicador ${indicadores.find(i => i.id === deleteIndicatorId)!.orden}` : 'indicador seleccionado'} para este corte y asignatura?`;
    const ok = await ask(mensaje, { title: "🗑️ Confirmar eliminación", kind: "warning", okLabel: "Sí, eliminar", cancelLabel: "Cancelar" });
    if (!ok) return;
    try {
      deleting = true;
      const delCorteId = selectedCorte;
      const delAsignaturaId = selectedAsignatura;
      await invoke<number>("delete_notas", {
        corteEvaluativoId: delCorteId,
        asignaturaId: delAsignaturaId,
        estudianteId: deleteMode === 'student' ? deleteStudentId : 0,
        criterioId: deleteMode === 'indicator' ? deleteIndicatorId : 0,
        gradoId: selectedGrado || 0,
        seccionId: selectedSeccion || 0,
      });
      showDeleteModal = false;
      await emit("show-toast", { message: `✅ Notas eliminadas`, type: "success" });
      savedBaseline = {};
      history = [];
      redoStack = [];
      hasUnsavedRef = false;
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; nextRefreshSilent = true; refreshTrigger++; }
      onDataChange('nota', { immediate: true });
      setTimeout(() => fetchEstudiantes(undefined, true), 200);
    } catch (error) {
      console.error("Error deleting notas:", error);
      await emit("show-toast", { message: "❌ Error al eliminar notas: " + error, type: "error" });
    } finally { deleting = false; }
  }

  // ── Instrumentos de evaluación ──
  const INSTRUMENTO_TIPOS: { id: InstrumentoTipo; label: string }[] = INSTRUMENTO_OPS.map(o => ({ id: o.id as InstrumentoTipo, label: o.label }));

  const normTipo = (v: any): InstrumentoTipo =>
    ['cotejo', 'escala', 'rubrica'].includes(v) ? v : 'escala';

  function labelTipo(t: InstrumentoTipo): string {
    return INSTRUMENTO_TIPOS.find(o => o.id === t)?.label ?? t;
  }

  async function setInstrumento(ind: Indicador, tipo: InstrumentoTipo) {
    try {
      await invoke('update_indicador', { id: ind.id, descripcion: ind.descripcion, activo: ind.activo, instrumento: tipo });
      indicadores = indicadores.map(i => i.id === ind.id ? { ...i, instrumento: tipo } : i);
      await emit("show-toast", { message: `✅ Indicador ${ind.orden}: ${INSTRUMENTO_OPS.find(o => o.id === tipo)?.label}`, type: "success" });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: "❌ Error guardando instrumento: " + e, type: "error" });
    }
  }

  function buildInstrumentoInput(ind: Indicador): InstrumentoInput {
    const estudiantes_input = estudiantes.map(est => {
      const letras = ind.criterios.map(c => (notasCualitativas[`${est.id}-${c.id}`] || '').toUpperCase());
      const validas = letras.filter(l => ['AA', 'AS', 'AF', 'AI'].includes(l));
      return {
        id: est.id,
        nombre: est.nombre,
        sexo: (est as any).sexo || '',
        letras,
        valoracion: calcularNotaCualitativaFinal(validas),
      };
    });
    return {
      tipo: normTipo((ind as any).instrumento),
      orden: ind.orden,
      descripcion: ind.descripcion,
      criterios: ind.criterios.map(c => ({ orden: c.orden, descripcion: c.descripcion, puntajeMaximo: c.puntajeMaximo })),
      estudiantes: estudiantes_input,
      meta: {
        colegio: colegios.find(c => c.id === selectedColegio)?.nombre || '',
        ano: anos.find(a => a.id === selectedAno)?.nombre || '',
        corte: cortes.find(c => c.id === selectedCorte)?.nombre || '',
        asignatura: asignaturas.find(a => a.id === selectedAsignatura)?.nombre || '',
        grado: grados.find(g => g.id === selectedGrado)?.nombre || '',
        seccion: secciones.find(s => s.id === selectedSeccion)?.nombre || '',
      },
    };
  }

  async function generarPDFInstrumento(ind: Indicador) {
    generatingPdf = true;
    try {
      const ruta = await generarInstrumentoPDF(buildInstrumentoInput(ind));
      await emit("show-toast", { message: "✅ PDF generado en Documents/SchoolTrackerPro/Instrumentos", type: "success" });
      console.debug('[Instrumentos] PDF:', ruta);
    } catch (e) {
      console.error('[Instrumentos] Error:', e);
      await emit("show-toast", { message: "❌ Error generando PDF: " + e, type: "error" });
    } finally { generatingPdf = false; }
  }

  async function generarExcelInstrumento(ind: Indicador) {
    const tipoNecesario = normTipo((ind as any).instrumento || 'escala');
    let nombrePlantilla = plantillaSel;

    // AUTO: si no hay selección manual, usar la plantilla del tipo del indicador
    if (!nombrePlantilla) {
      const match = plantillas.find(p => p.tipo === tipoNecesario);
      if (!match) {
        await emit("show-toast", {
          message: `⚠️ No hay plantilla de "${tipoNecesario}" en la carpeta Plantillas. El nombre del archivo debe contener esa palabra.`,
          type: "warning",
        });
        return;
      }
      nombrePlantilla = match.nombre;
    }

    try {
      const rutaPlantilla = plantillas.find(p => p.nombre === nombrePlantilla)?.ruta
        || `${await plantillasDir()}\\${nombrePlantilla}`;
      const bytes = new Uint8Array(await readFile(rutaPlantilla));

      const input: ExcelInstrumentoInput = {
        meta: buildInstrumentoInput(ind).meta,
        indicadorOrden: ind.orden,
        indicadorDescripcion: ind.descripcion,
        criterios: ind.criterios.map(c => ({ orden: c.orden, descripcion: c.descripcion, puntajeMaximo: c.puntajeMaximo })),
        estudiantes: estudiantes.map(est => ({
          nombre: est.nombre,
          sexo: (est as any).sexo || '',
          letras: ind.criterios.map(c => (notasCualitativas[`${est.id}-${c.id}`] || '').toUpperCase()),
          valoracion: calcularNotaCualitativaFinal(
            ind.criterios.map(c => (notasCualitativas[`${est.id}-${c.id}`] || '').toUpperCase())
              .filter(l => ['AA','AS','AF','AI'].includes(l))
          ),
        })),
      };
      const base = `Instrumento_Ind${ind.orden}_${(buildInstrumentoInput(ind).meta.asignatura || 'Asignatura').replace(/[<>:"/\\|?*]/g, '_')}`;
      const ruta = await generarInstrumentoExcel(bytes, base, input);
      await emit("show-toast", { message: `✅ XLSX generado con "${nombrePlantilla}" → Documents/SchoolTrackerPro/Instrumentos`, type: "success" });
    } catch (e) {
      console.error('[Instrumentos-Excel] Error:', e);
      await emit("show-toast", { message: "❌ Error generando XLSX: " + e, type: "error" });
    }
  }

  const AYUDA_PLANTILLA_XLSX = `OBJETIVO
 Crear una plantilla Excel (.xlsx) que la app School Tracker rellenará
automáticamente con los datos reales (encabezado, indicador, criterios y
estudiantes con sus notas cualitativas), conservando TODO tu diseño.

HERRAMIENTAS VÁLIDAS
- Microsoft Excel o LibreOffice Calc: guardar como .xlsx.
- Google Sheets: Archivo > Descargar > Microsoft Excel (.xlsx).

DÓNDE GUARDAR LA PLANTILLA
En la carpeta que abre el botón "Carpeta" de este modal:
  Documentos/SchoolTrackerPro/Plantillas/
La app la detecta sola y aparece en la lista desplegable.

TIPOS DE INSTRUMENTO (según el nombre del archivo)
El NOMBRE del archivo .xlsx debe contener la palabra clave del tipo:
  ...Rubrica... / ...Rúbrica...  -> Rúbrica
  ...Cotejo...                   -> Lista de cotejo
  ...Escala...                   -> Escala valorativa
Ejemplos válidos: "Rubrica_MINED.xlsx", "Mi cotejo de lectura.xlsx",
"Escala semestral.xlsx". Sin palabra clave = se trata como Escala.

SELECCIÓN AUTOMÁTICA
Cada indicador tiene un tipo configurado (selector en este modal; solo se
muestran los tipos que tienen plantilla en la carpeta). Al pulsar XLS, la app
usa automáticamente la plantilla cuyo nombre coincida con ese tipo. Si
prefieres otra, selecciónala manualmente en el desplegable.

REGLA DE ORO
- Todo marcador debe estar COMPLETO dentro de una sola celda.
- Guarda siempre como .xlsx (no .xls, no .ods).

PASO 1 — ENCABEZADO (filas libres arriba)
Diseña tu encabezado como quieras (colores, logo, celdas combinadas) y coloca
estos marcadores donde correspondan:
  {COLEGIO}   {ANO}   {CORTE}   {ASIGNATURA}   {GRADO}   {SECCION}
  {IND_ORDEN}  -> número del indicador
  {IND_TEXTO}  -> texto del indicador
  {CRITERIOS_LISTA} -> lista numerada "1. descripción (puntos)" de todos los criterios

PASO 2 — FILA REPETIBLE DE ESTUDIANTES
Elige UNA fila que servirá de plantilla para cada estudiante. En su PRIMERA
celda escribe exactamente la bandera: {{FILAS}}
En las demás celdas de esa misma fila coloca estos marcadores:
  {NUM}      -> número correlativo (1, 2, 3...)
  {NOMBRE}   -> nombre del estudiante
  {SEXO}     -> M o F
  {LETRA_1}  -> nota cualitativa del criterio 1 (AA, AS, AF, AI o vacía)
  {LETRA_2}  -> criterio 2 ... {LETRA_N} según cantidad de criterios
  {VAL_IND}  -> valoración cualitativa del indicador completo

La app CLONará esa fila una vez por estudiante, manteniendo su formato, y
correrá hacia abajo todo lo que esté debajo.

REGLAS IMPORTANTES
1. NO uses celdas combinadas DENTRO de la fila repetible (encima sí).
2. Los marcadores no deben dividirse entre varias celdas.
3. Un solo bloque {{FILAS}} por hoja. Puedes tener varias hojas.
4. Deja unas filas libres entre el encabezado y la fila bandera si necesitas espacio.

EJEMPLO DE MAQUETACIÓN
  Fila 1-4: título, {COLEGIO}, {GRADO}-{SECCION}, {CORTE}
  Fila 5:   {IND_ORDEN}. {IND_TEXTO}
  Fila 6:   Criterios: {CRITERIOS_LISTA}
  Fila 8:   {{FILAS}} | {NUM} | {NOMBRE} | {LETRA_1} | {LETRA_2} | {VAL_IND}

RESULTADO
Guarda tu plantilla en la carpeta "SchoolTrackerPro/Plantillas" (botón
"Carpeta" del modal). Al pulsar XLS, la app rellena esa plantilla y entrega
un .xlsx idéntico a tu diseño pero con todos los datos reales, listo para
imprimir. Se guarda en Documentos/SchoolTrackerPro/Instrumentos.`;

  async function copiarAyudaPlantilla() {
    try {
      await navigator.clipboard.writeText(AYUDA_PLANTILLA_XLSX);
      await emit("show-toast", { message: "📋 Instrucciones copiadas al portapapeles", type: "success" });
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = AYUDA_PLANTILLA_XLSX;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        await emit("show-toast", { message: "📋 Instrucciones copiadas al portapapeles", type: "success" });
      } catch (e) {
        await emit("show-toast", { message: "❌ No se pudo copiar automáticamente", type: "error" });
      }
    }
  }

  async function generarTodosInstrumentos() {
    if (indicadores.length === 0) return;
    generatingPdf = true;
    try {
      const inputs = indicadores.map(buildInstrumentoInput);
      await generarInstrumentosTodosPDF(inputs);
      await emit("show-toast", { message: `✅ ${inputs.length} instrumentos generados`, type: "success" });
    } catch (e) {
      console.error('[Instrumentos] Error generación masiva:', e);
      await emit("show-toast", { message: "❌ Error generando instrumentos: " + e, type: "error" });
    } finally { generatingPdf = false; }
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
    currentStudentIdx = 0;
  });

  $effect(() => {
    const s = searchTerm;
    currentStudentIdx = 0;
  });

  $effect(() => {
    const n = filteredNotas;
    if (n.length > 0 && currentStudentIdx >= n.length) {
      currentStudentIdx = n.length - 1;
    } else if (n.length === 0) {
      currentStudentIdx = 0;
    }
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
    if (selectedGrado && selectedColegio && selectedAno) { fetchSecciones(); }
    else { secciones = []; selectedSeccion = 0; }
  });

  async function loadNotas(ano: number, corte: number, colegio: number, asignatura: number, grado: number, seccion: number) {
    if (!(ano > 0 && corte > 0 && colegio > 0 && asignatura > 0 && grado > 0 && seccion > 0)) {
      console.debug(`[NotasPage] loadNotas SKIPPED: ano=${ano} corte=${corte} colegio=${colegio} asignatura=${asignatura} grado=${grado} seccion=${seccion}`);
      return;
    }
    console.debug(`[NotasPage] loadNotas CALLED: ano=${ano} corte=${corte} colegio=${colegio} asignatura=${asignatura} grado=${grado} seccion=${seccion}`);
    const currentLoadId = ++loadId;
    loading = true;
    try {
      const [currentIndicadores, estudiantesData, notasData] = await Promise.all([
        fetchConfiguracionEvaluacion(true, false),
        invoke<Estudiante[]>("get_estudiantes_by_filters", { gradoId: grado, seccionId: seccion }),
        invoke<{ estudianteId: number; criterioId: number; valor: number }[]>("get_notas_by_filters", { gradoId: grado, seccionId: seccion, corteId: corte, asignaturaId: asignatura })
      ]);
      if (currentLoadId !== loadId) return;
      // Las columnas (`indicadores`) se escriben acá y no dentro de
      // fetchConfiguracionEvaluacion a propósito. Ahí quedaban en un lote de render
      // ANTERIOR al de `fetchEstudiantes`, y como hay un `await` de por medio Svelte
      // no los agrupaba: al cambiar de sección se veía la tabla con los
      // indicadores de la sección nueva arriba y las notas de la anterior abajo,
      // y recién en el segundo render aparecía todo junto. Ahora ambas
      // escrituras caen en el mismo tick.
      indicadores = currentIndicadores;
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
    }
  });

  $effect(() => {
    if (refreshTrigger > 0 && !hasUnsavedRef && !loading && selectedAno > 0 && selectedCorte > 0 && selectedColegio > 0 && selectedAsignatura > 0 && selectedGrado > 0 && selectedSeccion > 0) {
      refreshTrigger = 0;
      fetchEstudiantes(undefined, true);
    }
  });

  // Refresco silencioso al volver a verse (transición oculto → visible)
  let wasVisible = visible;
  $effect(() => {
    const nowVisible = visible;
    const prev = wasVisible;
    wasVisible = nowVisible;
    if (!nowVisible || prev) return;
    if (!hasUnsavedRef && selectedAno > 0 && selectedCorte > 0 && selectedColegio > 0 && selectedAsignatura > 0 && selectedGrado > 0 && selectedSeccion > 0) {
      nextRefreshSilent = true;
      refreshTrigger++;
    }
  });

  onMount(() => {
    fetchGradeConfigs();
    fetchMultiplicadores();
    fetchCatalogs();
    // Cargar configuraciones syncronizables
    loadAppSettings().then(s => {
      highlightColor = s.highlightColor;
      showAnoDropdown = s.showAnoDropdown;
    });
    const unsubSettings = onAppSettingsChange(s => {
      highlightColor = s.highlightColor;
      showAnoDropdown = s.showAnoDropdown;
    });

    const checkMobile = () => {
      const portrait = window.innerHeight > window.innerWidth;
      // En Android: portrait => vista de cards; landscape => vista desktop (tabla).
      // En el resto: responsivo por ancho.
      isMobile = isAndroid ? portrait : (window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const onResizeScrollArea = () => updateNotasScrollHeight();
    window.addEventListener('resize', onResizeScrollArea);
    window.visualViewport?.addEventListener('resize', onResizeScrollArea);

    // Safety: force load if catalogs chain didn't trigger it
    const forceLoadTimer = setTimeout(() => {
      if (selectedAno > 0 && selectedCorte > 0 && selectedColegio > 0 && selectedAsignatura > 0 && selectedGrado > 0 && selectedSeccion > 0 && estudiantes.length === 0) {
        console.debug('[NotasPage] Force-loading notas (fallback timer)');
        nextRefreshSilent = true;
        refreshTrigger++;
      }
    }, 2000);

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
      unsubSettings();
      clearTimeout(forceLoadTimer);
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('resize', onResizeScrollArea);
      window.visualViewport?.removeEventListener('resize', onResizeScrollArea);
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

<div class="page-container notas-page-root" style="height: 100%; min-height: 0;">
  <div class="category-grid" style="display: flex; flex-direction: column; height: 100%;">
    {#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder="Buscar estudiante o nota..." />{/if}
    <div style="{isAndroid && isMobile ? 'position: sticky; top: 0; z-index: 50; background: #0f172a; padding-bottom: 0.2rem; margin-bottom: 0.3rem;' : ''}">
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
              bind:value={selectedCorte}>
              {#each cortes as c}
                <option value={c.id}>{c.nombre}</option>
              {/each}
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">Asignatura:</label>
            <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
              value={selectedAsignatura}
              onchange={(e) => { selectedAsignatura = Number((e.currentTarget as HTMLSelectElement).value); localStorage.setItem('notas-last-asignatura', String(selectedAsignatura)); }}>
              {#each asignaturas as a}
                <option value={a.id}>{a.nombre}</option>
              {/each}
            </select>
          </div>
        {/snippet}
      </FiltersModalAndroid>

      {#if !isAndroidMobile}
      <FilterContainer {isMobile}>
        {#if showAnoDropdown}
        <FilterGroup label="Año Lectivo:" {isMobile}>
          <SelectChip
            value={selectedAno}
            onchange={(v) => { selectedAno = Number(v); }}
            options={anos.map(a => ({ value: a.id, label: a.nombre }))} />
        </FilterGroup>
        {/if}

        <FilterGroup label="Corte:" {isMobile}>
          <SelectChip
            value={selectedCorte}
            onchange={(v) => { selectedCorte = Number(v); }}
            options={cortes.map(c => ({ value: c.id, label: c.nombre }))} />
        </FilterGroup>

        <FilterGroup label="Colegio:" {isMobile}>
          <SelectChip
            value={selectedColegio}
            onchange={(v) => { selectedColegio = Number(v); }}
            options={colegios.map(col => ({ value: col.id, label: col.nombre }))} />
        </FilterGroup>

        <FilterGroup label="Grado:" {isMobile}>
          <SelectChip
            value={selectedGrado}
            onchange={(v) => { selectedGrado = Number(v); localStorage.setItem('notas-last-grado', String(selectedGrado)); }}
            options={grados.map(g => ({ value: g.id, label: g.nombre }))} />
        </FilterGroup>

        <FilterGroup label="Sección:" {isMobile}>
          <SelectChip
            value={selectedSeccion}
            onchange={(v) => { selectedSeccion = Number(v); }}
            options={secciones.map(s => ({ value: s.id, label: s.nombre }))} />
        </FilterGroup>

        <FilterGroup label="Sexo:" {isMobile}>
          <SelectChip
            value={selectedSexo}
            onchange={(v) => { selectedSexo = String(v); }}
            options={[
              { value: '', label: 'Todos' },
              { value: 'M', label: 'Masculino' },
              { value: 'F', label: 'Femenino' },
            ]} />
        </FilterGroup>

        <FilterGroup label="Asignatura:" {isMobile}>
          <SelectChip
            value={selectedAsignatura}
            onchange={(v) => { selectedAsignatura = Number(v); localStorage.setItem('notas-last-asignatura', String(selectedAsignatura)); }}
            options={asignaturas.map(a => ({ value: a.id, label: a.nombre }))} />
        </FilterGroup>

          <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'};{isMobile ? 'overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;' : ''}">
            <BotonMod bind:ref={popAccionesBtn} opts={{
              onclick: togglePopAcciones,
              icono: popAcciones ? '✕' : '⋯', etiqueta: 'Acciones', tono: 'violeta',
              sub: `${activeIndicadores.length} activos · ${filteredNotas.length} notas`,
              title: 'Instrumentos, distribuir y eliminar notas',
            }} />

            <BotonMod opts={{
              onclick: undo, disabled: history.length === 0,
              icono: '↩️', etiqueta: 'Deshacer', tono: 'ambar',
              sub: history.length === 0 ? 'Sin cambios' : `${history.length} en historial`,
              title: 'Deshacer (Ctrl+Z)',
            }} />
            <BotonMod opts={{
              onclick: redo, disabled: redoStack.length === 0,
              icono: '↪️', etiqueta: 'Rehacer', tono: 'ambar',
              sub: redoStack.length === 0 ? 'Nada que rehacer' : `${redoStack.length} por rehacer`,
              title: 'Rehacer (Ctrl+Y)',
            }} />
            <BotonMod opts={{
              onclick: handleGuardarNotas,
              disabled: !hasUnsavedChanges || saving || estudiantes.length === 0,
              icono: saving ? '⏳' : '💾', etiqueta: saving ? 'Guardando' : 'Guardar', tono: 'verde',
              sub: saving ? 'Escribiendo en la BD' : (hasUnsavedChanges ? `${cambiosPendientes} cambios` : 'Sin cambios'),
              title: 'Guardar Notas (Ctrl+G)',
            }} />
          </div>

      </FilterContainer>
      {/if}

      {#if isAndroidMobile}
        <div class="category-card" style="padding: 0.4rem 0.5rem; margin-top: 0.4rem;">
          <SearchFab bind:value={searchTerm} placeholder="Buscar estudiante o nota..." conMargen={false} />
        </div>
        <div class="category-card" style="padding: 0.5rem; margin-top: 0.4rem; display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
          <button type="button" onclick={() => { showFiltersModal = true; }}
            style="height:38px;padding:0 0.8rem;font-size:0.78rem;background:rgba(96,165,250,0.18);color:#bfdbfe;border:1px solid rgba(96,165,250,0.4);border-radius:8px;display:flex;align-items:center;justify-content:center;gap:5px;font-weight:600;cursor:pointer;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            <span>🔍</span>
              <span style="overflow:hidden;text-overflow:ellipsis;">
                {(colegios.find(c => c.id === selectedColegio)?.nombre)?.split(' ')[0] || 'Colegio'} · {grados.find(g => g.id === selectedGrado)?.nombre || 'Grado'} · {secciones.find(s => s.id === selectedSeccion)?.nombre || 'Sección'} · {cortes.find(c => c.id === selectedCorte)?.nombre || 'Corte'}{selectedSexo ? ` · ${selectedSexo === 'M' ? 'Masc' : 'Fem'}` : ''}
              </span>
          </button>
        </div>
        <div class="category-card" style="padding: 0.5rem; margin-top: 0.3rem; display:flex;gap:0.3rem;align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
          <BotonMod bind:ref={popAccionesBtn} opts={{
            onclick: togglePopAcciones,
            icono: popAcciones ? '✕' : '⋯', etiqueta: 'Acciones', tono: 'violeta',
            sub: `${activeIndicadores.length}/${indicadores.length} · ${filteredNotas.length}`,
            title: 'Instrumentos, distribuir y eliminar notas', compacto: true
          }} />

          <!-- Guardar va antes que Deshacer/Rehacer: es la acción que se usa en
               cada cambio de nota, así que queda a la vista sin scrollear, igual
               que en Asistencia. El orden de escritorio no cambia. -->
          <BotonMod opts={{
            onclick: handleGuardarNotas,
            disabled: !hasUnsavedChanges || saving || estudiantes.length === 0,
            icono: saving ? '⏳' : '💾', etiqueta: saving ? 'Guardando' : 'Guardar', tono: 'verde',
            sub: saving ? 'Escribiendo en la BD' : (hasUnsavedChanges ? `${cambiosPendientes} cambios` : 'Sin cambios'),
            title: 'Guardar Notas (Ctrl+G)', compacto: true
          }} />
          <BotonMod opts={{
            onclick: undo, disabled: history.length === 0,
            icono: '↩️', etiqueta: 'Deshacer', tono: 'ambar',
            sub: history.length === 0 ? 'Sin cambios' : `${history.length} en historial`,
            title: 'Deshacer (Ctrl+Z)', compacto: true
          }} />
          <BotonMod opts={{
            onclick: redo, disabled: redoStack.length === 0,
            icono: '↪️', etiqueta: 'Rehacer', tono: 'ambar',
            sub: redoStack.length === 0 ? 'Nada que rehacer' : `${redoStack.length} por rehacer`,
            title: 'Rehacer (Ctrl+Y)', compacto: true
          }} />
        </div>

      {/if}

      <!-- Mobile: Card View -->
      {#if isMobile && !loading && estudiantes.length > 0}
        <!-- Top Elements Wrapper -->
        <div class="category-card" style="width: 100%; max-width: 100%; display: flex; flex-direction: column; padding: 0.3rem; flex-shrink: 0; margin-top: 0.5rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem; margin-bottom: 0.3rem; background: rgba(15, 23, 42, 0.6); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); user-select: none; flex-shrink: 0;">
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

          {#if filteredNotas[currentStudentIdx]}
            {@const est = filteredNotas[currentStudentIdx]}
            <div style="margin-bottom: 0; padding: 0.6rem; border-radius: 12px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(34, 197, 94, 0.3); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                  <div style="color: #94a3b8; font-weight: bold; font-size: 0.85rem;">Nota Final</div>
                  <div style="display: flex; align-items: center; gap: 0.4rem;">
                    {#if !isQualitative}
                      <span title="Escala 0-100" style="font-size: 0.9rem; color: #e2e8f0;">{(() => {
                        const rawFinal = activeIndicadores.reduce((sum, ind) => sum + ind.criterios.reduce((s, c) => {
                          const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                          if (qv && ['AA','AS','AF','AI'].includes(qv)) return s + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                          return s;
                        }, 0), 0);
                        const maxTotal = activeIndicadores.reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
                        return maxTotal > 0 ? Math.round((rawFinal / maxTotal) * 100) : 0;
                      })()}</span>
                    {/if}
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
      {/if}
    </div>

    {#if loading}
      <div style="text-align: center; padding: {isMobile ? '0.5rem' : '2rem'}; font-size: {isMobile ? '0.75rem' : '1rem'};">Cargando datos...</div>
    {/if}

    <!-- Mobile: Card View -->
    {#if isMobile && !loading && estudiantes.length > 0}
      <!-- Indicators Wrapper -->
      <div class="category-card" style="flex: 1; min-height: 0; width: 100%; max-width: 100%; display: flex; flex-direction: column; padding: 0.3rem;">
        <div bind:this={notasScrollRef} style="flex: 1; overflow: auto; padding: 0 0.15rem; -webkit-overflow-scrolling: touch; height: {notasScrollHeight};"
          ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
          {#if filteredNotas[currentStudentIdx]}
            {@const est = filteredNotas[currentStudentIdx]}
            <div>
              {#each indicadoresSeccion as ind}
                <div style="margin-bottom: 0.5rem; border-radius: 12px; border: 1px solid {ind.activo ? 'rgba(var(--primary-rgb), 0.25)' : 'rgba(100,116,139,0.3)'}; background: {ind.activo ? 'rgba(30, 41, 59, 0.5)' : 'rgba(30, 41, 59, 0.28)'};">
                  <div style="padding: 0.4rem 0.6rem; background: rgba(30, 41, 59, 0.95); backdrop-filter: blur(8px); border-bottom: 1px solid {ind.activo ? 'rgba(var(--primary-rgb), 0.15)' : 'rgba(100,116,139,0.2)'}; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; border-top-left-radius: 11px; border-top-right-radius: 11px;">
                    <div
                      role="button" tabindex="0"
                      onclick={(e) => abrirPopover('indicador', ind.id, 0, e)}
                      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPopover('indicador', ind.id, 0, e as unknown as MouseEvent); } }}
                      style="color: {ind.activo ? 'var(--text-secondary)' : '#64748b'}; font-weight: bold; font-size: 0.8rem; cursor: pointer;">
                      Indicador {ind.orden} ⚙{#if !ind.activo}<span style="font-size: 0.6rem; color: #64748b;"> · no suma</span>{/if}
                    </div>
                    <div style="color: {ind.activo ? (() => {
                      const totalInd = ind.criterios.reduce((sum, c) => {
                        const qv = notasCualitativas[`${est.estudianteId}-${c.id}`];
                        if (qv && ['AA','AS','AF','AI'].includes(qv)) return sum + Math.round(c.puntajeMaximo * (notaMapping[qv] || 0));
                        return sum;
                      }, 0);
                      const maxInd = ind.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0);
                      const esc = maxInd > 0 ? (totalInd / maxInd) * 100 : 0;
                      const qualGrade = isQualitative ? calcularNotaCualitativaFinal(ind.criterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')) : (getGradeFromScore(esc)?.id || 'AI');
                      return qualGrade ? getGradeColor(qualGrade) : '#94a3b8';
                    })() : '#64748b'}; font-weight: bold; font-size: 0.75rem; {ind.activo ? '' : 'opacity: 0.75;'}">
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
                      <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 0.3rem; display: flex; justify-content: space-between; align-items: center; gap: 0.4rem;">
                        <span
                          role="button" tabindex="0"
                          onclick={(e) => abrirPopover('criterio', ind.id, crit.id, e)}
                          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPopover('criterio', ind.id, crit.id, e as unknown as MouseEvent); } }}
                          style="cursor: pointer; text-align: left;">Criterio {crit.orden} ⚙{crit.descripcion ? ': ' + crit.descripcion : ''}</span>
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
                              const oldVal = notasCualitativas[currentKey] || '';
                              const newVal = isSelected ? '' : grade;
                              if (oldVal !== newVal) pushHistory({ ...notasCualitativas });
                              handleNotaChange(est.estudianteId, crit.id, newVal);
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
          <div style="font-size: 0.9rem; color: #94a3b8; display: flex; align-items: center; gap: 0.35rem;">
            <span title="Indicadores que suman en esta sección. Se cambia con el ⚙ de cada indicador." style="cursor: help;">Suman en esta sección:</span>
            <span style="font-weight: bold; color: {activeIndicadores.length > MAX_INDICADORES_ACTIVOS ? '#fbbf24' : '#fff'};">{activeIndicadores.length}/{MAX_INDICADORES_ACTIVOS}</span>
            {#if seccionTieneExcepciones}
              <span title="Esta sección tiene indicadores distintos a los globales. Usa ⚙ → Restablecer para volver a los valores por defecto." style="font-size: 0.7rem; color: #a78bfa; cursor: help;">· 📌 config propia de la sección</span>
            {/if}
            {#if indicadoresSeccion.length > activeIndicadores.length}
              <span title="Los indicadores inactivos también se muestran y se pueden calificar, pero sus notas NO suman al total de 100 pts ni los toca el modal de distribución." style="font-size: 0.7rem; color: #64748b;">· {indicadoresSeccion.length - activeIndicadores.length} no suman</span>
            {/if}
            {#if maxPuntosTotales !== 100}
              <span title="Con {activeIndicadores.length} indicadores el máximo real es {maxPuntosTotales} pts. La columna Final se muestra en escala 0-100." style="font-size: 0.7rem; color: #fbbf24;">· máx real {maxPuntosTotales} pts</span>
            {/if}
          </div>
        </div>

        <div class="notas-table-container" style="flex: 1; min-height: 0; overflow: auto; padding: 0; width: 100%; max-width: 100%; -webkit-overflow-scrolling: touch; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
          <table class="notas-table" style="width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; font-size: 0.7rem;">
            <thead style="position: sticky; top: 0; z-index: 100;">
              <tr style="background: #1e293b;">
                <th style="padding: 0.3rem; text-align: center; font-weight: bold; color: #94a3b8; position: sticky; left: 0; z-index: 110; background: #1e293b; border-bottom: 2px solid rgba(255,255,255,0.1); width: 35px;">Nº</th>
                <th style="padding: 0.3rem; text-align: left; font-weight: bold; color: #94a3b8; position: sticky; left: 35px; z-index: 110; background: #1e293b; border-bottom: 2px solid rgba(255,255,255,0.1); min-width: 130px; max-width: 150px;">Estudiante</th>
                {#each indicadoresSeccion as ind}
                  <th colspan={ind.criterios.length + 1} style="padding: 0.2rem; text-align: center; font-weight: bold; border-bottom: 2px solid {ind.activo ? 'rgba(255,255,255,0.1)' : 'rgba(100,116,139,0.25)'};">
                    <div
                      role="button" tabindex="0"
                      onclick={(e) => abrirPopover('indicador', ind.id, 0, e)}
                      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPopover('indicador', ind.id, 0, e as unknown as MouseEvent); } }}
                      title={ind.activo ? (ind.descripcion || `Indicador ${ind.orden}`) : `${ind.descripcion || `Indicador ${ind.orden}`} · INACTIVO: sus notas no suman al total de 100 pts`}
                      style="background: {ind.activo ? 'rgba(var(--primary-rgb), 0.15)' : 'rgba(100,116,139,0.08)'}; padding: 0.2rem; border-radius: 4px; border: 1px solid {ind.activo ? 'rgba(var(--primary-rgb), 0.4)' : 'rgba(100,116,139,0.3)'}; color: {ind.activo ? 'var(--text-secondary)' : '#64748b'}; cursor: pointer; {ind.activo ? '' : 'border-style: dashed;'} transition: all 0.15s ease;">
                      <div style="font-weight: bold; font-size: 0.7rem;">Ind. {ind.orden}{ind.activo ? '' : ' ·'} ⚙</div>
                    </div>
                  </th>
                {/each}
                <th title="Escala 0-100 (igual que el modal de distribución). Pasa el cursor sobre la nota para ver los puntos crudos." style="padding: 0.3rem; text-align: center; font-weight: bold; color: #4ade80; background: #1e293b; border-bottom: 2px solid rgba(34, 197, 94, 0.4); position: sticky; right: 0; z-index: 110; width: 60px;">
                  <div style="font-weight: bold; font-size: 0.7rem;">Final</div>
                  <div style="font-size: 0.55rem; color: #94a3b8;">{isQualitative ? 'Cual.' : '100'}</div>
                </th>
              </tr>
              <tr style="background: #1e293b;">
                <th style="position: sticky; left: 0; z-index: 110; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.1);"></th>
                <th style="position: sticky; left: 35px; z-index: 110; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.1);"></th>
                {#each indicadoresSeccion as ind}
                  {#each ind.criterios as crit}
                    <th
                      role="button" tabindex="0"
                      onclick={(e) => abrirPopover('criterio', ind.id, crit.id, e)}
                      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPopover('criterio', ind.id, crit.id, e as unknown as MouseEvent); } }}
                      title="{crit.descripcion || 'Sin descripción'} — clic para ver opciones del criterio"
                      style="padding: 0.2rem; text-align: center; color: {ind.activo ? '#94a3b8' : '#64748b'}; font-size: 0.65rem; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: pointer;">
                      <div style="font-weight: bold;">C{crit.orden} ⚙</div>
                      {#if !isQualitative}<div style="font-size: 0.55rem; color: {ind.activo ? '#4ade80' : '#64748b'};">{crit.puntajeMaximo}</div>{/if}
                    </th>
                  {/each}
                  <th style="padding: 0.2rem; text-align: center; color: {ind.activo ? '#94a3b8' : '#64748b'}; font-weight: bold; background: {ind.activo ? 'rgba(var(--primary-rgb), 0.08)' : 'rgba(100,116,139,0.06)'}; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="color: {ind.activo ? '#4ade80' : '#64748b'}; font-size: 0.6rem;">{ind.activo ? (isQualitative ? 'Cual.' : 'Tot') : 'no suma'}</div>
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
                  {#each indicadoresSeccion as ind}
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
                            hasUnsavedRef = true;
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
                        <div title={indicador.activo ? `Suma al total: ${totalIndicadorRedondeado} de ${maximoIndicador} pts` : `Indicador inactivo: ${totalIndicadorRedondeado} de ${maximoIndicador} pts — NO suma al total`} style="color: {displayColor}; font-size: 0.75rem; font-weight: bold; {indicador.activo ? '' : 'opacity: 0.75;'}">
                          {#if indicador.activo}
                            {isQualitative ? qualitativeGrade : `${totalIndicadorRedondeado}${qualitativeGrade ? ` (${qualitativeGrade})` : ''}`}
                          {:else}
                            <span style="font-size: 0.7rem;">{isQualitative ? qualitativeGrade || '—' : totalIndicadorRedondeado}</span>
                            <span style="display: block; font-size: 0.5rem; font-weight: 400; color: #64748b;">no suma</span>
                          {/if}
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
                      <div title="{totalFinal} de {maximoTotal} pts" style="color: {displayColor}; font-size: 0.8rem; font-weight: bold; padding: 0.15rem 0.3rem; border-radius: 4px; display: inline-block;">
                        {isQualitative ? qualitativeFinal : `${Math.round(totalEscaladoFinal)}${qualitativeFinal ? ` (${qualitativeFinal})` : ''}`}
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

    <!-- Popover de acciones (Instrumentos / Eliminar / Distribuir) -->
    {#if popAcciones}
      <div
        bind:this={popAccionesPanelEl}
        role="menu"
        style="position: fixed; z-index: 99995; left: {popAcciones.x}px; top: {popAcciones.y}px; width: 242px; background: rgba(20,24,31,0.97); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; box-shadow: 0 18px 40px -10px rgba(0,0,0,0.65); padding: 0.4rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px;">

        <button
          role="menuitem" disabled={indicadores.length === 0}
          onclick={() => accionPop(() => { showInstrumentosModal = true; })}
          title="Instrumentos de evaluación"
          style="width:100%;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.55rem;border-radius:9px;border:1px solid rgba(96,165,250,0.22);background:rgba(96,165,250,0.08);color:#bfdbfe;cursor:pointer;text-align:left;transition:all 0.15s ease;opacity:{indicadores.length === 0 ? 0.45 : 1};"
          onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(96,165,250,0.16)'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = 'rgba(96,165,250,0.08)'; }}>
          <span style="font-size:0.9rem;">📋</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:700;font-size:0.76rem;">Instrumentos</span>
            <span style="display:block;font-size:0.62rem;color:#94a3b8;">PDF y XLSX de los {activeIndicadores.length} de {indicadores.length} activos</span>
          </span>
        </button>

        <button
          role="menuitem" disabled={activeIndicadores.length === 0 || filteredNotas.length === 0}
          onclick={() => accionPop(() => { distribuirTargets = {}; distribuirOverwrite = true; showDistribuirModal = true; })}
          title="Distribuir notas automáticamente"
          style="width:100%;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.55rem;border-radius:9px;border:1px solid rgba(168,85,247,0.22);background:rgba(168,85,247,0.08);color:#e9d5ff;cursor:pointer;text-align:left;transition:all 0.15s ease;opacity:{activeIndicadores.length === 0 || filteredNotas.length === 0 ? 0.45 : 1};"
          onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(168,85,247,0.16)'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = 'rgba(168,85,247,0.08)'; }}>
          <span style="font-size:0.9rem;">✨</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:700;font-size:0.76rem;">Distribuir</span>
            <span style="display:block;font-size:0.62rem;color:#94a3b8;">Reparto automático de {activeIndicadores.length} activos</span>
          </span>
        </button>

        <button
          role="menuitem" disabled={estudiantes.length === 0}
          onclick={() => accionPop(() => {
            if (!selectedCorte || !selectedAsignatura) { emit("show-toast", { message: "⚠️ Seleccione un corte y asignatura primero", type: "warning" }); return; }
            deleteMode = 'all'; deleteStudentId = 0; deleteIndicatorId = 0; showDeleteModal = true;
          })}
          title="Eliminar notas"
          style="width:100%;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.55rem;border-radius:9px;border:1px solid rgba(239,68,68,0.22);background:rgba(239,68,68,0.08);color:#fecaca;cursor:pointer;text-align:left;transition:all 0.15s ease;opacity:{estudiantes.length === 0 ? 0.45 : 1};"
          onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.16)'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}>
          <span style="font-size:0.9rem;">🗑️</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:700;font-size:0.76rem;">Eliminar notas</span>
            <span style="display:block;font-size:0.62rem;color:#94a3b8;">Borra las {filteredNotas.length} notas del filtro actual</span>
          </span>
        </button>
      </div>
    {/if}

    <!-- Popover de indicador / criterio (anclado a la cabecera pulsada) -->
    {#if popover && popoverIndicador()}
      {@const indPop = popoverIndicador()}
      {@const critPop = popoverCriterio()}
      <div
        bind:this={popoverPanelEl}
        role="dialog" aria-label="Opciones"
        style="position: fixed; z-index: 99995; left: {Math.max(8, Math.min(popover.x, (typeof window !== 'undefined' ? window.innerWidth : 1920) - Math.max(228, popover.ancho + 12)))}px; top: {popover.y}px; min-width: 220px; max-width: 280px; background: rgba(20,24,31,0.97); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; box-shadow: 0 18px 40px -10px rgba(0,0,0,0.65); padding: 0.45rem; box-sizing: border-box;">
        {#if popover.tipo === 'indicador' && indPop && popover.modo === 'elegir'}
          <div style="padding: 0.35rem 0.5rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.3rem;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #f1f5f9;">Ya hay {MAX_INDICADORES_ACTIVOS} indicadores activos</div>
            <div style="font-size: 0.66rem; color: #64748b; line-height: 1.35;">Para activar el Indicador {indPop.orden}, elige cuál se desactiva. <strong style="color:#94a3b8;">No se borra nada:</strong> el que salga conserva sus notas.</div>
          </div>
          <div style="max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
            {#each activeIndicadores as cand (cand.id)}
              {@const nConNota = estudiantesConNota(cand)}
              {@const ptsCand = puntosDeIndicador(cand)}
              <button
                onclick={() => intercambiarActivo(indPop, cand)}
                disabled={procesandoAccion}
                title="Desactivar el Indicador {cand.orden} y activar el {indPop.orden}"
                style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.5rem; border-radius: 9px; border: 1px solid rgba(251,191,36,0.28); background: rgba(251,191,36,0.07); color: #fde68a; font-size: 0.74rem; cursor: pointer; text-align: left; transition: all 0.15s ease;">
                <span style="font-size: 0.85rem;">🔄</span>
                <span style="flex: 1; min-width: 0;">
                  <span style="display: block; font-weight: 700; font-size: 0.74rem;">Indicador {cand.orden} · {isQualitative ? 'cualitativo' : ptsCand + ' pts'}</span>
                  <span style="display: block; font-size: 0.62rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cand.descripcion || 'Sin descripción'}</span>
                </span>
                <span style="font-size: 0.6rem; padding: 0.1rem 0.3rem; border-radius: 5px; background: {nConNota > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)'}; color: {nConNota > 0 ? '#4ade80' : '#64748b'}; white-space: nowrap; flex-shrink: 0;" title={nConNota > 0 ? `Conserva ${nConNota} nota(s)` : 'Sin notas cargadas'}>
                  {nConNota > 0 ? `${nConNota} nota(s)` : 'vacío'}
                </span>
              </button>
            {/each}

          </div>
          <button
            onclick={cerrarPopover}
            style="width: 100%; margin-top: 0.35rem; padding: 0.4rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; font-size: 0.72rem; font-weight: 600; cursor: pointer;">Cancelar</button>
        {:else if popover.tipo === 'indicador' && indPop}
          {@const sumaEnSeccion = idsActivos.includes(indPop.id)}
          <div style="padding: 0.35rem 0.5rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.3rem;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #f1f5f9;">Indicador {indPop.orden}</div>
            <div style="font-size: 0.66rem; color: #64748b;">{indPop.descripcion || 'Sin descripción'} · {indPop.criterios.length} criterio(s) · {isQualitative ? 'cualitativo' : puntosDeIndicador(indPop) + ' pts'}</div>
            <div style="font-size: 0.62rem; color: #64748b; margin-top: 0.15rem;">{colegios.find(c => c.id === selectedColegio)?.nombre || '—'} · Sección <strong style="color:#94a3b8;">{secciones.find(s => s.id === selectedSeccion)?.nombre || '—'}</strong> · {sumaEnSeccion ? 'suma' : 'no suma'} aquí</div>
          </div>
          <button
            onclick={() => alternarActivoIndicador(indPop)}
            disabled={procesandoAccion}
            style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.55rem; border-radius: 9px; border: 1px solid {sumaEnSeccion ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.3)'}; background: {sumaEnSeccion ? 'rgba(251,191,36,0.1)' : 'rgba(34,197,94,0.1)'}; color: {sumaEnSeccion ? '#fbbf24' : '#4ade80'}; font-size: 0.78rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease;">
            <span style="font-size: 0.9rem;">{sumaEnSeccion ? '👁' : '✔'}</span>
            <span>{sumaEnSeccion ? 'Dejar de sumar aquí' : 'Sumar en esta sección'}</span>
          </button>
          <div style="font-size: 0.62rem; color: #64748b; padding: 0.2rem 0.55rem 0.35rem; line-height: 1.3;">
            {#if sumaEnSeccion}
              Deja de sumar en esta sección, pero conserva sus notas.
            {:else if activeIndicadores.length >= MAX_INDICADORES_ACTIVOS}
              Ya hay {MAX_INDICADORES_ACTIVOS} que suman aquí ({activeIndicadores.length}). Te pediré cuál dejar de sumar.
            {:else}
              Sumará sus notas en esta sección ({activeIndicadores.length} de {MAX_INDICADORES_ACTIVOS}).
            {/if}
          </div>
          {#if seccionTieneExcepciones}
            <button
              onclick={restablecerActivosSeccion}
              disabled={procesandoAccion}
              title="Borrar las excepciones de esta sección y volver a los valores globales"
              style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.55rem; border-radius: 9px; border: 1px solid rgba(148,163,184,0.3); background: rgba(148,163,184,0.08); color: #cbd5e1; font-size: 0.74rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease; margin-bottom: 0.3rem;">
              <span style="font-size: 0.85rem;">↩</span>
              <span>Restablecer a valores globales</span>
            </button>
          {/if}
          <button
            onclick={() => vaciarNotasIndicador(indPop)}
            disabled={procesandoAccion}
            style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.55rem; border-radius: 9px; border: 1px solid rgba(245,158,11,0.3); background: rgba(245,158,11,0.1); color: #fbbf24; font-size: 0.78rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease;">
            <span style="font-size: 0.9rem;">🧹</span>
            <span>Vaciar notas del indicador</span>
          </button>
          <div style="font-size: 0.62rem; color: #64748b; padding: 0.2rem 0.55rem 0.1rem; line-height: 1.3;">Deja las {indPop.criterios.length} columnas vacías para volver a llenarlas, solo en {cortes.find(c => c.id === selectedCorte)?.nombre || 'este corte'}. El indicador no se borra.</div>
        {:else if popover.tipo === 'criterio' && indPop && critPop}
          <div style="padding: 0.35rem 0.5rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.3rem;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #f1f5f9;">Criterio {critPop.orden} · Indicador {indPop.orden}</div>
            <div style="font-size: 0.66rem; color: #64748b;">{critPop.descripcion || 'Sin descripción'}{!isQualitative ? ' · máx ' + critPop.puntajeMaximo + ' pts' : ''}</div>
          </div>
          <div style="font-size: 0.68rem; color: #a78bfa; font-weight: 700; padding: 0.15rem 0.55rem 0.35rem; text-transform: uppercase; letter-spacing: 0.4px;">Aplicar nota a todos</div>
          <label style="display: flex; align-items: center; gap: 0.45rem; padding: 0.3rem 0.5rem 0.4rem 0.35rem; cursor: pointer;">
            <span class="switch" style="margin: 0;">
              <input type="checkbox" checked={aplicarSoloVacias} onchange={() => aplicarSoloVacias = !aplicarSoloVacias} />
              <span class="slider round" style="background: {aplicarSoloVacias ? 'linear-gradient(135deg, #38bdf8, #0284c7)' : 'rgba(255,255,255,0.12)'}; border-color: {aplicarSoloVacias ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
            </span>
            <span style="line-height: 1.2;">
              <span style="display: block; font-size: 0.7rem; color: #cbd5e1; font-weight: 500;">Solo celdas vacías</span>
              <span style="display: block; font-size: 0.62rem; color: {aplicarSoloVacias ? '#38bdf8' : '#94a3b8'};">{aplicarSoloVacias ? 'No sobrescribe lo escrito' : 'Sobrescribe todas'}</span>
            </span>
          </label>
          <div style="display: flex; gap: 4px; padding: 0 0.5rem 0.4rem;">
            {#each allowedQualitativeGrades as letra}
              <button
                onclick={() => aplicarNotaMasiva(indPop, critPop, letra)}
                disabled={procesandoAccion}
                style="flex: 1; padding: 0.32rem 0; border-radius: 7px; border: 2px solid {getGradeColor(letra)}; background: transparent; color: {getGradeColor(letra)}; font-weight: 800; font-size: 0.72rem; cursor: pointer; transition: all 0.15s ease;">{letra}</button>
            {/each}
          </div>
          <button
            onclick={() => eliminarCriterio(indPop, critPop)}
            disabled={procesandoAccion}
            style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.55rem; border-radius: 9px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #fca5a5; font-size: 0.78rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease; margin-top: 0.15rem;">
            <span style="font-size: 0.9rem;">🗑</span>
            <span>Eliminar este criterio</span>
          </button>
          <div style="font-size: 0.62rem; color: #64748b; padding: 0.2rem 0.55rem 0.1rem; line-height: 1.3;">Borra solo C{critPop.orden} de este indicador y todas sus notas en todos los cortes.</div>
        {/if}
      </div>
    {/if}

    <!-- Distribuir Modal -->
    {#if showDistribuirModal}
      <div class="distribuir-wrap" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div onclick={() => showDistribuirModal = false} style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"></div>
        <div class="distribuir-modal" style="position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 20px; padding: 1.25rem; width: auto; max-width: min(1240px, 97vw); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.6);">
          <div style="display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.5rem;">
            <div style="width: 44px; height: 44px; border-radius: 14px; background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.2); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;">✨</div>
            <div style="min-width: 0;">
              <h3 style="margin: 0; color: #f1f5f9; font-size: 1.15rem; font-weight: 700;">Distribuir notas automáticamente</h3>
               <p style="margin: 0.2rem 0 0; color: #94a3b8; font-size: 0.75rem;">{isQualitative ? `C1, C2${distribuirC3 ? ' y C3' : ''} = nota objetivo${distribuirC3 ? '' : ', C3 = AA'}. Solo AA, AS, AF disponibles.` : `Ingrese el porcentaje total deseado (0-100). C1, C2${distribuirC3 ? ' y C3' : ''} se calculan automáticamente.`}</p>
              {#if !isQualitative}
                <p style="margin: 0.25rem 0 0; color: #64748b; font-size: 0.68rem;">
                  💡 El desempeño nunca retrocede: siempre <strong style="color:#a78bfa;">C1 ≤ C2 ≤ C3</strong>. Cuando se puede, la letra más baja va al C1 y las más altas al C3, sin perder la nota pedida.
                </p>
              {/if}
              {#if contextoChips.some(c => c.label)}
                <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.4rem;">
                  {#each contextoChips as chip (chip.icon)}
                    {#if chip.label}
                      <span title="{chip.titulo}: {chip.label}" style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.18rem 0.5rem; border-radius: 999px; background: {chip.color}14; border: 1px solid {chip.color}33; font-size: 0.7rem; color: #e2e8f0; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;">
                        <span style="font-size: 0.75rem;">{chip.icon}</span>{chip.label}
                      </span>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <!-- Opciones: toggles (switch global de App.css) con su texto de estado -->
          <div style="display: flex; align-items: stretch; gap: 0.75rem; margin: 0.6rem 0 0.8rem; flex-wrap: wrap;">
            <label style="display: flex; align-items: center; gap: 0.55rem; padding: 0.4rem 0.75rem 0.4rem 0.55rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; cursor: pointer; transition: all 0.2s ease;">
              <span class="switch" style="margin: 0;">
                <input type="checkbox" checked={distribuirOverwrite} onchange={() => distribuirOverwrite = !distribuirOverwrite} />
                <span class="slider round" style="background: {distribuirOverwrite ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'rgba(255,255,255,0.12)'}; border-color: {distribuirOverwrite ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
              </span>
              <span style="line-height: 1.2;">
                <span style="display: block; font-size: 0.78rem; color: #cbd5e1; font-weight: 500;">Sobrescribir notas existentes</span>
                <span style="display: block; font-size: 0.68rem; color: {distribuirOverwrite ? '#a78bfa' : '#22c55e'};">{distribuirOverwrite ? 'Se reemplazarán todas las notas' : 'Solo se llenarán criterios vacíos'}</span>
              </span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.55rem; padding: 0.4rem 0.75rem 0.4rem 0.55rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; cursor: pointer; transition: all 0.2s ease;">
              <span class="switch" style="margin: 0;">
                <input type="checkbox" checked={distribuirC3} onchange={() => distribuirC3 = !distribuirC3} />
                <span class="slider round" style="background: {distribuirC3 ? 'linear-gradient(135deg, #f472b6, #db2777)' : 'rgba(255,255,255,0.12)'}; border-color: {distribuirC3 ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
              </span>
              <span style="line-height: 1.2;">
                <span style="display: block; font-size: 0.78rem; color: #cbd5e1; font-weight: 500;">Modificar también el C3</span>
                <span style="display: block; font-size: 0.68rem; color: {distribuirC3 ? '#f472b6' : '#f59e0b'};">{distribuirC3 ? 'C1, C2 y C3 se distribuyen' : 'C3 siempre será AA'}</span>
              </span>
            </label>
            {#if cortesPrecios.length > 0}
              <label style="display: flex; align-items: center; gap: 0.55rem; padding: 0.4rem 0.75rem 0.4rem 0.55rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; cursor: pointer; transition: all 0.2s ease;">
                <span class="switch" style="margin: 0;">
                  <input type="checkbox" checked={mostrarComparacion} onchange={() => mostrarComparacion = !mostrarComparacion} />
                  <span class="slider round" style="background: {mostrarComparacion ? 'linear-gradient(135deg, #a78bfa, #7c3aed)' : 'rgba(255,255,255,0.12)'}; border-color: {mostrarComparacion ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
                </span>
                <span style="line-height: 1.2;">
                  <span style="display: block; font-size: 0.78rem; color: #cbd5e1; font-weight: 500;">Comparar cortes previos</span>
                  <span style="display: block; font-size: 0.68rem; color: {cargandoComparacion ? '#a78bfa' : '#64748b'};">
                    {#if cargandoComparacion}⏳ Cargando notas anteriores…
                    {:else if mostrarComparacion}{cortesPrecios.length} columna{cortesPrecios.length > 1 ? 's' : ''} con la nota final
                    {:else}Nota final de cada corte anterior{/if}
                  </span>
                </span>
              </label>
            {/if}
          </div>
          <div style="overflow: auto; flex: 1; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
            <table class="tabla-distribuir" style="width: auto; max-width: 100%; margin: 0 auto; border-collapse: collapse; font-size: 0.78rem;">
              <thead>
                <tr style="position: sticky; top: 0; z-index: 1;">
                  <th class="col-idx" style="width: 30px; text-align: left; padding: 0.4rem 0.5rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">#</th>
                  <th style="min-width: 150px; text-align: left; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">Estudiante</th>
                  {#if mostrarComparacion}
                    {#each cortesPrecios as corte (corte.id)}
                      <th class="col-num" title={corte.nombre} style="text-align: center; padding: 0.3rem 0.3rem; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(167,139,250,0.15);">
                        <div style="font-size: 0.66rem; color: #a78bfa; font-weight: 700; white-space: nowrap;">{nombreCortoCorte(corte.nombre)}</div>
                        <div style="font-size: 0.5rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">corte</div>
                      </th>
                    {/each}
                  {/if}
                  <th class="col-num" title="Corte que se está distribuyendo: {corteActualNombre}" style="text-align: center; padding: 0.3rem 0.3rem; background: rgba(244,114,182,0.16); border-bottom: 2px solid rgba(244,114,182,0.5); border-left: 1px solid rgba(244,114,182,0.2); border-right: 1px solid rgba(244,114,182,0.2);">
                    <div style="font-size: 0.68rem; color: #fbcfe8; font-weight: 700; white-space: nowrap;">{nombreCortoCorte(corteActualNombre)}</div>
                    <div style="font-size: 0.5rem; color: #f472b6; text-transform: uppercase; letter-spacing: 0.3px;">corte actual</div>
                  </th>
                  <!-- Se quitó la columna "Meta" (solo cualitativo): repetía literalmente
                       la letra elegida en la columna "Nota objetivo" de la derecha, sin
                       aportar nada. Su sentido de "total objetivo" solo aplica a las notas
                       numéricas, y ese caso ya tiene su propia columna "Nuevo total". -->
                  <th class="col-num" title={isQualitative ? 'Nota final que quedará al aplicar la letra elegida' : 'Total que resultará de aplicar el nuevo total'} style="text-align: center; padding: 0.4rem 0.4rem; background: rgba(15, 23, 42, 0.95); color: #a78bfa; font-weight: 600; white-space: nowrap; border-bottom: 1px solid rgba(139,92,246,0.15);">{isQualitative ? 'Nueva Nota' : '→ Resultante'}</th>
                  <th class="col-num" style="text-align: center; padding: 0.4rem 0.4rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; white-space: nowrap; border-bottom: 1px solid rgba(255,255,255,0.06);">{isQualitative ? 'Nota objetivo' : 'Nuevo total'}</th>
                </tr>
              </thead>
              <tbody>
                {#each filteredNotas as est, idx}
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td class="col-idx" style="padding: 0.3rem 0.5rem; color: #64748b; text-align: left;">{idx + 1}</td>
                    <td title={est.estudianteNombre} style="padding: 0.3rem 0.6rem; color: #e2e8f0; font-weight: 500; white-space: nowrap;">{est.estudianteNombre}</td>
                    {#if mostrarComparacion}
                      {#each cortesPrecios as corte (corte.id)}
                        {@const pctPrevCorte = comparacionCortes[corte.id]?.[est.estudianteId] ?? null}
                        {@const gradePrevCorte = pctPrevCorte === null ? '' : (getGradeFromScore(pctPrevCorte)?.id || '')}
                          <td class="col-num" title="{corte.nombre}: {pctPrevCorte === null ? 'sin notas' : isQualitative ? gradePrevCorte : pctPrevCorte}" style="padding: 0.3rem 0.3rem; text-align: center; white-space: nowrap; font-size: 0.74rem; font-weight: 600; color: {isQualitative ? (gradePrevCorte ? getGradeColor(gradePrevCorte) : '#94a3b8') : colorPctAnterior(pctPrevCorte)};">

                          {#if pctPrevCorte === null}
                            —
                          {:else if isQualitative}
                            {gradePrevCorte || '—'}
                          {:else}
                            {pctPrevCorte}
                          {/if}
                        </td>
                      {/each}
                    {/if}
                    <td class="col-num" title="Nota final actual ({corteActualNombre})" style="padding: 0.3rem 0.3rem; text-align: center; white-space: nowrap; background: rgba(244,114,182,0.07); border-left: 1px solid rgba(244,114,182,0.2); border-right: 1px solid rgba(244,114,182,0.2);">
                      {#if isQualitative}
                        {@const qualValues = allCriterios.map(c => notasCualitativas[`${est.estudianteId}-${c.id}`] || '')}
                        {@const gradeActual = calcularNotaCualitativaFinal(qualValues) || getGradeFromScore(calcularPctActual(est.estudianteId))?.id || ''}
                        <span style="color: {gradeActual ? getGradeColor(gradeActual) : '#94a3b8'}; font-weight: 600;">{gradeActual || '—'}</span>
                      {:else}
                        {@const pctActual = calcularPctActual(est.estudianteId)}
                        {@const gradeActual = getGradeFromScore(pctActual)?.id || ''}
                        <span style="color: {gradeActual ? getGradeColor(gradeActual) : '#94a3b8'}; font-weight: 600;">{pctActual}</span>
                      {/if}
                    </td>
                    <td class="col-num" style="padding: 0.3rem 0.4rem; text-align: center; font-weight: 600; white-space: nowrap;">
                      {#if isQualitative}
                        <!-- "Nueva Nota": queda VACÍA hasta que se elige una letra.
                             Mostrar antes el equivalente de la nota actual era
                             engañoso: parecía un resultado ya calculado cuando en
                             realidad no se había tocado nada, y esa información
                             ya está en la columna "Nota final actual" de la
                             izquierda. El guion es el marcador de "vacío" que ya
                             usa el resto de la tabla para "sin datos". -->
                        {@const objetivoQual = distribuirTargets[est.estudianteId]?.trim().toUpperCase() || ''}
                        {@const gradePrev = allowedQualitativeGrades.includes(objetivoQual)
                          ? (previewQualitativeGrade(objetivoQual) || '')
                          : ''}
                        {#if gradePrev}
                          <span style="color: {getGradeColor(gradePrev)}; font-size:0.9rem;">{gradePrev}</span>
                        {:else}
                          <span style="color: #64748b;">—</span>
                        {/if}
                      {:else}
                        {@const pctPrev = calcularPctPreview(est.estudianteId, distribuirTargets[est.estudianteId])}
                        {@const gradePrevNum = getGradeFromScore(pctPrev)?.id || ''}
                        <span style="color: {gradePrevNum ? getGradeColor(gradePrevNum) : '#a78bfa'}">{pctPrev}</span>
                      {/if}
                    </td>
                    <td class="col-num" style="padding: 0.15rem 0.3rem; text-align: center; white-space: nowrap;">
                      {#if isQualitative}
                        <div style="display:flex;gap:3px;justify-content:center;flex-wrap:nowrap">
                           {#each allowedQualitativeGrades as grade}
                             {@const isSelected = distribuirTargets[est.estudianteId]?.trim().toUpperCase() === grade}
                            {@const gradeColor = getGradeColor(grade)}
                            <button
                              class="btn-grade"
                              onclick={() => {
                                distribuirTargets[est.estudianteId] = isSelected ? '' : grade;
                                distribuirTargets = distribuirTargets;
                              }}
                              style="width:34px;padding:0.2rem 0;border-radius:6px;border:2px solid {gradeColor};background:{isSelected ? gradeColor : 'transparent'};color:{isSelected ? '#fff' : gradeColor};font-weight:bold;font-size:0.72rem;cursor:pointer;text-align:center;transition:all 0.15s ease;"
                            >{grade}</button>
                          {/each}
                        </div>
                      {:else}
                        <input class="input-total" type="number" min="0" max="100" value={distribuirTargets[est.estudianteId] ?? ''}
                          use:regDistInput={est.estudianteId}
                          oninput={(e) => { const v = (e.target as HTMLInputElement).value; distribuirTargets[est.estudianteId] = v; distribuirTargets = distribuirTargets; }}
                          onkeydown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const dir = e.key === 'ArrowUp' ? -1 : 1; const next = filteredNotas[idx + dir]; if (next) distribuirInputs.get(next.estudianteId)?.focus(); } }}
                          style="width:62px;padding:0.25rem 0.3rem;border-radius:6px;border:1px solid rgba(139,92,246,0.3);background:rgba(15,23,42,0.6);color:#e2e8f0;font-size:0.78rem;text-align:center;outline:none;" />
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

    <!-- Instrumentos de evaluación -->
    {#if showInstrumentosModal}
      <div style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div onclick={() => showInstrumentosModal = false} style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);"></div>
        <div style="position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(14, 165, 233, 0.25); border-radius: 20px; padding: 1.75rem; width: min(560px, 94vw); max-height: 86vh; overflow-y: auto; box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.6);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem;">
            <h3 style="margin: 0; color: #f1f5f9; font-size: 1.15rem; font-weight: 700;">📋 Instrumentos de evaluación</h3>
            <button onclick={() => showInstrumentosModal = false} style="background: transparent; border: none; color: #64748b; font-size: 1.2rem; cursor: pointer;">✕</button>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
            <button onclick={generarTodosInstrumentos} disabled={generatingPdf}
              style="flex: 1; padding: 0.55rem; border-radius: 10px; border: none; background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; font-weight: 700; font-size: 0.8rem; cursor: pointer; opacity: {generatingPdf ? 0.6 : 1};">
              {generatingPdf ? '⏳ Generando…' : '📄 Generar todos'}
            </button>
            <button onclick={() => mostrarAyudaExcel = !mostrarAyudaExcel}
              style="padding: 0.55rem 0.8rem; border-radius: 10px; border: 1px dashed rgba(34,197,94,0.5); background: rgba(34,197,94,0.08); color: #86efac; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
              ❓ Ayuda Excel
            </button>
          </div>

          <!-- Plantilla Excel de la carpeta fija -->
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.65rem 0.8rem; background: rgba(34,197,94,0.07); border: 1px solid rgba(34,197,94,0.3); border-radius: 12px; margin-bottom: 1rem;">
            <span style="color: #86efac; font-weight: 700; font-size: 0.72rem;">📗 Plantilla:</span>
            {#if cargandoPlantillas}
              <span style="color:#64748b;font-size:0.72rem;">cargando…</span>
            {:else if plantillas.length === 0}
              <span style="color:#fbbf24;font-size:0.72rem;">Sin plantillas — abre la carpeta y copia tus .xlsx (nombre con Rubrica/Cotejo/Escala)</span>
            {:else}
              <select bind:value={plantillaSel}
                style="flex: 1; min-width: 180px; padding: 0.3rem 0.4rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(15,23,42,0.8); color: #e2e8f0; font-size: 0.72rem; outline: none;">
                <option value="">(Auto — según el tipo del indicador)</option>
                {#each plantillas as p (p.ruta)}
                  <option value={p.nombre}>{p.tipo === 'rubrica' ? '🟣 Rúbrica' : p.tipo === 'cotejo' ? '🟢 Cotejo' : '🔵 Escala'} — {p.nombre}</option>
                {/each}
              </select>
            {/if}
            <button onclick={abrirCarpetaDePlantillas} title="Abrir carpeta de plantillas"
              style="padding: 0.3rem 0.6rem; border-radius: 8px; border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.12); color: #86efac; cursor: pointer; font-size: 0.68rem; font-weight: 700; flex-shrink: 0;">📂 Carpeta</button>
            <button onclick={() => void recargarPlantillas()} disabled={cargandoPlantillas} title="Recargar lista"
              style="padding: 0.3rem 0.5rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.68rem; flex-shrink: 0;">↻</button>
          </div>

          {#if mostrarAyudaExcel}
            <div style="margin-bottom: 1rem; border: 1px solid rgba(34,197,94,0.35); border-radius: 12px; overflow: hidden;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.6rem 0.8rem; background: rgba(34,197,94,0.1);">
                <span style="color: #86efac; font-weight: 700; font-size: 0.75rem;">📗 Cómo crear tu plantilla en Excel</span>
                <button onclick={copiarAyudaPlantilla}
                  style="padding: 0.3rem 0.6rem; border-radius: 6px; border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.15); color: #86efac; cursor: pointer; font-size: 0.65rem; font-weight: 700; flex-shrink: 0;">
                  📋 Copiar instrucciones
                </button>
              </div>
              <pre style="white-space: pre-wrap; margin: 0; padding: 0.8rem; background: rgba(0,0,0,0.3); color: #cbd5e1; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.62rem; line-height: 1.55;">{AYUDA_PLANTILLA_XLSX}</pre>
            </div>
          {/if}

          {#each indicadoresSeccion as ind (ind.id)}
            {@const tipoActual = normTipo((ind as any).instrumento)}
            {@const disponibles = INSTRUMENTO_TIPOS.filter(t => plantillas.some(p => p.tipo === t.id))}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.7rem; background: {ind.activo ? 'rgba(255,255,255,0.03)' : 'rgba(100,116,139,0.06)'}; border: 1px solid {ind.activo ? 'rgba(255,255,255,0.06)' : 'rgba(100,116,139,0.22)'}; border-radius: 12px; margin-bottom: 0.45rem; flex-wrap: wrap;">
              <span style="width: 26px; height: 26px; border-radius: 8px; background: {ind.activo ? 'rgba(14,165,233,0.15)' : 'rgba(100,116,139,0.15)'}; color: {ind.activo ? '#7dd3fc' : '#94a3b8'}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.72rem; flex-shrink: 0;">{ind.orden}</span>
              <div style="flex: 1; min-width: 140px;">
                <div style="color: {ind.activo ? '#e2e8f0' : '#94a3b8'}; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{ind.descripcion || '(Sin descripción)'}{#if !ind.activo}<span style="font-size: 0.62rem; color: #64748b;"> · no suma al total</span>{/if}</div>
                <div style="color: #64748b; font-size: 0.65rem;">{ind.criterios.length} criterio(s)</div>
              </div>
              <select value={disponibles.some(t => t.id === tipoActual) ? tipoActual : (disponibles[0]?.id ?? tipoActual)}
                onchange={(e) => setInstrumento(ind, (e.target as HTMLSelectElement).value as InstrumentoTipo)}
                disabled={disponibles.length === 0}
                title={disponibles.length === 0 ? 'No hay plantillas en la carpeta Plantillas' : ''}
                style="padding: 0.3rem 0.4rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(15,23,42,0.8); color: {disponibles.length === 0 ? '#64748b' : '#e2e8f0'}; font-size: 0.72rem; outline: none; max-width: 150px;">
                {#each disponibles as op}
                  <option value={op.id}>{op.label}</option>
                {/each}
              </select>
              <button onclick={() => generarPDFInstrumento(ind)} disabled={generatingPdf}
                title="Generar PDF de este instrumento"
                style="padding: 0.35rem 0.6rem; border-radius: 8px; border: 1px solid rgba(14,165,233,0.35); background: rgba(14,165,233,0.12); color: #7dd3fc; cursor: pointer; font-size: 0.7rem; font-weight: 700; flex-shrink: 0;">PDF</button>
              <button onclick={() => generarExcelInstrumento(ind)} disabled={excelGenerating}
                title="Generar desde tu plantilla Excel (.xlsx) con marcadores"
                style="padding: 0.35rem 0.55rem; border-radius: 8px; border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.12); color: #86efac; cursor: pointer; font-size: 0.68rem; font-weight: 700; flex-shrink: 0;">XLS</button>
            </div>
          {:else}
            <div style="text-align: center; padding: 1rem; color: #64748b; font-size: 0.8rem;">No hay indicadores configurados</div>
          {/each}

          <p style="margin: 0.75rem 0 0; color: #64748b; font-size: 0.68rem; text-align: center;">
            El instrumento se guarda por indicador y se sincroniza entre dispositivos. Los PDF se generan con las notas actuales.
          </p>

          <!-- Guía plantilla Excel -->
          <div style="margin-top: 0.75rem; padding: 0.7rem 0.8rem; background: rgba(34,197,94,0.06); border: 1px dashed rgba(34,197,94,0.35); border-radius: 12px;">
            <div style="color: #86efac; font-weight: 700; font-size: 0.72rem; margin-bottom: 0.4rem;">📗 Plantilla propia en Excel</div>
            <p style="margin: 0 0 0.4rem; color: #94a3b8; font-size: 0.68rem; line-height: 1.5;">
              Diseña tu formato en Excel y escribe estos marcadores donde quieras los datos.
              El botón <span style="color:#86efac;font-weight:700;">XLS</span> rellena tu archivo
              <span style="color:#e2e8f0;">conservando todo tu diseño</span> (bordes, colores, logo, celdas combinadas).
            </p>
            <div style="font-family: monospace; font-size: 0.62rem; color: #86efac; line-height: 1.6;">
              {'{COLEGIO}'} {'{ANO}'} {'{CORTE}'} {'{ASIGNATURA}'} {'{GRADO}'} {'{SECCION}'}<br>
              {'{IND_ORDEN}'} {'{IND_TEXTO}'} {'{CRITERIOS_LISTA}'}
            </div>
            <p style="margin: 0.4rem 0 0; color: #94a3b8; font-size: 0.66rem; line-height: 1.5;">
              <span style="color:#e2e8f0;">Fila de estudiantes:</span> en una fila escribe
              <span style="font-family: monospace; color:#86efac;">{'{{FILAS}}'}</span> en la primera celda (bandera) y en las demás:
              <span style="font-family: monospace; color:#86efac;">{'{NUM} {NOMBRE} {SEXO} {LETRA_1} {LETRA_2} … {VAL_IND}'}</span>.
              Esa fila se clona por estudiante. Evita celdas combinadas dentro de esa fila.
            </p>
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
                  <select value={deleteStudentId} onchange={(e) => deleteStudentId = Number((e.currentTarget as HTMLSelectElement).value)} onclick={(e) => e.stopPropagation()}
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
                  <select value={deleteIndicatorId} onchange={(e) => deleteIndicatorId = Number((e.currentTarget as HTMLSelectElement).value)} onclick={(e) => e.stopPropagation()}
                    style="width: 100%; margin-top: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 0.82rem; cursor: pointer; outline: none;">
                    <option value={0}>Seleccione indicador...</option>
                    {#each indicadoresSeccion.filter(i => i.activo) as ind}
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
            <button onclick={handleDeleteNotas} disabled={deleting}
              style="padding: 0.6rem 1.4rem; border-radius: 10px; background: {deleting ? 'rgba(239, 68, 68, 0.5)' : 'linear-gradient(135deg, #ef4444, #dc2626)'}; border: none; color: white; font-weight: 700; font-size: 0.85rem; cursor: {deleting ? 'not-allowed' : 'pointer'}; transition: all 0.2s ease; box-shadow: {deleting ? 'none' : '0 4px 14px rgba(239, 68, 68, 0.35)'};">
              {deleting ? 'Eliminando...' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>
    {/if}



    </div>
</div>
