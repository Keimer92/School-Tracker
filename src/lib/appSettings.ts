import { invoke } from "@tauri-apps/api/core";

// Tipado de configuraciones sincronizables
export interface AppSettings {
  highlightColor: string;
  accentColor: string;
  showAnoDropdown: boolean;
  theme: string;
  notifEnabled: boolean;
  notifCfg: Record<number, { activo: boolean; inicio: string; fin: string; intervaloMin: number }>;
  /** Color de fuente de los estudiantes masculinos en tablas y paneles. */
  sexoMColor: string;
  /** Color de fuente de los estudiantes femeninos en tablas y paneles. */
  sexoFColor: string;
}

const DEFAULTS: AppSettings = {
  highlightColor: "#4ade80",
  accentColor: "indigo",
  showAnoDropdown: true,
  theme: "sistema",
  notifEnabled: false,
  notifCfg: {},
  sexoMColor: "#60a5fa",
  sexoFColor: "#f472b6",
};

// Estado en memoria
let _settings: AppSettings = { ...DEFAULTS };
let _loaded = false;
let _listeners: Array<(s: AppSettings) => void> = [];

// Caché localStorage como fallback (se migra la primera vez)
function readLocalStorageFallback(): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  try {
    const hc = localStorage.getItem("student-highlight-color");
    if (hc) result.highlightColor = hc;
    const ac = localStorage.getItem("stp_accent_color");
    if (ac) result.accentColor = ac;
    const ad = localStorage.getItem("stp_show_ano_dropdown");
    if (ad !== null) result.showAnoDropdown = ad !== "false";
    const tm = localStorage.getItem("theme_mode");
    if (tm) result.theme = tm;
    const sm = localStorage.getItem("stp_sexo_m_color");
    if (sm) result.sexoMColor = sm;
    const sf = localStorage.getItem("stp_sexo_f_color");
    if (sf) result.sexoFColor = sf;
    const nf = localStorage.getItem("stp_attendance_notif_settings");
    if (nf) {
      const parsed = JSON.parse(nf);
      result.notifEnabled = !!parsed.enabled;
      const map: Record<number, { activo: boolean; inicio: string; fin: string; intervaloMin: number }> = {};
      for (const c of Array.isArray(parsed.colegios) ? parsed.colegios : []) {
        if (typeof c === "object" && c.id != null) {
          map[Number(c.id)] = {
            activo: true,
            inicio: c.inicio || "07:00",
            fin: c.fin || "12:00",
            intervaloMin: Number(c.intervaloMin) || 45,
          };
        }
      }
      if (Object.keys(map).length > 0) result.notifCfg = map;
    }
  } catch { /* noop */ }
  return result;
}

function writeLocalStorageFallback(s: AppSettings) {
  try {
    localStorage.setItem("student-highlight-color", s.highlightColor);
    localStorage.setItem("stp_accent_color", s.accentColor);
    localStorage.setItem("stp_show_ano_dropdown", String(s.showAnoDropdown));
    localStorage.setItem("theme_mode", s.theme);
    localStorage.setItem("stp_sexo_m_color", s.sexoMColor);
    localStorage.setItem("stp_sexo_f_color", s.sexoFColor);
    const colegios = Object.entries(s.notifCfg)
      .filter(([, c]) => c.activo)
      .map(([id, c]) => ({ id: Number(id), inicio: c.inicio, fin: c.fin, intervaloMin: c.intervaloMin }));
    localStorage.setItem("stp_attendance_notif_settings", JSON.stringify({ enabled: s.notifEnabled && colegios.length > 0, colegios }));
  } catch { /* noop */ }
}

function notify() {
  for (const fn of _listeners) fn(_settings);
}

/**
 * Clave de la fila dedicada de alertas de asistencia dentro de `app_settings`.
 * No confundir con `main`, que guarda tema/colores/opciones de la UI.
 */
const ATTENDANCE_KEY = "attendance";

