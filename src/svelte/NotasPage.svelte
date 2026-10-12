<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { loadAppSettings, onAppSettingsChange } from "../lib/appSettings";
import { primerColegio } from "../lib/catalogo";
  import FilterContainer from "./FilterContainer.svelte";
  import BotonMod from "./BotonMod.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SelectChip from "./SelectChip.svelte";
  import ModoToggle from "./ModoToggle.svelte";
  import SearchFab from "./SearchFab.svelte";
  import FiltersModalAndroid from "./FiltersModalAndroid.svelte";
  import { generarInstrumentoPDF, generarInstrumentosTodosPDF, INSTRUMENTO_OPS, type InstrumentoInput, type InstrumentoTipo } from "../lib/instrumentosPdf";
  import { generarInstrumentoExcel, listarPlantillas, asegurarCarpetaPlantillas, abrirCarpetaPlantillas, plantillasDir, type ExcelInstrumentoInput } from "../lib/instrumentosExcel";
  import { readFile } from "@tauri-apps/plugin-fs";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { registerBackHandler } from "../lib/androidBack";
  // OJO al importar `t`: en este archivo ya hubo dos `const t = ev.target`
  // (renombrados a `nodo`). Si vuelve a aparecer una variable llamada `t`
  // en un scope donde se llama `t('clave')`, el error de runtime apunta a la
  // línea equivocada y es un infierno de depurar.
  import { t } from "../lib/i18n.svelte";

  // --- Imports used only by the report half ("reportes" mode) ---
  import {
    rutaExportAbsoluta,
    subcarpetaRelativa,
    destinoParaToast,
  } from "../lib/carpetasExport";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { unirRuta, aFileURL } from "../lib/platform";
  import { colorSexo, colorSexoExport } from "../lib/coloresSexo.svelte";
  import { generarPdfNotas } from "../lib/notasPdf";
  
  import { portalToBody } from "../lib/portalToBody";

  // `visible`: the container page is active AND this mode is the selected one.
  // `modo`: which half of this component renders ("registrar" | "reportes").
  // The ModoToggle in the filter bar owns the UI and reports the change through
  // `onModoChange`; the state itself lives in the wrapper (NotasMainPage).
  let {
    visible = true,
    modo = "registrar",
    onModoChange = () => {},
  }: {
    visible?: boolean;
    modo?: "registrar" | "reportes";
    onModoChange?: (id: "registrar" | "reportes") => void;
  } = $props();

  // Report mode is read-only: it renders the report and never writes grades.
  // Both halves keep their OWN filter state (repSelected*), so switching modes
  // restores exactly what each one had selected, and the draft typed in
  // "registrar" survives a round trip through the reports.
  let enReporte = $derived(modo === "reportes");

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface Criterio { id: number; orden: number; descripcion: string; puntajeMaximo: number; }
  interface Indicador { id: number; orden: number; descripcion: string; activo: boolean; instrumento?: string; criterios: Criterio[]; }
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

  let corteActualNombre = $derived(cortes.find(c => c.id === selectedCorte)?.nombre || t('notas.filtro.corteActual'));

  /** Chips de contexto del header del modal: colegio, grado, sección y asignatura (con el color de acento de cada categoría). */
  let contextoChips = $derived([
    { icon: '🏫', color: '#34d399', titulo: t('notas.chip.colegio'), label: colegios.find(c => c.id === selectedColegio)?.nombre || '' },
    { icon: '📊', color: '#fb923c', titulo: t('notas.chip.grado'), label: grados.find(g => g.id === selectedGrado)?.nombre || '' },
    { icon: '👥', color: '#a78bfa', titulo: t('notas.chip.seccion'), label: secciones.find(s => s.id === selectedSeccion)?.nombre || '' },
    { icon: '📚', color: '#60a5fa', titulo: t('notas.chip.asignatura'), label: asignaturas.find(a => a.id === selectedAsignatura)?.nombre || '' },
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
      await emit('show-toast', { message: t('notas.dist.errorPrevias', { msg: e instanceof Error ? e.message : String(e) }), type: 'error' });
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

  let refreshTrigger = $state(0);

  let notasCualitativas: Record<string, string> = $state({});

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
      // `nodo` y no `t`: el nombre `t` taparía la función de traducción `t()`
      // importada en este componente (ver AGENTS.md, trampas del i18n).
      const nodo = ev.target as Node | null;
      // Clic sobre el propio disparador: no cerrar aquí, lo hace su onclick.
      if (nodo && popAccionesBtn?.contains(nodo)) return;
      if (nodo && popAccionesPanelEl?.contains(nodo)) return;
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
      // `nodo` y no `t`: ver la nota en el handler equivalente de arriba.
      const nodo = ev.target as Node | null;
      if (nodo && (popoverPanelEl?.contains(nodo) || popoverTriggerEl?.contains(nodo))) return;
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
    const nombreSeccion = secciones.find(s => s.id === selectedSeccion)?.nombre || t('notas.alcanceSeccion');
    const ok = await ask(
      nuevoEstado
        ? t('notas.activo.sumarMsg', { n: ind.orden, seccion: nombreSeccion })
        : t('notas.activo.noSumarMsg', { n: ind.orden, seccion: nombreSeccion }),
      {
        title: nuevoEstado ? t('notas.activo.activarTitulo') : t('notas.activo.desactivarTitulo'),
        kind: 'info',
        okLabel: nuevoEstado ? t('notas.activo.activarBtn') : t('notas.activo.desactivarBtn'),
        cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      await invoke('set_indicador_colegio_seccion_activo', { colegioId: selectedColegio, seccionId: selectedSeccion, indicadorId: ind.id, activo: nuevoEstado });
      await cargarActivosDeSeccion(selectedSeccion);
      await emit("show-toast", { message: t('notas.activo.exito', { n: ind.orden, estado: nuevoEstado ? t('notas.activo.exitoSuma') : t('notas.activo.exitoNoSuma'), seccion: nombreSeccion }), type: 'success' });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: t('notas.errorGenerico', { msg: String(e) }), type: "error" });
    } finally { procesandoAccion = false; }
  }

  /** Vuelve a que esta sección use los indicadores globales por defecto. */
  async function restablecerActivosSeccion() {
    const n = seccionTieneExcepciones ? activeIndicadores.length : 0;
    const ok = await ask(
      t('notas.reestablecer.msg', { n }),
      {
        title: t('notas.reestablecer.titulo'), kind: 'info',
        okLabel: t('notas.reestablecer.btn'), cancelLabel: t('comun.cancelar'),
      }
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
      await emit("show-toast", { message: t('notas.reestablecer.exito', { n: borradas }), type: 'success' });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: t('notas.errorGenerico', { msg: String(e) }), type: "error" });
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
        message: t('notas.intercambio.excesoPts', { n: nuevo.orden, pts: ptsNuevo, max: MAX_PTS_POR_INDICADOR }),
        type: 'error'
      });
      return;
    }
    cerrarPopover();
    const conNotaSaliente = estudiantesConNota(saliente);
    // IMPORTANTE: el texto es placeholder ({nuevo}, {puntosNuevo}…), NO template
    // literal. Antes estaba como `${...}`/`{...}` mezclado y salía "En esta
    // sección: {nuevo.orden} suma" a la vista del usuario (faltaba el `$`).
    const ok = await ask(
      t('notas.intercambio.msg', {
        ordenNuevo: nuevo.orden,
        descNuevo: nuevo.descripcion || '',
        puntosNuevo: isQualitative ? t('notas.intercambio.cualitativo') : `${ptsNuevo} pts`,
        ordenSaliente: saliente.orden,
        descSaliente: saliente.descripcion || '',
        conserva: conNotaSaliente > 0 ? t('notas.intercambio.conserva', { n: conNotaSaliente }) : '',
        max: MAX_INDICADORES_ACTIVOS,
        total: isQualitative ? '' : `${MAX_INDICADORES_ACTIVOS * MAX_PTS_POR_INDICADOR} pts`,
      }),
      {
        title: t('notas.intercambio.titulo'), kind: 'info',
        okLabel: t('notas.intercambio.btn'), cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      await invoke('set_indicador_colegio_seccion_activo', { colegioId: selectedColegio, seccionId: selectedSeccion, indicadorId: saliente.id, activo: false });
      await invoke('set_indicador_colegio_seccion_activo', { colegioId: selectedColegio, seccionId: selectedSeccion, indicadorId: nuevo.id, activo: true });
      await cargarActivosDeSeccion(selectedSeccion);
      await emit("show-toast", { message: t('notas.intercambio.exito', { nuevo: nuevo.orden, saliente: saliente.orden }), type: 'success' });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: t('notas.intercambio.error', { msg: String(e) }), type: "error" });
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
      await emit("show-toast", { message: t('notas.vaciar.previo'), type: 'warning' });
      return;
    }
    const nombreCorte = cortes.find(c => c.id === selectedCorte)?.nombre || t('notas.filtro.corteActual');
    const conNota = notas.filter(n => ind.criterios.some(c => notasCualitativas[`${n.estudianteId}-${c.id}`])).length;
    const ok = await ask(
      t('notas.vaciar.msg', {
        criterios: ind.criterios.length,
        orden: ind.orden,
        descripcion: ind.descripcion || '',
        corte: nombreCorte,
        asignatura: asignaturas.find(a => a.id === selectedAsignatura)?.nombre || t('notas.chip.asignatura'),
        estudiantes: conNota,
      }),
      {
        title: t('notas.vaciar.titulo'), kind: 'warning',
        okLabel: t('notas.vaciar.btn'), cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      const corteId = selectedCorte;
      const asignaturaId = selectedAsignatura;
      const borradas = await invoke<number>('vaciar_notas_indicador', { id: ind.id, corteId, asignaturaId });
      // Imprescindible: el comando borra en local y deja tombstones, pero SIN
      // esto no se dispara ni el push a D1 ni el respaldo a Drive. Las notas
      // vaciadas volverían del otro dispositivo en el próximo pull.
      onDataChange('nota', { immediate: true });
      await emit("show-toast", { message: t('notas.vaciar.exito', { orden: ind.orden, n: borradas, corte: nombreCorte }), type: 'success' });
      await recargarIndicadoresYNotas();
    } catch (e) {
      await emit("show-toast", { message: t('notas.vaciar.error', { msg: String(e) }), type: "error" });
    } finally { procesandoAccion = false; }
  }

  /** Elimina un solo criterio (una columna) con todas sus notas. */
  async function eliminarCriterio(ind: Indicador, crit: Criterio) {
    cerrarPopover();
    const conNota = notas.filter(n => notasCualitativas[`${n.estudianteId}-${crit.id}`]).length;
    const ok = await ask(
      t('notas.criterio.msg', {
        c: crit.orden,
        i: ind.orden,
        notas: conNota,
        estudiantes: filteredNotas.length,
      }),
      {
        title: t('notas.criterio.titulo'), kind: 'warning',
        okLabel: t('notas.criterio.btn'), cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    procesandoAccion = true;
    try {
      await invoke('delete_criterio', { id: crit.id });
      // Mismo motivo que en "vaciar notas": sin `onDataChange` el tombstone del
      // criterio y de sus notas queda local, y el criterio reaparece al bajar
      // desde otro dispositivo.
      onDataChange('nota', { immediate: true });
      onDataChange('criterio', { immediate: true });
      await emit("show-toast", { message: t('notas.criterio.exito', { n: crit.orden }), type: 'success' });
      await recargarIndicadoresYNotas();
    } catch (e) {
      await emit("show-toast", { message: t('notas.criterio.error', { msg: String(e) }), type: "error" });
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
      t('notas.masiva.msg', {
        letra,
        c: crit.orden,
        i: ind.orden,
        n: destino.length,
        alcance: soloVacias ? t('notas.masiva.soloVacias') : t('notas.masiva.sobrescribe'),
      }),
      {
        title: t('notas.masiva.titulo', { letra }), kind: 'info',
        okLabel: t('notas.masiva.btn', { letra }), cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    pushHistory({ ...notasCualitativas });
    for (const n of destino) handleNotaChange(n.estudianteId, crit.id, letra);
    await emit("show-toast", { message: t('notas.masiva.exito', { letra, n: destino.length, c: crit.orden }), type: 'success' });
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
      // Colegio: no hay predeterminado, se toma el primero alfabético.
      const activeColegio = primerColegio(colegiosData)?.id || 0;
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
      await emit("show-toast", { message: t('notas.guardar.incompletas'), type: 'error' });
      return;
    }
    for (const notaEst of notasActualizadas) {
      for (const indicador of indicadoresSeccion) {
        if (!indicador.activo) continue;
        if (isQualitative) continue;
        const totalIndicador = calcularTotalIndicador(notaEst.notas, indicador);
        if (totalIndicador > 20) {
          await emit("show-toast", { message: t('notas.guardar.maxPts', { nombre: notaEst.estudianteNombre, pts: totalIndicador, n: indicador.orden }), type: 'error' });
          return;
        }
      }
    }
    const okGuardar = await ask(t('notas.guardar.confirmar'), { title: t('notas.guardar.titulo'), kind: "info", okLabel: t('comun.guardar'), cancelLabel: t('comun.cancelar') });
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
          ? t('notas.guardar.okBorrados', { n: totalBorrados })
          : t('notas.guardar.okSimple'),
        type: 'success'
      });
      onDataChange('nota', { immediate: true });

      setTimeout(() => fetchEstudiantes(undefined, true), 200);
    } catch (error) {
      console.error("Error saving notes:", error);
      await emit("show-toast", { message: t('notas.guardar.error', { msg: String(error) }), type: "error" });
      saving = false;
    }
  }

  // Delete
  async function handleDeleteNotas() {
    if (deleteMode === 'student' && !deleteStudentId) { await emit("show-toast", { message: t('notas.del.selUnEstudiante'), type: "warning" }); return; }
    if (deleteMode === 'indicator' && !deleteIndicatorId) { await emit("show-toast", { message: t('notas.del.selUnIndicador'), type: "warning" }); return; }
    const mensaje = deleteMode === 'all'
      ? t('notas.del.confirmarTodas')
      : deleteMode === 'student'
        ? t('notas.del.confirmarEstudiante', { nombre: filteredNotas.find(n => n.estudianteId === deleteStudentId)?.estudianteNombre || '' })
        : t('notas.del.confirmarIndicador', { indicador: indicadores.find(i => i.id === deleteIndicatorId) ? t('notas.indicador', { n: indicadores.find(i => i.id === deleteIndicatorId)!.orden }) : t('notas.del.indicadorSel') });
    const ok = await ask(mensaje, { title: t('notas.del.confirmarTitulo'), kind: "warning", okLabel: t('notas.del.confirmarOk'), cancelLabel: t('comun.cancelar') });
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
      await emit("show-toast", { message: t('notas.del.ok'), type: "success" });
      savedBaseline = {};
      history = [];
      redoStack = [];
      hasUnsavedRef = false;
      if (pendingRefreshOnSave) { pendingRefreshOnSave = false; nextRefreshSilent = true; refreshTrigger++; }
      onDataChange('nota', { immediate: true });
      setTimeout(() => fetchEstudiantes(undefined, true), 200);
    } catch (error) {
      console.error("Error deleting notas:", error);
      await emit("show-toast", { message: t('notas.del.error', { msg: String(error) }), type: "error" });
    } finally { deleting = false; }
  }

  // ── Instrumentos de evaluación ──
  // $derived, no const: si fuera const se evaluaría una sola vez al montar y las
  // opciones del selector no cambiarían de idioma al cambiar el idioma de la app.
  const INSTRUMENTO_TIPOS: { id: InstrumentoTipo; label: string }[] = $derived(
    INSTRUMENTO_OPS.map(o => ({ id: o.id as InstrumentoTipo, label: t(`notas.tipo.${o.id}`) }))
  );

  const normTipo = (v: any): InstrumentoTipo =>
    ['cotejo', 'escala', 'rubrica'].includes(v) ? v : 'escala';

  // OJO: el parámetro se llama `tipo`, no `t` — `t()` es la función de i18n.
  function labelTipo(tipo: InstrumentoTipo): string {
    return INSTRUMENTO_TIPOS.find(o => o.id === tipo)?.label ?? tipo;
  }

  async function setInstrumento(ind: Indicador, tipo: InstrumentoTipo) {
    try {
      await invoke('update_indicador', { id: ind.id, descripcion: ind.descripcion, activo: ind.activo, instrumento: tipo });
      indicadores = indicadores.map(i => i.id === ind.id ? { ...i, instrumento: tipo } : i);
      await emit("show-toast", { message: t('notas.inst.ok', { n: ind.orden, label: t(`notas.tipo.${tipo}`) }), type: "success" });
      emit("indicadores-updated");
    } catch (e) {
      await emit("show-toast", { message: t('notas.inst.error', { msg: String(e) }), type: "error" });
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

  // Función, no `const`: el texto depende del idioma activo, así que hay que
  // pedirlo en cada uso (un `const` se evaluaría una sola vez al montar y el
  // panel de ayuda no cambiaría de idioma hasta recargar).
  const ayudaPlantillaTexto = () => t('notas.ayudaPlantilla');

  async function copiarAyudaPlantilla() {
    try {
      await navigator.clipboard.writeText(ayudaPlantillaTexto());
      await emit("show-toast", { message: t('notas.ayudaCopiada'), type: "success" });
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = ayudaPlantillaTexto();
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

// ===========================================================================
// Report half - READ-ONLY report mode ("reportes"), formerly ReportesPage.svelte.
// Every local here is prefixed with "rep" because both halves live in one
// component: they read different sources and keep their own filters. Shared
// with the grade-entry half: searchTerm, showAnoDropdown, gradeConfigs,
// multiplicadores, notaMapping and the qualitative-scale helpers.
// ===========================================================================

  interface EstudianteRep { id: number; nombre: string; sexo: string; grado: string; seccion: string; }
  interface EstudianteReporte extends EstudianteRep {
    notasIndicadores: Record<number, number>;
    notasCualitativasIndicadores: Record<number, string>;
    notasCriterios?: Record<number, number>;
    notaFinal: number;
    notaFinalCualitativa?: string;
  }


  let repAnos: CategoryItem[] = $state([]);
  let repCortes: CategoryItem[] = $state([]);
  let repColegios: CategoryItem[] = $state([]);
  let repAsignaturas: CategoryItem[] = $state([]);
  let repGrados: CategoryItem[] = $state([]);
  let repSecciones: CategoryItem[] = $state([]);

  let repSelectedAno = $state(0);
  let repSelectedCorte = $state(0);
  let specialCorte = $state("");
  let repSelectedColegio = $state(0);
  let repSelectedAsignatura = $state(0);
  let repSelectedGrado = $state(0);
  let repSelectedSeccion = $state(0);
  let repSelectedSexo = $state("");

  let repEstudiantes: EstudianteReporte[] = $state([]);
  let configIndicadores: Indicador[] = $state([]);
  let repLoading = $state(false);
  let repRefreshTrigger = $state(0);
  let repSilentRefresh = $state(false);
  let activeSlide = $state<'estadisticas'>('estadisticas');
  let repIsMobile = $state(false);
  let repIsAndroid = $state(false);
  const repIsAndroidMobile = $derived(repIsAndroid || (repIsMobile && !isWindows));
  let repShowFiltersModal = $state(false);
  $effect(() => {
    if (repShowFiltersModal) {
      return registerBackHandler(() => { repShowFiltersModal = false; return true; });
    }
  });
  let printHtml: string | null = $state(null);
  let exportandoMasivo = $state(false);
  let expandedStudentId = $state(-1);
  let progresoMasivo = $state('');
  let repLoadId = 0;

  let repIsQualitative = $derived.by(() => {
    const grado = repGrados.find(g => g.id === repSelectedGrado);
    const asignatura = repAsignaturas.find(a => a.id === repSelectedAsignatura);
    return (grado?.cualitativo || false) || (asignatura?.cualitativo || false);
  });


  let filteredReporte = $derived.by(() => {
    if (!searchTerm) return repEstudiantes;
    const term = searchTerm.toLowerCase();
    return repEstudiantes.filter(est => est.nombre.toLowerCase().includes(term));
  });

  let totalPuntajeMaximoConfig = $derived(
    configIndicadores.reduce((total, ind) => {
      if (!ind.activo) return total;
      return total + ind.criterios.reduce((sum, crit) => sum + (crit.puntajeMaximo || 0), 0);
    }, 0)
  );

  let estudiantesConNotas = $derived(repEstudiantes.filter(e => e.notaFinal >= 0));
  let tieneEstudiantesConNotas = $derived(estudiantesConNotas.length > 0);
  let promedioGrupalNum = $derived.by(() => {
    if (!tieneEstudiantesConNotas) return 0;
    return estudiantesConNotas.reduce((s, e) => s + e.notaFinal, 0) / estudiantesConNotas.length;
  });
  let promedioGrupalLabel = $derived.by(() => {
    if (!tieneEstudiantesConNotas) return "-";
    if (repIsQualitative) return calcularNotaCualitativaFinal(estudiantesConNotas.map(e => e.notaFinalCualitativa || 'AI'));
    const lbl = getQualitativeLabel(promedioGrupalNum);
    return `${Math.round(promedioGrupalNum)}${lbl ? ` (${lbl})` : ''}`;
  });
  let promedioGrupalColor = $derived.by(() => {
    if (!tieneEstudiantesConNotas) return '#64748b';
    let lab: string | undefined;
    if (repIsQualitative) lab = calcularNotaCualitativaFinal(estudiantesConNotas.map(e => e.notaFinalCualitativa || 'AI'));
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


  function getNoteColor(score: number, label?: string, maxScore?: number): string {
    if (repIsQualitative && label) {
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

  let selectedNames = $derived.by(() => {
    let corteNombre = repCortes.find(c => c.id === repSelectedCorte)?.nombre || "";
    if (specialCorte === "1S") corteNombre = "1er Semestre";
    else if (specialCorte === "2S") corteNombre = "2do Semestre";
    else if (specialCorte === "NF") corteNombre = "Nota Final";
    return {
      ano: repAnos.find(a => a.id === repSelectedAno)?.nombre || "",
      corte: corteNombre,
      colegio: repColegios.find(c => c.id === repSelectedColegio)?.nombre || "",
      asignatura: repAsignaturas.find(a => a.id === repSelectedAsignatura)?.nombre || "",
      grado: repGrados.find(g => g.id === repSelectedGrado)?.nombre || "",
      seccion: repSecciones.find(s => s.id === repSelectedSeccion)?.nombre || ""
    };
  });

  /** Subtítulo del botón "PDF colegio": a qué colegio aplica. */
  let subtituloColegio = $derived(selectedNames.colegio || t('rep.subtitulo.todosGrados'));
  /** Subtítulo del botón "Exportar Todo": cuántos colegios entran. */
  let subtituloTodos = $derived(
    repColegios.length === 0
      ? t('rep.subtitulo.todosColegios')
      : t(repColegios.length === 1 ? 'rep.subtitulo.colegio' : 'rep.subtitulo.colegios', { n: repColegios.length })
  );

  onMount(() => {
    const checkMobile = () => { repIsMobile = window.innerWidth <= 768; repIsAndroid = /Android/i.test(navigator.userAgent); };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('schooltracker-sync', () => { repSilentRefresh = true; repRefreshTrigger++; });
    // Cargar configuraciones syncronizables
    loadAppSettings().then(s => { showAnoDropdown = s.showAnoDropdown; });
    const unsubSettings = onAppSettingsChange(s => { showAnoDropdown = s.showAnoDropdown; });

    const unsubGradeConfigs = listen("grade-configs-updated", async () => {
      try { gradeConfigs = await invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs"); } catch (e) { console.error("Error refreshing grade configs:", e); }
      try { multiplicadores = await invoke<{ id: string; multiplicador: number }[]>("get_multiplicadores"); } catch (e) { console.error("Error refreshing multiplicadores:", e); }
    });
    const unsubNotas = listen("notas-updated", () => { repSilentRefresh = true; repRefreshTrigger++; });
    const unsubStudents = listen("student-updated", () => { repSilentRefresh = true; repRefreshTrigger++; });
    const unsubCatalogs = listen("catalog-updated", () => { repSilentRefresh = true; repRefreshTrigger++; });

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
    if (repSelectedColegio > 0 && repSelectedAno > 0) repFetchGradosYAsignaturas();
    else { repGrados = []; repAsignaturas = []; repSelectedGrado = 0; repSelectedAsignatura = 0; }
  });

  $effect(() => {
    if (repSelectedGrado > 0 && repSelectedColegio > 0 && repSelectedAno > 0) repFetchSecciones();
    else { repSecciones = []; repSelectedSeccion = 0; }
  });

  $effect(() => {
    if (repCortes.length > 0 && repSelectedGrado > 0 && repSelectedSeccion > 0 && (repSelectedCorte > 0 || specialCorte) && repSelectedAsignatura > 0) {
      if (repRefreshTrigger > 0) repRefreshTrigger = 0;
      const lid = ++repLoadId;
      if (!repSilentRefresh) repLoading = true;
      repSilentRefresh = false;
      fetchReporte(lid).finally(() => { if (repLoadId === lid) repLoading = false; });
    } else {
      repRefreshTrigger = 0;
      repEstudiantes = []; configIndicadores = []; repLoading = false; repSilentRefresh = false;
    }
  });

  // Refresco silencioso al volver a verse (transición oculto → visible)
  let repWasVisible = visible;
  $effect(() => {
    const nowVisible = visible;
    const prev = repWasVisible;
    repWasVisible = nowVisible;
    if (!nowVisible || prev) return;
    repSilentRefresh = true;
    repRefreshTrigger++;
  });

  /**
   * Indicadores que suman en el colegio + seccion indicados (con la herencia
   * del global que aplica el backend). Devuelve null si el backend no
   * responde, para poder seguir con el `activo` global en vez de vaciar el
   * reporte. OJO: no usar `untrack` fuera de un efecto; aqui es una lectura normal.
   *
   * `corteId` es EXPLICITO a propósito. Antes usaba `selectedCorte`, que vale 0
   * cuando hay un corte agregado seleccionado (1S/2S/NF): la consulta volvía
   * vacía y el reporte sumaba todos los indicadores en vez de los activos,
   * descuadrando el máximo de puntos.
   */
  async function idsActivosDe(colegioId: number, seccionId: number, gradoId: number, corteId: number): Promise<number[] | null> {
    if (colegioId <= 0 || seccionId <= 0 || gradoId <= 0) return null;
    if (corteId <= 0) return null;
    try {
      return await invoke<number[]>('get_indicadores_activos_colegio_seccion', {
        colegioId,
        seccionId,
        gradoId,
        asignaturaId: repSelectedAsignatura,
        corteEvaluativoId: corteId
      });
    } catch (e) {
      console.error('[Reportes] No se pudieron cargar los indicadores activos:', e);
      return null;
    }
  }

  /**
   * Unión de los indicadores activos de los cortes que cubre el reporte.
   *
   * Cada corte tiene sus PROPIOS indicadores (ids distintos), así que en un
   * semestre entran los activos del 1er más los del 2do. El máximo de puntos
   * del reporte se recalcula a partir de ese conjunto (ver `maxPtsPar`), por
   * lo que un semestre puede legítimamente sumar 200 pts.
   *
   * Si ningún corte devuelve datos, se mantiene null para que el llamador use
   * el fallback por el flag `activo` global, como antes.
   */
  async function idsActivosDeCortes(
    colegioId: number, seccionId: number, gradoId: number, cortesIds: number[]
  ): Promise<number[] | null> {
    if (cortesIds.length === 1) return idsActivosDe(colegioId, seccionId, gradoId, cortesIds[0]);
    const porCorte = await Promise.all(
      cortesIds.map(cId => idsActivosDe(colegioId, seccionId, gradoId, cId))
    );
    if (porCorte.every(r => r === null)) return null;
    const union = new Set<number>();
    for (const r of porCorte) if (r) for (const id of r) union.add(id);
    return Array.from(union);
  }

  /**
   * Cortes que abarca el reporte: uno solo, o los que componen el agregado
   * elegido (1S = 1er+2do, 2S = 3er+4to, NF = todos).
   *
   * Estaba duplicado literalmente en `fetchReporte` y en `exportarPdfs`; ahora
   * hay una sola definición y ambos caminos comparten la misma lógica.
   */
  function resolverCortesIds(): number[] {
    if (specialCorte === "1S") {
      const c1 = repCortes.find(c => c.nombre.toLowerCase().includes("1er"))?.id;
      const c2 = repCortes.find(c => c.nombre.toLowerCase().includes("2do"))?.id;
      return [c1, c2].filter((x): x is number => !!x);
    }
    if (specialCorte === "2S") {
      const c3 = repCortes.find(c => c.nombre.toLowerCase().includes("3er"))?.id;
      const c4 = repCortes.find(c => c.nombre.toLowerCase().includes("4to"))?.id;
      return [c3, c4].filter((x): x is number => !!x);
    }
    if (specialCorte === "NF") return repCortes.map(c => c.id);
    return repSelectedCorte > 0 ? [repSelectedCorte] : [];
  }

  async function fetchInitialCatalogs() {
    try {
      const [anosData, cortesData, colegiosData, configsData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_cortes"),
        invoke<CategoryItem[]>("get_colegios"),
        invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs"),
      ]);
      const activeAno = anosData.length > 0 ? (anosData.find(a => a.activo)?.id || anosData[0].id) : 0;
      const activeCorte = cortesData.length > 0 ? (cortesData.find(c => c.activo)?.id || cortesData[0].id) : 0;
      const activeColegio = primerColegio(colegiosData)?.id || 0;
      repAnos = anosData;
      repCortes = cortesData;
      repColegios = colegiosData;
      gradeConfigs = configsData;
      try { multiplicadores = await invoke<{ id: string; multiplicador: number }[]>("get_multiplicadores"); } catch (e) { console.error("Error fetching multiplicadores:", e); }
      repSelectedAno = activeAno;
      repSelectedCorte = activeCorte;
      repSelectedColegio = activeColegio;
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: t('rep.error.catalogos', { msg: String(error) }), type: "error" });
    }
  }

  async function repFetchGradosYAsignaturas() {
    try {
      const [gradosData, asignaturasData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: repSelectedColegio, anoLectivoId: repSelectedAno }),
        invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: repSelectedColegio }),
      ]);
      let finalAsignaturas = asignaturasData;
      if (asignaturasData.length === 0) {
        try { finalAsignaturas = await invoke<CategoryItem[]>("get_all_subjects"); } catch {}
      }
      repGrados = gradosData;
      if (gradosData.length > 0 && !gradosData.some(g => g.id === repSelectedGrado)) repSelectedGrado = gradosData[0].id || 0;
      else if (gradosData.length === 0) repSelectedGrado = 0;
      let filteredAsignaturas = finalAsignaturas;
      if (repSelectedGrado > 0) {
        try {
          const subjectsByGrade = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: repSelectedGrado });
          if (subjectsByGrade.length > 0) filteredAsignaturas = subjectsByGrade.filter(sg => finalAsignaturas.some(ca => ca.id === sg.id));
        } catch {}
      }
      repAsignaturas = filteredAsignaturas;
      if (filteredAsignaturas.length > 0 && !filteredAsignaturas.some(a => a.id === repSelectedAsignatura)) repSelectedAsignatura = filteredAsignaturas[0].id || 0;
      else if (filteredAsignaturas.length === 0) repSelectedAsignatura = 0;
    } catch (error) {
      console.error("Error fetching grados y asignaturas:", error);
      await emit("show-toast", { message: t('rep.error.gradosAsig', { msg: String(error) }), type: "error" });
    }
  }

  async function repFetchSecciones() {
    try {
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: repSelectedGrado, colegioId: repSelectedColegio, anoLectivoId: repSelectedAno });
      repSecciones = data;
      if (data.length > 0 && !data.some(s => s.id === repSelectedSeccion)) repSelectedSeccion = data[0].id || 0;
      else if (data.length === 0) repSelectedSeccion = 0;
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: t('rep.error.secciones', { msg: String(error) }), type: "error" });
    }
  }

  async function fetchReporte(lid: number) {
    try {
      const cortesIds = resolverCortesIds();
      if (cortesIds.length === 0) throw new Error(t('rep.error.cortes'));

      const indicadoresArrays = await Promise.all(cortesIds.map(cId =>
        invoke<Indicador[]>("get_evaluation_config", { gradoId: repSelectedGrado, asignaturaId: repSelectedAsignatura, corteEvaluativoId: cId, anoLectivoId: repSelectedAno })
      ));
      if (lid !== repLoadId) return;

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
      const indicadoresBase: Indicador[] = Array.from(mergedMap.values()).map(entry => ({
        ...entry.ind,
        criterios: Array.from(entry.criteriaMap.values())
      }));

      if (indicadoresBase.length === 0) {
        configIndicadores = []; repEstudiantes = [];
        await emit("show-toast", { message: t('rep.error.sinIndicadores'), type: "warning" });
        return;
      }

      // Que indicators suman depende del COLEGIO, la SECCION y el CORTE. Con un
      // corte agregado se resuelve la unión de los activos de cada corte (ver
      // `idsActivosDeCortes`) y se sobrescribe `activo` para que todo lo de abajo
      // (totales, colores, columnas) use el mismo criterio que NotasPage.
      const idsSec = await idsActivosDeCortes(repSelectedColegio, repSelectedSeccion, repSelectedGrado, cortesIds);
      const indicadores: Indicador[] = (idsSec && idsSec.length > 0)
        ? indicadoresBase.map(i => ({ ...i, activo: idsSec.includes(i.id) }))
        : indicadoresBase;
      configIndicadores = indicadores.filter(ind => ind.activo);

      const results = await Promise.all([
        invoke<any[]>("get_estudiantes_by_filters", { gradoId: repSelectedGrado, seccionId: repSelectedSeccion }),
        ...cortesIds.map(cId => invoke<any[]>("get_notas_by_filters", { gradoId: repSelectedGrado, seccionId: repSelectedSeccion, corteId: cId, asignaturaId: repSelectedAsignatura }))
      ]);
      if (lid !== repLoadId) return;

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
                  if (repIsQualitative) {
                    labelsCualitativosCorte.push(valorToQualitativo(valor, crit.puntajeMaximo));
                  }
                }
              });
            }
          });
          if (haIngresado) {
            const pct = (totalCorte / (totalMaximoCorte || 1)) * 100;
            notasEstPorCorte[cId] = repIsQualitative ? pct : Math.round(totalCorte);
            tieneNotasEnCorte[cId] = true;
            notasCualitativasEstPorCorte[cId] = repIsQualitative
              ? calcularNotaCualitativaFinal(labelsCualitativosCorte)
              : getQualitativeLabel(pct);
          }
        });

        let notaFinalValue = 0, notaFinalCualitativa = "-";
        const cortesConNotas = cortesIds.filter(cId => tieneNotasEnCorte[cId]);
        if (cortesConNotas.length > 0) {
          const suma = cortesConNotas.reduce((s, cId) => s + notasEstPorCorte[cId], 0);
          const promedio = suma / cortesConNotas.length;
          if (repIsQualitative) {
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
                if (repIsQualitative) {
                  labelsInd.push(valorToQualitativo(valor, crit.puntajeMaximo));
                }
              }
            });
            if (countCriterios > 0) {
              const pct = (totalIndicador / (totalMaximo || 1)) * 100;
              notasIndicadoresSimuladas[ind.id] = repIsQualitative ? pct : Math.round(totalIndicador);
              notasCualitativasIndicadoresSimuladas[ind.id] = repIsQualitative ? calcularNotaCualitativaFinal(labelsInd) : getQualitativeLabel(pct);
            } else { notasCualitativasIndicadoresSimuladas[ind.id] = "-"; }
          });
        }

        return { ...est, notasIndicadores: notasIndicadoresSimuladas, notasCualitativasIndicadores: notasCualitativasIndicadoresSimuladas, notaFinal: notaFinalValue, notaFinalCualitativa };
      });

      if (specialCorte) {
        const indicadoresEspeciales = cortesIds.map((cId, idx) => ({
          id: cId, orden: idx + 1, descripcion: repCortes.find(c => c.id === cId)?.nombre || t('rep.corte.n', { n: idx + 1 }), activo: true, criterios: []
        }));
        configIndicadores = indicadoresEspeciales as any;
      }

      repEstudiantes = repSelectedSexo ? reporte.filter(est => est.sexo === repSelectedSexo) : reporte;
    } catch (error) {
      console.error("Error fetching reporte:", error);
      await emit("show-toast", { message: t('rep.error.reporte', { msg: String(error) }), type: 'error' });
    }
  }


  /**
   * Genera un PDF por cada combinacion grado x seccion.
   *
   * - alcance 'colegio' (boton PDF): todos los grados del colegio filtrado.
   * - alcance 'todos'   (boton Exportar Todo): todos los colegios del ano y corte
   *   seleccionados, ignorando el filtro de colegio.
   */
  async function exportarPdfs(alcance: 'colegio' | 'todos') {
    const esTodos = alcance === 'todos';
    if (!repSelectedAno || !repSelectedAsignatura || (!esTodos && !repSelectedColegio)) {
      await emit("show-toast", { message: esTodos
        ? t('rep.export.sinAnoTodo')
        : t('rep.export.sinAnoColegio'), type: 'warning' });
      return;
    }
    let cortesIds = resolverCortesIds();
    if (cortesIds.length === 0) {
      await emit("show-toast", { message: t('rep.export.sinCorte'), type: 'warning' });
      return;
    }

    try {
      exportandoMasivo = true;
      progresoMasivo = t('inf.export.preparando');
      const names = selectedNames;
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_');
      // Destino: School Tracker/Notas/<Año Lectivo>/<Corte - Asignatura>.
      // El año va como carpeta propia; corte y asignatura quedan debajo.
      const detalle = `${names.corte} - ${names.asignatura}`;
      const baseDir = await rutaExportAbsoluta('notas', names.ano, detalle);
      await mkdir(baseDir, { recursive: true });

      // Colegios a recorrer: el filtrado, o todos los del catalogo.
      const colegiosScope: CategoryItem[] = esTodos
        ? repColegios
        : repColegios.filter(c => c.id === repSelectedColegio);
      if (colegiosScope.length === 0) {
        await emit("show-toast", { message: t('inf.export.sinColegios'), type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      const pares: { colegioId: number; colegioNombre: string; gradoId: number; gradoNombre: string; seccionId: number; seccionNombre: string; cualitativo: boolean }[] = [];
      for (const col of colegiosScope) {
        const gradosList: CategoryItem[] = await invoke("get_grados_by_colegio", { colegioId: col.id, anoLectivoId: repSelectedAno });
        for (const grado of gradosList) {
          const seccionesList: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { gradoId: grado.id, colegioId: col.id, anoLectivoId: repSelectedAno });
          for (const sec of seccionesList) {
            pares.push({
              colegioId: col.id, colegioNombre: col.nombre,
              gradoId: grado.id!, gradoNombre: grado.nombre,
              seccionId: sec.id!, seccionNombre: sec.nombre,
              cualitativo: grado.cualitativo || false
            });
          }
        }
      }

      if (pares.length === 0) {
        await emit("show-toast", { message: t('inf.export.sinGrados'), type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      let processed = 0;
      let copiados = 0;
      let fallaronDescargas = 0;
      for (const pair of pares) {
        processed++;
        progresoMasivo = t('rep.export.progreso', { p: `${processed}/${pares.length}`, col: pair.colegioNombre, grado: pair.gradoNombre, sec: pair.seccionNombre });

        const listaEstudiantes: any[] = await invoke("get_estudiantes_by_filters", { gradoId: pair.gradoId, seccionId: pair.seccionId });
        if (!listaEstudiantes || listaEstudiantes.length === 0) continue;

        const notasResults = await Promise.all(cortesIds.map(cId =>
          invoke<any[]>("get_notas_by_filters", { gradoId: pair.gradoId, seccionId: pair.seccionId, corteId: cId, asignaturaId: repSelectedAsignatura })
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
          invoke<any[]>("get_evaluation_config", { gradoId: pair.gradoId, asignaturaId: repSelectedAsignatura, corteEvaluativoId: cId, anoLectivoId: repSelectedAno })
        ));
        const todosIndicadores: any[] = [];
        const seenInd = new Set<number>();
        for (const arr of indicadoresArrays) {
          for (const ind of arr) {
            if (!seenInd.has(ind.id)) { seenInd.add(ind.id); todosIndicadores.push(ind); }
          }
        }

        // SOLO los indicadores que suman en este colegio + seccion (+ los de
        // cada corte cuando el reporte es un agregado). Antes se sumaban los 8 y
        // el maximo de pts salia mal (160 en vez de 100); con cortes agregados
        // además se consultaba `selectedCorte`, que vale 0 en 1S/2S/NF.
        const idsSec = await idsActivosDeCortes(pair.colegioId, pair.seccionId, pair.gradoId, cortesIds);
        const indicadores = (idsSec && idsSec.length > 0)
          ? todosIndicadores.filter(i => idsSec.includes(i.id))
          : todosIndicadores.filter(i => i.activo);
        if (indicadores.length === 0) continue;

        const esCualitativo = pair.cualitativo;
        /** Maximo real de pts de ESTE par (no el del grado seleccionado arriba). */
        const maxPtsPar = esCualitativo ? 0 : indicadores.reduce((t: number, i: any) =>
          t + (i.criterios || []).reduce((s: number, c: any) => s + (c.puntajeMaximo || 0), 0), 0);

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

        const colorDeFila = (i: number) => {
          const est = reporteData[i];
          const colorHex = (!est.notaFinalQual || est.notaFinalQual === "-") ? undefined
            : getNoteColor(est.notaFinal, est.notaFinalQual, maxPtsPar);
          return colorHex;
        };

        const conNotas = reporteData.filter((e: any) => e.notaFinal >= 0);
        let promedioText = "-";
        if (conNotas.length > 0) {
          if (esCualitativo) { promedioText = calcularNotaCualitativaFinal(conNotas.map((e: any) => e.notaFinalQual || 'AI')); }
          else {
            const prom = conNotas.reduce((s: number, e: any) => s + e.notaFinal, 0) / conNotas.length;
            const lblProm = getQualitativeLabel(getPorcentajeFinal(prom, maxPtsPar));
            promedioText = `${Math.round(prom)}${lblProm ? ` (${lblProm})` : ''}`;
          }
        }

        // Generador COMPARTIDO con el reporte de asistencia: mismo lenguaje
        // visual (barra de acento, chips, encabezados verdes, pie paginado).
        const pdfData = await generarPdfNotas({
          colegio: pair.colegioNombre,
          grado: pair.gradoNombre,
          seccion: pair.seccionNombre,
          asignatura: names.asignatura,
          corte: names.corte,
          ano: names.ano,
          cualitativo: esCualitativo,
          totalEstudiantes: reporteData.length,
          promedio: promedioText,
          filas: reporteData.map((est: any, i: number) => ({
            nombre: est.nombre,
            sexo: est.sexo,
            nota: (!est.notaFinalQual || est.notaFinalQual === "-") ? "-"
              : esCualitativo ? est.notaFinalQual
                : `${Math.round(est.notaFinal)}${est.notaFinalQual ? ` (${est.notaFinalQual})` : ''}`,
            color: colorDeFila(i),
          })),
        });
        const fileName = `Notas ${sanitize(pair.colegioNombre)} ${sanitize(pair.gradoNombre)} - Seccion ${sanitize(pair.seccionNombre)}.pdf`;
        const fullPath = unirRuta(baseDir, fileName);
        await writeFile(fullPath, new Uint8Array(pdfData));
        if (repIsAndroid) {
          // Copia a Descargas/School Tracker (carpeta publica) con MediaStore.
          const ruta = await invoke<string>('guardar_en_descargas', {
            path: fullPath, mime: 'application/pdf',
            carpeta: subcarpetaRelativa('notas', names.ano, detalle), nombre: fileName
          }).catch(() => "");
          if (!ruta) fallaronDescargas++;
        }
        copiados++;
      }

      exportandoMasivo = false;
      const destino = destinoParaToast(repIsAndroid, 'notas', names.ano, detalle);
      const alcanceTxt = esTodos ? t('rep.export.todosColegios') : repColegios.find(c => c.id === repSelectedColegio)?.nombre || t('rep.export.elColegio');
      if (processed === 0) {
        await emit("show-toast", { message: t('rep.export.sinEstudiantesEn', { alcance: alcanceTxt }), type: 'warning' });
      } else if (repIsAndroid && fallaronDescargas > 0) {
        await emit("show-toast", { message: t('rep.export.pdfsParcial', { copiados, ruta: destino, fallaron: fallaronDescargas }), type: 'warning' });
      } else {
        await emit("show-toast", { message: t('rep.export.pdfsOk', { n: repIsAndroid ? copiados : processed, alcance: alcanceTxt, ruta: destino }), type: 'success' });
      }
      if (!repIsAndroid) { try { await openUrl(aFileURL(baseDir)); } catch {} }
    } catch (error) {
      console.error("Error en exportación masiva:", error);
      exportandoMasivo = false;
      await emit("show-toast", { message: t('rep.export.error', { msg: error instanceof Error ? error.message : String(error) }), type: 'error' });
    }
  }

  let showClipboardMenu = $state(false);
  /**
   * Disparador del menú. SOLO lo escribe `bind:this`: antes esta variable la
   * ponía el propio toggle al abrir y la anulaba al cerrar, y como el `onclick`
   * la comprobaba (`clipboardBtn && toggle(...)`), quedaba en `null` y el segundo
   * clic se perdía en silencio. Ahora el elemento llega por `event.currentTarget`
   * y esta ref se usa únicamente para NO cerrar cuando el puntero está sobre el
   * botón.
   */
  let clipboardBtn = $state<HTMLElement | null>(null);
  let clipboardPanelEl = $state<HTMLDivElement | null>(null);
  /**
   * El menú se posiciona con `fixed` + coordenadas de viewport y se monta en
   * `<body>`. Antes iba en `absolute` dentro de la cinta de filtros, y en Android
   * esa cinta tiene `overflow-x: auto` más ancestros con `backdrop-filter`: el
   * panel quedaba recortado y tapado por el contenido de abajo.
   */
  let clipboardPos = $state({ x: 0, y: 0, abajo: 'auto' });
  const CLIPBOARD_ALTO_EST = 108;

  function toggleClipboardMenu(btn: HTMLElement) {
    if (showClipboardMenu) { showClipboardMenu = false; return; }
    const r = btn.getBoundingClientRect();
    if (!r) return;
    const abreArriba = r.bottom + CLIPBOARD_ALTO_EST > window.innerHeight && r.top > CLIPBOARD_ALTO_EST;
    clipboardPos = {
      x: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - 248 - 8)),
      y: abreArriba ? 0 : Math.round(r.bottom + 4),
      abajo: abreArriba ? `${Math.round(window.innerHeight - r.top + 4)}px` : 'auto',
    };
    showClipboardMenu = true;
  }

  function closeClipboardMenu() {
    showClipboardMenu = false;
  }

  function getNotaFinalValue(est: EstudianteReporte): string {
    if (!est.notaFinalCualitativa || est.notaFinalCualitativa === '-') return '-';
    if (repIsQualitative) return est.notaFinalCualitativa;
    return String(Math.round(est.notaFinal));
  }

  /**
   * Copia SOLO dos columnas: el nombre del estudiante y su nota final.
   *
   * Antes exportaba `Estudiante | Sexo | Ind. 1..n | Nota Final`, que al pegar
   * en Excel generaba una tabla intermedia difícil de usar: el maestro termina
   * borrando las columnas de indicadores a mano para poder calzar la lista con
   * su planilla. Ahora la salida es directamente de dos columnas, la misma
   * información de la fila del reporte, y el formato queda alineado con el de
   * "Solo Nota Final" (que es esta misma información sin la columna del nombre).
   */
  async function copyFullTable() {
    if (filteredReporte.length === 0) return;
    const headers = ['Estudiante', 'Nota Final'];
    const rows = filteredReporte.map(est =>
      [est.nombre, getNotaFinalValue(est)].join('\t')
    );
    const tsv = [headers.join('\t'), ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      await emit('show-toast', { message: t('rep.copiar.okTabla', { n: filteredReporte.length }), type: 'success' });
    } catch (e) {
      await emit('show-toast', { message: t('rep.copiar.error', { e: String(e) }), type: 'error' });
    }
    showClipboardMenu = false;
  }

  async function copyFinalGradesOnly() {
    if (filteredReporte.length === 0) return;
    const values = filteredReporte.map(getNotaFinalValue).join('\n');
    try {
      await navigator.clipboard.writeText(values);
      await emit('show-toast', { message: t('rep.copiar.okNotas', { n: filteredReporte.length }), type: 'success' });
    } catch (e) {
      await emit('show-toast', { message: t('rep.copiar.error', { e: String(e) }), type: 'error' });
    }
    showClipboardMenu = false;
  }

  $effect(() => {
    if (!showClipboardMenu) return;
    const dispose = registerBackHandler(() => { closeClipboardMenu(); return true; });
    // `pointerdown` en fase de captura: si se cerrara con `click`, el clic que
    // abre el menú lo cerraría en el mismo gesto. Se ignora el interior del
    // panel y el propio disparador (que vive en la cinta, no en el portal).
    const onPointerDown = (ev: PointerEvent) => {
      // `nodo`, no `t`: `t` es la función de i18n importada arriba.
      const nodo = ev.target as Node | null;
      if (nodo && (clipboardPanelEl?.contains(nodo) || clipboardBtn?.contains(nodo))) return;
      closeClipboardMenu();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeClipboardMenu(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', closeClipboardMenu);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', closeClipboardMenu);
      dispose();
    };
  });

  async function handlePrintWithIframe() {
    if (repEstudiantes.length === 0) { await emit("show-toast", { message: t('inf.print.sinDatos'), type: 'warning' }); return; }
    try {
      await emit("show-toast", { message: t('inf.print.preparando'), type: 'success' });
      const names = selectedNames; const date = new Date().toLocaleDateString();
      const mostrarIndicadores = false;
      // Sin columna "Sexo": el nombre va teñido con el color de sexo de Ajustes.
      const headers = ["Estudiante", ...(mostrarIndicadores ? configIndicadores.map(ind => `Ind. ${ind.orden}`) : []), "Nota Final"];
      const rows = repEstudiantes.map(est => {
        const cells = [`<span style="color:${colorSexoExport(est.sexo)}">${est.nombre}</span>`,
          ...(mostrarIndicadores ? configIndicadores.map(ind => {
            const nota = est.notasIndicadores[ind.id] || 0; const label = est.notasCualitativasIndicadores[ind.id] || "";
            if (label === "-" || label === "") return "-";
            return repIsQualitative ? label : `${nota}${label ? ` ${label}` : ''}`;
          }) : []),
          (est.notaFinalCualitativa === "-" || !est.notaFinalCualitativa) ? "-" : (repIsQualitative ? (est.notaFinalCualitativa || '-') : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
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
          <p><strong>Corte:</strong> ${names.corte}</p><p><strong>Fecha:</strong> ${date}${repSelectedSexo ? ` - Sexo: ${repSelectedSexo === 'M' ? 'Masculino' : 'Femenino'}` : ''}</p>
        </div>
        <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    } catch (error) {
      console.error("Error generando reporte:", error);
      await emit("show-toast", { message: t('inf.error.reporteGen'), type: 'error' });
    }
  }
</script>
{#if enReporte}
{#snippet botonCopiar(compacto: boolean)}
  <div style="position:relative;flex-shrink:0">
    <button bind:this={clipboardBtn} onclick={(e) => toggleClipboardMenu(e.currentTarget)} disabled={filteredReporte.length === 0 || repLoading}
      style="height:42px;padding:0 {compacto || repIsMobile ? '0.55rem' : '1rem'};font-size:{compacto || repIsMobile ? '0.75rem' : '0.85rem'};background:linear-gradient(135deg,rgba(168,85,247,0.16),rgba(147,51,234,0.06));border:1px solid rgba(168,85,247,0.28);color:#e9d5ff;border-radius:10px;display:flex;align-items:center;gap:{compacto ? '0.45rem' : '9px'};font-weight:700;cursor:{filteredReporte.length === 0 || repLoading ? 'default' : 'pointer'};transition:all 0.2s ease;flex-shrink:0;white-space:nowrap;opacity:{filteredReporte.length === 0 || repLoading ? 0.6 : 1}"
      onmouseenter={(e) => { if (filteredReporte.length > 0 && !repLoading) (e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg,rgba(168,85,247,0.28),rgba(147,51,234,0.12))'; }}
      onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg,rgba(168,85,247,0.16),rgba(147,51,234,0.06))'; }}
      title={t('rep.copiar.title')}>
      <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(168,85,247,0.35);color:#f3e8ff;flex-shrink:0">
        <svg width="{compacto ? '13' : '12'}" height="{compacto ? '13' : '12'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </span>
      {#if compacto}
        <span>{t('rep.copiar.btn')}</span>
      {:else}
        <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;gap:1px;min-width:0">
          <span>{t('rep.copiar.btn')}</span>
          <span style="font-size:0.6rem;font-weight:600;color:#c4b5fd;letter-spacing:0.2px">{t('rep.copiar.resumen', { n: filteredReporte.length })}</span>
        </span>
      {/if}
      {#if showClipboardMenu}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;transform:rotate(180deg);flex-shrink:0"><polyline points="6 9 12 15 18 9"/></svg>
      {/if}
    </button>
  </div>
{/snippet}

{#snippet menuCopiar()}
  <div
    bind:this={clipboardPanelEl}
    use:portalToBody
    role="menu"
    aria-label={t('rep.copiar.menu')}
    style="position:fixed; z-index:99995; left:{clipboardPos.x}px; top:{clipboardPos.y}px; bottom:{clipboardPos.abajo}; min-width:240px; background:rgba(20,24,31,0.97); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.1); border-radius:12px; box-shadow:0 25px 60px -12px rgba(0,0,0,0.6); padding:0.4rem; box-sizing:border-box; overflow:hidden; animation:fadeIn 0.15s ease-out"
  >
    <button role="menuitem" onclick={copyFullTable}
      style="display:flex;align-items:center;gap:8px;width:100%;padding:0.65rem 0.75rem;font-size:0.8rem;background:transparent;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;white-space:nowrap;text-align:left"
      onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'}
      onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
      {t('rep.copiar.completo')}
    </button>
    <button role="menuitem" onclick={copyFinalGradesOnly}
      style="display:flex;align-items:center;gap:8px;width:100%;padding:0.65rem 0.75rem;font-size:0.8rem;background:transparent;color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;white-space:nowrap;text-align:left"
      onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'}
      onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
      {t('rep.copiar.soloNota')}
    </button>
  </div>
{/snippet}


<div class="page-container" style="height:100%;min-height:0">
  {#if !repIsAndroidMobile}<SearchFab bind:value={searchTerm} placeholder={t('inf.buscar')} />{/if}
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
      <div><strong>Sexo:</strong> {repSelectedSexo === "M" ? "Masculino" : repSelectedSexo === "F" ? "Femenino" : "Todos"}</div>
    </div>
  </div>

  
      <div class="category-card sticky-filters" style="margin-bottom:1rem;padding:0.8rem;position:sticky;top:0;z-index:999;background:rgba(26,26,26,0.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 4px 12px rgba(0,0,0,0.2);border-radius:0 0 12px 12px;border:1px solid rgba(255,255,255,0.05);border-top:none">
        {#if printHtml}
          <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;padding:20px">
            <div style="background-color:white;border-radius:12px;width:100%;max-width:900px;height:90vh;display:flex;flex-direction:column;overflow:hidden">
              <div style="padding:15px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background-color:#f8fafc">
                <span style="font-size:16px;font-weight:600;color:#1e293b">{t('inf.print.titulo')}</span>
                <div style="display:flex;gap:10px">
                  <button onclick={() => { const iframe = document.querySelector('iframe'); if (iframe?.contentWindow) iframe.contentWindow.print(); }}
                    style="padding:8px 16px;background-color:var(--primary-color);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">{t('inf.print.imprimir')}</button>
                  <button onclick={() => printHtml = null} style="padding:8px 16px;background-color:#64748b;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">{t('comun.cerrar')}</button>
                </div>
              </div>
              <iframe srcdoc={printHtml} style="flex:1;width:100%;border:none" title="Print Preview" />
            </div>
          </div>
        {/if}

        {#if repIsAndroidMobile}
          <div style="width:100%;padding:0.1rem 0 0.3rem;">
            <SearchFab bind:value={searchTerm} placeholder={t('inf.buscar')} conMargen={false} />
          </div>
          <div class="category-card" style="padding: 0.5rem; margin-bottom: 0.5rem; display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
            <button type="button" onclick={() => { repShowFiltersModal = true; }}
              style="height:38px;padding:0 0.8rem;font-size:0.78rem;background:rgba(96,165,250,0.18);color:#bfdbfe;border:1px solid rgba(96,165,250,0.4);border-radius:8px;display:flex;align-items:center;justify-content:center;gap:5px;font-weight:600;cursor:pointer;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span>🔍</span>
              <span style="overflow:hidden;text-overflow:ellipsis;">
                {(repColegios.find(c => c.id === repSelectedColegio)?.nombre)?.split(' ')[0] || t('inf.fallback.colegio')} · {repGrados.find(g => g.id === repSelectedGrado)?.nombre || t('inf.fallback.grado')} · {repSecciones.find(s => s.id === repSelectedSeccion)?.nombre || t('inf.fallback.seccion')}{repSelectedSexo ? ` · ${repSelectedSexo === 'M' ? t('rep.filtro.masc') : t('rep.filtro.fem')}` : ''}
              </span>
            </button>
          </div>
          <div class="category-card" style="padding: 0.5rem; margin-bottom: 0.5rem; display:flex;gap:0.3rem;align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
            {#if !repIsAndroid}
              <button onclick={handlePrintWithIframe} disabled={repEstudiantes.length === 0 || repLoading}
                style="height:42px;padding:0 0.4rem;font-size:0.75rem;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{repEstudiantes.length === 0 || repLoading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);flex-shrink:0;white-space:nowrap;opacity:{repEstudiantes.length === 0 || repLoading ? 0.7 : 1}"
                title={t('inf.btn.imprimir')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </button>
            {/if}
            <button onclick={() => exportarPdfs('colegio')} disabled={exportandoMasivo || !repSelectedColegio || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte}
              style="height:42px;padding:0 0.55rem;display:flex;align-items:center;gap:0.45rem;flex-shrink:0;border:1px solid rgba(248,113,113,0.5);border-radius:10px;background:linear-gradient(135deg,rgba(244,63,94,0.26),rgba(251,146,60,0.2));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#ffe4e6;font-weight:700;font-size:0.75rem;cursor:{exportandoMasivo || !repSelectedColegio || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 'default' : 'pointer'};box-shadow:0 6px 18px rgba(225,29,72,0.26);white-space:nowrap;opacity:{exportandoMasivo || !repSelectedColegio || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 0.65 : 1};transition:transform 0.15s ease,box-shadow 0.2s ease"
              title={t('rep.btn.pdfColegioTitle')}>
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(244,63,94,0.4);color:#fecdd3;flex-shrink:0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </span>
              {exportandoMasivo ? progresoMasivo : 'PDF'}
            </button>
            <button onclick={() => exportarPdfs('todos')} disabled={exportandoMasivo || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte}
              style="height:42px;padding:0 0.55rem;display:flex;align-items:center;gap:0.45rem;flex-shrink:0;border:1px solid rgba(129,140,248,0.5);border-radius:10px;background:linear-gradient(135deg,rgba(99,102,241,0.28),rgba(56,189,248,0.22));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#e0e7ff;font-weight:700;font-size:0.75rem;cursor:{exportandoMasivo || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 'default' : 'pointer'};box-shadow:0 6px 18px rgba(79,70,229,0.28);white-space:nowrap;opacity:{exportandoMasivo || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 0.65 : 1};transition:transform 0.15s ease,box-shadow 0.2s ease"
              title={t('rep.btn.exportarTodoTitle')}>
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(99,102,241,0.45);color:#c7d2fe;flex-shrink:0">📚</span>
              {exportandoMasivo ? progresoMasivo : t('rep.btn.todo')}
            </button>
            {@render botonCopiar(true)}
          </div>
        {:else}
        <FilterContainer isMobile={repIsMobile} style="padding:0.5rem">
          <!-- El modo va PRIMERO: es lo que define si esta barra reporta o
               captura notas. En Android no se renderiza: ahí el único control
               del modo es el swipe horizontal del wrapper. -->
          <FilterGroup label={t('comun.modo')} isMobile={repIsMobile}>
            <ModoToggle
              valor={modo}
              etiquetaGrupo={t('comun.modo')}
              onchange={(id) => onModoChange(id as "registrar" | "reportes")}
              opciones={[
                { id: "registrar", etiqueta: t('subtab.registrarCorto'), titulo: t('subtab.registrar') },
                { id: "reportes", etiqueta: t('subtab.reportes') },
              ]} />
          </FilterGroup>

          {#if showAnoDropdown}
          <FilterGroup label={t('rep.filtro.ano')} isMobile={repIsMobile}>
            <SelectChip
              value={repSelectedAno}
              onchange={(v) => { repSelectedAno = Number(v); }}
              options={repAnos.map(a => ({ value: a.id, label: a.nombre }))} />
          </FilterGroup>
          {/if}
          <FilterGroup label={t('rep.filtro.corte')} isMobile={repIsMobile}>
            <SelectChip
              value={specialCorte || repSelectedCorte}
              onchange={(v) => {
                const val = String(v);
                if (val === "1S" || val === "2S" || val === "NF") { specialCorte = val; repSelectedCorte = 0; }
                else { specialCorte = ""; repSelectedCorte = Number(val); }
              }}
              options={[
                ...repCortes.map(c => ({ value: c.id as string | number, label: c.nombre, grupo: t('rep.grupo.cortesIndividuales') })),
                { value: '1S', label: t('rep.corte.1s'), grupo: t('rep.grupo.promedios') },
                { value: '2S', label: t('rep.corte.2s'), grupo: t('rep.grupo.promedios') },
                { value: 'NF', label: t('rep.corte.nf'), grupo: t('rep.grupo.promedios') },
              ]} />
          </FilterGroup>
          <FilterGroup label={t('inf.filtro.colegio')} isMobile={repIsMobile}>
            <SelectChip
              value={repSelectedColegio}
              onchange={(v) => { repSelectedColegio = Number(v); }}
              options={repColegios.map(c => ({ value: c.id, label: c.nombre }))} />
          </FilterGroup>
          <FilterGroup label={t('inf.filtro.grado')} isMobile={repIsMobile}>
            <SelectChip
              value={repSelectedGrado}
              onchange={(v) => { repSelectedGrado = Number(v); }}
              options={repGrados.map(g => ({ value: g.id, label: g.nombre }))} />
          </FilterGroup>
          <FilterGroup label={t('inf.filtro.seccion')} isMobile={repIsMobile}>
            <SelectChip
              value={repSelectedSeccion}
              onchange={(v) => { repSelectedSeccion = Number(v); }}
              options={repSecciones.map(s => ({ value: s.id, label: s.nombre }))} />
          </FilterGroup>
          <FilterGroup label={t('inf.filtro.sexo')} isMobile={repIsMobile}>
            <SelectChip
              value={repSelectedSexo}
              onchange={(v) => { repSelectedSexo = String(v); }}
              options={[
                { value: '', label: t('asis.filtro.todos') },
                { value: 'M', label: t('asis.filtros.masculino') },
                { value: 'F', label: t('asis.filtros.femenino') },
              ]} />
          </FilterGroup>
          <FilterGroup label={t('rep.filtro.asignatura')} isMobile={repIsMobile}>
            <SelectChip
              value={repSelectedAsignatura}
              onchange={(v) => { repSelectedAsignatura = Number(v); }}
              placeholder={repAsignaturas.length === 0 ? t('rep.sinAsignaturas') : '—'}
              options={repAsignaturas.map(a => ({ value: a.id, label: a.nombre }))} />
          </FilterGroup>
          <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{repIsMobile ? '1 1 100%' : '0 0 auto'};{repIsMobile ? 'overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;' : ''}">
            {#if !repIsAndroid}
              <button onclick={handlePrintWithIframe} disabled={repEstudiantes.length === 0 || repLoading}
                style="height:42px;padding:0 {repIsMobile ? '0.4rem' : '1.25rem'};font-size:{repIsMobile ? '0.75rem' : '0.85rem'};background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{repEstudiantes.length === 0 || repLoading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);flex-shrink:0;white-space:nowrap;opacity:{repEstudiantes.length === 0 || repLoading ? 0.7 : 1}"
                title={(repIsMobile || repIsAndroid) ? t('rep.btn.compartirPdf') : t('inf.btn.imprimir')}>
                <svg width="{repIsMobile ? '12' : '14'}" height="{repIsMobile ? '12' : '14'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                {#if !repIsMobile}{t('inf.btn.imprimir')}{/if}
              </button>
            {/if}
            <button onclick={() => exportarPdfs('colegio')} disabled={exportandoMasivo || !repSelectedColegio || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte}
              title={t('rep.btn.pdfColegioTitle')}
              style="height:42px;padding:0 {repIsMobile ? '0.55rem' : '0.95rem'};display:flex;align-items:center;gap:0.5rem;flex-shrink:0;border:1px solid rgba(248,113,113,0.5);border-radius:10px;background:linear-gradient(135deg,rgba(244,63,94,0.26),rgba(251,146,60,0.2));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#ffe4e6;font-weight:700;font-size:{repIsMobile ? '0.78rem' : '0.8rem'};cursor:{exportandoMasivo || !repSelectedColegio || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 'default' : 'pointer'};box-shadow:0 6px 18px rgba(225,29,72,0.26);white-space:nowrap;opacity:{exportandoMasivo || !repSelectedColegio || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 0.65 : 1};transition:transform 0.15s ease,box-shadow 0.2s ease"
              onmouseenter={(e) => { if (!exportandoMasivo) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              onmousedown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
              onmouseup={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}>
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(244,63,94,0.4);color:#fecdd3;flex-shrink:0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </span>
              {#if repIsMobile}
                <span>{exportandoMasivo ? progresoMasivo : 'PDF'}</span>
              {:else}
                <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;gap:1px;min-width:0">
                  <span>{exportandoMasivo ? progresoMasivo : t('rep.btn.pdfColegio')}</span>
                  <span style="font-size:0.6rem;font-weight:600;color:#fda4af;letter-spacing:0.2px;max-width:150px;overflow:hidden;text-overflow:ellipsis">{exportandoMasivo ? t('inf.btn.generandoPdf') : subtituloColegio}</span>
                </span>
              {/if}
            </button>
            <button onclick={() => exportarPdfs('todos')} disabled={exportandoMasivo || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte}
              title={t('rep.btn.exportarTodoTitle')}
              style="height:42px;padding:0 {repIsMobile ? '0.55rem' : '0.95rem'};display:flex;align-items:center;gap:0.5rem;flex-shrink:0;border:1px solid rgba(129,140,248,0.5);border-radius:10px;background:linear-gradient(135deg,rgba(99,102,241,0.28),rgba(56,189,248,0.22));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#e0e7ff;font-weight:700;font-size:{repIsMobile ? '0.78rem' : '0.8rem'};cursor:{exportandoMasivo || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 'default' : 'pointer'};box-shadow:0 6px 18px rgba(79,70,229,0.28);white-space:nowrap;opacity:{exportandoMasivo || !repSelectedAno || !repSelectedAsignatura || !repSelectedCorte ? 0.65 : 1};transition:transform 0.15s ease,box-shadow 0.2s ease"
              onmouseenter={(e) => { if (!exportandoMasivo) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              onmousedown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
              onmouseup={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}>
              <span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(99,102,241,0.45);color:#c7d2fe;flex-shrink:0">📚</span>
              {#if repIsMobile}
                <span>{exportandoMasivo ? progresoMasivo : t('rep.btn.todo')}</span>
              {:else}
                <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;gap:1px;min-width:0">
                  <span>{exportandoMasivo ? progresoMasivo : t('inf.btn.exportarTodo')}</span>
                  <span style="font-size:0.6rem;font-weight:600;color:#a5b4fc;letter-spacing:0.2px;max-width:150px;overflow:hidden;text-overflow:ellipsis">{exportandoMasivo ? t('inf.btn.generandoPdf') : subtituloTodos}</span>
                </span>
              {/if}
            </button>
            {@render botonCopiar(false)}
            <div style="flex:1;min-width:100px">
            </div>
          </div>
        </FilterContainer>
        {/if}
      </div>
    

    <div style="position:relative;flex:1;min-height:400px;display:flex;flex-direction:column;overflow:hidden">
      {#if repLoading}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem">
          <div class="loading-spinner" style="width:50px;height:50px;border:4px solid rgba(var(--primary-rgb),0.1);border-top:4px solid var(--primary-color);border-radius:50%;animation:spin 1s linear infinite;margin-bottom:1rem"></div>
          <p style="color:#94a3b8;font-weight:500">{t('rep.vacio.generando')}</p>
        </div>
      {:else if filteredReporte.length === 0}
        <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px">
          <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📋'}</div>
          <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? t('inf.vacio.resultados') : t('inf.vacio.datos')}</h4>
          <p style="color:#94a3b8;max-width:400px;margin:0 auto">
            {searchTerm ? t('inf.vacio.busqueda', { q: searchTerm }) : t('rep.vacio.seleccione')}
          </p>
          {#if searchTerm}
            <button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">{t('asis.limpiarBusqueda')}</button>
          {/if}
        </div>
      {:else}
        <div style="display:flex;flex-direction:column;flex:1;min-height:0;gap:0.5rem">
          <!-- Mobile: Card View -->
          {#if repIsMobile}
            <div style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:0 0.3rem">
              {#each filteredReporte as estudiante, idx}
                {@const isExpanded = expandedStudentId === estudiante.id}
                {@const finalColor = (estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)}
                <div onclick={() => expandedStudentId = isExpanded ? -1 : estudiante.id}
                  style="margin-bottom:0.3rem;border-radius:12px;border:1px solid rgba(255,255,255,{isExpanded ? '0.12' : '0.06'});background:{isExpanded ? 'rgba(30,41,59,0.8)' : 'rgba(15,23,42,0.5)'};overflow:hidden;cursor:pointer;transition:all 0.2s ease">
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.7rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;min-width:0;flex:1">
                      <div style="font-size:0.75rem;color:#64748b;min-width:28px;text-align:center;">{idx + 1}</div>
                      <div style="font-size:0.85rem;color:{colorSexo(estudiante.sexo)};font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{estudiante.nombre}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0;">
                      <span style="font-size:0.85rem;font-weight:bold;color:{finalColor}">
                        {#if repIsQualitative}
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
                          {@const noteColor = isMissing ? '#64748b' : getNoteColor(repIsQualitative ? 0 : nota, label, getIndicatorMaxScore(ind.id))}
                          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                            <div style="display:flex;align-items:center;gap:0.3rem;min-width:0;flex:1">
                              <div style="width:4px; height:4px; border-radius:50%; background:{noteColor}; flex-shrink:0;"></div>
                              <span style="font-size:0.75rem;color:#94a3b8;">Ind. {ind.orden}</span>
                              {#if ind.descripcion}
                                <span style="font-size:0.65rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">— {ind.descripcion}</span>
                              {/if}
                            </div>
                            <span style="font-size:0.8rem;font-weight:bold;color:{noteColor};flex-shrink:0;">
                              {#if repIsQualitative}
                                {isMissing ? '-' : label}
                              {:else}
                                {isMissing ? '-' : `${Math.round(nota)}${label ? ` ${label}` : ''}`}
                              {/if}
                            </span>
                          </div>
                        {/each}
                      {:else}
                        <div style="padding:0.35rem 0;font-size:0.75rem;color:#64748b;">
                          {t('rep.vistaConsolidada')}
                        </div>
                      {/if}
                      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0 0.2rem;margin-top:0.2rem;border-top:1px solid rgba(var(--primary-rgb),0.15);">
                        <span style="font-size:0.8rem;color:var(--text-secondary);font-weight:bold;">{t('rep.corte.nf')}</span>
                        <span style="font-size:0.9rem;font-weight:bold;color:{finalColor};">
                          {#if repIsQualitative}
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
          <!-- Desktop: Table View -->
          <div class="category-card table-card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;flex:1;min-height:0">
            <div class="notas-table-container" style="overflow:auto;padding:0;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;border:1px solid rgba(255,255,255,0.1);border-radius:8px;flex:1;min-height:0">
              <table style="width:100%;min-width:max-content;border-collapse:separate;border-spacing:0">
                <thead style="position:sticky;top:0;z-index:100">
                  <tr>
                    <th style="padding:1rem;text-align:left;background-color:#1e293b;border-bottom:2px solid rgba(255,255,255,0.1);color:var(--text-secondary);position:sticky;left:0;z-index:110">{t('rep.tabla.estudiante')}</th>
                    {#if !specialCorte}
                      {#each configIndicadores as ind}
                        <th title={ind.descripcion} style="padding:1rem;text-align:center;background-color:rgba(255,255,255,0.05);border-bottom:2px solid rgba(255,255,255,0.1);color:var(--text-secondary);font-size:0.85rem;cursor:help">
                          Ind. {ind.orden}
                        </th>
                      {/each}
                    {/if}
                    <th style="padding:1rem;text-align:center;background-color:rgba(var(--primary-rgb),0.1);border-bottom:2px solid rgba(var(--primary-rgb),0.3);color:var(--text-secondary);font-weight:bold">{t('rep.corte.nf')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredReporte as estudiante, idx}
                    <tr class="table-row-hover" style="background-color:{idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}">
                      <td style="padding:0.85rem 1rem;border-bottom:1px solid rgba(255,255,255,0.05);color:{colorSexo(estudiante.sexo)};font-weight:500;position:sticky;left:0;background-color:{idx % 2 === 0 ? '#1e293b' : '#1a2234'};z-index:5">
                        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{estudiante.nombre}</div>
                      </td>
                      {#if !specialCorte}
                        {#each configIndicadores as ind}
                          {@const nota = estudiante.notasIndicadores[ind.id] || 0}
                          {@const label = estudiante.notasCualitativasIndicadores[ind.id] || (repIsQualitative ? '' : '')}
                          {@const isMissing = label === "-" || label === ""}
                          {@const noteColor = isMissing ? '#64748b' : getNoteColor(repIsQualitative ? 0 : nota, label, getIndicatorMaxScore(ind.id))}
                          <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);color:{noteColor}">
                            {#if repIsQualitative}
                              <span style="font-weight:{isMissing ? 'normal' : 'bold'};color:{noteColor}">{isMissing ? "-" : label}</span>
                            {:else}
                              <span style="font-weight:{isMissing ? 'normal' : 'bold'};color:{noteColor}">{isMissing ? "-" : `${Math.round(nota)}${label ? ` ${label}` : ''}`}</span>
                            {/if}
                          </td>
                        {/each}
                      {/if}
                      <td style="padding:0.85rem 1rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);font-weight:bold;color:{(estudiante.notaFinalCualitativa === "-" || !estudiante.notaFinalCualitativa) ? '#64748b' : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa, totalPuntajeMaximoConfig)};background-color:rgba(var(--primary-rgb),0.05)">
                        {#if repIsQualitative}
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

          <!-- Estadísticas -->
          <div class="asistencia-summary" style="margin:0;padding:0.5rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;flex-shrink:0">
            <div class="summary-card students">
              <span class="summary-label">{searchTerm ? t('rep.stats.resultados') : t('rep.stats.estudiantes')}</span>
              <span class="summary-value">{filteredReporte.length}</span>
              <div class="gender-labels">
                <span class="gender-m">M: {filteredReporte.filter(e => e.sexo === 'M').length}</span>
                <span class="gender-f">F: {filteredReporte.filter(e => e.sexo === 'F').length}</span>
              </div>
            </div>
            <div class="summary-card p">
              <span class="summary-label">{t('rep.stats.promedioGrupal')}</span>
              <div class="summary-value" style="color: {promedioGrupalColor}">
                {promedioGrupalLabel}
              </div>
            </div>
            {#each configIndicadores.filter(i => i.activo) as ind}
              <div class="summary-card" style="border-left:3px solid var(--primary-color)">
                <span class="summary-label">Ind. {ind.orden}</span>
                <span class="summary-value" style="font-size:0.7rem;color:var(--text-secondary);font-weight:400;line-height:1.2;word-break:break-word">{ind.descripcion || t('rep.sinDescripcion')}</span>
              </div>
            {/each}
            {#if configIndicadores.filter(i => i.activo).length === 0}
              <div class="summary-card" style="grid-column:1/-1">
                <span class="summary-label" style="color:#64748b;font-style:italic">{t('rep.sinIndicadoresActivos')}</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  

  <FiltersModalAndroid
    bind:open={repShowFiltersModal}
    isAndroidMobile={repIsAndroidMobile} isMobile={repIsMobile}
    showAno={showAnoDropdown}
    bind:anos={repAnos} bind:colegios={repColegios} bind:grados={repGrados} bind:secciones={repSecciones}
    bind:selectedAno={repSelectedAno} bind:selectedColegio={repSelectedColegio} bind:selectedGrado={repSelectedGrado} bind:selectedSeccion={repSelectedSeccion} bind:selectedSexo={repSelectedSexo}
  >
    {#snippet extras()}
      <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
        <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('rep.filtro.corte')}</label>
        <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
          value={specialCorte || repSelectedCorte}
          onchange={(e) => {
            const val = (e.target as HTMLSelectElement).value;
            if (val === "1S" || val === "2S" || val === "NF") { specialCorte = val; repSelectedCorte = 0; }
            else { specialCorte = ""; repSelectedCorte = Number(val); }
          }}>
          <optgroup label={t('rep.grupo.cortesIndividuales')}>
            {#each repCortes as c}<option value={c.id}>{c.nombre}</option>{/each}
          </optgroup>
          <optgroup label={t('rep.grupo.promedios')}>
            <option value="1S">{t('rep.corte.1s')}</option>
            <option value="2S">{t('rep.corte.2s')}</option>
            <option value="NF">{t('rep.corte.nf')}</option>
          </optgroup>
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
        <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('rep.filtro.asignatura')}</label>
        <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
          bind:value={repSelectedAsignatura} disabled={repAsignaturas.length === 0}>
          {#each repAsignaturas as a}<option value={a.id}>{a.nombre}</option>{/each}
        </select>
      </div>
    {/snippet}
  </FiltersModalAndroid>
  {#if showClipboardMenu}
    {@render menuCopiar()}
  {/if}
</div>

{:else}
<div class="page-container notas-page-root" style="height: 100%; min-height: 0;">
  <div class="category-grid" style="display: flex; flex-direction: column; height: 100%;">
    {#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder={t('notas.buscar.placeholder')} />{/if}
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
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('notas.filtro.corte')}</label>
            <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
              bind:value={selectedCorte}>
              {#each cortes as c}
                <option value={c.id}>{c.nombre}</option>
              {/each}
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 100%">
            <label style="font-size:0.65rem;color:#94a3b8;font-weight:600">{t('notas.filtro.asignatura')}</label>
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
        <!-- El modo va PRIMERO: es lo que define si esta barra guarda o solo
             muestra. En Android no se renderiza: ahí el único control del
             modo es el swipe horizontal del wrapper. -->
        <FilterGroup label={t('comun.modo')} {isMobile}>
          <ModoToggle
            valor={modo}
            etiquetaGrupo={t('comun.modo')}
            onchange={(id) => onModoChange(id as "registrar" | "reportes")}
            opciones={[
              { id: "registrar", etiqueta: t('subtab.registrarCorto'), titulo: t('subtab.registrar') },
              { id: "reportes", etiqueta: t('subtab.reportes') },
            ]} />
        </FilterGroup>

        {#if showAnoDropdown}
        <FilterGroup label={t('notas.filtro.anoLectivo')} {isMobile}>
          <SelectChip
            value={selectedAno}
            onchange={(v) => { selectedAno = Number(v); }}
            options={anos.map(a => ({ value: a.id, label: a.nombre }))} />
        </FilterGroup>
        {/if}

        <FilterGroup label={t('notas.filtro.corte')} {isMobile}>
          <SelectChip
            value={selectedCorte}
            onchange={(v) => { selectedCorte = Number(v); }}
            options={cortes.map(c => ({ value: c.id, label: c.nombre }))} />
        </FilterGroup>

        <FilterGroup label={t('notas.filtro.colegio')} {isMobile}>
          <SelectChip
            value={selectedColegio}
            onchange={(v) => { selectedColegio = Number(v); }}
            options={colegios.map(col => ({ value: col.id, label: col.nombre }))} />
        </FilterGroup>

        <FilterGroup label={t('notas.filtro.grado')} {isMobile}>
          <SelectChip
            value={selectedGrado}
            onchange={(v) => { selectedGrado = Number(v); localStorage.setItem('notas-last-grado', String(selectedGrado)); }}
            options={grados.map(g => ({ value: g.id, label: g.nombre }))} />
        </FilterGroup>

        <FilterGroup label={t('notas.filtro.seccion')} {isMobile}>
          <SelectChip
            value={selectedSeccion}
            onchange={(v) => { selectedSeccion = Number(v); }}
            options={secciones.map(s => ({ value: s.id, label: s.nombre }))} />
        </FilterGroup>

        <FilterGroup label={t('notas.filtro.sexo')} {isMobile}>
          <SelectChip
            value={selectedSexo}
            onchange={(v) => { selectedSexo = String(v); }}
            options={[
              { value: '', label: t('notas.filtro.todos') },
              { value: 'M', label: t('notas.filtro.masculino') },
              { value: 'F', label: t('notas.filtro.femenino') },
            ]} />
        </FilterGroup>

        <FilterGroup label={t('notas.filtro.asignatura')} {isMobile}>
          <SelectChip
            value={selectedAsignatura}
            onchange={(v) => { selectedAsignatura = Number(v); localStorage.setItem('notas-last-asignatura', String(selectedAsignatura)); }}
            options={asignaturas.map(a => ({ value: a.id, label: a.nombre }))} />
        </FilterGroup>

          <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'};{isMobile ? 'overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;' : ''}">
            <BotonMod bind:ref={popAccionesBtn} opts={{
              onclick: togglePopAcciones,
              icono: popAcciones ? '✕' : '⋯', etiqueta: t('notas.acciones'), tono: 'violeta',
              sub: t('notas.activos', { n: activeIndicadores.length, m: filteredNotas.length }),
              title: t('notas.btn.acciones'),
            }} />

            <BotonMod opts={{
              onclick: undo, disabled: history.length === 0,
              icono: '↩️', etiqueta: t('notas.btn.deshacer'), tono: 'ambar',
              sub: history.length === 0 ? t('notas.guardado.limpio') : t('notas.historial', { n: history.length }),
              title: t('notas.deshacer'),
            }} />
            <BotonMod opts={{
              onclick: redo, disabled: redoStack.length === 0,
              icono: '↪️', etiqueta: t('notas.btn.rehacer'), tono: 'ambar',
              sub: redoStack.length === 0 ? t('notas.rehacerNada') : t('notas.porRehacer', { n: redoStack.length }),
              title: t('notas.rehacer'),
            }} />
            <BotonMod opts={{
              onclick: handleGuardarNotas,
              disabled: !hasUnsavedChanges || saving || estudiantes.length === 0,
              icono: saving ? '⏳' : '💾', etiqueta: saving ? t('notas.btn.guardando') : t('notas.btn.guardarCorto'), tono: 'verde',
              sub: saving ? t('notas.guardado.escribiendo') : (hasUnsavedChanges ? t('notas.cambiosPendientes', { n: cambiosPendientes }) : t('notas.guardado.limpio')),
              title: t('notas.btn.guardar'),
            }} />
          </div>

      </FilterContainer>
      {/if}

      {#if isAndroidMobile}
        <div class="category-card" style="padding: 0.4rem 0.5rem; margin-top: 0.4rem;">
          <SearchFab bind:value={searchTerm} placeholder={t('notas.buscar.placeholder')} conMargen={false} />
        </div>
        <div class="category-card" style="padding: 0.5rem; margin-top: 0.4rem; display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
          <button type="button" onclick={() => { showFiltersModal = true; }}
            style="height:38px;padding:0 0.8rem;font-size:0.78rem;background:rgba(96,165,250,0.18);color:#bfdbfe;border:1px solid rgba(96,165,250,0.4);border-radius:8px;display:flex;align-items:center;justify-content:center;gap:5px;font-weight:600;cursor:pointer;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            <span>🔍</span>
              <span style="overflow:hidden;text-overflow:ellipsis;">
                {(colegios.find(c => c.id === selectedColegio)?.nombre)?.split(' ')[0] || t('notas.chip.colegio')} · {grados.find(g => g.id === selectedGrado)?.nombre || t('notas.chip.grado')} · {secciones.find(s => s.id === selectedSeccion)?.nombre || t('notas.chip.seccion')} · {cortes.find(c => c.id === selectedCorte)?.nombre || t('notas.corte')}{selectedSexo ? ` · ${selectedSexo === 'M' ? t('notas.filtro.masc') : t('notas.filtro.fem')}` : ''}
              </span>
          </button>
        </div>
        <div class="category-card" style="padding: 0.5rem; margin-top: 0.3rem; display:flex;gap:0.3rem;align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
          <BotonMod bind:ref={popAccionesBtn} opts={{
            onclick: togglePopAcciones,
            icono: popAcciones ? '✕' : '⋯', etiqueta: t('notas.acciones'), tono: 'violeta',
            sub: `${activeIndicadores.length}/${indicadores.length} · ${filteredNotas.length}`,
            title: t('notas.btn.acciones'), compacto: true
          }} />

          <!-- Guardar va antes que Deshacer/Rehacer: es la acción que se usa en
               cada cambio de nota, así que queda a la vista sin scrollear, igual
               que en Asistencia. El orden de escritorio no cambia. -->
          <BotonMod opts={{
            onclick: handleGuardarNotas,
            disabled: !hasUnsavedChanges || saving || estudiantes.length === 0,
            icono: saving ? '⏳' : '💾', etiqueta: saving ? t('notas.btn.guardando') : t('notas.btn.guardarCorto'), tono: 'verde',
            sub: saving ? t('notas.guardado.escribiendo') : (hasUnsavedChanges ? t('notas.cambiosPendientes', { n: cambiosPendientes }) : t('notas.guardado.limpio')),
            title: t('notas.btn.guardar'), compacto: true
          }} />
          <BotonMod opts={{
            onclick: undo, disabled: history.length === 0,
            icono: '↩️', etiqueta: t('notas.btn.deshacer'), tono: 'ambar',
            sub: history.length === 0 ? t('notas.guardado.limpio') : t('notas.historial', { n: history.length }),
            title: t('notas.deshacer'), compacto: true
          }} />
          <BotonMod opts={{
            onclick: redo, disabled: redoStack.length === 0,
            icono: '↪️', etiqueta: t('notas.btn.rehacer'), tono: 'ambar',
            sub: redoStack.length === 0 ? t('notas.rehacerNada') : t('notas.porRehacer', { n: redoStack.length }),
            title: t('notas.rehacer'), compacto: true
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
                {t('notas.movil.indice', { i: currentStudentIdx + 1, n: filteredNotas.length })}
              </div>
            </div>
            <button onclick={goNextStudent} disabled={currentStudentIdx >= filteredNotas.length - 1}
              style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: {currentStudentIdx >= filteredNotas.length - 1 ? '#475569' : '#e2e8f0'}; border-radius: 10px; padding: 0.5rem 0.7rem; font-size: 1.1rem; cursor: {currentStudentIdx >= filteredNotas.length - 1 ? 'not-allowed' : 'pointer'}; opacity: {currentStudentIdx >= filteredNotas.length - 1 ? 0.4 : 1}; display: flex; align-items: center; justify-content: center; min-width: 40px;">▶</button>
          </div>

          {#if filteredNotas[currentStudentIdx]}
            {@const est = filteredNotas[currentStudentIdx]}
            <div style="margin-bottom: 0; padding: 0.6rem; border-radius: 12px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(34, 197, 94, 0.3); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                  <div style="color: #94a3b8; font-weight: bold; font-size: 0.85rem;">{t('notas.col.notaFinal')}</div>
                  <div style="display: flex; align-items: center; gap: 0.4rem;">
                    {#if !isQualitative}
                      <span title={t('notas.escala0a100')} style="font-size: 0.9rem; color: #e2e8f0;">{(() => {
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
      <div style="text-align: center; padding: {isMobile ? '0.5rem' : '2rem'}; font-size: {isMobile ? '0.75rem' : '1rem'};">{t('notas.cargando')}</div>
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
                      {t('notas.indicador', { n: ind.orden })} ⚙{#if !ind.activo}<span style="font-size: 0.6rem; color: #64748b;">{' '}{t('notas.noSuma')}</span>{/if}
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
              <div style="color: #f1f5f9; font-weight: bold; font-size: 1rem;">{t('notas.estudiantes')}</div>
              <div style="color: #64748b; font-size: 0.75rem;">{t('notas.estudiantesConteo', { n: filteredNotas.length })}</div>
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
            📝 {t('notas.estudiantes')} <span style="opacity: 0.7; font-size: 0.8em;">({filteredNotas.length})</span>
          </h3>
          <div style="font-size: 0.9rem; color: #94a3b8; display: flex; align-items: center; gap: 0.35rem;">
            <span title={t('notas.sumanTitulo')} style="cursor: help;">{t('notas.sumanSeccion')}</span>
            <span style="font-weight: bold; color: {activeIndicadores.length > MAX_INDICADORES_ACTIVOS ? '#fbbf24' : '#fff'};">{activeIndicadores.length}/{MAX_INDICADORES_ACTIVOS}</span>
            {#if seccionTieneExcepciones}
              <span title={t('notas.configPropiaTitulo')} style="font-size: 0.7rem; color: #a78bfa; cursor: help;">{t('notas.configPropia')}</span>
            {/if}
            {#if indicadoresSeccion.length > activeIndicadores.length}
              <span title={t('notas.noSumanTitulo')} style="font-size: 0.7rem; color: #64748b;">{t('notas.noSumanCount', { n: indicadoresSeccion.length - activeIndicadores.length })}</span>
            {/if}
            {#if maxPuntosTotales !== 100}
              <span title={t('notas.maxRealTitulo', { n: activeIndicadores.length, pts: maxPuntosTotales })} style="font-size: 0.7rem; color: #fbbf24;">{t('notas.maxReal', { pts: maxPuntosTotales })}</span>
            {/if}
          </div>
        </div>

        <div class="notas-table-container" style="flex: 1; min-height: 0; overflow: auto; padding: 0; width: 100%; max-width: 100%; -webkit-overflow-scrolling: touch; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
          <table class="notas-table" style="width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; font-size: 0.7rem;">
            <thead style="position: sticky; top: 0; z-index: 100;">
              <tr style="background: #1e293b;">
                <th style="padding: 0.3rem; text-align: center; font-weight: bold; color: #94a3b8; position: sticky; left: 0; z-index: 110; background: #1e293b; border-bottom: 2px solid rgba(255,255,255,0.1); width: 35px;">Nº</th>
                <th style="padding: 0.3rem; text-align: left; font-weight: bold; color: #94a3b8; position: sticky; left: 35px; z-index: 110; background: #1e293b; border-bottom: 2px solid rgba(255,255,255,0.1); min-width: 130px; max-width: 150px;">{t('notas.col.estudiante')}</th>
                {#each indicadoresSeccion as ind}
                  <th colspan={ind.criterios.length + 1} style="padding: 0.2rem; text-align: center; font-weight: bold; border-bottom: 2px solid {ind.activo ? 'rgba(255,255,255,0.1)' : 'rgba(100,116,139,0.25)'};">
                    <div
                      role="button" tabindex="0"
                      onclick={(e) => abrirPopover('indicador', ind.id, 0, e)}
                      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPopover('indicador', ind.id, 0, e as unknown as MouseEvent); } }}
                      title={ind.activo ? (ind.descripcion || t('notas.indicador', { n: ind.orden })) : `${ind.descripcion || t('notas.indicador', { n: ind.orden })} · ${t('notas.indicadorInactivo')}`}
                      style="background: {ind.activo ? 'rgba(var(--primary-rgb), 0.15)' : 'rgba(100,116,139,0.08)'}; padding: 0.2rem; border-radius: 4px; border: 1px solid {ind.activo ? 'rgba(var(--primary-rgb), 0.4)' : 'rgba(100,116,139,0.3)'}; color: {ind.activo ? 'var(--text-secondary)' : '#64748b'}; cursor: pointer; {ind.activo ? '' : 'border-style: dashed;'} transition: all 0.15s ease;">
                      <div style="font-weight: bold; font-size: 0.7rem;">Ind. {ind.orden}{ind.activo ? '' : ' ·'} ⚙</div>
                    </div>
                  </th>
                {/each}
                <th title={t('notas.col.finalTitulo')} style="padding: 0.3rem; text-align: center; font-weight: bold; color: #4ade80; background: #1e293b; border-bottom: 2px solid rgba(34, 197, 94, 0.4); position: sticky; right: 0; z-index: 110; width: 60px;">
                  <div style="font-weight: bold; font-size: 0.7rem;">{t('notas.col.final')}</div>
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
                      title={(crit.descripcion || t('notas.sinDescripcion')) + t('notas.criterioClic')}
                      style="padding: 0.2rem; text-align: center; color: {ind.activo ? '#94a3b8' : '#64748b'}; font-size: 0.65rem; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: pointer;">
                      <div style="font-weight: bold;">C{crit.orden} ⚙</div>
                      {#if !isQualitative}<div style="font-size: 0.55rem; color: {ind.activo ? '#4ade80' : '#64748b'};">{crit.puntajeMaximo}</div>{/if}
                    </th>
                  {/each}
                  <th style="padding: 0.2rem; text-align: center; color: {ind.activo ? '#94a3b8' : '#64748b'}; font-weight: bold; background: {ind.activo ? 'rgba(var(--primary-rgb), 0.08)' : 'rgba(100,116,139,0.06)'}; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="color: {ind.activo ? '#4ade80' : '#64748b'}; font-size: 0.6rem;">{ind.activo ? (isQualitative ? 'Cual.' : 'Tot') : t('notas.noSumaCorto')}</div>
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
                        <div title={indicador.activo ? t('notas.tooltip.sumaTotal', { a: totalIndicadorRedondeado, b: maximoIndicador }) : t('notas.tooltip.inactivo', { a: totalIndicadorRedondeado, b: maximoIndicador })} style="color: {displayColor}; font-size: 0.75rem; font-weight: bold; {indicador.activo ? '' : 'opacity: 0.75;'}">
                          {#if indicador.activo}
                            {isQualitative ? qualitativeGrade : `${totalIndicadorRedondeado}${qualitativeGrade ? ` (${qualitativeGrade})` : ''}`}
                          {:else}
                            <span style="font-size: 0.7rem;">{isQualitative ? qualitativeGrade || '—' : totalIndicadorRedondeado}</span>
                            <span style="display: block; font-size: 0.5rem; font-weight: 400; color: #64748b;">{t('notas.noSumaCorto')}</span>
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
                      <div title={t('notas.tooltip.total', { a: totalFinal, b: maximoTotal })} style="color: {displayColor}; font-size: 0.8rem; font-weight: bold; padding: 0.15rem 0.3rem; border-radius: 4px; display: inline-block;">
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
          <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">{t('notas.vacio.titulo')}</h4>
          <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">{t('notas.vacio.sinResultados', { q: searchTerm })}</p>
          <button class="secondary" onclick={() => searchTerm = ""} style="margin-top: 1.5rem; padding: 0.5rem 1rem;">{t('notas.limpiarBusqueda')}</button>
        </div>
      {:else if estudiantes.length === 0 && selectedGrado > 0 && selectedSeccion > 0}
        <div style="text-align: center; padding: 5rem 2rem; border: 2px dashed rgba(255, 255, 255, 0.1); border-radius: 16px; margin: 1rem 0;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">👥</div>
          <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">{t('notas.vacio.tituloAlt')}</h4>
          <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">
            {t('notas.vacio.sinEstudiantes', { grado: grados.find(g => g.id === selectedGrado)?.nombre || '', seccion: secciones.find(s => s.id === selectedSeccion)?.nombre || '' })}
          </p>
        </div>
      {:else if !selectedGrado || !selectedSeccion}
        <div style="text-align: center; padding: 5rem 2rem; border: 2px dashed rgba(255, 255, 255, 0.1); border-radius: 16px; margin: 1rem 0;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
          <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">{t('notas.vacio.seleccioneFiltros')}</h4>
          <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">
            {t('notas.vacio.seleccioneDesc')}
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
          title={t('notas.btn.instrumentosTitulo')}
          style="width:100%;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.55rem;border-radius:9px;border:1px solid rgba(96,165,250,0.22);background:rgba(96,165,250,0.08);color:#bfdbfe;cursor:pointer;text-align:left;transition:all 0.15s ease;opacity:{indicadores.length === 0 ? 0.45 : 1};"
          onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(96,165,250,0.16)'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = 'rgba(96,165,250,0.08)'; }}>
          <span style="font-size:0.9rem;">📋</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:700;font-size:0.76rem;">{t('notas.btn.instrumentos')}</span>
            <span style="display:block;font-size:0.62rem;color:#94a3b8;">{t('notas.btn.instrumentosSub', { a: activeIndicadores.length, b: indicadores.length })}</span>
          </span>
        </button>

        <button
          role="menuitem" disabled={activeIndicadores.length === 0 || filteredNotas.length === 0}
          onclick={() => accionPop(() => { distribuirTargets = {}; distribuirOverwrite = true; showDistribuirModal = true; })}
          title={t('notas.popover.distribuirAuto')}
          style="width:100%;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.55rem;border-radius:9px;border:1px solid rgba(168,85,247,0.22);background:rgba(168,85,247,0.08);color:#e9d5ff;cursor:pointer;text-align:left;transition:all 0.15s ease;opacity:{activeIndicadores.length === 0 || filteredNotas.length === 0 ? 0.45 : 1};"
          onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(168,85,247,0.16)'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = 'rgba(168,85,247,0.08)'; }}>
          <span style="font-size:0.9rem;">✨</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:700;font-size:0.76rem;">{t('notas.btn.distribuir')}</span>
            <span style="display:block;font-size:0.62rem;color:#94a3b8;">{t('notas.btn.distribuirSub', { n: activeIndicadores.length })}</span>
          </span>
        </button>

        <button
          role="menuitem" disabled={estudiantes.length === 0}
          onclick={() => accionPop(() => {
            if (!selectedCorte || !selectedAsignatura) { emit("show-toast", { message: t('notas.del.previa'), type: "warning" }); return; }
            deleteMode = 'all'; deleteStudentId = 0; deleteIndicatorId = 0; showDeleteModal = true;
          })}
          title={t('notas.btn.eliminarNotas')}
          style="width:100%;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.55rem;border-radius:9px;border:1px solid rgba(239,68,68,0.22);background:rgba(239,68,68,0.08);color:#fecaca;cursor:pointer;text-align:left;transition:all 0.15s ease;opacity:{estudiantes.length === 0 ? 0.45 : 1};"
          onmouseenter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.16)'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}>
          <span style="font-size:0.9rem;">🗑️</span>
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:700;font-size:0.76rem;">{t('notas.btn.eliminarNotas')}</span>
            <span style="display:block;font-size:0.62rem;color:#94a3b8;">{t('notas.btn.eliminarNotasSub', { n: filteredNotas.length })}</span>
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
        role="dialog" aria-label={t('notas.popover.opciones')}
        style="position: fixed; z-index: 99995; left: {Math.max(8, Math.min(popover.x, (typeof window !== 'undefined' ? window.innerWidth : 1920) - Math.max(228, popover.ancho + 12)))}px; top: {popover.y}px; min-width: 220px; max-width: 280px; background: rgba(20,24,31,0.97); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; box-shadow: 0 18px 40px -10px rgba(0,0,0,0.65); padding: 0.45rem; box-sizing: border-box;">
        {#if popover.tipo === 'indicador' && indPop && popover.modo === 'elegir'}
          <div style="padding: 0.35rem 0.5rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.3rem;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #f1f5f9;">{t('notas.elegir.lleno', { n: MAX_INDICADORES_ACTIVOS })}</div>
            <div style="font-size: 0.66rem; color: #64748b; line-height: 1.35;">{t('notas.elegir.desc1', { n: indPop.orden })} <strong style="color:#94a3b8;">{t('notas.elegir.desc2')}</strong> {t('notas.elegir.desc3')}</div>
          </div>
          <div style="max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
            {#each activeIndicadores as cand (cand.id)}
              {@const nConNota = estudiantesConNota(cand)}
              {@const ptsCand = puntosDeIndicador(cand)}
              <button
                onclick={() => intercambiarActivo(indPop, cand)}
                disabled={procesandoAccion}
                title={t('notas.elegir.swapTitle', { a: cand.orden, b: indPop.orden })}
                style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.5rem; border-radius: 9px; border: 1px solid rgba(251,191,36,0.28); background: rgba(251,191,36,0.07); color: #fde68a; font-size: 0.74rem; cursor: pointer; text-align: left; transition: all 0.15s ease;">
                <span style="font-size: 0.85rem;">🔄</span>
                <span style="flex: 1; min-width: 0;">
                  <span style="display: block; font-weight: 700; font-size: 0.74rem;">{t('notas.indicador', { n: cand.orden })} · {isQualitative ? t('notas.elegir.cualitativo') : ptsCand + ' pts'}</span>
                  <span style="display: block; font-size: 0.62rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cand.descripcion || t('notas.sinDescripcion')}</span>
                </span>
                <span style="font-size: 0.6rem; padding: 0.1rem 0.3rem; border-radius: 5px; background: {nConNota > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)'}; color: {nConNota > 0 ? '#4ade80' : '#64748b'}; white-space: nowrap; flex-shrink: 0;" title={nConNota > 0 ? t('notas.elegir.conservaTitle', { n: nConNota }) : t('notas.sinNotas')}>
                  {nConNota > 0 ? t('notas.elegir.conservaCount', { n: nConNota }) : t('notas.elegir.vacio')}
                </span>
              </button>
            {/each}

          </div>
          <button
            onclick={cerrarPopover}
            style="width: 100%; margin-top: 0.35rem; padding: 0.4rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; font-size: 0.72rem; font-weight: 600; cursor: pointer;">{t('comun.cancelar')}</button>
        {:else if popover.tipo === 'indicador' && indPop}
          {@const sumaEnSeccion = idsActivos.includes(indPop.id)}
          <div style="padding: 0.35rem 0.5rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.3rem;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #f1f5f9;">{t('notas.indicador', { n: indPop.orden })}</div>
            <div style="font-size: 0.66rem; color: #64748b;">{indPop.descripcion || t('notas.sinDescripcion')} · {t('notas.criteriosCount', { n: indPop.criterios.length })} · {isQualitative ? t('notas.elegir.cualitativo') : puntosDeIndicador(indPop) + ' pts'}</div>
            <div style="font-size: 0.62rem; color: #64748b; margin-top: 0.15rem;">{colegios.find(c => c.id === selectedColegio)?.nombre || '—'} · {t('notas.chip.seccion')} <strong style="color:#94a3b8;">{secciones.find(s => s.id === selectedSeccion)?.nombre || '—'}</strong> · {sumaEnSeccion ? t('notas.popover.sumaAqui') : t('notas.popover.noSumaAqui')}</div>
          </div>
          <button
            onclick={() => alternarActivoIndicador(indPop)}
            disabled={procesandoAccion}
            style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.55rem; border-radius: 9px; border: 1px solid {sumaEnSeccion ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.3)'}; background: {sumaEnSeccion ? 'rgba(251,191,36,0.1)' : 'rgba(34,197,94,0.1)'}; color: {sumaEnSeccion ? '#fbbf24' : '#4ade80'}; font-size: 0.78rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease;">
            <span style="font-size: 0.9rem;">{sumaEnSeccion ? '👁' : '✔'}</span>
            <span>{sumaEnSeccion ? t('notas.popover.dejarSumar') : t('notas.popover.sumarSeccion')}</span>
          </button>
          <div style="font-size: 0.62rem; color: #64748b; padding: 0.2rem 0.55rem 0.35rem; line-height: 1.3;">
            {#if sumaEnSeccion}
              {t('notas.popover.ayuda1')}
            {:else if activeIndicadores.length >= MAX_INDICADORES_ACTIVOS}
              {t('notas.popover.ayuda2', { n: MAX_INDICADORES_ACTIVOS, a: activeIndicadores.length })}
            {:else}
              {t('notas.popover.ayuda3', { a: activeIndicadores.length, b: MAX_INDICADORES_ACTIVOS })}
            {/if}
          </div>
          {#if seccionTieneExcepciones}
            <button
              onclick={restablecerActivosSeccion}
              disabled={procesandoAccion}
              title={t('notas.popover.restablecerTitulo')}
              style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.55rem; border-radius: 9px; border: 1px solid rgba(148,163,184,0.3); background: rgba(148,163,184,0.08); color: #cbd5e1; font-size: 0.74rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease; margin-bottom: 0.3rem;">
              <span style="font-size: 0.85rem;">↩</span>
              <span>{t('notas.popover.restablecer')}</span>
            </button>
          {/if}
          <button
            onclick={() => vaciarNotasIndicador(indPop)}
            disabled={procesandoAccion}
            style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.55rem; border-radius: 9px; border: 1px solid rgba(245,158,11,0.3); background: rgba(245,158,11,0.1); color: #fbbf24; font-size: 0.78rem; font-weight: 600; cursor: pointer; text-align: left; transition: all 0.15s ease;">
            <span style="font-size: 0.9rem;">🧹</span>
            <span>{t('notas.popover.vaciar')}</span>
          </button>
          <div style="font-size: 0.62rem; color: #64748b; padding: 0.2rem 0.55rem 0.1rem; line-height: 1.3;">{t('notas.popover.vaciarAyuda', { n: indPop.criterios.length, corte: cortes.find(c => c.id === selectedCorte)?.nombre || t('notas.esteCorte') })}</div>
        {:else if popover.tipo === 'criterio' && indPop && critPop}
          <div style="padding: 0.35rem 0.5rem 0.45rem; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 0.3rem;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #f1f5f9;">{t('notas.popover.criterioTitulo', { c: critPop.orden, i: indPop.orden })}</div>
            <div style="font-size: 0.66rem; color: #64748b;">{critPop.descripcion || t('notas.sinDescripcion')}{!isQualitative ? t('notas.popover.maxPts', { n: critPop.puntajeMaximo }) : ''}</div>
          </div>
          <div style="font-size: 0.68rem; color: #a78bfa; font-weight: 700; padding: 0.15rem 0.55rem 0.35rem; text-transform: uppercase; letter-spacing: 0.4px;">{t('notas.popover.aplicarTodos')}</div>
          <label style="display: flex; align-items: center; gap: 0.45rem; padding: 0.3rem 0.5rem 0.4rem 0.35rem; cursor: pointer;">
            <span class="switch" style="margin: 0;">
              <input type="checkbox" checked={aplicarSoloVacias} onchange={() => aplicarSoloVacias = !aplicarSoloVacias} />
              <span class="slider round" style="background: {aplicarSoloVacias ? 'linear-gradient(135deg, #38bdf8, #0284c7)' : 'rgba(255,255,255,0.12)'}; border-color: {aplicarSoloVacias ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
            </span>
            <span style="line-height: 1.2;">
              <span style="display: block; font-size: 0.7rem; color: #cbd5e1; font-weight: 500;">{t('notas.popover.soloVacias')}</span>
              <span style="display: block; font-size: 0.62rem; color: {aplicarSoloVacias ? '#38bdf8' : '#94a3b8'};">{aplicarSoloVacias ? t('notas.popover.soloVaciasEstado') : t('notas.popover.sobrescribeEstado')}</span>
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
            <span>{t('notas.popover.eliminarCriterio')}</span>
          </button>
          <div style="font-size: 0.62rem; color: #64748b; padding: 0.2rem 0.55rem 0.1rem; line-height: 1.3;">{t('notas.popover.eliminarAyuda', { n: critPop.orden })}</div>
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
              <h3 style="margin: 0; color: #f1f5f9; font-size: 1.15rem; font-weight: 700;">{t('notas.dist.titulo')}</h3>
               <p style="margin: 0.2rem 0 0; color: #94a3b8; font-size: 0.75rem;">{isQualitative ? t('notas.dist.subCual', { c3: distribuirC3 ? t('notas.dist.subCualC3') : '', sinC3: distribuirC3 ? '' : t('notas.dist.subCualSinC3') }) : t('notas.dist.subNum', { c3: distribuirC3 ? t('notas.dist.subCualC3') : '' })}</p>
              {#if !isQualitative}
                <p style="margin: 0.25rem 0 0; color: #64748b; font-size: 0.68rem;">
                  {t('notas.dist.consejo1')}<strong style="color:#a78bfa;">C1 ≤ C2 ≤ C3</strong>{t('notas.dist.consejo2')}
                </p>
              {/if}
              {#if contextoChips.some(c => c.label)}
                <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.4rem;">
                  {#each contextoChips as chip (chip.icon)}
                    {#if chip.label}
                      <span title={t('notas.dist.chipTitle', { titulo: chip.titulo, label: chip.label })} style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.18rem 0.5rem; border-radius: 999px; background: {chip.color}14; border: 1px solid {chip.color}33; font-size: 0.7rem; color: #e2e8f0; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;">
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
                <span style="display: block; font-size: 0.78rem; color: #cbd5e1; font-weight: 500;">{t('notas.popover.sobrescribir')}</span>
                <span style="display: block; font-size: 0.68rem; color: {distribuirOverwrite ? '#a78bfa' : '#22c55e'};">{distribuirOverwrite ? t('notas.dist.overwriteOn') : t('notas.dist.overwriteOff')}</span>
              </span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.55rem; padding: 0.4rem 0.75rem 0.4rem 0.55rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; cursor: pointer; transition: all 0.2s ease;">
              <span class="switch" style="margin: 0;">
                <input type="checkbox" checked={distribuirC3} onchange={() => distribuirC3 = !distribuirC3} />
                <span class="slider round" style="background: {distribuirC3 ? 'linear-gradient(135deg, #f472b6, #db2777)' : 'rgba(255,255,255,0.12)'}; border-color: {distribuirC3 ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
              </span>
              <span style="line-height: 1.2;">
                <span style="display: block; font-size: 0.78rem; color: #cbd5e1; font-weight: 500;">{t('notas.popover.modificarC3')}</span>
                <span style="display: block; font-size: 0.68rem; color: {distribuirC3 ? '#f472b6' : '#f59e0b'};">{distribuirC3 ? t('notas.dist.c3On') : t('notas.dist.c3Off')}</span>
              </span>
            </label>
            {#if cortesPrecios.length > 0}
              <label style="display: flex; align-items: center; gap: 0.55rem; padding: 0.4rem 0.75rem 0.4rem 0.55rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; cursor: pointer; transition: all 0.2s ease;">
                <span class="switch" style="margin: 0;">
                  <input type="checkbox" checked={mostrarComparacion} onchange={() => mostrarComparacion = !mostrarComparacion} />
                  <span class="slider round" style="background: {mostrarComparacion ? 'linear-gradient(135deg, #a78bfa, #7c3aed)' : 'rgba(255,255,255,0.12)'}; border-color: {mostrarComparacion ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
                </span>
                <span style="line-height: 1.2;">
                  <span style="display: block; font-size: 0.78rem; color: #cbd5e1; font-weight: 500;">{t('notas.popover.compararCortes')}</span>
                  <span style="display: block; font-size: 0.68rem; color: {cargandoComparacion ? '#a78bfa' : '#64748b'};">
                    {#if cargandoComparacion}{t('notas.dist.cargandoAnt')}
                    {:else if mostrarComparacion}{t(cortesPrecios.length > 1 ? 'notas.dist.colConNotaN' : 'notas.dist.colConNota1', { n: cortesPrecios.length })}
                    {:else}{t('notas.dist.notaFinalAnterior')}{/if}
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
                  <th style="min-width: 150px; text-align: left; padding: 0.4rem 0.6rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.06);">{t('notas.col.estudiante')}</th>
                  {#if mostrarComparacion}
                    {#each cortesPrecios as corte (corte.id)}
                      <th class="col-num" title={corte.nombre} style="text-align: center; padding: 0.3rem 0.3rem; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(167,139,250,0.15);">
                        <div style="font-size: 0.66rem; color: #a78bfa; font-weight: 700; white-space: nowrap;">{nombreCortoCorte(corte.nombre)}</div>
                        <div style="font-size: 0.5rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">{t('notas.dist.corte')}</div>
                      </th>
                    {/each}
                  {/if}
                  <th class="col-num" title={t('notas.dist.corteDistribuyendo', { nombre: corteActualNombre })} style="text-align: center; padding: 0.3rem 0.3rem; background: rgba(244,114,182,0.16); border-bottom: 2px solid rgba(244,114,182,0.5); border-left: 1px solid rgba(244,114,182,0.2); border-right: 1px solid rgba(244,114,182,0.2);">
                    <div style="font-size: 0.68rem; color: #fbcfe8; font-weight: 700; white-space: nowrap;">{nombreCortoCorte(corteActualNombre)}</div>
                    <div style="font-size: 0.5rem; color: #f472b6; text-transform: uppercase; letter-spacing: 0.3px;">{t('notas.dist.corteActual')}</div>
                  </th>
                  <!-- Se quitó la columna "Meta" (solo cualitativo): repetía literalmente
                       la letra elegida en la columna "Nota objetivo" de la derecha, sin
                       aportar nada. Su sentido de "total objetivo" solo aplica a las notas
                       numéricas, y ese caso ya tiene su propia columna "Nuevo total". -->
                  <th class="col-num" title={isQualitative ? t('notas.dist.metaCual') : t('notas.dist.metaNum')} style="text-align: center; padding: 0.4rem 0.4rem; background: rgba(15, 23, 42, 0.95); color: #a78bfa; font-weight: 600; white-space: nowrap; border-bottom: 1px solid rgba(139,92,246,0.15);">{isQualitative ? t('notas.dist.nuevaNota') : t('notas.dist.resultante')}</th>
                  <th class="col-num" style="text-align: center; padding: 0.4rem 0.4rem; background: rgba(15, 23, 42, 0.95); color: #94a3b8; font-weight: 600; white-space: nowrap; border-bottom: 1px solid rgba(255,255,255,0.06);">{isQualitative ? t('notas.dist.notaObjetivo') : t('notas.dist.nuevoTotal')}</th>
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
                          <td class="col-num" title={t('notas.dist.corteTitulo', { nombre: corte.nombre, valor: pctPrevCorte === null ? t('notas.dist.sinNotas') : (isQualitative ? gradePrevCorte : pctPrevCorte) })} style="padding: 0.3rem 0.3rem; text-align: center; white-space: nowrap; font-size: 0.74rem; font-weight: 600; color: {isQualitative ? (gradePrevCorte ? getGradeColor(gradePrevCorte) : '#94a3b8') : colorPctAnterior(pctPrevCorte)};">

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
                    <td class="col-num" title={t('notas.dist.notaFinalActual', { nombre: corteActualNombre })} style="padding: 0.3rem 0.3rem; text-align: center; white-space: nowrap; background: rgba(244,114,182,0.07); border-left: 1px solid rgba(244,114,182,0.2); border-right: 1px solid rgba(244,114,182,0.2);">
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
              style="padding: 0.5rem 1rem; border-radius: 10px; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-weight: 600; font-size: 0.82rem; cursor: pointer;">{t('comun.cancelar')}</button>
            <button onclick={distribuirNotas}
              style="padding: 0.5rem 1.2rem; border-radius: 10px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border: none; color: white; font-weight: 700; font-size: 0.82rem; cursor: pointer; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);">
              {t('notas.dist.aplicar')}
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
            <h3 style="margin: 0; color: #f1f5f9; font-size: 1.15rem; font-weight: 700;">{t('notas.inst.titulo')}</h3>
            <button onclick={() => showInstrumentosModal = false} style="background: transparent; border: none; color: #64748b; font-size: 1.2rem; cursor: pointer;">✕</button>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
            <button onclick={generarTodosInstrumentos} disabled={generatingPdf}
              style="flex: 1; padding: 0.55rem; border-radius: 10px; border: none; background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; font-weight: 700; font-size: 0.8rem; cursor: pointer; opacity: {generatingPdf ? 0.6 : 1};">
              {generatingPdf ? t('notas.inst.generando') : t('notas.inst.generarTodos')}
            </button>
            <button onclick={() => mostrarAyudaExcel = !mostrarAyudaExcel}
              style="padding: 0.55rem 0.8rem; border-radius: 10px; border: 1px dashed rgba(34,197,94,0.5); background: rgba(34,197,94,0.08); color: #86efac; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
              {t('notas.inst.ayudaExcel')}
            </button>
          </div>

          <!-- Plantilla Excel de la carpeta fija -->
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.65rem 0.8rem; background: rgba(34,197,94,0.07); border: 1px solid rgba(34,197,94,0.3); border-radius: 12px; margin-bottom: 1rem;">
            <span style="color: #86efac; font-weight: 700; font-size: 0.72rem;">{t('notas.inst.plantillaTitulo')}</span>
            {#if cargandoPlantillas}
              <span style="color:#64748b;font-size:0.72rem;">{t('notas.inst.cargandoPlantillas')}</span>
            {:else if plantillas.length === 0}
              <span style="color:#fbbf24;font-size:0.72rem;">{t('notas.inst.sinPlantillas')}</span>
            {:else}
              <select bind:value={plantillaSel}
                style="flex: 1; min-width: 180px; padding: 0.3rem 0.4rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(15,23,42,0.8); color: #e2e8f0; font-size: 0.72rem; outline: none;">
                <option value="">{t('notas.inst.auto')}</option>
                {#each plantillas as p (p.ruta)}
                  <option value={p.nombre}>{p.tipo === 'rubrica' ? t('notas.inst.tipoRubrica') : p.tipo === 'cotejo' ? t('notas.inst.tipoCotejo') : t('notas.inst.tipoEscala')} — {p.nombre}</option>
                {/each}
              </select>
            {/if}
            <button onclick={abrirCarpetaDePlantillas} title={t('notas.inst.abrirCarpeta')}
              style="padding: 0.3rem 0.6rem; border-radius: 8px; border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.12); color: #86efac; cursor: pointer; font-size: 0.68rem; font-weight: 700; flex-shrink: 0;">{t('notas.inst.carpeta')}</button>
            <button onclick={() => void recargarPlantillas()} disabled={cargandoPlantillas} title={t('notas.inst.recargar')}
              style="padding: 0.3rem 0.5rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.68rem; flex-shrink: 0;">↻</button>
          </div>

          {#if mostrarAyudaExcel}
            <div style="margin-bottom: 1rem; border: 1px solid rgba(34,197,94,0.35); border-radius: 12px; overflow: hidden;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.6rem 0.8rem; background: rgba(34,197,94,0.1);">
                <span style="color: #86efac; font-weight: 700; font-size: 0.75rem;">{t('notas.inst.ayudaTitulo')}</span>
                <button onclick={copiarAyudaPlantilla}
                  style="padding: 0.3rem 0.6rem; border-radius: 6px; border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.15); color: #86efac; cursor: pointer; font-size: 0.65rem; font-weight: 700; flex-shrink: 0;">
                  {t('notas.inst.copiarInstrucciones')}
                </button>
              </div>
              <pre style="white-space: pre-wrap; margin: 0; padding: 0.8rem; background: rgba(0,0,0,0.3); color: #cbd5e1; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.62rem; line-height: 1.55;">{ayudaPlantillaTexto()}</pre>
            </div>
          {/if}

          {#each indicadoresSeccion as ind (ind.id)}
            {@const tipoActual = normTipo((ind as any).instrumento)}
            {@const disponibles = INSTRUMENTO_TIPOS.filter(tipo => plantillas.some(p => p.tipo === tipo.id))}
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.7rem; background: {ind.activo ? 'rgba(255,255,255,0.03)' : 'rgba(100,116,139,0.06)'}; border: 1px solid {ind.activo ? 'rgba(255,255,255,0.06)' : 'rgba(100,116,139,0.22)'}; border-radius: 12px; margin-bottom: 0.45rem; flex-wrap: wrap;">
              <span style="width: 26px; height: 26px; border-radius: 8px; background: {ind.activo ? 'rgba(14,165,233,0.15)' : 'rgba(100,116,139,0.15)'}; color: {ind.activo ? '#7dd3fc' : '#94a3b8'}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.72rem; flex-shrink: 0;">{ind.orden}</span>
              <div style="flex: 1; min-width: 140px;">
                <div style="color: {ind.activo ? '#e2e8f0' : '#94a3b8'}; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{ind.descripcion || t('notas.sinDescripcionPar')}{#if !ind.activo}<span style="font-size: 0.62rem; color: #64748b;">{' '}{t('notas.noSumaTotal')}</span>{/if}</div>
                <div style="color: #64748b; font-size: 0.65rem;">{t('notas.criteriosCount', { n: ind.criterios.length })}</div>
              </div>
              <select value={disponibles.some(tipo => tipo.id === tipoActual) ? tipoActual : (disponibles[0]?.id ?? tipoActual)}
                onchange={(e) => setInstrumento(ind, (e.target as HTMLSelectElement).value as InstrumentoTipo)}
                disabled={disponibles.length === 0}
                title={disponibles.length === 0 ? t('notas.inst.sinPlantillasTitulo') : ''}
                style="padding: 0.3rem 0.4rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(15,23,42,0.8); color: {disponibles.length === 0 ? '#64748b' : '#e2e8f0'}; font-size: 0.72rem; outline: none; max-width: 150px;">
                {#each disponibles as op}
                  <option value={op.id}>{op.label}</option>
                {/each}
              </select>
              <button onclick={() => generarPDFInstrumento(ind)} disabled={generatingPdf}
                title={t('notas.inst.tituloPdf')}
                style="padding: 0.35rem 0.6rem; border-radius: 8px; border: 1px solid rgba(14,165,233,0.35); background: rgba(14,165,233,0.12); color: #7dd3fc; cursor: pointer; font-size: 0.7rem; font-weight: 700; flex-shrink: 0;">PDF</button>
              <button onclick={() => generarExcelInstrumento(ind)} disabled={excelGenerating}
                title={t('notas.inst.tituloXls')}
                style="padding: 0.35rem 0.55rem; border-radius: 8px; border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.12); color: #86efac; cursor: pointer; font-size: 0.68rem; font-weight: 700; flex-shrink: 0;">XLS</button>
            </div>
          {:else}
            <div style="text-align: center; padding: 1rem; color: #64748b; font-size: 0.8rem;">{t('notas.inst.sinIndicadores')}</div>
          {/each}

          <p style="margin: 0.75rem 0 0; color: #64748b; font-size: 0.68rem; text-align: center;">
            {t('notas.inst.pie')}
          </p>

          <!-- Guía plantilla Excel -->
          <div style="margin-top: 0.75rem; padding: 0.7rem 0.8rem; background: rgba(34,197,94,0.06); border: 1px dashed rgba(34,197,94,0.35); border-radius: 12px;">
            <div style="color: #86efac; font-weight: 700; font-size: 0.72rem; margin-bottom: 0.4rem;">{t('notas.inst.guiaTitulo')}</div>
            <p style="margin: 0 0 0.4rem; color: #94a3b8; font-size: 0.68rem; line-height: 1.5;">
              {t('notas.inst.guia1a')}<span style="color:#86efac;font-weight:700;">XLS</span>{t('notas.inst.guia1b')}<span style="color:#e2e8f0;">{t('notas.inst.guia1diseno')}</span>{t('notas.inst.guia1c')}
            </p>
            <div style="font-family: monospace; font-size: 0.62rem; color: #86efac; line-height: 1.6;">
              {'{COLEGIO}'} {'{ANO}'} {'{CORTE}'} {'{ASIGNATURA}'} {'{GRADO}'} {'{SECCION}'}<br>
              {'{IND_ORDEN}'} {'{IND_TEXTO}'} {'{CRITERIOS_LISTA}'}
            </div>
            <p style="margin: 0.4rem 0 0; color: #94a3b8; font-size: 0.66rem; line-height: 1.5;">
              <span style="color:#e2e8f0;">{t('notas.inst.guia2a')}</span>{t('notas.inst.guia2b')}<span style="font-family: monospace; color:#86efac;">{'{{FILAS}}'}</span>{t('notas.inst.guia2c')}<span style="font-family: monospace; color:#86efac;">{'{NUM} {NOMBRE} {SEXO} {LETRA_1} {LETRA_2} … {VAL_IND}'}</span>{t('notas.inst.guia2d')}
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
              <h3 style="margin: 0; color: #f1f5f9; font-size: 1.2rem; font-weight: 700;">{t('notas.del.titulo')}</h3>
              <p style="margin: 0.25rem 0 0; color: #94a3b8; font-size: 0.8rem;">{t('notas.del.noDeshacer')}</p>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem;">
            <!-- Option: Todas -->
            <div onclick={() => deleteMode = 'all'}
              style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; padding: 0.85rem 1rem; border-radius: 12px; background: {deleteMode === 'all' ? 'rgba(239, 68, 68, 0.08)' : 'transparent'}; border: {deleteMode === 'all' ? '1.5px solid rgba(239, 68, 68, 0.4)' : '1.5px solid rgba(255,255,255,0.06)'}; transition: all 0.2s ease;">
              <div style="width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; border: {deleteMode === 'all' ? '6px solid #ef4444' : '2px solid rgba(255,255,255,0.2)'}; background: {deleteMode === 'all' ? '#ef4444' : 'transparent'};"></div>
              <div>
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">{t('notas.del.todas')}</div>
                <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">{t('notas.del.todasDesc')}</div>
              </div>
            </div>

            <!-- Option: Por estudiante -->
            <div onclick={() => { deleteMode = 'student'; deleteStudentId = 0; }}
              style="display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; padding: 0.85rem 1rem; border-radius: 12px; background: {deleteMode === 'student' ? 'rgba(var(--primary-rgb), 0.08)' : 'transparent'}; border: {deleteMode === 'student' ? '1.5px solid rgba(var(--primary-rgb), 0.4)' : '1.5px solid rgba(255,255,255,0.06)'};">
              <div style="width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; border: {deleteMode === 'student' ? '6px solid var(--primary-color)' : '2px solid rgba(255,255,255,0.2)'}; background: {deleteMode === 'student' ? 'var(--primary-color)' : 'transparent'};"></div>
              <div style="flex: 1;">
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">{t('notas.del.porEstudiante')}</div>
                <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">{t('notas.del.porEstudianteDesc')}</div>
                {#if deleteMode === 'student'}
                  <select value={deleteStudentId} onchange={(e) => deleteStudentId = Number((e.currentTarget as HTMLSelectElement).value)} onclick={(e) => e.stopPropagation()}
                    style="width: 100%; margin-top: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 0.82rem; cursor: pointer; outline: none;">
                    <option value={0}>{t('notas.del.selEstudiante')}</option>
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
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">{t('notas.del.porIndicador')}</div>
                <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">{t('notas.del.porIndicadorDesc')}</div>
                {#if deleteMode === 'indicator'}
                  <select value={deleteIndicatorId} onchange={(e) => deleteIndicatorId = Number((e.currentTarget as HTMLSelectElement).value)} onclick={(e) => e.stopPropagation()}
                    style="width: 100%; margin-top: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 0.82rem; cursor: pointer; outline: none;">
                    <option value={0}>{t('notas.del.selIndicador')}</option>
                    {#each indicadoresSeccion.filter(i => i.activo) as ind}
                      <option value={ind.id}>{t('notas.indicador', { n: ind.orden })}: {ind.descripcion || t('notas.indicador', { n: ind.orden })}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 1rem;">
            <button onclick={() => showDeleteModal = false}
              style="padding: 0.6rem 1.2rem; border-radius: 10px; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.15s ease;">{t('comun.cancelar')}</button>
            <button onclick={handleDeleteNotas} disabled={deleting}
              style="padding: 0.6rem 1.4rem; border-radius: 10px; background: {deleting ? 'rgba(239, 68, 68, 0.5)' : 'linear-gradient(135deg, #ef4444, #dc2626)'}; border: none; color: white; font-weight: 700; font-size: 0.85rem; cursor: {deleting ? 'not-allowed' : 'pointer'}; transition: all 0.2s ease; box-shadow: {deleting ? 'none' : '0 4px 14px rgba(239, 68, 68, 0.35)'};">
              {deleting ? t('notas.del.eliminando') : t('comun.continuar')}
            </button>
          </div>
        </div>
      </div>
    {/if}



    </div>
</div>

{/if}
<style>
    @media print {
      :root{color-scheme:light!important}
      *,*::before,*::after{background-color:white!important;background-image:none!important;color:black;box-shadow:none!important;text-shadow:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;position:static!important}
      html,body,#root,.app-layout,.main-content,.page-container{background:white!important;background-color:white!important;color:black!important;margin:0!important;padding:0!important;width:100%!important;height:auto!important;overflow:visible!important;display:block!important;position:static!important}
      nav,.sidebar,.navbar,.no-print,button,.filters-section,.background-decoration,.resizer,.loading-spinner,.input-container,.sidebar-nav,.sidebar-title,.filters-row,.category-card:not(.print-header):not(.table-card){display:none!important}
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
    @media (max-width:768px){
      .asistencia-summary{overflow-y:auto;-webkit-overflow-scrolling:touch;max-height:calc(100dvh - 170px)}
    }
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .table-row-hover:hover{background-color:rgba(255,255,255,0.04)!important}
    .filter-select{width:100%;background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.1);color:white;padding:0.6rem;border-radius:8px;outline:none;cursor:pointer}
    .filter-select:focus{border-color:var(--primary-color)}
    .notas-table-container::-webkit-scrollbar{width:6px}
    .notas-table-container::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);border-radius:3px}
    .notas-table-container::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:3px}
    .notas-table-container::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
    .notas-table-container table thead th{background:#1e293b!important;position:sticky;top:0;z-index:100}
  </style>
