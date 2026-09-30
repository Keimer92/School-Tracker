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

  /**
   * Guarda un backup ROTANDO la carpeta: deja solo [keep] archivos y borra los
   * mas antiguos. Se purga ANTES de insertar, asi que despues de la llamada la
   * carpeta tiene como maximo [keep] archivos.
   *
   * No se usan nombres fijos (backup_1/backup_2) porque MediaStore no permite
   * renombrar ni sobrescribir con facilidad; se lista por RELATIVE_PATH y se
   * borra lo que sobra. Devuelve la ruta publica del archivo nuevo, o "".
   */
  fun rotar(
    resolver: android.content.ContentResolver,
    sourcePath: String,
    mime: String,
    carpeta: String,
    nombre: String,
    keep: Int,
  ): String {
    return try {
      val origen = File(sourcePath)
      if (!origen.exists() || !origen.isFile) {
        Log.e(TAG, "Origen no existe: $sourcePath")
        return ""
      }
      // 1) Dejar solo (keep - 1) archivos: roompara el que entra ahora.
      val borrados = purgar(resolver, carpeta, (keep - 1).coerceAtLeast(0))
      if (borrados > 0) Log.i(TAG, "Rotacion: se borraron $borrados backup(s) viejo(s)")

      // 2) Insertar el nuevo.
      guardar(resolver, sourcePath, mime, carpeta, nombre)
    } catch (e: Exception) {
      Log.e(TAG, "Error en rotar(): ${e.message}")
      ""
    }
  }

  /**
   * Borra los archivos de `Download/$carpeta/` dejando los [keep] mas recientes
   * (ordenados por fecha de adicion). Devuelve cuantos borro.
   */
  private fun purgar(
    resolver: android.content.ContentResolver,
    carpeta: String,
    keep: Int,
  ): Int {
    var borrados = 0
    try {
      val relativePath = "Download/$carpeta/"
      val ids = mutableListOf<Pair<Long, String>>()  // id -> display name
      resolver.query(
        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
        arrayOf(
          MediaStore.MediaColumns._ID,
          MediaStore.MediaColumns.DISPLAY_NAME,
          MediaStore.MediaColumns.DATE_ADDED,
        ),
        "${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
        arrayOf(relativePath),
        null,
      )?.use { cursor ->
        val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
        val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
        val dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
        while (cursor.moveToNext()) {
          ids.add(Pair(cursor.getLong(dateCol), cursor.getString(nameCol) ?: ""))
          // `id` se recompone abajo desde el nombre; se usa _id directamente.
        }
      }
      if (ids.size <= keep) return 0
      // Mas reciente primero.
      ids.sortByDescending { it.first }
      val aBorrar = ids.drop(keep)
      for ((_, name) in aBorrar) {
        resolver.delete(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND ${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
          arrayOf(relativePath, name),
        )
        borrados++
      }
    } catch (e: Exception) {
      Log.e(TAG, "Error purgando backups: ${e.message}")
    }
    return borrados
  }
}
