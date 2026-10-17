<script lang="ts">
  import { onMount } from "svelte";
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import {
    rutaExportAbsoluta,
    subcarpetaRelativa,
    destinoParaToast,
  } from "../lib/carpetasExport";
  import { colorSexo, colorSexoAlfa, colorSexoExport } from "../lib/coloresSexo.svelte";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import { loadAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import { primerColegio } from "../lib/catalogo";
  import { t, tagLocale, fmtFecha, getLocale } from "../lib/i18n.svelte";
import { fmtFechaCorta, fmtFechaLarga, fmtFechaNica, nombreMes } from "../lib/fecha";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { generarPdfAsistencia } from "../lib/asistenciaPdf";
  import type { TablaAsistenciaPdf } from "../lib/asistenciaPdf";
  import { unirRuta, aFileURL } from "../lib/platform";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SelectChip from "./SelectChip.svelte";
  import { portalToBody } from "../lib/portalToBody";
  import FiltroRail from "./FiltroRail.svelte";
  import SearchFab from "./SearchFab.svelte";
  import PageLayout from "./PageLayout.svelte";
  import ScrollableTable from "./ScrollableTable.svelte";
  import DatePickerGlass from "./DatePickerGlass.svelte";
  import BotonMod from "./BotonMod.svelte";
  import ModoToggle from "./ModoToggle.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }
  interface EstudianteAsistencia { id: number; nombre: string; codigo: string; sexo: string; estado: string | null; observacion: string | null; }
  interface DiaEstado { estado: string | null; observacion: string | null; }
  interface DiaSinClase { id: number; colegio_id: number; grado_id: number | null; seccion_id: number | null; fecha: string; descripcion: string; }
  interface ColegioDiasAsistencia {
    colegioId: number; lunes: boolean; martes: boolean; miercoles: boolean;
    jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean;
  }

  /** Fila del reporte que devuelve `get_asistencia_rango` (solo exportación). */
  interface AsistenciaReporteItem {
    id: number; nombre: string; sexo: string;
    fechas: string[]; observaciones?: string[];
  }

  /** Estudiante con su grilla de días; es la fila que renderiza la tabla. */
  interface EstudianteMulti { id: number; nombre: string; codigo: string; sexo: string; dias: Record<string, DiaEstado>; }

  // Visible = la página contenedora está activa Y este es el sub-tab seleccionado.
  // Controla el registro del back-handler y el refresco silencioso al volver a verse.
  // `modo` decide si esta misma página es toma de asistencia (lectura/escritura)
  // o informe (solo lectura + exportar/imprimir): un único componente para no
  // mantener dos copias de la tabla, los filtros y las estadísticas.
  let {
    modo = "tomar",
    visible = true,
    onModoChange = () => {},
  }: {
    modo?: "tomar" | "informe";
    visible?: boolean;
    /** El dueño del estado es el wrapper (AsistenciaMainPage): el control
     *  segmentado de la barra de filtros solo avisa del cambio. */
    onModoChange?: (m: "tomar" | "informe") => void;
  } = $props();

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
    if (!visible || !showSummaryModal.show) return;
    return registerBackHandler(() => { showSummaryModal = { ...showSummaryModal, show: false }; return true; });
  });

  $effect(() => {
    if (!visible || !obsModalStudent) return;
    return registerBackHandler(() => { obsModalStudent = null; expandedObs = {}; return true; });
  });

  // Vista previa de impresión (informe): Escape/back la cierra igual que el ✕.
  $effect(() => {
    if (!visible || !printHtml) return;
    return registerBackHandler(() => { printHtml = null; return true; });
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
        if (periodoEfectivo === "diario") {
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

  // Cambio de sub-tab (tomar ↔ informe): cierra los popovers propios de cada
  // modo y recarga con el rango nuevo. Hace falta porque el informe corta el mes
  // en curso en hoy, así que lo que había en pantalla ya no sirve.
  let wasModo = modo;
  $effect(() => {
    const m = modo;
    const prev = wasModo;
    wasModo = m;
    if (m === prev) return;
    cerrarPopSinClases();
    cerrarPopSemana();
    cerrarPopSel();
    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion) {
      refreshingSilent = true;
      untrack(() => {
        if (periodoEfectivo === "diario") {
          if (selectedFecha && isFechaHabilitada) fetchEstudiantes();
        } else {
          fetchEstudiantesMulti();
        }
      });
    }
  });

  let isMobile = $state(false);
  let isAndroid = $state(/Android/i.test(navigator.userAgent));
  /**
   * ¿Estamos en la UI ancha de escritorio?
   *
   * Antes esto era `isWindows = /Windows/i.test(navigator.userAgent)`, y como la
   * variable se usaba acá para elegir entre la versión ancha y la de teléfono,
   * en Linux de escritorio caía siempre en la angosta: aparecía el menú de
   * marcado diario en vez de los popovers con selector de días, el período
   * predeterminado era "diario" y los modales se medían con 320px.
   *
   * La pregunta correcta NO es "¿soy Windows?" sino "¿soy un teléfono?": en
   * este archivo el otro lado del `if` siempre fue el flujo de Android.
   */
  let esEscritorio = $derived(!isAndroid);
  let isAndroidMobile = $derived(isAndroid || (isMobile && !esEscritorio));

  /**
   * Opciones del botón Guardar. Se declaran una vez porque en Android se renderiza
   * justo después del selector de fecha (que es lo que se está marcando) y en
   * Windows al final de la cinta, junto al resto de acciones.
   */
  let optsGuardar = $derived({
    onclick: handleManualSave,
    disabled: !hasUnsavedChanges || saving,
    icono: saving ? '⏳' : '💾',
    etiqueta: saving ? 'Guardando' : 'Guardar',
    tono: 'verde' as const,
    sub: saving
      ? t('asis.guardado.escribiendo')
      : hasUnsavedChanges
        ? t('asis.guardado.sinGuardar')
        : t('asis.guardado.limpio'),
    title: t('asis.btn.guardar'),
    compacto: isAndroidMobile,
  });
  let pageVisible = $state(true);

  // Ancho de los modales (Sin Clases / Semana): más grande y cómodo en Windows,
  // ajustado al viewport en móvil para no salirse de pantalla.
  const modalCardWidth = esEscritorio ? 'min(480px, calc(100vw - 64px))' : 'min(320px, calc(100vw - 32px))';

  let draft: Record<number, { estado: string | null; observacion: string | null }> = {};

  type AsistenciaPeriodo = "diario" | "semanal" | "mensual";
  /**
   * El período por defecto depende de la plataforma, y solo si no hay nada
   * guardado: la preferencia del usuario se respeta siempre.
   *
   *  - Windows: Mensual. La pantalla es ancha y ver el mes entero es lo útil.
   *  - Android: Diario. En un teléfono el día es la unidad de trabajo, y encima
   *    es el único modo donde el botón "Rellenar/Limpiar" no ofrece elegir
   *    días, así que el flujo se mantiene simple.
   *
   * En Windows el filtro Diario no se ofrece. Si quedó persistido "diario" desde
   * Android o de una versión anterior, se migra a Mensual en vez de dejar el
   * selector sin opción coincidente.
   */
  let periodo = $state<AsistenciaPeriodo>((() => {
    const guardado = localStorage.getItem("asistencia_periodo") as AsistenciaPeriodo | null;
    // Mismo criterio que `esEscritorio`: en escritorio (Windows, Linux o macOS)
    // el predeterminado es mensual, porque la pantalla entra el selector.
    const enEscritorio = !/Android/i.test(navigator.userAgent);
    if (guardado === "diario" && enEscritorio) return "mensual";
    return guardado || (enEscritorio ? "mensual" : "diario");
  })());

  /** ¿Estamos en el sub-tab Informe? (solo lectura + exportar/imprimir) */
  let enInforme = $derived(modo === "informe");
  /**
   * El informe no ofrece "Diario": ahí lo más corto es la semana. El valor
   * persistido sigue siendo `periodo` tal cual, así que volver a Tomar
   * asistencia restaura el "diario" que el usuario había elegido.
   *
   * Todas las comparaciones de este archivo usan `periodoEfectivo`, nunca
   * `periodo` crudo: así un solo `if` decide si corren los caminos de marcado
   * (diario) o los de grilla (semanal/mensual) en ambos modos.
   */
  let periodoEfectivo = $derived<AsistenciaPeriodo>(enInforme && periodo === "diario" ? "semanal" : periodo);


  let estudiantesMulti: EstudianteMulti[] = $state([]);
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
    const raw = new Date(2000, i, 1).toLocaleDateString(tagLocale(), { month: 'long' });
    return { value: i + 1, label: raw.charAt(0).toUpperCase() + raw.slice(1) };
  }));

  // La lista filtrada (búsqueda) va ANTES de las estadísticas: las tarjetas se
  // calculan sobre ella, y TS exige que el `let` exista antes de leerse.
  let filteredEstudiantes = $derived(estudiantes.filter(est => est.nombre.toLowerCase().includes(searchTerm.toLowerCase())));
  let filteredEstudiantesMulti = $derived(estudiantesMulti.filter(est => est.nombre.toLowerCase().includes(searchTerm.toLowerCase())));

  /**
   * Estadísticas sobre la lista YA filtrada (búsqueda + sexo): cambiar un filtro
   * tiene que cambiar los totales, si no las tarjetas contradicen la tabla.
   * En diario se cuentan estudiantes del día; en grilla (semanal/mensual) se
   * cuentan pares estudiante×día.
   */
  let totalEstudiantes = $derived(filteredEstudiantes.length);
  let totalM = $derived(filteredEstudiantes.filter(e => e.sexo === 'M').length);
  let totalF = $derived(filteredEstudiantes.filter(e => e.sexo === 'F').length);

  function getStats(estado: string | null) {
    const filtered = filteredEstudiantes.filter(e => e.estado === estado);
    return { total: filtered.length, m: filtered.filter(e => e.sexo === 'M').length, f: filtered.filter(e => e.sexo === 'F').length };
  }
  let statsP = $derived(getStats('P'));
  let statsA = $derived(getStats('A'));
  let statsJ = $derived(getStats('J'));
  let asistenciaPct = $derived(totalEstudiantes > 0 ? Math.round(statsP.total / totalEstudiantes * 100) : 0);
  let totalPosibleMulti = $derived(filteredEstudiantesMulti.length * fechasPeriodo.length);

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
  /**
 * `01/09` -> `01/Sep`.
 *
 * Antes era un `slice` crudo sobre el ISO. Pasaba por alto el idioma activo (el
 * mes siempre salía en inglés porque el slice era del número) y no aplicaba el
 * formato estándar de la app. Ahora sale del módulo central.
 */
