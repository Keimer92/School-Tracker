// C:/Users/Admin/AppData/Local/Temp/opencode/prueba2.ts
import { writeFileSync } from "node:fs";

// src/lib/asistenciaPdf.ts
var COLOR_P = [4, 120, 87];
var COLOR_A = [185, 28, 28];
var COLOR_J = [161, 98, 7];
var COLOR_AMBAR = [146, 64, 14];
var COLOR_BORDE = [17, 24, 39];
var COLOR_ENCABEZADO = [209, 250, 229];
var COLOR_ENCABEZADO_TXT = [6, 78, 59];
var COLOR_TITULO = [17, 24, 39];
var COLOR_SUBDITULO = [75, 85, 99];
var COLOR_ALERTA = [252, 211, 77];
function estiloPara(nCols, nFilas) {
  const porFilas = nFilas > 40 ? 0.78 : nFilas > 26 ? 0.88 : 1;
  const base = nCols <= 8 ? { fontSize: 9, cellPadding: 1.2, anchoFecha: 14 } : nCols <= 14 ? { fontSize: 8, cellPadding: 0.9, anchoFecha: 11 } : nCols <= 20 ? { fontSize: 7, cellPadding: 0.7, anchoFecha: 8.5 } : { fontSize: 6.5, cellPadding: 0.6, anchoFecha: 7.5 };
  return {
    fontSize: Math.max(5.5, Math.round(base.fontSize * porFilas * 10) / 10),
    cellPadding: Math.max(0.5, Math.round(base.cellPadding * porFilas * 10) / 10),
    anchoFecha: base.anchoFecha
  };
}
var ANCHO_NOMBRE_MIN = 50;
var ANCHO_SEXO = 9;
var ANCHO_TOTAL = 9;
var EM_ANCHO_DDMM = 2.502;
function anchoFechaPara(nFechas, anchoUtil) {
  const libre = anchoUtil - ANCHO_NOMBRE_MIN - ANCHO_SEXO - 3 * ANCHO_TOTAL;
  return Math.max(5.2, Math.min(14, libre / Math.max(1, nFechas)));
}
function fontFechaCabe(ancho, cellPadding, fontSize) {
  const util = ancho - 2 * cellPadding;
  const max = util / (EM_ANCHO_DDMM * 0.3528);
  return Math.max(4.5, Math.min(fontSize, Math.round(max * 10) / 10));
}
function colorDeEstado(valor) {
  if (valor === "P") return COLOR_P;
  if (valor === "A") return COLOR_A;
  if (valor === "J") return COLOR_J;
  return null;
}
function resolverExport(mod, nombre) {
  if (typeof mod === "function") return mod;
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.default?.default === "function") return mod.default.default;
  if (typeof mod?.[nombre] === "function") return mod[nombre];
  if (typeof mod?.default?.[nombre] === "function") return mod.default[nombre];
  throw new Error(`No se pudo cargar "${nombre}"`);
}
async function generarPdfAsistencia(meta, tablas) {
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
    const body = t.body.map((fila, idx) => {
      const f = [...fila];
      if (t.combinada) {
        f[t.combinada.indice] = idx === 0 && n > 0 ? {
          content: t.combinada.texto,
          rowSpan: n,
          styles: { halign: "center", valign: "middle", fontStyle: "bold", textColor: COLOR_AMBAR }
        } : "";
      }
      return f;
    });
    const nCols = t.headers.length;
    const nFechas = t.layout === "fechas" ? Math.max(0, nCols - 5) : 0;
    const anchoFecha = t.layout === "fechas" ? anchoFechaPara(nFechas, anchoUtil) : 0;
    const fontFecha = t.layout === "fechas" ? fontFechaCabe(anchoFecha, est.cellPadding, est.fontSize) : est.fontSize;
    const columnStyles = t.layout === "diario" ? { 0: { cellWidth: "auto" }, 1: { cellWidth: 16 }, 2: { cellWidth: 34 } } : {
      0: { cellWidth: "auto", minCellWidth: ANCHO_NOMBRE_MIN, fontStyle: "bold", textColor: [0, 0, 0] },
      1: { cellWidth: ANCHO_SEXO }
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
      body,
      styles: {
        fontSize: est.fontSize,
        cellPadding: est.cellPadding,
        overflow: "linebreak",
        valign: "middle",
        minCellWidth: 0,
        lineColor: COLOR_BORDE,
        lineWidth: 0.2,
        textColor: [0, 0, 0]
      },
      headStyles: {
        fillColor: COLOR_ENCABEZADO,
        textColor: COLOR_ENCABEZADO_TXT,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        lineColor: COLOR_BORDE,
        lineWidth: 0.25,
        minCellHeight: 6
      },
      alternateRowStyles: { fillColor: [247, 253, 250] },
      columnStyles,
      rowPageBreak: "avoid",
      didParseCell: (data) => {
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
        doc.text(`Hoja ${actual}/${paginas} \xB7 Secci\xF3n ${i + 1} de ${tablas.length}`, margins.left + 2, doc.internal.pageSize.getHeight() - 4);
        doc.setTextColor(0, 0, 0);
      }
    });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

