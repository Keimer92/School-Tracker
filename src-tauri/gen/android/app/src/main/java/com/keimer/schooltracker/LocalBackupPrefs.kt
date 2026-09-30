package com.keimer.schooltracker

import android.content.Context
import android.content.SharedPreferences

/**
 * Config del backup automatico local.
 *
 * Vive en SharedPreferences (y no en la base) porque la alarma la dispara un
 * BroadcastReceiver con la app CERRADA: cuando suena, todavia no hay WebView ni
 * comandos de Tauri, asi que la decision de "copiar o no" tiene que estar
 * disponible de forma nativa.
 */
object LocalBackupPrefs {
    private const val PREFS = "local_backup_prefs"
    const val KEY_ACTIVO = "activo"
    const val KEY_INTERVALO_MIN = "intervalo_min"
    const val KEY_ULTIMO = "ultimo"

    /** 0 = desactivado. Cualquier otro valor = cada N minutos. */
    const val DEFAULT_INTERVALO_MIN = 120

    fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun intervaloMin(ctx: Context): Int =
        prefs(ctx).getInt(KEY_INTERVALO_MIN, DEFAULT_INTERVALO_MIN)

    fun setConfig(ctx: Context, activo: Boolean, intervaloMin: Int) {
        prefs(ctx).edit()
            .putBoolean(KEY_ACTIVO, activo)
            .putInt(KEY_INTERVALO_MIN, intervaloMin)
            .apply()
    }

    /** Marca que acabo de hacer un backup, para no repetir al instante. */
    fun marcarAhora(ctx: Context) {
        prefs(ctx).edit().putLong(KEY_ULTIMO, System.currentTimeMillis()).apply()
    }
}
