import { invoke } from '@tauri-apps/api/core';
import { documentDir } from '@tauri-apps/api/path';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Instrumentos de evaluación por indicador (PDF).
 * Tipos: general (tabla de notas del indicador), cotejo (casillas),
 * escala valorativa (letras + leyenda) y rúbrica (matriz criterios × niveles
 * con celdas vacías para descriptores manuales).
 */

export type InstrumentoTipo = 'general' | 'cotejo' | 'escala' | 'rubrica';

export const INSTRUMENTO_OPS: { id: InstrumentoTipo; label: string }[] = [
  { id: 'general', label: 'General (tabla)' },
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
  'AA = Superior (90-100)   AS = Alto (70-89)   AF = Básico (50-69)   AI = Insuficiente (<50)';

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

/** Encabezado común de todos los instrumentos. Devuelve la Y donde sigue el contenido. */
function drawHeader(doc: any, input: InstrumentoInput, title: string): number {
  const m = input.meta;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const info1 = `Colegio: ${m.colegio}    Año: ${m.ano}    Corte: ${m.corte}`;
  const info2 = `Grado: ${m.grado} - Sección: ${m.seccion}    Asignatura: ${m.asignatura}`;
  doc.text(info1, 10, 23);
  doc.text(info2, 10, 28);

  // Texto del indicador
  doc.setFont('helvetica', 'bold');
  doc.text(`Indicador ${input.orden}:`, 10, 36);
  doc.setFont('helvetica', 'normal');
  const descLines = doc.splitTextToSize(input.descripcion || '(Sin descripción)', doc.internal.pageSize.getWidth() - 20);
  doc.text(descLines, 10, 41);
  let y = 41 + descLines.length * 5;

  // Criterios enumerados
  if (input.criterios.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.text('Criterios:', 10, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    for (const c of input.criterios) {
      const line = `${c.orden}. ${c.descripcion || '(Sin descripción)'} (${c.puntajeMaximo} pts)`;
      const cl = doc.splitTextToSize(line, doc.internal.pageSize.getWidth() - 24);
      doc.text(cl, 14, y);
      y += cl.length * 4.5;
    }
  }
  return y + 3;
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

/** Tabla estudiantes × criterios con letra actual + columna de valoración. */
function tablaConNotas(doc: any, input: InstrumentoInput, startY: number, autoTable: AutoTableFn): void {
  const headers = ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`), 'Valoración'];
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
    styles: { fontSize: 7.5, cellPadding: 1.6, halign: 'center' },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { halign: 'left', cellWidth: 'auto' },
      [headers.length - 1]: { fontStyle: 'bold' },
    },
    headStyles: { fillColor: [71, 85, 105], textColor: 255 },
  });
}

/** Tabla estudiantes × criterios con casillas vacías (lista de cotejo impresa). */
function tablaCotejo(doc: any, input: InstrumentoInput, startY: number, autoTable: AutoTableFn): void {
  const headers = ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`), 'Logrados'];
  const rows = input.estudiantes.map((e, i) => [
    String(i + 1),
    e.nombre,
    ...input.criterios.map(() => ''), // casillas vacías para marcar a mano
    '',
  ]);
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.4, halign: 'center' },
    columnStyles: Object.assign(
      { 0: { cellWidth: 8 }, 1: { halign: 'left', cellWidth: 'auto' } },
      Object.fromEntries(input.criterios.map((_c, ci) => [ci + 2, { cellWidth: 12 }])),
      { [headers.length - 1]: { cellWidth: 16 } }
    ),
    headStyles: { fillColor: [16, 185, 129], textColor: 255 },
  });
}

/** Matriz criterios × niveles con celdas vacías para descriptores manuales. */
function matrizRubrica(doc: any, input: InstrumentoInput, startY: number, autoTable: AutoTableFn): void {
  const headers = ['Criterio', ...NIVELES_RUBRICA, 'Puntaje'];
  const rows = input.criterios.map(c => [
    c.descripcion || `(Criterio sin descripción)`,
    '', '', '', '', // descriptores manuales
    `${c.puntajeMaximo} pts`,
  ]);
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, minCellHeight: 18, valign: 'middle' },
    columnStyles: {
      0: { halign: 'left', cellWidth: 45 },
      [headers.length - 1]: { cellWidth: 16, fontStyle: 'bold' },
    },
    headStyles: { fillColor: [139, 92, 246], textColor: 255 },
  });
}

function construir(doc: any, input: InstrumentoInput, autoTable: AutoTableFn): void {
  const titulo = `Instrumento: ${tipoLabel(input.tipo)} — Indicador ${input.orden}`;
  const startY = drawHeader(doc, input, titulo);
  switch (input.tipo) {
    case 'cotejo':
      tablaCotejo(doc, input, startY, autoTable);
      break;
    case 'rubrica':
      matrizRubrica(doc, input, startY, autoTable);
      break;
    case 'escala':
      tablaConNotas(doc, input, startY, autoTable);
      {
        const after = (doc as any).lastAutoTable?.finalY ?? startY + 20;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.text(LEYENDA_ESCALA, 10, after + 6);
      }
      break;
    default:
      tablaConNotas(doc, input, startY, autoTable);
  }
}

function tipoLabel(tipo: InstrumentoTipo): string {
  return INSTRUMENTO_OPS.find(o => o.id === tipo)?.label ?? tipo;
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
