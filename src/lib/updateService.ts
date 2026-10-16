/**
 * Detección y descarga de actualizaciones.
 *
 * ── Por qué se consulta GitHub y no un endpoint propio ──
 *
 * El repo es público, así que la app puede preguntar directamente a la API de
 * releases. No hace falta token: `api.github.com/repos/<owner>/<repo>/releases/latest`
 * es de lectura pública. La restricción de 60 peticiones/hora por IP es
 * irrelevante acá (una petición cada 6 h por instalación).
 *
 * ── Qué hace cada plataforma ──
 *
 *   Windows: descarga el instalador NSIS (.exe) y lo ejecuta. El instalador
 *   reemplaza los archivos y arranca la nueva versión. Hay que salir de la app
 *   antes: mientras corre, el .exe está bloqueado y el instalador no puede
 *   sobrescribirlo.
 *
 *   Android: descarga el APK y lo entrega al instalador del sistema con
 *   `gd_instalar_actualizacion` (JNI + FileProvider). Android responde con el
 *   instalador de paquetes, que pide confirmación al usuario. La app NO se puede
 *   actualizar a sí misma: sin root ni instalador privilegiado, Android ignora
 *   una reinstalación automática. El usuario termina el paso con un toque, igual
 *   que al instalar desde el navegador, y necesita tener habilitado "instalar
 *   apps desconocidas" para School Tracker (permiso REQUEST_INSTALL_PACKAGES).
 *
 *   Los dos caminos pasan por el MISMO comando Rust a propósito: el archivo
 *   queda en la caché privada de la app, así que abrirlo desde JS no es una
 *   opción (en Android `file://` lanza FileUriExposedException desde la API 24,
 *   y con `openPath` del plugin-opener Android abriría un `Intent` sin
 *   `content://`). En Rust, en cambio, no se paga el scope de capabilities.
 *
 * ── Seguridad ──
 *
 * La URL de descarga la devuelve GitHub (assets de la release), no se construye a
 * mano. El nombre del archivo se toma de `browser_download_url`, así que no hay
 * forma de que un body malformado redirija la descarga a otro lado.
 */

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { esAndroid, esWindows } from './platform';
import { fmtFechaNica, type IdiomaFecha } from './fecha';

/** Repo público de GitHub. Sin token: la API de releases es de lectura pública. */
const REPO = 'Keimer92/School-Tracker';
const URL_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Versión que el usuario eligió ignorar. Si coincide con la última, no se molesta. */
const CLAVE_IGNORADA = 'stp_actualizacion_ignorada';

export interface AssetPlataforma {
  nombre: string;
  url: string;
  /** Tamaño en bytes según GitHub; puede faltar en releases antiguas. */
  tam: number;
}

export interface InfoActualizacion {
  /** Versión nueva, sin el `v` del tag. */
  version: string;
  /** Título que le puso GitHub a la release (puede ser distinto del tag). */
  nombre: string;
  /** Notas de la release en markdown. */
  notas: string;
  /** URL humana de la release, para el botón "ver en GitHub". */
  urlPublica: string;
  /** Fecha de publicación en formato local. */
  publicado: string;
  /** Asset que corresponde a esta plataforma, si la release lo incluye. */
  asset: AssetPlataforma | null;
}

interface AssetApi {
  name: string;
  browser_download_url: string;
  size: number;
}

interface ReleaseApi {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  assets: AssetApi[];
}

/** `1.2.3` → [1, 2, 3]. Ignora sufijos como `-beta`. */
function aNumeros(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter((p) => p !== '')
    .map((n) => parseInt(n, 10));
}

