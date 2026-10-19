import { carpetaInstrumento, subcarpetaInstrumento, abrirInstrumentoExportado, XLSX_MIME } from './instrumentosEntrega';
import { crearLibro, agregarHoja, escribirPortada, escribirCabecera, escribirFila, escribirLibroEnCarpeta, nombreHojaSeguro, BORDE_NEGRO, argb } from './excel';
import type { InstrumentoColores, PlantillaDefinicion, PlantillaGrid, TokenDatos } from './instrumentoPlantilla';
import { resolverTokens, columnasCualitativo, leyendaEscalaConfig, colorDeCelda } from './instrumentoPlantilla';

/**
 * Exportación de instrumentos a .xlsx.
 *
 * Las plantillas se crean EXCLUSIVAMENTE con el constructor visual y viven en
 * la BD (`instrumento_plantilla`). Este módulo solo EXPORTA la cuadrícula ya
 * definida; el motor legado de plantillas .xlsx con marcadores
 * (`{{FILAS}}`, `{LETRA_1}`…) se eliminó junto con la carpeta Plantillas.
 */

export interface ExcelInstrumentoCriterio {
  orden: number;
  descripcion: string;
  puntajeMaximo: number;
}

export interface ExcelInstrumentoEstudiante {
  nombre: string;
  sexo?: string;
  letras: (string | '')[]; // una letra por criterio
  valoracion: string;
  total?: string;
  nf?: string;
  /** Total Criterio {TC_k}: pts por criterio, mismo orden ('' sin nota). */
  tcs?: string[];
}

export interface ExcelInstrumentoInput {
  meta: {
    colegio: string;
    ano: string;
    corte: string;
    asignatura: string;
    grado: string;
    seccion: string;
  };
  indicadorOrden: number;
  indicadorDescripcion: string;
  criterios: ExcelInstrumentoCriterio[];
  estudiantes: ExcelInstrumentoEstudiante[];
  /** Contexto CUALITATIVO (grado/asignatura): sin AI en la escala. */
  cualitativo?: boolean;
  /** Colores del sistema (notas por sigla + fuente por sexo). */
  colores?: InstrumentoColores;
}


// ============================================================================
// Generador XLSX desde plantilla de la BD (constructor visual)
// ============================================================================

/** Contexto de tokens de cabecera (sin estudiante) desde el input de datos. */
function tokenDatosCabecera(input: ExcelInstrumentoInput): TokenDatos {
  const m = input.meta as unknown as Record<string, string>;
  return {
    metaSel: {
      COLEGIO: m.colegio, GRADO: m.grado, SECCION: m.seccion,
      ASIGNATURA: m.asignatura, CORTE: m.corte, ANO: m.ano,
    },
    indN: input.indicadorOrden,
    indDesc: input.indicadorDescripcion ?? '',
    criterios: input.criterios.map(c => c.descripcion),
  };
}

/**
 * Renderiza la CUADRÍCULA tipo Excel (definición con `grid`) tal cual: merges
 * nativos de ExcelJS, fila de estudiantes expandida por cada alumno y tokens
 * reemplazados con los datos reales del indicador.
 */
/** TokenDatos con los datos de UN estudiante (misma forma que el render). */
function datosConEstudiante(base: TokenDatos, est: ExcelInstrumentoEstudiante, idx: number): TokenDatos {
  return {
    ...base,
    est: {
      n: idx + 1,
      nombre: est.nombre,
      letras: est.letras.map(l => l ?? ''),
      valoracion: est.valoracion || '',
      total: est.total || '',
      nf: est.nf || '',
      tcs: est.tcs || [],
    },
  };
}

/** Página: tamaño Carta, márgenes estrechos y todo ajustado a UNA hoja (1×1). */
function configurarPagina(ws: any, orientacion: 'portrait' | 'landscape'): void {
  ws.pageSetup = {
    paperSize: 1, // 1 = Carta (8.5" × 11")
    orientation: orientacion,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 },
  };
}