// C:/Users/Admin/AppData/Local/Temp/opencode/prueba2.ts
function nombres(i, largo = false) {
  const a = ["Ana", "Luis", "Mar\xEDa", "Jos\xE9", "Sof\xEDa", "Carlos", "Elena", "Diego", "Rosa", "Miguel"];
  const b = ["P\xE9rez", "Garc\xEDa", "Rodr\xEDguez", "Mart\xEDnez", "L\xF3pez", "Hern\xE1ndez", "Gonz\xE1lez", "S\xE1nchez", "Ram\xEDrez", "Torres"];
  const out = [];
  for (let n = 0; n < i; n++) out.push(largo ? `${a[n % 10]} ${b[n * 3 % 10]} ${b[n * 7 % 10]} ${b[n * 5 % 10]}` : `${a[n % 10]} ${b[n * 3 % 10]} ${b[n * 7 % 10]}`);
  return out;
}
async function caso(etiqueta, tablas, esperado) {
  const bytes = await generarPdfAsistencia(
    { titulo: "Reporte de Asistencia", lineas: ["Per\xEDodo: Septiembre 2026 (del 01/09/2026 al 28/09/2026)", "Secciones: 4 \xB7 A\xF1o lectivo: 2026"] },
    tablas
  );
  const buf = Buffer.from(bytes);
  const ruta = `C:/Users/Admin/AppData/Local/Temp/opencode/v2-${etiqueta}.pdf`;
  writeFileSync(ruta, buf);
  const txt = buf.toString("latin1");
  const paginas = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`${paginas === esperado ? "OK " : "MAL"} ${etiqueta}: ${tablas.length} secciones -> ${paginas} hojas (esperado ${esperado}) | ${(buf.length / 1024).toFixed(1)} kB`);
}
function tabla(c, ests, nFechas, largo = false) {
  const fechas = Array.from({ length: nFechas }, (_, i) => `0${i % 9 + 1}/0${i % 8 + 1}`);
  return {
    titulo: `${c}to grado - Secci\xF3n A`,
    subtitulo: "Candelario Sotelo",
    layout: "fechas",
    headers: ["Estudiante", "Sexo", ...fechas, "P", "A", "J"],
    body: nombres(ests, largo).map((n, i) => {
      const e = fechas.map((_, j) => ["P", "A", "J", "-"][(i + j) % 4]);
      return [n, i % 2 ? "F" : "M", ...e, 12, 2, 1];
    })
  };
}
await caso("mensual-30", Array.from({ length: 4 }, (_, i) => tabla(i + 1, 30, 22)), 4);
await caso("semanal-30", Array.from({ length: 4 }, (_, i) => tabla(i + 1, 30, 5)), 4);
await caso("mensual-29col", [tabla(1, 30, 29)], 1);
await caso("mensual-45", [tabla(1, 45, 22)], 1);
await caso("nombres-largos", [tabla(1, 30, 22, true)], 1);
await caso("nota-sinclases", [tabla(1, 30, 22), { ...tabla(2, 30, 22), nota: "01/09 (feriado), 15/09 (consejo)" }], 2);
await caso("estr\xE9s-60", [tabla(1, 60, 22)], 2);