/** `a` más nueva que `b` → true. Empate o no parseable → false (no molestar). */
function esMasNueva(a: string, b: string): boolean {
  const x = aNumeros(a);
  const y = aNumeros(b);
  if (x.length === 0 || y.length === 0) return false;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * ¿Estamos dentro de Tauri (app instalada) o en el navegador?
 *
 * `getVersion` solo existe en el runtime de Tauri. En `npm run dev` puro no, y
 * consultar releases desde ahí solo ensucia la consola: no hay nada que
 * actualizar.
 */
async function versionActual(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

/** Devuelve la info de la nueva versión, o null si no hay nada que avisar. */
export async function consultarActualizacion(idioma: IdiomaFecha = 'es'): Promise<InfoActualizacion | null> {
  const actual = await versionActual();
  if (!actual) return null;

  let rel: ReleaseApi;
  try {
    const res = await fetch(URL_LATEST, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) {
      console.warn('[Update] GitHub respondió', res.status, 'en releases/latest');
      return null;
    }
    rel = (await res.json()) as ReleaseApi;
  } catch (e) {
    console.warn('[Update] no se pudo consultar releases:', e);
    return null;
  }

  const nueva = rel.tag_name?.replace(/^v/i, '') || '';
  if (!esMasNueva(nueva, actual)) return null;

  // El usuario ya despachó esta versión: no volver a molestar con ella.
  try {
    if (localStorage.getItem(CLAVE_IGNORADA) === nueva) return null;
  } catch { /* sin localStorage (privado/strict) */ }

  return {
    version: nueva,
    nombre: rel.name?.trim() || rel.tag_name,
    notas: rel.body?.trim() || '',
    urlPublica: rel.html_url,
    publicado: rel.published_at ? fmtFechaNica(rel.published_at, idioma) : '',
    asset: elegirAsset(rel.assets ?? []),
  };
}

/**
 * Elige el artefacto de la release que corresponde a esta plataforma.
 *
 * Windows: `.exe` (instalador NSIS). Si hay varios, prefiere el de 64 bits, que
 * es el que produjo el workflow.
 * Android: `.apk`. Si hay varios, prefiere `universal`: cubre todas las ABI y
 * evita que un ARM viejo se baje un APK que no corre.
 */
function elegirAsset(assets: AssetApi[]): AssetPlataforma | null {
  if (assets.length === 0) return null;

  const candidatos = esAndroid()
    ? assets.filter((a) => a.name.toLowerCase().endsWith('.apk'))
    : assets.filter((a) => /\.(exe|msi)$/i.test(a.name));

  if (candidatos.length === 0) return null;

  const preferido =
    esAndroid()
      ? (candidatos.find((a) => /universal/i.test(a.name)) ?? candidatos[0])
      : (candidatos.find((a) => /x64|64bit/i.test(a.name)) ?? candidatos[0]);

  return {
    nombre: preferido.name,
    url: preferido.browser_download_url,
    tam: preferido.size ?? 0,
  };
}

/**
 * Marca una versión como ignorada, para no volver a mostrar el aviso.
 */
export function ignorarVersion(version: string): void {
  try {
    localStorage.setItem(CLAVE_IGNORADA, version);
  } catch { /* idem */ }
}

export interface ResultadoDescarga {
  ok: boolean;
  /** Motivo cuando `ok` false. */
  motivo?: string;
}

/**
 * Descarga el instalador/APK y lo abre para que el sistema lo instale.
 *
 * `onProgreso` recibe 0..100 y la cantidad legible; el caller lo pinta.
 */
export async function descargarYInstalar(
  info: InfoActualizacion,
  onProgreso?: (pct: number, texto: string) => void
): Promise<ResultadoDescarga> {
  if (!info.asset) return { ok: false, motivo: 'sin_asset' };

  const asset = info.asset;
  const tamMB = asset.tam ? (asset.tam / 1024 / 1024).toFixed(1) : null;

  // ── Descarga ──
  // Se va juntando en memoria porque el plugin fs de Tauri no tiene append: el
  // instalador pesa ~100 MB y cabe sin problema. Progreso por el reader, igual
  // que la descarga de respaldos de Drive.
  let resp: Response;
  try {
    resp = await fetch(asset.url);
  } catch (e) {
    return { ok: false, motivo: `red: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok || !resp.body) {
    return { ok: false, motivo: `http_${resp.status}` };
  }

  const total = Number(resp.headers.get('content-length') || 0) || asset.tam || 0;
  const lector = resp.body.getReader();
  const partes: Uint8Array[] = [];
  let bajado = 0;

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (value) {
      partes.push(value);
      bajado += value.length;
      const pct = total > 0 ? Math.min(99, Math.round((bajado / total) * 100)) : 0;
      onProgreso?.(pct, tamMB ? `${(bajado / 1024 / 1024).toFixed(1)} / ${tamMB} MB` : `${(bajado / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  const todo = new Uint8Array(bajado);
  let off = 0;
  for (const p of partes) {
    todo.set(p, off);
    off += p.length;
  }

  // ── Escritura ──
  // La caché de la app ($APPCACHE) es de escritura libre y no requiere
  // confirmación del usuario; está habilitada en `fs:allow-appcache-write-recursive`
  // (capabilities/default.json). ⚠️ NO usar $TEMP en Android: temp_dir() apunta
  // a /data/local/tmp, que la app no puede escribir.
  let ruta: string;
  try {
    const dir = await appCacheDir();
    // Normalmente ya existe (en Windows es la carpeta de datos del WebView2 y en
    // Android getCacheDir()), pero crearla es barato y evita un fallo raro en una
    // instalación limpia. Mismo patrón que instrumentosExcel.ts.
    await mkdir(dir, { recursive: true }).catch(() => {});
    // El nombre puede traer caracteres que Windows/Android no aceptan en rutas;
    // se conserva la extensión, que es la que decide cómo se abre el archivo.
    const ext = (asset.nombre.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const base = (asset.nombre
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 60) || `school_tracker_${info.version}`);
    ruta = await join(dir, `${base}${ext}`);
    await writeFile(ruta, todo);
  } catch (e) {
    return { ok: false, motivo: `escribir: ${e instanceof Error ? e.message : String(e)}` };
  }

  onProgreso?.(100, '100%');

  // ── Instalación ──
  // Un solo comando Rust para las dos plataformas: en Windows lanza el .exe con
  // el ShellExecute del sistema, en Android comparte el APK por FileProvider y
  // abre el instalador de paquetes.
  try {
    await invoke('gd_instalar_actualizacion', { ruta });
  } catch (e) {
    return { ok: false, motivo: `abrir: ${e instanceof Error ? e.message : String(e)}` };
  }

  // En Windows hay que salir sí o sí: el .exe en uso no se puede sobrescribir y
  // el instalador NSIS se queda esperando. En Android ya está resuelto por el
  // sistema y salir solo cerraría la app sin más.
  if (esWindows()) {
    // @tauri-apps/api 2.11 no exporta exit, así que el cierra va por Rust.
    try { await invoke('gd_salir_app'); } catch (e) { console.warn('[Update] no se pudo cerrar la app:', e); }
  }

  return { ok: true };
}
