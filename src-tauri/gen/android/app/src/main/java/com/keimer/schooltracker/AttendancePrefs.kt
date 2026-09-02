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
}
