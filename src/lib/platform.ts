/**
 * Detección de plataforma y utilidades de rutas.
 *
 * Existe porque el código llegó a hardcodear `\\` como separador para "todo lo
 * que no sea Android" (`/Android/i.test(ua) ? '/' : '\\'`). En Linux y macOS
 * eso armaba rutas como `/home/user/Documents\SchoolTrackerPro\Plantillas`, que
 * no existían: las plantillas nunca se listaban y los instrumentos no se
 * guardaban. Lo mismo pasaba con `openUrl('file:///' + ruta)`, que en Linux
 * produce `file:////home/...` con cuatro barras.
 *
 * Regla: NUNCA hardcodear el separador ni armar `file://` a mano. Usar
 * `separadorRuta()`, `unirRuta()` y `aFileURL()` de acá.
 */

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/**
 * ¿Estamos en Android?
 *
 * Ojo: el user agent de Android TAMBIÉN contiene "Linux", así que esta
 * función tiene que evaluarse antes que `esLinux()` para no confundirlas.
 */
export function esAndroid(): boolean {
  return /Android/i.test(UA);
}

/** Windows de escritorio. Android no reporta "Windows", así que no hay falsos positivos. */
export function esWindows(): boolean {
  return /Windows/i.test(UA);
}

export function esMacOS(): boolean {
  return /Mac/i.test(UA) && !esAndroid();
}

export function esLinux(): boolean {
  return /Linux|X11/i.test(UA) && !esAndroid();
}

/** ¿Es un escritorio (Windows, macOS o Linux)? */
export function esEscritorio(): boolean {
  return !esAndroid();
}

/**
 * Separador de ruta del sistema: `\` en Windows, `/` en Android, Linux y macOS.
 *
 * En macOS y Linux `/` también funciona en la API de archivos, pero se usa `\`
 * solo en Windows porque es lo que `documentDir()` devuelve tal cual y lo que
 * espera `tauri-plugin-fs`.
 */
export function separadorRuta(): string {
  return esWindows() ? '\\' : '/';
}

/**
 * Une segmentos con el separador correcto.
 *
 * Tolera que los segmentos ya traigan `/` o `\` de antes, así que
 * `unirRuta(docsPath, 'Sub', archivo)` y `unirRuta(docsPath, '/Sub/', archivo)`
 * dan lo mismo. No duplica separadores.
 */
export function unirRuta(...partes: string[]): string {
  const limpio = partes.filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (limpio.length === 0) return '';
  return limpio
    .map((p, i) => {
      let s = p;
      if (i > 0) s = s.replace(/^[/\\]+/, '');
      if (i < limpio.length - 1) s = s.replace(/[/\\]+$/, '');
      return s;
    })
    .join(separadorRuta());
}

/**
 * Convierte una ruta del sistema en una URL `file://` válida para `openUrl`.
 *
 *   Windows  C:\Users\k\Docs  → file:///C:/Users/k/Docs   (3 barras: host vacío)
 *   Linux    /home/k/Docs     → file:///home/k/Docs       (3 barras, NUNCA 4)
 *
 * Prefijar la unidad es lo que hace que el host quede vacío; concatenar
 * `file:///` a una ruta POSIX daba `file:////home/...`, que muchos gestores de
 * archivos rechazan. `encodeURI` escapa los espacios (la app escribe en
 * "School Tracker", que los tiene) sin tocar `/` ni el `:` de la unidad.
 */
export function aFileURL(ruta: string): string {
  const conBarras = ruta.replace(/\\/g, '/');
  const conUnidad = /^[a-zA-Z]:/.test(conBarras) ? `/${conBarras}` : conBarras;
  return encodeURI(`file://${conUnidad}`);
}

/**
 * ¿La pantalla tiene ancho de escritorio?
 *
 * Sustituye al viejo `/Windows/i.test(ua)` para decidir entre la UI ancha y la
 * compacta. Aquello asumía que "no es Windows" ⇒ "es Android de teléfono", así
 * que en Linux de escritorio caía en la versión angosta y con el menú de
 * marcado diario. Ahora la pregunta correcta es "¿hay ancho suficiente?".
 *
 * `anchoCorte` es el breakpoint que usa el resto de la app (App.svelte).
 */
export function esPantallaAncha(anchoCorte = 768, anchoActual?: number): boolean {
  const ancho = anchoActual ?? (typeof window !== 'undefined' ? window.innerWidth : anchoCorte + 1);
  return ancho > anchoCorte;
}
