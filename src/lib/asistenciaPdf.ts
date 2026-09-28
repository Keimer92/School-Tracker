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
  /** Chip propio de esta hoja (p. ej. la sección que le corresponde). */
  chip?: string;
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
 * El piso de 6.5pt es deliberado: por debajo el texto queda ilegible, y es
 * preferible que una sección enorme (60+ estudiantes en mensual) continue en
 * una segunda hoja antes que imprimir un PDF que no se puede leer.
 */
function estiloPara(nCols: number, nFilas: number): EstiloAdaptado {
  const porFilas = nFilas > 44 ? 0.8 : nFilas >= 32 ? 0.86 : nFilas >= 26 ? 0.9 : 1;
  const base = nCols <= 8
    ? { fontSize: 10, cellPadding: 1.4, anchoFecha: 15 }
    : nCols <= 14
      ? { fontSize: 9, cellPadding: 1.1, anchoFecha: 12 }
      : nCols <= 20
        ? { fontSize: 8, cellPadding: 0.9, anchoFecha: 9.5 }
        : { fontSize: 7.5, cellPadding: 0.8, anchoFecha: 8.5 };
  return {
    fontSize: Math.max(6.5, Math.round(base.fontSize * porFilas * 10) / 10),
    cellPadding: Math.max(0.7, Math.round(base.cellPadding * porFilas * 10) / 10),
    anchoFecha: base.anchoFecha,
  };
}

const ANCHO_NOMBRE_MIN = 50;
const ANCHO_SEXO = 9;
const ANCHO_TOTAL = 9;
const EM_ANCHO_DDMM = 2.502;
const ALTO_CHIP = 6.4;
const SEPARACION_CHIP = 2.2;
const RELLENO_CHIP = 2.6;
/**
 * Un solo grosor para TODOS los bordes (tabla, encabezado y chips).
 *
 * autoTable no dibuja líneas sino rectángulos rellenos de `lineWidth` mm. Con un
 * grosor de 0.2mm la línea queda en SUB-PÍXEL y cada visor la rasteriza a 1 o
 * 2 píxeles según dónde caiga, así que unas líneas se ven más gruesas que
 * otras aunque todas midan lo mismo. A 0.5mm (~1.4px a 96dpi) cada borde cae
 * siempre en un píxel completo y se ve uniforme de verdad.
 */
const GROSOR_LINEA_TABLA = 0.5;

interface EstiloChip {
  bg: readonly number[];
  border: readonly number[];
  text: readonly number[];
}

/** Chip verde claro: mismo lenguaje visual que el header de Imprimir. */
const CHIP_PRINCIPAL: EstiloChip = {
  bg: [236, 253, 245],
  border: [110, 231, 183],
  text: [6, 95, 70],
};
const CHIP_NEUTRO: EstiloChip = {
  bg: [249, 250, 251],
  border: [209, 213, 219],
  text: [55, 65, 81],
};
const CHIP_ALERTA: EstiloChip = {
  bg: [255, 251, 235],
  border: [252, 211, 77],
  text: [146, 64, 14],
};

/**
 * Dibuja una etiqueta redondeada y devuelve su ancho. El texto se mide DESPUÉS
 * de fijar el cuerpo de fuente, porque getTextWidth depende del tamaño activo.
 */
function dibujarChip(doc: any, x: number, y: number, texto: string, estilo: EstiloChip, fontSize = 8): number {
  doc.setFontSize(fontSize);
  const ancho = doc.getTextWidth(texto) + RELLENO_CHIP * 2;
  doc.setFillColor(estilo.bg[0], estilo.bg[1], estilo.bg[2]);
  doc.setDrawColor(estilo.border[0], estilo.border[1], estilo.border[2]);
  doc.setLineWidth(GROSOR_LINEA_TABLA);
  doc.roundedRect(x, y, ancho, ALTO_CHIP, 1.8, 1.8, "FD");
  doc.setTextColor(estilo.text[0], estilo.text[1], estilo.text[2]);
  doc.text(texto, x + RELLENO_CHIP, y + ALTO_CHIP / 2, { baseline: "middle" });
  return ancho;
}

