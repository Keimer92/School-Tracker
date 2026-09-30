package com.keimer.schooltracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Recibe la alarma de backup automatico y escribe la copia ROTADA.
 *
 * Corre en el proceso de la app aunque el WebView este destruido (app cerrada),
 * por eso hace el trabajo en Kotlin y no llamando a un comando de Tauri.
 */
class LocalBackupAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        // Re(programar primero: si el proceso muere durante la copia, la alarma
        // siguiente ya quedo agendada.
        LocalBackupScheduler.schedule(context)
        try {
            hacerBackup(context)
        } catch (e: Exception) {
            android.util.Log.e("LocalBackup", "Error en backup automático: ${e.message}")
        }
    }

    private fun hacerBackup(context: Context) {
        if (!LocalBackupPrefs.prefs(context).getBoolean(LocalBackupPrefs.KEY_ACTIVO, false)) {
            android.util.Log.i("LocalBackup", "Backup automático desactivado, se omite")
            return
        }
        val db = locateDb(context) ?: run {
            android.util.Log.w("LocalBackup", "No se encontró la base de datos, se omite")
            return
        }

        val nombre = "Backup_" + SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date()) + ".db"
        val mime = "application/vnd.sqlite3"
        val folder = "School Tracker/Backups"
        val keep = 2

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val ruta = DescargasSaver.rotar(context.contentResolver, db.absolutePath, mime, folder, nombre, keep)
            if (ruta.isEmpty()) {
                android.util.Log.e("LocalBackup", "rotar() devolvió vacío")
            } else {
                android.util.Log.i("LocalBackup", "Backup automático guardado: $ruta")
            }
        } else {
            val dir = File(
                android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS),
                folder
            )
            dir.mkdirs()
            val archivos = dir.listFiles { f -> f.isFile && f.name.endsWith(".db") }
                ?.sortedByDescending { it.lastModified() } ?: emptyList()
            archivos.drop(keep - 1).forEach { it.delete() }
            db.copyTo(File(dir, nombre), overwrite = true)
            android.util.Log.i("LocalBackup", "Backup automático (legacy): ${dir.absolutePath}/$nombre")
        }
        LocalBackupPrefs.marcarAhora(context)
    }

    /**
     * Busca el archivo de la BD activa. Replica la convencion de Rust
     * (`school.db` o `school_<cuenta>.db`) leyendo el marcador `active_account.txt`.
     */
    private fun locateDb(context: Context): File? {
        val dir = context.filesDir
        val marker = File(dir, "active_account.txt")
        if (marker.exists()) {
            val email = try { marker.readText().trim() } catch (e: Exception) { "" }
            if (email.isNotEmpty()) {
                val tag = sanitize(email)
                val perAccount = File(dir, "school_$tag.db")
                if (perAccount.exists()) return perAccount
            }
        }
        val porDefecto = File(dir, "school.db")
        return if (porDefecto.exists()) porDefecto else null
    }

    /**
     * Mismo criterio que `db::sanitize_account_id` en Rust, incluyendo el
     * colapso de "__" a "_" y el recorte de guiones bajos de los extremos. Si
     * divergiera, el archivo `school_<tag>.db` buscado no existiria y el backup
     * nunca encontraria la base.
     */
    private fun sanitize(email: String): String {
        var s = email.trim().lowercase(Locale.US)
            .map { c -> if (c.isLetterOrDigit()) c.toString() else "_" }
            .joinToString("")
        while (s.contains("__")) s = s.replace("__", "_")
        return s.trim('_')
    }
}
