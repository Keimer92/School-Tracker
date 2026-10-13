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
 * Carga settings desde Rust. La primera vez migra desde localStorage si la tabla está vacía.
 */
export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const raw = await invoke<string>("get_app_settings");
    const parsed = JSON.parse(raw);
    _settings = { ...DEFAULTS, ...parsed };
    // Primera vez: si la tabla vino vacía, migrar desde localStorage
    if (Object.keys(parsed).length === 0) {
      const fallback = readLocalStorageFallback();
      if (Object.keys(fallback).length > 0) {
        _settings = { ...DEFAULTS, ...fallback };
        await saveAppSettings(_settings);
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
