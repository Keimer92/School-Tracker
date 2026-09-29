<script lang="ts">
  import { onMount } from "svelte";
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import { loadAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import { ask } from "@tauri-apps/plugin-dialog";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
import SelectChip from "./SelectChip.svelte";
import { portalToBody } from "../lib/portalToBody";
  import FiltersModalAndroid from "./FiltersModalAndroid.svelte";
  import SearchFab from "./SearchFab.svelte";
  import PageLayout from "./PageLayout.svelte";
  import ScrollableTable from "./ScrollableTable.svelte";
  import DatePickerGlass from "./DatePickerGlass.svelte";
  import BotonMod from "./BotonMod.svelte";

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
  let showAnoDropdown = $state(localStorage.getItem('stp_show_ano_dropdown') !== 'false');
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
  let hasUnsavedChanges = $derived(hayDiffDiario() || hayDiffMulti());
  let pendingRefreshOnSave = $state(false);
  let selectedStudentDetail: EstudianteAsistencia | null = $state(null);
  let showSummaryModal = $state<{ show: boolean; type: string; stats: { total: number; m: number; f: number } | null }>({ show: false, type: "", stats: null });

  // ── Snapshot del SERVIDOR (sin borrador) para detectar diffs reales ──
  // Un toggle P→null vuelve al estado original → ya NO cuenta como cambio.
  const norm = (e: string | null | undefined) => (e === '-' ? null : e ?? null);
  let originalDiario = $state<Record<number, { estado: string | null; observacion: string }>>({});
  let originalMulti = $state<Record<string, { estado: string | null; observacion: string }>>({});

  function hayDiffDiario(): boolean {
    for (const est of estudiantes) {
      const o = originalDiario[est.id];
      if (!o) continue;
      if (norm(est.estado) !== norm(o.estado) || (est.observacion || '') !== (o.observacion || '')) return true;
    }
    return false;
  }

  function hayDiffMulti(): boolean {
    for (const est of estudiantesMulti) {
      for (const f of fechasPeriodo) {
        const o = originalMulti[`${est.id}|${f}`];
        if (!o) continue;
        const dDraft = draftMulti[est.id]?.[f];
        const effEstado = dDraft?.estado !== undefined ? dDraft.estado : (est.dias[f]?.estado ?? null);
        const effObs = dDraft?.observacion ?? est.dias[f]?.observacion ?? '';
        if (norm(effEstado) !== norm(o.estado) || (effObs || '') !== (o.observacion || '')) return true;
      }
    }
    return false;
  }

  /** Tras un guardado exitoso: el estado actual pasa a ser la nueva referencia. */
  function capturarOriginalDiario() {
    const snap: Record<number, { estado: string | null; observacion: string }> = {};
    for (const est of estudiantes) snap[est.id] = { estado: norm(est.estado), observacion: est.observacion || '' };
    originalDiario = snap;
  }

  function capturarOriginalMulti() {
    const snap: Record<string, { estado: string | null; observacion: string }> = {};
    for (const est of estudiantesMulti) {
      for (const f of fechasPeriodo) {
        snap[`${est.id}|${f}`] = { estado: norm(est.dias[f]?.estado), observacion: est.dias[f]?.observacion || '' };
      }
    }
    originalMulti = snap;
  }

  $effect(() => {
    if (!visible) return;
    if (selectedStudentDetail) {
      return registerBackHandler(() => { selectedStudentDetail = null; return true; });
    }
  });

  $effect(() => {
    if (showSummaryModal.show) {
      return registerBackHandler(() => { showSummaryModal = { ...showSummaryModal, show: false }; return true; });
    }
  });

  $effect(() => {
    if (obsModalStudent) {
      return registerBackHandler(() => { obsModalStudent = null; expandedObs = {}; return true; });
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
      untrack(() => {
        if (periodo === "diario") {
          if (selectedFecha && isFechaHabilitada) fetchEstudiantes();
        } else {
          fetchEstudiantesMulti();
        }
      });
    }
  });
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

  // Ancho de los modales (Sin Clases / Semana): más grande y cómodo en Windows,
  // ajustado al viewport en móvil para no salirse de pantalla.
  const modalCardWidth = isWindows ? 'min(480px, calc(100vw - 64px))' : 'min(320px, calc(100vw - 32px))';

  let draft: Record<number, { estado: string | null; observacion: string | null }> = {};

  type AsistenciaPeriodo = "diario" | "semanal" | "mensual";
  /**
   * El período predeterminado es Mensual (se abre el mes en curso, que es lo que
   * se usa a diario). Solo si no hay nada guardado se aplica ese valor: la
   * preferencia del usuario se respeta.
   *
   * En Windows el filtro Diario no se ofrece: la pantalla es lo bastante ancha
   * para que Semanal y Mensual sean más útiles. Si quedó persistido "diario"
   * desde Android o de una versión anterior, se migra a Mensual en vez de dejar
   * el <select> sin opción coincidente.
   */
  let periodo = $state<AsistenciaPeriodo>((() => {
    const guardado = localStorage.getItem("asistencia_periodo") as AsistenciaPeriodo | null;
    if (guardado === "diario" && /Windows/i.test(navigator.userAgent)) return "mensual";
    return guardado || "mensual";
  })());


  let estudiantesMulti: Array<{ id: number; nombre: string; codigo: string; sexo: string; dias: Record<string, DiaEstado> }> = $state([]);
  let fechasPeriodo: string[] = $state([]);
  let draftMulti: Record<number, Record<string, DiaEstado>> = $state({});
  let mesSeleccionado = $state(new Date().getMonth() + 1);
  let anoSeleccionado = $state(new Date().getFullYear());
  /**
   * El año calendario del mes sigue al año lectivo: ya no hay un segundo
   * selector de año, el de "Año Lectivo" es el único que se elige.
   */
  $effect(() => {
    const n = Number(anos.find(a => a.id === selectedAno)?.nombre);
    if (Number.isFinite(n) && n > 1900) anoSeleccionado = n;
  });
  let mesesOptions = $derived(Array.from({ length: 12 }, (_, i) => {
    const raw = new Date(2000, i, 1).toLocaleDateString('es-ES', { month: 'long' });
    return { value: i + 1, label: raw.charAt(0).toUpperCase() + raw.slice(1) };
  }));

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

  // Modal de filtros (solo Android): agrupa Año/Colegio/Grado/Sección/Sexo para
  // liberar espacio vertical en móvil.
  let showFiltersModal = $state(false);
  // Calendario abierto: la fila de acciones pasa de overflow-x:auto a visible
  // para que el panel del DatePicker no quede recortado por el contenedor.
  let dpAbierto = $state(false);

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
    if (popSemanaAbierta) {
      return registerBackHandler(() => { cerrarPopSemana(); return true; });
    }
  });

  $effect(() => {
    if (showFiltersModal && isAndroidMobile) {
      return registerBackHandler(() => { showFiltersModal = false; return true; });
    }
  });

  // ── Popover de estado P/A/J ──
  // Antes eran tres botones (`rapido-overlay`) posicionados en `absolute` DENTRO
  // de la celda: como viven en un `td` dentro de un contenedor con scroll y con
  // ancestros `backdrop-filter`, se pintaban por encima de la barra de filtros
  // y se salían del wrapper. Ahora hay un solo disparador por celda y la lista
  // P/A/J vive en un panel `fixed` montado en `<body>` (portalToBody), igual que
  // el popover de Acciones de NotasPage.
  type PopEstado = {
    x: number;
    y: number;
    /** `auto` o px: abierto hacia arriba se ancla por el borde inferior. */
    abajo: string;
    estId: number;
    fecha: string;
    actual: string | null;
  };
  const ESTADOS_PAJ = [
    { id: 'P', label: 'Presente', color: '#10b981', suave: 'rgba(16,185,129,0.10)', borde: 'rgba(16,185,129,0.3)' },
    { id: 'A', label: 'Ausente', color: '#ef4444', suave: 'rgba(239,68,68,0.10)', borde: 'rgba(239,68,68,0.3)' },
    { id: 'J', label: 'Justificado', color: '#f59e0b', suave: 'rgba(245,158,11,0.10)', borde: 'rgba(245,158,11,0.3)' },
  ] as const;
  const ANCHO_POP_ESTADO = 178;

  let popEstado = $state<PopEstado | null>(null);
  let popEstadoPanelEl = $state<HTMLDivElement | null>(null);
  let popEstadoBtn = $state<HTMLElement | null>(null);

  function abrirPopEstado(estId: number, fecha: string, actual: string | null, btn: HTMLElement) {
    // El disparador llega desde `event.currentTarget` a propósito: el snippet se
    // renderiza una vez por celda, así que un `bind:this` compartido apuntaría
    // siempre a la última celda montada y el popover se anclaría en otro sitio.
    const r = btn.getBoundingClientRect();
    if (!r) { console.warn('[Estado] botón sin referencia; no se puede anclar el popover'); return; }
    const altoEstimado = ESTADOS_PAJ.length * 38 + 12;
    const abreArriba = r.bottom + altoEstimado > window.innerHeight && r.top > altoEstimado;
    popEstadoBtn = btn;
    popEstado = {
      x: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - ANCHO_POP_ESTADO - 8)),
      y: abreArriba ? 0 : Math.round(r.bottom + 4),
      abajo: abreArriba ? `${Math.round(window.innerHeight - r.top + 4)}px` : 'auto',
      estId,
      fecha,
      actual,
    };
  }

  function cerrarPopEstado() { popEstado = null; popEstadoBtn = null; }

  function elegirEstadoPop(id: 'P' | 'A' | 'J') {
    if (!popEstado) return;
    const { estId, fecha } = popEstado;
    cerrarPopEstado();
    handleEstadoChangeMulti(estId, fecha, id);
  }

  $effect(() => {
    if (!popEstado) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (t && (popEstadoPanelEl?.contains(t) || popEstadoBtn?.contains(t))) return;
      cerrarPopEstado();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrarPopEstado(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cerrarPopEstado);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cerrarPopEstado);
    };
  });

  $effect(() => {
    if (popEstado) {
      return registerBackHandler(() => { cerrarPopEstado(); return true; });
    }
  });

  // ── Popover "Marcar todos" (Todos P / A / J) ──
  // Mismo patrón que el popover de Acciones de NotasPage: un BotonMod que
  // ancla un panel `fixed` con las acciones dentro. Antes eran 3 BotonMod
  // sueltos en la cinta de filtros y, con todos los chips desplegables, la fila
  // se iba de ancho.
  const ANCHO_POP_MASIVOS = 242;
  let popMasivos = $state<{ x: number; y: number; abajo: string } | null>(null);
  let popMasivosPanelEl = $state<HTMLDivElement | null>(null);
  let popMasivosBtn = $state<HTMLElement | null>(null);
  /** Ref del BotonMod disparador, para anclar el panel. */
  let popMasivosBtnEl = $state<HTMLElement | null>(null);

  function togglePopMasivos(btn: HTMLElement) {
    if (popMasivos) { cerrarPopMasivos(); return; }
    const r = btn.getBoundingClientRect();
    if (!r) { console.warn('[Masivos] botón sin referencia; no se puede anclar el popover'); return; }
    const altoEstimado = 3 * 52 + 12;
    const abreArriba = r.bottom + altoEstimado > window.innerHeight && r.top > altoEstimado;
    popMasivosBtn = btn;
    popMasivos = {
      x: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - ANCHO_POP_MASIVOS - 8)),
      y: abreArriba ? 0 : Math.round(r.bottom + 4),
      abajo: abreArriba ? `${Math.round(window.innerHeight - r.top + 4)}px` : 'auto',
    };
  }

  function cerrarPopMasivos() { popMasivos = null; popMasivosBtn = null; }

  /** Ejecuta una acción del popover y lo cierra. */
  function accionMasivos(fn: () => void) {
    cerrarPopMasivos();
    fn();
  }

  $effect(() => {
    if (!popMasivos) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (t && (popMasivosPanelEl?.contains(t) || popMasivosBtn?.contains(t))) return;
      cerrarPopMasivos();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrarPopMasivos(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cerrarPopMasivos);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cerrarPopMasivos);
    };
  });

  $effect(() => {
    if (popMasivos) {
      return registerBackHandler(() => { cerrarPopMasivos(); return true; });
    }
  });

  /** Cuántos estudiantes de la lista activa hay en cada estado (sub del popover). */
  let conteoEstados = $derived.by(() => {
    const lista = periodo === "diario" ? estudiantes : estudiantesMulti.flatMap(e =>
      fechasPeriodo.map(f => ({ ...e, fecha: f, estado: e.dias[f]?.estado ?? null })));
    return {
      P: lista.filter(e => e.estado === 'P').length,
      A: lista.filter(e => e.estado === 'A').length,
      J: lista.filter(e => e.estado === 'J').length,
    };
  });

  // Si el DatePicker deja de estar montado (cambio de período), el bindable
  // quedaría en true y la fila perdería su overflow scroll.
  $effect(() => {
    if (!(isAndroidMobile && periodo === "diario")) dpAbierto = false;
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

  /**
   * Primer día hábil de la semana según la configuración del colegio, en el
   * formato de `Date.getDay()` (0 = domingo). Un colegio que trabaja de martes a
   * sábado tiene su semana empezando el martes, no el lunes.
   */
  const DIAS_SEMANA = [
    { clave: 'lunes', getDay: 1 }, { clave: 'martes', getDay: 2 },
    { clave: 'miercoles', getDay: 3 }, { clave: 'jueves', getDay: 4 },
    { clave: 'viernes', getDay: 5 }, { clave: 'sabado', getDay: 6 },
    { clave: 'domingo', getDay: 0 },
  ] as const;
  let primerDiaSemana = $derived.by(() => {
    if (!colegioConfig) return 1;
    const d = DIAS_SEMANA.find(x => (colegioConfig as any)[x.clave] !== false);
    return d ? d.getDay : 1;
  });

  /**
   * Marca el primer día de cada semana en la vista mensual, para dibujar el
   * separador vertical entre semanas. Se usa el primer día hábil del colegio
   * (no siempre lunes) y la primera columna nunca lleva línea: aunque el mes
   * empiece en ese día, una línea al borde izquierdo sobra.
   */
  function esInicioSemana(iso: string, indice: number): boolean {
    if (indice <= 0) return false;
    return new Date(iso + 'T12:00:00').getDay() === primerDiaSemana;
  }

  // ── Días sin clases (feriados / sin actividad) por sección o colegio ──
  let diasSinClases = $state<DiaSinClase[]>([]);
  let popSinClasesAbierta = $state(false);
  let popSinClasesEl: HTMLElement | null = $state(null);
  let popModalSinClasesEl: HTMLElement | null = $state(null);
  let sinClasesDescripcion = $state('');
  let sinClasesGuardando = $state(false);
  // Si viene de un click en el encabezado de una fecha concreta (semanal/mensual)
  let colFechaObjetivo = $state<string | null>(null);
  // Semana elegida en el selector de "Sin Clases" cuando el período es mensual.
  let semanaSeleccionada = $state<number | null>(null);
  // Semana señalada con el cursor en el selector: se resalta en la tabla.
  let semanaHover = $state<number | null>(null);

  /** Primer y último día de la semana señalada, para dibujar el contorno. */
  let semanaHoverRango = $derived.by(() => {
    if (semanaHover === null) return null;
    const s = semanasMes.find(w => w.numero === semanaHover);
    if (!s || s.fechas.length === 0) return null;
    return { ini: s.fechas[0], fin: s.fechas[s.fechas.length - 1] };
  });

  /** Portal a <body>: ver `src/lib/portalToBody.ts` (gotcha de backdrop-filter). */
  function cerrarPopSinClases() {
    popSinClasesAbierta = false;
    colFechaObjetivo = null;
    semanaSeleccionada = null;
    semanaHover = null;
  }

  /** Click en el encabezado de una fecha: marca o desmarca solo ese día. */
  function clickHeaderFecha(fecha: string) {
    if (esDiaSinClases(fecha)) { desactivarSinClases([fecha]); return; }
    colFechaObjetivo = fecha;
    sinClasesDescripcion = '';
    popSinClasesAbierta = true;
  }

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
      const data = await invoke<DiaSinClase[]>('get_dias_sin_clases', {
        colegioId: selectedColegio, gradoId: selectedGrado, seccionId: selectedSeccion,
        fechaInicio: fechas[0], fechaFin: fechas[fechas.length - 1],
      });
      // Evitar reasignar si el contenido no cambió (rompe dependencias sin motivo)
      if (JSON.stringify(data) !== JSON.stringify(diasSinClases)) diasSinClases = data;
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

  /**
   * Semanas del mes agrupadas por el primer día hábil del colegio, numeradas
   * correlativamente (1..n) dentro del período visible. Es la misma agrupación
   * que dibuja el separador vertical de la tabla, así que el número del header
   * y el selector de "Sin Clases" siempre coinciden.
   */
  let semanasMes = $derived.by(() => {
    const out: { numero: number; fechas: string[] }[] = [];
    let actual: string[] = [];
    fechasVisibles.forEach((fv, i) => {
      if (esInicioSemana(fv.fecha, i) && actual.length > 0) {
        out.push({ numero: out.length + 1, fechas: actual });
        actual = [];
      }
      actual.push(fv.fecha);
    });
    if (actual.length > 0) out.push({ numero: out.length + 1, fechas: actual });
    return out;
  });

  /**
   * Mismas semanas que `semanasMes` pero SIN filtrar por los días hábiles del
   * colegio. `semanasMes` sale de `fechasVisibles`, que ya viene filtrada, así
   * que la semana N solo contenía los días que el colegio seleccionado tenía
   * como clase: al marcar "en todos los colegios" el otro colegio se quedaba
   * sin los días de su propio horario dentro de esa misma semana.
   *
   * La numeración coincide con `semanasMes` porque `primerDiaSemana` es siempre
   * un día hábil del colegio: en ambas listas cada bloque arranca en un día
   * igual, así que el mismo número es la misma semana del calendario.
   */
  let semanasMesBase = $derived.by(() => {
    const out: { numero: number; fechas: string[] }[] = [];
    let actual: string[] = [];
    getFechasPeriodo().forEach((fecha, i) => {
      if (esInicioSemana(fecha, i) && actual.length > 0) {
        out.push({ numero: out.length + 1, fechas: actual });
        actual = [];
      }
      actual.push(fecha);
    });
    if (actual.length > 0) out.push({ numero: out.length + 1, fechas: actual });
    return out;
  });

  /** Número de semana al que pertenece una fecha, o null si no está en la tabla. */
  function numeroSemanaDe(iso: string): number | null {
    const s = semanasMes.find(w => w.fechas.includes(iso));
    return s ? s.numero : null;
  }

  /** Rango legible de una semana: "01/09 al 04/09". */
  function rangoSemana(s: { numero: number; fechas: string[] }): string {
    if (s.fechas.length === 0) return '';
    return `${fmtDM(s.fechas[0])} al ${fmtDM(s.fechas[s.fechas.length - 1])}`;
  }
  function semanaSinClasesTotal(s: { numero: number; fechas: string[] }): boolean {
    return s.fechas.length > 0 && s.fechas.every(f => esDiaSinClases(f));
  }
  function motivoSinClasesEn(fecha: string): string {
    return coberturaSinClases(fecha)?.descripcion || 'Sin clases';
  }

  /** Días seleccionables en el calendario: hábiles del colegio y no marcados sin clases. */
  function esDiaHabilCalendario(iso: string): boolean {
    if (!colegioConfig) return true;
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    if (colegioConfig[dayNames[new Date(iso + "T12:00:00").getDay()]] === false) return false;
    return !esDiaSinClases(iso);
  }

  function handleSinClasesClick() {
    if (sinClasesActivo) { desactivarSinClases(); return; }
    sinClasesDescripcion = '';
    semanaSeleccionada = null;
    colFechaObjetivo = null;
    popSinClasesAbierta = !popSinClasesAbierta;
  }

  /**
   * Fechas que se marcarán según el contexto: día concreto, semana elegida o período.
   *
   * `paraTodosLosColegios` usa las fechas SIN filtrar por los días hábiles: la
   * marca tiene que caer sobre la misma semana del calendario para todos los
   * colegios, aunque cada uno tenga un horario distinto. Filtrando, un colegio
   * martes-sábado se quedaba sin el lunes de esa semana y otro lunes-viernes sin
   * el sábado.
   */
  function objetivosSinClases(paraTodosLosColegios = false): { fechas: string[]; etiqueta: string } | null {
    if (colFechaObjetivo) return { fechas: [colFechaObjetivo], etiqueta: 'ese día' };
    if (periodo === 'mensual') {
      const lista = paraTodosLosColegios ? semanasMesBase : semanasMes;
      const sel = lista.find(w => w.numero === semanaSeleccionada);
      if (!sel) return null;
      return { fechas: sel.fechas, etiqueta: `la semana ${sel.numero}` };
    }
    if (paraTodosLosColegios) return { fechas: getFechasPeriodo(), etiqueta: 'el período actual' };
    return { fechas: fechasObjetivoSinClases(), etiqueta: 'el período actual' };
  }

  async function activarSinClases(nivelColegio: boolean) {
    const motivo = sinClasesDescripcion.trim();
    if (!motivo) { emit("show-toast", { message: "⚠️ El motivo es obligatorio", type: "warning" }); return; }
    const obj = objetivosSinClases();
    if (!obj) {
      emit("show-toast", { message: "⚠️ Seleccione la semana que quedará sin clases", type: 'warning' });
      return;
    }
    const objetivos = obj.fechas;
    if (objetivos.length === 0) return;
    const alcanceTxt = nivelColegio ? 'TODO el colegio' : 'solo esta sección';
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} al ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(`¿Marcar ${rangoTxt} como día(s) sin clases?\n\nAlcance: ${alcanceTxt}\nAfecta: ${obj.etiqueta}\nMotivo: ${motivo}`, { title: 'Marcar sin clases', kind: 'warning', okLabel: 'Sí, marcar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await invoke('set_dias_sin_clases', {
        colegioId: selectedColegio, gradoId: nivelColegio ? null : selectedGrado,
        seccionId: nivelColegio ? null : selectedSeccion,
        fechas: objetivos, descripcion: motivo, activo: true,
      });
      onDataChange('dia_sin_clases');
      cerrarPopSinClases();
      sinClasesDescripcion = '';
      await fetchDiasSinClases();
      if (periodo !== 'diario') { refreshingSilent = true; fetchEstudiantesMulti(); }
      emit("show-toast", { message: `🚫 ${nivelColegio ? 'Colegio' : 'Sección'}: ${objetivos.length} día(s) sin clases (${motivo})`, type: "success" });
    } catch (e) {
      console.error('Error marcando días sin clases:', e);
      await emit("show-toast", { message: "❌ Error al marcar días sin clases: " + e, type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  /**
   * Aplica la misma fecha/semana/período a TODOS los colegios del catálogo.
   * `dia_sin_clases` no tiene un nivel "global": se guarda por colegio, así que
   * se itera llamando al comando una vez por colegio, siempre a nivel colegio
   * (grado y sección en null) para que la marca aplique a todas sus secciones.
   */
  async function aplicarEnTodosLosColegios(fechas: string[], motivo: string, activo: boolean) {
    if (colegios.length === 0) {
      await emit("show-toast", { message: "⚠️ No hay colegios registrados", type: 'warning' });
      return;
    }
    for (const col of colegios) {
      await invoke('set_dias_sin_clases', {
        colegioId: col.id, gradoId: null, seccionId: null,
        fechas, descripcion: motivo, activo,
      });
    }
    onDataChange('dia_sin_clases');
    await fetchDiasSinClases();
    if (periodo !== 'diario') { refreshingSilent = true; fetchEstudiantesMulti(); }
  }

  async function activarSinClasesTodosColegios() {
    const motivo = sinClasesDescripcion.trim();
    if (!motivo) { emit("show-toast", { message: "⚠️ El motivo es obligatorio", type: "warning" }); return; }
    const obj = objetivosSinClases(true);
    if (!obj) {
      emit("show-toast", { message: "⚠️ Seleccione la semana que quedará sin clases", type: 'warning' });
      return;
    }
    const objetivos = obj.fechas;
    if (objetivos.length === 0) return;
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} al ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(`¿Marcar ${rangoTxt} sin clases en los ${colegios.length} colegio(s)?\n\nAlcance: TODOS los colegios\nAfecta: ${obj.etiqueta}\nMotivo: ${motivo}`, { title: 'Marcar en todos los colegios', kind: 'warning', okLabel: 'Sí, marcar todos', cancelLabel: 'Cancelar' });
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await aplicarEnTodosLosColegios(objetivos, motivo, true);
      cerrarPopSinClases();
      sinClasesDescripcion = '';
      emit("show-toast", { message: `🌐 ${objetivos.length} día(s) sin clases en ${colegios.length} colegio(s) (${motivo})`, type: "success" });
    } catch (e) {
      console.error('Error marcando días sin clases en todos los colegios:', e);
      await emit("show-toast", { message: "❌ Error al marcar en todos los colegios: " + e, type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  async function desactivarSinClasesTodosColegios() {
    const obj = objetivosSinClases(true);
    if (!obj) return;
    // Sin filtro por `esDiaSinClases`: ese helper consulta la cobertura del
    // colegio/sección QUE ESTÁ SELECCIONADO, y para el alcance global puede no
    // ver las marcas de los demás. Quitar la marca es idempotente, así que se
    // envían todas las fechas de la semana.
    const objetivos = obj.fechas;
    if (objetivos.length === 0) return;
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} al ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(`¿Reactivar las clases del ${rangoTxt} en los ${colegios.length} colegio(s)?\n\nSe quitará la marca en todos los colegios.`, { title: 'Reactivar en todos los colegios', kind: 'info', okLabel: 'Sí, reactivar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await aplicarEnTodosLosColegios(objetivos, '', false);
      cerrarPopSinClases();
      emit("show-toast", { message: "✅ Clases reactivadas en todos los colegios", type: "success" });
    } catch (e) {
      console.error('Error reactivando días sin clases en todos los colegios:', e);
      await emit("show-toast", { message: "❌ Error al reactivar en todos los colegios: " + e, type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  async function desactivarSinClases(fechasArg?: string[]) {
    const objetivos = (fechasArg ?? fechasObjetivoSinClases()).filter(f => esDiaSinClases(f));
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
      if (periodo !== 'diario') { refreshingSilent = true; fetchEstudiantesMulti(); }
      emit("show-toast", { message: "✅ Clases reactivadas para el período", type: "success" });
    } catch (e) {
      console.error('Error reactivando clases:', e);
      await emit("show-toast", { message: "❌ Error al reactivar clases: " + e, type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  // Cierre por clic fuera + Back de Android para el popover de sin clases.
  // El modal puede abrirse desde el botón (semanal/diario) o desde el click en
  // el encabezado de una columna (mensual), así que se aceptan clics en ambos.
  $effect(() => {
    if (!popSinClasesAbierta) return;
    const fuera = (e: Event) => {
      const t = e.target as Node;
      if (popSinClasesEl && popSinClasesEl.contains(t)) return;
      if (popModalSinClasesEl && popModalSinClasesEl.contains(t)) return;
      cerrarPopSinClases();
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  });
  $effect(() => {
    if (!popSinClasesAbierta) return;
    return registerBackHandler(() => { cerrarPopSinClases(); return true; });
  });

  onMount(() => {
    const savedDraft = sessionStorage.getItem("asistencia_draft");
    if (savedDraft) {
      try { draft = JSON.parse(savedDraft); }
      catch (e) { console.error("Error cargando borrador:", e); }
    }
    const savedDraftMulti = sessionStorage.getItem("asistencia_draft_multi");
    if (savedDraftMulti) {
      try { draftMulti = JSON.parse(savedDraftMulti); }
      catch (e) { console.error("Error cargando borrador multi:", e); }
    }
    const checkMobile = () => { isMobile = window.innerWidth <= 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    // Cargar configuraciones syncronizables
    loadAppSettings().then(s => { showAnoDropdown = s.showAnoDropdown; });
    const unsubSettings = onAppSettingsChange(s => { showAnoDropdown = s.showAnoDropdown; });

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
      unsubSettings();
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
      // untrack: los fetch leen diasSinClases/colegioConfig al preparar parámetros;
      // sin esto, reasignar esos estados re-disparaba este efecto en bucle.
      untrack(() => {
        if (periodo === "diario") {
          if (selectedFecha && isFechaHabilitada) fetchEstudiantes();
        } else {
          fetchEstudiantesMulti();
        }
      });
    }
  });

  // Carga de días sin clases: efecto dedicado con dependencias acotadas
  $effect(() => {
    const c = selectedColegio, g = selectedGrado, s = selectedSeccion;
    void c; void g; void s; void periodo; void selectedFecha; void mesSeleccionado; void anoSeleccionado;
    if (!c || !g || !s) { diasSinClases = []; return; }
    untrack(() => fetchDiasSinClases());
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
      // Snapshot del estado SERVIDOR antes de mezclar borradores
      const snap: Record<number, { estado: string | null; observacion: string }> = {};
      for (const est of data) snap[est.id] = { estado: norm(est.estado), observacion: est.observacion || '' };
      originalDiario = snap;
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
      // Snapshot del estado SERVIDOR (clave id|fecha) antes de mezclar borradores
      const snapM: Record<string, { estado: string | null; observacion: string }> = {};
      for (const est of data) {
        for (const f of fechas) {
          const d = est.dias.find(x => x.fecha === f);
          snapM[`${est.id}|${f}`] = { estado: norm(d?.estado), observacion: d?.observacion || '' };
        }
      }
      originalMulti = snapM;
    } catch (error) {
      console.error("Error fetching multi students:", error);
      await emit("show-toast", { message: "❌ Error al cargar estudiantes: " + error, type: "error" });
    } finally { loading = false; }
  }

  async function saveChanges(updated: EstudianteAsistencia[]) {
    saving = true;
    try {
      const records = updated.filter(est => est.estado && ['P', 'A', 'J'].includes(est.estado)).map(est => ({ estudianteId: est.id, fecha: selectedFecha, estado: est.estado, observacion: est.observacion || '' }));
      // Estudiantes limpiados ('-'/null): borrar sus registros de la BD si existen
      // (delete_asistencia_batch ya verifica existencia antes de borrar)
      const idsLimpiados = updated
        .filter(est => (!est.estado || est.estado === '-'))
        .map(est => est.id);
      if (records.length === 0) {
        const intentClear = updated.every(est => !est.estado || est.estado === '-');
        if (intentClear) {
          try {
            await invoke("delete_asistencia_batch", { estudianteIds: updated.map(est => est.id), fecha: selectedFecha });
            draft = {}; syncDraftToStorage(); saving = false;
            capturarOriginalDiario();
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
      // Limpiezas parciales: borrar las celdas vaciadas antes de guardar el resto
      if (idsLimpiados.length > 0) {
        await invoke('delete_asistencia_batch', { estudianteIds: idsLimpiados, fecha: selectedFecha });
      }
      await invoke("save_asistencia", { records });
      draft = {}; syncDraftToStorage(); saving = false;
      capturarOriginalDiario();
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
      // Celdas vaciadas que tenían registro guardado: hay que borrarlas de la BD
      const limpias: Record<string, number[]> = {};
      for (const est of estudiantesMulti) {
        for (const fecha of fechasPeriodo) {
          const d = est.dias[fecha];
          const draftD = draftMulti[est.id]?.[fecha];
          const estado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null);
          const obs = draftD?.observacion !== undefined ? draftD.observacion : (d?.observacion || '');
          if (estado && ['P', 'A', 'J'].includes(estado)) {
            records.push({ estudianteId: est.id, fecha, estado, observacion: obs || '' });
          } else if ((!estado || estado === '-') && d?.estado) {
            (limpias[fecha] ||= []).push(est.id);
          }
        }
      }
      // Borrar primero las celdas limpiadas (si no, quedaban huérfanas en la BD)
      for (const [fecha, ids] of Object.entries(limpias)) {
        await invoke('delete_asistencia_batch', { estudianteIds: ids, fecha });
      }
      if (records.length === 0) {
        if (Object.keys(limpias).length > 0) {
          // Todo el período quedó limpiado: mismo flujo de éxito que el modo diario
          draftMulti = {}; syncDraftMultiToStorage(); saving = false;
          capturarOriginalMulti();
          if (pendingRefreshOnSave) { pendingRefreshOnSave = false; refreshingSilent = true; if (selectedColegio && selectedAno) fetchGrados(); }
          await emit("show-toast", { message: "✅ Asistencia limpiada correctamente", type: "success" });
          onDataChange('asistencia', { immediate: true });
          skipNextRefresh = true;
          await emit("asistencia-updated");
        } else {
          saving = false;
          await emit("show-toast", { message: "⚠️ No hay asistencias marcadas para guardar.", type: "warning" });
        }
        return;
      }
      await invoke("save_asistencia", { records });
      draftMulti = {}; syncDraftMultiToStorage(); saving = false;
      capturarOriginalMulti();
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
  }

  function handleObservacionChange(estudianteId: number, observacion: string) {
    draft[estudianteId] = { ...draft[estudianteId], observacion };
    syncDraftToStorage();
    estudiantes = estudiantes.map(est => est.id === estudianteId ? { ...est, observacion } : est);
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
  }

  async function marcarTodos(estado: string) {
    const n = periodo === "diario" ? getActiveStudentCount() : estudiantesMulti.length * fechasPeriodo.length;
    if (n === 0) return;
    const etiqueta = estado === 'P' ? 'Presente' : estado === 'A' ? 'Ausente' : 'Justificado';
    const ok = await ask(`¿Marcar a TODOS como "${etiqueta}" (${estado}) para el período actual?\n\nSe aplicará a ${periodo === "diario" ? `${getActiveStudentCount()} estudiante(s)` : `${estudiantesMulti.length} estudiante(s) × ${fechasPeriodo.length} día(s)`}.`, {
      title: `Marcar todos: ${etiqueta}`, kind: 'info', okLabel: `Sí, marcar todo`, cancelLabel: 'Cancelar',
    });
    if (!ok) return;
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
    emit("show-toast", { message: "🧹 Asistencia limpiada. Recuerda guardar los cambios.", type: "info" });
  }

  async function handleManualSave() {
    if (!hasUnsavedChanges) return;
    const ok = await ask('¿Guardar los cambios de asistencia pendientes?', {
      title: 'Confirmar guardado', kind: 'info', okLabel: 'Guardar', cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    if (periodo === "diario") {
      saveChanges(estudiantes);
    } else {
      saveChangesMulti();
    }
  }

  async function limpiarAsistencia() {
    if (getActiveStudentCount() === 0) return;
    const ok = await ask('¿Limpiar todos los estados de asistencia del período actual?\n\nLos cambios sin guardar se descartarán.', { title: 'Confirmar Limpieza', kind: 'warning', okLabel: 'Sí, limpiar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    confirmClearAllStatus();
  }

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
        setter(value);
      } else {
        draft = {}; syncDraftToStorage(); draftMulti = {}; syncDraftMultiToStorage();
        // Restaurar los estados del servidor (el diff es real ahora)
        estudiantes = estudiantes.map(est => {
          const o = originalDiario[est.id];
          return o ? { ...est, estado: o.estado as any, observacion: o.observacion } : est;
        });
        estudiantesMulti = estudiantesMulti.map(est => {
          const newDias: typeof est.dias = {};
          for (const f of fechasPeriodo) {
            const o = originalMulti[`${est.id}|${f}`];
            newDias[f] = { estado: o ? o.estado : (est.dias[f]?.estado ?? null), observacion: o ? o.observacion : (est.dias[f]?.observacion || '') };
          }
          return { ...est, dias: newDias };
        });
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
{#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder="Buscar..." />{/if}


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
    /* Separador de semanas en la vista mensual: línea vertical antes del lunes */
    .sep-semana{border-left:2px solid rgba(148,163,184,0.5)!important}
    /* Número de semana en la cabecera, legible de un vistazo */
    .semana-badge{display:inline-block;font-size:0.6rem;font-weight:800;letter-spacing:.4px;color:#c7d2fe;background:rgba(99,102,241,0.32);border:1px solid rgba(129,140,248,0.45);border-radius:5px;padding:1px 5px;margin-bottom:2px;line-height:1.25}
    /* Semana señalada desde el modal de Sin Clases */
    .custom-table thead th.semana-hl{background:rgba(99,102,241,0.5)!important}
    .semana-hl-ini{border-left:2px solid #818cf8!important}
    .semana-hl-fin{border-right:2px solid #818cf8!important}
    .custom-table thead th{position:sticky;top:0;z-index:10;background:#1e293b!important}
    /* Los tres estados aparecen flotando al pasar el cursor sobre la celda
       (que incluye el input de observación), sin apretar el diseño de la tabla */
    .celda-estado{position:relative;display:flex;flex-direction:column;gap:0.15rem}
    /* Un solo disparador por celda: la lista P/A/J vive en el popover fixed de
       la página. Va en la esquina superior derecha, al lado de la caja de
       estado; antes estaba en `bottom:calc(100% + 4px)` (fuera de la celda) y se
       pintaba por encima de la barra de filtros, saliéndose del wrapper. */
    .rapido-overlay{position:absolute;top:1px;right:2px;display:none;z-index:40}
    .celda-estado:hover .rapido-overlay,.celda-estado:focus-within .rapido-overlay{display:flex}
    .rapido-btn{min-width:26px;height:22px;padding:0 7px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,23,42,0.9);color:#94a3b8;font-size:0.68rem;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.12s ease;font-family:inherit}
    .rapido-btn:hover{background:rgba(255,255,255,0.12);color:#fff}
    .rapido-btn:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
    .rapido-btn.on{color:#fff}
    .rapido-btn.p.on{background:rgba(16,185,129,0.3);border-color:#10b981;color:#6ee7b7}
    .rapido-btn.a.on{background:rgba(239,68,68,0.3);border-color:#ef4444;color:#fca5a5}
    .rapido-btn.j.on{background:rgba(245,158,11,0.3);border-color:#f59e0b;color:#fcd34d}
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
    .fch-th{cursor:pointer;transition:filter .15s ease,background .15s ease}
    .fch-th:hover{filter:brightness(1.35)}
    .dsc-col{background:linear-gradient(180deg,rgba(245,158,11,.10),rgba(245,158,11,.02));text-align:center;vertical-align:middle;color:#f59e0b;font-weight:700;padding:.5rem .35rem;min-width:70px}
  </style>

  {#snippet overlayEstados(estId: number, fecha: string, actual: string | null)}
    <div class="rapido-overlay">
      <button
        class="rapido-btn"
        class:p={actual === 'P'}
        class:a={actual === 'A'}
        class:j={actual === 'J'}
        class:on={actual !== null}
        title="Elegir estado de asistencia"
        aria-label="Elegir estado de asistencia"
        aria-haspopup="menu"
        aria-expanded={popEstado?.estId === estId && popEstado?.fecha === fecha}
        onclick={(e) => {
          if (popEstado?.estId === estId && popEstado?.fecha === fecha) { cerrarPopEstado(); return; }
          abrirPopEstado(estId, fecha, actual, e.currentTarget);
        }}
      >{actual ?? '⋯'}</button>
    </div>
  {/snippet}

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile} style="padding:{isAndroidMobile ? '0.5rem' : '0.4rem'}">
        <div style="display:flex;{isAndroidMobile ? 'flex-wrap:wrap' : 'flex-wrap:nowrap'};gap:0.4rem;width:100%;align-items:flex-end">
          {#if !isAndroidMobile && showAnoDropdown}
            <FilterGroup label="Año Lectivo:" {isMobile}>
              <SelectChip
                value={selectedAno}
                onchange={(v) => handleFilterChange((n: number) => selectedAno = n, Number(v))}
                options={anos.map(a => ({ value: a.id, label: a.nombre }))} />
            </FilterGroup>
          {/if}
          {#if !isAndroidMobile}
            <FilterGroup label="Período:" {isMobile}>
              <SelectChip
                value={periodo}
                onchange={(v) => { periodo = String(v) as typeof periodo; }}
                options={[
                  ...(!isWindows ? [{ value: 'diario', label: 'Diario' }] : []),
                  { value: 'semanal', label: 'Semanal' },
                  { value: 'mensual', label: 'Mensual' },
                ]} />
            </FilterGroup>
          {/if}
          {#if periodo === "diario"}
            {#if !isAndroidMobile}
              <FilterGroup label="Fecha:" {isMobile}>
                <DatePickerGlass bind:value={selectedFecha} diaHabilitado={esDiaHabilCalendario} />
              </FilterGroup>
            {/if}
          {:else if periodo === "semanal"}
            {#if !isAndroidMobile}
              <FilterGroup label="Semana de:" {isMobile}>
                <div class="pop-wrap" bind:this={popRootEl} style="min-width:0">
                  <button type="button" class="filter-select pop-trigger" onclick={() => popSemanaAbierta = !popSemanaAbierta} style="min-width:0">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Semana {semanaActiva} · {semanasOpts.find(s => s.n === semanaActiva)?.rango ?? ''}</span>
                    <span class="pop-caret">▾</span>
                  </button>

                  {#if popSemanaAbierta}
                    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) cerrarPopSemana(); }} style="z-index:2000">
                      <div class="pop-panel" tabindex="-1" style="position:relative;top:auto;left:auto;right:auto;bottom:auto;width:{modalCardWidth};max-width:{modalCardWidth};max-height:85vh;overflow-y:auto;">
                        <button type="button" onclick={cerrarPopSemana} title="Cerrar" style="position:absolute;top:.6rem;right:.6rem;width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#cbd5e1;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
                        <div class="pop-mes" style="padding-right:2.2rem">
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
                    </div>
                  {/if}
                </div>
              </FilterGroup>
            {/if}
          {:else}
            {#if !isAndroidMobile}
              <FilterGroup label="Mes:" {isMobile}>
                <SelectChip
                  value={mesSeleccionado}
                  onchange={(v) => { mesSeleccionado = Number(v); }}
                  options={mesesOptions.map(m => ({ value: m.value, label: m.label }))} />
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
            <FilterGroup label="Colegio:" {isMobile}>
              <SelectChip
                value={selectedColegio}
                onchange={(v) => handleFilterChange((n: number) => selectedColegio = n, Number(v))}
                options={colegios.map(c => ({ value: c.id, label: c.nombre }))} />
            </FilterGroup>
            <FilterGroup label="Grado:" {isMobile}>
              <SelectChip
                value={selectedGrado}
                onchange={(v) => handleFilterChange((n: number) => selectedGrado = n, Number(v))}
                options={grados.map(g => ({ value: g.id, label: g.nombre }))} />
            </FilterGroup>
            <FilterGroup label="Sección:" {isMobile}>
              <SelectChip
                value={selectedSeccion}
                onchange={(v) => handleFilterChange((n: number) => selectedSeccion = n, Number(v))}
                options={secciones.map(s => ({ value: s.id, label: s.nombre }))} />
            </FilterGroup>
            <FilterGroup label="Sexo:" {isMobile}>
              <SelectChip
                value={selectedSexo}
                onchange={(v) => handleFilterChange((s: string) => selectedSexo = s, String(v))}
                options={[
                  { value: '', label: 'Todos' },
                  { value: 'M', label: 'Masculino' },
                  { value: 'F', label: 'Femenino' },
                ]} />
            </FilterGroup>
          {/if}
          <div class="android-actions" style="display:flex;gap:{isAndroidMobile ? '2px' : '0.3rem'};align-items:stretch;flex-shrink:0;{isAndroidMobile ? 'flex-wrap:nowrap;min-width:0;width:100%;max-width:100%;-webkit-overflow-scrolling:touch;' : 'overflow:visible'}overflow-x:{isAndroidMobile && dpAbierto ? 'visible' : isAndroidMobile ? 'auto' : 'visible'}">
          {#if isAndroidMobile && periodo === "diario"}
            <div style="flex:1 1 40%;min-width:130px;max-width:180px;align-self:stretch;">
              <DatePickerGlass bind:value={selectedFecha} bind:abierto={dpAbierto} diaHabilitado={esDiaHabilCalendario} />
            </div>
          {/if}
          <div class="pop-wrap" bind:this={popSinClasesEl} style="flex:0 0 auto;">
            <BotonMod opts={{
              onclick: handleSinClasesClick,
              disabled: sinClasesGuardando || !selectedSeccion,
              icono: sinClasesActivo ? '🏫' : '🚫',
              etiqueta: 'Sin Clases',
              tono: sinClasesActivo ? 'ambar' : 'pizarra',
              sub: sinClasesActivo ? 'Todo el período' : (periodo === 'mensual' ? 'Elegir semana' : periodo === 'semanal' ? `Semana ${semanaActiva}` : fmtDM(selectedFecha)),
              title: periodo === 'mensual' ? 'Dejar una semana del mes sin clases' : 'Marcar el período actual sin clases',
              compacto: isAndroidMobile,
            }} />
          </div>
          {#if popSinClasesAbierta}
            <div use:portalToBody class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) cerrarPopSinClases(); }}
              style="z-index:2000;{isAndroidMobile ? '' : 'background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;align-items:center;justify-content:center;padding-top:14vh;'}">
              <div bind:this={popModalSinClasesEl} class="pop-panel" tabindex="-1"
                style="position:relative;top:auto;left:auto;right:auto;bottom:auto;width:{modalCardWidth};max-width:{modalCardWidth};max-height:85vh;overflow-y:auto;{isAndroidMobile ? '' : 'box-shadow:0 25px 60px -12px rgba(0,0,0,0.7);'}">
                <button type="button" onclick={cerrarPopSinClases} title="Cerrar" style="position:absolute;top:.6rem;right:.6rem;width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#cbd5e1;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
                <div class="pop-mes"><span class="pop-mes-txt">{colFechaObjetivo ? `Marcar ${fmtDM(colFechaObjetivo)} sin clases` : periodo === 'mensual' ? 'Semana sin clases' : 'Motivo del día(s) sin clases'}</span></div>
                {#if colFechaObjetivo}
                  <div style="font-size:.65rem;color:#94a3b8;margin:-.3rem 0 .5rem">Solo afecta esa fecha específica</div>
                {:else if periodo === 'mensual'}
                  <div style="font-size:.65rem;color:#94a3b8;margin:-.3rem 0 .4rem">Pasa el cursor sobre una semana para verla resaltada en la tabla</div>
                  <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:.55rem">
                    {#each semanasMes as s (s.numero)}
                      {@const todas = semanaSinClasesTotal(s)}
                      <button type="button" class="pop-sem" class:sel={semanaSeleccionada === s.numero}
                        style="justify-content:space-between;border-radius:10px;padding:.5rem .6rem"
                        onclick={() => semanaSeleccionada = s.numero}
                        onmouseenter={() => semanaHover = s.numero}
                        onmouseleave={() => semanaHover = null}
                        onfocus={() => semanaHover = s.numero}
                        onblur={() => semanaHover = null}>
                        <span class="pop-sem-n">Semana {s.numero}</span>
                        <span class="pop-sem-rango">{rangoSemana(s)}{todas ? ' · 🚫' : ''}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
                <input class="obs-inline" placeholder="Ej: Feriado nacional (obligatorio)"
                  bind:value={sinClasesDescripcion}
                  onkeydown={(e) => { if (e.key === 'Enter' && sinClasesDescripcion.trim()) activarSinClases(false); }} />
                <div style="display:flex;flex-direction:column;gap:3px;margin-top:.55rem">
                  {#if periodo === 'mensual' && semanaSeleccionada && semanaSinClasesTotal(semanasMes.find(w => w.numero === semanaSeleccionada)!)}
                    <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #10b981" disabled={sinClasesGuardando}
                      onclick={() => { const s = semanasMes.find(w => w.numero === semanaSeleccionada); if (s) { cerrarPopSinClases(); desactivarSinClases(s.fechas); } }}>
                      ♻️ Reactivar las clases de la semana {semanaSeleccionada}
                    </button>
                    <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #10b981" disabled={sinClasesGuardando}
                      onclick={desactivarSinClasesTodosColegios}>
                      ♻️ Reactivar en todos los colegios
                    </button>
                  {:else if periodo !== 'mensual' && sinClasesActivo}
                    <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #10b981" disabled={sinClasesGuardando}
                      onclick={desactivarSinClasesTodosColegios}>
                      ♻️ Reactivar en todos los colegios
                    </button>
                  {/if}
                  <button type="button" class="pop-sem sel" style="justify-content:center;border-radius:10px" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando || (periodo === 'mensual' && !semanaSeleccionada)}
                    onclick={() => activarSinClases(false)}>
                    🚪 Marcar solo esta sección
                  </button>
                  <button type="button" class="pop-sem sel" style="justify-content:center;border-radius:10px" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando || (periodo === 'mensual' && !semanaSeleccionada)}
                    onclick={() => activarSinClases(true)}>
                    🏫 Marcar todo este colegio
                  </button>
                  <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #818cf8" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando || (periodo === 'mensual' && !semanaSeleccionada)}
                    onclick={activarSinClasesTodosColegios}>
                    🌐 Marcar en TODOS los colegios
                  </button>
                </div>
              </div>
            </div>
          {/if}
          <BotonMod opts={{
            onclick: limpiarAsistencia,
            disabled: getActiveStudentCount() === 0,
            icono: '🧹', etiqueta: 'Limpiar', tono: 'pizarra',
            sub: getActiveStudentCount() === 0 ? 'Nada que borrar' : `${getActiveStudentCount()} con estado`,
            title: 'Limpiar la asistencia del período',
            compacto: isAndroidMobile,
          }} />
          <BotonMod bind:ref={popMasivosBtnEl} opts={{
            onclick: () => { if (popMasivosBtnEl) togglePopMasivos(popMasivosBtnEl); },
            disabled: getActiveStudentCount() === 0,
            icono: popMasivos ? '✕' : '👥', etiqueta: 'Marcar todos', tono: 'violeta',
            sub: getActiveStudentCount() === 0
              ? 'Sin estudiantes'
              : `${conteoEstados.P}P · ${conteoEstados.A}A · ${conteoEstados.J}J`,
            title: 'Marcar todo el período como Presente, Ausente o Justificado',
            compacto: isAndroidMobile,
          }} />
          <BotonMod opts={{
            onclick: handleManualSave,
            disabled: !hasUnsavedChanges || saving,
            icono: saving ? '⏳' : '💾',
            etiqueta: saving ? 'Guardando' : 'Guardar',
            tono: 'verde',
            sub: saving ? 'Escribiendo en la BD' : (hasUnsavedChanges ? 'Cambios sin guardar' : 'Sin cambios'),
            title: 'Guardar asistencia',
            compacto: isAndroidMobile,
          }} />
          {#if !isAndroidMobile}
          <div style="flex:1;min-width:100px">
          </div>
          {/if}
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
                  <!-- Sin <input type=radio>: el label reenvía un clic sintético al
                       input oculto que burbujeaba y disparaba el toggle dos veces -->
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'P' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'P' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'P' ? '#10b981' : '#94a3b8'}" onclick={() => handleEstadoChange(est.id, 'P')}>
                    <span>Presente</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'A' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'A' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'A' ? '#ef4444' : '#94a3b8'}" onclick={() => handleEstadoChange(est.id, 'A')}>
                    <span>Ausente</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'J' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'J' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'J' ? '#f59e0b' : '#94a3b8'}" onclick={() => handleEstadoChange(est.id, 'J')}>
                    <span>Justificado</span>
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
                      <label class="asistencia-btn" class:p={est.estado === 'P'} onclick={() => handleEstadoChange(est.id, 'P')}>Presente</label>
                      <label class="asistencia-btn" class:a={est.estado === 'A'} onclick={() => handleEstadoChange(est.id, 'A')}>Ausente</label>
                      <label class="asistencia-btn" class:j={est.estado === 'J'} onclick={() => handleEstadoChange(est.id, 'J')}>Justificado</label>
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
                <th class:dsc-th={fv.sinClases} class:fch-th={true}
                  style="min-width:105px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;font-size:0.7rem;font-weight:600;padding:0.3rem 0.15rem"
                  title={fv.sinClases ? `${motivoSinClasesEn(fv.fecha)} — Click para reactivar clases` : 'Click para marcar este día sin clases'}
                  onclick={() => clickHeaderFecha(fv.fecha)}>
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
                        {#if isWindows}
                          <div class="celda-estado">
                            <div class="semanal-status" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                              onclick={() => cicloEstado(est.id, fv.fecha)}
                              title="Clic para rotar · pasa el cursor sobre la observación para elegir el estado">
                              {effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : '—'}
                            </div>
                            <input type="text" placeholder="Obs..." class="semanal-obs"
                              value={getObsMulti(est.id, fv.fecha)}
                              oninput={(e) => handleObservacionChangeMulti(est.id, fv.fecha, (e.target as HTMLInputElement).value)} />
                            {@render overlayEstados(est.id, fv.fecha, effectiveEstado)}
                          </div>
                        {:else}
                          <div class="semanal-status" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                            onclick={() => cicloEstado(est.id, fv.fecha)}
                            title={effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : 'Sin marcar'}>
                            {effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : '—'}
                          </div>
                          <input type="text" placeholder="Obs..." class="semanal-obs"
                            value={getObsMulti(est.id, fv.fecha)}
                            oninput={(e) => handleObservacionChangeMulti(est.id, fv.fecha, (e.target as HTMLInputElement).value)} />
                        {/if}
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
              {#each fechasVisibles as fv, iFecha (fv.fecha)}
                <th class:dsc-th={fv.sinClases} class:fch-th={true} class:sep-semana={esInicioSemana(fv.fecha, iFecha)}
                  class:semana-hl={semanaHover !== null && numeroSemanaDe(fv.fecha) === semanaHover}
                  class:semana-hl-ini={semanaHoverRango?.ini === fv.fecha}
                  class:semana-hl-fin={semanaHoverRango?.fin === fv.fecha}
                  style="font-size:0.7rem;white-space:nowrap;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;min-width:48px;padding:0.35rem 0.45rem"
                  title="{fv.sinClases ? motivoSinClasesEn(fv.fecha) + ' — Click para reactivar clases' : 'Click para marcar este día sin clases'}{numeroSemanaDe(fv.fecha) ? ` · Semana ${numeroSemanaDe(fv.fecha)}` : ''}"
                  onclick={() => clickHeaderFecha(fv.fecha)}>
                  {#if esInicioSemana(fv.fecha, iFecha) && numeroSemanaDe(fv.fecha)}
                    <div class="semana-badge">S{numeroSemanaDe(fv.fecha)}</div>
                  {/if}
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
                  {#each fechasVisibles as fv, iFecha (fv.fecha)}
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
                        <td class:sep-semana={esInicioSemana(fv.fecha, iFecha)}
                          class:semana-hl-ini={semanaHoverRango?.ini === fv.fecha}
                          class:semana-hl-fin={semanaHoverRango?.fin === fv.fecha}
                          style="text-align:center;padding:0.15rem">
                          {#if isWindows}
                            <div class="celda-estado">

                            <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                              onclick={() => cicloEstado(est.id, fv.fecha)}
                              title="Clic para rotar · pasa el cursor aquí para elegir el estado">
                              {effectiveEstado ?? '-'}
                            </div>
                            {@render overlayEstados(est.id, fv.fecha, effectiveEstado)}
                          </div>
                        {:else}
                          <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                            onclick={() => cicloEstado(est.id, fv.fecha)}
                            title={new Date(fv.fecha + "T12:00:00").toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ': ' + (effectiveEstado === 'P' ? 'Presente' : effectiveEstado === 'A' ? 'Ausente' : effectiveEstado === 'J' ? 'Justificado' : 'Sin marcar')}>
                            {effectiveEstado ?? '-'}
                          </div>
                        {/if}
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

  {#if popEstado}
    <div
      bind:this={popEstadoPanelEl}
      use:portalToBody
      role="menu"
      aria-label="Estado de asistencia"
      style="position:fixed; z-index:99995; left:{popEstado.x}px; top:{popEstado.y}px; bottom:{popEstado.abajo}; width:{ANCHO_POP_ESTADO}px; background:rgba(20,24,31,0.97); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.1); border-radius:14px; box-shadow:0 18px 40px -10px rgba(0,0,0,0.65); padding:0.35rem; box-sizing:border-box; display:flex; flex-direction:column; gap:3px;"
    >
      {#each ESTADOS_PAJ as e (e.id)}
        {@const activo = popEstado.actual === e.id}
        <button
          role="menuitemradio"
          aria-checked={activo}
          title={activo ? `${e.label} · tocar de nuevo lo quita` : `Marcar ${e.label}`}
          onclick={() => elegirEstadoPop(e.id)}
          style="width:100%; display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.55rem; border-radius:9px; border:1px solid {activo ? e.borde : 'transparent'}; background:{activo ? e.suave : 'transparent'}; color:{activo ? e.color : '#cbd5e1'}; cursor:pointer; text-align:left; transition:all 0.15s ease;"
          onmouseenter={(ev) => { if (!activo) ev.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onmouseleave={(ev) => { if (!activo) ev.currentTarget.style.background = 'transparent'; }}
        >
          <span style="width:22px; height:22px; flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:6px; font-size:0.7rem; font-weight:800; background:{activo ? e.suave : 'rgba(255,255,255,0.05)'}; border:1px solid {activo ? e.borde : 'rgba(255,255,255,0.1)'}; color:{e.color};">{e.id}</span>
          <span style="flex:1; min-width:0; font-size:0.78rem; font-weight:{activo ? 700 : 500};">{e.label}</span>
          {#if activo}<span style="color:{e.color}; font-size:0.7rem; flex-shrink:0;">✓</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if popMasivos}
    <div
      bind:this={popMasivosPanelEl}
      use:portalToBody
      role="menu"
      aria-label="Marcar todo el período"
      style="position:fixed; z-index:99995; left:{popMasivos.x}px; top:{popMasivos.y}px; bottom:{popMasivos.abajo}; width:{ANCHO_POP_MASIVOS}px; background:rgba(20,24,31,0.97); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.1); border-radius:14px; box-shadow:0 18px 40px -10px rgba(0,0,0,0.65); padding:0.4rem; box-sizing:border-box; display:flex; flex-direction:column; gap:3px;"
    >
      {#each ESTADOS_PAJ as e (e.id)}
        {@const sub = e.id === 'P' ? 'Marcar presentes' : e.id === 'A' ? 'Marcar ausentes' : 'Marcar justificados'}
        <button
          role="menuitem"
          disabled={getActiveStudentCount() === 0}
          onclick={() => accionMasivos(() => { marcarTodos(e.id); })}
          title={`Marcar todo el período como ${e.label}`}
          style="width:100%; display:flex; align-items:center; gap:0.55rem; padding:0.5rem 0.55rem; border-radius:9px; border:1px solid {e.borde}; background:{e.suave}; color:{e.color}; cursor:pointer; text-align:left; transition:all 0.15s ease; opacity:{getActiveStudentCount() === 0 ? 0.45 : 1};"
          onmouseenter={(ev) => { ev.currentTarget.style.background = e.suave.replace('0.10', '0.2'); }}
          onmouseleave={(ev) => { ev.currentTarget.style.background = e.suave; }}
        >
          <span style="font-size:0.9rem;">{e.id === 'P' ? '✅' : e.id === 'A' ? '❌' : '📝'}</span>
          <span style="flex:1; min-width:0;">
            <span style="display:block; font-weight:700; font-size:0.76rem;">Todos {e.id}</span>
            <span style="display:block; font-size:0.62rem; color:#94a3b8;">{sub} · hoy hay {conteoEstados[e.id]}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}

  {#if showSummaryModal.show}
    <div class="modal-overlay" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }}>
      <div class="modal-content category-card" style="width:300px;max-width:85%;padding:1.2rem;text-align:center" onclick={(e) => e.stopPropagation()}>
        <h3 style="margin-top:0;color:var(--primary-color);font-size:1.2rem;margin-bottom:1rem">📊 {showSummaryModal.type}</h3>
        <div style="display:flex;flex-direction:column;gap:0.8rem">
          <div style="background:rgba(255,255,255,0.05);padding:0.8rem;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="color:#94a3b8">Total:</span><span style="font-size:1.3rem;font-weight:bold;color:#fff">{showSummaryModal.stats?.total}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem">
            <div style="background:rgba(96,165,250,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:2px">
              <span style="color:#60a5fa;font-size:0.8rem">Masculino</span><span style="font-size:1.2rem;font-weight:bold;color:#60a5fa">{showSummaryModal.stats?.m}</span>
            </div>
            <div style="background:rgba(244,114,182,0.1);padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:2px">
              <span style="color:#f472b6;font-size:0.8rem">Femenino</span><span style="font-size:1.2rem;font-weight:bold;color:#f472b6">{showSummaryModal.stats?.f}</span>
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

  <!-- Modal de filtros Android: componente reutilizable con extras
       (Período, Semana, Mes, Año) inyectados vía snippet. -->
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
        <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px"
          value={periodo} onchange={(e) => periodo = (e.target as HTMLSelectElement).value as AsistenciaPeriodo}>
          <option value="diario">Diario</option>
          <option value="semanal">Semanal</option>
          <option value="mensual">Mensual</option>
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
          <select class="filter-select filter-select-solid" style="width:100%;height:32px;padding:0 0.55rem;font-size:0.8rem;border-radius:7px;min-width:100px"
            value={mesSeleccionado} onchange={(e) => mesSeleccionado = Number((e.target as HTMLSelectElement).value)}>
            {#each mesesOptions as m}<option value={m.value}>{m.label}</option>{/each}
          </select>
        </div>
      {/if}
    {/snippet}
  </FiltersModalAndroid>
</div>

<style>
  /* Android: DatePicker + Sin Clases + Limpiar + P/A/J + Guardar en UNA sola
     fila. La fila ocupa todo el ancho y, si el equipo es muy angosto, hace
     scroll horizontal suave (sin scrollbar visible) en vez de romperse. */
  .android-actions{scrollbar-width:none;-ms-overflow-style:none;flex-shrink:0;}
  .android-actions::-webkit-scrollbar{display:none;width:0;height:0;}
  /* pop-wrap/dg-root traen width:100% (pensados para filtros verticales);
     dentro de la fila nowrap deben medir lo justo para no empujar al resto. */
  .android-actions .pop-wrap{width:auto;}
  /* El DatePicker ocupa el mismo alto/ancho que el de InformePage:
     trigger a tamaño natural, estirado a la altura de la fila. */
  .android-actions :global(.dg-root) { height: 100%; }
  .android-actions :global(.dg-trigger) { height: 100%; }
</style>
