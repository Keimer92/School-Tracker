/**
 * Helpers de selección por defecto para los catálogos.
 *
 * Con `set_active_colegio` eliminado ya no existe un colegio "predeterminado":
 * `colegio.activo` queda siempre en 0 y las páginas eligen uno por su cuenta.
 * Centralizarlo acá evita que cada página invente su propio criterio y que
 * terminen dependiendo de un `activo` que nadie escribe.
 */

export interface CatItem { id: number; nombre: string; }

/**
 * Orden alfabético real (español): `localeCompare` con locale `es` para que
 * "Ángel" ordene antes que "Beta" y no después de "Zeta" como hace el comparador
 * por punto de código.
 */
export function porNombre<T extends CatItem>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Primer colegio por orden alfabético. Es el desempate que usan todas las
 * páginas cuando no hay un criterio más específico (días hábiles, filtro, etc).
 */
export function primerColegio<T extends CatItem>(lista: T[]): T | undefined {
  return porNombre(lista)[0];
}