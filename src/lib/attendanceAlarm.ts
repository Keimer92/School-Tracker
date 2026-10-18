import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./appSettings";
import { getLocalDateISOString } from "./dateUtils";

/**
 * attendanceAlarm — puente entre la config de alertas de asistencia (tabla
 * `app_settings`, sincronizada) y la alarma nativa de Android (AlarmManager).
 *
 * Antes la alarma SOLO se armaba al pulsar "Guardar" en NotificacionesPage: al
 * reabrir la app nada garantizaba que la alarma coincidiera con lo persistido,
 * y si el localStorage del WebView se perdía/corrompía la UI mostraba todo
 * desactivado aunque la BD conservara la config. Ahora el arranque re-arma (o
 * cancela) la alarma leyendo la BD, y la página usa este mismo módulo.
 *
 * La ejecución de la alarma sigue siendo por-dispositivo (SharedPreferences en
 * `AttendancePrefs.kt`): eso NO es sincronizable porque las alarmas de
 * AlarmManager son locales al equipo; lo que viaja por D1 es la CONFIG.
 */

export interface NotifColegioCfg {
  activo: boolean;
  inicio: string;
  fin: string;
  intervaloMin: number;
}

/** Payload que espera el comando Rust `schedule_attendance_alarm`. */
export interface AlarmaConfig {
  enabled: boolean;
  colegios: Array<{ id: number; inicio: string; fin: string; intervaloMin: number }>;
}

/**
 * Deriva la config de la alarma desde AppSettings. `enabled` solo es true si
 * además hay por lo menos un colegio activo (mismo criterio que la UI).
 */
export function configDesdeSettings(s: AppSettings): AlarmaConfig {
  const colegios = Object.entries(s.notifCfg || {})
    .filter(([, c]) => c?.activo)
    .map(([id, c]) => ({
      id: Number(id),
      inicio: c.inicio || "07:00",
      fin: c.fin || "12:00",
      intervaloMin: Number(c.intervaloMin) || 45,
    }));
  return { enabled: !!s.notifEnabled && colegios.length > 0, colegios };
}

/**
 * Programa (o cancela) la alarma nativa según la config persistida.
 * Es idempotente y tolera fallos del lado del caller: un error aquí NO debe
 * impedir que la app arranque ni revierte lo guardado en la BD.
 */
export async function aplicarAlarmaAsistencia(s: AppSettings): Promise<void> {
  const config = configDesdeSettings(s);
  if (!config.enabled) {
    // Solo cancela si antes estuvo activa: evita un invoke inútil en cada
    // arranque para el caso "nunca configurado".
    if (Object.keys(s.notifCfg || {}).length === 0 && !s.notifEnabled) return;
    await invoke("cancel_attendance_alarm");
    return;
  }
  const dbPath = await invoke<string>("get_db_path");
  await invoke("schedule_attendance_alarm", {
    config: JSON.stringify(config),
    dbPath,
  });
}

/** Aviso de "tienes pendientes al abrir la app" (solo Android). */
export async function avisarPendientesAlAbrir(s: AppSettings): Promise<void> {
  const config = configDesdeSettings(s);
  if (!config.enabled) return;

  // No avisar al abrir si el día está silenciado.
  const silenced = await invoke<boolean>("get_attendance_silenced_today").catch(() => false);
  if (silenced) return;

  const fecha = getLocalDateISOString();
  const pendientes = await invoke<Array<{ grado: string; seccion: string }>>(
    "get_pendientes_asistencia_filtrados",
    { colegios: config.colegios.map(c => c.id), grados: [], secciones: [], fecha }
  );
  if (!pendientes || pendientes.length === 0) return;

  const lista = pendientes.slice(0, 5).map(p => `${p.grado} ${p.seccion}`).join(", ");
  const resto = pendientes.length > 5 ? ` y ${pendientes.length - 5} más` : "";
  await invoke("notify_attendance_reminder", {
    title: "Asistencia pendiente",
    body: `Sin asistencia hoy: ${lista}${resto}`,
  });
}
