package com.keimer.schooltracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AttendanceBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != "android.intent.action.QUICKBOOT_POWERON") {
            return
        }

        val prefs = context.getSharedPreferences(AttendancePrefs.NAME, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(AttendancePrefs.KEY_ENABLED, false)
        if (enabled) {
            AttendanceScheduler.schedule(context)
            android.util.Log.i("AttendanceBootReceiver", "Alarma reprogramada tras boot")
        }

        // El backup automatico tambien pierde su alarma al reiniciar el
        // dispositivo, asi que se rearma aqui.
        if (LocalBackupPrefs.prefs(context).getBoolean(LocalBackupPrefs.KEY_ACTIVO, false)) {
            LocalBackupScheduler.schedule(context)
            android.util.Log.i("AttendanceBootReceiver", "Alarma de backup reprogramada tras boot")
        }
    }
}
