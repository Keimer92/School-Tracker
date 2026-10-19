import { invoke } from '@tauri-apps/api/core';
import { documentDir } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { aFileURL, esAndroid, unirRuta } from './platform';

/**
 * Entrega COMÚN de instrumentos (PDF y XLSX): misma carpeta destino y apertura
 * automática del archivo exportado.
 *
 * Antes el PDF caía en `Documents/School Tracker/Instrumentos/<Corte - Asignatura>/`
 * pero el Excel quedaba suelto en `Instrumentos/` (sin el subpath); y al exportar
 * solo se abría la CARPETA. Ahora ambos comparten exactamente el mismo subpath y
 * se abre el ARCHIVO recién generado.
 */

/** MIME del libro de Excel (mismo que usa `escribirLibroEnDescargas`). */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Sanitiza un segmento (carpeta o archivo) para Windows/macOS/Linux. */
export function sanitizarInstrumento(s: string): string {
  return String(s ?? '').replace(/[<>:"/\\|?*]/g, '_');
}

/** Subcarpeta "<Corte> - <Asignatura>": idéntica para el PDF y el XLSX. */
export function subcarpetaInstrumento(corte: string, asignatura: string): string {
  return sanitizarInstrumento(`${corte ?? ''} - ${asignatura ?? ''}`);
}

/** Carpeta destino: `Documents/School Tracker/Instrumentos[/<sub>]` (la crea). */
export async function carpetaInstrumento(sub?: string): Promise<string> {
  const docsPath = await documentDir();
  const partes = sub
    ? [docsPath, 'School Tracker', 'Instrumentos', sub]
    : [docsPath, 'School Tracker', 'Instrumentos'];
  const dir = unirRuta(...partes);
  await mkdir(dir, { recursive: true }).catch(() => {});
  return dir;
}

/**
 * Abre el archivo recién exportado.
 * - Desktop: lo lanza con la app predeterminada del sistema (`openUrl` + file://).
 * - Android: FileProvider + chooser (`share_file`, con el MIME correcto).
 */
export async function abrirInstrumentoExportado(fullPath: string, mime: string): Promise<void> {
  if (esAndroid()) {
    try { await invoke('share_file', { path: fullPath.replace(/\\/g, '/'), mime }); } catch {}
  } else {
    try { await openUrl(aFileURL(fullPath)); } catch {}
  }
}
