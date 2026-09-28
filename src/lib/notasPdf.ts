/**
 * notasPdf.ts — generador del reporte de CALIFICACIONES en PDF.
 *
 * Usa el mismo lenguaje visual que el reporte de asistencia (`pdfChrome.ts`):
 * barra de acento en el título, chips redondeados con los metadatos, encabezados
 * de tabla en verde claro, bordes de 0.5mm y pie con paginación real. Así los
 * dos reportes se leen como hermanos aunque cada tabla tenga su propio layout.
 *
 * A diferencia de asistencia, acá cada par grado/sección se exporta a su propio
 * archivo (lo que hace el bucle de ReportesPage), por lo que este generador
 * produce un PDF de UNA hoja por grupo y por eso el pie no necesita la lógica de
 * "sección N de M" multipágina.
 *
 * jspdf y jspdf-autotable se cargan de forma LAZILY (`await import`).
 *
 * ── Uso rápido ─────────────────────────────────────────────────────────
 * ```ts
 * import { generarPdfNotas } from "../lib/notasPdf";
 *
 * const bytes = await generarPdfNotas({
 *   colegio: "Candelario Sotelo",
 *   grado: "3er grado",
 *   seccion: "A",
 *   asignatura: "Ingles",
 *   corte: "1er corte evaluativo",
 *   ano: "2026",
 *   cualitativo: false,
 *   totalEstudiantes: 24,
 *   promedio: "78 (AS)",
 *   filas: [["Ana Pérez", "F", "78 (AS)"]],
 *   colorDeFila: (i) => "#22c55e",
 * });
 * ```
 */

import {
  COLOR_ENCABEZADO,
  COLOR_ENCABEZADO_TXT,
  COLOR_BORDE,
  GROSOR_LINEA_TABLA,
  CHIP_PRINCIPAL,
  CHIP_NEUTRO,
  CHIP_ALERTA,
  CHIP_INFO,
  CHIP_VIOLETA,
  CHIP_ROSA,
  estiloPara,
  dibujarChips,
  dibujarTitulo,
  dibujarPie,
  resolverExport,
} from "./pdfChrome";

export interface FilaNotaPdf {
  nombre: string;
  sexo: string;
  /** Texto de la celda de nota (ej. "78 (AS)" o "-" si no tiene nota). */
  nota: string;
  /** Color hexadecimal de la nota, o undefined para usar el gris neutro. */
  color?: string;
}

export interface MetaPdfNotas {
  colegio: string;
  grado: string;
  seccion: string;
  asignatura: string;
  corte: string;
  ano: string;
  /** El grado es cualitativo: la nota se muestra como etiqueta (AA/AS/AF/AI). */
  cualitativo: boolean;
  totalEstudiantes: number;
  promedio: string;
  filas: FilaNotaPdf[];
  /** Fecha de emisión; si se omite se usa la de hoy. */
  fecha?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? h.split("").map(c => c + c).join("")
    : h;
  const v = parseInt(n, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export async function generarPdfNotas(meta: MetaPdfNotas): Promise<Uint8Array> {
  const modJsPdf = await import("jspdf");
  const modAutoTable = await import("jspdf-autotable");
  const JsPDF = resolverExport(modJsPdf, "jsPDF");
  const autoTable = resolverExport(modAutoTable, "autoTable");

  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const margins = { top: 10, bottom: 12, left: 10, right: 10 };
  const anchoPagina = doc.internal.pageSize.getWidth();
  const anchoUtil = anchoPagina - margins.left - margins.right;
  const fecha = meta.fecha || new Date().toLocaleDateString();

  const titulo = `Notas ${meta.grado} - Sección ${meta.seccion}`;
  const subtitulo = meta.colegio;
  const yTitulo = dibujarTitulo(doc, titulo, subtitulo, margins.left, anchoUtil);

  // Un color por chip: el lector identifica de un vistazo a qué corresponde
  // cada dato (asignatura, corte, año) sin leerlos todos.
  const chips = [
    { texto: "Reporte de Notas", estilo: CHIP_PRINCIPAL },
    { texto: `Asignatura: ${meta.asignatura}`, estilo: CHIP_INFO },
    { texto: `Corte: ${meta.corte}`, estilo: CHIP_VIOLETA },
    { texto: `Año Lectivo: ${meta.ano}`, estilo: CHIP_ROSA },
  ];
  // En un grado cualitativo la nota es una etiqueta (AA/AS/AF/AI), no un número
  // sobre 100: ese chip reemplaza al de máximo, que era redundante.
  if (meta.cualitativo) chips.push({ texto: "Cualitativo", estilo: CHIP_ALERTA });
  chips.push({ texto: `Fecha: ${fecha}`, estilo: CHIP_NEUTRO });
  const y = dibujarChips(doc, chips, margins.left, yTitulo, anchoUtil);

  const est = estiloPara(3, meta.filas.length);
  const headers = ["Estudiante", "Sexo", "Nota Final"];
  const body = meta.filas.map(f => [f.nombre, f.sexo, f.nota]);

  autoTable(doc, {
    startY: y,
    tableWidth: anchoUtil,
    margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
    head: [headers],
    body,
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
    columnStyles: {
      0: { cellWidth: "auto", minCellWidth: 50, fontStyle: "bold", halign: "left" },
      1: { cellWidth: 14, halign: "center" },
      2: { cellWidth: 30, halign: "center", fontStyle: "bold" },
    },
    rowPageBreak: "avoid",
    didParseCell: (data: any) => {
      if (data.section === "body" && data.column.index === 2) {
        const fila = meta.filas[data.row.index];
        if (fila?.color) {
          const [r, g, b] = hexToRgb(fila.color);
          data.cell.styles.textColor = [r, g, b];
        } else {
          data.cell.styles.textColor = [100, 116, 139];
        }
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // Resumen debajo de la tabla (total + promedio grupal).
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const anchoCaja = 42;
  const gap = 4;
  const cajas = [
    { etiqueta: "Total Estudiantes", valor: String(meta.totalEstudiantes) },
    { etiqueta: "Promedio Grupal", valor: meta.promedio },
  ];
  cajas.forEach((c, i) => {
    const x = margins.left + i * (anchoCaja + gap);
    if (x + anchoCaja > anchoPagina - margins.right) return;
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(110, 231, 183);
    doc.setLineWidth(GROSOR_LINEA_TABLA);
    doc.roundedRect(x, finalY, anchoCaja, 13, 2, 2, "FD");
    doc.setFontSize(6.5);
    doc.setTextColor(6, 95, 70);
    doc.text(c.etiqueta.toUpperCase(), x + 3, finalY + 4.5, { maxWidth: anchoCaja - 6 });
    doc.setFontSize(11);
    doc.text(c.valor, x + 3, finalY + 10, { maxWidth: anchoCaja - 6 });
  });

  // Pie con paginación real (esta tabla puede continuar si el grupo es enorme).
  dibujarPie(doc, 1, [{ inicio: 1, fin: doc.getNumberOfPages() }], margins.left, "Grupo");

  return new Uint8Array(doc.output("arraybuffer"));
}