function fmtDM(iso: string): string {
    return fmtFechaCorta(iso, getLocale()) || iso;
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

  /**
   * Cambia el mes desde el dropdown del filtro semanal: conserva el número de
   * semana activo si el mes destino lo tiene (semana 3 → semana 3), si no cae
   * a la última disponible. Sin esto, el dropdown cambiaría solo el mes y
   * `selectedFecha` quedaría apuntando a la semana del mes anterior.
   */
  function elegirMesSemanal(m: number) {
    const nSem = semanaActiva;
    mesSeleccionado = m;
    const opts = semanasOpts;
    const objetivo = opts.find(s => s.n === Math.min(nSem, opts.length)) ?? opts[0];
    if (objetivo && !(selectedFecha >= objetivo.lunes && selectedFecha <= sumaDiasISO(objetivo.lunes, 6))) {
      selectedFecha = objetivo.lunes;
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
    if (!visible || !popSemanaAbierta) return;
      return registerBackHandler(() => { cerrarPopSemana(); return true; });
  });

  // ── Estados P/A/J ──
  // NO hay popover por celda: el marcado se hace directamente con los botones del
  // mouse sobre el recuadro de estado (ver `handleMouseEstadoClick`) y en Android
  // con el toque. El popover por hover se elimino (2026-10): aparecia al pasar el
  // cursor, tambien sobre el input de observacion (`.celda-estado:hover` incluye
  // el input), y competia con la edicion del texto.
  //
  // `$derived` porque `label` se traduce: el `id` ('P'/'A'/'J') es el valor de
  // dominio que viaja a la BD y NO se traduce, solo la etiqueta.
  const ESTADOS_PAJ = $derived([
    { id: 'P' as const, label: t('asis.estado.presente'), color: '#10b981', suave: 'rgba(16,185,129,0.10)', borde: 'rgba(16,185,129,0.3)' },
    { id: 'A' as const, label: t('asis.estado.ausente'), color: '#ef4444', suave: 'rgba(239,68,68,0.10)', borde: 'rgba(239,68,68,0.3)' },
    { id: 'J' as const, label: t('asis.estado.justificado'), color: '#f59e0b', suave: 'rgba(245,158,11,0.10)', borde: 'rgba(245,158,11,0.3)' },
  ]);

  // ── Popover de acciones masivas sobre el período (Rellenar / Limpiar) ──
  // Mismo patrón que el popover de Acciones de NotasPage: un BotonMod que ancla
  // un panel `fixed` con las acciones dentro. Antes eran varios BotonMod sueltos
  // en la cinta de filtros y, con todos los chips desplegables, la fila se iba de
  // ancho.
  //
  // "Rellenar" va en dos pasos (estado y después QUÉ DÍAS) porque es selectivo:
  // solo celdas vacías. "Limpiar" entra directo a la lista de días, que es lo
  // único que hay que decidir. Ambos escriben directo en la base, sin pasar por
  // el borrador.
  //
  // Solo en Windows. Android trabaja con período DIARIO: no hay semana ni mes que
  // elegir, así que conserva el comportamiento directo del día completo.
  const ANCHO_POP_MASIVOS = 268;
  type PopSel = {
    x: number;
    y: number;
    abajo: string;
    modo: 'rellenar' | 'limpiar';
    paso: 'estado' | 'fechas';
    estado: 'P' | 'A' | 'J' | null;
    /** Fechas elegidas en el paso 2. */
    fechas: Set<string>;
  };
  let popSel = $state<PopSel | null>(null);
  let popSelPanelEl = $state<HTMLDivElement | null>(null);
  let popSelBtn = $state<HTMLElement | null>(null);
  /** Ref del BotonMod disparador, para anclar el panel. */
  let popSelBtnEl = $state<HTMLElement | null>(null);
  /** Ref del BotonMod "Limpiar", que abre el mismo panel en modo limpiar. */
  let popLimpiarBtnEl = $state<HTMLElement | null>(null);
  let masivosGuardando = $state(false);

  function togglePopSel(btn: HTMLElement, modo: 'rellenar' | 'limpiar') {
    if (popSel) { cerrarPopSel(); return; }
    const r = btn.getBoundingClientRect();
    if (!r) { console.warn('[Masivos] botón sin referencia; no se puede anclar el popover'); return; }
    const altoEstimado = 220;
    const abreArriba = r.bottom + altoEstimado > window.innerHeight && r.top > altoEstimado;
    popSelBtn = btn;
    popSel = {
      x: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - ANCHO_POP_MASIVOS - 8)),
      y: abreArriba ? 0 : Math.round(r.bottom + 4),
      abajo: abreArriba ? `${Math.round(window.innerHeight - r.top + 4)}px` : 'auto',
      modo,
      paso: modo === 'limpiar' ? 'fechas' : 'estado',
      estado: null,
      fechas: new Set(),
    };
  }

  function cerrarPopSel() { popSel = null; popSelBtn = null; }

  /** Pasa al paso 2 con el estado elegido. */
  function pasoFechas(estado: 'P' | 'A' | 'J') {
    if (!popSel) return;
    popSel = { ...popSel, paso: 'fechas', estado, fechas: new Set() };
  }

  function volverAEstado() {
    if (!popSel) return;
    popSel = { ...popSel, paso: 'estado', estado: null, fechas: new Set() };
  }

  function alternarFecha(fecha: string) {
    if (!popSel) return;
    const fechas = new Set(popSel.fechas);
    if (fechas.has(fecha)) fechas.delete(fecha); else fechas.add(fecha);
    popSel = { ...popSel, fechas };
  }

  function elegirTodasLasFechas() {
    if (!popSel) return;
    popSel = { ...popSel, fechas: new Set(diasSeleccionables) };
  }

  function elegirNinguna() {
    if (!popSel) return;
    popSel = { ...popSel, fechas: new Set() };
  }

  /**
   * Días que el selector de "Rellenar" ofrece: los hábiles del colegio, sin los
   * días marcados sin clases.
   *
   * NO usa `fechasPeriodo`: ese `$state` se llena dentro del fetch de
   * estudiantes, que va en `untrack()` (a propósito, para no re-disparar el
   * efecto en bucle) y por lo tanto no depende de `colegioConfig`. Si la carga
   * corre antes de que llegue la config del colegio, `getDiasHabilitados`
   * devuelve los 7 días y el snapshot queda con fines de semana; la grilla no lo
   * sufre porque usa un `$derived`, pero este selector sí. Se calcula al vuelo.
   *
   * Tampoco se cruza con las claves de `est.dias`: el servidor solo devuelve los
   * días que YA tienen registro, así que una celda vacía no aparece ahí. Cruzar
   * dejaría la lista vacía justo cuando es cuando hay algo que rellenar.
   */
  let diasSeleccionables = $derived(getDiasHabilitados(getFechasPeriodo()));

  /**
   * Días del período agrupados por semana (mismo criterio que la tabla, con el
   * primer día hábil del colegio). En mensual son bloques de 5-6 días; en
   * semanal, un solo bloque. Se muestran los días YA marcados como completos
   * deshabilitados, para que se vea de un vistazo que no hay nada que rellenar.
   */
  let gruposSemanaSel = $derived.by(() => {
    const rellenables = new Set(diasSeleccionables);
    const out: { numero: number; fechas: string[] }[] = [];
    let actual: string[] = [];
    // Se recorre `fechasVisibles` (que INCLUYE los días marcados sin clases) y no
    // `diasSeleccionables`, porque la numeración tiene que ser la misma que la de las
    // columnas de la tabla: `semanasMes` cuenta una semana aunque entera esté sin
    // clases. Armando los grupos sobre los días rellenables, una semana sin
    // clases no generaba grupo y la siguiente se renumeraba (la 5 se veía como 3).
    // Después se descartan, de cada semana, los días que no hay que rellenar.
    let numero = 0;
    const cerrar = () => {
      if (actual.length === 0) return;
      numero++;
      const fechas = actual.filter(f => rellenables.has(f));
      if (fechas.length > 0) out.push({ numero, fechas });
      actual = [];
    };
    fechasVisibles.forEach((fv, i) => {
      if (esInicioSemana(fv.fecha, i)) cerrar();
      actual.push(fv.fecha);
    });
    cerrar();
    return out;
  });

  /** Cuántas asistencias se van a CREAR para un estado en un día dado. */
  function celdasVacias(fecha: string): number {
    return estudiantesMulti.filter(est => {
      // Un día sin registro no está en `est.dias`, y eso ES una celda vacía.
      const actual = est.dias[fecha]?.estado || null;
      return !actual || actual === '-';
    }).length;
  }

  /** Cuántas asistencias tienen estado (y por lo tanto se pueden limpiar). */
  function celdasConEstado(fecha: string): number {
    return estudiantesMulti.filter(est => {
      const actual = est.dias[fecha]?.estado || null;
      return !!actual && actual !== '-';
    }).length;
  }

  /** Celdas que tocaría el modo abierto: vacías para rellenar, con estado para limpiar. */
  function celdasObjetivo(fecha: string): number {
    return popSel?.modo === 'limpiar' ? celdasConEstado(fecha) : celdasVacias(fecha);
  }

  /** Texto del contador de un día, según el modo. */
  function resumenCelda(fecha: string): string {
    const n = celdasObjetivo(fecha);
    if (popSel?.modo === 'limpiar') return n === 0 ? 'vacío' : `${n} marcadas`;
    return n === 0 ? 'completo' : `${n} vacías`;
  }

  /** ¿Ese día tiene algo que hacer en el modo abierto? */
  function diaAccionable(fecha: string): boolean {
    return celdasObjetivo(fecha) > 0;
  }

  /** Total de celdas a tocar con la selección actual. */
  let totalAMarcar = $derived.by(() => {
    if (!popSel) return 0;
    let total = 0;
    popSel.fechas.forEach(f => { total += celdasObjetivo(f); });
    return total;
  });

  /** Hay algo que rellenar en el período (sub del botón "Rellenar"). */
  let hayPendientes = $derived(diasSeleccionables.some(f => celdasVacias(f) > 0));

  /** Hay algo que limpiar en el período (sub del botón "Limpiar"). */
  let hayLimpables = $derived(diasSeleccionables.some(f => celdasConEstado(f) > 0));

  /** Total de asistencias marcadas en el período. */
  let totalMarcadasPeriodo = $derived.by(() => {
    let total = 0;
    for (const fecha of diasSeleccionables) total += celdasConEstado(fecha);
    return total;
  });

  /** Total de celdas vacías en todo el período (sub del botón disparador). */
  let totalPendientes = $derived.by(() => {
    let total = 0;
    for (const fecha of diasSeleccionables) total += celdasVacias(fecha);
    return total;
  });

  /**
   * Rellena SOLO las celdas sin estado en las fechas elegidas y guarda en la
   * base de una sola vez. No toca el borrador: no se pasa por `draftMulti`
   * porque acá no hay nada que revisar, la escritura es inmediata.
   */
  async function aplicarMasivos() {
    const estadoElegido = popSel?.estado;
    if (!estadoElegido) return;
    const fechas = [...popSel!.fechas];
    if (fechas.length === 0) return;
    const registros: Array<{ estudianteId: number; fecha: string; estado: string; observacion: string }> = [];
    // Celdas efectivamente rellenadas, para dejar el borrador consistente.
    const escritas: Array<{ estId: number; fecha: string; observacion: string }> = [];
    for (const fecha of fechas) {
      for (const est of estudiantesMulti) {
        const actual = est.dias[fecha]?.estado || null;
        if (actual && actual !== '-') continue; // ya tiene estado: no se pisa
        // La observación sale del borrador si hay algo escrito sin guardar: si se
        // usara la del servidor, escribir acá borraría lo que el usuario escribió.
        const obsDraft = draftMulti[est.id]?.[fecha]?.observacion;
        const observacion = obsDraft !== undefined ? obsDraft : (est.dias[fecha]?.observacion || '');
        registros.push({ estudianteId: est.id, fecha, estado: estadoElegido, observacion: observacion || '' });
        escritas.push({ estId: est.id, fecha, observacion: observacion || '' });
      }
    }
    if (registros.length === 0) {
      await emit("show-toast", { message: "⚠️ No hay asistencias vacías en esas fechas", type: 'warning' });
      return;
    }
    const rango = fechas.length === 1
      ? fmtDM(fechas[0])
      : `${fmtDM(fechas[0])} ${t('asis.masivo.al')} ${fmtDM(fechas[fechas.length - 1])}`;
    const etiqueta = estadoElegido === 'P'
      ? t('asis.estado.presente')
      : estadoElegido === 'A'
        ? t('asis.estado.ausente')
        : t('asis.estado.justificado');
    const ok = await ask(
      t('asis.masivo.confirmarMsg', {
        n: registros.length,
        estado: etiqueta,
        codigo: estadoElegido,
        rango,
        dias: fechas.length,
        estudiantes: estudiantesMulti.length,
      }),
      {
        title: t('asis.masivo.marcarTitulo', { estado: etiqueta }),
        kind: 'info',
        okLabel: t('asis.masivo.siMarcar'),
        cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    masivosGuardando = true;
    try {
      await invoke('save_asistencia', { records: registros });
      // Reflejar en memoria para que la tabla muestre el resultado sin recargar.
      const porFecha = new Set(fechas);
      estudiantesMulti = estudiantesMulti.map(est => {
        const dias = { ...est.dias };
        for (const fecha of porFecha) {
          const actual = dias[fecha]?.estado || null;
          if (actual && actual !== '-') continue;
          dias[fecha] = { ...dias[fecha], estado: estadoElegido, observacion: dias[fecha]?.observacion || '' };
        }
        return { ...est, dias };
      });
      // Sincronizar SOLO las celdas escritas. No se vacía el borrador entero: ahí
      // pueden quedar marcas manuales de otros días que todavía no se guardaron, y
      // borrarlas las perdería. Al dejar el borrador igual a lo recién guardado, un
      // Guardar posterior no intenta borrar estas filas.
      for (const w of escritas) {
        if (!draftMulti[w.estId]) draftMulti[w.estId] = {};
        draftMulti[w.estId][w.fecha] = { estado: estadoElegido, observacion: w.observacion };
      }
      syncDraftMultiToStorage();
      capturarOriginalMulti();
      await emit('show-toast', { message: t('asis.masivo.exito', { n: registros.length, estado: etiqueta }), type: 'success' });
      onDataChange('asistencia', { immediate: true });
      skipNextRefresh = true;
      await emit('asistencia-updated');
      cerrarPopSel();
    } catch (error) {
      console.error('Error marcando asistencias masivamente:', error);
      await emit('show-toast', { message: t('asis.error.guardar', { msg: String(error) }), type: 'error' });
    } finally { masivosGuardando = false; }
  }

  /**
   * Vacía las celdas marcadas de los días elegidos y borra esas filas de la
   * base, en una sola pasada.
   *
   * `asistencia.estado` es NOT NULL con CHECK, así que no existe una fila sin
   * estado: vaciar una celda implica borrar la fila, y con ella se va también la
   * observación de ese día. Por eso el diálogo lo dice explícitamente.
   *
   * Solo se borra lo que estaba en el servidor (`originalMulti`, que es el
   * snapshot previo al borrador). Una marca hecha a mano y todavía sin guardar
   * no tiene fila: se quita del borrador y de la memoria, sin tocar la base.
   */
  async function aplicarLimpiar() {
    const fechas = [...(popSel?.fechas ?? [])];
    if (fechas.length === 0) return;
    // Ids a borrar por fecha, y celdas a vaciar en memoria.
    const borrarPorFecha: Record<string, number[]> = {};
    const aVaciar: Array<{ estId: number; fecha: string }> = [];
    for (const fecha of fechas) {
      for (const est of estudiantesMulti) {
        const efectivo = est.dias[fecha]?.estado || null;
        if (!efectivo || efectivo === '-') continue; // ya vacía
        const snap = originalMulti[`${est.id}|${fecha}`];
        const enServidor = !!snap?.estado && snap.estado !== '-';
        if (enServidor) (borrarPorFecha[fecha] ||= []).push(est.id);
        aVaciar.push({ estId: est.id, fecha });
      }
    }
    if (aVaciar.length === 0) {
      await emit('show-toast', { message: t('asis.limpiar.vacias'), type: 'warning' });
      return;
    }
    const rango = fechas.length === 1
      ? fmtDM(fechas[0])
      : `${fmtDM(fechas[0])} ${t('asis.masivo.al')} ${fmtDM(fechas[fechas.length - 1])}`;
    const enServidor = aVaciar.filter(v => !!originalMulti[`${v.estId}|${v.fecha}`]?.estado).length;
    const ok = await ask(
      t('asis.limpiar.confirmarMsg', {
        n: aVaciar.length,
        rango,
        dias: fechas.length,
        estudiantes: estudiantesMulti.length,
        aviso: enServidor > 0 ? t('asis.limpiar.avisoServidor', { n: enServidor }) : '',
      }),
      {
        title: t('asis.limpiar.btn'),
        kind: 'warning',
        okLabel: t('asis.limpiar.confirmar'),
        cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    masivosGuardando = true;
    try {
      for (const [fecha, ids] of Object.entries(borrarPorFecha)) {
        await invoke('delete_asistencia_batch', { estudianteIds: ids, fecha });
      }
      const porPareja = new Set(aVaciar.map(v => `${v.estId}|${v.fecha}`));
      estudiantesMulti = estudiantesMulti.map(est => {
        const dias = { ...est.dias };
        for (const fecha of fechas) {
          if (!porPareja.has(`${est.id}|${fecha}`)) continue;
          dias[fecha] = { estado: null, observacion: null };
        }
        return { ...est, dias };
      });
      for (const v of aVaciar) {
        if (!draftMulti[v.estId]) draftMulti[v.estId] = {};
        draftMulti[v.estId][v.fecha] = { estado: null, observacion: null };
      }
      syncDraftMultiToStorage();
      capturarOriginalMulti();
      await emit('show-toast', { message: t('asis.limpiar.exito', { n: aVaciar.length }), type: 'success' });
      onDataChange('asistencia', { immediate: true });
      skipNextRefresh = true;
      await emit('asistencia-updated');
      cerrarPopSel();
    } catch (error) {
      console.error('Error limpiando asistencias:', error);
      await emit('show-toast', { message: t('asis.error.limpiar', { msg: String(error) }), type: 'error' });
    } finally { masivosGuardando = false; }
  }

  $effect(() => {
    if (!popSel) return;
    const onPointerDown = (ev: PointerEvent) => {
      // `nodo` y no `t`: ver la nota en el handler equivalente de arriba.
      const nodo = ev.target as Node | null;
      if (nodo && (popSelPanelEl?.contains(nodo) || popSelBtn?.contains(nodo))) return;
      cerrarPopSel();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrarPopSel(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cerrarPopSel);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cerrarPopSel);
    };
  });

  $effect(() => {
    if (!visible || !popSel) return;
    return registerBackHandler(() => { cerrarPopSel(); return true; });
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

  /**
   * Fechas del período visible. Es el punto único por el que pasan la grilla,
   * los días sin clases, el borrador y la exportación: si el período cambia,
   * todo cambia con él.
   *
   * En el informe el mes en curso termina HOY, no el último día del calendario:
   * anunciar días que aún no tienen asistencia registrada como si fueran datos
   * dejaría el reporte con columnas vacías al final. En Tomar asistencia el mes
   * sí es completo — ahí el futuro es donde se va a marcar.
   */
  function getFechasPeriodo(): string[] {
    const fechas =
      periodoEfectivo === "semanal" ? computeWeekDates(selectedFecha) :
      periodoEfectivo === "mensual" ? computeMonthDates(mesSeleccionado, anoSeleccionado) :
      [selectedFecha];
    if (!enInforme || periodoEfectivo !== "mensual") return fechas;
    const hoy = getLocalDateISOString();
    const corte = fechas.findIndex(f => f > hoy);
    return corte === -1 ? fechas : fechas.slice(0, corte);
  }

  function getDiasHabilitados(fechas: string[]): string[] {
    // Same Sunday fallback as `getDiasHabilitadosBase`: without it a school with
    // no weekly config keeps a Sunday column in the grid and the period never
    // looks fully off. See `sinDomingos`.
    if (!colegioConfig) return sinDomingos(fechas).filter(f => !esDiaSinClases(f));
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

  /**
   * ¿Falta elegir semana para poder marcar?
   *
   * Solo aplica cuando lo que se va a marcar es una SEMANA del mes. Si el
   * usuario hizo clic en la cabecera de una columna, queda `colFechaObjetivo`
   * y el objetivo es ESE DÍA: el popover ni siquiera muestra el selector de
   * semana (lo reemplaza por el aviso de "solo esta fecha"), así que exigirla
   * dejaba los tres botones deshabilitados sin que hubiera forma de
   * habilitarlos. Se escribía el motivo y los botones seguían sin responder.
   *
   * Por eso el `!colFechaObjetivo` es parte de la condición y no un detalle:
   * con un día concreto hay que responder que no falta elegir nada.
   */
  let faltaElegirSemana = $derived(
    periodoEfectivo === 'mensual' && !semanaSeleccionada && !colFechaObjetivo
  );

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
    // Only the school is required. Right after changing school the grade/section
    // are still 0, and bailing out there wiped `diasSinClases`: the school-wide
    // marks ("todo el colegio", "todos los colegios") disappeared until something
    // else refetched, so the motive of the period was missing depending on which
    // school was selected. Passing null for grade/section returns the school-wide
    // marks; section marks arrive as soon as the section is known.
    if (!selectedColegio) { diasSinClases = []; return; }
    try {
      const fechas = getFechasPeriodo();
      const data = await invoke<DiaSinClase[]>('get_dias_sin_clases', {
        colegioId: selectedColegio,
        gradoId: selectedGrado || null,
        seccionId: selectedSeccion || null,
        fechaInicio: fechas[0], fechaFin: fechas[fechas.length - 1],
      });
      // Evitar reasignar si el contenido no cambió (rompe dependencias sin motivo)
      if (JSON.stringify(data) !== JSON.stringify(diasSinClases)) diasSinClases = data;
    } catch (e) { console.error('Error cargando días sin clases:', e); }
  }

  // ¿El período actual (diario/semanal) está totalmente marcado como sin clases?
  let sinClasesActivo = $derived.by(() => {
    if (periodoEfectivo === 'mensual') return false;
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
    if (!colegioConfig) return sinDomingos(fechas);
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return fechas.filter(f => colegioConfig[dayNames[new Date(f + "T12:00:00").getDay()]] !== false);
  }

  /**
   * Fallback cuando el colegio NO tiene `colegio_dias_asistencia` cargado: antes
   * se asumían los 7 días, y eso rompía la vista de "período sin clases".
   *
   * Al marcar una semana "para todos los colegios" las marcas caen sobre los 7
   * días del calendario a propósito (ver `objetivosSinClases`), así que con el
   * supuesto de 7 días un colegio sin config siempre tenía días "laborables" sin
   * marcar: la semana NUNCA se veía completa y la página seguía mostrando la
   * tabla por días con el motivo en cada columna, en vez del panel de período sin
   * clases. Con ello la misma semana se veía de una forma en el colegio que SÍ
   * tiene config (panel) y de otra en el que no la tiene (tabla).
   *
   * Solo cae el domingo: es el único día que por defecto ningún colegio trabaja.
   * El sábado NO, porque los colegios martes-sábado son un caso real (y la
   * semana del calendario se arma desde el lunes).
   */
  function sinDomingos(fechas: string[]): string[] {
    return fechas.filter(f => new Date(f + "T12:00:00").getDay() !== 0);
  }
  /** Fechas objetivo del botón: días hábibles de la semana/día actual. */
  function fechasObjetivoSinClases(): string[] {
    const base = getDiasHabilitadosBase(getFechasPeriodo());
    // En semanal solo se marcan los días que aún no están cubiertos por otra marca
    return base;
  }

  /**
   * The period has NO enabled days because every working day is marked as
   * "sin clases", as opposed to "the school simply doesn't work these days".
   * `sinClasesActivo` excludes the monthly view on purpose (marks there are per
   * week), so this one covers all three periods and is what the empty state
   * needs: a period fully marked off is a valid state, not a broken one.
   */
  let periodoTodoSinClases = $derived.by(() => {
    const base = getDiasHabilitadosBase(getFechasPeriodo());
    return base.length > 0 && base.every(f => esDiaSinClases(f));
  });

  /**
   * Motives of the days marked "sin clases" in this period, unique and in
   * order. Goes through `motivoSinClasesEn` so a day covered by a mark without
   * a description still shows the reason from whichever mark does have it.
   */
  let motivosPeriodoSinClases = $derived.by(() => {
    const base = getDiasHabilitadosBase(getFechasPeriodo()).filter(f => esDiaSinClases(f));
    const out: string[] = [];
    for (const f of base) {
      const desc = motivoSinClasesEn(f);
      if (desc && desc !== t('asis.sinClases.motivoVacio') && !out.includes(desc)) out.push(desc);
    }
    return out;
  });

  /**
   * Days of the visible period that carry a "sin clases" mark, whatever their
   * scope. `periodoTodoSinClases` (every working day off) is just the case
   * where this covers all of them; both the banner and the empty panel read from
   * here so the reason and the restore action are ALWAYS presented the same way.
   */
  let diasMarcadosPeriodo = $derived(getDiasHabilitadosBase(getFechasPeriodo()).filter(f => esDiaSinClases(f)));
  let periodoTieneMarcas = $derived(diasMarcadosPeriodo.length > 0);

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

  /**
   * ¿Esta fecha abre el bloque de su semana? (Primera columna visible del grupo.)
   *
   * ANTES la cabecera usaba `esInicioSemana(fecha)` para dibujar la píldora "S N",
   * que exige que el día sea el PRIMER DÍA HÁBIL de la semana del colegio. El
   * bloque 1 del mes casi nunca arranca ahí: si el mes empieza en jueves y la
   * semana del colegio es lunes, el bloque 1 va del jueves al sábado y no
   * contiene ningún lunes — la píldora "S1" NO SE DIBUJABA NUNCA, y el separador
   * vertical tampoco. Solo aparecían de la semana 2 en adelante.
   *
   * Ahora se pregunta por el BLOQUE, que es lo que el usuario ve en pantalla.
   */
  function esPrimeraColumnaDeSemana(iso: string): boolean {
    const s = semanasMes.find(w => w.fechas.includes(iso));
    return !!s && s.fechas[0] === iso;
  }

  /** Rango legible de una semana: "01/09 al 04/09". */
  function rangoSemana(s: { numero: number; fechas: string[] }): string {
    if (s.fechas.length === 0) return '';
    return `${fmtDM(s.fechas[0])} al ${fmtDM(s.fechas[s.fechas.length - 1])}`;
  }
  function semanaSinClasesTotal(s: { numero: number; fechas: string[] }): boolean {
    return s.fechas.length > 0 && s.fechas.every(f => esDiaSinClases(f));
  }
  /**
   * Motive of a day marked as "sin clases".
   *
   * `coberturaSinClases` answers with the FIRST row that covers the day, and the
   * list is ordered by date only. With two marks on the same date (a school-wide
   * one and a leftover section one) the row that answers can be the one without
   * a description — the motive then showed for one school and vanished for
   * another, depending on which section happened to match. So: take the covering
   * mark, and if it has no description fall back to any other row of that date
   * that does.
   */
  function motivoSinClasesEn(fecha: string): string {
    const directa = (coberturaSinClases(fecha)?.descripcion || '').trim();
    if (directa) return directa;
    const alternativa = diasSinClases.find(d => d.fecha === fecha && (d.descripcion || '').trim());
    return (alternativa?.descripcion || '').trim() || t('asis.sinClases.motivoVacio');
  }

  /** Días seleccionables en el calendario: hábiles del colegio y no marcados sin clases. */
  function esDiaHabilCalendario(iso: string): boolean {
    if (!colegioConfig) return true;
    // OJO: estos nombres son CLAVES de dominio: indexan `colegioConfig`, que viene
    // de la tabla `colegio_dias_asistencia` (lunes..domingo). No se traducen.
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
    if (colFechaObjetivo) return { fechas: [colFechaObjetivo], etiqueta: t('asis.sinClases.eseDia') };
    if (periodoEfectivo === 'mensual') {
      const lista = paraTodosLosColegios ? semanasMesBase : semanasMes;
      const sel = lista.find(w => w.numero === semanaSeleccionada);
      if (!sel) return null;
      return { fechas: sel.fechas, etiqueta: t('asis.sinClases.etiquetaSemana', { n: sel.numero }) };
    }
    if (paraTodosLosColegios) return { fechas: getFechasPeriodo(), etiqueta: t('asis.sinClases.periodoActual') };
    return { fechas: fechasObjetivoSinClases(), etiqueta: t('asis.sinClases.periodoActual') };
  }

  async function activarSinClases(nivelColegio: boolean) {
    const motivo = sinClasesDescripcion.trim();
    if (!motivo) { emit("show-toast", { message: t('asis.sinClases.motivoObligatorio'), type: "warning" }); return; }
    const obj = objetivosSinClases();
    if (!obj) {
      emit("show-toast", { message: t('asis.sinClases.seleccioneSemana'), type: 'warning' });
      return;
    }
    const objetivos = obj.fechas;
    if (objetivos.length === 0) return;
    const alcanceTxt = nivelColegio ? t('asis.sinClases.todoColegio') : t('asis.sinClases.alcanceSoloSeccion');
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} ${t('asis.masivo.al')} ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(
      t('asis.sinClases.confirmarMsg', { rango: rangoTxt, alcance: alcanceTxt, afecta: obj.etiqueta, motivo }),
      { title: t('asis.sinClases.pasto'), kind: 'warning', okLabel: t('asis.sinClases.confirmar'), cancelLabel: t('comun.cancelar') }
    );
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
      if (periodoEfectivo !== 'diario') { refreshingSilent = true; fetchEstudiantesMulti(); }
      emit("show-toast", { message: t('asis.sinClases.exito', { nivel: nivelColegio ? t('asis.sinClases.nivelColegio') : t('asis.sinClases.nivelSeccion'), n: objetivos.length, motivo }), type: "success" });
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
      await emit("show-toast", { message: t('asis.sinClases.sinColegios'), type: 'warning' });
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
    if (periodoEfectivo !== 'diario') { refreshingSilent = true; fetchEstudiantesMulti(); }
  }

  async function activarSinClasesTodosColegios() {
    const motivo = sinClasesDescripcion.trim();
    if (!motivo) { emit("show-toast", { message: t('asis.sinClases.motivoObligatorio'), type: "warning" }); return; }
    const obj = objetivosSinClases(true);
    if (!obj) {
      emit("show-toast", { message: t('asis.sinClases.seleccioneSemana'), type: 'warning' });
      return;
    }
    const objetivos = obj.fechas;
    if (objetivos.length === 0) return;
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} ${t('asis.masivo.al')} ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(
      t('asis.sinClases.todosConfirmarMsg', { rango: rangoTxt, n: colegios.length, alcance: t('asis.sinClases.todosTitulo'), afecta: obj.etiqueta, motivo }),
      { title: t('asis.sinClases.todosColegios'), kind: 'warning', okLabel: t('asis.sinClases.todosColegiosConfirmar'), cancelLabel: t('comun.cancelar') }
    );
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await aplicarEnTodosLosColegios(objetivos, motivo, true);
      cerrarPopSinClases();
      sinClasesDescripcion = '';
      emit("show-toast", { message: t('asis.sinClases.todosExito', { dias: objetivos.length, n: colegios.length, motivo }), type: "success" });
    } catch (e) {
      console.error('Error marcando días sin clases en todos los colegios:', e);
      await emit("show-toast", { message: t('asis.sinClases.errorMarcarTodos', { msg: String(e) }), type: "error" });
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
    const rangoTxt = objetivos.length === 1 ? objetivos[0].split('-').reverse().join('/') : `${objetivos[0].split('-').reverse().join('/')} ${t('asis.masivo.al')} ${objetivos[objetivos.length - 1].split('-').reverse().join('/')}`;
    const ok = await ask(
      t('asis.sinClases.reactivarTodosMsg', { rango: rangoTxt, n: colegios.length }),
      { title: t('asis.sinClases.reactivarTodos'), kind: 'info', okLabel: t('asis.sinClases.reactivarSi'), cancelLabel: t('comun.cancelar') }
    );
    if (!ok) return;
    sinClasesGuardando = true;
    try {
      await aplicarEnTodosLosColegios(objetivos, '', false);
      cerrarPopSinClases();
      emit("show-toast", { message: t('asis.sinClases.reactivarTodosExito'), type: "success" });
    } catch (e) {
      console.error('Error reactivando días sin clases en todos los colegios:', e);
      await emit("show-toast", { message: t('asis.sinClases.errorReactivarTodos', { msg: String(e) }), type: "error" });
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
    const ok = await ask(
      t('asis.sinClases.reactivarUnicoMsg', { rango: rangoTxt }) +
        '\n\n' +
        t('asis.sinClases.reactivarUnicoAlcance', { alcance: nivelColegio ? t('asis.sinClases.alcanceTodo') : t('asis.limpiar.alcanceSeccion') }),
      { title: t('asis.sinClases.reactivar'), kind: 'info', okLabel: t('asis.sinClases.reactivarSi'), cancelLabel: t('comun.cancelar') }
    );
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
      if (periodoEfectivo !== 'diario') { refreshingSilent = true; fetchEstudiantesMulti(); }
      emit("show-toast", { message: t('asis.sinClases.reactivarOk', { n: objetivos.length }), type: "success" });
    } catch (e) {
      console.error('Error reactivando clases:', e);
      await emit("show-toast", { message: t('asis.error.reactivar', { msg: String(e) }), type: "error" });
    } finally { sinClasesGuardando = false; }
  }

  // Cierre por clic fuera + Back de Android para el popover de sin clases.
  // El modal puede abrirse desde el botón (semanal/diario) o desde el click en
  // el encabezado de una columna (mensual), así que se aceptan clics en ambos.
  $effect(() => {
    if (!popSinClasesAbierta) return;
    const fuera = (e: Event) => {
      // `nodo` y no `t`: ver la nota en el handler equivalente de arriba.
      const nodo = e.target as Node;
      if (popSinClasesEl && popSinClasesEl.contains(nodo)) return;
      if (popModalSinClasesEl && popModalSinClasesEl.contains(nodo)) return;
      cerrarPopSinClases();
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  });
  $effect(() => {
    if (!visible || !popSinClasesAbierta) return;
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
        if (periodoEfectivo === "diario") {
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
    if (periodoEfectivo === "diario") {
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
    // `periodoEfectivo` depende también de `modo` (el informe no ofrece diario):
    // sin declararlo acá, cambiar de sub-tab no recargaba la grilla.
    void modo;
    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion) {
      // untrack: los fetch leen diasSinClases/colegioConfig al preparar parámetros;
      // sin esto, reasignar esos estados re-disparaba este efecto en bucle.
      untrack(() => {
        if (periodoEfectivo === "diario") {
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
    void c; void g; void s; void periodo; void modo; void selectedFecha; void mesSeleccionado; void anoSeleccionado;
    // Solo el colegio es obligatorio (ver `fetchDiasSinClases`): exigir también
    // grado y sección dejaba el período sin motivo tras cambiar de colegio.
    if (!c) { diasSinClases = []; return; }
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
      // Colegio: primero el que tenga clases HOY (`get_recommended_colegio` ya
      // desempata alfabéticamente entre los que corresponde). Si hoy no hay
      // ninguno con ese día habilitado —fin de semana, feriado o colegio sin
      // `colegio_dias_asistencia` cargado— se cae al primero alfabético. Ya no
      // se mira `colegio.activo`: no existe colegio predeterminado.
      let colegioToSelect = 0;
      if (recommendedColegioId && recommendedColegioId > 0) colegioToSelect = recommendedColegioId;
      else colegioToSelect = primerColegio(colegiosData)?.id || 0;
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
      const fechasHabilitadas = getDiasHabilitados(getFechasPeriodo());
      const fechasBase = getDiasHabilitadosBase(getFechasPeriodo());
      fechasPeriodo = fechasHabilitadas;
      if (fechasBase.length === 0) {
        estudiantesMulti = [];
        originalMulti = {};
        monthlyPcts = {};
        return;
      }
      const data = await invoke<Array<{ id: number; nombre: string; codigo: string; sexo: string; dias: Array<{ fecha: string; estado: string | null; observacion: string | null }> }>>("get_asistencia_estudiantes_rango", {
        fechaInicio: fechasBase[0], fechaFin: fechasBase[fechasBase.length - 1],
        gradoId: selectedGrado, seccionId: selectedSeccion, sexo: selectedSexo || null,
      });
      estudiantesMulti = data.map(est => {
        const diasRecord: Record<string, DiaEstado> = {};
        for (const d of est.dias) {
          diasRecord[d.fecha] = { estado: d.estado, observacion: d.observacion };
        }
        const savedDraft = draftMulti[est.id];
        if (savedDraft) {
          for (const fecha of fechasBase) {
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
        for (const f of fechasBase) {
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
    const n = periodoEfectivo === "diario" ? getActiveStudentCount() : estudiantesMulti.length * fechasPeriodo.length;
    if (n === 0) return;
    const etiqueta = estado === 'P' ? 'Presente' : estado === 'A' ? 'Ausente' : 'Justificado';
    const ok = await ask(`¿Marcar a TODOS como "${etiqueta}" (${estado}) para el período actual?\n\nSe aplicará a ${periodoEfectivo === "diario" ? `${getActiveStudentCount()} estudiante(s)` : `${estudiantesMulti.length} estudiante(s) × ${fechasPeriodo.length} día(s)`}.`, {
      title: `Marcar todos: ${etiqueta}`, kind: 'info', okLabel: `Sí, marcar todo`, cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    if (periodoEfectivo === "diario") {
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
    if (periodoEfectivo === "diario") {
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
    emit("show-toast", { message: t('asis.limpiar.aviso'), type: "info" });
  }

  async function handleManualSave() {
    if (!hasUnsavedChanges) return;
    const ok = await ask(t('asis.confirmar.guardar'), {
      title: t('asis.confirmar.guardarTitulo'), kind: 'info',
      okLabel: t('comun.guardar'), cancelLabel: t('comun.cancelar'),
    });
    if (!ok) return;
    if (periodoEfectivo === "diario") {
      saveChanges(estudiantes);
    } else {
      saveChangesMulti();
    }
  }

  async function limpiarAsistencia() {
    if (getActiveStudentCount() === 0) return;
    const ok = await ask(t('asis.limpiar.pedirGuardar'), { title: t('asis.limpiar.confirmarTitulo'), kind: 'warning', okLabel: t('asis.limpiar.confirmar'), cancelLabel: t('comun.cancelar') });
    if (!ok) return;
    confirmClearAllStatus();
  }

  /**
   * `type` es SOLO el título del modal de resumen (no un valor de dominio: no
   * filtra ni viaja a la BD), así que se le pasa la etiqueta ya traducida.
   */
  function handleCardClick(type: string, stats: { total: number; m: number; f: number }) {
    showSummaryModal = { show: true, type, stats };
  }

  function toggleObs(est: EstudianteAsistencia) {
    if (obsModalStudent?.id === est.id) { obsModalStudent = null; expandedObs = {}; }
    else { obsModalStudent = est; expandedObs = { [est.id]: true }; }
  }

  /**
   * Marcado con los tres botones del mouse sobre una celda de la grilla.
   *
   *   izquierdo = Presente · derecho = Ausente · medio = Justificado
   *
   * Volver a apretar el mismo botón borra la marca (toggle).
   *
   * ⚠️ El botón central se atiende en `onmousedown` y NO en `onauxclick`: poner
   * un `auxclick` con la lógica hacía que el mismo gesto disparara DOS veces (una
   * por `mousedown`, otra por `auxclick`) y el toggle se cancelaba solo — la
   * celda no cambiaba nunca. Igual con el derecho: `oncontextmenu` también
   * dispara `mousedown`, así que el `contextmenu` solo cancela el menú nativo.
   *
   * ⚠️ El botón central dispara el "modo desplazamiento" de Windows (el cursor
   * cambia a flecha y arrastrar panea la página). Se frena con
   * `preventDefault()` en `mousedown` + un `onauxclick` que SOLO cancela: el
   * primero evita la activación y el segundo impide que el autoscroll arranque al
   * soltar. NO restrictarlo "para no romper la rueda": la rueda dispara `wheel`,
   * no `mousedown`, así que nunca llega con `button === 1` y el scroll con la
   * rueda sigue funcionando igual.
   */
  function handleMouseEstadoClick(e: MouseEvent, estId: number, fecha: string, boton: number) {
    if (enInforme) return;
    // botón 0 = izquierdo, 1 = medio, 2 = derecho
    const map: Record<number, string | null> = { 0: 'P', 2: 'A', 1: 'J' };
    const nuevo = map[boton];
    if (nuevo === undefined) return;
    e.preventDefault();
    // usar lógica existente de cambio de estado (toggle si repite el mismo botón)
    const est = estudiantesMulti.find(e => e.id === estId);
    if (!est) return;
    const current = est.dias[fecha]?.estado || null;
    const currentDraft = draftMulti[estId]?.[fecha]?.estado;
    const effectiveCurrent = currentDraft !== undefined ? currentDraft : current;
    const newEstado = effectiveCurrent === nuevo ? null : nuevo;
    if (!draftMulti[estId]) draftMulti[estId] = {};
    draftMulti[estId][fecha] = { estado: newEstado, observacion: est.dias[fecha]?.observacion || null };
    syncDraftMultiToStorage();
    estudiantesMulti = estudiantesMulti.map(e => {
      if (e.id !== estId) return e;
      const newDias = { ...e.dias, [fecha]: { ...e.dias[fecha], estado: newEstado } };
      return { ...e, dias: newDias };
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

  /**
   * Etiqueta visible de un estado. El `id` ('P'/'A'/'J') es el valor de dominio
   * que viaja a la BD y NO se traduce; solo la etiqueta.
   */
  function etiquetaEstado(estado: string | null): string {
    if (estado === 'P') return t('asis.estado.presente');
    if (estado === 'A') return t('asis.estado.ausente');
    if (estado === 'J') return t('asis.estado.justificado');
    return '—';
  }

  async function handleFilterChange(setter: (v: any) => void, value: any) {
    // En el informe no se escribe nada: no hay borradores que preguntar por
    // guardar, el filtro simplemente se aplica.
    if (enInforme) { setter(value); return; }
    if (hasUnsavedChanges) {
      const answer = await ask(t('asis.confirmar.sinGuardar'), { title: t('asis.confirmar.sinGuardarTitulo'), kind: 'warning', okLabel: t('comun.guardar'), cancelLabel: t('asis.confirmar.descartar') });
      if (answer) {
        if (periodoEfectivo === "diario") { await saveChanges(estudiantes); } else { await saveChangesMulti(); }
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
    if (periodoEfectivo === "diario") return estudiantes.length;
    return estudiantesMulti.length;
  }

  function getMultiStats(estado: string) {
    let total = 0, m = 0, f = 0;
    for (const est of filteredEstudiantesMulti) {
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

  // ── Informe (solo lectura): rango, encabezados, impresión y exportación ──
  // En "Tomar asistencia" nada de esto se usa; en el informe es lo único que
  // hace falta además de la grilla, que ya es la misma en los dos modos.

  /** Rango real del período visible. El informe corta el mes en curso en hoy. */
  let rangoFechas = $derived.by(() => {
    const fechas = getFechasPeriodo();
    return { inicio: fechas[0] ?? '', fin: fechas[fechas.length - 1] ?? '' };
  });
  let fechaInicio = $derived(rangoFechas.inicio);
  let fechaFin = $derived(rangoFechas.fin);

  let colegioNombre = $derived(colegios.find(c => c.id === selectedColegio)?.nombre || "");
  let gradoNombre = $derived(grados.find(g => g.id === selectedGrado)?.nombre || "");
  let seccionNombre = $derived(secciones.find(s => s.id === selectedSeccion)?.nombre || "");

  /**
 * Meses en texto largo para el encabezado del período y el nombre del archivo.
 *
 * Antes eran una tabla fija en español (`MESES_ES`) y el encabezado quedaba en
 * español aunque la app estuviera en inglés. Ahora salen de `lib/fecha.ts`, que
 * tiene los dos idiomas. Se mantiene la función local porque el reporte lo
 * consume en varios puntos y el nombre no cambia.
 */
  function nombreMesEs(m: number): string { return nombreMes(m, getLocale(), true); }
  /** Fecha en texto largo: "1 de Septiembre" (es) / "September 1" (en). */
  function fechaLarga(iso: string): string {
    return fmtFechaLarga(iso, getLocale()) || iso || '';
  }

  /**
   * Rango del período para los encabezados, entre paréntesis y con el mes en
   * texto: "(01 de Septiembre al 30 de Septiembre)". Se usan las fechas reales
   * del período, así que en el mes en curso termina el día de hoy.
   */
  let encabezadoPeriodo = $derived(`(${fechaLarga(fechaInicio)} al ${fechaLarga(fechaFin)})`);
  /** Etiqueta del período: "Septiembre" (mensual) o "Semana 3 Septiembre" (semanal). */
  let periodoEtiqueta = $derived(
    periodoEfectivo === 'semanal'
      ? `Semana ${semanaActiva} ${nombreMesEs(mesSeleccionado)}`
      : nombreMesEs(mesSeleccionado)
  );
  /** Etiqueta corta del período, para mostrar debajo del botón de exportar. */
  let resumenPeriodo = $derived(
    periodoEfectivo === 'semanal'
      ? t('asis.sinClases.semanaN', { n: semanaActiva })
      : `${mesesOptions.find(m => m.value === mesSeleccionado)?.label ?? ''} ${anoSeleccionado}`
  );

  /** Columnas de fechas para imprimir/exportar: hábiles del período, sin los sin clases. */
  let fechasColumnas = $derived(fechasVisibles.filter(fv => !fv.sinClases).map(fv => fv.fecha));

  /** Nota en español para el PDF/impresión con los días sin clases del período. */
  let diasSinClasesNota = $derived.by(() => {
    const marcadas = diasSinClases.filter(d => d.fecha >= fechaInicio && d.fecha <= fechaFin);
    if (marcadas.length === 0) return '';
    return 'Sin clases: ' + marcadas.map(d => `${fmtDM(d.fecha)} (${d.descripcion})`).join(', ');
  });

  interface ParAsistencia {
    colegioId: number; colegioNombre: string;
    gradoId: number; gradoNombre: string;
    seccionId: number; seccionNombre: string;
  }

  let exportandoMasivo = $state(false);
  let progresoMasivo = $state('');
  let printHtml: string | null = $state(null);

  /** Estado efectivo (borrador incluido) de un estudiante en una fecha. */
  function estadoEnFecha(est: EstudianteMulti, fecha: string): string {
    const dDraft = draftMulti[est.id]?.[fecha];
    const eff = dDraft?.estado !== undefined ? dDraft.estado : (est.dias[fecha]?.estado || null);
    return eff ?? '-';
  }

  function obsEnFecha(est: EstudianteMulti, fecha: string): string {
    const dDraft = draftMulti[est.id]?.[fecha];
    return dDraft?.observacion ?? est.dias[fecha]?.observacion ?? '';
  }

  /** Estado de una fila devuelta por `get_asistencia_rango` (`"fecha:estado"`). */
  function estadoDelReporte(item: AsistenciaReporteItem, fecha: string): string {
    const found = item.fechas.find(f => f.startsWith(fecha));
    return found ? found.split(':')[1] : '-';
  }

  /**
   * Columnas de un período dado, según la config semanal del colegio y
   * excluye los marcados como sin clases (no cuentan P/A/J).
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

  /**
   * Un solo PDF con una hoja por cada grado/seccion de TODOS los colegios del
   * año lectivo seleccionado. El nombre del archivo lleva el período:
   * `Asistencia_Septiembre_2026.pdf` (mensual) o
   * `Asistencia_Semana3_Septiembre_2026.pdf` (semanal).
   *
   * Trae sus propios datos por pareja (colegio, grado, sección) porque el
   * alcance es TODOS los colegios, no el que está filtrado en pantalla.
   */
  async function exportarPdfAsistencia() {
    if (!selectedAno || !fechaInicio || !fechaFin) {
      await emit("show-toast", { message: t('inf.export.sinAno'), type: 'warning' });
      return;
    }

    try {
      exportandoMasivo = true;
      progresoMasivo = t('inf.export.preparando');

      const anoNombre = anos.find(a => a.id === selectedAno)?.nombre || String(selectedAno);
      if (colegios.length === 0) {
        await emit("show-toast", { message: t('inf.export.sinColegios'), type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      const pares: ParAsistencia[] = [];
      for (const col of colegios) {
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
        await emit("show-toast", { message: t('inf.export.sinGrados'), type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      const configCache = new Map<number, ColegioDiasAsistencia | null>();
      const tablas: TablaAsistenciaPdf[] = [];

      for (let i = 0; i < pares.length; i++) {
        const p = pares[i];
        progresoMasivo = t('inf.export.progreso', { p: `${i + 1}/${pares.length}`, s: `${p.gradoNombre} - ${p.seccionNombre}` });

        if (!configCache.has(p.colegioId)) {
          try { configCache.set(p.colegioId, await invoke<ColegioDiasAsistencia>("get_colegio_dias_asistencia", { colegioId: p.colegioId })); }
          catch { configCache.set(p.colegioId, null); }
        }
        const cfg = configCache.get(p.colegioId) || null;
        const sinClases: DiaSinClase[] = await invoke<DiaSinClase[]>("get_dias_sin_clases", {
          colegioId: p.colegioId, gradoId: p.gradoId, seccionId: p.seccionId, fechaInicio, fechaFin,
        }).catch(() => [] as DiaSinClase[]);

        const filas: AsistenciaReporteItem[] = await invoke("get_asistencia_rango", {
          fechaInicio, fechaFin, anoLectivoId: Number(selectedAno),
          colegioId: p.colegioId, gradoId: p.gradoId, seccionId: p.seccionId,
        });
        const conSexo = selectedSexo ? filas.filter(e => e.sexo === selectedSexo) : filas;
        if (conSexo.length === 0) continue;

        const notaSinClases = sinClases
          .filter(d => d.fecha >= fechaInicio && d.fecha <= fechaFin)
          .map(d => `${fmtDM(d.fecha)} (${d.descripcion})`).join(', ');

        const fechasCols = columnasDePeriodo(cfg, sinClases);
        tablas.push({
          titulo: `${p.gradoNombre} - Sección ${p.seccionNombre}`,
          subtitulo: `${p.colegioNombre} · Año lectivo ${anoNombre}`,
          layout: 'fechas',
          // Sin columna "Sexo": el nombre va teñido con el color de sexo. El dato viaja
          // aparte en `sexos` para que el PDF pueda pintar cada fila.
          headers: ["Estudiante", ...fechasCols.map(f => fmtFechaCorta(f, getLocale())), "P", "A", "J"],
          sexos: conSexo.map(est => est.sexo),
          body: conSexo.map(est => {
            const estados = fechasCols.map(f => estadoDelReporte(est, f));
            const cuenta = (e: string) => estados.filter(x => x === e).length;
            return [est.nombre, ...estados, cuenta('P'), cuenta('A'), cuenta('J')];
          }),
          nota: notaSinClases || undefined,
          chip: `Sección: ${p.gradoNombre} - ${p.seccionNombre}`,
        });
      }

      if (tablas.length === 0) {
        await emit("show-toast", { message: t('inf.export.sinEstudiantes'), type: 'warning' });
        exportandoMasivo = false;
        return;
      }

      progresoMasivo = t('inf.export.generandoPdf');
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_');

      const lineas = [`Período ${encabezadoPeriodo}`];
      if (selectedSexo) lineas.push(`Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}`);
      // Fecha de emisión con el formato estándar (`14/Sep/2026`). Un reporte que
      // va a la dirección del colegio tiene que decir cuándo se sackó, y con el
      // mismo formato que el resto de la app, para que no circulen dos formatos
      // distintos por el mismo colegio.
      // circulando en el mismo colegio.
      lineas.push(`${t('pdf.fechaEmision')}: ${fmtFechaNica(new Date(), getLocale())}`);

      const bytes = await generarPdfAsistencia(
        { titulo: 'Reporte de Asistencia', lineas },
        tablas
      );

      // Destino: School Tracker/Asistencias/<Año Lectivo>, SIN subcarpeta de mes.
      // El período va en el NOMBRE del archivo, que es donde se distingue un
      // PDF del otro: crear una carpeta por mes llenaba el año de carpetas de
      // un solo archivo y costaba más encontrar los reportes que verlos juntos.
      const baseDir = await rutaExportAbsoluta('asistencias', anoNombre);
      await mkdir(baseDir, { recursive: true }).catch(e => console.log("mkdir:", e));

      const fileName = `Asistencia ${sanitize(periodoEtiqueta)} ${sanitize(anoNombre)}.pdf`;
      const filePath = unirRuta(baseDir, fileName);
      await writeFile(filePath, bytes);

      exportandoMasivo = false;
      const destino = destinoParaToast(isAndroid, 'asistencias', anoNombre);
      if (isAndroid) {
        const ruta = await invoke<string>('guardar_en_descargas', {
          path: filePath, mime: 'application/pdf',
          carpeta: subcarpetaRelativa('asistencias', anoNombre), nombre: fileName,
        }).catch(() => "");
        if (ruta) {
          try { await invoke('share_pdf', { path: ruta }); } catch { }
          await emit("show-toast", { message: t('inf.export.hojas', { n: tablas.length, destino }), type: 'success' });
        } else {
          await emit("show-toast", { message: t('inf.export.sinDescargas'), type: 'warning' });
        }
      } else {
        await openUrl(aFileURL(baseDir));
        await emit("show-toast", { message: t('inf.export.hojas', { n: tablas.length, destino }), type: 'success' });
      }
    } catch (error) {
      console.error("Error al exportar PDF de asistencia:", error);
      exportandoMasivo = false;
      await emit("show-toast", { message: t('inf.error.pdf', { msg: error instanceof Error ? error.message : String(error) }), type: 'error' });
    }
  }

  /** Vista previa de impresión: una tabla HTML con las mismas filas de la grilla. */
  async function handlePrintWithIframe() {
    if (filteredEstudiantesMulti.length === 0) {
      await emit("show-toast", { message: t('inf.print.sinDatos'), type: 'warning' });
      return;
    }
    try {
      await emit("show-toast", { message: t('inf.print.preparando'), type: 'success' });
      const anoNombrePrint = anos.find(a => a.id === selectedAno)?.nombre || String(selectedAno);
      const fechasCols = fechasColumnas;
      // Sin columna "Sexo": el nombre va teñido con el color de sexo, el mismo que
      // se ve en pantalla. El `!important` del bloque @media print es lo que
      // hace que el color sobreviva al diálogo de impresión del navegador,
      // que por defecto descarta los colores de fondo y de texto.
      const headers = ["Estudiante", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
      const rows = filteredEstudiantesMulti.map(est => {
        const p = fechasCols.filter(f => estadoEnFecha(est, f) === 'P').length;
        const a = fechasCols.filter(f => estadoEnFecha(est, f) === 'A').length;
        const j = fechasCols.filter(f => estadoEnFecha(est, f) === 'J').length;
        return `<tr><td class="nombre" style="color:${colorSexoExport(est.sexo)}">${est.nombre}</td>${fechasCols.map(f => {
          const estado = estadoEnFecha(est, f);
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
        /* El navegador anula el color de texto al imprimir salvo que se pida
           explícitamente; sin esto el nombre del estudiante sale negro. */
        td.nombre{print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}
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
      await emit("show-toast", { message: t('inf.error.reporteGen'), type: 'error' });
    }
  }
</script>


<div class="page-container" style="height:100%;min-height:0">
  {#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder={t('asis.filtro.buscar')} />{/if}
  <style>
    .summary-card{background:rgba(255,255,255,0.02);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:0.5rem 0.25rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60px;min-width:0;transition:all 0.25s cubic-bezier(0.4,0,0.2,1);user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;position:relative;overflow:hidden;cursor:pointer}
    .summary-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,0.12);background:rgba(255,255,255,0.04)}
    .card-accent{position:absolute;top:0;left:0;right:0;height:3px;border-radius:12px 12px 0 0}
    .card-icon{font-size:1rem;margin-bottom:2px;line-height:1}
    .card-value{font-size:1.05rem;font-weight:700;color:#fff;line-height:1.2}
    .card-value.small{font-size:0.9rem}
    .card-label{font-size:0.5rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;font-weight:600}
    .card-gender{display:flex;gap:0.3rem;margin-top:2px;font-size:0.5rem;font-weight:600}
    /* `.gender-m` / `.gender-f` viven en App.css (son globales). Ver el
       comentario de ahí: al estar solo en el scope de esta página, los spans
       de NotasPage no tomaban ningún color. */
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
    /* Separador de semanas en la vista mensual: línea vertical al abrir cada bloque */
    .sep-semana{border-left:2px solid rgba(148,163,184,0.5)!important}
    /* Fila 1 de la cabecera: una celda propia por semana. Fondo un tono más
       oscuro que la de fechas para que la banda de semanas se lea como una
       tira propia y no como otra fila de números. */
    .custom-table thead tr.fila-semanas th{position:sticky;top:0;z-index:11;background:#151d2e!important;
      border-bottom:1px solid rgba(129,140,248,0.28);text-align:center;padding:.25rem .3rem;vertical-align:middle}
    /* Fila 2 (fechas): arranca debajo de la banda de semanas al hacer scroll
       vertical. La altura es fija y coincide con el padding de arriba. */
    .custom-table thead tr.fila-fechas th{position:sticky;top:30px;z-index:10;background:#1e293b!important;
      font-size:0.7rem;white-space:nowrap;text-align:center;min-width:48px;padding:0.35rem 0.45rem}
    /* Las celdas que cruzan las dos filas (#, Estudiante, P/A/J) se quedan arriba. */
    .custom-table thead th.cab-cruce{position:sticky;top:0;z-index:12;background:#1e293b!important;font-size:0.7rem;text-align:center}
    /* Píldora de semana: ahora ocupa toda la celda del bloque, así que puede
      ir bastante más grande. Antes iba apretada dentro de una celda de fecha. */
    .semana-badge{display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;
      letter-spacing:.5px;color:#e0e7ff;background:rgba(99,102,241,0.42);border:1px solid rgba(129,140,248,0.6);
      border-radius:6px;padding:1px 8px;line-height:1.4}
    .semana-rango{display:block;font-size:0.55rem;font-weight:600;color:#64748b;letter-spacing:.2px;
      margin-top:1px;white-space:nowrap}
    /* Semana señalada desde el modal de Sin Clases */
    .custom-table thead th.semana-hl{background:rgba(99,102,241,0.5)!important}
    .semana-hl-ini{border-left:2px solid #818cf8!important}
    .semana-hl-fin{border-right:2px solid #818cf8!important}
    .custom-table thead th{position:sticky;top:0;z-index:10;background:#1e293b!important}
    /* El estado va arriba y la observación abajo, en la misma celda. El popover
       por hover se elimino: aparecia tambien al pasar el cursor por el input de
       observacion (este contenedor lo incluye) y tapaba el texto. El marcado se
       hace con los botones del mouse sobre el recuadro de estado. */
    .celda-estado{display:flex;flex-direction:column;gap:0.15rem}
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
    /* Informe: la observación se LEE, no se edita. Mismo ancho y fuente que el
       input para que la celda no cambie de tamaño entre modos. */
    .semanal-obs.solo-lectura{display:block;white-space:pre-wrap;text-align:left;cursor:default;color:#cbd5e1}
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
    /* Columna de un día marcado como "sin clases".
       El ancho va FIJO en `--ancho-dsc`: antes la celda solo tenía
       `min-width`, y en una tabla con `table-layout:auto` el ancho lo fija el
       contenido más ancho — al escribir un motivo largo la columna se estiraba
       y empujaba todas las demás fuera de la vista.

       El `width` del motivo es lo que realmente ancla la celda: un `max-width`
       en el `<td>` es solo una sugerencia cuando la tabla es de ancho
       automático. Fijarlo en el bloque de texto sí manda. */
    .dsc-col{background:linear-gradient(180deg,rgba(245,158,11,.10),rgba(245,158,11,.02));text-align:center;vertical-align:top;color:#f59e0b;font-weight:700;padding:.45rem .3rem;max-width:calc(var(--ancho-dsc) + .6rem)}
    .dsc-motivo{display:block;width:var(--ancho-dsc);font-size:.62rem;line-height:1.35;margin-top:2px;
      word-break:break-word;overflow-wrap:anywhere;white-space:normal}
  </style>

  {#snippet panelSinClases(soloAviso: boolean)}
    <div
      style={soloAviso
        ? "display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin:0 0 .9rem;padding:.7rem .9rem;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.28);border-radius:12px"
        : "padding:40px;text-align:center;background:rgba(251,191,36,0.08);border-radius:12px;border:1px dashed #fbbf24;color:#fcd34d"}
    >
      <span style="font-size:{soloAviso ? '1.1rem' : '1.6rem'};line-height:1">🚫</span>
      <div style="flex:1;min-width:{soloAviso ? '220px' : '0'}">
        <div style="color:#fde68a;font-weight:700;font-size:{soloAviso ? '.85rem' : '1rem'}">
          {#if soloAviso}
            {t('asis.sinClases.avisoTitulo', { n: diasMarcadosPeriodo.length })}
          {:else}
            {t('asis.sinClases.vacioTitulo')}
          {/if}
          <span style="font-weight:400;color:#94a3b8;font-size:.8rem;margin-left:.4rem">
            ({sinClasesNivelColegio ? t('asis.sinClases.alcanceTodo') : t('asis.sinClases.alcanceSoloSeccion')})
          </span>
        </div>
        {#if motivosPeriodoSinClases.length > 0}
          <div style="color:#fcd34d;font-size:{soloAviso ? '.78rem' : '.9rem'};margin-top:.2rem">
            {#each motivosPeriodoSinClases as motivo, i (motivo)}
              {i > 0 ? ' · ' : ''}{t('asis.sinClases.vacioMotivo', { motivo })}
            {/each}
          </div>
        {:else if !soloAviso}
          <div style="color:#64748b;font-size:.8rem;margin-top:.2rem">{t('asis.sinClases.vacioSinMotivo')}</div>
        {/if}
      </div>
      {#if !enInforme}
        <button class="secondary" onclick={() => desactivarSinClases()}
          style={soloAviso ? 'padding:.35rem .8rem;font-size:.78rem' : 'margin-top:1.25rem;padding:0.5rem 1rem'}>
          ♻️ {t('asis.sinClases.reactivar')}
        </button>
      {/if}
    </div>
  {/snippet}

  <PageLayout>
    {#snippet filters()}
      <FilterContainer {isMobile} style="padding:{isAndroidMobile ? '0.5rem' : '0.4rem'}">
        <div style="display:flex;{isAndroidMobile ? 'flex-wrap:wrap' : 'flex-wrap:nowrap'};gap:0.4rem;width:100%;align-items:flex-end">
          <!-- El modo va PRIMERO porque es lo que define todo lo demás (en informe
               no hay borradores ni marcado). En Android no se renderiza: ahí el
               modo lo lleva la píldora flotante del wrapper. -->
          {#if !isAndroidMobile}
            <FilterGroup label={t('comun.modo')} {isMobile}>
              <ModoToggle
                valor={modo}
                etiquetaGrupo={t('comun.modo')}
                onchange={(id) => onModoChange(id as "tomar" | "informe")}
                opciones={[
                  { id: "tomar", etiqueta: t('subtab.tomarCorto'), titulo: t('subtab.tomarAsistencia') },
                  { id: "informe", etiqueta: t('subtab.informe') },
                ]} />
            </FilterGroup>
          {/if}
          {#if !isAndroidMobile && showAnoDropdown}
            <FilterGroup label={t('asis.filtro.ano')} {isMobile}>
              <SelectChip
                value={selectedAno}
                onchange={(v) => handleFilterChange((n: number) => selectedAno = n, Number(v))}
                options={anos.map(a => ({ value: a.id, label: a.nombre }))} />
            </FilterGroup>
          {/if}
          {#if !isAndroidMobile}
            <FilterGroup label={t('asis.filtro.periodo')} {isMobile}>
              <SelectChip
                value={periodoEfectivo}
                onchange={(v) => { periodo = String(v) as typeof periodo; }}
                options={[
                  ...(!esEscritorio ? [{ value: 'diario', label: t('asis.periodo.diario') }] : []),
                  { value: 'semanal', label: t('asis.periodo.semanal') },
                  { value: 'mensual', label: t('asis.periodo.mensual') },
                ]} />
            </FilterGroup>
          {/if}
          {#if periodoEfectivo === "diario"}
            {#if !isAndroidMobile}
              <FilterGroup label={t('asis.filtro.fecha')} {isMobile}>
                <DatePickerGlass bind:value={selectedFecha} diaHabilitado={esDiaHabilCalendario} />
              </FilterGroup>
            {/if}
          {:else if periodoEfectivo === "semanal"}
            {#if !isAndroidMobile}
              <FilterGroup label={t('asis.periodo.mes')} {isMobile}>
                <SelectChip
                  value={mesSeleccionado}
                  onchange={(v) => elegirMesSemanal(Number(v))}
                  options={mesesOptions.map(m => ({ value: m.value, label: m.label }))} />
              </FilterGroup>
              <FilterGroup label={t('asis.periodo.semanaDe')} {isMobile}>
                <div class="pop-wrap" bind:this={popRootEl} style="min-width:0">
                  <button type="button" class="filter-select pop-trigger" onclick={() => popSemanaAbierta = !popSemanaAbierta} style="min-width:0">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{t('asis.sinClases.semanaN', { n: semanaActiva })} · {semanasOpts.find(s => s.n === semanaActiva)?.rango ?? ''}</span>
                    <span class="pop-caret">▾</span>
                  </button>

                  {#if popSemanaAbierta}
                    <div class="pop-panel" tabindex="-1">
                      <div class="pop-mes">
                        <button class="pop-nav" onclick={() => cambiarMesSem(-1)} title={t('inf.sem.mesAnterior')}>‹</button>
                        <span class="pop-mes-txt">{nombreMesSel} {anoSeleccionado}</span>
                        <button class="pop-nav" onclick={() => cambiarMesSem(1)} title={t('inf.sem.mesSiguiente')}>›</button>
                      </div>

                      <div class="pop-sems">
                        {#each semanasOpts as s (s.n)}
                          <button
                            type="button"
                            class="pop-sem"
                            class:sel={semanaActiva === s.n}
                            onclick={() => elegirSemana(s)}
                          >
                            <span class="pop-sem-n">{t('asis.sinClases.semanaN', { n: s.n })}</span>
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
              <FilterGroup label={t('asis.periodo.mes')} {isMobile}>
                <SelectChip
                  value={mesSeleccionado}
                  onchange={(v) => { mesSeleccionado = Number(v); }}
                  options={mesesOptions.map(m => ({ value: m.value, label: m.label }))} />
              </FilterGroup>
            {/if}
          {/if}
          {#if isAndroidMobile}
            <!--
              Layout Android: mismo control de modo que escritorio (ya no el swipe
              del wrapper), buscador y un riel INLINE de filtros. Se eliminó
              `FiltersModalAndroid` de esta página: los `<select>` abren el popup
              NATIVO del WebView, así que no había motivo para el rodeo modal.
              Orden IGUAL al de escritorio: Año → Período → [fecha/semana/mes] →
              Colegio → Grado → Sección → Sexo.
            -->
            <div style="width:100%">
              <ModoToggle
                grande
                valor={modo}
                etiquetaGrupo={t('comun.modo')}
                onchange={(id) => onModoChange(id as "tomar" | "informe")}
                opciones={[
                  { id: "tomar", etiqueta: t('subtab.tomarCorto'), titulo: t('subtab.tomarAsistencia') },
                  { id: "informe", etiqueta: t('subtab.informe') },
                ]} />
            </div>
            <div style="width:100%;padding:0.3rem 0 0.2rem;">
              <SearchFab bind:value={searchTerm} placeholder={t('asis.filtro.buscar')} conMargen={false} />
            </div>
            <FiltroRail estilo="width:100%;margin-bottom:0.3rem">
              {#if showAnoDropdown}
                <select value={selectedAno} title={t('asis.filtro.ano')}
                  onchange={(e) => handleFilterChange((n: number) => selectedAno = n, Number((e.currentTarget as HTMLSelectElement).value))}>
                  {#each anos as a}<option value={a.id}>{a.nombre}</option>{/each}
                </select>
              {/if}
              <select value={periodoEfectivo} title={t('asis.filtro.periodo')}
                onchange={(e) => periodo = (e.currentTarget as HTMLSelectElement).value as AsistenciaPeriodo}>
                {#if !enInforme}<option value="diario">{t('asis.periodo.diario')}</option>{/if}
                <option value="semanal">{t('asis.periodo.semanal')}</option>
                <option value="mensual">{t('asis.periodo.mensual')}</option>
              </select>
              {#if periodoEfectivo === "diario"}
                <div style="grid-column:1/-1;min-width:0">
                  <DatePickerGlass bind:value={selectedFecha} diaHabilitado={esDiaHabilCalendario} />
                </div>
              {:else if periodoEfectivo === "semanal"}
                <select value={mesSeleccionado} title={t('asis.periodo.mes')}
                  onchange={(e) => elegirMesSemanal(Number((e.currentTarget as HTMLSelectElement).value))}>
                  {#each mesesOptions as m}<option value={m.value}>{m.label}</option>{/each}
                </select>
                <select value={semanaActiva} title={t('asis.periodo.semanaDe')}
                  onchange={(e) => { const s = semanasOpts.find(x => x.n === Number((e.currentTarget as HTMLSelectElement).value)); if (s) elegirSemana(s); }}>
                  {#each semanasOpts as s}<option value={s.n}>{t('asis.sinClases.semanaN', { n: s.n })} · {s.rango}</option>{/each}
                </select>
              {:else}
                <select value={mesSeleccionado} title={t('asis.periodo.mes')}
                  onchange={(e) => { mesSeleccionado = Number((e.currentTarget as HTMLSelectElement).value); }}>
                  {#each mesesOptions as m}<option value={m.value}>{m.label}</option>{/each}
                </select>
              {/if}
              <select value={selectedColegio} title={t('inf.filtro.colegio')}
                onchange={(e) => handleFilterChange((n: number) => selectedColegio = n, Number((e.currentTarget as HTMLSelectElement).value))}>
                {#each colegios as c}<option value={c.id}>{c.nombre}</option>{/each}
              </select>
              <select value={selectedGrado} title={t('inf.filtro.grado')}
                onchange={(e) => handleFilterChange((n: number) => selectedGrado = n, Number((e.currentTarget as HTMLSelectElement).value))}>
                {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
              </select>
              <select value={selectedSeccion} title={t('inf.filtro.seccion')}
                onchange={(e) => handleFilterChange((n: number) => selectedSeccion = n, Number((e.currentTarget as HTMLSelectElement).value))}>
                {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
              </select>
              <select value={selectedSexo} title={t('asis.filtro.sexo')}
                onchange={(e) => handleFilterChange((s: string) => selectedSexo = s, (e.currentTarget as HTMLSelectElement).value)}>
                <option value="">{t('asis.filtro.todos')}</option>
                <option value="M">{t('asis.filtros.masculino')}</option>
                <option value="F">{t('asis.filtros.femenino')}</option>
              </select>
            </FiltroRail>
          {:else}
            <FilterGroup label={t('inf.filtro.colegio')} {isMobile}>
              <SelectChip
                value={selectedColegio}
                onchange={(v) => handleFilterChange((n: number) => selectedColegio = n, Number(v))}
                options={colegios.map(c => ({ value: c.id, label: c.nombre }))} />
            </FilterGroup>
            <FilterGroup label={t('inf.filtro.grado')} {isMobile}>
              <SelectChip
                value={selectedGrado}
                onchange={(v) => handleFilterChange((n: number) => selectedGrado = n, Number(v))}
                options={grados.map(g => ({ value: g.id, label: g.nombre }))} />
            </FilterGroup>
            <FilterGroup label={t('inf.filtro.seccion')} {isMobile}>
              <SelectChip
                value={selectedSeccion}
                onchange={(v) => handleFilterChange((n: number) => selectedSeccion = n, Number(v))}
                options={secciones.map(s => ({ value: s.id, label: s.nombre }))} />
            </FilterGroup>
            <FilterGroup label={t('asis.filtro.sexo')} {isMobile}>
              <SelectChip
                value={selectedSexo}
                onchange={(v) => handleFilterChange((s: string) => selectedSexo = s, String(v))}
                options={[
                  { value: '', label: t('asis.filtro.todos') },
                  { value: 'M', label: t('asis.filtros.masculino') },
                  { value: 'F', label: t('asis.filtros.femenino') },
                ]} />
            </FilterGroup>
          {/if}
          {#if enInforme}
            <!-- Informe: las acciones son de LECTURA (imprimir / exportar). En
                 Tomar asistencia la misma tira lleva Sin Clases, Limpiar,
                 Rellenar y Guardar; un solo componente para no mantener dos
                 barras de acciones iguales. -->
            <!-- Misma regla que `.android-actions` de tomar asistencia: en escritorio la
         fila cede espacio (flex-shrink:1 + min-width:0) para que su
         flex-wrap:wrap pueda bajar Imprimir/PDF a la siguiente línea en vez de
         salirse por la derecha. Los botones NO encogen (flex-shrink:0 +
         white-space:nowrap en .btn-mod): bajan enteros. -->
            <div style="display:flex;gap:0.3rem;align-items:stretch;{isAndroidMobile ? 'width:100%;flex-shrink:0;flex-wrap:wrap' : 'flex-shrink:1;min-width:0;flex-wrap:wrap;padding-right:0.3rem'}">
              {#if !isAndroidMobile}
                <button onclick={handlePrintWithIframe} disabled={filteredEstudiantesMulti.length === 0 || loading}
                  style="height:42px;padding:0 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;flex-shrink:0;gap:6px;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:{filteredEstudiantesMulti.length === 0 || loading ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(16,185,129,0.4);letter-spacing:0.3px;white-space:nowrap;opacity:{filteredEstudiantesMulti.length === 0 || loading ? 0.7 : 1}"
                  title={isMobile ? t('inf.btn.compartirReporte') : t('inf.btn.imprimirReporte')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                  {t('inf.btn.imprimir')}
                </button>
              {/if}
              <button onclick={exportarPdfAsistencia} disabled={exportandoMasivo || !selectedAno}
                title={t('inf.btn.exportarTitle')}
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
                    <span>{exportandoMasivo ? progresoMasivo : t('inf.btn.exportarTodo')}</span>
                    <span style="font-size:0.6rem;font-weight:600;color:#a5b4fc;letter-spacing:0.2px;max-width:150px;overflow:hidden;text-overflow:ellipsis">{exportandoMasivo ? t('inf.btn.generandoPdf') : resumenPeriodo}</span>
                  </span>
                {/if}
              </button>
            </div>
          {:else}
          <!-- Android: rejilla de 3 columnas (mismo patrón que el `BtnRail` de
               NotasPage), no una fila con scroll lateral. El control de fecha/
               semana/mes vive en el `FiltroRail` de arriba —es un filtro, igual
               que en escritorio—, así que acá NO se repite. -->
          <div class="android-actions" class:acc-grid={isAndroidMobile}
            style="{isAndroidMobile
              ? 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;width:100%;flex-shrink:0;align-items:stretch;'
              : 'display:flex;gap:0.3rem;align-items:stretch;flex-shrink:1;min-width:0;flex-wrap:wrap;padding-right:0.3rem;overflow-x:visible'}">
          {#if isAndroidMobile}
            <!-- Guardar va SIEMPRE en Android (diario, semanal y mensual): antes solo
                 se renderizaba en diario, así que en semanal/mensual el borrador de
                 `draftMulti` no tenía forma de persistirse desde el teléfono. -->
            <BotonMod opts={optsGuardar} />
          {/if}
          <!-- `flex:0 0 auto` a propósito: el chip NO debe encogerse, debe BAJAR
               entero a la siguiente línea cuando la fila se queda sin ancho. El
               que cede espacio es `.android-actions` (flex-shrink:1), que es lo
               que permite que su flex-wrap:wrap interno entre en acción. Si este
               div encogera, el `.btn-mod` de adentro (white-space:nowrap) se
               desbordaría hacia afuera en vez de bajar. -->
          <div class="pop-wrap" bind:this={popSinClasesEl} style="flex:0 0 auto;">
            <BotonMod opts={{
              onclick: handleSinClasesClick,
              disabled: sinClasesGuardando || !selectedSeccion,
              icono: sinClasesActivo ? '🏫' : '🚫',
              etiqueta: t('asis.sinClases.chip'),
              tono: sinClasesActivo ? 'ambar' : 'pizarra',
              sub: sinClasesActivo ? t('asis.sinClases.todoPeriodo') : (periodoEfectivo === 'mensual' ? t('asis.sinClases.elegirSemana') : periodoEfectivo === 'semanal' ? t('asis.sinClases.semanaN', { n: semanaActiva }) : fmtDM(selectedFecha)),
              title: periodoEfectivo === 'mensual' ? t('asis.sinClases.descSemana') : t('asis.sinClases.descPeriodo'),
              compacto: isAndroidMobile,
            }} />
          </div>
          {#if popSinClasesAbierta}
            <div use:portalToBody class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) cerrarPopSinClases(); }}
              style="z-index:2000;{isAndroidMobile ? '' : 'background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;align-items:center;justify-content:center;padding-top:14vh;'}">
              <div bind:this={popModalSinClasesEl} class="pop-panel" tabindex="-1"
                style="position:relative;top:auto;left:auto;right:auto;bottom:auto;width:{modalCardWidth};max-width:{modalCardWidth};max-height:85vh;overflow-y:auto;{isAndroidMobile ? '' : 'box-shadow:0 25px 60px -12px rgba(0,0,0,0.7);'}">
                <button type="button" onclick={cerrarPopSinClases} title={t('comun.cerrar')} style="position:absolute;top:.6rem;right:.6rem;width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#cbd5e1;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
                <div class="pop-mes"><span class="pop-mes-txt">{colFechaObjetivo ? t('asis.sinClases.marcarFecha', { fecha: fmtDM(colFechaObjetivo) }) : periodoEfectivo === 'mensual' ? t('asis.sinClases.tituloSemana') : t('asis.sinClases.motivo')}</span></div>
                {#if colFechaObjetivo}
                  <div style="font-size:.65rem;color:#94a3b8;margin:-.3rem 0 .5rem">{t('asis.ausencia.soloEstaFecha')}</div>
                {:else if periodoEfectivo === 'mensual'}
                  <div style="font-size:.65rem;color:#94a3b8;margin:-.3rem 0 .4rem">{t('asis.ausencia.hintSemana')}</div>
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
                        <span class="pop-sem-n">{t('asis.sinClases.semanaN', { n: s.numero })}</span>
                        <span class="pop-sem-rango">{rangoSemana(s)}{todas ? ' · 🚫' : ''}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
                <input class="obs-inline" placeholder={t('asis.sinClases.phMotivo')}
                  bind:value={sinClasesDescripcion}
                  onkeydown={(e) => { if (e.key === 'Enter' && sinClasesDescripcion.trim()) activarSinClases(false); }} />
                <div style="display:flex;flex-direction:column;gap:3px;margin-top:.55rem">
                  {#if periodoEfectivo === 'mensual' && semanaSeleccionada && semanaSinClasesTotal(semanasMes.find(w => w.numero === semanaSeleccionada)!)}
                    <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #10b981" disabled={sinClasesGuardando}
                      onclick={() => { const s = semanasMes.find(w => w.numero === semanaSeleccionada); if (s) { cerrarPopSinClases(); desactivarSinClases(s.fechas); } }}>
                      ♻️ {t('asis.sinClases.reactivarSemana', { n: semanaSeleccionada })}
                    </button>
                    <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #10b981" disabled={sinClasesGuardando}
                      onclick={desactivarSinClasesTodosColegios}>
                      ♻️ {t('asis.sinClases.reactivarTodos')}
                    </button>
                  {:else if periodoEfectivo !== 'mensual' && sinClasesActivo}
                    <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #10b981" disabled={sinClasesGuardando}
                      onclick={desactivarSinClasesTodosColegios}>
                      ♻️ {t('asis.sinClases.reactivarTodos')}
                    </button>
                  {/if}
                  <!-- Los tres alcances llevan color propio y escalan con el
                       tamaño de lo que tocan: la sección es la más suave y la que
                       abarca todos los colegios la más llamativa, que es justo el
                       aviso de "esto toca todo". -->
                  <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #f472b6;background:linear-gradient(135deg,rgba(244,114,182,.20),rgba(236,113,182,.10));color:#fbcfe8" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando || faltaElegirSemana}
                    onclick={() => activarSinClases(false)}
                    title={t('asis.sinClases.tituloSeccion', { seccion: secciones.find(s => s.id === selectedSeccion)?.nombre || t('asis.limpiar.alcanceSeccion'), grado: grados.find(g => g.id === selectedGrado)?.nombre || t('asis.limpiar.alcanceGrado') })}>
                    {t('asis.sinClases.marcarSeccion')}
                  </button>
                  <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #34d399;background:linear-gradient(135deg,rgba(52,211,153,.20),rgba(16,185,129,.10));color:#a7f3d0" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando || faltaElegirSemana}
                    onclick={() => activarSinClases(true)}
                    title={t('asis.sinClases.tituloColegio', { colegio: colegios.find(c => c.id === selectedColegio)?.nombre || t('asis.limpiar.alcanceColegio') })}>
                    {t('asis.sinClases.marcarColegio')}
                  </button>
                  <button type="button" class="pop-sem" style="justify-content:center;border-radius:10px;border-left:2px solid #fbbf24;background:linear-gradient(135deg,rgba(251,191,36,.22),rgba(245,158,11,.10));color:#fde68a" disabled={!sinClasesDescripcion.trim() || sinClasesGuardando || faltaElegirSemana}
                    onclick={activarSinClasesTodosColegios}
                    title={t('asis.sinClases.tituloTodos', { n: colegios.length })}>
                    {t('asis.sinClases.marcarTodos')}
                  </button>
                </div>
              </div>
            </div>
          {/if}
          {#if esEscritorio}
            <BotonMod bind:ref={popLimpiarBtnEl} opts={{
              onclick: () => { if (popLimpiarBtnEl) togglePopSel(popLimpiarBtnEl, 'limpiar'); },
              disabled: getActiveStudentCount() === 0 || !hayLimpables,
              icono: popSel?.modo === 'limpiar' ? '✕' : '🧹', etiqueta: t('asis.btn.limpiar'), tono: 'pizarra',
              sub: !hayLimpables ? t('asis.limpiar.mensual') : t('asis.limpiar.marcadas', { n: totalMarcadasPeriodo }),
              title: t('asis.limpiar.diarioDesc'),
              compacto: false,
            }} />
          {:else}
            <BotonMod opts={{
              onclick: limpiarAsistencia,
              disabled: getActiveStudentCount() === 0,
              icono: '🧹', etiqueta: t('asis.btn.limpiar'), tono: 'pizarra',
              sub: getActiveStudentCount() === 0 ? t('asis.limpiar.mensual') : t('asis.limpiar.conEstado', { n: getActiveStudentCount() }),
              title: t('asis.limpiar.diario'),
              compacto: isAndroidMobile,
            }} />
          {/if}
          <BotonMod bind:ref={popSelBtnEl} opts={{
            onclick: () => { if (popSelBtnEl) togglePopSel(popSelBtnEl, 'rellenar'); },
            disabled: getActiveStudentCount() === 0 || (esEscritorio && !hayPendientes),
            icono: popSel ? '✕' : '👥',
            etiqueta: esEscritorio ? t('asis.btn.rellenar') : t('asis.masivo.marcarTodos'),
            tono: 'violeta',
            sub: esEscritorio
              ? (!hayPendientes ? t('asis.masivo.completo') : t('asis.rellenar.sinMarcar', { n: totalPendientes }))
              : t('asis.rellenar.estudiantes', { n: getActiveStudentCount() }),
            title: esEscritorio ? t('asis.masivo.todosDesc') : t('asis.masivo.todos'),
            compacto: isAndroidMobile,
          }} />
          {#if !isAndroidMobile}
            <BotonMod opts={optsGuardar} />
          {/if}
          {#if !isAndroidMobile}
          <div style="flex:1;min-width:100px">
          </div>
          {/if}
          </div>
          {/if}
        </div>
      </FilterContainer>
    {/snippet}

    {#if periodoEfectivo === "diario"}
      {#if isAndroidMobile && filteredEstudiantes.length > 0}
        <div style="margin-top:0;margin-left:-0.4rem;margin-right:-0.4rem;padding:0.5rem 0.4rem 0.2rem;width:calc(100%+0.8rem);border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:0.5rem;align-items:stretch">
          <div style="display:flex;align-items:center;justify-content:center;gap:0.8rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.6rem;flex:0 0 auto">
            <div style="display:flex;align-items:center;gap:2px"><span style="color:{colorSexo('F')};font-weight:bold;font-size:0.8rem">F:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{totalF}</span></div>
            <div style="display:flex;align-items:center;gap:2px"><span style="color:{colorSexo('M')};font-weight:bold;font-size:0.8rem">M:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{totalM}</span></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-around;gap:0.3rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.3rem;flex:1;user-select:none">
            <div onclick={() => handleCardClick(t('asis.stats.total'), { total: totalEstudiantes, m: totalM, f: totalF })} style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#06b6d4;font-weight:bold;font-size:0.8rem">E:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{totalEstudiantes}</span>
            </div>
            <div onclick={() => handleCardClick(t('asis.stats.presentes'), statsP)}
              style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#10b981;font-weight:bold;font-size:0.8rem">P:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsP.total}</span>
            </div>
            <div onclick={() => handleCardClick(t('asis.stats.ausentes'), statsA)}
              style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#ef4444;font-weight:bold;font-size:0.8rem">A:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsA.total}</span>
            </div>
            <div onclick={() => handleCardClick(t('asis.stats.justificados'), statsJ)}
              style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#f59e0b;font-weight:bold;font-size:0.8rem">J:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{statsJ.total}</span>
            </div>
          </div>
        </div>
      {/if}

      {#if !isAndroidMobile && filteredEstudiantes.length > 0}
        <div class="asist-summary-grid-mob" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0.4rem;margin:0.5rem 0;padding:0;width:100%;max-width:100%">
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.total'), { total: totalEstudiantes, m: totalM, f: totalF })}>
            <div class="card-accent" style="background:#06b6d4"></div>
            <span class="card-icon">📋</span>
            <span class="card-value">{totalEstudiantes}</span>
            <span class="card-label">{t('asis.stats.total')}</span>
            <div class="card-gender"><span class="gender-m">M:{totalM}</span><span class="gender-f">F:{totalF}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.presentes'), statsP)}>
            <div class="card-accent" style="background:#10b981"></div>
            <span class="card-icon">✅</span>
            <span class="card-value">{statsP.total}</span>
            <span class="card-label">{t('asis.stats.presentes')}</span>
            <div class="card-gender"><span class="gender-m">M:{statsP.m}</span><span class="gender-f">F:{statsP.f}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.ausentes'), statsA)}>
            <div class="card-accent" style="background:#ef4444"></div>
            <span class="card-icon">❌</span>
            <span class="card-value">{statsA.total}</span>
            <span class="card-label">{t('asis.stats.ausentes')}</span>
            <div class="card-gender"><span class="gender-m">M:{statsA.m}</span><span class="gender-f">F:{statsA.f}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.justificados'), statsJ)}>
            <div class="card-accent" style="background:#f59e0b"></div>
            <span class="card-icon">⚠️</span>
            <span class="card-value">{statsJ.total}</span>
            <span class="card-label">{t('asis.stats.justificados')}</span>
            <div class="card-gender"><span class="gender-m">M:{statsJ.m}</span><span class="gender-f">F:{statsJ.f}</span></div>
          </div>
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.asistencia'), { total: asistenciaPct, m: 0, f: 0 })}>
            <div class="card-accent" style="background:#8b5cf6"></div>
            <span class="card-icon">📊</span>
            <span class="pct-value" style="color:{asistenciaPct >= 90 ? '#10b981' : asistenciaPct >= 70 ? '#f59e0b' : '#ef4444'}">{asistenciaPct}%</span>
            <span class="card-label">{t('asis.stats.asistencia')}</span>
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:{asistenciaPct}%;background:{asistenciaPct >= 90 ? '#10b981' : asistenciaPct >= 70 ? '#f59e0b' : '#ef4444'}"></div></div>
          </div>
        </div>
      {/if}

      <ScrollableTable>
        {#if loading}
          <div class="loading-state">{t('asis.cargando')}</div>
        {:else if !isFechaHabilitada && periodoEfectivo === 'diario' && esDiaSinClases(selectedFecha)}
          {@const cov = coberturaSinClases(selectedFecha)}
          <div class="dsc-banner">
            <div class="dsc-icon">🚫</div>
            <div style="flex:1;min-width:0;text-align:left">
              <h3 style="margin:0 0 .25rem;color:#fbbf24;font-size:1.05rem">{t('asis.noClasesHoy')}</h3>
              <p style="margin:0;color:#e2e8f0;font-size:.88rem;font-weight:600">{cov?.descripcion || t('asis.sinClases.marcado')}</p>
              <p style="margin:.25rem 0 0;color:#94a3b8;font-size:.75rem;text-transform:capitalize">{fmtFecha(selectedFecha, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <span class="dsc-badge">{cov?.grado_id === null ? t('asis.sinClases.badgeTodo') : t('asis.sinClases.badgeSeccion')}</span>
          </div>
        {:else if !isFechaHabilitada}
          <div style="padding:40px;text-align:center;background:rgba(239,68,68,0.1);border-radius:12px;border:1px dashed #ef4444;color:#ef4444">
            <h3>{t('asis.diaNoLaborable')}</h3>
            <p>{t('asis.diaNoLaborableDesc')} <strong>{fmtFecha(selectedFecha, { weekday: 'long' })}</strong>.</p>
          </div>
        {:else if filteredEstudiantes.length === 0}
          <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px;margin:0 1rem">
            <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📋'}</div>
            <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? t('asis.vacio.titulo') : t('asis.vacio.tituloAlt')}</h4>
            <p style="color:#94a3b8;max-width:400px;margin:0 auto">{searchTerm ? t('asis.vacio.busqueda', { q: searchTerm }) : t('asis.vacio.desc')}</p>
            {#if searchTerm}<button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">{t('asis.limpiarBusqueda')}</button>{/if}
          </div>
        {:else if isAndroidMobile}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each filteredEstudiantes as est, index (est.id)}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:{colorSexo(est.sexo)}" onclick={() => selectedStudentDetail = est}>{est.nombre}</span>
                </div>
                <div style="display:flex;gap:0.4rem;margin-bottom:0.3rem">
                  <!-- Sin <input type=radio>: el label reenvía un clic sintético al
                       input oculto que burbujeaba y disparaba el toggle dos veces -->
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'P' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'P' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'P' ? '#10b981' : '#94a3b8'}" onclick={() => handleEstadoChange(est.id, 'P')}>
                    <span>{t('asis.estado.presente')}</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'A' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'A' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'A' ? '#ef4444' : '#94a3b8'}" onclick={() => handleEstadoChange(est.id, 'A')}>
                    <span>{t('asis.estado.ausente')}</span>
                  </label>
                  <label style="flex:1;height:36px;font-size:0.78rem;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-weight:700;background:{est.estado === 'J' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'};border:{est.estado === 'J' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)'};color:{est.estado === 'J' ? '#f59e0b' : '#94a3b8'}" onclick={() => handleEstadoChange(est.id, 'J')}>
                    <span>{t('asis.estado.justificado')}</span>
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
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">{t('asis.col.estudiante')}</th>
              <th style="width:310px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">{t('asis.col.asistencia')}</th>
              <th style="width:140px;text-align:left;position:sticky;top:0;background:#1e293b;z-index:10">{t('asis.col.observacion')}</th>
              <th style="width:60px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10">{t('asis.col.porcentajeMes')}</th>
            </tr></thead>
            <tbody>
              {#each filteredEstudiantes as est, index (est.id)}
                {@const pct = monthlyPcts[est.id] ?? -1}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left">
                    <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:8px;color:{colorSexo(est.sexo)}" onclick={() => selectedStudentDetail = est}>
                      <span style="white-space:nowrap">{est.nombre}</span>
                    </div>
                  </td>
                  <td style="text-align:center">
                    <div style="display:flex;gap:6px;justify-content:center">
                      <label class="asistencia-btn" class:p={est.estado === 'P'} onclick={() => handleEstadoChange(est.id, 'P')}>{t('asis.estado.presente')}</label>
                      <label class="asistencia-btn" class:a={est.estado === 'A'} onclick={() => handleEstadoChange(est.id, 'A')}>{t('asis.estado.ausente')}</label>
                      <label class="asistencia-btn" class:j={est.estado === 'J'} onclick={() => handleEstadoChange(est.id, 'J')}>{t('asis.estado.justificado')}</label>
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
            <div style="display:flex;align-items:center;gap:2px"><span style="color:{colorSexo('F')};font-weight:bold;font-size:0.8rem">F:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{filteredEstudiantesMulti.filter(e => e.sexo === 'F').length}</span></div>
            <div style="display:flex;align-items:center;gap:2px"><span style="color:{colorSexo('M')};font-weight:bold;font-size:0.8rem">M:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{filteredEstudiantesMulti.filter(e => e.sexo === 'M').length}</span></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-around;gap:0.3rem;background:rgba(255,255,255,0.05);border-radius:8px;padding:0 0.3rem;flex:1;user-select:none">
            <div onclick={() => handleCardClick(t('asis.stats.total'), { total: filteredEstudiantesMulti.length, m: filteredEstudiantesMulti.filter(e => e.sexo === 'M').length, f: filteredEstudiantesMulti.filter(e => e.sexo === 'F').length })} style="display:flex;align-items:center;gap:2px;cursor:pointer">
              <span style="color:#06b6d4;font-weight:bold;font-size:0.8rem">E:</span><span style="color:#fff;font-weight:bold;font-size:0.9rem">{filteredEstudiantesMulti.length}</span>
            </div>
            {#each ['P', 'A', 'J'] as estado}
              {@const st = getMultiStats(estado)}
              <div onclick={() => handleCardClick(estado === 'P' ? t('asis.stats.presentes') : estado === 'A' ? t('asis.stats.ausentes') : t('asis.stats.justificados'), st)}
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
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.total'), { total: filteredEstudiantesMulti.length, m: totalMM, f: totalFM })}>
            <div class="card-accent" style="background:#06b6d4"></div>
            <span class="card-icon">📋</span>
            <span class="card-value">{filteredEstudiantesMulti.length}</span>
            <span class="card-label">{t('asis.estudiantes')}</span>
            <div class="card-gender"><span class="gender-m">M:{totalMM}</span><span class="gender-f">F:{totalFM}</span></div>
          </div>
          {#each ['P', 'A', 'J'] as estado}
            {@const st = getMultiStats(estado)}
            <div class="summary-card" onclick={() => handleCardClick(estado === 'P' ? t('asis.stats.presentes') : estado === 'A' ? t('asis.stats.ausentes') : t('asis.stats.justificados'), st)}
              style="cursor:pointer;user-select:none">
              <div class="card-accent" style="background:{estado === 'P' ? '#10b981' : estado === 'A' ? '#ef4444' : '#f59e0b'}"></div>
              <span class="card-icon">{estado === 'P' ? '✅' : estado === 'A' ? '❌' : '⚠️'}</span>
              <span class="card-value">{st.total}</span>
              <span class="card-label">{estado === 'P' ? t('asis.stats.presentes') : estado === 'A' ? t('asis.stats.ausentes') : t('asis.stats.justificados')}</span>
              <div class="card-gender"><span class="gender-m">M:{st.m}</span><span class="gender-f">F:{st.f}</span></div>
            </div>
          {/each}
          <div class="summary-card" onclick={() => handleCardClick(t('asis.stats.asistencia'), { total: pctMulti, m: 0, f: 0 })}>
            <div class="card-accent" style="background:#8b5cf6"></div>
            <span class="card-icon">📊</span>
            <span class="pct-value" style="color:{pctMulti >= 90 ? '#10b981' : pctMulti >= 70 ? '#f59e0b' : '#ef4444'}">{pctMulti}%</span>
            <span class="card-label">{t('asis.stats.asistencia')}</span>
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:{pctMulti}%;background:{pctMulti >= 90 ? '#10b981' : pctMulti >= 70 ? '#f59e0b' : '#ef4444'}"></div></div>
          </div>
        </div>
      {/if}

      <ScrollableTable>
        {#if loading}
          <div class="loading-state">{t('asis.cargando')}</div>
        {:else}
          {#if periodoTieneMarcas}
            {@render panelSinClases(true)}
          {/if}
          {#if filteredEstudiantesMulti.length === 0}
            <div style="text-align:center;padding:5rem 2rem;border:2px dashed rgba(255,255,255,0.1);border-radius:16px;margin:0 1rem">
              <div style="font-size:3rem;margin-bottom:1rem">{searchTerm ? '🔍' : '📋'}</div>
              <h4 style="color:#cbd5e1;margin-bottom:0.5rem">{searchTerm ? t('asis.vacio.titulo') : t('asis.vacio.tituloAlt')}</h4>
              <p style="color:#94a3b8;max-width:400px;margin:0 auto">{searchTerm ? t('asis.vacio.busqueda', { q: searchTerm }) : t('asis.vacio.desc')}</p>
              {#if searchTerm}<button class="secondary" onclick={() => searchTerm = ""} style="margin-top:1.5rem;padding:0.5rem 1rem">{t('asis.limpiarBusqueda')}</button>{/if}
            </div>
          {:else if isAndroidMobile && periodoEfectivo === "semanal"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each filteredEstudiantesMulti as est, index (est.id)}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:{colorSexo(est.sexo)}">{est.nombre}</span>
                </div>
                <div style="display:flex;gap:0.4rem;overflow-x:auto;padding-bottom:0.2rem">
                  {#each fechasPeriodo as fecha}
                    {@const dayName = fmtFecha(fecha, { weekday: 'short' }).replace('.','')}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;min-width:68px">
                      <span style="font-size:0.55rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.2px;white-space:nowrap">{dayName}</span>
                      <div class="semanal-status" style="font-size:0.6rem;padding:0.15rem 0.3rem;{enInforme ? 'cursor:default' : ''}" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                        onmousedown={(e) => handleMouseEstadoClick(e, est.id, fecha, e.button)}
                        onauxclick={(e) => e.preventDefault()}
                        oncontextmenu={(e) => e.preventDefault()}>
                        {effectiveEstado === 'P' ? 'Pres' : effectiveEstado === 'A' ? 'Aus' : effectiveEstado === 'J' ? 'Just' : '—'}
                      </div>
                      {#if enInforme}
                        <div class="semanal-obs solo-lectura" style="font-size:0.5rem">{obsEnFecha(est, fecha)}</div>
                      {:else}
                        <input type="text" placeholder="..." class="semanal-obs" style="width:100%;padding:0.1rem 0.25rem;font-size:0.5rem"
                          value={getObsMulti(est.id, fecha)}
                          oninput={(e) => handleObservacionChangeMulti(est.id, fecha, (e.target as HTMLInputElement).value)} />
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if isAndroidMobile && periodoEfectivo === "mensual"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.4rem 0">
            {#each filteredEstudiantesMulti as est, index (est.id)}
              <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:0.5rem 0.6rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem">
                  <span style="font-size:0.7rem;color:#64748b;font-weight:bold;min-width:20px">{index + 1}</span>
                  <span style="flex:1;font-weight:bold;font-size:0.85rem;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:{colorSexo(est.sexo)}">{est.nombre}</span>
                </div>
                <div class="mensual-chip-row">
                  {#each fechasPeriodo as fecha}
                    {@const d = est.dias[fecha]}
                    {@const draftD = draftMulti[est.id]?.[fecha]}
                    {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                    <div class="mensual-chip" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                      onmousedown={(e) => handleMouseEstadoClick(e, est.id, fecha, e.button)}
                      oncontextmenu={(e) => e.preventDefault()}
                      style={enInforme ? 'cursor:default' : ''}
                      title="D-izq: P | D-der: A | D-centro: J (tocar de nuevo para limpiar)">
                      {new Date(fecha + "T12:00:00").getDate()}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if periodoEfectivo === "semanal"}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible;--ancho-dsc:96px">
            <thead><tr>
              <th style="width:30px;position:sticky;top:0;background:#1e293b;z-index:10">#</th>
              <th style="text-align:left;position:sticky;top:0;background:#1e293b;z-index:10;min-width:200px">{t('asis.col.estudiante')}</th>
              {#each fechasVisibles as fv (fv.fecha)}
                <th class:dsc-th={fv.sinClases} class:fch-th={!enInforme}
                  style="min-width:105px;text-align:center;position:sticky;top:0;background:#1e293b;z-index:10;font-size:0.7rem;font-weight:600;padding:0.3rem 0.15rem"
                  title={enInforme ? (fv.sinClases ? motivoSinClasesEn(fv.fecha) : '') : (fv.sinClases ? `${motivoSinClasesEn(fv.fecha)} — Click para reactivar clases` : 'Click para marcar este día sin clases')}
                  onclick={enInforme ? undefined : () => clickHeaderFecha(fv.fecha)}>
                  {fv.sinClases ? '🚫 ' : ''}{fmtFecha(fv.fecha, { weekday: 'short', day: 'numeric' }).replace('.','').replace(',','')}
                </th>
              {/each}
            </tr></thead>
            <tbody>
              {#each filteredEstudiantesMulti as est, index (est.id)}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left">
                    <span style="font-weight:bold;font-size:0.85rem;cursor:pointer;white-space:normal;word-break:break-word;line-height:1.25;color:{colorSexo(est.sexo)}" onclick={() => selectedStudentDetail = est as any}>{est.nombre}</span>
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
                        {#if enInforme}
                          <div class="semanal-status" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                            style="cursor:default"
                            title={effectiveEstado ? etiquetaEstado(effectiveEstado) : t('inf.tabla.sinRegistro')}>
                            {etiquetaEstado(effectiveEstado)}
                          </div>
                          {#if obsEnFecha(est, fv.fecha)}
                            <div class="semanal-obs solo-lectura" title={t('inf.tabla.observacion', { x: obsEnFecha(est, fv.fecha) })}>{obsEnFecha(est, fv.fecha)}</div>
                          {/if}
                        {:else if esEscritorio}
                          <div class="celda-estado">
                            <div class="semanal-status" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                              onmousedown={(e) => handleMouseEstadoClick(e, est.id, fv.fecha, e.button)}
                              onauxclick={(e) => e.preventDefault()}
                              oncontextmenu={(e) => e.preventDefault()}
                              title="D-izq: P | D-der: A | D-centro: J (tocar de nuevo para limpiar)">
                              {etiquetaEstado(effectiveEstado)}
                            </div>
                            <input type="text" placeholder="Obs..." class="semanal-obs"
                              value={getObsMulti(est.id, fv.fecha)}
                              oninput={(e) => handleObservacionChangeMulti(est.id, fv.fecha, (e.target as HTMLInputElement).value)} />
                          </div>
                        {:else}
                        <div class="semanal-status" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                          onmousedown={(e) => handleMouseEstadoClick(e, est.id, fv.fecha, e.button)}
                          oncontextmenu={(e) => e.preventDefault()}
                          title="D-izq: P | D-der: A | D-centro: J (tocar de nuevo para limpiar)">
                          {etiquetaEstado(effectiveEstado)}
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
        {:else if periodoEfectivo === "mensual"}
          <table class="custom-table" style="width:100%;margin:0;overflow:visible;--ancho-dsc:96px">
            <thead>
              <!-- Fila 1: la SEMANA. Cada bloque del mes tiene su propia celda
                   (colspan = nº de columnas del bloque), así la píldora S1..Sn
                   ocupa todo el ancho de su semana en vez de encogerse dentro de
                   una celda de fecha. Antes "S1" no se veía nunca: la fila
                   arrancaba en el día hábil del colegio y el bloque 1 del mes
                   casi nunca contiene ese día. -->
              <tr class="fila-semanas">
                <th class="cab-cruce" rowspan="2" style="width:30px">#</th>
                <th class="cab-cruce" rowspan="2" style="text-align:left;min-width:200px">{t('asis.col.estudiante')}</th>
                {#each semanasMes as s (s.numero)}
                  <th colspan={s.fechas.length} class:sep-semana={esPrimeraColumnaDeSemana(s.fechas[0])}
                    class:semana-hl={semanaHover !== null && semanaHover === s.numero}
                    title={`Semana ${s.numero} · ${rangoSemana(s)}${semanaSinClasesTotal(s) ? ' · 🚫 sin clases' : ''}`}>
                    <div class="semana-badge">S{s.numero}</div>
                    <div class="semana-rango">{rangoSemana(s)}</div>
                  </th>
                {/each}
                <th class="cab-cruce" rowspan="2" style="width:{isAndroidMobile ? '24px' : '30px'}">P</th>
                <th class="cab-cruce" rowspan="2" style="width:{isAndroidMobile ? '24px' : '30px'}">A</th>
                <th class="cab-cruce" rowspan="2" style="width:{isAndroidMobile ? '24px' : '30px'}">J</th>
              </tr>
              <tr class="fila-fechas">
                {#each fechasVisibles as fv, iFecha (fv.fecha)}
                  <th class:dsc-th={fv.sinClases} class:fch-th={!enInforme} class:sep-semana={esPrimeraColumnaDeSemana(fv.fecha)}
                    class:semana-hl={semanaHover !== null && numeroSemanaDe(fv.fecha) === semanaHover}
                    class:semana-hl-ini={semanaHoverRango?.ini === fv.fecha}
                    class:semana-hl-fin={semanaHoverRango?.fin === fv.fecha}
                    title={enInforme
                      ? `${fv.sinClases ? motivoSinClasesEn(fv.fecha) : ''}${numeroSemanaDe(fv.fecha) ? `${fv.sinClases ? ' · ' : ''}Semana ${numeroSemanaDe(fv.fecha)}` : ''}`
                      : `${fv.sinClases ? motivoSinClasesEn(fv.fecha) + ' — Click para reactivar clases' : 'Click para marcar este día sin clases'}${numeroSemanaDe(fv.fecha) ? ` · Semana ${numeroSemanaDe(fv.fecha)}` : ''}`}
                    onclick={enInforme ? undefined : () => clickHeaderFecha(fv.fecha)}>
                    <div style="font-size:0.6rem;opacity:0.7">{fv.sinClases ? '🚫 ' : ''}{fmtFecha(fv.fecha, { weekday: 'short' })}</div>
                    {fv.fecha.split('-').slice(1).reverse().join('/')}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each filteredEstudiantesMulti as est, index (est.id)}
                {@const p = countMultiEstados(est.id, 'P')}
                {@const a = countMultiEstados(est.id, 'A')}
                {@const j = countMultiEstados(est.id, 'J')}
                <tr>
                  <td><span class="student-number-badge">{index + 1}</span></td>
                  <td style="text-align:left;overflow:hidden">
                    <div style="font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:6px;width:100%;color:{colorSexo(est.sexo)}" onclick={() => selectedStudentDetail = est as any}>
                      <span style="white-space:normal;word-break:break-word;line-height:1.25">{est.nombre}</span>
                    </div>
                  </td>
                  {#each fechasVisibles as fv, iFecha (fv.fecha)}
                    {#if fv.sinClases}
                      {#if index === 0}
                        <td class="dsc-col" rowspan={filteredEstudiantesMulti.length}>
                          <span style="font-size:0.9rem">🚫</span>
                          <span class="dsc-motivo" style="font-size:.55rem">{motivoSinClasesEn(fv.fecha)}</span>
                        </td>
                      {/if}
                    {:else}
                      {@const d = est.dias[fv.fecha]}
                      {@const draftD = draftMulti[est.id]?.[fv.fecha]}
                      {@const effectiveEstado = draftD?.estado !== undefined ? draftD.estado : (d?.estado || null)}
                        <td class:sep-semana={esPrimeraColumnaDeSemana(fv.fecha)}
                          class:semana-hl-ini={semanaHoverRango?.ini === fv.fecha}
                          class:semana-hl-fin={semanaHoverRango?.fin === fv.fecha}
                          style="text-align:center;padding:0.15rem">
                          {#if enInforme}
                            <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                              style="cursor:default"
                              title={fmtFecha(fv.fecha, { day: 'numeric', month: 'short' }) + ': ' + etiquetaEstado(effectiveEstado)}>
                              {effectiveEstado ?? '-'}
                            </div>
                          {:else if esEscritorio}
                            <div class="celda-estado">

                            <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                              onmousedown={(e) => handleMouseEstadoClick(e, est.id, fv.fecha, e.button)}
                              onauxclick={(e) => e.preventDefault()}
                              oncontextmenu={(e) => e.preventDefault()}
                              title="D-izq: P | D-der: A | D-centro: J (tocar de nuevo para limpiar)">
                              {effectiveEstado ?? '-'}
                            </div>
                          </div>
                        {:else}
                          <div class="ciclo-cell" class:estado-p={effectiveEstado === 'P'} class:estado-a={effectiveEstado === 'A'} class:estado-j={effectiveEstado === 'J'}
                            onmousedown={(e) => handleMouseEstadoClick(e, est.id, fv.fecha, e.button)}
                            oncontextmenu={(e) => e.preventDefault()}
                            title="D-izq: P | D-der: A | D-centro: J (tocar de nuevo para limpiar)">
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
          {/if}
      </ScrollableTable>
    {/if}
  </PageLayout>

  {#if popSel}
    <div
      bind:this={popSelPanelEl}
      use:portalToBody
      role="menu"
      aria-label="Marcar asistencias masivamente"
      style="position:fixed; z-index:99995; left:{popSel.x}px; top:{popSel.y}px; bottom:{popSel.abajo}; width:{ANCHO_POP_MASIVOS}px; max-height:min(420px, calc(100vh - 32px)); overflow-y:auto; background:rgba(20,24,31,0.97); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.1); border-radius:14px; box-shadow:0 18px 40px -10px rgba(0,0,0,0.65); padding:0.4rem; box-sizing:border-box; display:flex; flex-direction:column; gap:3px;"
    >
      {#if !esEscritorio}
        <!-- Android trabaja con período DIARIO: no hay semana ni mes que elegir,
             así que va el marcado directo de todo el día (el que usa `marcarTodos`
             y deja el cambio en el borrador, para revisarlo antes de Guardar). -->
        {#each ESTADOS_PAJ as e (e.id)}
          {@const sub = e.id === 'P' ? 'Marcar presentes' : e.id === 'A' ? 'Marcar ausentes' : 'Marcar justificados'}
          <button
            role="menuitem"
            disabled={getActiveStudentCount() === 0 || masivosGuardando}
            onclick={() => { const est = e.id; cerrarPopSel(); marcarTodos(est); }}
            title={`${sub} · el día completo`}
            style="width:100%; display:flex; align-items:center; gap:0.55rem; padding:0.5rem 0.55rem; border-radius:9px; border:1px solid {e.borde}; background:{e.suave}; color:{e.color}; cursor:pointer; text-align:left; transition:all 0.15s ease; opacity:{getActiveStudentCount() === 0 ? 0.45 : 1};"
            onmouseenter={(ev) => { ev.currentTarget.style.background = e.suave.replace('0.10', '0.2'); }}
            onmouseleave={(ev) => { ev.currentTarget.style.background = e.suave; }}
          >
            <span style="font-size:0.9rem;">{e.id === 'P' ? '✅' : e.id === 'A' ? '❌' : '📝'}</span>
            <span style="flex:1; min-width:0;">
              <span style="display:block; font-weight:700; font-size:0.76rem;">Marcar {e.label}</span>
              <span style="display:block; font-size:0.62rem; color:#94a3b8;">{sub} · el día completo</span>
            </span>
          </button>
        {/each}
      {:else if popSel.paso === 'estado'}
        {#each ESTADOS_PAJ as e (e.id)}
          {@const sub = e.id === 'P' ? 'Marcar presentes' : e.id === 'A' ? 'Marcar ausentes' : 'Marcar justificados'}
          <button
            role="menuitem"
            disabled={!hayPendientes || masivosGuardando}
            onclick={() => pasoFechas(e.id)}
            title={`${sub} · después elegís los días`}
            style="width:100%; display:flex; align-items:center; gap:0.55rem; padding:0.5rem 0.55rem; border-radius:9px; border:1px solid {e.borde}; background:{e.suave}; color:{e.color}; cursor:pointer; text-align:left; transition:all 0.15s ease; opacity:{!hayPendientes ? 0.45 : 1};"
            onmouseenter={(ev) => { ev.currentTarget.style.background = e.suave.replace('0.10', '0.2'); }}
            onmouseleave={(ev) => { ev.currentTarget.style.background = e.suave; }}
          >
            <span style="font-size:0.9rem;">{e.id === 'P' ? '✅' : e.id === 'A' ? '❌' : '📝'}</span>
            <span style="flex:1; min-width:0;">
              <span style="display:block; font-weight:700; font-size:0.76rem;">Marcar {e.label}</span>
              <span style="display:block; font-size:0.62rem; color:#94a3b8;">{sub} · elegí los días</span>
            </span>
          </button>
        {/each}
        {#if !hayPendientes}
          <div style="padding:0.5rem 0.4rem 0.2rem; font-size:0.66rem; color:#94a3b8; text-align:center; line-height:1.35;">
            Ya están marcadas todas las asistencias del período.
          </div>
        {/if}
      {:else}
        <!-- Llega acá con `esEscritorio` y `paso === 'fechas'`: en Rellenar ya se eligió
             estado, en Limpiar entra directo. `fechasSel` / `acento` se capturan acá
             porque TypeScript pierde el estrechamiento de `popSel` dentro de los
             `{#each}` anidados. "Limpiar" no tiene estado: usa un acento neutro. -->
        {@const esLimpiar = popSel.modo === 'limpiar'}
        {@const fechasSel = popSel.fechas}
        {@const estadoSel = popSel.estado}
        {@const acento = esLimpiar
          ? { id: '🧹', borde: 'rgba(203,213,225,0.35)', suave: 'rgba(203,213,225,0.10)', color: '#e2e8f0' }
          : ESTADOS_PAJ.find(x => x.id === estadoSel)!}
        <!-- Encabezado: en Rellenar se puede volver a elegir el estado; en Limpiar
             solo muestra qué se está limpiando. -->
        <div style="display:flex; align-items:center; gap:0.4rem; padding:0.25rem 0.3rem 0.45rem; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:0.25rem;">
          {#if !esLimpiar}
            <button type="button" onclick={volverAEstado} title="Elegir otro estado"
              style="flex-shrink:0; display:flex; align-items:center; gap:0.3rem; padding:0.25rem 0.4rem; border-radius:7px; border:1px solid {acento.borde}; background:{acento.suave}; color:{acento.color}; font-size:0.68rem; font-weight:700; cursor:pointer; font-family:inherit;">
              ‹ {acento.id}
            </button>
          {:else}
            <span style="flex-shrink:0; padding:0.25rem 0.4rem; border-radius:7px; border:1px solid {acento.borde}; background:{acento.suave}; color:{acento.color}; font-size:0.68rem; font-weight:700;">🧹</span>
          {/if}
          <span style="flex:1; min-width:0; font-size:0.68rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{esLimpiar ? '¿Qué días limpiar?' : '¿Qué días marcar?'}</span>
          <button type="button" onclick={elegirTodasLasFechas} title="Seleccionar todos los días con pendientes"
            style="flex-shrink:0; padding:0.2rem 0.35rem; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#cbd5e1; font-size:0.62rem; font-weight:600; cursor:pointer; font-family:inherit;">{t('asis.filtros.todas')}</button>
          <button type="button" onclick={elegirNinguna} title="Quitar la selección"
            style="flex-shrink:0; padding:0.2rem 0.35rem; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#cbd5e1; font-size:0.62rem; font-weight:600; cursor:pointer; font-family:inherit;">{t('asis.filtros.ninguna')}</button>
        </div>

        <!-- Días, agrupados por semana como las columnas de la tabla -->
        {#each gruposSemanaSel as g (g.numero)}
          {#if gruposSemanaSel.length > 1}
            <div style="padding:0.4rem 0.5rem 0.15rem; font-size:0.58rem; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#64748b;">Semana {g.numero}</div>
          {/if}
          {#each g.fechas as f (f)}
            {@const n = celdasObjetivo(f)}
            {@const accionable = diaAccionable(f)}
            {@const sel = fechasSel.has(f)}
            <button
              role="menuitemcheckbox"
              aria-checked={sel}
              disabled={!accionable || masivosGuardando}
              onclick={() => alternarFecha(f)}
              title={!accionable ? `Nada que ${esLimpiar ? 'limpiar' : 'marcar'} este día` : `${esLimpiar ? 'Vaciar' : 'Marcar'} ${n} asistencia(s) el ${fmtDM(f)}`}
              style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.4rem 0.5rem; border-radius:8px; border:1px solid {sel ? acento.borde : 'transparent'}; background:{sel ? acento.suave : 'transparent'}; color:{!accionable ? '#475569' : sel ? acento.color : '#cbd5e1'}; font-size:0.74rem; font-weight:{sel ? 700 : 500}; cursor:{!accionable ? 'not-allowed' : 'pointer'}; text-align:left; transition:all 0.15s ease; opacity:{!accionable ? 0.5 : 1};"
              onmouseenter={(ev) => { if (accionable && !sel) ev.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onmouseleave={(ev) => { if (accionable && !sel) ev.currentTarget.style.background = 'transparent'; }}
            >
              <span style="display:flex; align-items:center; gap:0.4rem; min-width:0;">
                <span style="width:14px; flex-shrink:0; text-align:center; color:{sel ? acento.color : '#475569'};">{sel ? '✓' : '○'}</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{fmtDM(f)}</span>
              </span>
              <span style="flex-shrink:0; font-size:0.62rem; color:{!accionable ? '#475569' : '#94a3b8'};">{resumenCelda(f)}</span>
            </button>
          {/each}
        {/each}

        <div style="display:flex; align-items:center; gap:0.45rem; padding:0.5rem 0.35rem 0.15rem; margin-top:0.25rem; border-top:1px solid rgba(255,255,255,0.08);">
          <span style="flex:1; min-width:0; font-size:0.66rem; color:#94a3b8; line-height:1.3;">
            {#if totalAMarcar === 0}
              Elegí al menos un día
            {:else}
              Se van a {esLimpiar ? 'vaciar' : 'marcar'} <strong style="color:{acento.color}">{totalAMarcar}</strong> asistencia(s) y guardar
            {/if}
          </span>
          <button
            type="button"
            disabled={totalAMarcar === 0 || masivosGuardando}
            onclick={esLimpiar ? aplicarLimpiar : aplicarMasivos}
            title={esLimpiar ? 'Vaciar las celdas marcadas de los días elegidos y borrarlas de la base' : 'Rellenar las vacías de los días elegidos y guardar en la base'}
            style="flex-shrink:0; padding:0.45rem 0.7rem; border-radius:9px; border:1px solid {acento.borde}; background:{totalAMarcar === 0 ? 'rgba(255,255,255,0.04)' : `linear-gradient(135deg, ${acento.color}, ${acento.color}dd)`}; color:{totalAMarcar === 0 ? '#475569' : '#0b1220'}; font-size:0.72rem; font-weight:800; cursor:{totalAMarcar === 0 ? 'not-allowed' : 'pointer'}; font-family:inherit; transition:all 0.15s ease; white-space:nowrap;">
            {masivosGuardando ? '⏳ Guardando' : (esLimpiar ? 'Limpiar y guardar' : 'Marcar y guardar')}
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if showSummaryModal.show}
    <div class="modal-overlay" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }}>
      <div class="modal-content category-card" style="width:300px;max-width:85%;padding:1.2rem;text-align:center" onclick={(e) => e.stopPropagation()}>
        <h3 style="margin-top:0;color:var(--primary-color);font-size:1.2rem;margin-bottom:1rem">📊 {showSummaryModal.type}</h3>
        <div style="display:flex;flex-direction:column;gap:0.8rem">
          <div style="background:rgba(255,255,255,0.05);padding:0.8rem;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="color:#94a3b8">{t('asis.filtros.total')}</span><span style="font-size:1.3rem;font-weight:bold;color:#fff">{showSummaryModal.stats?.total}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem">
            <div style="background:{colorSexoAlfa('M', '1a')};padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:2px">
              <span style="color:{colorSexo('M')};font-size:0.8rem">{t('asis.filtros.masculino')}</span><span style="font-size:1.2rem;font-weight:bold;color:{colorSexo('M')}">{showSummaryModal.stats?.m}</span>
            </div>
            <div style="background:{colorSexoAlfa('F', '1a')};padding:0.8rem;border-radius:10px;display:flex;flex-direction:column;gap:2px">
              <span style="color:{colorSexo('F')};font-size:0.8rem">{t('asis.filtros.femenino')}</span><span style="font-size:1.2rem;font-weight:bold;color:{colorSexo('F')}">{showSummaryModal.stats?.f}</span>
            </div>
          </div>
        </div>
        <button class="primary" onclick={() => showSummaryModal = { ...showSummaryModal, show: false }} style="margin-top:1.5rem;width:100%">{t('comun.cerrar')}</button>
      </div>
    </div>
  {/if}

  {#if selectedStudentDetail}
    <div class="modal-overlay" onclick={() => selectedStudentDetail = null}>
      <div class="modal-content category-card" onclick={(e) => e.stopPropagation()} style="width:400px;max-width:90%;padding:1.5rem;text-align:center;display:flex;flex-direction:column;gap:1rem">
        <div style="width:60px;height:60px;border-radius:50%;background-color:var(--primary-light);color:var(--primary-color);display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin:0 auto">👤</div>
        <div>
          <h3 style="margin:0.5rem 0;color:#fff;font-size:1.2rem">{selectedStudentDetail.nombre}</h3>
          <div style="display:inline-block;padding:0.3rem 0.8rem;border-radius:20px;background:{colorSexoAlfa(selectedStudentDetail.sexo, '1a')};color:{colorSexo(selectedStudentDetail.sexo)};font-size:0.85rem;font-weight:600;margin-top:0.3rem">{selectedStudentDetail.sexo === 'M' ? t('asis.filtros.masculino') : t('asis.filtros.femenino')}</div>
        </div>
        <button class="primary" onclick={() => selectedStudentDetail = null} style="margin-top:1rem;width:100%">{t('comun.cerrar')}</button>
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
          <button class="primary" onclick={() => obsModalStudent = null} style="flex:1">{t('asis.btn.listo')}</button>
          {#if obsModalStudent.observacion}
            <button onclick={() => { handleObservacionChange(obsModalStudent!.id, ''); obsModalStudent = null; }}
              style="background:rgba(239,68,68,0.2);border:1px solid #ef4444;border-radius:6px;padding:0.5rem 1rem;color:#ef4444;cursor:pointer">🗑️</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if printHtml}
    <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;padding:20px"
      onpointerdown={(e) => { if (e.target === e.currentTarget) printHtml = null; }}>
      <div style="background-color:white;border-radius:12px;width:100%;max-width:900px;height:90vh;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:15px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background-color:#f8fafc">
          <span style="font-size:16px;font-weight:600;color:#1e293b">{t('inf.print.titulo')}</span>
          <div style="display:flex;gap:10px">
            <button onclick={() => { const iframe = document.querySelector('iframe[srcdoc]'); if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) iframe.contentWindow.print(); }}
              style="padding:8px 16px;background-color:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">{t('inf.print.imprimir')}</button>
            <button onclick={() => printHtml = null} style="padding:8px 16px;background-color:#64748b;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">{t('comun.cerrar')}</button>
          </div>
        </div>
        <iframe srcdoc={printHtml} style="flex:1;width:100%;border:none" title="Print Preview" />
      </div>
    </div>
  {/if}
</div>

<style>
  /* Android: Sin Clases + Limpiar + Rellenar + Guardar en una REJILLA de 3
     columnas (mismo patrón que el `BtnRail` de NotasPage), no una fila con
     scroll lateral. En escritorio la fila sigue siendo un flex que envuelve y
     cede ancho. */
  .android-actions{scrollbar-width:none;-ms-overflow-style:none;}
  .android-actions::-webkit-scrollbar{display:none;width:0;height:0;}
  /* Rejilla Android. Se replica acá —en vez de reusar <BtnRail>— porque esta
     fila comparte markup con escritorio y lleva el `pop-wrap` de Sin Clases con
     su popover portalado. `:global` porque `.btn-mod` es el nodo raíz de
     `BotonMod` y no lleva el hash de scope de esta página. */
  .android-actions.acc-grid :global(.btn-mod){ width:100%; min-width:0; }
  .android-actions.acc-grid :global(.btn-mod .txt){ min-width:0; overflow:hidden; }
  .android-actions.acc-grid :global(.btn-mod .txt > span:first-child){ max-width:100%; overflow:hidden; text-overflow:ellipsis; }
  .android-actions.acc-grid :global(.btn-mod .sub){ max-width:100%; overflow:hidden; text-overflow:ellipsis; }
  /* `pop-wrap` trae width:100% (pensado para filtros verticales); como ítem de
     rejilla se estira a la columna, así que solo se evita que desborde. */
  .android-actions .pop-wrap{min-width:0;}
</style>
