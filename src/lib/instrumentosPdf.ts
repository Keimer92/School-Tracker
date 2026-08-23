import { invoke } from '@tauri-apps/api/core';
import { documentDir } from '@tauri-apps/api/path';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Instrumentos de evaluación por indicador (PDF).
 * Tipos: general (tabla de notas del indicador), cotejo (registro con Total),
 * escala valorativa (letras + leyenda) y rúbrica (matriz criterios × niveles
 * con celdas vacías + registro de estudiantes).
 */

export type InstrumentoTipo = 'cotejo' | 'escala' | 'rubrica';

export const INSTRUMENTO_OPS: { id: InstrumentoTipo; label: string }[] = [
  { id: 'cotejo', label: 'Lista de cotejo' },
  { id: 'escala', label: 'Escala valorativa' },
  { id: 'rubrica', label: 'Rúbrica' },
];

export interface InstrumentoCriterio {
  orden: number;
  descripcion: string;
  puntajeMaximo: number;
}

export interface InstrumentoEstudiante {
  id: number;
  nombre: string;
  sexo: string;
  /** Letra cualitativa por criterio, en el mismo orden que criterios ('' si vacía) */
  letras: string[];
  /** Valoración cualitativa del indicador completo */
  valoracion: string;
}

export interface InstrumentoMeta {
  colegio: string;
  ano: string;
  corte: string;
  asignatura: string;
  grado: string;
  seccion: string;
}

export interface InstrumentoInput {
  tipo: InstrumentoTipo;
  orden: number;
  descripcion: string;
  criterios: InstrumentoCriterio[];
  estudiantes: InstrumentoEstudiante[];
  meta: InstrumentoMeta;
}

const NIVELES_RUBRICA = ['Superior (4)', 'Alto (3)', 'Básico (2)', 'Bajo (1)'];
const LEYENDA_ESCALA =
  'AA = Superior (90-100)    AS = Alto (70-89)    AF = Básico (50-69)    AI = Insuficiente (<50)';
const GUIONES = '________________________________________';

// jspdf-autotable v5: API funcional (no parchea el prototipo de jsPDF)
type AutoTableFn = (doc: any, options: any) => void;
let autoTableFn: AutoTableFn | null = null;
async function loadAutoTable(): Promise<AutoTableFn> {
  if (!autoTableFn) {
    const mod: any = await import('jspdf-autotable');
    autoTableFn = (mod.default ?? mod) as AutoTableFn;
  }
  return autoTableFn!;
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '_');
}

/** Encabezado en UNA sola línea + bloque de indicador/criterios.
 *  Si falta una descripción, dibuja una línea horizontal para completar a mano,
 *  con el puntaje al final. Devuelve la Y donde continúa el contenido. */
function drawHeader(doc: any, input: InstrumentoInput, title: string): number {
  const m = input.meta;
  const pageW = doc.internal.pageSize.getWidth();
  const rightMargin = pageW - 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, pageW / 2, 14, { align: 'center' });

  // ── Info del curso: UNA sola línea ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const info = [
    `Colegio: ${m.colegio}`,
    `Año: ${m.ano}`,
    `Corte: ${m.corte}`,
    `Grado-Sección: ${m.grado}-${m.seccion}`,
    `Asignatura: ${m.asignatura}`,
  ].join('    ');
  doc.text(info, 10, 21);

  // ── Indicador ──
  const totalPts = input.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0);
    doc.setDrawColor(0);
  let y = 29;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const label = `Indicador ${input.orden}:`;
  doc.text(label, 10, y);

  if ((input.descripcion || '').trim()) {
    doc.setFont('helvetica', 'normal');
    const xDesc = 10 + doc.getTextWidth(label) + 2;
    const descLines = doc.splitTextToSize(input.descripcion, rightMargin - 10);
    doc.text(descLines, xDesc, y);
    y += descLines.length * 4.6;
  } else {
    // Línea para escribir a mano + puntaje total al final
    const ptsText = totalPts > 0 ? ` (${totalPts} pts)` : '';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    if (ptsText) doc.text(ptsText, rightMargin, y, { align: 'right' });
    doc.setLineWidth(0.9);
    doc.line(10 + doc.getTextWidth(label) + 2, y, rightMargin - doc.getTextWidth(ptsText) - 2, y);
    y += 6;
  }

  // ── Criterios ──
  if (input.criterios.length > 0) {
    y += 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Criterios:', 10, y);
    y += 5.2;
    for (const c of input.criterios) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      const numLabel = `${c.orden}.`;
      doc.text(numLabel, 14, y);
      const numW = doc.getTextWidth(numLabel) + 2;
      const ptsSuffix = ` (${c.puntajeMaximo} pts)`;

      if ((c.descripcion || '').trim()) {
        doc.setFont('helvetica', 'normal');
        const avail = rightMargin - 10 - numW - 14 - doc.getTextWidth(ptsSuffix);
        const cl = doc.splitTextToSize(c.descripcion, avail);
        doc.text(cl, 14 + numW, y);
        doc.text(ptsSuffix, rightMargin, y, { align: 'right' });
        y += cl.length * 4.5;
      } else {
        // Línea horizontal para escribir la descripción a mano + puntaje al final
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(ptsSuffix, rightMargin, y, { align: 'right' });
        doc.setLineWidth(0.9);
        doc.line(14 + numW, y, rightMargin - doc.getTextWidth(ptsSuffix) - 2, y);
        y += 6;
      }
    }
  }
  return y + 2;
}

