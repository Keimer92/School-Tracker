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
  est?: {
    n: number;
    nombre: string;
    /** letras por criterio (0-based), '' sin nota */
    letras: string[];
    valoracion: string;
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
  for (let k = 1; k <= 5; k++) {
    const desc = d.criterios[k - 1];
    // Criterio inexistente → el texto se colapsa a vacío (no imprime marcador).
    o = o.replace(new RegExp(`\\{CRIT_${k}\\}`, "g"), desc || "");
  }
  if (d.est) {
    o = o
      .replace(/\{N\}/g, String(d.est.n))
      .replace(/\{ESTUDIANTE\}/g, d.est.nombre)
      .replace(/\{VALORACION\}/g, d.est.valoracion);
    for (let k = 1; k <= 5; k++) {
      o = o.replace(new RegExp(`\\{LETRA_${k}\\}`, "g"), d.est.letras[k - 1] ?? "");
    }
  } else {
    // Fila de cabecera: la fila de estudiantes no se repite, tokens vacíos.
    o = o
      .replace(/\{N\}/g, "")
      .replace(/\{ESTUDIANTE\}/g, "")
      .replace(/\{VALORACION\}/g, "");
    for (let k = 1; k <= 5; k++) {
      o = o.replace(new RegExp(`\\{LETRA_${k}\\}`, "g"), "");
    }
  }
  return o;
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

/** Cuadrícula inicial estilo "lista de cotejo": encabezado fusionado, grupos
 *  por criterio (AA/AS/AF) y fila de estudiante con sus tokens. */
export function gridPresetChecklist(): PlantillaGrid {
  return {
    filas: 4,
    cols: 8,
    filaEstudiantes: 3,
    celdas: {
      "0:0": { v: "{COLEGIO} — {GRADO} {SECCION} — {FECHA}", cs: 8 },
      "1:0": { v: "Nº" },
      "1:1": { v: "{CRIT_1}", cs: 3 },
      "1:4": { v: "{CRIT_2}", cs: 3 },
      "1:7": { v: "Valoración" },
      "2:1": { v: "AA" },
      "2:2": { v: "AS" },
      "2:3": { v: "AF" },
      "2:4": { v: "AA" },
      "2:5": { v: "AS" },
      "2:6": { v: "AF" },
      "2:7": { v: "Valoración" },
      "3:0": { v: "{N}" },
      "3:1": { v: "{LETRA_1}", cs: 3 },
      "3:4": { v: "{LETRA_2}", cs: 3 },
      "3:7": { v: "{VALORACION}" },
    },
  };
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
