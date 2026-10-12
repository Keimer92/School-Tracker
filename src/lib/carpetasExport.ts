/**
 * carpetasExport.ts — rutas de destino de los archivos exportados.
 *
 * Antes cada página armaba su propia ruta a mano, y cada una lo hizo un poco
 * distinto: la asistencia metía el año y el período en UNA subcarpeta
 * ("2026 - Asistencia Semanal"), las notas metían año + corte + asignatura, y
 * los estudiantes no metían subcarpeta alguna. Con eso los PDF quedaban
 * mezclados en la raíz de "School Tracker" y no había forma de encontrar los de
 * un año sin conocer el nombre exacto de la carpeta.
 *
 * Ahora TODOS los exports caen en la misma forma:
 *
 *   School Tracker/<Categoría>/<Año Lectivo>[/<detalle>]
 *
 * - `<Categoría>` se traduce (Asistencias / Notas / Estudiantes, y sus pares en
 *   inglés), porque es una carpeta que el usuario abre en su explorador.
 * - `School Tracker` NO se traduce: es el nombre propio del producto.
 * - El año lectivo va SIEMPRE como carpeta propia, para que la pregunta
 *   "¿de qué año es este PDF?" se responda mirando un solo nivel.
 *
 * `<detalle>` es OPCIONAL y cada categoría decide si lo usa:
 *
 * - Asistencias: NO. El período va en el nombre del archivo. Una carpeta por
 *   mes dejaba el año lleno de carpetas con un único PDF, y comparar los
 *   reportes de un mes con los del siguiente costaba más que leer los nombres.
 * - Notas: SÍ (corte + asignatura), porque de un mismo año salen decenas de
 *   PDF y sin separarlos la carpeta es indistinguible.
 * - Estudiantes: NO. Un archivo por colegio, y el colegio ya va en el nombre.
 */

import { unirRuta } from "./platform";
import { t } from "./i18n.svelte";

/** Carpeta raíz, fija y sin traducir: es el nombre del producto. */
export const CARPETA_RAIZ = "School Tracker";

/** Categorías de exportación. Cada una es una carpeta traducida bajo la raíz. */
export type CategoriaExport = "asistencias" | "notas" | "estudiantes";

/**
 * Quita los caracteres que Windows no admite en nombres de archivo y deja una
 * versión segura del texto. Se usa para el año, el período, el colegio, etc.
 * Collapsea espacios y quita los puntos del final, que Windows descarta en
 * silencio (y rompería la comparación con la carpeta realmente creada).
 */
export function seguroParaCarpeta(texto: string): string {
  return texto
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

/**
 * Los segmentos de carpeta bajo la raíz, ya traducidos y saneados.
 * Devuelve un array vacío si falta el año, para no crear una carpeta suelta.
 */
export function segmentosCarpeta(
  categoria: CategoriaExport,
  anoLectivo: string | null | undefined,
  detalle?: string | null
): string[] {
  const cat = t(`exp.carpeta.${categoria}` as never);
  const ano = seguroParaCarpeta(String(anoLectivo ?? ""));
  if (!ano) return [seguroParaCarpeta(cat)];
  const segs = [seguroParaCarpeta(cat), ano];
  const det = detalle ? seguroParaCarpeta(detalle) : "";
  if (det) segs.push(det);
  return segs;
}

/**
 * Ruta RELATIVA con separador `/`, como la espera el comando
 * `guardar_en_descargas` (Android) para anidar dentro de Descargas.
 */
export function subcarpetaRelativa(
  categoria: CategoriaExport,
  anoLectivo: string | null | undefined,
  detalle?: string | null
): string {
  return [CARPETA_RAIZ, ...segmentosCarpeta(categoria, anoLectivo, detalle)].join("/");
}

/**
 * Ruta ABSOLUTA dentro del directorio de documentos del sandbox, lista para
 * `mkdir` + `writeFile` en escritorio y Android.
 */
export async function rutaExportAbsoluta(
  categoria: CategoriaExport,
  anoLectivo: string | null | undefined,
  detalle?: string | null
): Promise<string> {
  const { documentDir } = await import("@tauri-apps/api/path");
  const docs = await documentDir();
  return unirRuta(docs, CARPETA_RAIZ, ...segmentosCarpeta(categoria, anoLectivo, detalle));
}

/**
 * Texto de destino para los toasts: "Documents/School Tracker/Asistencias/2026"
 * en escritorio y "Descargas/School Tracker/Asistencias/2026" en Android.
 *
 * Se arma con `/` a propósito aunque la ruta real use `\`: el toast es para
 * leerlo, y las barras se ven igual en cualquier plataforma (y en Android el
 * MediaStore las usa tal cual).
 */
export function destinoParaToast(
  esAndroid: boolean,
  categoria: CategoriaExport,
  anoLectivo: string | null | undefined,
  detalle?: string | null
): string {
  const raiz = esAndroid ? "Descargas" : "Documents";
  return `${raiz}/${subcarpetaRelativa(categoria, anoLectivo, detalle)}`;
}