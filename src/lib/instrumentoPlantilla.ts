// Plantillas de instrumentos de evaluación (constructor visual).
//
// La definición vive en la BD (`instrumento_plantilla`, tabla sincronizable con
// Cloudflare D1), NO en archivos .xlsx de una carpeta del disco: así las
// plantillas viajan entre dispositivos (Windows ↔ Android) con el resto de
// los datos y sobreviven al restore de Drive.
//
// El CRUD visual vive en Configuración (globales/PlantillasConfig.svelte);
// NotasPage SOLO consume: elige la plantilla por tipo y la pasa a los
// generadores de PDF/Excel junto con los datos reales del indicador.
//
// Hay DOS modos de definición:
// - `grid` presente → editor de CUADRÍCULA tipo Excel (celdas fusionables,
//   fila de estudiantes que se expande, tokens {COLEGIO}, {LETRA_1}...).
// - sin `grid` → diseño "rápido" por campos (el primero que hubo; los docs
//   anteriores siguen renderizando igual).
import { invoke } from "@tauri-apps/api/core";
import type { InstrumentoTipo } from "./instrumentosPdf";

/** Celda de la cuadrícula. `v` admite texto y tokens. cs/rs = col/rowspan (merge). */
export interface GridCelda {
  v: string;
  cs?: number; // colspan: columnas que abarca
  rs?: number; // rowspan: filas que abarca
}

/** Cuadrícula tipo Excel. `celdas` indexa la celda SUPERIOR-IZQUIERDA de cada
 *  merge con la clave "fila:col" (0-based); las celdas cubiertas no van. */
export interface PlantillaGrid {
  filas: number; // nº de filas de la plantilla
  cols: number; // nº de columnas (sin expandir)
  /** Índice (0-based) de la fila que se expande por estudiante. -1 = ninguna. */
  filaEstudiantes: number;
  celdas: Record<string, GridCelda>;
}

export const TOKEN_FILA = "{ESTUDIANTE}"; // nombre del estudiante
export const TOKEN_NUM = "{N}"; // numeración 1..n
export const TOKEN_VALORACION = "{VALORACION}"; // nota final (letra)
export const TOKEN_LETRA = "{LETRA_"; // prefijo de {LETRA_1}..{LETRA_5}

/** Contexto de datos para reemplazar tokens al generar un documento. */
export interface TokenDatos {
  metaSel: Record<string, string>; // COLEGIO, GRADO, SECCION, ASIGNATURA, CORTE, ANO
  indN: number;
  indDesc: string;
  /** descripciones de criterios (0-based): criterios[0] = criterio 1 */
  criterios: string[];
  /** Contexto CUALITATIVO (grado/asignatura cualitativa): la escala NO incluye
   *  AI (lógica de negocio: AA/AS/AF solamente). {AI} colapsa a vacío. */
  sinAI?: boolean;
  est?: {
    n: number;
    nombre: string;
    /** letras por criterio (0-based), '' sin nota */
    letras: string[];
    valoracion: string;
    /** Total del indicador "pts + sigla" (ej. "17 AS"); '' sin notas. */
    total?: string;
    /** Nota Final del corte "pts + sigla"; '' sin notas. */
    nf?: string;
    /** Total Criterio {TC_k}: pts de cada criterio (0-based), '' sin nota. */
    tcs?: string[];
  };
}

const fechaHoy = (): string => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** Reemplaza los tokens de la plantilla con los datos reales de un indicador
 *  (auth de cabecera, sin estudiante) o de UN estudiante (fila expandida). */
