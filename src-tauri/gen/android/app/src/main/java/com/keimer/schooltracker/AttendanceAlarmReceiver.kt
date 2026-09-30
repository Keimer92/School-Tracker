package com.keimer.schooltracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AttendanceAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        android.util.Log.i("AttendanceAlarmReceiver", "Alarma de asistencia recibida")

        if (AttendancePrefs.isSilencedToday(context)) {
            android.util.Log.i("AttendanceAlarmReceiver", "Silenciado hoy, ignorando")
            AttendanceScheduler.rescheduleForTomorrow(context)
            return
        }

        val prefs = context.getSharedPreferences(AttendancePrefs.NAME, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(AttendancePrefs.KEY_ENABLED, false)
        if (!enabled) {
            android.util.Log.i("AttendanceAlarmReceiver", "Desactivado en prefs")
            return
        }

        val config = prefs.getString(AttendancePrefs.KEY_CONFIG, null)
        val dbPath = prefs.getString(AttendancePrefs.KEY_DB_PATH, null)
        if (config == null || dbPath == null) {
            android.util.Log.w("AttendanceAlarmReceiver", "Config o dbPath null")
            return
        }

        try {
            val pending = AttendanceNative.queryAttendancePending(dbPath, config)
            if (pending.isNotEmpty()) {
                val title = "Asistencia pendiente"
                val body = pending.joinToString("\n") { "${it.grado} - ${it.seccion}" }
                notifyAttendance(context, title, body)
            } else {
                android.util.Log.i("AttendanceAlarmReceiver", "Sin pendientes")
            }
        } catch (e: Exception) {
            android.util.Log.e("AttendanceAlarmReceiver", "Error: ${e.message}")
        }

        AttendanceScheduler.rescheduleForTomorrow(context)
    }

    private fun notifyAttendance(context: Context, title: String, body: String) {
        val mainIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        context.startActivity(mainIntent)

        try {
            val method = MainActivity::class.java.getMethod(
                "notifyAttendanceReminder",
                String::class.java,
                String::class.java
            )
            val activity = context as? MainActivity
            if (activity != null) {
                method.invoke(activity, title, body)
            } else {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                val builder = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    android.app.Notification.Builder(context, "attendance_reminders")
                } else {
                    @Suppress("DEPRECATION")
                    android.app.Notification.Builder(context)
                }
                val notification = builder
                    .setSmallIcon(com.keimer.schooltracker.R.mipmap.ic_launcher)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setAutoCancel(true)
                    .build()
                nm.notify(2001, notification)
            }
        } catch (e: Exception) {
            android.util.Log.e("AttendanceAlarmReceiver", "Error notificación: ${e.message}")
        }
    }
}
