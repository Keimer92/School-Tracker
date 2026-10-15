/**
 * Formato de fecha y hora de la app: EL NICARAGÜENSE.
 *
 *   Fecha:  14/Sep/2026
 *   Hora:   10:40 p.m.
 *   Full:   14/Sep/2026 · 10:40 p.m.
 *
 * Se aplica en TODA la app: UI, nombres de archivo generados desde la base,
 * Excel y PDF. Antes cada uno de esos lugares llamaba a `toLocaleDateString` con
 * su propio tag de locale, así que el mismo dato salía `14/09/2026` en un lugar
 * y `9/14/2026` en otro según dónde se mirara. Ahora hay UNA sola definición.
 *
 * ── Por qué NO se usa `Intl.DateTimeFormat` ──
 *
 * `Intl` respects el locale del sistema para el separador, pero el orden de los
 * componentes depende del REGION, no del idioma, y `es-ES` rinde `14/09/2026`
 * mientras el estándar local quiere `14/Sep/2026`. Además el nombre del mes
 * abreviado de `es-ES` es `sept` y de `en-US` es `Sep`, así que una tabla fija
 * es la única forma de garantizar el texto exacto en los dos idiomas. Es
 * deliberado: el formato es un requisito de negocio, no una preferencia del
 * navegador.
 *
 * ── El módulo es puro ──
 *
 * No lee `localStorage` ni el rune de idioma: el idioma llega POR PARÁMETRO.
 * Eso lo hace utilizable desde los generadores de Excel y PDF, que corren
 * fuera del ciclo de render de Svelte y donde leer el estado reactivo no
 * registraría dependencia. Quien está en un `.svelte` y quiere la versión
 * reactiva usa `fmtFecha` / `fmtHora` de `i18n.svelte.ts`, que pasan el idioma
 * activo por debajo.
 */

export type IdiomaFecha = 'es' | 'en';

/**
 * Abreviaturas de mes.
 *
 * ⚠️ Van a mano, no salen de `Intl`. La de septiembre en español es `Sep` (tres
 * letras, sin la `t` que le pone `es-ES`), y en inglés también `Sep`: coinciden,
 * y por eso el formato se lee igual en los dos idiomas salvo por la `t` final.
 */
