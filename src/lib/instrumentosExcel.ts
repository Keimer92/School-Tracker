import JSZip from 'jszip';
import { documentDir } from '@tauri-apps/api/path';
import { writeFile, mkdir, readDir } from '@tauri-apps/plugin-fs';
import type { InstrumentoTipo } from './instrumentosPdf';
import { aFileURL, separadorRuta, unirRuta } from './platform';
import { cargarExcelJs, crearLibro, agregarHoja, escribirPortada, escribirCabecera, escribirFila, escribirLibroEnCarpeta, BORDE_FINO } from './excel';
import type { PlantillaDefinicion, PlantillaGrid, TokenDatos } from './instrumentoPlantilla';
import { resolverTokens } from './instrumentoPlantilla';

/** Detecta el tipo de instrumento por palabras clave EN EL NOMBRE DEL ARCHIVO.
 *  El nombre debe contener: "Rúbrica"/"Rubrica", "Cotejo" o "Escala".
 *  Fallback: escala. */
export function detectarTipoPlantilla(nombre: string): InstrumentoTipo {
  // Normalizar: minúsculas sin acentos (rúbrica -> rubrica)
  const n = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (n.includes('rubric')) return 'rubrica';
  if (n.includes('cotejo')) return 'cotejo';
  return 'escala';
}

/**
 * Motor de instrumentos basado en plantillas Excel con marcadores.
 *
 * Un .xlsx es un ZIP de XML: en vez de leer/reescribir con una librería de
 * hojas de cálculo (que perdería el diseño), se reemplaza TEXTO directamente
 * dentro del XML y se vuelve a empaquetar → el formato del docente queda
 * intacto al 100% (bordes, colores, celdas combinadas, logo).
 *
 * Marcadores globales (cualquier celda):
 *   {COLEGIO} {ANO} {CORTE} {ASIGNATURA} {GRADO} {SECCION}
 *   {IND_ORDEN} {IND_TEXTO}
 *   {CRITERIOS_LISTA}  → lista numerada "1. desc (p pts)"
 *
 * Bloque repetible de estudiantes:
 *   En UNA fila escribir los marcadores por-columna, p. ej.
 *     {NUM} | {NOMBRE} | {LETRA_1} | {LETRA_2} | {VALORACION}
 *   y en la primera celda de esa misma fila la bandera  {{FILAS}}
 *   Esa fila se clona una vez por estudiante (conservando su formato) y se
 *   elimina el original; las filas posteriores se recorren hacia abajo.
 *
 * Limitaciones v1: no colocar celdas combinadas DENTRO de la fila repetible
 * (sobre el bloque sí). Las filas de abajo conservan estilos pero referencias
 * tipo tabla/fórmulas que dependan de su posición pueden requerir ajuste.
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
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function construirMapaGlobal(input: ExcelInstrumentoInput): Record<string, string> {
  const criteriosLista = input.criterios.length > 0
    ? input.criterios.map(c => `${c.orden}. ${c.descripcion || '________________________'} (${c.puntajeMaximo} pts)`).join('\n')
    : '';
  return {
    '{COLEGIO}': input.meta.colegio,
    '{ANO}': input.meta.ano,
    '{CORTE}': input.meta.corte,
    '{ASIGNATURA}': input.meta.asignatura,
    '{GRADO}': input.meta.grado,
    '{SECCION}': input.meta.seccion,
    '{IND_ORDEN}': String(input.indicadorOrden),
    '{IND_TEXTO}': input.indicadorDescripcion || '',
    '{CRITERIOS_LISTA}': criteriosLista,
  };
}

/** Aplica el mapa global sobre todo texto <t>…</t> del XML dado. */
function reemplazarGlobales(xml: string, mapa: Record<string, string>): string {
  let out = xml;
  for (const [k, v] of Object.entries(mapa)) {
    if (!out.includes(k)) continue;
    out = out.split(k).join(escapeXml(v));
  }
  return out;
}

/** Extrae los números de fila de refs tipo r="B12" dentro de un fragmento XML de fila/celda. */
function shiftRefs(fragment: string, delta: number): string {
  if (delta === 0) return fragment;
  return fragment.replace(/r="([A-Z]{1,3})(\d+)"/g, (_m, col: string, rowStr: string) => {
    const newRow = parseInt(rowStr, 10) + delta;
    return `r="${col}${newRow}"`;
  });
}

