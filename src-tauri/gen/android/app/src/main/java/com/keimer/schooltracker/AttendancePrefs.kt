package com.keimer.schooltracker

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object AttendancePrefs {
    const val NAME = "attendance_reminders"
    const val KEY_ENABLED = "enabled"
    const val KEY_CONFIG = "config"
    const val KEY_COLEGIOS = "colegios"
    const val KEY_DB_PATH = "db_path"
    private const val KEY_SILENCED_DATE = "silenced_date"
    const val KEY_RINGTONE_URI = "ringtone_uri"
    const val KEY_RINGTONE_LABEL = "ringtone_label"
    /**
     * Firma del sonido con el que se creó el canal por última vez.
     *
     * `NotificationChannel.setSound()` se IGNORA si el canal ya existe: Android
     * congela el sonido en el momento de crearlo. Para cambiarlo hay que
     * BORRAR el canal y volver a crearlo. Guardamos la firma para saber si el
     * canal actual corresponde al sonido elegido y solo entonces lo destruimos
     * (borrarlo y recrearlo sin cambios reinicia las preferencias que el usuario
     * haya hecho en los ajustes del sistema: importance, vibración, silenciado).
     */
    const val KEY_CHANNEL_SOUND = "channel_sound"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun isSilencedToday(context: Context): Boolean {
        val p = prefs(context)
        val savedDate = p.getString(KEY_SILENCED_DATE, "") ?: ""
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        return savedDate == today
    }

    fun setSilencedToday(context: Context, silenced: Boolean) {
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        prefs(context).edit()
            .putString(KEY_SILENCED_DATE, if (silenced) today else "")
            .apply()
    }

    fun getRingtone(context: Context): Pair<String, String> {
        val p = prefs(context)
        return (p.getString(KEY_RINGTONE_URI, "") ?: "") to
            (p.getString(KEY_RINGTONE_LABEL, "") ?: "")
    }

    fun setRingtone(context: Context, uri: String, label: String) {
        prefs(context).edit()
            .putString(KEY_RINGTONE_URI, uri)
            .putString(KEY_RINGTONE_LABEL, label)
            .apply()
    }

    fun getChannelSound(context: Context): String =
        prefs(context).getString(KEY_CHANNEL_SOUND, "") ?: ""

    fun setChannelSound(context: Context, signature: String) {
        prefs(context).edit().putString(KEY_CHANNEL_SOUND, signature).apply()
    }
}
