import { es, type Clave } from './locales/es';
import { en } from './locales/en';

export type Locale = 'es' | 'en';
export type { Clave };

const CLAVE = 'stp_locale';

const DICCIONARIOS: Record<Locale, Record<Clave, string>> = { es, en };

/**
 * Etiquetas de cada idioma en SU PROPIO idioma (unselector de idioma que
 * muestra "Spanish" en lugar de "Español" no ayuda a quien no lee el que ya
 * conoce). Para eso se usan las claves `idioma.*` y no `nav.*`.
 */
const ETIQUETAS: Record<Locale, string> = {
  es: es['idioma.es'],
  en: en['idioma.en'],
};

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'es', label: ETIQUETAS.es },
  { id: 'en', label: ETIQUETAS.en },
];

function desdeTag(tag: string | undefined | null): Locale | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith('en')) return 'en';
  if (t.startsWith('es')) return 'es';
  return null;
}

/**
 * Idioma inicial, en orden de prioridad:
 *
 * 1. Preferencia guardada por el usuario.
 * 2. `navigator.languages` — la lista ordenada de preferencias del navegador.
 * 3. `navigator.language`.
 * 4. Español.
 *
 * Sobre el punto 2: en Windows y Android, `navigator.language` **deriva del
 * idioma del sistema operativo**, que es justo lo pedido. La única excepción
 * conocida es Android 13+ con "idiomas por app" configurado para School Tracker:
 * ahí el WebView puede reportar algo distinto al del sistema. Se resuelve con
 * JNI (`Locale.getDefault()`), pero no se hizo a propósito: exige tocar
 * `MainActivity.kt` dentro de `gen/android` (archivos commiteados a mano) y
 * sumar una función nativa por una diferencia que casi nunca se pierde. Si
 * alguna vez aparece, el enganche es acá: un comando `gd_system_language` que
 * devuelva el tag del SO y se consulte antes del paso 2.
 */
function detectarLocale(): Locale {
  try {
    const guardado = localStorage.getItem(CLAVE);
    const desdeGuardado = desdeTag(guardado);
    if (desdeGuardado) return desdeGuardado;
  } catch {
    // localStorage puede estar bloqueado; se sigue con la deteccion.
  }

  try {
    const lista = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of lista) {
      const l = desdeTag(tag);
      if (l) return l;
    }
    const l = desdeTag(navigator.language);
    if (l) return l;
  } catch {
    // Sin `navigator` no hay nada que detectar.
  }

  return 'es';
}

/**
 * Estado global del idioma.
 *
 * Vive en un módulo `.svelte.ts` (y no en un `.ts` comun) para poder usar
 * `$state`: asi `t()` queda REACTIVO sin que cada componente tenga que
 * suscribirse a mano. Si el estado fuera un `let` normal, cambiar el idioma
 * solo se reflejaria en los componentes que se re-renderizan por otra causa, y
 * la app quedaria medio traducida.
 */
let locale = $state<Locale>(detectarLocale());

/** Idioma actual. Solo lectura desde afuera: usar `setLocale`. */
export function getLocale(): Locale {
  return locale;
}

/** Cambia el idioma, lo persiste y notifica a toda la UI. */
export function setLocale(nuevo: Locale): void {
  if (nuevo !== 'es' && nuevo !== 'en') return;
  locale = nuevo;
  try {
    localStorage.setItem(CLAVE, nuevo);
  } catch (e) {
    console.warn('[i18n] no se pudo guardar el idioma:', e);
  }
  // El <html lang> lo leen los lectores de pantalla y el spellcheck del SO.
  try {
    document.documentElement.lang = nuevo;
  } catch {
    // Si no hay document (tests), se ignora.
  }
  try {
    window.dispatchEvent(new CustomEvent('schooltracker-locale', { detail: nuevo }));
  } catch {
    // idem
  }
}

/** Nombre del idioma actual, en su propio idioma. */
export function etiquetaLocale(l: Locale = locale): string {
  return ETIQUETAS[l];
}

/**
 * Traduce una clave.
 *
 * - Si la clave no existe en el idioma activo cae al español, y si tampoco
 *   está ahí devuelve la propia clave: un texto faltante se ve raro, pero
 *   siempre es legible (nunca `undefined` en pantalla).
 * - Los parámetros se escriben `{nombre}` y se rellenan con `t(k, {nombre})`.
 *   Un parámetro que no llega queda visible como `{nombre}`, que es justo lo
 *   que hay que ver en el bug report.
 */
export function t(clave: Clave, vars?: Record<string, string | number>): string {
  const base = DICCIONARIOS[locale][clave] ?? DICCIONARIOS.es[clave] ?? clave;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`
  );
}

/**
 * Cuenta reactiva de cuántos idiomas hay. Permite escribir en el template
 * `{#if hayMasDeUnIdioma()}` y que se reevalúe sola si algún día se agrega uno.
 */
export function cantidadLocales(): number {
  void locale;
  return Object.keys(DICCIONARIOS).length;
}

/** Aplica el idioma guardado al `<html lang>` al arrancar. */
export function inicializarIdioma(): void {
  try {
    document.documentElement.lang = locale;
  } catch {
    // idem
  }
}
