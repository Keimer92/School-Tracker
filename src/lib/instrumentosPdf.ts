import { writeFile } from '@tauri-apps/plugin-fs';
import { unirRuta } from './platform';
import { abrirInstrumentoExportado, carpetaInstrumento, subcarpetaInstrumento } from './instrumentosEntrega';
// Importe SOLO de tipos: no hay ciclo en runtime (el otro lado también importa tipos).
import type { InstrumentoColores, PlantillaDefinicion, PlantillaGrid, TokenDatos } from './instrumentoPlantilla';
import { resolverTokens, columnasCualitativo, leyendaEscalaConfig, fechaHoyDDMM, colorDeCelda, centrarCelda } from './instrumentoPlantilla';
import { dibujarTitulo, dibujarChips, CHIP_INFO, CHIP_ROSA, CHIP_NEUTRO } from './pdfChrome';

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
  /** Total del indicador "pts + sigla" (ej. "17 AS"); '' si no hay notas. */
  total?: string;
  /** Nota Final del corte "pts + sigla"; '' si no hay notas. */
  nf?: string;
  /** Total Criterio {TC_k}: pts de cada criterio, mismo orden ('' sin nota). */
  tcs?: string[];
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
  /** Contexto CUALITATIVO (grado/asignatura): la escala es AA/AS/AF — el AI
   *  no aplica y la plantilla colapsa sus columnas {AI}. */
  cualitativo?: boolean;
  /**
   * Colores del sistema (notas por sigla + fuente por sexo). Sin esto el PDF
   * sale en negro; lo aporta NotasPage con `gradeConfigs` y Ajustes.
   */
  colores?: InstrumentoColores;
  /**
   * Plantilla del constructor visual (tabla `instrumento_plantilla`, BD).
   * Opcional: sin plantilla se usa el diseño por defecto del tipo. Solo aporta
   * la PRESENTACIÓN (título, texto intro, leyenda, columna final, orientación);
   * los datos (estudiantes, notas, criterios) siempre vienen de la BD.
   */
  plantilla?: PlantillaDefinicion;
}

const NIVELES_RUBRICA = ['Superior (4)', 'Alto (3)', 'Básico (2)', 'Bajo (1)'];
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

/** Convierte un hex (#rgb o #rrggbb) al triplete RGB que espera jsPDF. */
function rgbDe(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '').trim();
  if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [0, 0, 0];
}

/** Encabezado en UNA sola línea + bloque de indicador/criterios.
 *  Si falta una descripción, dibuja una línea horizontal para completar a mano,
 *  con el puntaje al final. Devuelve la Y donde continúa el contenido. */
/**
 * Encabezado ESTÁNDAR del instrumento, con el lenguaje visual de informe y
 * reporte (pdfChrome: barra de acento + chips redondeados). Filas:
 *   1) título + colegio (dibujarTitulo)
 *   2) chips: asignatura · año · fecha
 *   3) Corte evaluativo — fila propia
 *   4) Indicador N — fila propia, con su descripción si la lleva
 * La usan el modo cuadrícula y el modo rápido; devuelve la Y donde empieza
 * el contenido.
 */