/** Desplaza también los rangos A1:D5 de mergeCells posteriores al bloque. */
function shiftMergeRanges(xml: string, afterRow: number, delta: number): string {
  if (delta === 0) return xml;
  return xml.replace(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, (m, c1: string, r1s: string, c2: string, r2s: string) => {
    const r1 = parseInt(r1s, 10);
    const r2 = parseInt(r2s, 10);
    if (r1 <= afterRow && r2 <= afterRow) return m; // completamente arriba
    const nr1 = r1 > afterRow ? r1 + delta : r1;
    const nr2 = r2 + delta;
    return `ref="${c1}${nr1}:${c2}${nr2}"`;
  });
}

/**
 * Procesa una hoja: clona la fila bandera {{FILAS}} por cada estudiante.
 * Devuelve el XML modificado o el original si no hay bloque.
 */
function procesarBloqueEstudiantes(sheetXml: string, input: ExcelInstrumentoInput): string {
  // Localizar <row ...>...</row> que contenga {{FILAS}}
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g;
  let match: RegExpExecArray | null;
  let markerStart = -1;
  let markerEnd = -1;
  let markerRowNum = -1;
  let markerXml = '';

  while ((match = rowRe.exec(sheetXml)) !== null) {
    if (match[0].includes('{{FILAS}}')) {
      markerStart = match.index;
      markerEnd = match.index + match[0].length;
      markerRowNum = parseInt(match[1], 10);
      markerXml = match[0];
      break;
    }
  }
  if (markerStart === -1) return sheetXml;

  const estudiantes = input.estudiantes;
  const n = Math.max(1, estudiantes.length);
  const delta = n - 1; // el clon #1 sustituye a la fila plantilla

  // Construir clones: copia de la fila plantilla sin la celda bandera
  const flagCellRe = /<c[^>]*>(?:(?!<\/c>)[\s\S])*?\{\{FILAS\}\}(?:(?!<\/c>)[\s\S])*?<\/c>/;
  const plantilla = markerXml.replace(flagCellRe, '');

  const clones: string[] = [];
  estudiantes.forEach((est, i) => {
    let clone = shiftRefs(plantilla, i); // refs internas de la plantilla se recorren
    // Tokens por estudiante
    clone = clone
      .replace(/\{NUM\}/g, escapeXml(String(i + 1)))
      .replace(/\{NOMBRE\}/g, escapeXml(est.nombre))
      .replace(/\{SEXO\}/g, escapeXml(est.sexo || ''))
      .replace(/\{VAL_IND\}/g, escapeXml(est.valoracion || '-'));
    input.criterios.forEach((c, ci) => {
      const letra = est.letras[ci] || '-';
      const reLetra = new RegExp(`\\{LETRA_${ci + 1}\\}`, 'g');
      clone = clone.replace(reLetra, escapeXml(letra));
      const rePts = new RegExp(`\\{PUNTOS_${ci + 1}\\}`, 'g');
      clone = clone.replace(rePts, String(c.puntajeMaximo));
    });
    // Renumerar la fila clonada a su posición final
    const targetRow = markerRowNum + i;
    clone = clone.replace(/(<row[^>]*?r=")\d+(")/, `$1${targetRow}$2`);
    clones.push(clone);
  });

  // Cola: filas posteriores al bloque desplazadas
  const tailRe = /<row[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g;
  let tail = '';
  let lastEnd = markerEnd;
  let m2: RegExpExecArray | null;
  while ((m2 = tailRe.exec(sheetXml)) !== null) {
    const rowNum = parseInt(m2[1], 10);
    if (rowNum <= markerRowNum) continue;
    const gap = m2.index - lastEnd;
    tail += sheetXml.slice(lastEnd, m2.index); // contenido intermedio literal
    tail += shiftRefs(m2[0], delta);
    lastEnd = m2.index + m2[0].length;
  }
  tail += sheetXml.slice(lastEnd);

  let head = sheetXml.slice(0, markerStart);
  head = shiftMergeRanges(head, markerRowNum + 1, delta); // merges arriba quedan; por si acaso

  let result = head + clones.join('') + tail;
  // Merges posteriores al bloque (en cualquier parte restante del sheet)
  result = shiftMergeRanges(result, markerRowNum + 1, delta);

  // Dimension tag: ampliar o limpiar para que Excel recalcule
  result = result.replace(/<dimension ref="[^"]*"\/>/, '');
  return result;
}

/**
 * Carpeta fija donde la app busca plantillas .xlsx del usuario.
 *
 * El separador sale de `unirRuta()`: hardcodear `\\` para "todo lo que no sea
 * Android" armaba `/home/user/Documents\SchoolTrackerPro\Plantillas` en Linux
 * y la carpeta nunca aparecía.
 */
export async function plantillasDir(): Promise<string> {
  const docsPath = await documentDir();
  return unirRuta(docsPath, 'SchoolTrackerPro', 'Plantillas');
}

/** Lista las plantillas .xlsx disponibles con su tipo detectado por nombre. */
export async function listarPlantillas(): Promise<{ nombre: string; ruta: string; tipo: InstrumentoTipo }[]> {
  const dir = await plantillasDir();
  const sep = separadorRuta();
  try {
    const entries = await readDir(dir);
    return entries
      .filter(e => e.name && e.name.toLowerCase().endsWith('.xlsx') && !e.name.startsWith('~$'))
      .map(e => ({
        nombre: e.name!,
        ruta: `${dir}${sep}${e.name}`,
        tipo: detectarTipoPlantilla(e.name!),
      }))
      .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre));
  } catch {
    return []; // carpeta aún no creada
  }
}

