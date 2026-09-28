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

export type CeldaPdf = string | { content: string; rowSpan?: number; styles?: Record<string, any> };

export interface TablaAsistenciaPdf {
  titulo: string;
  subtitulo: string;
  layout: "diario" | "fechas";
  headers: string[];
  body: CeldaPdf[][];
  combinada?: { indice: number; texto: string };
  nota?: string;
}

export interface MetaPdfAsistencia {
  titulo: string;
  lineas: string[];
}

const COLOR_P = [4, 120, 87] as const;
const COLOR_A = [185, 28, 28] as const;
const COLOR_J = [161, 98, 7] as const;
const COLOR_AMBAR = [146, 64, 14] as const;
const COLOR_BORDE = [17, 24, 39] as const;
const COLOR_ENCABEZADO = [209, 250, 229] as const;
const COLOR_ENCABEZADO_TXT = [6, 78, 59] as const;
const COLOR_TITULO = [17, 24, 39] as const;
const COLOR_SUBDITULO = [75, 85, 99] as const;
const COLOR_ALERTA = [252, 211, 77] as const;

interface EstiloAdaptado {
  fontSize: number;
  cellPadding: number;
  anchoFecha: number;
}

/**
 * Cuantas más columnas Y más estudiantes, más chico todo: eso es lo que permite
 * que cada sección entre en una única hoja. El ajuste por filas es lo que
 * evita que un grado con 30-45 estudiantes se parta en dos páginas.
 *
 * Los encabezados de fecha NUNCA se rotan: se ensanchan las columnas hasta que
 * `dd/mm` cabe en una sola línea, igual que en la vista de impresión. Por eso
 * `anchoFecha` se mantiene holgado en vez de quedarse en 5mm.
 *
 * El piso de 5.5pt es deliberado: por debajo el texto queda ilegible, y es
 * preferible que una sección enorme (60+ estudiantes en mensual) continue en
 * una segunda hoja antes que imprimir un PDF que no se puede leer.
 */
function estiloPara(nCols: number, nFilas: number): EstiloAdaptado {
  const porFilas = nFilas > 40 ? 0.78 : nFilas > 26 ? 0.88 : 1;
  const base = nCols <= 8
    ? { fontSize: 9, cellPadding: 1.2, anchoFecha: 14 }
    : nCols <= 14
      ? { fontSize: 8, cellPadding: 0.9, anchoFecha: 11 }
      : nCols <= 20
        ? { fontSize: 7, cellPadding: 0.7, anchoFecha: 8.5 }
        : { fontSize: 6.5, cellPadding: 0.6, anchoFecha: 7.5 };
  return {
    fontSize: Math.max(5.5, Math.round(base.fontSize * porFilas * 10) / 10),
    cellPadding: Math.max(0.5, Math.round(base.cellPadding * porFilas * 10) / 10),
    anchoFecha: base.anchoFecha,
  };
}

const ANCHO_NOMBRE_MIN = 50;
const ANCHO_SEXO = 9;
const ANCHO_TOTAL = 9;
const EM_ANCHO_DDMM = 2.502;

/**
 * Ancho de cada columna de fecha. Se reparte el espacio que dejan el nombre
 * (con un mínimo legible), el sexo y las tres columnas P/A/J, de modo que un
 * mes de 31 días no ahogue la columna del nombre. Se acota para que no crezca
 * de más cuando hay pocas fechas.
 */