/** Línea del encabezado estándar del XLSX (una fila a lo ancho de la cuadrícula). */
function lineaEncabezadoXlsx(ws: any, fila: number, nCols: number, rgb: string, texto: string, size: number): void {
  if (nCols > 1) try { ws.mergeCells(fila, 1, fila, Math.max(2, nCols)); } catch { /* ya fusionada */ }
  const c = ws.getCell(fila, 1);
  c.value = texto;
  c.font = { bold: true, size, color: { argb: rgb } };
  c.alignment = { horizontal: 'left', vertical: 'middle' };
}

function renderGridXlsx(wb: any, grid: PlantillaGrid, def: PlantillaDefinicion, input: ExcelInstrumentoInput, nombreHoja?: string, usados?: Set<string>): any {
  const sinAI = !!input.cualitativo;
  const datos: TokenDatos = { ...tokenDatosCabecera(input), sinAI };

  // Contexto cualitativo → columnas {AI} y {TOTAL} SE ELIMINAN (no aplican en
  // ese régimen). Las TC pasan a ser la franja separadora entre criterios.
  const { quitar, separador: sepOld } = columnasCualitativo(grid, sinAI);
  const kept: number[] = [];
  for (let c = 0; c < grid.cols; c++) if (!quitar.has(c)) kept.push(c);
  const newIdx = new Map<number, number>(); // col vieja → índice de salida
  kept.forEach((oc, i) => newIdx.set(oc, i));
  // Columnas de salida que son FRANJA separadora (las TC en cualitativo).
  const sepOut = new Set<number>();
  for (const c of sepOld) { const i = newIdx.get(c); if (i !== undefined) sepOut.add(i); }

  // Cobertura de merges en coordenadas VIEJAS.
  const cov = new Map<string, [number, number]>();
  for (const [k, cel] of Object.entries(grid.celdas)) {
    const [r, c] = k.split(':').map(Number);
    for (let rr = r; rr < Math.min(r + (cel.rs ?? 1), grid.filas); rr++)
      for (let cc = c; cc < Math.min(c + (cel.cs ?? 1), grid.cols); cc++)
        if (rr !== r || cc !== c) cov.set(`${rr}:${cc}`, [r, c]);
  }

  // Escribirá por CELDA (origen), no por columna: con columnas colapsadas la
  // posición de salida y el colspan de cada merge se recalculan al vuelo.
  const celdasPorFila = new Map<number, { c0: number; cs: number; rs: number; v: string }[]>();
  for (const [k, cel] of Object.entries(grid.celdas)) {
    const [r, c0] = k.split(':').map(Number);
    // Saltar celdas cubiertas por un merge de otra celda.
    if (cov.has(`${r}:${c0}`)) continue;
    const cs = Math.min(cel.cs ?? 1, grid.cols - c0);
    // Columnas de salida que abarca: filtra las {AI} eliminadas.
    const span: number[] = [];
    for (let cc = c0; cc < c0 + cs; cc++) if (!quitar.has(cc)) span.push(cc);
    if (span.length === 0) continue; // la celda entera era un {AI}
    const lista = celdasPorFila.get(r) ?? [];
    lista.push({
      c0: newIdx.get(span[0])!,
      cs: span.length,
      rs: cel.rs ?? 1,
      v: cel.v ?? '',
    });
    celdasPorFila.set(r, lista);
  }

  // Ancho de columna: texto resuelto. Las celdas de la fila de ESTUDIANTES se
  // miden con los datos REALES de cada alumno; si no, {ESTUDIANTE} y {TOTAL}
  // resolvían a "" → columnas del nombre y Total fijas y angostas, los nombres
  // se envolvían y las filas se estiraban de alto sin control.
  const conFilaEst = grid.filaEstudiantes >= 0;
  const estudiantes = conFilaEst ? input.estudiantes : [];
  const datosEst = estudiantes.map((e, i) => datosConEstudiante(datos, e, i));
  const anchos: number[] = [];
  for (let ci = 0; ci < kept.length; ci++) {
    // Franja separadora (TC en cualitativo): ancho fino, sin contenido.
    if (sepOut.has(ci)) { anchos.push(4); continue; }
    let mx = 4;
    for (const [r, celditas] of celdasPorFila) {
      const esEst = r === grid.filaEstudiantes;
      for (const cel of celditas) {
        // La celda enfrenta esta columna si su rango la incluye.
        if (ci < cel.c0 || ci >= cel.c0 + cel.cs) continue;
        if (cel.rs > 1) continue; // se distribuye en varias filas: poco indicativo
        let largo = resolverTokens(cel.v, datos).length;
        if (esEst) for (const d of datosEst) largo = Math.max(largo, resolverTokens(cel.v, d).length);
        // El nombre del estudiante puede ser largo: se le da más margen.
        const cap = (cel.v || '').trim() === '{ESTUDIANTE}' ? 46 : 34;
        mx = Math.max(mx, Math.min(largo / cel.cs + 3, cap));
      }
    }
    anchos.push(Math.round(mx));
  }
  const nombre = nombreHojaSeguro(nombreHoja ?? `Ind ${input.indicadorOrden}`, usados);
  const ws = agregarHoja(wb, nombre, anchos);

  // ── Encabezado ESTÁNDAR (convención informe/reporte): 4 filas antes de la
  // cuadrícula. La cuadrícula del preset ya no trae tokens de cabecera.
  const mEnc = input.meta as unknown as Record<string, string>;
  const lineasEncabezado: { texto: string; estilo: 'titulo' | 'meta' | 'corte' | 'indicador' }[] = [
    { texto: 'Instrumento de Evaluación', estilo: 'titulo' },
    { texto: `Colegio: ${mEnc.colegio || ''} · Grado-Sección: ${mEnc.grado || ''}-${mEnc.seccion || ''} · Asignatura: ${mEnc.asignatura || ''} · Año: ${mEnc.ano || ''}`, estilo: 'meta' },
    { texto: `Corte evaluativo: ${mEnc.corte || ''}`, estilo: 'corte' },
    { texto: `Indicador ${input.indicadorOrden}: ${input.indicadorDescripcion || ''}`, estilo: 'indicador' },
  ];
  const mapEstiloARgb: Record<string, string> = {
    titulo: 'FF065F46', meta: 'FF374151', corte: 'FF5B21B6', indicador: 'FF1E3A8A',
  };
  for (const linea of lineasEncabezado) {
    lineaEncabezadoXlsx(ws, (lineasEncabezado.indexOf(linea)) + 1, kept.length, mapEstiloARgb[linea.estilo], linea.texto, linea.estilo === 'titulo' ? 12 : 9);
  }
  let outRow = lineasEncabezado.length; // 0-based: la cuadrícula empieza debajo

  for (let r = 0; r < grid.filas; r++) {
    const esEstudiante = r === grid.filaEstudiantes;
    const veces = esEstudiante ? estudiantes.length : 1;
    if (veces === 0) continue; // fila de estudiante sin alumnos
    for (let vi = 0; vi < veces; vi++) {
      const est = esEstudiante
        ? (estudiantes as ExcelInstrumentoInput['estudiantes'])[vi]
        : undefined;
      const dEst: TokenDatos = est ? datosConEstudiante(datos, est, vi) : datos;
      outRow += 1; // fila de salida (1-based)
      for (const cel of celdasPorFila.get(r) ?? []) {
        const rr1 = outRow, cc1 = cel.c0 + 1;
        const celda = ws.getCell(rr1, cc1);
        const esSep = sepOut.has(cel.c0);
        const valor = esSep ? '' : resolverTokens(cel.v, dEst);
        celda.value = valor;
        if (esSep) {
          // Franja separadora entre criterios (donde estaba el TC).
          celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
          celda.font = { size: 9, color: { argb: 'FF0F172A' } };
        } else if (esEstudiante) {
          // Convención de colores del sistema: nombre por sexo, sigla de nota
          // por su color configurado. Sin color → tinta oscura.
          const col = colorDeCelda(cel.v, valor, input.colores, est?.sexo);
          celda.font = { size: 9, color: { argb: argb(col || '1E293B') } };
        } else {
          celda.font = { bold: true, size: 9, color: { argb: 'FF0F172A' } };
        }
        const esNombre = (cel.v || '').trim() === '{ESTUDIANTE}';
        celda.alignment = { horizontal: esNombre ? 'left' : 'center', vertical: 'middle', wrapText: true };
        celda.border = BORDE_NEGRO;
        const rs = esEstudiante ? 1 : cel.rs;
        if (cel.cs > 1 || rs > 1) ws.mergeCells(rr1, cc1, rr1 + rs - 1, cc1 + cel.cs - 1);
        // Bordes del rango fusionado (mergeCells resetea estilos internos en ExcelJS).
        ws.getCell(rr1 + rs - 1, cc1).border = BORDE_NEGRO;
        ws.getCell(rr1, cc1 + cel.cs - 1).border = BORDE_NEGRO;
        ws.getCell(rr1 + rs - 1, cc1 + cel.cs - 1).border = BORDE_NEGRO;
      }
      // Alto FIJO y pequeño en las filas de estudiantes: sin esto Excel
      // auto-ajusta al texto envuelto y las filas quedaban altísimas.
      if (esEstudiante) ws.getRow(outRow).height = 16;
    }
  }

  // Leyenda de la escala: la personalizada o la de la CONFIGURACIÓN real
  // (Globales → Calificaciones). La cuadrícula siempre tiene columnas de escala.
  const leyenda = (def.leyenda || '').trim() || leyendaEscalaConfig(input.colores?.escala, sinAI);
  if (leyenda) {
    outRow += 1;
    ws.mergeCells(outRow, 1, outRow, kept.length);
    const c = ws.getCell(outRow, 1);
    c.value = leyenda;
    c.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
  }

  configurarPagina(ws, 'landscape');
  return ws;
}
/** Agrega UNA hoja (cuadrícula o modo rápido) al libro. `usados` deduplica. */
function agregarInstrumentoAHoja(
  wb: any,
  def: PlantillaDefinicion,
  input: ExcelInstrumentoInput,
  usados?: Set<string>,
): void {
  if (def.grid) {
    renderGridXlsx(wb, def.grid, def, input, `Ind ${input.indicadorOrden}`, usados);
    return;
  }
  renderQuickXlsx(wb, def, input, `Indicador ${input.indicadorOrden}`, usados);
}