/** Crea la carpeta de plantillas si no existe. */
export async function asegurarCarpetaPlantillas(): Promise<string> {
  const dir = await plantillasDir();
  await mkdir(dir, { recursive: true }).catch(() => {});
  return dir;
}

/** Abre la carpeta de plantillas en el explorador del sistema. */
export async function abrirCarpetaPlantillas(): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  const dir = await asegurarCarpetaPlantillas();
  try { await openUrl(aFileURL(dir)); } catch {}
}

/**
 * Genera el XLSX rellenado a partir de una plantilla con marcadores.
 * @param templateData bytes del .xlsx plantilla
 * @param fileNameBase nombre base sin extensión
 * @returns ruta completa guardada
 */
export async function generarInstrumentoExcel(
  templateData: Uint8Array,
  fileNameBase: string,
  input: ExcelInstrumentoInput
): Promise<string> {
  const zip = await JSZip.loadAsync(templateData);

  const mapa = construirMapaGlobal(input);

  // 1) Reemplazo global en strings compartidas y hojas
  const sharedEntry = zip.file('xl/sharedStrings.xml');
  if (sharedEntry) {
    zip.file('xl/sharedStrings.xml', reemplazarGlobales(await sharedEntry.async('string'), mapa));
  }
  const sheetNames = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  for (const name of sheetNames) {
    zip.file(name, reemplazarGlobales(await zip.file(name)!.async('string'), mapa));
  }

  // 2) Bloque repetible de estudiantes (procesar cada hoja)
  for (const name of sheetNames) {
    const xml = await zip.file(name)!.async('string');
    zip.file(name, procesarBloqueEstudiantes(xml, input));
  }

  // 3) Empaquetar y guardar
  const outData = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const docsPath = await (await import('@tauri-apps/api/path')).documentDir();
  const dir = unirRuta(docsPath, 'SchoolTrackerPro', 'Instrumentos');
  await mkdir(dir, { recursive: true }).catch(() => {});
  const fullPath = unirRuta(dir, `${fileNameBase}.xlsx`);
  await writeFile(fullPath, outData);
  return fullPath;
}

