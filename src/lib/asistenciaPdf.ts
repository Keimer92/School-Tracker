/**
 * asistenciaPdf.ts — generador COMPARTIDO de PDFs de asistencia multipágina.
 *
 * Produce UN solo PDF donde cada grado/sección ocupa su propia hoja. El layout
 * se adapta al número de columnas para que, siempre que se pueda, la tabla
 * completa entre en una única página:
 *   - diario/semanal  → tipografía cómoda, una hoja garantizada por sección
 *   - mensual (≈22 días) → tipografía pequeña + encabezados de fecha rotados
 *                         90°, que es lo que permite que quepa en una hoja
 *   - si aun así no cabe (secciones con muchos estudiantes), autoTable
 *     continua en la hoja siguiente en vez de cortar filas a la mitad.
 *
 * jspdf y jspdf-autotable se cargan de forma LAZILY (`await import`) para no
 * penalizar el arranque de la app.
 *
 * El lenguaje visual (paleta, chips, grosor de borde, título, pie) vive en
 * `pdfChrome.ts`, compartido con el reporte de notas, para que ambos PDF se
 * vean como hermanos. Acá solo queda lo específico de la asistencia: el
 * cálculo del ancho de columna de fecha y los colores de los estados P/A/J.
 *
 * ── Uso rápido ─────────────────────────────────────────────────────────
 * ```ts
 * import { generarPdfAsistencia } from "../lib/asistenciaPdf";
 *
 * const bytes = await generarPdfAsistencia(
 *   { titulo: "Reporte de Asistencia", lineas: ["Periodo: SEMANAL (2026-03-02 al 2026-03-08)"] },
 *   [{ titulo: "3er grado - Sección C", subtitulo: "Candelario Sotelo", layout: "fechas",
 *      headers: ["Estudiante", "Sexo", "02/03", "…", "P", "A", "J"],
 *      body: [["Ana Pérez", "F", "P", "…", 3, 1, 0]] }]
 * );
 * ```
 */

/** Colores por estado de asistencia: P verde, A rojo, J ámbar. */
const COLOR_P = [4, 120, 87] as const;
const COLOR_A = [185, 28, 28] as const;
const COLOR_J = [161, 98, 7] as const;
const COLOR_AMBAR = [146, 64, 14] as const;

import {
  COLOR_ENCABEZADO,
  COLOR_ENCABEZADO_TXT,
  COLOR_BORDE,
  GROSOR_LINEA_TABLA,
  CHIP_PRINCIPAL,
  CHIP_NEUTRO,
  CHIP_ALERTA,
  PALETA_CHIPS,
  type EstiloChip,
  estiloPara,
  dibujarChips,
  dibujarTitulo,
  dibujarPie,
  resolverExport,
  hexToRgb,
} from "./pdfChrome";
import { colorSexoExport } from "./coloresSexo.svelte";

export type CeldaPdf = string | number | { content: string | number; rowSpan?: number; styles?: Record<string, any> };

export interface TablaAsistenciaPdf {
  titulo: string;
  subtitulo: string;
  layout: "diario" | "fechas";
  headers: string[];
  body: CeldaPdf[][];
  /**
   * Sexo de cada fila de `body`, en el MISMO orden. No es una columna de la
   * tabla: la tabla ya no lleva la columna "Sexo" (repetía lo que el color del
   * nombre dice), pero el PDF necesita el dato para teñir cada nombre.
   * Si falta, los nombres salen en negro.
   */
  sexos?: string[];
  combinada?: { indice: number; texto: string };
  /** Chip propio de esta hoja (p. ej. la sección que le corresponde). */
  chip?: string;
  nota?: string;
}

export interface MetaPdfAsistencia {
  titulo: string;
  lineas: string[];
}

const ANCHO_NOMBRE_MIN = 50;
const ANCHO_TOTAL = 9;
const EM_ANCHO_DDMM = 2.502;

/** Color por estado de asistencia: P verde, A rojo, J ámbar. */
function colorDeEstado(valor: string): readonly number[] | null {
  if (valor === "P") return COLOR_P;
  if (valor === "A") return COLOR_A;
  if (valor === "J") return COLOR_J;
  return null;
}

/**
 * Ancho de cada columna de fecha. Se reparte el espacio que dejan el nombre
 * (con un mínimo legible) y las tres columnas P/A/J, de modo que un mes de 31
 * días no ahogue la columna del nombre. Se acota para que no crezca de más
 * cuando hay pocas fechas.
 *
 * La columna "Sexo" ya no se cuenta: se eliminó de la tabla (ver
 * `TablaAsistenciaPdf.sexos`), así que ese ancho vuelve a las fechas.
 */
function anchoFechaPara(nFechas: number, anchoUtil: number): number {
  const libre = anchoUtil - ANCHO_NOMBRE_MIN - 3 * ANCHO_TOTAL;
  return Math.max(5.2, Math.min(14, libre / Math.max(1, nFechas)));
}

/**
 * Mayor cuerpo de fuente con el que `dd/mm` sigue entrando en UNA sola línea
 * dentro del ancho disponible. Evita que el encabezado se parta en dos renglones
 * cuando el mes tiene muchos días.
 */
function fontFechaCabe(ancho: number, cellPadding: number, fontSize: number): number {
  const util = ancho - 2 * cellPadding;
  const max = util / (EM_ANCHO_DDMM * 0.3528);
  return Math.max(4.5, Math.min(fontSize, Math.round(max * 10) / 10));
}