export function resolverTokens(texto: string, d: TokenDatos): string {
  if (!texto) return "";
  let o = texto;
  const m = d.metaSel;
  o = o
    .replace(/\{COLEGIO\}/g, m.COLEGIO ?? "")
    .replace(/\{GRADO\}/g, m.GRADO ?? "")
    .replace(/\{SECCION\}/g, m.SECCION ?? "")
    .replace(/\{ASIGNATURA\}/g, m.ASIGNATURA ?? "")
    .replace(/\{CORTE\}/g, m.CORTE ?? "")
    .replace(/\{ANO\}/g, m.ANO ?? "")
    .replace(/\{FECHA\}/g, fechaHoy())
    .replace(/\{IND_N\}/g, String(d.indN))
    .replace(/\{IND_DESC\}/g, d.indDesc);
  for (let k = 1; k <= 3; k++) {
    const desc = d.criterios[k - 1];
    // Criterio inexistente → el texto se colapsa a vacío (no imprime marcador).
    o = o.replace(new RegExp(`\\{CRIT_${k}\\}`, "g"), desc || `Criterio ${k}`);
  }
  // Tokens de escala: la sigla queda tal cual; AI solo existe en contextos
  // CUANTITATIVOS (grado/asignatura cualitativa → sinAI colapsa a vacío).
  o = o
    .replace(/\{AA\}/g, "AA")
    .replace(/\{AS\}/g, "AS")
    .replace(/\{AF\}/g, "AF")
    .replace(/\{AI\}/g, d.sinAI ? "" : "AI");
  if (d.est) {
    o = o
      .replace(/\{N\}/g, String(d.est.n))
      .replace(/\{ESTUDIANTE\}/g, d.est.nombre)
      .replace(/\{VALORACION\}/g, d.est.valoracion)
      .replace(/\{TOTAL\}/g, d.est.total || "")
      .replace(/\{NF\}/g, d.est.nf || "");
    for (let k = 1; k <= 3; k++) {
      o = o.replace(new RegExp(`\\{LETRA_${k}\\}`, "g"), d.est.letras[k - 1] ?? "");
      // {TC_k}: Total Criterio (pts de ese criterio, misma fórmula que TC en la
      // tabla de notas).
      o = o.replace(new RegExp(`\\{TC_${k}\\}`, "g"), d.est.tcs?.[k - 1] ?? "");
    }
  } else {
    // Fila de cabecera: la fila de estudiantes no se repite, tokens vacíos.
    o = o
      .replace(/\{N\}/g, "")
      .replace(/\{ESTUDIANTE\}/g, "")
      .replace(/\{VALORACION\}/g, "")
      .replace(/\{TOTAL\}/g, "")
      .replace(/\{NF\}/g, "");
    for (let k = 1; k <= 3; k++) {
      o = o.replace(new RegExp(`\\{LETRA_${k}\\}`, "g"), "");
      o = o.replace(new RegExp(`\\{TC_${k}\\}`, "g"), "");
    }
  }
  return o;
}

/**
 * Colores del sistema para pintar el instrumento (PDF y Excel). Sin esto las
 * celdas salen en negro. `porLetra` mapea la sigla (AA/AS/AF/AI) a su color
 * configurado en Globales → Calificaciones; `sexoM`/`sexoF` son los colores de
 * fuente por sexo del ajuste de Apariencia.
 */
export interface InstrumentoColores {
  porLetra?: Record<string, string>;
  sexoM?: string;
  sexoF?: string;
}

const RE_LETRA_NOTA = /(AA|AS|AF|AI)/;

/**
 * Color de una celda de DATOS (fila de estudiantes) siguiendo la convención de
 * la tabla de NotasPage: el nombre va con el color del sexo y una celda con una
 * sigla de nota (letra, TC, total o NF) con el color de esa sigla. `undefined`
 * = sin color (se pinta en negro, como los encabezados).
 */
export function colorDeCelda(
  raw: string,
  texto: string,
  colores: InstrumentoColores | undefined,
  sexo?: string,
): string | undefined {
  if (!colores) return undefined;
  if ((raw || "").trim() === "{ESTUDIANTE}") {
    return sexo === "F" ? colores.sexoF : colores.sexoM;
  }
  const m = (texto || "").toUpperCase().match(RE_LETRA_NOTA);
  if (m && colores.porLetra?.[m[1]]) return colores.porLetra[m[1]];
  return undefined;
}