/** Modo "rápido" (campos clásicos, sin cuadrícula): agrega su hoja al libro. */
function renderQuickXlsx(
  wb: any,
  def: PlantillaDefinicion,
  input: ExcelInstrumentoInput,
  nombreHoja?: string,
  usados?: Set<string>,
): any {
  const conFinal = def.colFinal !== 'ninguno';
  const headers = conFinal
    ? ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`), def.colFinal === 'total' ? 'Total' : 'Valoración']
    : ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`)];
  // La columna del nombre se adapta al nombre más largo (no queda fija).
  const maxNombre = input.estudiantes.reduce((m, e) => Math.max(m, (e.nombre || '').length), 0);
  const anchoNombre = Math.min(Math.max(18, maxNombre + 3), 46);
  const anchos = headers.map((_h, i) => (i === 0 ? 5 : (i === 1 ? anchoNombre : 13)));

  const ws = agregarHoja(wb, nombreHojaSeguro(nombreHoja ?? `Indicador ${input.indicadorOrden}`, usados), anchos);

  const tituloDef = (def.titulo || '').trim();
  const titulo = tituloDef
    ? `${tituloDef} — Ind ${input.indicadorOrden}`
    : `Instrumento Indicador ${input.indicadorOrden}`;
  const lineasEncabezado = [
    `Colegio: ${input.meta.colegio}    Año: ${input.meta.ano}    Corte: ${input.meta.corte}`,
    `Grado-Sección: ${input.meta.grado}-${input.meta.seccion}    Asignatura: ${input.meta.asignatura}`,
    `Indicador ${input.indicadorOrden}: ${input.indicadorDescripcion || ''}`.trimEnd(),
  ];
  const intro = (def.textoIntro || '').trim();
  if (intro) lineasEncabezado.push(intro);
  let fila = escribirPortada(ws, titulo, lineasEncabezado as (string | null | undefined)[], headers.length);

  // Lista de criterios con puntaje (si la plantilla la quiere visible)
  if (def.mostrarPuntajeCriterios && input.criterios.length > 0) {
    fila += 1;
    for (const c of input.criterios) {
      ws.mergeCells(fila, 1, fila, headers.length - 1);
      const c1 = ws.getCell(fila, 1);
      c1.value = `${c.orden}. ${c.descripcion || ''}`;
      c1.font = { size: 10, bold: false, color: { argb: 'FF1E293B' } };
      c1.alignment = { horizontal: 'left' };
      const last = ws.getCell(fila, headers.length);
      last.value = `(${c.puntajeMaximo} pts)`;
      last.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
      last.alignment = { horizontal: 'right' };
      fila += 1;
    }
    fila += 1;
  }

  fila = escribirCabecera(ws, headers, fila + 1);
  input.estudiantes.forEach((est, i) => {
    const base = [i + 1, est.nombre, ...input.criterios.map((_c, ci) => est.letras[ci] ?? '')];
    const valores = conFinal ? [...base, est.valoracion || ''] : base;
    const rowIdx = fila;
    fila = escribirFila(ws, fila, valores, { banda: i % 2 === 1, centrarTodas: true });
    ws.getRow(rowIdx).height = 16; // alto fijo y pequeño (no auto-ajustar)
    // El nombre del estudiante va a la izquierda (el resto ya va centrado).
    ws.getCell(rowIdx, 2).alignment = { horizontal: 'left', vertical: 'middle' };
  });

  // Leyenda de la escala: la personalizada o la de la CONFIGURACIÓN real.
  const leyenda = (def.leyenda || '').trim() || leyendaEscalaConfig(input.colores?.escala, !!input.cualitativo);
  if (leyenda) {
    fila += 1;
    ws.mergeCells(fila, 1, fila, headers.length);
    const c = ws.getCell(fila, 1);
    c.value = leyenda;
    c.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  }

  configurarPagina(ws, 'portrait');
  return ws;
}

