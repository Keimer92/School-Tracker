/**
 * excel.ts — módulo COMPARTIDO de exportación a Excel (.xlsx con estilos).
 *
 * Por qué ExcelJS y no `xlsx`: SheetJS Community NO escribe estilos (colores,
 * bordes, combinaciones). ExcelJS sí, y además trae paneles congelados,
 * autofiltro, imágenes y anchos de columna. Se carga de forma LAZILY
 * (`await import`) para no penalizar el arranque de la app: son ~937 kB que
 * solo se descargan cuando el usuario exporta algo.
 *
 * ── Uso rápido (cualquier página nueva) ────────────────────────────────
 * ```ts
 * import { crearLibroEstudiantes, guardarLibro } from "../lib/excel";
 *
 * const libro = await crearLibroEstudiantes({ estudiantes, colegios, grados, secciones, anoNombre: "2026" });
 * await guardarLibro(libro, "Estudiantes_2026_Candelario Sotelo", { abrirCarpeta: true });
 * ```
 *
 * Para una hoja a medida se usan los helpers de bajo nivel. Las filas son
 * 1-based (igual que en Excel) y la mayoria de helpers devuelven la primera
 * fila libre siguiente:
 * ```ts
 * const { Workbook } = await cargarExcelJs();
 * const wb = new Workbook();
 * const ws = agregarHoja(wb, "Mi hoja", [30, 18, 40]);
 * let fila = escribirPortada(ws, "TÍTULO", ["Subtítulo"], 3);
 * fila = escribirCabecera(ws, ["A", "B", "C"], fila + 1);
 * escribirFila(ws, fila, ["uno", 2, true], { banda: true, centrarTodas: true });
 * ```
 */

// ── Tipos (los exportamos desde aquí para no depender de exceljs en el TS) ──
type BorderSide = { style: string; color: { argb: string } };
export type ExcelBorder = {
  top?: BorderSide; bottom?: BorderSide; left?: BorderSide; right?: BorderSide;
};
export type ExcelFont = {
  name?: string; size?: number; bold?: boolean; italic?: boolean;
  color?: { argb: string }; underline?: boolean;
};
export type ExcelFill = {
  type: 'pattern'; pattern: 'solid'; fgColor: { argb: string };
};
export type ExcelAlignment = {
  horizontal?: 'left' | 'center' | 'right';
  vertical?: 'top' | 'middle' | 'bottom';
  wrapText?: boolean;
};

/** Argumento ARGB (con alfa) a partir de un hex de 6 dígitos, p. ej. '0EA5E9' -> 'FF0EA5E9'. */
export function argb(hex: string): string {
  const h = hex.replace('#', '').trim();
  return (h.length === 6 ? 'FF' + h : h.length === 8 ? h : 'FF' + h).toUpperCase();
}

/**
 * Paleta compartida: sigue la convención de acentos del proyecto
 * (AGENTS.md → "Acentos por categoría") para que los Excel se vean nativos.
 */
export const PALETA = {
  tinta: '0F172A',      // azul marino (portadas)
  tintaSuave: '1E293B',
  cian: '0EA5E9',       // cabecera de tabla
  cianOscuro: '0284C7', // encabezado de sección
  gris: '64748B',
  grisClaro: '94A3B8',
  texto: '334155',
  textoOscuro: '0F172A',
  blanco: 'FFFFFF',
  banda: 'F1F5F9',
  bandaSuave: 'F8FAFC',
  borde: 'CBD5E1',
  naranja: 'FB923C',     // Grado
  rosa: 'DB2777',        // Femenino
  azul: '2563EB',        // Masculino
  verde: '22C55E',
  ambar: 'F59E0B',
} as const;

/** Borde fino gris, el estándar para celdas de datos. */
export const BORDE_FINO: ExcelBorder = {
  top: { style: 'thin', color: { argb: argb(PALETA.borde) } },
  bottom: { style: 'thin', color: { argb: argb(PALETA.borde) } },
  left: { style: 'thin', color: { argb: argb(PALETA.borde) } },
  right: { style: 'thin', color: { argb: argb(PALETA.borde) } },
};

export function relleno(colorHex: string): ExcelFill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colorHex) } };
}

// ── Carga perezosa ────────────────────────────────────────────────────────
let excelJsCache: any = null;

/**
 * Importa ExcelJS solo una vez. El namespace cambia según cómo Vite envuelva
 * el bundle UMD (default / e / global), así que se resuelven todas las formas.
 */
