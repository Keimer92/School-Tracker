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
import { invoke } from "@tauri-apps/api/core";
import type { InstrumentoTipo } from "./instrumentosPdf";

/**
 * Presentación configurable del instrumento. Todas las claves son opcionales
 * para tolerar JSON viejos/incompletos (parseDefinicion rellena los defaults).
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
}

/** Definición por defecto según el tipo del instrumento. */
export function defaultDefinicion(_tipo: InstrumentoTipo = "escala"): PlantillaDefinicion {
  return {
    titulo: "",
    textoIntro: "",
    leyenda: "",
    mostrarPuntajeCriterios: true,
    colFinal: "valoracion",
    orientacion: "auto",
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
