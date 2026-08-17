package com.keimer.schooltrackerpro

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.View
import android.window.OnBackInvokedCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import org.json.JSONObject
import java.io.File
import java.util.Calendar

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var connectivityCallback: ConnectivityManager.NetworkCallback? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, windowInsets ->
      val insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }

    registerConnectivityListener()
    handleIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
  }

  override fun onDestroy() {
    super.onDestroy()
    connectivityCallback?.let {
      val cm = getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      cm.unregisterNetworkCallback(it)
    }
  }

  private fun registerConnectivityListener() {
    val cm = getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    connectivityCallback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        android.util.Log.i("Connectivity", "Red disponible")
        webView?.post {
          webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('connectivity-android', { detail: { online: true } }))",
            null
          )
        }
      }

      override fun onLost(network: Network) {
        android.util.Log.i("Connectivity", "Red perdida")
        webView?.post {
          webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('connectivity-android', { detail: { online: false } }))",
            null
          )
        }
      }
    }

    val request = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .build()
    cm.registerNetworkCallback(request, connectivityCallback!!)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
  }

  private fun handleIntent(intent: Intent?) {
    if (intent?.data != null) {
      val uri = intent.data!!
      val isMatch = (uri.scheme == "http" && uri.host == "127.0.0.1" && uri.path == "/callback") ||
                    (uri.scheme == "schooltracker-auth" && uri.host == "callback")
      if (isMatch) {
        val code = uri.getQueryParameter("code")
        if (code != null) {
          val escapedCode = code.replace("\\", "\\\\").replace("'", "\\'")
          webView?.post {
            webView?.evaluateJavascript(
              "window.__TAURI__.event.emit('oauth-callback-android', '$escapedCode')",
              null
            )
          }
        }
      }
    }
  }

  fun sharePdf(path: String) {
    try {
      val file = File(path)
      if (!file.exists()) {
        android.util.Log.e("MainActivity", "File not found: $path")
        return
      }

      val uri = androidx.core.content.FileProvider.getUriForFile(
        this,
        "${packageName}.fileprovider",
        file
      )

      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      startActivity(Intent.createChooser(shareIntent, "Compartir PDF"))
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error sharing PDF: ${e.message}")
    }
  }

  fun printPdf(path: String) {
    try {
      val file = File(path)
      if (!file.exists()) {
        android.util.Log.e("MainActivity", "File not found: $path")
        return
      }

      val webView = WebView(this)
      webView.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
          return false
        }

        override fun onPageFinished(view: WebView?, url: String?) {
          val printManager = getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager
          val printAdapter = webView.createPrintDocumentAdapter("PDF_${System.currentTimeMillis()}")
          val printAttributes = PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
            .setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .build()

          printManager.print(
            "PDF_${System.currentTimeMillis()}",
            printAdapter,
            printAttributes
          )
        }
      }

      webView.loadUrl("file://$path")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error printing PDF: ${e.message}")
    }
  }

  fun saveFile(path: String, mime: String, name: String) {
    try {
      val sourceFile = File(path)
      if (!sourceFile.exists()) {
        android.util.Log.e("MainActivity", "Source file not found: $path")
        return
      }

      val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      val destFile = File(downloadsDir, name)

      sourceFile.copyTo(destFile, overwrite = true)

      val uri = androidx.core.content.FileProvider.getUriForFile(
        this,
        "${packageName}.fileprovider",
        destFile
      )

      val scanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE)
      scanIntent.data = uri
      sendBroadcast(scanIntent)

      android.util.Log.i("MainActivity", "File saved to: ${destFile.absolutePath}")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error saving file: ${e.message}")
    }
  }

  fun notifyAttendanceReminder(title: String, body: String) {
    try {
      val channelId = "attendance_reminders"
      val notificationManager = getSystemService(NotificationManager::class.java)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(
          channelId,
          "Recordatorio de asistencia",
          NotificationManager.IMPORTANCE_HIGH
        ).apply {
          description = "Grados/secciones sin asistencia del día"
          val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
          setSound(
            soundUri,
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build()
          )
        }
        notificationManager.createNotificationChannel(channel)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2001)
        return
      }

      val builder: Notification.Builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(this, channelId)
        } else {
          @Suppress("DEPRECATION")
          Notification.Builder(this)
        }

      val notification = builder
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setPriority(Notification.PRIORITY_HIGH)
        .build()

      notificationManager.notify(2001, notification)
      android.util.Log.i("MainActivity", "Notification sent: $title")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error sending notification: ${e.message}")
    }
  }

  fun scheduleAttendanceAlarm(config: String, dbPath: String) {
    try {
      val prefs = getSharedPreferences(AttendancePrefs.NAME, Context.MODE_PRIVATE)
      val json = JSONObject(config)

      val enabled = json.optBoolean("enabled", false)
      val time = json.optString("hora", "12:00")

      prefs.edit()
        .putBoolean(AttendancePrefs.KEY_ENABLED, enabled)
        .putString(AttendancePrefs.KEY_TIME, time)
        .putString(AttendancePrefs.KEY_COLEGIOS, json.optJSONArray("colegios")?.toString() ?: "[]")
        .putString(AttendancePrefs.KEY_GRADOS, json.optJSONArray("grados")?.toString() ?: "[]")
        .putString(AttendancePrefs.KEY_SECCIONES, json.optJSONArray("secciones")?.toString() ?: "[]")
        .putString(AttendancePrefs.KEY_DB_PATH, dbPath)
        .apply()

      if (enabled) {
        AttendanceScheduler.schedule(this)
      } else {
        AttendanceScheduler.cancel(this)
      }
      android.util.Log.i("MainActivity", "Attendance alarm scheduled: enabled=$enabled time=$time")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error scheduling attendance alarm: ${e.message}")
    }
  }

  fun cancelAttendanceAlarm() {
    AttendanceScheduler.cancel(this)
  }

  fun getAttendanceSilencedToday(): Boolean {
    return AttendancePrefs.isSilencedToday(this)
  }

  fun setAttendanceSilencedToday(silenced: Boolean) {
    AttendancePrefs.setSilencedToday(this, silenced)
  }

  fun dismissAttendanceToday() {
    AttendancePrefs.setSilencedToday(this, true)
    val notificationManager = getSystemService(NotificationManager::class.java)
    notificationManager.cancel(2001)
    AttendanceScheduler.rescheduleForTomorrow(this)
    android.util.Log.i("MainActivity", "Attendance silenced for today")
  }
}