export async function cargarExcelJs(): Promise<any> {
  if (excelJsCache) return excelJsCache;
  const mod: any = await import('exceljs');
  const candidato =
    (mod && mod.Workbook) ? mod
    : (mod && mod.default && mod.default.Workbook) ? mod.default
    : (mod && mod.e && mod.e.Workbook) ? mod.e
    : (mod && mod.default && mod.default.default && mod.default.default.Workbook) ? mod.default.default
    : (globalThis as any).ExcelJS;
  if (!candidato || !candidato.Workbook) {
    throw new Error('No se pudo cargar ExcelJS');
  }
  excelJsCache = candidato;
  return excelJsCache;
}

// ── Helpers de bajo nivel ────────────────────────────────────────────────
/** Crea un libro con metadatos por defecto. */
export async function crearLibro(creator?: string): Promise<any> {
  const { Workbook } = await cargarExcelJs();
  const wb = new Workbook();
  wb.creator = creator || 'School Tracker';
  wb.lastModifiedBy = creator || 'School Tracker';
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

/** Nombre de hoja seguro: Excel prohíbe \ / ? * [ ] : y limita a 31 caracteres. */
export function nombreHojaSeguro(nombre: string, usados?: Set<string>): string {
  let base = String(nombre || 'Hoja').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  if (!usados) return base;
  let candidato = base;
  let n = 2;
  while (usados.has(candidato.toLowerCase())) {
    const sufijo = ` (${n})`;
    candidato = base.slice(0, 31 - sufijo.length) + sufijo;
    n++;
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

/** Nombre de archivo seguro para Windows/macOS/Linux. */
export function nombreArchivoSeguro(nombre: string): string {
  return String(nombre || 'export').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'export';
}

/** Agrega una hoja con anchos de columna (en caracteres). */
export function agregarHoja(wb: any, nombre: string, anchos?: number[]): any {
  const ws = wb.addWorksheet(nombre);
  if (anchos?.length) {
    anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
  return ws;
}

/**
 * Portada combinada: título grande sobre fondo oscuro + subtítulo en cursiva.
 * `fila` es 1-based (como Excel). Devuelve la primera fila libre.
 */
export function escribirPortada(ws: any, titulo: string, lineas: (string | null | undefined)[], columnas: number, fila = 1): number {
  ws.mergeCells(fila, 1, fila, columnas);
  const t = ws.getCell(fila, 1);
  t.value = titulo;
  t.font = { bold: true, size: 15, color: { argb: argb(PALETA.blanco) } };
  t.fill = relleno(PALETA.tinta);
  t.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(fila).height = 26;

  let f = fila + 1;
  for (const linea of lineas) {
    if (!linea) continue;
    ws.mergeCells(f, 1, f, columnas);
    const s = ws.getCell(f, 1);
    s.value = linea;
    s.font = { italic: true, size: 10, color: { argb: argb(PALETA.gris) } };
    s.alignment = { horizontal: 'left' };
    ws.getRow(f).height = 16;
    f++;
  }
  return f;
}

/** Cabecera de tabla: fondo cian, texto blanco bold, centrada y con bordes. */
export function escribirCabecera(ws: any, titulos: string[], fila: number): number {
  titulos.forEach((t, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = t;
    c.font = { bold: true, size: 10, color: { argb: argb(PALETA.blanco) } };
    c.fill = relleno(PALETA.cian);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = BORDE_FINO;
  });
  ws.getRow(fila).height = 18;
  return fila + 1;
}

/**
 * Fila de datos con banda alterna y bordes.
 * `personalizar` permite sobrescribir el estilo de celdas concretas,
 * p. ej. `{ 2: { font: { color: { argb: argb(PALETA.naranja) } } } }`.
 */
export function escribirFila(
  ws: any, fila: number, valores: (string | number | boolean | null | undefined)[],
  opciones: { banda?: boolean; centrarTodas?: boolean } = {}
): number {
  const banda = !!opciones.banda;
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, i + 1);
    if (v !== null && v !== undefined) c.value = v as any;
    c.font = { size: 10, color: { argb: argb(banda ? PALETA.tintaSuave : PALETA.textoOscuro) } };
    c.fill = relleno(banda ? PALETA.bandaSuave : PALETA.blanco);
    c.alignment = { horizontal: opciones.centrarTodas ? 'center' : 'left', vertical: 'middle' };
    c.border = BORDE_FINO;
  });
  return fila + 1;
}

/** Fila de totales: fondo cian oscuro, texto blanco bold. */
export function escribirFilaTotales(ws: any, fila: number, valores: (string | number | null | undefined)[], columnas: number): void {
  for (let i = 0; i < columnas; i++) {
    const c = ws.getCell(fila, i + 1);
    if (i < valores.length && valores[i] !== null && valores[i] !== undefined) c.value = valores[i] as any;
    c.font = { bold: true, size: 11, color: { argb: argb(PALETA.blanco) } };
    c.fill = relleno(PALETA.cianOscuro);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = BORDE_FINO;
  }
}

/** Encabezado de sección: barra azul oscuro combinada con el conteo a la derecha. */
export function escribirEncabezadoSeccion(ws: any, fila: number, titulo: string, detalle: string, columnas: number): number {
  ws.mergeCells(fila, 1, fila, columnas - 1);
  const c = ws.getCell(fila, 1);
  c.value = titulo;
  c.font = { bold: true, size: 11, color: { argb: argb(PALETA.blanco) } };
  c.fill = relleno(PALETA.cianOscuro);
  c.alignment = { horizontal: 'left', vertical: 'middle' };
  const d = ws.getCell(fila, columnas);
  if (detalle) {
    d.value = detalle;
    d.font = { size: 10, italic: true, color: { argb: argb(PALETA.blanco) } };
    d.fill = relleno(PALETA.cianOscuro);
    d.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  ws.getRow(fila).height = 18;
  return fila + 1;
}

/** Congela las filas indicadas arriba (0 = sin congelar). */
export function congelarFilas(ws: any, ySplit: number): void {
  if (ySplit > 0) ws.views = [{ state: 'frozen', ySplit }];
}

/** Autofiltro sobre un rango A1 style ("A3:D3"). */
export function aplicarAutofiltro(ws: any, rango: string): void {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rango);
  if (!m) return;
  const colNum = (letras: string) => letras.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
  ws.autoFilter = {
    from: { row: Number(m[2]), column: colNum(m[1]) },
    to: { row: Number(m[4]), column: colNum(m[3]) },
  };
}

/** Ajusta el alto de una fila (en puntos). */
export function altoFila(ws: any, fila: number, puntos: number): void {
  ws.getRow(fila).height = puntos;
}

// ── Guardado en disco (Tauri) ────────────────────────────────────────────

/** Escribe el libro en `carpeta` con `nombreBase` y devuelve la ruta completa. */
export async function escribirLibroEnCarpeta(libro: any, carpeta: string, nombreBase: string): Promise<string> {
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const sep = carpeta.includes('\\') ? '\\' : '/';
  const buffer = await libro.xlsx.writeBuffer();
  const ruta = `${carpeta}${sep}${nombreArchivoSeguro(nombreBase)}.xlsx`;
  await writeFile(ruta, buffer);
  return ruta;
}

/**
 * Guarda el libro en la carpeta PÚBLICA de Descargas del dispositivo.
 *
 * Es lo que hay que usar en Android: el selector de carpetas devuelve una URI de
 * contenido, no una ruta del sistema de archivos, y escribir con `writeFile` sobre
 * una ruta cruda falla porque la app no tiene acceso al almacenamiento compartido.
 * El flujo correcto es: se escribe dentro del sandbox (`documentDir`) y después
 * `guardar_en_descargas` lo copia a Descargas vía MediaStore, sin permisos.
 *
 * `subcarpeta` es opcional y se anida bajo "School Tracker".
 */
export async function escribirLibroEnDescargas(
  libro: any,
  nombreBase: string,
  subcarpeta = ''
): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { documentDir } = await import('@tauri-apps/api/path');
  const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
  const folderName = 'School Tracker';
  const sep = '/';
  const baseDir = (await documentDir()) + sep + folderName + (subcarpeta ? sep + subcarpeta : '');
  await mkdir(baseDir, { recursive: true });
  const nombre = `${nombreArchivoSeguro(nombreBase)}.xlsx`;
  const rutaLocal = baseDir + sep + nombre;
  await writeFile(rutaLocal, await libro.xlsx.writeBuffer());
  const carpeta = subcarpeta ? `${folderName}/${subcarpeta}` : folderName;
  return await invoke<string>('guardar_en_descargas', {
    path: rutaLocal,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    carpeta,
    nombre,
  });
}