/**
 * ¿La celda va CENTRADA? Sí para las celdas de datos cortas (Nº, escala,
 * letras, TC, total, NF); el nombre del estudiante y los encabezados van a la
 * izquierda.
 */
const RE_CENTRAR = /^\{(N|LETRA_\d|TC_\d|TOTAL|NF|VALORACION|AA|AS|AF|AI)\}$/;
export function centrarCelda(raw: string): boolean {
  return RE_CENTRAR.test((raw || "").trim());
}

/** Columnas de la cuadrícula que representan la nota AI de la escala: celdas
 *  cuyo texto pelado es exactamente `{AI}` (o `AI` estático, por plantillas
 *  hechas a mano). Al generar en un contexto cualitativo esas columnas SE
 *  COLAPSAN (el AI no aplica en ese régimen). */
export function columnasAI(g: PlantillaGrid): Set<number> {
  const out = new Set<number>();
  for (const [k, cel] of Object.entries(g.celdas)) {
    const t = (cel.v ?? "").trim();
    if ((t === "{AI}" || t === "AI") && (cel.cs ?? 1) === 1) out.add(Number(k.split(":")[1]));
  }
  return out;
}

/** Columnas a omitir: las {AI} solo si el contexto es cualitativo. */
export function columnasAIQuitar(g: PlantillaGrid, sinAI: boolean): Set<number> {
  return sinAI ? columnasAI(g) : new Set<number>();
}

