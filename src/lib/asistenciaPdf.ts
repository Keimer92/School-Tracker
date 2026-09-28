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

const COLOR_P = [16, 185, 129] as const;
const COLOR_A = [239, 68, 68] as const;
const COLOR_J = [245, 158, 11] as const;
const COLOR_AMBAR = [180, 120, 0] as const;

interface EstiloAdaptado {
  fontSize: number;
  cellPadding: number;
  rotarFechas: boolean;
  anchoFecha: number;
}

/**
 * Cuantas más columnas Y más estudiantes, más chico todo: eso es lo que permite
 * que cada sección entre en una única hoja. El ajuste por filas es lo que
 * evita que un grado con 30-45 estudiantes se parta en dos páginas.
 *
 * El piso de 5.5pt es deliberado: por debajo el texto queda ilegible, y es
 * preferible que una sección enorme (60+ estudiantes en mensual) continue en
 * una segunda hoja antes que imprimir un PDF que no se puede leer.
 */
function estiloPara(nCols: number, nFilas: number): EstiloAdaptado {
  const porFilas = nFilas > 40 ? 0.78 : nFilas > 26 ? 0.88 : 1;
  const base = nCols <= 8
    ? { fontSize: 8, cellPadding: 1.2, rotarFechas: false, anchoFecha: 13 }
    : nCols <= 14
      ? { fontSize: 7, cellPadding: 0.9, rotarFechas: false, anchoFecha: 9 }
      : nCols <= 20
        ? { fontSize: 6, cellPadding: 0.7, rotarFechas: true, anchoFecha: 6 }
        : { fontSize: 5.5, cellPadding: 0.6, rotarFechas: true, anchoFecha: 5.5 };
  return {
    fontSize: Math.max(5.5, Math.round(base.fontSize * porFilas * 10) / 10),
    cellPadding: Math.max(0.5, Math.round(base.cellPadding * porFilas * 10) / 10),
    rotarFechas: base.rotarFechas,
    anchoFecha: base.anchoFecha,
  };
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

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.text(t.titulo, margins.left + 2, 12, { maxWidth: doc.internal.pageSize.getWidth() - margins.left - margins.right });
    doc.setFontSize(8.5);
    doc.text(t.subtitulo, margins.left + 2, 17.5, { maxWidth: doc.internal.pageSize.getWidth() - margins.left - margins.right });

    let y = 22;
    doc.setFontSize(7.5);
    doc.setTextColor(90, 100, 115);
    doc.text(meta.titulo, margins.left + 2, y);
    y += 4;
    for (const linea of meta.lineas) {
      doc.text(linea, margins.left + 2, y, { maxWidth: doc.internal.pageSize.getWidth() - margins.left - margins.right });
      y += 4;
    }
    if (t.nota) {
      doc.setTextColor(COLOR_AMBAR[0], COLOR_AMBAR[1], COLOR_AMBAR[2]);
      doc.text(`Sin clases: ${t.nota}`, margins.left + 2, y + 0.4, { maxWidth: doc.internal.pageSize.getWidth() - margins.left - margins.right });
      y += 4.6;
    }
    doc.setTextColor(0, 0, 0);

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
    const anchoUtil = doc.internal.pageSize.getWidth() - margins.left - margins.right;
    const columnStyles: Record<number, any> = t.layout === "diario"
      ? { 0: { cellWidth: 'auto' }, 1: { cellWidth: 16 }, 2: { cellWidth: 34 } }
      : { 0: { cellWidth: 'auto' }, 1: { cellWidth: 10 } };
    if (t.layout === "fechas") {
      const ultimaFecha = nCols - 4;
      for (let c = 2; c <= ultimaFecha; c++) {
        columnStyles[c] = { cellWidth: est.anchoFecha, halign: "center", minCellWidth: 0 };
      }
      for (let c = Math.max(2, ultimaFecha + 1); c < nCols; c++) {
        columnStyles[c] = { cellWidth: 10, halign: "center", fontStyle: "bold", minCellWidth: 0 };
      }
    }

    autoTable(doc, {
      startY: y,
      tableWidth: anchoUtil,
      margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
      head: [t.headers],
      body: body as any[][],
      styles: { fontSize: est.fontSize, cellPadding: est.cellPadding, overflow: "linebreak", valign: "middle", minCellWidth: 0 },
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: "bold", halign: "center", valign: "middle" },
      columnStyles,
      rowPageBreak: "avoid",
      didParseCell: (data: any) => {
        if (data.section === "head" && t.layout === "fechas" && est.rotarFechas && data.column.index >= 2) {
          data.cell.styles.angle = 90;
          data.cell.styles.valign = "bottom";
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
        doc.setFontSize(7);
        doc.setTextColor(120, 130, 145);
        doc.text(`Hoja ${actual}/${paginas} · ${i + 1}/${tablas.length} secciones`, margins.left + 2, doc.internal.pageSize.getHeight() - 4);
        doc.setTextColor(0, 0, 0);
      },
    });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