function encabezadoInstrumento(doc: any, input: InstrumentoInput): number {
  const m = input.meta;
  const pageW = (doc as any).internal.pageSize.getWidth();
  const usable = pageW - 20;
  const rightMargin = pageW - 10;

  const titulo = 'Instrumento de Evaluación';
  const subtitulo = `${m.colegio} — ${m.grado}-${m.seccion}`;
  let y = dibujarTitulo(doc as any, titulo, subtitulo, 10, usable) + 1.5;

  const chips = [
    { texto: `Asignatura: ${m.asignatura}`, estilo: CHIP_INFO },
    { texto: `Año: ${m.ano}`, estilo: CHIP_ROSA },
    { texto: `Fecha: ${fechaHoyDDMM()}`, estilo: CHIP_NEUTRO },
  ];
  y = dibujarChips(doc as any, chips, 10, y, usable);

  // ── Corte evaluativo: fila propia ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(17, 24, 39);
  doc.text('Corte evaluativo:', 10, y);
  doc.setFont('helvetica', 'normal');
  doc.text(m.corte || '', 10 + doc.getTextWidth('Corte evaluativo: ') + 2, y);
  y += 6;

  // ── Indicador: fila propia (con descripción si la lleva) ──
  const desc = (input.descripcion || "").trim();
  const label = desc ? `Indicador ${input.orden}:` : `Indicador ${input.orden}`;
  doc.setFont('helvetica', 'bold');
  doc.text(label, 10, y);
  const totalPts = input.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0);
  if (desc) {
    doc.setFont('helvetica', 'normal');
    const xDesc = 10 + doc.getTextWidth(label) + 2;
    const descLines = doc.splitTextToSize(desc, rightMargin - xDesc);
    doc.text(descLines, xDesc, y);
    y += descLines.length * 4.6;
  } else {
    // Sin descripción: solo se pinta Indicador N sin colon vacio
  }
  return y + 2;
}

