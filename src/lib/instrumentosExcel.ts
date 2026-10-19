import { documentDir } from '@tauri-apps/api/path';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { aFileURL, unirRuta } from './platform';
import { cargarExcelJs, crearLibro, agregarHoja, escribirPortada, escribirCabecera, escribirFila, escribirLibroEnCarpeta, BORDE_NEGRO, argb } from './excel';
import type { InstrumentoColores, PlantillaDefinicion, PlantillaGrid, TokenDatos } from './instrumentoPlantilla';
import { resolverTokens, columnasAIQuitar, colorDeCelda } from './instrumentoPlantilla';

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


export async function abrirCarpetaInstrumentos(): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  const docsPath = await (await import('@tauri-apps/api/path')).documentDir();
  try { await openUrl(aFileURL(unirRuta(docsPath, 'School Tracker', 'Instrumentos'))) } catch {}
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
/** Línea del encabezado estándar del XLSX (una fila a lo ancho de la cuadrícula). */
function lineaEncabezadoXlsx(ws: any, fila: number, nCols: number, rgb: string, texto: string, size: number): void {
  if (nCols > 1) try { ws.mergeCells(fila, 1, fila, Math.max(2, nCols)); } catch { /* ya fusionada */ }
  const c = ws.getCell(fila, 1);
  c.value = texto;
  c.font = { bold: true, size, color: { argb: rgb } };
  c.alignment = { horizontal: 'left', vertical: 'middle' };
}

function renderGridXlsx(wb: any, grid: PlantillaGrid, def: PlantillaDefinicion, input: ExcelInstrumentoInput): any {
  const sinAI = !!input.cualitativo;
  const datos: TokenDatos = { ...tokenDatosCabecera(input), sinAI };

  // Contexto cualitativo → las columnas {AI} de la cuadrícula SE COLAPSAN
  // (el AI no aplica en ese régimen; lo decide la lógica de negocio).
  const quitar = columnasAIQuitar(grid, sinAI);
  const kept: number[] = [];
  for (let c = 0; c < grid.cols; c++) if (!quitar.has(c)) kept.push(c);
  const newIdx = new Map<number, number>(); // col vieja → índice de salida
  kept.forEach((oc, i) => newIdx.set(oc, i));

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

  // Ancho de columna: longitud del texto resuelto (sin estudiante), acotado.
  const anchos: number[] = [];
  for (let ci = 0; ci < kept.length; ci++) {
    let mx = 4;
    for (const celditas of celdasPorFila.values()) {
      for (const cel of celditas) {
        // La celda enfrenta esta columna si su rango la incluye.
        if (ci < cel.c0 || ci >= cel.c0 + cel.cs) continue;
        if (cel.rs > 1) continue; // se distribuye en varias filas: poco indicativo
        mx = Math.max(mx, Math.min(resolverTokens(cel.v, datos).length / cel.cs + 3, 34));
      }
    }
    anchos.push(Math.round(mx));
  }
  const nombreHoja = `Ind ${input.indicadorOrden}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 31);
  const ws = agregarHoja(wb, nombreHoja, anchos);

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

  const conFilaEst = grid.filaEstudiantes >= 0;
  const estudiantes = conFilaEst ? input.estudiantes : [];

  for (let r = 0; r < grid.filas; r++) {
    const esEstudiante = r === grid.filaEstudiantes;
    const veces = esEstudiante ? estudiantes.length : 1;
    if (veces === 0) continue; // fila de estudiante sin alumnos
    for (let vi = 0; vi < veces; vi++) {
      const est = esEstudiante
        ? (estudiantes as ExcelInstrumentoInput['estudiantes'])[vi]
        : undefined;
      const dEst: TokenDatos = est
        ? { ...datos, est: { n: vi + 1, nombre: est.nombre, letras: est.letras.map(l => l ?? ''), valoracion: est.valoracion || '', total: (est as any).total || '', nf: (est as any).nf || '', tcs: (est as any).tcs || [] } }
        : datos;
      outRow += 1; // fila de salida (1-based)
      for (const cel of celdasPorFila.get(r) ?? []) {
        const rr1 = outRow, cc1 = cel.c0 + 1;
        const celda = ws.getCell(rr1, cc1);
        const valor = resolverTokens(cel.v, dEst);
        celda.value = valor;
        if (esEstudiante) {
          // Convención de colores del sistema: nombre por sexo, sigla de nota
          // por su color configurado. Sin color → tinta oscura.
          const col = colorDeCelda(cel.v, valor, input.colores, est?.sexo);
          celda.font = { size: 9, color: { argb: argb(col || '1E293B') } };
        } else {
          celda.font = { bold: true, size: 9, color: { argb: 'FF0F172A' } };
        }
        celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        celda.border = BORDE_NEGRO;
        const rs = esEstudiante ? 1 : cel.rs;
        if (cel.cs > 1 || rs > 1) ws.mergeCells(rr1, cc1, rr1 + rs - 1, cc1 + cel.cs - 1);
        // Bordes del rango fusionado (mergeCells resetea estilos internos en ExcelJS).
        ws.getCell(rr1 + rs - 1, cc1).border = BORDE_NEGRO;
        ws.getCell(rr1, cc1 + cel.cs - 1).border = BORDE_NEGRO;
        ws.getCell(rr1 + rs - 1, cc1 + cel.cs - 1).border = BORDE_NEGRO;
      }
    }
  }

  return ws;
}
export async function generarInstrumentoXlsxDesdeDefinicion(
  def: PlantillaDefinicion,
  input: ExcelInstrumentoInput,
  fileNameBase: string,
): Promise<string> {
  const ExcelJS = await cargarExcelJs();
  const wb = await crearLibro('School Tracker');

  const docsPath = await documentDir();
  const dir = unirRuta(docsPath, 'School Tracker', 'Instrumentos');
  await mkdir(dir, { recursive: true }).catch(() => {});

  // ── Modo CUADRÍCULA (constructor tipo Excel): render tal cual ──
  if (def.grid) {
    renderGridXlsx(wb, def.grid, def, input);
    // escribirLibroEnCarpeta agrega el .xlsx él mismo.
    return await escribirLibroEnCarpeta(wb, dir, fileNameBase);
  }

  // ── Modo "rápido" (campos clásicos, sin cuadrícula) ──
  const conFinal = def.colFinal !== 'ninguno';
  const headers = conFinal
    ? ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`), def.colFinal === 'total' ? 'Total' : 'Valoración']
    : ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`)];
  const anchos = headers.map((h, i) => (i <= 1 || !conFinal && i === 1 ? (i === 0 ? 5 : 38) : 13));

  const nombreHoja = `Indicador ${input.indicadorOrden}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 31);
  const ws = agregarHoja(wb, nombreHoja, anchos);

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
    fila = escribirFila(ws, fila, valores, { banda: i % 2 === 1, centrarTodas: true });
  });

  const leyenda = (def.leyenda || '').trim();
  if (leyenda) {
    fila += 1;
    ws.mergeCells(fila, 1, fila, headers.length);
    const c = ws.getCell(fila, 1);
    c.value = leyenda;
    c.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  }

  // escribirLibroEnCarpeta agrega el .xlsx él mismo.
  return await escribirLibroEnCarpeta(wb, dir, fileNameBase);
}