export async function generarPdfAsistencia(
  meta: MetaPdfAsistencia,
  tablas: TablaAsistenciaPdf[]
): Promise<Uint8Array> {
  const modJsPdf = await import("jspdf");
  const modAutoTable = await import("jspdf-autotable");
  const JsPDF = resolverExport(modJsPdf, "jsPDF");
  const autoTable = resolverExport(modAutoTable, "autoTable");
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const margins = { top: 10, bottom: 12, left: 10, right: 10 };
  const rangos: { inicio: number; fin: number }[] = [];

  for (let i = 0; i < tablas.length; i++) {
    const t = tablas[i];
    if (i > 0) doc.addPage();
    const paginaInicio = doc.internal.getCurrentPageInfo().pageNumber;
    const est = estiloPara(t.headers.length, t.body.length);

    const anchoPagina = doc.internal.pageSize.getWidth();
    const anchoUtil = anchoPagina - margins.left - margins.right;

    // Título y subtítulo con barra de acento (compartido con el PDF de notas).
    const yTitulo = dibujarTitulo(doc, t.titulo, t.subtitulo, margins.left, anchoUtil);

    const chips: { texto: string; estilo: EstiloChip }[] = [];
    chips.push({ texto: meta.titulo, estilo: CHIP_PRINCIPAL });
    // Cada línea de metadatos con un color distinto de la paleta, para que se
    // distingan de un vistazo en lugar de verse todas del mismo gris.
    meta.lineas.forEach((linea, idx) => {
      chips.push({ texto: linea, estilo: PALETA_CHIPS[idx % PALETA_CHIPS.length] });
    });
    if (t.chip) chips.push({ texto: t.chip, estilo: CHIP_NEUTRO });
    if (t.nota) chips.push({ texto: `Sin clases: ${t.nota}`, estilo: CHIP_ALERTA });

    const y = dibujarChips(doc, chips, margins.left, yTitulo, anchoUtil);

    const n = t.body.length;
    const body: CeldaPdf[][] = t.body.map((fila, idx) => {
      const f = [...fila];
      if (t.combinada) {
        f[t.combinada.indice] = idx === 0 && n > 0
          ? {
              content: t.combinada.texto,
              rowSpan: n,
              styles: { halign: "center", valign: "middle", fontStyle: "bold", textColor: COLOR_AMBAR },
            }
          : "";
      }
      return f;
    });

    const nCols = t.headers.length;
    // Columnas: 0 = nombre, luego N fechas, y al final P/A/J (3).
    // La columna "Sexo" ya no existe: el nombre va teñido.
    const nFechas = t.layout === "fechas" ? Math.max(0, nCols - 4) : 0;
    const anchoFecha = t.layout === "fechas" ? anchoFechaPara(nFechas, anchoUtil) : 0;
    const fontFecha = t.layout === "fechas" ? fontFechaCabe(anchoFecha, est.cellPadding, est.fontSize) : est.fontSize;

    const columnStyles: Record<number, any> = t.layout === "diario"
      ? { 0: { cellWidth: 'auto' }, 1: { cellWidth: 34 } }
      : {
          0: { cellWidth: 'auto', minCellWidth: ANCHO_NOMBRE_MIN, fontStyle: "bold", textColor: [0, 0, 0] },
        };
    if (t.layout === "fechas") {
      const ultimaFecha = nCols - 4;
      for (let c = 1; c <= ultimaFecha; c++) {
        columnStyles[c] = { cellWidth: anchoFecha, halign: "center", minCellWidth: 0 };
      }
      for (let c = Math.max(1, ultimaFecha + 1); c < nCols; c++) {
        columnStyles[c] = { cellWidth: ANCHO_TOTAL, halign: "center", fontStyle: "bold", minCellWidth: 0 };
      }
    }

    autoTable(doc, {
      startY: y,
      tableWidth: anchoUtil,
      margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
      head: [t.headers],
      body: body as any[][],
      styles: {
        fontSize: est.fontSize,
        cellPadding: est.cellPadding,
        overflow: "linebreak",
        valign: "middle",
        minCellWidth: 0,
        lineColor: COLOR_BORDE,
        lineWidth: GROSOR_LINEA_TABLA,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: COLOR_ENCABEZADO,
        textColor: COLOR_ENCABEZADO_TXT,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        lineColor: COLOR_BORDE,
        lineWidth: GROSOR_LINEA_TABLA,
        minCellHeight: 6,
      },
      alternateRowStyles: { fillColor: [247, 253, 250] },
      tableLineWidth: GROSOR_LINEA_TABLA,
      columnStyles,
      rowPageBreak: "avoid",
      didParseCell: (data: any) => {
        if (data.section === "head" && t.layout === "fechas" && data.column.index >= 1 && data.column.index <= nCols - 4) {
          data.cell.styles.overflow = "visible";
          data.cell.styles.fontSize = fontFecha;
        }
        if (data.section === "body" && data.column.index === 0) {
          // El nombre hereda el color de sexo elegido en Ajustes, igual que en
          // la pantalla. Sin `sexos` (o sin dato) el nombre queda negro.
          const sexo = t.sexos?.[data.row.index];
          const [r, g, b] = hexToRgb(colorSexoExport(sexo));
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = sexo ? [r, g, b] : [0, 0, 0];
          data.cell.styles.halign = "left";
        }
        if (data.section === "body") {
          const color = colorDeEstado(String(data.cell.raw));
          if (color) {
            data.cell.styles.textColor = color;
            data.cell.styles.fontStyle = "bold";
          }
        }
      },
      didDrawPage: undefined,
    });

    rangos.push({ inicio: paginaInicio, fin: doc.getNumberOfPages() });
  }

  /**
   * El pie se dibuja al final, ya con el total real de páginas (misma razón que
   * en `dibujarPie`: dentro de didDrawPage salía "Hoja 1/1" en cada hoja).
   */
  dibujarPie(doc, tablas.length, rangos, margins.left, "Sección");

  return new Uint8Array(doc.output("arraybuffer"));
}
