/**
 * pdfChrome.ts — piezas visuales COMPARTIDAS por los generadores de PDF.
 *
 * Aquí vive el "cromo" (el lenguaje visual) que comparten el reporte de
 * asistencia y el de notas: paleta, grosor de borde, chips redondeados, barra
 * de acento del título, escala tipográfica adaptativa y pie con paginación real.
 *
 * El objetivo es que ambos PDF se vean como hermanos: si mañana se cambia el
 * grosor de línea o el estilo del chip, se cambia acá una sola vez y los dos
 * generadores quedan alineados.
 *
 * Los generadores de alto nivel (`asistenciaPdf.ts`, `notasPdf.ts`) aportarán
 * lo específico de cada tabla; este módulo NO sabe nada de asistencia ni de
 * calificaciones.
 *
 * ── Interoperabilidad fuera de Vite ──────────────────────────────────────
 * El export de jspdf/jspdf-autotable llega con distinta forma según el
 * empaquetador: en Vite es `mod.default`, pero al correr el módulo fuera del
 * bundle (node, pruebas) queda anidado en `mod.default.default`. `resolverExport`
 * resuelve cualquiera de las dos formas, lo que además permite testear los PDF
 * en Node.
 */

/** Paleta. El verde es el color de marca de los reportes. */
export const COLOR_BORDE = [17, 24, 39] as const;
export const COLOR_ENCABEZADO = [209, 250, 229] as const;
export const COLOR_ENCABEZADO_TXT = [6, 78, 59] as const;
export const COLOR_TITULO = [17, 24, 39] as const;
export const COLOR_SUBDITULO = [75, 85, 99] as const;
export const COLOR_ALERTA = [252, 211, 77] as const;
export const COLOR_VERDE_MARCA = [16, 185, 129] as const;

/**
 * Un solo grosor para TODOS los bordes (tabla, encabezado y chips).
 *
 * autoTable no dibuja líneas sino rectángulos rellenos de `lineWidth` mm. Con un
 * grosor de 0.2mm la línea queda en SUB-PÍXEL y cada visor la rasteriza a 1 o
 * 2 píxeles según dónde caiga, así que unas líneas se ven más gruesas que
 * otras aunque todas midan lo mismo. A 0.5mm (~1.4px a 96dpi) cada borde cae
 * siempre en un píxel completo y se ve uniforme de verdad.
 */
export const GROSOR_LINEA_TABLA = 0.5;

export const ALTO_CHIP = 6.4;
export const SEPARACION_CHIP = 2.2;
export const RELLENO_CHIP = 2.6;

export interface EstiloChip {
  bg: readonly number[];
  border: readonly number[];
  text: readonly number[];
}

/** Chip verde claro: principal, el que identifica el reporte. */
export const CHIP_PRINCIPAL: EstiloChip = {
  bg: [236, 253, 245],
  border: [110, 231, 183],
  text: [6, 95, 70],
};
/** Chip gris: metadatos (año, asignatura, corte…). */
export const CHIP_NEUTRO: EstiloChip = {
  bg: [249, 250, 251],
  border: [209, 213, 219],
  text: [55, 65, 81],
};
/** Chip ámbar: avisos (días sin clases, notas incompletas). */
export const CHIP_ALERTA: EstiloChip = {
  bg: [255, 251, 235],
  border: [252, 211, 77],
  text: [146, 64, 14],
};
/** Chip azul: asignatura. */
export const CHIP_INFO: EstiloChip = {
  bg: [239, 246, 255],
  border: [147, 197, 253],
  text: [30, 64, 175],
};
/** Chip violeta: corte evaluativo. */
export const CHIP_VIOLETA: EstiloChip = {
  bg: [245, 243, 255],
  border: [196, 181, 253],
  text: [91, 33, 182],
};
/** Chip rosa: año lectivo. */
export const CHIP_ROSA: EstiloChip = {
  bg: [253, 242, 248],
  border: [244, 194, 217],
  text: [159, 18, 57],
};

/**
 * Paleta para dar un color distinto a cada chip de metadatos. Se recorre en
 * orden para que los chips de un mismo encabezado se distinguan de un vistazo
 * en lugar de verse todos grises.
 */
export const PALETA_CHIPS: EstiloChip[] = [
  CHIP_INFO,
  CHIP_VIOLETA,
  CHIP_ROSA,
  CHIP_NEUTRO,
  CHIP_ALERTA,
];

export interface EstiloAdaptado {
  fontSize: number;
  cellPadding: number;
}

/**
 * Cuantas más columnas Y más filas, más chico todo: eso es lo que permite que
 * cada sección entre en una hoja. El ajuste por filas es lo que evita que un
 * grupo con 30-45 estudiantes se parta en dos páginas.
 *
 * El piso de 6.5pt es deliberado: por debajo el texto queda ilegible, y es
 * preferible que un grupo enorme continue en una segunda hoja antes que
 * imprimir un PDF que no se puede leer.
 */
