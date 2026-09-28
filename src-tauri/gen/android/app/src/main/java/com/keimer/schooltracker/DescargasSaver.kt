package com.keimer.schooltracker

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.annotation.RequiresApi
import java.io.File

/**
 * Escritura en Descargas mediante MediaStore (Android 10+).
 *
 * Va en su PROPIA clase a proposito: `MediaStore.Downloads` solo existe desde la
 * API 29, y el verificador de ART rechaza un metodo que reference clases
 * inexistentes en el dispositivo. Aislandolo aqui, el resto de la app sigue
 * funcionando en Android 7-9, donde se usa la copia directa.
 *
 * No requiere ningun permiso: el archivo lo crea la propia app.
 */
@RequiresApi(Build.VERSION_CODES.Q)
object DescargasSaver {

  private const val TAG = "DescargasSaver"

  /**
   * Copia [sourcePath] a Download/[carpeta]/[nombre] respetando el tipo MIME.
   * Si el nombre ya existe le agrega " (1)", " (2)"… para no sobrescribir nada.
   * Devuelve la ruta publica del archivo, o "" si fallo.
   */
  fun guardar(
    resolver: android.content.ContentResolver,
    sourcePath: String,
    mime: String,
    carpeta: String,
    nombre: String,
  ): String {
    return try {
      val origen = File(sourcePath)
      if (!origen.exists() || !origen.isFile) {
        Log.e(TAG, "Origen no existe: $sourcePath")
        return ""
      }

      val relativePath = "Download/$carpeta/"
      var finalName = nombre
      var n = 1
      while (existe(resolver, finalName, relativePath)) {
        finalName = if (nombre.contains('.')) {
          val base = nombre.substringBeforeLast('.')
          "$base ($n).${nombre.substringAfterLast('.')}"
        } else {
          "$nombre ($n)"
        }
        n++
      }

      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, finalName)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        // Crea sola las carpetas intermedias (Download/School Tracker/2026 - ...).
        put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }

      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      if (uri == null) {
        Log.e(TAG, "MediaStore devolvio null al insertar")
        return ""
      }
      try {
        val salida = resolver.openOutputStream(uri)
        if (salida == null) {
          resolver.delete(uri, null, null)
          Log.e(TAG, "No se pudo abrir el flujo de salida")
          return ""
        }
        salida.use { out -> origen.inputStream().use { it.copyTo(out) } }
        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
      } catch (e: Exception) {
        // Si algo falla, no dejamos el archivo a medias visible en Descargas.
        resolver.delete(uri, null, null)
        throw e
      }

      val rutaPublica = downloadRoot() + "/$carpeta/$finalName"
      Log.i(TAG, "Guardado en Descargas: $rutaPublica")
      rutaPublica
    } catch (e: Exception) {
      Log.e(TAG, "Error al guardar en Descargas: ${e.message}")
      ""
    }
  }

  private fun existe(resolver: android.content.ContentResolver, nombre: String, relativePath: String): Boolean {
    return try {
      resolver.query(
        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
        arrayOf(MediaStore.MediaColumns._ID),
        "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
        arrayOf(nombre, relativePath),
        null,
      )?.use { cursor -> cursor.count > 0 } ?: false
    } catch (e: Exception) {
      false
    }
  }

  fun downloadRoot(): String =
    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
}