function leerJSON(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Escribe SOLO la fila de alertas (no toca el blob `main`). */
async function escribirFilaAsistencia(settings: AppSettings): Promise<void> {
  const payload = JSON.stringify({
    notifEnabled: !!settings.notifEnabled,
    notifCfg: settings.notifCfg || {},
  });
  await invoke("set_app_setting", { key: ATTENDANCE_KEY, value: payload });
}

/**
 * Guarda la config de alertas de asistencia en su fila dedicada y dispara el
 * sync (D1 + respaldo instantáneo a Drive).
 *
 * Se separa de `saveAppSettings` a propósito: la config de alertas no puede
 * viajar dentro del blob `main`, porque cualquier cambio de tema/color en otro
 * equipo reescribe ese blob completo con su copia en memoria y la pisaría.
 */
export async function saveAttendanceSettings(
  notifEnabled: boolean,
  notifCfg: AppSettings["notifCfg"]
): Promise<void> {
  _settings = { ..._settings, notifEnabled: !!notifEnabled, notifCfg: notifCfg || {} };
  writeLocalStorageFallback(_settings);
  try {
    await escribirFilaAsistencia(_settings);
    // Copia en `main` solo por compatibilidad con respaldos/versiones viejas.
    // Las lecturas nuevas prefieren siempre la fila `attendance`.
    await invoke("set_app_settings", { settingsJson: JSON.stringify(_settings) });
    const { onDataChange } = await import("./autoSync");
    onDataChange("app_settings", { immediate: true });
  } catch (e) {
    console.error("[appSettings] Error saving attendance settings:", e);
  }
  notify();
}

/**
 * Carga settings desde Rust. La primera vez migra desde localStorage si la tabla está vacía.
 *
 * La config de alertas de asistencia vive en su PROPIA fila (`key = 'attendance'`),
 * separada del blob general (`key = 'main'`). Motivo: `main` se reescribe entero
 * cada vez que en cualquier equipo se cambia el tema, un color, etc. Si la config
 * de alertas estuviera dentro de ese blob, un guardado con un estado viejo la
 * borraba (síntoma: "al reinstalar, la página siempre está desactivada").
 */
export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const [rawMain, rawAtt] = await Promise.all([
      invoke<string>("get_app_settings"),
      invoke<string>("get_app_setting", { key: ATTENDANCE_KEY }).catch(() => "{}"),
    ]);
    const parsed = leerJSON(rawMain);
    const att = leerJSON(rawAtt);
    _settings = { ...DEFAULTS, ...parsed };
    // Primera vez: si la tabla vino vacía, migrar desde localStorage
    if (Object.keys(parsed).length === 0) {
      const fallback = readLocalStorageFallback();
      if (Object.keys(fallback).length > 0) {
        _settings = { ...DEFAULTS, ...fallback };
        await saveAppSettings(_settings);
      }
    }
    // La fila dedicada SIEMPRE gana sobre lo que haya en `main`.
    const attTieneDatos =
      !!att && (typeof att.notifEnabled === "boolean" || (att.notifCfg && Object.keys(att.notifCfg).length > 0));
    if (attTieneDatos) {
      _settings.notifEnabled = !!att.notifEnabled;
      _settings.notifCfg = att.notifCfg || {};
    } else if (_settings.notifEnabled || Object.keys(_settings.notifCfg || {}).length > 0) {
      // Migración del esquema viejo (todo dentro de `main`/localStorage):
      // se copia a la fila dedicada para que deje de depender del blob.
      try {
        await escribirFilaAsistencia(_settings);
        console.log("[appSettings] config de alertas migrada a su fila dedicada");
      } catch (e) {
        console.warn("[appSettings] no se pudo migrar la config de alertas:", e);
      }
    }
  } catch (e) {
    console.error("[appSettings] Error loading from Rust:", e);
    // Fallback a localStorage
    const fallback = readLocalStorageFallback();
    _settings = { ...DEFAULTS, ...fallback };
  }
  _loaded = true;
  // Sincronizar localStorage como caché
  writeLocalStorageFallback(_settings);
  notify();
  return _settings;
}

/**
 * Guarda settings en Rust + localStorage caché.
 */
export async function saveAppSettings(settings: AppSettings): Promise<void> {
  _settings = { ...settings };
  writeLocalStorageFallback(_settings);
  try {
    await invoke("set_app_settings", { settingsJson: JSON.stringify(_settings) });
    // OJO: hay que pasar por `onDataChange`, NO marcar la tabla a mano con
    // `markDirty`. `markDirty` solo deja la marca y la tabla se sube en el
    // PROXIMO sync por el pulso periodico; `onDataChange` es lo que ademas
    // dispara `syncAllSilent` (push a Cloudflare D1) y `scheduleInstantBackup`
    // (respaldo instantaneo a Google Drive). Con `markDirty` directo, la config
    // de notificaciones quedaba en la BD pero tardaba hasta 20 min en subir.
    const { onDataChange } = await import("./autoSync");
    onDataChange("app_settings", { immediate: true });
  } catch (e) {
    console.error("[appSettings] Error saving to Rust:", e);
  }
  notify();
}

/**
 * Actualiza un parcial de settings y guarda.
 */
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  await saveAppSettings({ ..._settings, ...patch });
}

/**
 * Devuelve el estado actual (síncrono, después de al menos un loadAppSettings).
 */
export function getAppSettings(): AppSettings {
  return { ..._settings };
}

/**
 * Suscribe a cambios. Retorna función de unsubscribe.
 */
export function onAppSettingsChange(fn: (s: AppSettings) => void): () => void {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Invalida el caché localStorage (útil tras restore de DB).
 */
export function clearSettingsCache(): void {
  _loaded = false;
  _settings = { ...DEFAULTS };
}