/**
 * Coloca una lista de chips en filas, saltando de línea cuando se acaba el
 * ancho. Devuelve la coordenada Y donde puede empezar la tabla.
 */
function dibujarChips(
  doc: any,
  chips: { texto: string; estilo: EstiloChip }[],
  x0: number,
  y0: number,
  anchoUtil: number
): number {
  let x = x0;
  let y = y0;
  for (const chip of chips) {
    doc.setFontSize(8);
    const ancho = doc.getTextWidth(chip.texto) + RELLENO_CHIP * 2;
    if (x + ancho > x0 + anchoUtil && x > x0) {
      x = x0;
      y += ALTO_CHIP + 1.8;
    }
    dibujarChip(doc, x, y, chip.texto, chip.estilo);
    x += ancho + SEPARACION_CHIP;
  }
  return y + ALTO_CHIP + 4;
}

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
  const rangos: { inicio: number; fin: number }[] = [];

  for (let i = 0; i < tablas.length; i++) {
    const t = tablas[i];
    if (i > 0) doc.addPage();
    const paginaInicio = doc.internal.getCurrentPageInfo().pageNumber;
    const est = estiloPara(t.headers.length, t.body.length);

    const anchoPagina = doc.internal.pageSize.getWidth();
    const anchoUtil = anchoPagina - margins.left - margins.right;

    doc.setFontSize(15);
    doc.setTextColor(COLOR_TITULO[0], COLOR_TITULO[1], COLOR_TITULO[2]);
    doc.setFillColor(16, 185, 129);
    doc.roundedRect(margins.left, 8.5, 1.8, 11, 0.9, 0.9, "F");
    doc.text(t.titulo, margins.left + 4.4, 12.5, { maxWidth: anchoUtil - 4.4 });
    doc.setFontSize(9.5);
    doc.setTextColor(COLOR_SUBDITULO[0], COLOR_SUBDITULO[1], COLOR_SUBDITULO[2]);
    doc.text(t.subtitulo, margins.left + 4.4, 18, { maxWidth: anchoUtil - 4.4 });

    const chips: { texto: string; estilo: EstiloChip }[] = [];
    chips.push({ texto: meta.titulo, estilo: CHIP_PRINCIPAL });
    meta.lineas.forEach((linea, idx) => {
      chips.push({ texto: linea, estilo: idx === 0 ? CHIP_PRINCIPAL : CHIP_NEUTRO });
    });
    if (t.chip) chips.push({ texto: t.chip, estilo: CHIP_NEUTRO });
    if (t.nota) chips.push({ texto: `Sin clases: ${t.nota}`, estilo: CHIP_ALERTA });

    const y = dibujarChips(doc, chips, margins.left, 21, anchoUtil);

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
      didDrawPage: undefined,
    });

    rangos.push({ inicio: paginaInicio, fin: doc.getNumberOfPages() });
  }

  /**
   * El pie se dibuja al final, ya con el total real de páginas. Dibujarlo
   * dentro de didDrawPage daba "Hoja 1/1" en cada hoja, porque en ese momento
   * las hojas siguientes todavía no existían.
   */
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const idx = rangos.findIndex(r => p >= r.inicio && p <= r.fin);
    const rango = idx >= 0 ? rangos[idx] : { inicio: p, fin: p };
    const hojasDeSeccion = rango.fin - rango.inicio + 1;
    const dentro = p - rango.inicio + 1;
    const sufijo = hojasDeSeccion > 1 ? ` · hoja ${dentro} de ${hojasDeSeccion}` : "";
    doc.setFontSize(7.5);
    doc.setTextColor(COLOR_SUBDITULO[0], COLOR_SUBDITULO[1], COLOR_SUBDITULO[2]);
    doc.text(
      `Página ${p} de ${total} · Sección ${idx + 1} de ${tablas.length}${sufijo}`,
      margins.left + 2,
      doc.internal.pageSize.getHeight() - 4
    );
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