/**
 * Encabezado clásico (deprecated): el nuevo estándar es encabezadoInstrumento. */
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

  // ── Texto intro de la plantilla (objetivo/instrucciones del docente) ──
  const textoIntro = (input.plantilla?.textoIntro || '').trim();
  if (textoIntro) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    const introLines = doc.splitTextToSize(textoIntro, rightMargin - 10);
    doc.text(introLines, 10, y + 3);
    y += 3 + introLines.length * 4;
  }

  // ── Criterios ──
  if (input.criterios.length > 0) {
    y += 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Criterios:', 10, y);
    y += 5.2;
    const mostrarPts = input.plantilla?.mostrarPuntajeCriterios ?? true;
    for (const c of input.criterios) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      const numLabel = `${c.orden}.`;
      doc.text(numLabel, 14, y);
      const numW = doc.getTextWidth(numLabel) + 2;
      const ptsSuffix = mostrarPts ? ` (${c.puntajeMaximo} pts)` : '';

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

/** Tabla común: estudiantes × criterios (letras actuales) + columna final.
 *  `colFinal` viene de la plantilla: 'valoracion' | 'total' | 'ninguno'. */
function tablaEstudiantes(
  doc: any,
  input: InstrumentoInput,
  startY: number,
  autoTable: AutoTableFn,
  lastColLabel: string
): void {
  const colFinal = input.plantilla?.colFinal ?? 'valoracion';
  const conFinal = colFinal !== 'ninguno';
  const etiquetaFinal = colFinal === 'total' ? 'Total' : lastColLabel;
  const headers = conFinal
    ? ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`), etiquetaFinal]
    : ['#', 'Estudiante', ...input.criterios.map(c => `C${c.orden}`)];
  const rows = input.estudiantes.map((e, i) => {
    const base = [String(i + 1), e.nombre, ...input.criterios.map((_c, ci) => e.letras[ci] || '-')];
    return conFinal ? [...base, e.valoracion || '-'] : base;
  });
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.6, halign: 'center', textColor: 0, lineColor: [0, 0, 0], lineWidth: 0.35 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { halign: 'left', cellWidth: 'auto' },
      [headers.length - 1]: conFinal ? { fontStyle: 'bold' } : {},
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

/** Contexto de tokens de cabecera desde el input del PDF. */
function tokenDatosBase(input: InstrumentoInput): TokenDatos {
  const m = input.meta as unknown as Record<string, string>;
  return {
    metaSel: {
      COLEGIO: m.colegio, GRADO: m.grado, SECCION: m.seccion,
      ASIGNATURA: m.asignatura, CORTE: m.corte, ANO: m.ano,
    },
    indN: input.orden,
    indDesc: input.descripcion,
    criterios: input.criterios.map(c => c.descripcion),
  };
}

/**
 * Renderiza la CUADRÍCULA tipo Excel en PDF con dibujo manual (jsPDF puro,
 * NO autoTable: los merges col/row de la plantilla se dibujan como celdas
 * rectangulares arbitrarias). La fila de estudiantes se expande por alumno y
 * los encabezados se repiten en cada página.
 */
function construirGrid(doc: any, input: InstrumentoInput): void {
  const g: PlantillaGrid = input.plantilla!.grid!;
  const sinAI = !!input.cualitativo;
  const base: TokenDatos = { ...tokenDatosBase(input), sinAI };

  // Contexto cualitativo → columnas {AI} y {TOTAL} ELIMINADAS; las TC pasan a
  // ser la franja separadora entre criterios (no llevan valores).
  const { quitar, separador: sepOld } = columnasCualitativo(g, sinAI);
  const newIdx = new Map<number, number>();
  const keptCols: number[] = [];
  for (let c = 0; c < g.cols; c++) if (!quitar.has(c)) { newIdx.set(c, keptCols.length); keptCols.push(c); }
  const numCols = keptCols.length;

  // Cubiertos: "r:c" → celda dueña [r, c] (1 = horizontal, 2 = vertical cover).
  const cov = new Map<string, [number, number]>();
  for (const [k, cel] of Object.entries(g.celdas)) {
    const [r, c] = k.split(":").map(Number);
    for (let rr = r; rr < Math.min(r + (cel.rs ?? 1), g.filas); rr++)
      for (let cc = c; cc < Math.min(c + (cel.cs ?? 1), g.cols); cc++)
        if (rr !== r || cc !== c) cov.set(`${rr}:${cc}`, [r, c]);
  }

  // ── Anchos de columna: texto resuelto repartido entre las columnas que abarca ──
  const pw = (doc as any).internal.pageSize.getWidth();
  const ph = (doc as any).internal.pageSize.getHeight();
  const mx = 10;
  const usable = pw - 2 * mx;

  const natural: number[] = new Array(numCols).fill(4);
  for (const [k, cel] of Object.entries(g.celdas)) {
    const [, c0] = k.split(":").map(Number);
    const cs = Math.min(cel.cs ?? 1, g.cols - c0);
    const span: number[] = [];
    for (let cc = c0; cc < c0 + cs; cc++) if (!quitar.has(cc)) span.push(cc);
    if (span.length === 0) continue; // celda = {AI} colapsada
    const resolved = resolverTokens(cel.v ?? "", base);
    const llenar = Math.max(3, Math.min(resolved.length * 1.15, 30) / span.length + 2);
    for (const cc of span) natural[newIdx.get(cc)!] = Math.max(natural[newIdx.get(cc)!], llenar);
  }
  // La columna del nombre se dimensiona por el NOMBRE REAL más largo (no por el
  // encabezado "Estudiante", que es corto): así los nombres largos se envuelven
  // menos y no quedan apretados contra el borde.
  const maxNombre = input.estudiantes.reduce((m, e) => Math.max(m, (e.nombre || "").length), 0);
  if (maxNombre > 0) {
    for (const [k, cel] of Object.entries(g.celdas)) {
      if (cel.v !== "{ESTUDIANTE}") continue;
      const c0 = Number(k.split(":")[1]);
      const idx = newIdx.get(c0);
      if (idx !== undefined) natural[idx] = Math.max(natural[idx], Math.min(maxNombre * 1.15 + 2, 46));
    }
  }
  const suma = natural.reduce((a, b) => a + b, 0);
  const colW = natural.map(n => (n / suma) * usable);
  const cumW: number[] = [0];
  for (const w of colW) cumW.push(cumW[cumW.length - 1] + w);
  const xDe = (c: number) => mx + cumW[c];
  const wDe = (c0: number, cs: number) => cumW[Math.min(c0 + cs, numCols)] - cumW[c0];

  // ── Filas de salida (con expansión de la fila de estudiantes) ──
  // `rs` (rowspan) se dibuja de verdad: la celda de la fila r ocupa la altura
  // sumada de esa fila y las siguientes, y las filas de abajo NO vuelven a
  // pintarla (así no quedan "huecos" ni se duplican bordes). Sin esto, un merge
  // vertical dejaba la fila de abajo en blanco.
  type CelOut = { texto: string; c0: number; cs: number; rs: number; centrar: boolean; color?: string; sep: boolean };
  type FilaOut = { celdas: CelOut[]; estudiante: boolean; r: number };
  const filas: FilaOut[] = [];
  const filaLogical = (r: number, est?: { n: number; nombre: string; sexo?: string; letras: string[]; valoracion: string; total?: string; nf?: string; tcs?: string[] }): FilaOut | null => {
    const d: TokenDatos = est ? { ...base, est } : base;
    const celdas: CelOut[] = [];
    for (const [k, cel] of Object.entries(g.celdas)) {
      const [rr, oldC0] = k.split(":").map(Number);
      if (rr !== r) continue;
      // Re-ubicar la celda en el layout de SALIDA (columnas AI/TOTAL colapsadas).
      const oldCs = Math.min(cel.cs ?? 1, g.cols - oldC0);
      const span: number[] = [];
      for (let cc = oldC0; cc < oldC0 + oldCs; cc++) if (!quitar.has(cc)) span.push(cc);
      if (span.length === 0) continue;
      const raw = cel.v ?? "";
      // Franja separadora (TC en cualitativo): sin texto, solo el relleno.
      const esSep = (cel.cs ?? 1) === 1 && sepOld.has(oldC0);
      const texto = esSep ? "" : resolverTokens(raw, d);
      celdas.push({
        texto,
        c0: newIdx.get(span[0])!,
        cs: span.length,
        rs: cel.rs ?? 1,
        // Encabezados SIEMPRE centrados; en la fila de estudiantes solo los
        // tokens cortos (el nombre va a la izquierda).
        centrar: est ? centrarCelda(raw) : true,
        // Solo la fila de estudiantes lleva color: encabezados en negro.
        color: est ? colorDeCelda(raw, texto, input.colores, est.sexo) : undefined,
        sep: esSep,
      });
    }
    return celdas.length > 0 ? { celdas, estudiante: !!est, r } : null;
  };

  for (let r = 0; r < g.filas; r++) {
    const esEst = r === g.filaEstudiantes;
    if (esEst) {
      input.estudiantes.forEach((e, i) => {
        const f = filaLogical(r, {
          n: i + 1,
          nombre: e.nombre,
          sexo: e.sexo,
          letras: input.criterios.map((_, ci) => e.letras[ci] ?? ""),
          valoracion: e.valoracion || "",
          total: e.total || "",
          nf: e.nf || "",
          tcs: input.criterios.map((_, ci) => e.tcs?.[ci] ?? ""),
        });
        if (f) filas.push(f);
      });
      if (input.estudiantes.length === 0) {
        const f = filaLogical(r);
        if (f) filas.push(f);
      }
    } else {
      const f = filaLogical(r);
      if (f) filas.push(f);
    }
  }
  const filaHeaderCount = filas.findIndex(f => f.estudiante);
  const numHeader = filaHeaderCount < 0 ? filas.length : filaHeaderCount;

  // ── Dibujo ──
  // Encabezado estándar (chips + corte + indicador), igual que informe/reporte.
  const FONTE = 8; // pt
  const ALTO = FONTE * 0.3528 + 2.2; // línea de texto + padding (mm)
  let y = encabezadoInstrumento(doc, input) + 2;

  // Altura natural de cada fila (1 pasada, antes de dibujar) para poder pintar
  // los rowspans con la altura real.
  const altoDe = (f: FilaOut): number => {
    let alto = ALTO;
    // Incluye la fila de estudiantes: un nombre largo se envuelve a 2+ líneas
    // y, sin contarlo, el texto se salía por debajo de la cuadrícula.
    for (const cel of f.celdas) {
      const w = wDe(cel.c0, cel.cs) - 3;
      const lines = (doc as any).splitTextToSize(cel.texto || " ", w).length;
      alto = Math.max(alto, lines * (FONTE * 0.3528) + 2.4);
    }
    return alto;
  };
  const altos = filas.map(altoDe);

  const dibujarFila = (i: number): boolean => {
    const f = filas[i];
    // `y` avanza SOLO la altura de esta fila: un rowspan pinta su rectángulo
    // alto encima de las filas siguientes, pero NO las empuja hacia abajo (las
    // filas de abajo se dibujan en su propio carril y en otras columnas).
    const altoAvance = altos[i];
    // Para el corte de página, en cambio, hay que reservar la celda más alta
    // (si una abarca varias filas, la suma).
    let altoPagina = altoAvance;
    for (const cel of f.celdas) {
      if (cel.rs <= 1) continue;
      let suma = 0;
      for (let k2 = i; k2 < i + cel.rs && k2 < altos.length; k2++) suma += altos[k2];
      altoPagina = Math.max(altoPagina, suma);
    }
    if (y + altoPagina > ph - 12) return false;
    doc.setFont("helvetica", f.estudiante ? "normal" : "bold");
    doc.setFontSize(f.estudiante ? FONTE - 1 : FONTE - 0.5);
    // Bordes NEGROS (no grises) en toda la cuadrícula.
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);
    for (const cel of f.celdas) {
      const x = xDe(cel.c0);
      const w = wDe(cel.c0, cel.cs);
      // Alto de la celda: el suyo, o la suma de las filas que abarca (rowspan).
      let altoCel = altoAvance;
      if (cel.rs > 1) {
        altoCel = 0;
        for (let k2 = i; k2 < i + cel.rs && k2 < altos.length; k2++) altoCel += altos[k2];
      }
      doc.rect(x, y, w, altoCel);
      // Franja separadora (TC en cualitativo): relleno suave, sin texto.
      if (cel.sep) {
        doc.setFillColor(226, 232, 240);
        doc.rect(x, y, w, altoCel, "F");
        doc.setDrawColor(0, 0, 0);
        doc.rect(x, y, w, altoCel);
      }
      if (cel.texto) {
        const lines: string[] = (doc as any).splitTextToSize(cel.texto, w - 2.6);
        const hLinea = FONTE * 0.3528;
        const ty = y + (altoCel - lines.length * hLinea) / 2 + hLinea - 0.8;
        // Convención de colores del sistema (nota/sexo); negro por defecto.
        if (cel.color) {
          const rgb = rgbDe(cel.color);
          doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        } else {
          doc.setTextColor(0, 0, 0);
        }
        if (cel.centrar) doc.text(lines, x + w / 2, ty, { align: "center" });
        else doc.text(lines, x + 1.3, ty);
      }
    }
    y += altoAvance;
    return true;
  };

  for (let i = 0; i < filas.length; i++) {
    if (dibujarFila(i)) continue;
    // Sin espacio: página nueva, repetir encabezados (previos a la fila de
    // estudiantes) y reintentar la fila.
    doc.addPage();
    // Repetir el encabezado estándar en cada página nueva.
    y = encabezadoInstrumento(doc, input) + 2;
    for (let hh = 0; hh < numHeader && hh < i; hh++) dibujarFila(hh);
    if (!dibujarFila(i)) {
      // La fila sola demasiado larga: se dibuja recortada en vez de colgarse.
      dibujarFila(i);
    }
  }

  // Leyenda de la escala: la personalizada o la de la CONFIGURACIÓN real
  // (Globales → Calificaciones). La cuadrícula siempre tiene columnas de escala.
  const leyenda = (input.plantilla?.leyenda || '').trim()
    || leyendaEscalaConfig(input.colores?.escala, sinAI);
  if (leyenda) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const lineas = (doc as any).splitTextToSize(leyenda, usable);
    let ly = y + 6;
    for (const ln of lineas) { doc.text(ln, mx, ly); ly += 3.2; }
  }
}

/** Cuerpo del PDF: cuadrícula del constructor o diseño rápido del tipo. */
function construir(doc: any, input: InstrumentoInput, autoTable: AutoTableFn): void {
  // Modo cuadrícula: dibujo propio y listo (los headers/nombre ya no aplican).
  if (input.plantilla?.grid) {
    construirGrid(doc, input);
    return;
  }
  const def = input.plantilla;
  let startY = encabezadoInstrumento(doc, input);

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
        // Leyenda personalizada o la de la CONFIGURACIÓN real (nombres/siglas/
        // mínimos de Globales → Calificaciones). No se traduce: son datos.
        const leyenda = (def?.leyenda || '').trim() || leyendaEscalaConfig(input.colores?.escala, !!input.cualitativo);
        if (leyenda) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          const lineas = (doc as any).splitTextToSize(leyenda, (doc as any).internal.pageSize.getWidth() - 20);
          let ly = after + 6;
          for (const ln of lineas) { doc.text(ln, 10, ly); ly += 3.4; }
        }
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
  const dir = await carpetaInstrumento(subfolder);
  const fullPath = unirRuta(dir, fileName);
  await writeFile(fullPath, new Uint8Array(pdfData));
  // Abre el PDF recién generado (desktop: app predeterminada; Android: chooser).
  await abrirInstrumentoExportado(fullPath, 'application/pdf');
  return fullPath;
}

/** Orientación para UN indicador: la plantilla puede forzarla; 'auto' keeps
 *  rúbrica vertical y el resto horizontal. */
function orientacionDe(def: PlantillaDefinicion | undefined, tipo: InstrumentoTipo): 'portrait' | 'landscape' {
  if (def?.orientacion === 'horizontal') return 'landscape';
  if (def?.orientacion === 'vertical') return 'portrait';
  return tipo !== 'rubrica' ? 'landscape' : 'portrait';
}

/** Genera el PDF de UN indicador. Devuelve la ruta completa del archivo. */
export async function generarInstrumentoPDF(input: InstrumentoInput): Promise<string> {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = await loadAutoTable();
  const doc = new jsPDF({
    orientation: orientacionDe(input.plantilla, input.tipo),
    unit: 'mm',
    format: 'letter',
  });
  construir(doc, input, autoTable);
  const fileName = sanitize(`Instrumento_${tipoLabel(input.tipo)}_Ind${input.orden}_${sanitize(input.meta.asignatura)}_${sanitize(input.meta.grado)}${sanitize(input.meta.seccion)}.pdf`);
  const sub = subcarpetaInstrumento(input.meta.corte, input.meta.asignatura);
  return await guardarYEntregar(doc, fileName, sub);
}

/** Genera TODOS los inputs en un solo PDF (sección por indicador). */
export async function generarInstrumentosTodosPDF(inputs: InstrumentoInput[]): Promise<string> {
  if (inputs.length === 0) throw new Error('No hay instrumentos para generar');

  // Agrupar inputs por grado y sección para evitar sobreescritura al exportar
  // instrumentos de diferentes grados/secciones en el mismo PDF.
  const grupos = new Map<string, InstrumentoInput[]>();
  for (const input of inputs) {
    const key = `${input.meta.grado}|${input.meta.seccion}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(input);
  }

  if (grupos.size === 1) {
    // Un solo grupo: PDF multi-página (comportamiento anterior).
    return await generarUnSoloPDF(grupos.values().next().value!);
  }

  // Múltiples grados/secciones: generar un PDF por grupo y devolver la ruta del
  // primero (el caller en NotasPage muestra el toast con el conteo total).
  const rutas: string[] = [];
  for (const [, grupoInputs] of grupos) {
    const ruta = await generarUnSoloPDF(grupoInputs);
    rutas.push(ruta);
  }
  return rutas[0];
}

/** Genera un solo PDF multi-página a partir de inputs que comparten grado y sección. */
async function generarUnSoloPDF(inputs: InstrumentoInput[]): Promise<string> {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = await loadAutoTable();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  inputs.forEach((input, i) => {
    if (i > 0) doc.addPage();
    construir(doc, input, autoTable);
  });
  const first = inputs[0].meta;
  const fileName = sanitize(`Instrumentos_${first.asignatura ?? 'Asignatura'}_${first.corte ?? ''}_${first.grado}-${first.seccion}.pdf`);
  const sub = subcarpetaInstrumento(first.corte ?? '', first.asignatura ?? '');
  return await guardarYEntregar(doc, fileName, sub);
}
