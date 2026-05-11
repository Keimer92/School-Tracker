package com.keimer.schooltrackerpro

import android.content.Intent
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
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, windowInsets ->
      val insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
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
