package com.keimer.schooltracker

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AttendanceDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        AttendancePrefs.setSilencedToday(context, true)
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(2001)
        AttendanceScheduler.rescheduleForTomorrow(context)
        android.util.Log.i("AttendanceDismissReceiver", "Asistencia silenciada para hoy")
    }
}
