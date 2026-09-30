package com.keimer.schooltracker

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
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import org.json.JSONObject
import java.io.File
import java.util.Calendar

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var connectivityCallback: ConnectivityManager.NetworkCallback? = null
  private lateinit var googleSignInLauncher: ActivityResultLauncher<Intent>

  companion object {
    @Volatile
    var lastNativeAuthResult: String? = null

    @Volatile
    var isForeground: Boolean = false

    @Volatile
    var pendingSyncOnConnect: Boolean = false

    init {
      System.loadLibrary("school_tracker_pro_lib")
    }
  }

  private external fun initNativeBridge()

  fun takeLastGoogleAuthResult(): String? {
    val value = lastNativeAuthResult
    lastNativeAuthResult = null
    return value
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    try {
      initNativeBridge()
    } catch (e: Throwable) {
      android.util.Log.w("Bridge", "initNativeBridge falló: ${e.message}")
    }

    googleSignInLauncher = registerForActivityResult(
      ActivityResultContracts.StartActivityForResult()
    ) { result -> handleGoogleSignInResult(result.data) }

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, windowInsets ->
      val insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }

    registerConnectivityListener()
    handleIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    isForeground = true
  }

  override fun onPause() {
    isForeground = false
    super.onPause()
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
    if (pendingSyncOnConnect) {
      pendingSyncOnConnect = false
      webView.post {
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('connectivity-android', { detail: { online: true } }))",
          null
        )
      }
    }
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
        try { SyncOnConnectWorker.schedule(applicationContext, 0) } catch (e: Throwable) {
          android.util.Log.w("SyncOnConnect", "onLost schedule falló: ${e.message}")
        }
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
    if (intent?.action == "com.keimer.schooltracker.SYNC_ON_CONNECT") {
      pendingSyncOnConnect = true
    }
    if (intent?.data != null) {
      val uri = intent.data!!
      val isMatch = (uri.scheme == "http" && uri.host == "127.0.0.1" && uri.path == "/callback") ||
                    (uri.scheme == "schooltracker-auth" && uri.host == "callback")
      if (isMatch) {
        val code = uri.getQueryParameter("code")
        if (code != null) {
          val escapedCode = code.replace("\\", "\\\\").replace("'", "\\'")
          val js = """
            (function(){
              try { if (window.__TAURI__ && window.__TAURI__.event) { window.__TAURI__.event.emit('oauth-callback-android', '$escapedCode'); } } catch(e) {}
              try { window.dispatchEvent(new CustomEvent('oauth-callback-android', { detail: '$escapedCode' })); } catch(e) {}
            })();
          """.trimIndent()
          webView?.post {
            webView?.evaluateJavascript(js, null)
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
        android.util.Log.e("MainActivity", "Source file not found: $path")
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

  /**
   * Copia un archivo ya escrito por la app a Descargas/DE_CARPETA usando
   * MediaStore en Android 10+ (sin permisos) y copia directa en Android 9 o menos.
   * Devuelve la ruta publica donde quedo, o cadena vacia si fallo.
   */
  fun saveToDownloads(sourcePath: String, mime: String, folder: String, displayName: String): String {
    return try {
      val origen = File(sourcePath)
      if (!origen.exists() || !origen.isFile) {
        android.util.Log.e("MainActivity", "saveToDownloads: origen no existe: $sourcePath")
        return ""
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        DescargasSaver.guardar(contentResolver, sourcePath, mime, folder, displayName)
      } else {
        // Android 9 o menos: hay WRITE_EXTERNAL_STORAGE (maxSdkVersion=28).
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), folder)
        dir.mkdirs()
        var finalName = displayName
        var n = 1
        while (File(dir, finalName).exists()) {
          finalName = if (displayName.contains('.')) {
            val base = displayName.substringBeforeLast('.')
            "$base ($n).${displayName.substringAfterLast('.')}"
          } else {
            "$displayName ($n)"
          }
          n++
        }
        val destino = File(dir, finalName)
        origen.copyTo(destino, overwrite = true)
        android.util.Log.i("MainActivity", "saveToDownloads (legacy) OK: ${destino.absolutePath}")
        destino.absolutePath
      }
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "saveToDownloads error: ${e.message}")
      ""
    }
  }

  /**
   * Guarda un backup ROTANDO la carpeta: deja solo [keep] archivos y borra los
   * mas antiguos. Lo invoca Rust por JNI desde `run_local_backup`.
   * En Android 9 o menos cae a copia directa, tambien rotada.
   */
  fun rotateBackup(sourcePath: String, mime: String, folder: String, displayName: String, keep: Int): String {
    return try {
      val origen = File(sourcePath)
      if (!origen.exists() || !origen.isFile) {
        android.util.Log.e("MainActivity", "rotateBackup: origen no existe: $sourcePath")
        return ""
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        DescargasSaver.rotar(contentResolver, sourcePath, mime, folder, displayName, keep)
      } else {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), folder)
        dir.mkdirs()
        val archivos = dir.listFiles { f -> f.isFile && f.name.endsWith(".db") }
          ?.sortedByDescending { it.lastModified() } ?: emptyList()
        // Deja (keep - 1) antes de escribir el nuevo.
        archivos.drop((keep - 1).coerceAtLeast(0)).forEach { it.delete() }
        val destino = File(dir, displayName)
        origen.copyTo(destino, overwrite = true)
        android.util.Log.i("MainActivity", "rotateBackup (legacy) OK: ${destino.absolutePath}")
        destino.absolutePath
      }
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "rotateBackup error: ${e.message}")
      ""
    }
  }

  /**
   * Guarda la config del backup automatico y (re)programa la alarma.
   * La invoca Rust por JNI desde `set_local_backup_config`.
   */
  fun configureLocalBackup(activo: Boolean, intervaloMin: Int) {
    try {
      LocalBackupPrefs.setConfig(this, activo, intervaloMin)
      if (activo) {
        LocalBackupScheduler.schedule(this)
      } else {
        LocalBackupScheduler.cancel(this)
      }
      android.util.Log.i("MainActivity", "Backup automático: activo=$activo cada $intervaloMin min")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "configureLocalBackup error: ${e.message}")
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
        .setSmallIcon(com.keimer.schooltracker.R.mipmap.ic_launcher)
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
      val colegiosArr = json.optJSONArray("colegios") ?: org.json.JSONArray()

        val colegioIds = org.json.JSONArray()
        for (i in 0 until colegiosArr.length()) colegioIds.put(colegiosArr.getJSONObject(i).optLong("id"))
        prefs.edit()
          .putBoolean(AttendancePrefs.KEY_ENABLED, enabled)
          .putString(AttendancePrefs.KEY_CONFIG, colegiosArr.toString())
          .putString(AttendancePrefs.KEY_COLEGIOS, colegioIds.toString())
          .putString(AttendancePrefs.KEY_DB_PATH, dbPath)
          .apply()

      if (enabled) {
        AttendanceScheduler.schedule(this)
      } else {
        AttendanceScheduler.cancel(this)
      }
      android.util.Log.i("MainActivity", "Attendance alarm: enabled=$enabled colegios=${colegiosArr.length()}")
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

  fun requestNotificationPermissionNow() {
    try {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU &&
        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2001)
        android.util.Log.i("MainActivity", "Solicitando permiso POST_NOTIFICATIONS")
      }
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error solicitando permiso de notificaciones: ${e.message}")
    }
  }

  fun startGoogleSignIn(serverClientId: String) {
    try {
      android.util.Log.i("GoogleNativeAuth", "Iniciando sign-in nativo")
      lastNativeAuthResult = null
      GoogleSignIn.getClient(this, GoogleSignInOptions.DEFAULT_SIGN_IN).signOut()

      val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestEmail()
        .requestScopes(Scope("https://www.googleapis.com/auth/drive.file"))
        .requestServerAuthCode(serverClientId)
        .requestIdToken(serverClientId)
        .build()
      val client = GoogleSignIn.getClient(this, gso)
      googleSignInLauncher.launch(client.signInIntent)
    } catch (e: Exception) {
      android.util.Log.e("GoogleNativeAuth", "Error lanzando sign-in: ${e.message}")
      emitGoogleAuthResult("""{"ok":false,"error":"${e.message?.replace("\"", "'") ?: "error"}"}""")
    }
  }

  private fun handleGoogleSignInResult(data: Intent?) {
    try {
      val task = GoogleSignIn.getSignedInAccountFromIntent(data)
      val account = task.getResult(Exception::class.java)
      android.util.Log.i("GoogleNativeAuth", "Sign-in OK, email=${account.email ?: "?"}, authCode=${if (account.serverAuthCode != null) "sí" else "NO"}")
      val json = JSONObject().apply {
        put("ok", true)
        put("serverAuthCode", account.serverAuthCode ?: "")
        put("idToken", account.idToken ?: "")
        put("email", account.email ?: "")
        put("displayName", account.displayName ?: "")
        account.photoUrl?.let { put("photoUrl", it.toString()) }
      }
      emitGoogleAuthResult(json.toString())
    } catch (e: Exception) {
      var statusCode = -1
      if (e is com.google.android.gms.common.api.ApiException) { statusCode = e.statusCode }
      val cancelled = statusCode == 12501
      android.util.Log.e("GoogleNativeAuth", "Sign-in error: status=$statusCode msg=${e.message}")
      val json = JSONObject().apply {
        put("ok", false)
        put("cancelled", cancelled)
        put("statusCode", statusCode)
        put("error", e.message?.replace("\"", "'") ?: "error desconocido")
      }
      emitGoogleAuthResult(json.toString())
    }
  }

  private fun emitGoogleAuthResult(json: String) {
    lastNativeAuthResult = json
    val escaped = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
    val js = """
      (function(){
        try { if (window.__TAURI__ && window.__TAURI__.event) { window.__TAURI__.event.emit('google-native-auth-result', JSON.parse('$escaped')); } } catch(e) {}
        try { window.dispatchEvent(new CustomEvent('google-native-auth-result', { detail: JSON.parse('$escaped') })); } catch(e) {}
      })();
    """.trimIndent()
    webView?.post {
      webView?.evaluateJavascript(js, null)
    }
  }

  /**
   * Devuelve el estado actual de la batería como string "STATUS|LEVEL"
   * (STATUS = CHARGING | DISCHARGING | FULL | UNKNOWN, LEVEL = 0..100).
   * Se invoca desde Rust (gd_battery_status) vía JNI.
   * Cachea el último estado conocido 60 s para no martillar al sistema.
   */
  fun currentBatteryStatus(): String {
    try {
      val now = System.currentTimeMillis()
      @Suppress("NAME_SHADOWING")
      val cached = lastBatteryStatusResult
      if (cached != null && (now - lastBatteryStatusAt) < 60_000L) {
        return cached
      }
      val intent = registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
      val status = intent?.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1) ?: -1
      val level = intent?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, 100) ?: 100
      val scale = intent?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100) ?: 100
      val pct = if (scale > 0) (level * 100 / scale) else 100
      val statusStr = when (status) {
        android.os.BatteryManager.BATTERY_STATUS_CHARGING -> "CHARGING"
        android.os.BatteryManager.BATTERY_STATUS_FULL -> "FULL"
        android.os.BatteryManager.BATTERY_STATUS_DISCHARGING -> "DISCHARGING"
        android.os.BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "DISCHARGING"
        else -> "UNKNOWN"
      }
      val result = "$statusStr|$pct"
      lastBatteryStatusResult = result
      lastBatteryStatusAt = now
      android.util.Log.d("MainActivity", "Battery status: $result")
      return result
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error leyendo batería: ${e.message}")
      return "UNKNOWN|100"
    }
  }

  @Volatile private var lastBatteryStatusResult: String? = null
  @Volatile private var lastBatteryStatusAt: Long = 0L

  /**
   * Muestra una notificación nativa en el canal "drive_backups" para
   * notificar al usuario sobre el estado del respaldo automático a Drive.
   * Se invoca desde Rust (gd_show_notification) vía JNI.
   */
  fun showDriveBackupNotification(title: String, body: String) {
    try {
      val channelId = "drive_backups"
      val notificationManager = getSystemService(NotificationManager::class.java)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(
          channelId,
          "Respaldos a Drive",
          NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
          description = "Estado de los respaldos automáticos a Google Drive"
        }
        notificationManager.createNotificationChannel(channel)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        android.util.Log.w("MainActivity", "Sin permiso POST_NOTIFICATIONS, no se muestra")
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
        .setSmallIcon(com.keimer.schooltracker.R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setPriority(Notification.PRIORITY_DEFAULT)
        .build()

      notificationManager.notify(2002, notification)
      android.util.Log.d("MainActivity", "Drive notification: $title")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "Error mostrando drive notification: ${e.message}")
    }
  }
}
