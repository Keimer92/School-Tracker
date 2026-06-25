package com.keimer.schooltrackerpro

import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Bundle
import android.os.Environment
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
import java.io.File

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
}
