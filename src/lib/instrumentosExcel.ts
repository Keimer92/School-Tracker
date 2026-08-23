import JSZip from 'jszip';
import { documentDir } from '@tauri-apps/api/path';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';

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
  const sep = /Android/i.test(navigator.userAgent) ? '/' : '\\';
  const dir = `${docsPath}${sep}SchoolTrackerPro${sep}Instrumentos`;
  await mkdir(dir, { recursive: true }).catch(() => {});
  const fullPath = `${dir}${sep}${fileNameBase}.xlsx`;
  await writeFile(fullPath, outData);
  return fullPath;
}

// Re-exportar helpers de ruta usados por la UI
export async function abrirCarpetaInstrumentos(): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  const docsPath = await (await import('@tauri-apps/api/path')).documentDir();
  try { await openUrl('file:///' + docsPath.replace(/\\/g, '/') + '/SchoolTrackerPro/Instrumentos'); } catch {}
}
