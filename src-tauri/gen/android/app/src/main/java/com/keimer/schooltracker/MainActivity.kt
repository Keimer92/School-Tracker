package com.keimer.schooltracker

import android.app.Activity
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
import android.net.Uri
import android.provider.Settings
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
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.common.api.Scope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.concurrent.Executors

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var connectivityCallback: ConnectivityManager.NetworkCallback? = null
  private lateinit var googleSignInLauncher: ActivityResultLauncher<Intent>

  companion object {
    /** Id del canal de la alarma de asistencia. Debe coincidir con el que usa
     *  `AttendanceAlarmReceiver` y con el que ya quedó creado en installs
     *  previos: si cambia, Android deja el canal viejo dando notificaciones con
     *  el sonido anterior. */
    const val ATTENDANCE_CHANNEL_ID = "attendance_reminders"

    @Volatile
    var lastNativeAuthResult: String? = null

    /** Resultado del último pedido de credencial de Drive (ver `requestDriveToken`).
     *  Se guarda aparte del de sign-in porque son dos flujos distintos: uno
     *  identifica al usuario, el otro autoriza el acceso a Drive. */
    @Volatile
    var lastDriveTokenResult: String? = null

    @Volatile
    var isForeground: Boolean = false

    @Volatile
    var pendingSyncOnConnect: Boolean = false

    init {
      // Debe coincidir con `[lib] name` en src-tauri/Cargo.toml. El rename
      // school-tracker-pro -> school-tracker (commit 23c58b6) cambió Cargo.toml
      // pero no este archivo, y daba UnsatisfiedLinkError en <clinit> al abrir.
      System.loadLibrary("school_tracker_lib")
    }
  }

  private external fun initNativeBridge()

  fun setOrientationFromWeb(orientation: String) {
    val requestedOrientation = when (orientation) {
      "portrait" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      "any" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
      else -> return
    }
    runOnUiThread {
      setRequestedOrientation(requestedOrientation)
    }
  }

  fun takeLastGoogleAuthResult(): String? {
    val value = lastNativeAuthResult
    lastNativeAuthResult = null
    return value
  }

  // ── Autorización NATIVA de Drive (credential de dispositivo) ──
  //
  // Reemplaza al canje del `serverAuthCode` por tokens. Con `requestServerAuthCode`
  // no hay forma de pedir `access_type=offline`, así que Google solo entregaba el
  // `refresh_token` en la PRIMERA autorización: en Android la sesión moría a la
  // hora y había que revincular cada vez.
  //
  // `GoogleAuthUtil.getToken` no usa el canje de código en absoluto: pide una
  // credencial de DISPOSITIVO, que Google Play Services autoriza a nivel de
  // sistema (igual que hace la app de Drive) y reemite solo cuando vence. Por eso
  // no hay refresh token que se pierda: cuando el access expira, se vuelve a
  // llamar y vuelve a salir.
  //
  // Requisitos ya cumplidos: el package y el SHA-1 están registrados en Google
  // Cloud (sin eso, Play Services responde 10 / DEVELOPER_ERROR). No requiere
  // ninguna declaración nueva en el AndroidManifest.
  //
  // Es una API deprecada a favor de `AuthorizationClient` (Google Identity
  // Services), que quedó afuera a propósito: exige una declaración de API en el
  // manifest que no se pudo verificar al momento de escribir esto, y acertar mal
  // ahí hace crashear la app al arrancar. El cambio a la moderna, cuando se
  // confirme el requisito, es contenido en esta función.
  private val driveTokenExecutor = Executors.newSingleThreadExecutor()
  // ⚠️ El prefijo `oauth2:` NO es decorativo. `GoogleAuthUtil.getToken` lo exige
  // para pedir un access token de OAuth2: la doc dice textualmente que `scope` es
  // "a String representing the authentication scope, **prefixed with 'oauth2:'**".
  // Sin el prefijo el scope viaja como un `service` heredado (así lo trata la
  // implementación de referencia: `service.startsWith("oauth2:")`), o sea que la
  // petición NO es de OAuth2: `getToken` falla, o devuelve algo que la API de
  // Drive rechaza con 401. Es un solo carácter el que decide el flujo.
  private val DRIVE_SCOPE = "oauth2:https://www.googleapis.com/auth/drive.file"

  fun requestDriveToken() {
    // Sin cuenta de Google en el dispositivo no hay credencial que emitir: hay
    // que pasar antes por el selector nativo.
    val account = GoogleSignIn.getLastSignedInAccount(this)
    if (account == null) {
      emitDriveTokenResult("""{"ok":false,"error":"sin cuenta de Google en el dispositivo"}""")
      return
    }
    // `getToken` ES BLOQUEANTE (hace red): en el hilo principal lanzaría
    // NetworkOnMainThreadException. Por eso el executor.
    driveTokenExecutor.execute {
      try {
                // `getToken` NO acepta `GoogleSignInAccount`: pide un `android.accounts.Account`.
        // Los dos overloads son `(Context, Account, String)` y `(Context, String, String)`,
        // así que pasar el `GoogleSignInAccount` directamente da "None of the following
        // functions can be called with the arguments supplied". El tipo de cuenta para
        // una cuenta Google es "com.google".
        //
        // `email` es un tipo de plataforma: Kotlin lo ve como `String?`. Si fuera null,
        // `getToken` tira y lo agarra el `catch` de abajo, que ya emite el JSON de error.
        val gmsAccount = android.accounts.Account(account.email ?: "", "com.google")
        val token = GoogleAuthUtil.getToken(this, gmsAccount, DRIVE_SCOPE)
        // Las credenciales de dispositivo duran ~1 hora. Se acota a 55 minutos
        // para que el margen de refresco de 2 min del frontend caiga siempre acá
        // y renueve antes de que Google la considere vencida.
        val json = JSONObject().apply {
          put("ok", true)
          put("accessToken", token)
          put("expiresInSec", 3300)
        }
        emitDriveTokenResult(json.toString())
      } catch (e: Exception) {
        android.util.Log.e("DriveAuth", "getToken falló: ${e.message}")
        val json = JSONObject().apply {
          put("ok", false)
          put("error", e.message?.replace("\"", "'") ?: "sin token de Drive")
        }
        emitDriveTokenResult(json.toString())
      }
    }
  }

  private fun emitDriveTokenResult(json: String) {
    lastDriveTokenResult = json
    val escaped = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
    val js = """
      (function(){
        try { if (window.__TAURI__ && window.__TAURI__.event) { window.__TAURI__.event.emit('drive-token-result', JSON.parse('$escaped')); } } catch(e) {}
        try { window.dispatchEvent(new CustomEvent('drive-token-result', { detail: JSON.parse('$escaped') })); } catch(e) {}
      })();
    """.trimIndent()
    webView?.post {
      webView?.evaluateJavascript(js, null)
    }
  }

  fun takeLastDriveTokenResult(): String? {
    val value = lastDriveTokenResult
    lastDriveTokenResult = null
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
   * Le pasa un APK ya descargado al instalador de paquetes del sistema. NO lo
   * instala por si misma: Android siempre pide confirmacion al usuario (y exige
   * que la app tenga habilitado "instalar apps desconocidas", que se declara
   * con REQUEST_INSTALL_PACKAGES en el manifest). La invoca Rust por JNI desde
   * `gd_instalar_actualizacion`.
   *
   * El APK vive en la cache privada de la app, asi que NO se puede pasar como
   * `file://`: desde Android 7 compartir un archivo con otra app por `file://`
   * lanza FileUriExposedException. Va por FileProvider, que da un `content://`
   * cubierto por `res/xml/file_paths.xml` (cache-path). El authority tiene que
   * ser el mismo que declara el manifest: "${applicationId}.fileprovider".
   *
   * Devuelve "" si el instalador se abrio, o el motivo del fallo.
   */
  fun installApk(path: String): String {
    return try {
      val apk = File(path)
      if (!apk.exists() || !apk.isFile) {
        android.util.Log.e("MainActivity", "installApk: no existe $path")
        return "no_existe"
      }
      val uri = androidx.core.content.FileProvider.getUriForFile(
        this,
        "$packageName.fileprovider",
        apk
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        // Sin FLAG_GRANT_READ_URI_PERMISSION el instalador no puede leer el
        // content:// y falla con SecurityException.
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      startActivity(intent)
      android.util.Log.i("MainActivity", "installApk: instalador abierto para ${apk.name}")
      ""
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "installApk error: ${e.message}")
      e.message ?: "error"
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
      val channelId = ATTENDANCE_CHANNEL_ID
      val notificationManager = getSystemService(NotificationManager::class.java)

      // El canal se (re)crea con el sonido elegido por el usuario. Ya no se
      // hardcodea `RingtoneManager.getDefaultUri` acá: el sonido vive en el
      // canal, y el canal es lo único que lo puede cambiar.
      ensureAttendanceChannel(this)

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
      // No signOut() antes de lanzar el picker: signOut() es asíncrono y puede
      // borrar la cuenta recién seleccionada tras el resultado del picker,
      // haciendo que getLastSignedInAccount() retorne null en requestDriveToken.
      // Dejamos que el selector nativo de Google gestione la elección de cuenta.

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

  // ══════════════════════════════════════════════════════════════════════
  //  SONIDO DE LA ALARMA DE ASISTENCIA
  // ══════════════════════════════════════════════════════════════════════
  //
  // En Android 8+ el sonido de una notificación se fija en el NotificationChannel
  // y Android CONGELA ese valor: `setSound()` sobre un canal existente se ignora
  // en silencio. La única forma de cambiarlo es borrar el canal y recrearlo, y
  // eso reinicia lo que el haya configurado a mano en los ajustes del sistema
  // (importancia, vibración, "silenciar"). Por eso `ensureAttendanceChannel`
  // solo borra cuando la firma del sonido cambia de verdad.

  private val ringtoneLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) { result -> handleRingtoneResult(result.resultCode, result.data) }

  /**
   * Crea (o recrea) el canal de la alarma con el sonido elegido.
   *
   * @param forzar recrear aunque la firma no haya cambiado (lo usa la app al
   *   arrancar después de que el usuario haya podido cambiar el canal desde los
   *   ajustes del sistema).
   */
  private fun ensureAttendanceChannel(context: Context, forzar: Boolean = false) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channelId = ATTENDANCE_CHANNEL_ID
    val notificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    val (uriStr, _) = AttendancePrefs.getRingtone(context)
    // `getDefaultUri` está tipado como no-null en este compileSdk, así que el
    // fallback a TYPE_ALARM era código muerto y el compilador lo rechazaba.
    val soundUri: Uri = if (uriStr.isBlank()) {
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    } else {
      Uri.parse(uriStr)
    }
    val firma = soundUri.toString()

    if (!forzar && AttendancePrefs.getChannelSound(context) == firma &&
      notificationManager.getNotificationChannel(channelId) != null
    ) {
      return
    }

    try {
      // Solo si la firma cambió: recrear el canal sin motivo reiniciaría las
      // preferencias del usuario en los ajustes del sistema.
      if (notificationManager.getNotificationChannel(channelId) != null) {
        notificationManager.deleteNotificationChannel(channelId)
        android.util.Log.i("Ringtone", "Canal recreado por cambio de sonido -> $firma")
      }
      val channel = NotificationChannel(
        channelId,
        "Recordatorio de asistencia",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Grados/secciones sin asistencia del día"
        enableVibration(true)
        setSound(
          soundUri,
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
      }
      notificationManager.createNotificationChannel(channel)
      AttendancePrefs.setChannelSound(context, firma)
    } catch (e: Exception) {
      android.util.Log.e("Ringtone", "No se pudo crear el canal: ${e.message}")
    }
  }

  /**
   * Abre el selector. `tipo` = "sistema" (ringtones del dispositivo) o
   * "archivo" (cualquier mp/wav/ogg del almacenamiento).
   *
   * Se usa `ACTION_RINGTONE_PICKER` y no `ACTION_GET_CONTENT` para el sistema:
   * muestra los ringtones ya instalados sin que la app tenga que enumerarlos
   * (Android no expone una API pública para listarlos).
   */
  fun pickAttendanceRingtone(tipo: String) {
    try {
      val intent = if (tipo == "sistema") {
        // Las constantes del selector están en `RingtoneManager`, NO en `Intent`:
        // `Intent.ACTION_RINGTONE_PICKER` no existe y el compilador lo rechaza.
        Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
          putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_NOTIFICATION)
          putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
          // `EXTRA_RINGTONE_SHOW_VIBRATE` no existe en el compileSdk de este
          // proyecto; solo controla si el selector muestra el pseudo-ringtone
          // "vibración", que no nos sirve igual.
        }
      } else {
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          // `*/*` y no `audio/*`: muchos exploradores de archivos de Android
          // clasifican un .mp como `application/octet-stream`, y con `audio/*`
          // el archivo sencillamente no aparece en la lista.
          type = "*/*"
          putExtra(
            Intent.EXTRA_MIME_TYPES,
            arrayOf("audio/*", "application/octet-stream", "*/*")
          )
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
      }
      ringtoneLauncher.launch(intent)
    } catch (e: Exception) {
      android.util.Log.e("Ringtone", "No se pudo abrir el selector: ${e.message}")
      emitRingtoneResult(false, "", "", "No se pudo abrir el selector: ${e.message}")
    }
  }

  private fun handleRingtoneResult(resultCode: Int, data: Intent?) {
    if (resultCode != Activity.RESULT_OK || data == null) {
      emitRingtoneResult(false, "", "", null)
      return
    }
    val uri: Uri? = data.data
    if (uri == null) {
      emitRingtoneResult(false, "", "", null)
      return
    }
    try {
      // Sin permiso persistente, el URI deja de servir tras un reinicio y la
      // alarma sonaría con el default (o en silencio). Es la diferencia entre
      // "funciona hoy" y "funciona siempre".
      try {
        contentResolver.takePersistableUriPermission(
          uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      } catch (e: Exception) {
        // Los ringtones del sistema no pasan por SAF: no tienen permiso
        // persistente y no lo necesitan. Se ignora el fallo a propósito.
        android.util.Log.d("Ringtone", "Sin permiso persistente (URI del sistema): ${e.message}")
      }
      val label = resolveRingtoneLabel(uri)
      AttendancePrefs.setRingtone(this, uri.toString(), label)
      ensureAttendanceChannel(this, forzar = true)
      emitRingtoneResult(true, uri.toString(), label, null)
    } catch (e: Exception) {
      emitRingtoneResult(false, "", "", e.message)
    }
  }

  private fun resolveRingtoneLabel(uri: Uri): String {
    return try {
      val cursor = contentResolver.query(uri, null, null, null, null)
      cursor?.use {
        if (it.moveToFirst()) {
          val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) {
            val name = it.getString(idx)
            if (!name.isNullOrBlank()) return name
          }
        }
      }
      uri.lastPathSegment ?: uri.toString()
    } catch (e: Exception) {
      uri.lastPathSegment ?: uri.toString()
    }
  }

  /** Vuelve al sonido por defecto del sistema. */
  fun resetAttendanceRingtone() {
    AttendancePrefs.setRingtone(this, "", "")
    ensureAttendanceChannel(this, forzar = true)
    emitRingtoneResult(true, "", "Sonido por defecto del sistema", null)
  }

  /** Estado actual como JSON: `{"ok":true,"uri":"...","label":"..."}`. */
  fun getAttendanceRingtone(): String {
    val (uri, label) = AttendancePrefs.getRingtone(this)
    val json = org.json.JSONObject().apply {
      put("ok", true)
      put("uri", uri)
      put(
        "label",
        if (label.isBlank()) "Sonido por defecto del sistema" else label
      )
      put("canalExiste", notificationChannelExists())
    }
    return json.toString()
  }

  private fun notificationChannelExists(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
    val nm = getSystemService(NotificationManager::class.java)
    return nm.getNotificationChannel(ATTENDANCE_CHANNEL_ID) != null
  }

  private fun emitRingtoneResult(ok: Boolean, uri: String, label: String, error: String?) {
    val json = org.json.JSONObject().apply {
      put("ok", ok)
      put("uri", uri)
      put("label", label)
      if (error != null) put("error", error)
    }.toString()
    val escaped = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
    val js = """
      (function(){
        try { if (window.__TAURI__ && window.__TAURI__.event) { window.__TAURI__.event.emit('android-ringtone-result', JSON.parse('$escaped')); } } catch(e) {}
        try { window.dispatchEvent(new CustomEvent('android-ringtone-result', { detail: JSON.parse('$escaped') })); } catch(e) {}
      })();
    """.trimIndent()
    webView?.post { webView?.evaluateJavascript(js, null) }
  }
}
