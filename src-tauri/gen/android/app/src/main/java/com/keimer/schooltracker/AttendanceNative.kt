package com.keimer.schooltracker

import org.json.JSONArray
import org.json.JSONObject

object AttendanceNative {

    data class PendingItem(val grado: String, val seccion: String)

    fun queryAttendancePending(dbPath: String, config: String): List<PendingItem> {
        return try {
            val colegiosArr = JSONArray(config)
            val filtros = JSONObject()
            val colegioIds = JSONArray()
            for (i in 0 until colegiosArr.length()) {
                val obj = colegiosArr.getJSONObject(i)
                if (obj.has("id")) {
                    colegioIds.put(obj.getLong("id"))
                }
            }
            filtros.put("colegios", colegioIds)
            filtros.put("grados", JSONArray())
            filtros.put("secciones", JSONArray())

            val resultJson = nativeQueryAttendancePending(
                dbPath,
                java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date()),
                filtros.toString()
            )

            val arr = JSONArray(resultJson)
            val items = mutableListOf<PendingItem>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                items.add(PendingItem(
                    grado = obj.optString("grado", ""),
                    seccion = obj.optString("seccion", "")
                ))
            }
            items
        } catch (e: Exception) {
            android.util.Log.e("AttendanceNative", "Error: ${e.message}")
            emptyList()
        }
    }

    private external fun nativeQueryAttendancePending(dbPath: String, fecha: String, filtrosJson: String): String

    init {
        System.loadLibrary("school_tracker_lib")
    }
}