/**
 * Diálogo "Guardar como" + escritura. Devuelve la ruta o `null` si el
 * usuario cancela. Con `directorio` pide una carpeta y usa `nombreSugerido`
 * como nombre de archivo; con `abrir` abre el archivo al terminar.
 */
export async function guardarLibro(
  libro: any,
  nombreSugerido: string,
  opciones: { abrir?: boolean; directorio?: boolean } = {}
): Promise<string | null> {
  const { save, open } = await import('@tauri-apps/plugin-dialog');
  const suggested = `${nombreArchivoSeguro(nombreSugerido)}.xlsx`;
  if (opciones.directorio) {
    const sel = await open({ directory: true, multiple: false, title: 'Carpeta destino' });
    if (!sel || Array.isArray(sel)) return null;
    return await escribirLibroEnCarpeta(libro, String(sel), nombreSugerido);
  }
  const ruta = await save({ filters: [{ name: 'Excel', extensions: ['xlsx'] }], defaultPath: suggested });
  if (!ruta) return null;
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const buffer = await libro.xlsx.writeBuffer();
  await writeFile(ruta, buffer);
  if (opciones.abrir) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      openUrl(ruta);
    } catch (_) { /* no crítico */ }
  }
  return ruta;
}

// ── Constructor de dominio: estudiantes por colegio ──────────────────────