// Re-exportar helpers de ruta usados por la UI
export async function abrirCarpetaInstrumentos(): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  const docsPath = await (await import('@tauri-apps/api/path')).documentDir();
  try { await openUrl(aFileURL(unirRuta(docsPath, 'SchoolTrackerPro', 'Instrumentos'))) } catch {}
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
function renderGridXlsx(wb: any, grid: PlantillaGrid, def: PlantillaDefinicion, input: ExcelInstrumentoInput): any {
  const datos = tokenDatosCabecera(input);
  const covCache = new Map<number, Map<string, [number, number]>>();
  const cubiertos = (g: PlantillaGrid) => {
    if (!covCache.has(g.filas * 1000 + g.cols)) {
      const m = new Map<string, [number, number]>();
      for (const [k, cel] of Object.entries(g.celdas)) {
        const [r, c] = k.split(':').map(Number);
        for (let rr = r; rr < Math.min(r + (cel.rs ?? 1), g.filas); rr++)
          for (let cc = c; cc < Math.min(c + (cel.cs ?? 1), g.cols); cc++)
            if (rr !== r || cc !== c) m.set(`${rr}:${cc}`, [r, c]);
      }
      covCache.set(g.filas * 1000 + g.cols, m);
    }
    return covCache.get(g.filas * 1000 + g.cols)!;
  };

  // Ancho de columna: longitud del texto resuelto (sin estudiante), acotado.
  const cov = cubiertos(grid);
  const anchos: number[] = [];
  for (let c = 0; c < grid.cols; c++) {
    let mx = 4;
    for (const [k, cel] of Object.entries(grid.celdas)) {
      const [r, cc] = k.split(':').map(Number);
      if (cc !== c) continue;
      const resolved = resolverTokens(cel.v ?? '', datos);
      mx = Math.max(mx, Math.min(resolved.length + 3, 34));
    }
    anchos.push(mx);
  }
  const nombreHoja = `Ind ${input.indicadorOrden}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 31);
  const ws = agregarHoja(wb, nombreHoja, anchos);

  const conFilaEst = grid.filaEstudiantes >= 0;
  const estudiantes = conFilaEst ? input.estudiantes : [];
  let outRow = 0; // 0-based

  for (let r = 0; r < grid.filas; r++) {
    const esEstudiante = r === grid.filaEstudiantes;
    outRow += 1; // moveTo 1-based al escribir
    const veces = esEstudiante ? estudiantes.length : 1;
    if (veces === 0) { outRow -= 1; continue; } // fila de estudiante sin alumnos

    for (let vi = 0; vi < veces; vi++) {
      const est = esEstudiante
        ? (estudiantes as ExcelInstrumentoInput['estudiantes'])[vi]
        : undefined;
      const dEst: TokenDatos = est
        ? { ...datos, est: { n: vi + 1, nombre: est.nombre, letras: est.letras.map(l => l ?? ''), valoracion: est.valoracion || '' } }
        : datos;
      for (let c = 0; c < grid.cols; c++) {
        const key = `${r}:${c}`;
        const dueño = cov.get(`${r}:${c}`);
        if (dueño && dueño[1] !== c) continue; // cubierta horizontal: skip
        const cel = grid.celdas[key];
        const ancho = (cel?.cs ?? 1);
        if (dueño) continue; // cubierta vertical por otra celda de esta misma columna
        // Escribir celda.
        const rr1 = outRow, cc1 = c + 1;
        const celda = ws.getCell(rr1, cc1);
        celda.value = resolverTokens(cel?.v ?? '', dEst);
        if (esEstudiante) {
          celda.font = { size: 9, color: { argb: 'FF1E293B' } };
        } else {
          celda.font = { bold: true, size: 9, color: { argb: 'FF0F172A' } };
        }
        celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        celda.border = BORDE_FINO;
        if (ancho > 1 || (!esEstudiante && (cel?.rs ?? 1) > 1)) {
          ws.mergeCells(rr1, cc1, rr1 + (cel?.rs ?? 1) - 1, cc1 + ancho - 1);
        }
        // Bordes del rango fusionado (mergeCells resetea estilos internos en ExcelJS).
        const cTop = ws.getCell(rr1, cc1);
        cTop.border = BORDE_FINO;
        const cFin = ws.getCell(rr1 + (cel?.rs ?? 1) - 1, cc1 + ancho - 1);
        cFin.border = BORDE_FINO;
      }
      outRow += 1; // siguiente fila de salida (per estudiante/per fila lógica)
    }
    outRow -= 1; // el for del r vuelve a sumar 1
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
  const dir = unirRuta(docsPath, 'SchoolTrackerPro', 'Instrumentos');
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
