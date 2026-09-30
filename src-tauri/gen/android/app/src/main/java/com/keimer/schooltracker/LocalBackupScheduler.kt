package com.keimer.schooltracker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Alarma REPETITIVA del backup automatico local.
 *
 * A diferencia de un `setInterval` de JavaScript, esta alarma la dispara el
 * sistema aunque la app este CERRADA: por eso el backup se arma con
 * `setRepeating` en vez de depender del WebView.
 *
 * Usa `setInexactRepeating` a proposito: un backup no necesita al segundo, y
 * asi no cae en las restricciones de alarmas exactas de Android 12+ (que ya se
 * piden para las notificaciones de asistencia y no hace falta exigirlas aqui).
 */
object LocalBackupScheduler {

    private const val REQUEST_CODE = 3001

    fun schedule(context: Context) {
        val minutos = LocalBackupPrefs.intervaloMin(context)
        val activo = LocalBackupPrefs.prefs(context).getBoolean(LocalBackupPrefs.KEY_ACTIVO, false)
        if (!activo || minutos <= 0) {
            cancel(context)
            return
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, LocalBackupAlarmReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context, REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val intervaloMs = minutos.toLong() * 60_000L
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + intervaloMs,
            intervaloMs,
            pendingIntent
        )
        android.util.Log.i("LocalBackupScheduler", "Alarma de backup cada $minutos min")
    }

    fun cancel(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, LocalBackupAlarmReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context, REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
        android.util.Log.i("LocalBackupScheduler", "Alarma de backup cancelada")
    }
}