export interface EstudianteExcel {
  id?: number; nombre: string; codigo: string; sexo: string;
  gradoId: number; seccionId: number; colegioId: number; anoLectivoId: number;
}
export interface CatalogoExcel { id: number; nombre: string; }

export interface GrupoSeccionExcel { seccionId: number; nombre: string; estudiantes: EstudianteExcel[]; }
export interface GrupoGradoExcel { gradoId: number; nombre: string; secciones: GrupoSeccionExcel[]; total: number; }

export interface OpcionesLibroEstudiantes {
  estudiantes: EstudianteExcel[];
  colegios: CatalogoExcel[];
  grados: CatalogoExcel[];
  secciones: CatalogoExcel[];
  anoNombre: string;
  /** Grados del colegio sin estudiantes (opcional, p. ej. get_grados_by_colegio). */
  gradosPorColegio?: Record<number, CatalogoExcel[]>;
  incluirGradosVacios?: boolean;
}

function cmpNombre(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Agrupa colegio → grado → sección, con orden natural de nombres. */
export function agruparEstudiantes(
  estudiantes: EstudianteExcel[],
  grados: CatalogoExcel[],
  secciones: CatalogoExcel[],
  gradosExtra: CatalogoExcel[] = []
): GrupoGradoExcel[] {
  const idsGrado = new Set<number>();
  estudiantes.forEach(s => idsGrado.add(Number(s.gradoId)));
  gradosExtra.forEach(g => idsGrado.add(Number(g.id)));
  return [...idsGrado]
    .sort((a, b) => cmpNombre(grados.find(g => g.id === a)?.nombre || '', grados.find(g => g.id === b)?.nombre || ''))
    .map(gid => {
      const nombre = grados.find(g => g.id === gid)?.nombre || gradosExtra.find(g => g.id === gid)?.nombre || `Grado ${gid}`;
      const estGrado = estudiantes.filter(s => Number(s.gradoId) === gid);
      const idsSec = new Set<number>();
      estGrado.forEach(s => idsSec.add(Number(s.seccionId)));
      const seccionesGrupo: GrupoSeccionExcel[] = [...idsSec]
        .sort((a, b) => cmpNombre(secciones.find(s => s.id === a)?.nombre || '', secciones.find(s => s.id === b)?.nombre || ''))
        .map(sid => ({
          seccionId: sid,
          nombre: secciones.find(s => s.id === sid)?.nombre || `Sección ${sid}`,
          estudiantes: estGrado
            .filter(s => Number(s.seccionId) === sid)
            .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), undefined, { sensitivity: 'base' })),
        }));
      return { gradoId: gid, nombre, secciones: seccionesGrupo, total: estGrado.length };
    });
}

/**
 * Libro completo de estudiantes de un colegio: hoja "Resumen" + una hoja por
 * grado con las secciones agrupadas. Devuelve `{ libro, total }`.
 */