export async function generarInstrumentoXlsxDesdeDefinicion(
  def: PlantillaDefinicion,
  input: ExcelInstrumentoInput,
  fileNameBase: string,
): Promise<string> {
  const wb = await crearLibro('School Tracker');
  const usados = new Set<string>();
  agregarInstrumentoAHoja(wb, def, input, usados);
  // MISMA carpeta que el PDF: Instrumentos/<Corte> - <Asignatura>/.
  const dir = await carpetaInstrumento(subcarpetaInstrumento(input.meta.corte, input.meta.asignatura));
  // escribirLibroEnCarpeta agrega el .xlsx él mismo.
  const ruta = await escribirLibroEnCarpeta(wb, dir, fileNameBase);
  // Abre el archivo recién generado (desktop: app predeterminada; Android: chooser).
  await abrirInstrumentoExportado(ruta, XLSX_MIME);
  return ruta;
}

/**
 * UN libro con una HOJA por indicador (botón "Excel todos"): así el docente
 * tiene todos los instrumentos del mismo grupo en un solo archivo.
 */
export async function generarInstrumentosTodosXlsx(
  items: { def: PlantillaDefinicion; input: ExcelInstrumentoInput }[],
  fileNameBase: string,
): Promise<{ ruta: string; hojas: number }> {
  const wb = await crearLibro('School Tracker');
  const usados = new Set<string>();
  for (const it of items) agregarInstrumentoAHoja(wb, it.def, it.input, usados);
  const meta = items[0]?.input.meta;
  const dir = await carpetaInstrumento(meta ? subcarpetaInstrumento(meta.corte, meta.asignatura) : undefined);
  const ruta = await escribirLibroEnCarpeta(wb, dir, fileNameBase);
  await abrirInstrumentoExportado(ruta, XLSX_MIME);
  return { ruta, hojas: items.length };
}