/** Tabla común: estudiantes × criterios (letras actuales) + columna final. */
function tablaEstudiantes(
  doc: any,
  input: InstrumentoInput,
  startY: number,
  autoTable: AutoTableFn,
  lastColLabel: string
): void {
  const headers = ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`), lastColLabel];
  const rows = input.estudiantes.map((e, i) => [
    String(i + 1),
    e.nombre,
    ...input.criterios.map((_c, ci) => e.letras[ci] || '-'),
    e.valoracion || '-',
  ]);
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.6, halign: 'center', textColor: 0, lineColor: [0, 0, 0], lineWidth: 0.35 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { halign: 'left', cellWidth: 'auto' },
      [headers.length - 1]: { fontStyle: 'bold' },
    },
    headStyles: { fillColor: [0, 0, 0], textColor: 255 },
  });
}

/** Matriz criterios × niveles con celdas vacías para descriptores manuales. */
function matrizRubrica(
  doc: any,
  input: InstrumentoInput,
  startY: number,
  autoTable: AutoTableFn
): void {
  const headers = ['Criterio', ...NIVELES_RUBRICA, 'Puntaje'];
  const rows = input.criterios.map(c => [
    `${c.orden}. ${c.descripcion || GUIONES} (${c.puntajeMaximo} pts)`,
    '', '', '', '', // descriptores manuales
  ]);
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, minCellHeight: 18, valign: 'middle', textColor: 0, lineColor: [0, 0, 0], lineWidth: 0.35 },
    columnStyles: {
      0: { halign: 'left', cellWidth: 45 },
      [headers.length - 1]: { cellWidth: 16, fontStyle: 'bold' },
    },
    headStyles: { fillColor: [0, 0, 0], textColor: 255 },
  });
}

function construir(doc: any, input: InstrumentoInput, autoTable: AutoTableFn): void {
  const titulo = `Instrumento: ${tipoLabel(input.tipo)} — Indicador ${input.orden}`;
  let startY = drawHeader(doc, input, titulo);

  switch (input.tipo) {
    case 'rubrica':
      // 1) Matriz de descriptores (referencia)  2) Registro por estudiante
      matrizRubrica(doc, input, startY, autoTable);
      startY = ((doc as any).lastAutoTable?.finalY ?? startY) + 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text('Registro por estudiante:', 10, startY);
      tablaEstudiantes(doc, input, startY + 2, autoTable, 'Valoración');
      break;
    case 'cotejo':
      tablaEstudiantes(doc, input, startY, autoTable, 'Total');
      break;
    case 'escala':
      tablaEstudiantes(doc, input, startY, autoTable, 'Valoración');
      {
        const after = (doc as any).lastAutoTable?.finalY ?? startY + 20;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.text(LEYENDA_ESCALA, 10, after + 6);
      }
      break;
    default:
      tablaEstudiantes(doc, input, startY, autoTable, 'Valoración');
  }
}

function tipoLabel(tipo: InstrumentoTipo): string {
  return INSTRUMENTO_OPS.find(o => o.id === tipo)?.label ?? tipo;
}

async function guardarYEntregar(doc: any, fileName: string, subfolder: string): Promise<string> {
  const pdfData = doc.output('arraybuffer');
  const docsPath = await documentDir();
  const sep = /Android/i.test(navigator.userAgent) ? '/' : '\\';
  const dir = `${docsPath}${sep}SchoolTrackerPro${sep}Instrumentos${sep}${subfolder}`;
  await mkdir(dir, { recursive: true }).catch(() => {});
  const fullPath = `${dir}${sep}${fileName}`;
  await writeFile(fullPath, new Uint8Array(pdfData));
  const folderPath = dir.replace(/\\/g, '/');
  if (/Android/i.test(navigator.userAgent)) {
    try { await invoke('share_pdf', { path: fullPath.replace(/\\/g, '/') }); } catch {}
  } else {
    try { await openUrl('file:///' + folderPath); } catch {}
  }
  return fullPath;
}

/** Genera el PDF de UN indicador. Devuelve la ruta completa del archivo. */
export async function generarInstrumentoPDF(input: InstrumentoInput): Promise<string> {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = await loadAutoTable();
  const landscape = input.tipo !== 'rubrica';
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'letter' });
  construir(doc, input, autoTable);
  const fileName = sanitize(`Instrumento_${tipoLabel(input.tipo)}_Ind${input.orden}_${sanitize(input.meta.asignatura)}_${sanitize(input.meta.grado)}${sanitize(input.meta.seccion)}.pdf`);
  const sub = sanitize(`${input.meta.corte} - ${input.meta.asignatura}`);
  return await guardarYEntregar(doc, fileName, sub);
}

/** Genera TODOS los inputs en un solo PDF (sección por indicador). */
export async function generarInstrumentosTodosPDF(inputs: InstrumentoInput[]): Promise<string> {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = await loadAutoTable();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  inputs.forEach((input, i) => {
    if (i > 0) doc.addPage();
    construir(doc, input, autoTable);
  });
  const first = inputs[0]?.meta;
  const fileName = sanitize(`Instrumentos_${first?.asignatura ?? 'Asignatura'}_${first?.corte ?? ''}.pdf`);
  const sub = sanitize(`${first?.corte ?? ''} - ${first?.asignatura ?? ''}`);
  return await guardarYEntregar(doc, fileName, sub);
}