function anchoFechaPara(nFechas: number, anchoUtil: number): number {
  const libre = anchoUtil - ANCHO_NOMBRE_MIN - ANCHO_SEXO - 3 * ANCHO_TOTAL;
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

function colorDeEstado(valor: string): readonly number[] | null {
  if (valor === "P") return COLOR_P;
  if (valor === "A") return COLOR_A;
  if (valor === "J") return COLOR_J;
  return null;
}

/**
 * El export de jspdf/jspdf-autotable llega con distinta forma segun el
 * empaquetador: en Vite es `mod.default`, pero al correr el modulo fuera del
 * bundle (node, pruebas) queda anidado en `mod.default.default`. Se resuelve
 * cualquiera de las dos.
 */
function resolverExport(mod: any, nombre: string): any {
  if (typeof mod === "function") return mod;
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.default?.default === "function") return mod.default.default;
  if (typeof mod?.[nombre] === "function") return mod[nombre];
  if (typeof mod?.default?.[nombre] === "function") return mod.default[nombre];
  throw new Error(`No se pudo cargar "${nombre}"`);
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

  for (let i = 0; i < tablas.length; i++) {
    const t = tablas[i];
    if (i > 0) doc.addPage();
    const est = estiloPara(t.headers.length, t.body.length);

    const anchoPagina = doc.internal.pageSize.getWidth();
    const anchoUtil = anchoPagina - margins.left - margins.right;

    doc.setFontSize(15);
    doc.setTextColor(COLOR_TITULO[0], COLOR_TITULO[1], COLOR_TITULO[2]);
    doc.text(t.titulo, margins.left + 2, 12.5, { maxWidth: anchoUtil });
    doc.setFontSize(9.5);
    doc.setTextColor(COLOR_SUBDITULO[0], COLOR_SUBDITULO[1], COLOR_SUBDITULO[2]);
    doc.text(t.subtitulo, margins.left + 2, 18, { maxWidth: anchoUtil });

    let y = 22.5;
    doc.setFontSize(8);
    doc.setTextColor(COLOR_SUBDITULO[0], COLOR_SUBDITULO[1], COLOR_SUBDITULO[2]);
    doc.text(meta.titulo, margins.left + 2, y, { maxWidth: anchoUtil });
    y += 4.2;
    for (const linea of meta.lineas) {
      doc.text(linea, margins.left + 2, y, { maxWidth: anchoUtil });
      y += 4.2;
    }
    if (t.nota) {
      doc.setDrawColor(COLOR_ALERTA[0], COLOR_ALERTA[1], COLOR_ALERTA[2]);
      doc.setLineWidth(0.6);
      doc.line(margins.left, y - 2.4, margins.left + anchoUtil, y - 2.4);
      doc.setTextColor(COLOR_AMBAR[0], COLOR_AMBAR[1], COLOR_AMBAR[2]);
      doc.text(`Sin clases: ${t.nota}`, margins.left + 2, y + 1.2, { maxWidth: anchoUtil });
      y += 6;
    }

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
    const nFechas = t.layout === "fechas" ? Math.max(0, nCols - 5) : 0;
    const anchoFecha = t.layout === "fechas" ? anchoFechaPara(nFechas, anchoUtil) : 0;
    const fontFecha = t.layout === "fechas" ? fontFechaCabe(anchoFecha, est.cellPadding, est.fontSize) : est.fontSize;

    const columnStyles: Record<number, any> = t.layout === "diario"
      ? { 0: { cellWidth: 'auto' }, 1: { cellWidth: 16 }, 2: { cellWidth: 34 } }
      : {
          0: { cellWidth: 'auto', minCellWidth: ANCHO_NOMBRE_MIN, fontStyle: "bold", textColor: [0, 0, 0] },
          1: { cellWidth: ANCHO_SEXO },
        };
    if (t.layout === "fechas") {
      const ultimaFecha = nCols - 4;
      for (let c = 2; c <= ultimaFecha; c++) {
        columnStyles[c] = { cellWidth: anchoFecha, halign: "center", minCellWidth: 0 };
      }
      for (let c = Math.max(2, ultimaFecha + 1); c < nCols; c++) {
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
        lineWidth: 0.2,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: COLOR_ENCABEZADO,
        textColor: COLOR_ENCABEZADO_TXT,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        lineColor: COLOR_BORDE,
        lineWidth: 0.25,
        minCellHeight: 6,
      },
      alternateRowStyles: { fillColor: [247, 253, 250] },
      columnStyles,
      rowPageBreak: "avoid",
      didParseCell: (data: any) => {
        if (data.section === "head" && t.layout === "fechas" && data.column.index >= 2 && data.column.index <= nCols - 4) {
          data.cell.styles.overflow = "visible";
          data.cell.styles.fontSize = fontFecha;
        }
        if (data.section === "body" && data.column.index === 0) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = [0, 0, 0];
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
      didDrawPage: () => {
        const paginas = doc.getNumberOfPages();
        const actual = doc.getCurrentPageInfo().pageNumber;
        doc.setFontSize(7.5);
        doc.setTextColor(COLOR_SUBDITULO[0], COLOR_SUBDITULO[1], COLOR_SUBDITULO[2]);
        doc.text(`Hoja ${actual}/${paginas} · Sección ${i + 1} de ${tablas.length}`, margins.left + 2, doc.internal.pageSize.getHeight() - 4);
        doc.setTextColor(0, 0, 0);
      },
    });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