export async function crearLibroEstudiantes(opts: OpcionesLibroEstudiantes): Promise<{ libro: any; total: number; hojas: string[] }> {
  const { estudiantes, colegios, grados, secciones, anoNombre, incluirGradosVacios } = opts;
  const colegio = colegios[0];
  const usados = new Set<string>();
  const wb = await crearLibro();
  const grupos = agruparEstudiantes(
    estudiantes,
    grados,
    secciones,
    incluirGradosVacios ? (opts.gradosPorColegio?.[colegio.id] || []) : []
  );
  const total = grupos.reduce((a, g) => a + g.total, 0);

  // ── Resumen ──
  const ws = agregarHoja(wb, nombreHojaSeguro('Resumen', usados), [20, 16, 12, 12, 10]);
  // Portada: colegio (1), año (2), total (3), separador (4), cabecera (5).
  escribirPortada(ws, `COLEGIO: ${colegio.nombre}`, [`Año lectivo: ${anoNombre}`, `Total de estudiantes: ${total}`], 5);
  const filaCabecera = 5;
  const primeraFila = escribirCabecera(ws, ['Grado', 'Sección', 'Masculino', 'Femenino', 'Total'], filaCabecera);
  let f = primeraFila;
  let n = 0;
  const empujarFilaResumen = (valores: (string | number)[]) => {
    const fila = f;
    escribirFila(ws, fila, valores, { banda: n % 2 === 1, centrarTodas: true });
    ws.getCell(fila, 1).font = { size: 10, bold: true, color: { argb: argb(PALETA.naranja) } };
    ws.getCell(fila, 1).alignment = { horizontal: 'left', vertical: 'middle' };
    f++; n++;
  };
  for (const g of grupos) {
    if (g.secciones.length === 0) {
      empujarFilaResumen([g.nombre, '—', 0, 0, 0]);
      continue;
    }
    for (const s of g.secciones) {
      const m = s.estudiantes.filter(e => e.sexo === 'M').length;
      const w = s.estudiantes.filter(e => e.sexo === 'F').length;
      empujarFilaResumen([g.nombre, s.nombre, m, w, s.estudiantes.length]);
    }
  }
  const ultimaFilaDatos = f - 1;
  const mTotal = estudiantes.filter(e => e.sexo === 'M').length;
  const fTotal = estudiantes.filter(e => e.sexo === 'F').length;
  escribirFilaTotales(ws, ultimaFilaDatos + 2, ['TOTAL GENERAL', '', mTotal, fTotal, total], 5);
  congelarFilas(ws, filaCabecera);
  if (ultimaFilaDatos >= primeraFila) aplicarAutofiltro(ws, `A${filaCabecera}:E${ultimaFilaDatos}`);

  // ── Una hoja por grado, con secciones agrupadas ──
  for (const g of grupos) {
    const hoja = agregarHoja(wb, nombreHojaSeguro(g.nombre, usados), [6, 13, 38, 14]);
    // Portada: grado (1), colegio·año (2), total (3), separador (4).
    let r = escribirPortada(
      hoja,
      `GRADO: ${g.nombre}`,
      [`${colegio.nombre} · Año lectivo ${anoNombre}`, `Total: ${g.total} estudiante(s)`],
      4
    );
    if (g.secciones.length === 0) {
      const filaVacia = r + 1;
      hoja.mergeCells(filaVacia, 1, filaVacia, 4);
      const v = hoja.getCell(filaVacia, 1);
      v.value = '(Sin estudiantes en este grado)';
      v.font = { italic: true, size: 10, color: { argb: argb(PALETA.grisClaro) } };
      v.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    for (const s of g.secciones) {
      r = escribirEncabezadoSeccion(hoja, r + 1, `SECCIÓN ${s.nombre}`, `(${s.estudiantes.length} estudiante/s)`, 4);
      r = escribirCabecera(hoja, ['Nº', 'Código', 'Nombre', 'Sexo'], r);
      s.estudiantes.forEach((e, i) => {
        const fila = r;
        escribirFila(hoja, fila, [i + 1, e.codigo, e.nombre, e.sexo === 'F' ? 'Femenino' : 'Masculino'], {
          banda: i % 2 === 1,
          centrarTodas: true,
        });
        hoja.getCell(fila, 3).alignment = { horizontal: 'left', vertical: 'middle' };
        hoja.getCell(fila, 4).font = { size: 10, bold: true, color: { argb: argb(e.sexo === 'F' ? PALETA.rosa : PALETA.azul) } };
        r++;
      });
    }
    congelarFilas(hoja, 3);
  }

  return { libro: wb, total, hojas: wb.worksheets.map((w: any) => w.name) };
}