const MESES: Record<IdiomaFecha, readonly string[]> = {
  es: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** Sufijo de meridiem. Igual en ambos idiomas: 12h es 12h. */
const MERIDIEM = 'p.m.';

/** Una `a.m.` abreviada; la de `p.m.` se exporta porque a veces se necesita sola. */
export const AM_PM = 'a.m.';
export const PM_AM = MERIDIEM;

/**
 * Convierte la entrada a un `Date` sin desfase de zona horaria.
 *
 * ⚠️ ESTE ES EL BUG QUE SE ESTABA COMETIENDO EN TODA LA APP.
 *
 * `new Date('2026-09-14')` lo interpreta como **medianoche UTC**. En Nicaragua
 * (UTC-6) eso es `13/09/2026 18:00` locales: la fecha DEL DÍA ANTERIOR. Toda
 * fecha que viene de la base como `YYYY-MM-DD` — que es como se guardan
 * asistencia, días sin clases y notas— pasaba por ahí y salía corrida.
 *
 * Por eso el caso "solo fecha" se parsea a mano con el constructor local
 * (`new Date(y, m-1, d)`), que no convierte nada. Los casos con hora sí se pasan
 * a `Date`, porque ahí la zona horaria es la del dispositivo y no hay ambigüedad.
 *
 * Acepta: `Date`, `2026-09-14`, `2026-09-14 10:40`, `2026-09-14T10:40`,
 * `2026-09-14T10:40:00Z`, o un `Date`.
 */
export function aFecha(valor: Date | string | number | null | undefined): Date | null {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;

  if (typeof valor === 'number') {
    const d = new Date(valor);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(valor).trim();

  // Solo fecha: `YYYY-MM-DD`, sin hora. Se parsea en hora LOCAL a propósito.
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soloFecha) {
    const d = new Date(
      Number(soloFecha[1]),
      Number(soloFecha[2]) - 1,
      Number(soloFecha[3]),
      12, 12, 0, 0
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // `YYYY-MM-DD HH:mm(:ss)`: el `T` de ISO no está, `Date` lo rechaza en varios
  // motores. Se cambia por espacio y se parsea local (no hay `Z`, así que no
  // hay conversión UTC implícita y no hay desfase).
  const conHora = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (conHora) {
    const d = new Date(
      Number(conHora[1]),
      Number(conHora[2]) - 1,
      Number(conHora[3]),
      Number(conHora[4]),
      Number(conHora[5]),
      conHora[6] ? Number(conHora[6]) : 0,
      0
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // Cualquier otra cosa (ISO completo con `Z`, o un `number` en string): se
  // deja que `Date` lo resuelva, que sí sabe de zonas horarias.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function dos(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** `2026-09-14` -> `14/Sep/2026`. Sin padding en el día ni en el año. */
export function fmtFechaNica(valor: Date | string | number | null | undefined, idioma: IdiomaFecha = 'es'): string {
  const d = aFecha(valor);
  if (!d) return '';
  return `${d.getDate()}/${MESES[idioma][d.getMonth()]}/${d.getFullYear()}`;
}

/**
 * `2026-09-14T22:40` -> `10:40 p.m.`
 *
 * Es un reloj de 12 horas a propósito: es el formato local, y evita que un
 * `22:40` en un reporte de asistencia se lea como dato de otro día. La hora va
 * con dos dígitos porque el estándar local la muestra así.
 */
export function fmtHoraNica(valor: Date | string | number | null | undefined, idioma: IdiomaFecha = 'es'): string {
  const d = aFecha(valor);
  if (!d) return '';
  let h = d.getHours();
  const m = dos(d.getMinutes());
  const sufijo = h >= 12 ? MERIDIEM : AM_PM;
  h %= 12;
  if (h === 0) h = 12; // medianoche y mediodía son 12, no 0
  return `${dos(h)}:${m} ${sufijo}`;
}

/** `14/Sep/2026 · 10:40 p.m.` — el separador es `·` para que no se confunda con el `/` de la fecha. */
export function fmtFechaHoraNica(valor: Date | string | number | null | undefined, idioma: IdiomaFecha = 'es'): string {
  const d = aFecha(valor);
  if (!d) return '';
  return `${fmtFechaNica(d, idioma)} · ${fmtHoraNica(d, idioma)}`;
}

/**
 * Versión para NOMBRES DE ARCHIVO: `14-Sep-2026 10.40 p.m.`
 *
 * Sustituye los `:` por `.` porque los dos puntos no se permiten en Windows,
 * macOS ni Android, y este formato se usa justamente para los nombres que
 * genera el respaldo de Drive y los PDF. El resto del formato no cambia, para
 * que un archivo y su contenido se lean igual.
 */
export function fmtParaArchivo(valor: Date | string | number | null | undefined, idioma: IdiomaFecha = 'es'): string {
  const d = aFecha(valor);
  if (!d) return '';
  return `${fmtFechaNica(d, idioma)} ${fmtHoraNica(d, idioma).replace(':', '.')}`;
}

/** `14-Sep-2026` — solo la fecha, segura para nombres de archivo. */
export function fmtFechaArchivo(valor: Date | string | number | null | undefined, idioma: IdiomaFecha = 'es'): string {
  return fmtFechaNica(valor, idioma).replace(/\//g, '-');
}

/**
 * Rango corto para tablas: `14/Sep` → `14/Sep/2026`, `14/Sep` → `14/Sep/2026`.
 *
 * Devuelve '' si no hay fecha, para que quien lo pinte pueda omitir la celda.
 */
export function fmtFechaCorta(valor: Date | string | number | null | undefined, idioma: IdiomaFecha = 'es'): string {
  const d = aFecha(valor);
  if (!d) return '';
  return `${d.getDate()}/${MESES[idioma][d.getMonth()]}`;
}