/** Fecha de hoy como dd/mm/yyyy (los encabezados de los instrumentos). */
export function fechaHoyDDMM(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Presentación configurable del modo "rápido" (sin cuadrícula). Todas las
 * claves son opcionales para tolerar JSON viejos/incompletos.
 */
export interface PlantillaDefinicion {
  /** Título grande del documento. '' → usa el título por defecto del tipo. */
  titulo: string;
  /** Texto libre bajo el encabezado (objetivo/instrucciones para el docente). */
  textoIntro: string;
  /** Pie/leyenda de la escala. '' → usa la leyenda estándar (solo tipo escala). */
  leyenda: string;
  /** Muestra "(N pts)" junto a cada criterio en el encabezado. */
  mostrarPuntajeCriterios: boolean;
  /** Columna final de la tabla: Valoración / Total / sin columna final. */
  colFinal: "valoracion" | "total" | "ninguno";
  /** Orientación del PDF: auto (rúbrica vertical, resto horizontal) o forzada. */
  orientacion: "auto" | "horizontal" | "vertical";
  /** Cuadrícula tipo Excel: si existe, el editor y los generadores la usan. */
  grid?: PlantillaGrid;
}

/** Definición por defecto según el tipo del instrumento. */
export function defaultDefinicion(tipo: InstrumentoTipo = "escala"): PlantillaDefinicion {
  return {
    titulo: "",
    textoIntro: "",
    leyenda: "",
    mostrarPuntajeCriterios: true,
    colFinal: "valoracion",
    orientacion: "auto",
    grid: gridPresetChecklist(),
  };
}

/** JSON guardado en BD → PlantillaDefinicion completa (tolera claves faltantes). */
export function parseDefinicion(raw: string | null | undefined): PlantillaDefinicion {
  const base = defaultDefinicion();
  if (!raw) return base;
  try {
    const obj = JSON.parse(raw) as Partial<PlantillaDefinicion>;
    return { ...base, ...obj };
  } catch {
    return base;
  }
}

/** Cuadrícula inicial estilo "lista de cotejo" — 3 CRITERIOS (regla global:
 *  los indicadores del sistema funcionan SIEMPRE con 3 criterios), cada uno
 *  con su grupo de escala completa AA/AS/AF/AI como tokens. Con la plantilla
 *  en modo cualitativo (grado/sección `cualitativo`, ya contemplado por la
 *  lógica de negocio) el renderizador COLAPSA la columna {AI}: no aplica.
 *
 *  El ENCABEZADO (colegio/grado/corte/indicador) NO va en la cuadrícula: lo
 *  dibuja el generador con la convención estándar de informe/reporte. La
 *  cuadrícula pura es la tabla: Nº · Estudiante · criterios · Valoración. */
export function gridPresetChecklist(): PlantillaGrid {
  const celdas: Record<string, GridCelda> = {
    // Encabezados verticales (span las 2 filas de cabecera), como en la tabla
    // de NotasPage: Nº · Estudiante · [criterios] · TC por criterio · Total · NF.
    "0:0": { v: "Nº", rs: 2 },
    "0:1": { v: "Estudiante", rs: 2 },
    "0:17": { v: "Total", rs: 2 },
    "0:18": { v: "NF", rs: 2 },
    // Fila 1: escala dedicada (AA/AS/AF/AI) bajo cada criterio.
    "2:0": { v: "{N}" },
    "2:1": { v: "{ESTUDIANTE}" },
    "2:17": { v: "{TOTAL}" },
    "2:18": { v: "{NF}" },
  };
  // Por criterio: 4 columnas de escala (AA/AS/AF/AI) + 1 columna TC (Total
  // Criterio, abreviado) — misma convención que la tabla de notas (regla de
  // negocio: máx 3 criterios por indicador, NUNCA van CRIT_4/CRIT_5).
  const ESCALA = ["{AA}", "{AS}", "{AF}", "{AI}"];
  for (let k = 0; k < 3; k++) {
    const base = 2 + k * 5;
    celdas[`0:${base}`] = { v: `{CRIT_${k + 1}}`, cs: 4 };
    // TC abarca las 2 filas de cabecera (su texto ya es la abreviatura).
    celdas[`0:${base + 4}`] = { v: "TC", rs: 2 };
    ESCALA.forEach((e, i) => { celdas[`1:${base + i}`] = { v: e }; });
    // Fila 2: letra del estudiante (merge de las 4 cols de escala) + puntos TC.
    celdas[`2:${base}`] = { v: `{LETRA_${k + 1}}`, cs: 4 };
    celdas[`2:${base + 4}`] = { v: `{TC_${k + 1}}` };
  }
  return { filas: 3, cols: 19, filaEstudiantes: 2, celdas };
}

export interface InstrumentoPlantilla {
  id: number;
  nombre: string;
  tipo: InstrumentoTipo;
  definicion: string;
  updatedAt?: string;
}

function mappingDesdeBD(p: any): InstrumentoPlantilla | null {
  const tipo = ["cotejo", "escala", "rubrica"].includes(String(p?.tipo)) ? (p.tipo as InstrumentoTipo) : "escala";
  if (!p || typeof p.id !== "number" || !p.nombre) return null;
  return {
    id: p.id,
    nombre: String(p.nombre),
    tipo,
    definicion: typeof p.definicion === "string" ? p.definicion : "{}",
    updatedAt: p.updatedAt ?? p.updated_at,
  };
}

export async function listarInstrumentoPlantillas(): Promise<InstrumentoPlantilla[]> {
  const rows = await invoke<any[]>("get_instrumento_plantillas");
  return (rows || []).map(mappingDesdeBD).filter((p): p is InstrumentoPlantilla => p !== null);
}

/**
 * Guarda (insert o update). Devuelve la fila persistida con su id real, para
 * que la UI refresque sin recargar toda la lista.
 */
export async function guardarInstrumentoPlantilla(
  p: { id: number; nombre: string; tipo: InstrumentoTipo; definicion: PlantillaDefinicion },
): Promise<InstrumentoPlantilla> {
  const saved = await invoke<any>("save_instrumento_plantilla", {
    plantilla: {
      id: p.id,
      nombre: p.nombre,
      tipo: p.tipo,
      definicion: JSON.stringify(p.definicion),
    },
  });
  return mappingDesdeBD(saved) ?? { ...p, id: 0, definicion: JSON.stringify(p.definicion) };
}

export async function eliminarInstrumentoPlantilla(id: number): Promise<void> {
  await invoke("delete_instrumento_plantilla", { id });
}
