package com.keimer.schooltracker

import android.content.Context
import android.content.Intent
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class SyncOnConnectWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : Worker(appContext, workerParams) {

    override fun doWork(): Result {
        android.util.Log.i("SyncOnConnectWorker", "Ejecutando sync por reconexión")
        return try {
            val intent = Intent("com.keimer.schooltracker.SYNC_ON_CONNECT").apply {
                setPackage(applicationContext.packageName)
            }
            applicationContext.sendBroadcast(intent)
            android.util.Log.i("SyncOnConnectWorker", "Broadcast enviado")
            Result.success()
        } catch (e: Exception) {
            android.util.Log.e("SyncOnConnectWorker", "Error: ${e.message}")
            Result.failure()
        }
    }

    companion object {
        private const val TAG = "sync_on_connect"

        fun schedule(context: Context, delaySeconds: Long) {
            val request = OneTimeWorkRequestBuilder<SyncOnConnectWorker>()
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .addTag(TAG)
                .build()
            WorkManager.getInstance(context).enqueue(request)
            android.util.Log.i("SyncOnConnectWorker", "Programado con delay=${delaySeconds}s")
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelAllWorkByTag(TAG)
        }
    }
}