export function estiloPara(nCols: number, nFilas: number): EstiloAdaptado {
  const porFilas = nFilas > 44 ? 0.8 : nFilas >= 32 ? 0.86 : nFilas >= 26 ? 0.9 : 1;
  const base = nCols <= 8
    ? { fontSize: 10, cellPadding: 1.4 }
    : nCols <= 14
      ? { fontSize: 9, cellPadding: 1.1 }
      : nCols <= 20
        ? { fontSize: 8, cellPadding: 0.9 }
        : { fontSize: 7.5, cellPadding: 0.8 };
  return {
    fontSize: Math.max(6.5, Math.round(base.fontSize * porFilas * 10) / 10),
    cellPadding: Math.max(0.7, Math.round(base.cellPadding * porFilas * 10) / 10),
  };
}

/**
 * Dibuja una etiqueta redondeada y devuelve su ancho. El texto se mide DESPUÉS
 * de fijar el cuerpo de fuente, porque getTextWidth depende del tamaño activo.
 */
export function dibujarChip(doc: any, x: number, y: number, texto: string, estilo: EstiloChip, fontSize = 8): number {
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
export function dibujarChips(
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
 * Bloque de título: barra de acento a la izquierda + título + subtítulo.
 * Devuelve la Y donde empieza el contenido.
 */
export function dibujarTitulo(
  doc: any,
  titulo: string,
  subtitulo: string,
  x: number,
  anchoUtil: number
): number {
  doc.setFontSize(15);
  doc.setTextColor(COLOR_TITULO[0], COLOR_TITULO[1], COLOR_TITULO[2]);
  doc.setFillColor(COLOR_VERDE_MARCA[0], COLOR_VERDE_MARCA[1], COLOR_VERDE_MARCA[2]);
  doc.roundedRect(x, 8.5, 1.8, 11, 0.9, 0.9, "F");
  doc.text(titulo, x + 4.4, 12.5, { maxWidth: anchoUtil - 4.4 });
  doc.setFontSize(9.5);
  doc.setTextColor(COLOR_SUBDITULO[0], COLOR_SUBDITULO[1], COLOR_SUBDITULO[2]);
  doc.text(subtitulo, x + 4.4, 18, { maxWidth: anchoUtil - 4.4 });
  return 21;
}

/**
 * Pie de página con paginación REAL.
 *
 * Se dibuja al final, ya con `doc.getNumberOfPages()` devolviendo el total: hacerlo
 * dentro de `didDrawPage` daba "Hoja 1/1" en cada hoja, porque en ese momento las
 * hojas siguientes todavía no existían.
 *
 * @param rangos páginas que cubre cada sección, en orden, para poder decir
 *                "Sección 3 de 8" aunque una sección ocupe varias hojas.
 */
export function dibujarPie(
  doc: any,
  totalSecciones: number,
  rangos: { inicio: number; fin: number }[],
  x: number,
  etiquetaSeccion = "Sección"
): void {
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
      `Página ${p} de ${total} · ${etiquetaSeccion} ${idx + 1} de ${totalSecciones}${sufijo}`,
      x + 2,
      doc.internal.pageSize.getHeight() - 4
    );
  }
}

/**
 * Convierte un color hexadecimal a la terna RGB que quiere jsPDF.
 *
 * Vive acá porque lo usan los dos generadores (notas y asistencia) para teñir
 * el nombre del estudiante con el color de sexo. Acepta `#rgb` y `#rrggbb`, con
 * o sin `#`, porque el valor viene de un `<input type="color">` del usuario y
 * de los defaults del ajuste, que no tienen por qué venir en el mismo formato.
 * Un valor no recognized devuelve negro, que es el color por defecto de la
 * tabla: antes que fallar, el nombre queda legible.
 */
export function hexToRgb(hex: string | undefined | null): [number, number, number] {
  const h = String(hex ?? "").replace("#", "").trim();
  const n = /^[0-9a-f]{3}$/i.test(h) ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(n)) return [0, 0, 0];
  const v = parseInt(n, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * El export de jspdf/jspdf-autotable llega con distinta forma segun el
 * empaquetador: en Vite es `mod.default`, pero al correr el modulo fuera del
 * bundle (node, pruebas) queda anidado en `mod.default.default`. Se resuelve
 * cualquiera de las dos.
 */
export function resolverExport(mod: any, nombre: string): any {
  if (typeof mod === "function") return mod;
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.default?.default === "function") return mod.default.default;
  if (typeof mod?.[nombre] === "function") return mod[nombre];
  if (typeof mod?.default?.[nombre] === "function") return mod.default[nombre];
  throw new Error(`No se pudo cargar "${nombre}"`);
}
