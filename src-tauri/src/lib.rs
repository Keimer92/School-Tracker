mod db;
mod d1;

use db::*;
use d1::*;
use rusqlite::Connection;
use rusqlite::params;
use rusqlite::types::ToSql;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::Emitter;

#[tauri::command]
async fn create_folder_and_save_file(folder_path: String, file_path: String, file_data: Vec<u8>) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    
    let path = Path::new(&folder_path);
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| format!("Error creando carpeta: {}", e))?;
    }
    
    fs::write(&file_path, file_data).map_err(|e| format!("Error guardando archivo: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_schema_sql(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
        .map_err(|e| format!("Error consultando schema: {}", e))?;

    let schemas: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Error ejecutando query schema: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(schemas.join(";\n") + ";")
}

#[tauri::command]
async fn get_all_local_data_json(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let table_names = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio", "indicador_colegio_seccion_activo",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion", "colegio_dias_asistencia", "dia_sin_clases",
        "asistencia", "nota", "app_settings",
    ];

    let mut result = serde_json::Map::new();

    for table in &table_names {
        let query = format!("SELECT * FROM {}", table);
        let mut stmt = conn.prepare(&query).map_err(|e| format!("Error preparando {}: {}", table, e))?;
        let column_count = stmt.column_count();
        let column_names: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();

        let rows: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                let mut map = serde_json::Map::new();
                for (i, col_name) in column_names.iter().enumerate() {
                    let val = match row.get_ref(i) {
                        Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                        Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::json!(n),
                        Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::json!(f),
                        Ok(rusqlite::types::ValueRef::Text(t)) => {
                            let s = String::from_utf8_lossy(t).to_string();
                            serde_json::Value::String(s)
                        }
                        Ok(rusqlite::types::ValueRef::Blob(_)) => serde_json::Value::Null,
                        Err(_) => serde_json::Value::Null,
                    };
                    map.insert(col_name.clone(), val);
                }
                Ok(serde_json::Value::Object(map))
            })
            .map_err(|e| format!("Error query {}: {}", table, e))?
            .filter_map(|r| r.ok())
            .collect();

        result.insert(table.to_string(), serde_json::Value::Array(rows));
    }

    serde_json::to_string(&result).map_err(|e| format!("Error serializando: {}", e))
}

#[tauri::command]
async fn get_all_local_data_since(state: tauri::State<'_, DbState>, since: String) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let table_names = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio", "indicador_colegio_seccion_activo",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion", "colegio_dias_asistencia", "dia_sin_clases",
        "asistencia", "nota", "app_settings",
    ];

    let mut result = serde_json::Map::new();

    for table in &table_names {
        let query = format!("SELECT * FROM {} WHERE updated_at > ?", table);
        let mut stmt = conn.prepare(&query).map_err(|e| format!("Error preparando {}: {}", table, e))?;
        let column_count = stmt.column_count();
        let column_names: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();

        let rows: Vec<serde_json::Value> = stmt
            .query_map([&since as &dyn rusqlite::types::ToSql], |row| {
                let mut map = serde_json::Map::new();
                for (i, col_name) in column_names.iter().enumerate() {
                    let val = match row.get_ref(i) {
                        Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                        Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::json!(n),
                        Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::json!(f),
                        Ok(rusqlite::types::ValueRef::Text(t)) => {
                            let s = String::from_utf8_lossy(t).to_string();
                            serde_json::Value::String(s)
                        }
                        Ok(rusqlite::types::ValueRef::Blob(_)) => serde_json::Value::Null,
                        Err(_) => serde_json::Value::Null,
                    };
                    map.insert(col_name.clone(), val);
                }
                Ok(serde_json::Value::Object(map))
            })
            .map_err(|e| format!("Error query {}: {}", table, e))?
            .filter_map(|r| r.ok())
            .collect();

        result.insert(table.to_string(), serde_json::Value::Array(rows));
    }

    serde_json::to_string(&result).map_err(|e| format!("Error serializando: {}", e))
}

/// Devuelve true si alguna de las tablas sincronizables tiene filas modificadas
/// después de `since` (formato SQLite UTC: 'YYYY-MM-DD HH:MM:SS').
/// Se usa para decidir si hacer pull o push sin perder cambios locales.
#[tauri::command]
fn has_local_changes(state: tauri::State<'_, DbState>, since: String) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let table_names = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio", "indicador_colegio_seccion_activo",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion", "colegio_dias_asistencia", "dia_sin_clases",
        "asistencia", "nota", "app_settings",
    ];

    for table in &table_names {
        let query = format!("SELECT EXISTS(SELECT 1 FROM {} WHERE updated_at IS NOT NULL AND updated_at > ?)", table);
        let changed: bool = conn
            .query_row(&query, [&since as &dyn rusqlite::types::ToSql], |row| row.get(0))
            .map_err(|e| format!("Error consultando {}: {}", table, e))?;
        if changed {
            return Ok(true);
        }
    }

    Ok(false)
}

#[allow(dead_code)]
fn get_all_local_data(
    conn: &mut rusqlite::Connection,
) -> Result<HashMap<String, Vec<serde_json::Value>>, String> {
    let mut result = HashMap::new();

    // Procesar cada tabla individualmente
    // Categorías (años, cortes, colegios)
    let category_tables = vec![
        (
            "ano_lectivo",
            "SELECT id, nombre, activo, cualitativo FROM ano_lectivo",
        ),
        (
            "corte_evaluativo",
            "SELECT id, nombre, activo, cualitativo FROM corte_evaluativo",
        ),
        (
            "colegio",
            "SELECT id, nombre, activo, cualitativo FROM colegio",
        ),
    ];

    for (table_name, query) in category_tables {
        let mut stmt = conn
            .prepare(query)
            .map_err(|e| format!("Error preparando consulta para {}: {}", table_name, e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "nombre": row.get::<_, String>(1)?,
                    "activo": row.get::<_, i64>(2)? != 0,
                    "cualitativo": row.get::<_, i64>(3)? != 0
                }))
            })
            .map_err(|e| format!("Error ejecutando consulta para {}: {}", table_name, e))?;

        let mut table_data = Vec::new();
        for row_result in rows {
            match row_result {
                Ok(json_value) => table_data.push(json_value),
                Err(e) => return Err(format!("Error procesando fila en {}: {}", table_name, e)),
            }
        }

        println!(
            "📊 [PUSH] Tabla {}: {} registros obtenidos",
            table_name,
            table_data.len()
        );
        result.insert(table_name.to_string(), table_data);
    }

    // Asignaturas, grados, secciones
    let simple_tables = vec![
        (
            "asignatura",
            "SELECT id, nombre, cualitativo FROM asignatura",
        ),
        ("grado", "SELECT id, nombre, cualitativo FROM grado"),
        ("seccion", "SELECT id, nombre, cualitativo FROM seccion"),
    ];

    for (table_name, query) in simple_tables {
        let mut stmt = conn
            .prepare(query)
            .map_err(|e| format!("Error preparando consulta para {}: {}", table_name, e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "nombre": row.get::<_, String>(1)?,
                    "cualitativo": row.get::<_, i64>(2)? != 0
                }))
            })
            .map_err(|e| format!("Error ejecutando consulta para {}: {}", table_name, e))?;

        let mut table_data = Vec::new();
        for row_result in rows {
            match row_result {
                Ok(json_value) => table_data.push(json_value),
                Err(e) => return Err(format!("Error procesando fila en {}: {}", table_name, e)),
            }
        }

        println!(
            "📊 [PUSH] Tabla {}: {} registros obtenidos",
            table_name,
            table_data.len()
        );
        result.insert(table_name.to_string(), table_data);
    }

    // Estudiantes
    let mut stmt = conn
        .prepare("SELECT id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, coalesce(colegio_id, 0) FROM estudiante")
        .map_err(|e| format!("Error preparando consulta para estudiante: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "nombre": row.get::<_, String>(1)?,
                "codigo": row.get::<_, String>(2)?,
                "sexo": row.get::<_, String>(3)?,
                "ano_lectivo_id": row.get::<_, i64>(4)?,
                "grado_id": row.get::<_, i64>(5)?,
                "seccion_id": row.get::<_, i64>(6)?,
                "colegio_id": row.get::<_, i64>(7)?
            }))
        })
        .map_err(|e| format!("Error ejecutando consulta para estudiante: {}", e))?;

    let mut table_data = Vec::new();
    for row_result in rows {
        match row_result {
            Ok(json_value) => table_data.push(json_value),
            Err(e) => return Err(format!("Error procesando fila en estudiante: {}", e)),
        }
    }

    println!(
        "📊 [PUSH] Tabla estudiante: {} registros obtenidos",
        table_data.len()
    );
    result.insert("estudiante".to_string(), table_data);

    // Asistencia
    let mut stmt_asist = conn
        .prepare("SELECT estudiante_id, fecha, estado, COALESCE(observacion, '') FROM asistencia")
        .map_err(|e| format!("Error preparando consulta para asistencia: {}", e))?;

    let rows_asist = stmt_asist
        .query_map([], |row| {
            Ok(serde_json::json!({
                "estudiante_id": row.get::<_, i64>(0)?,
                "fecha": row.get::<_, String>(1)?,
                "estado": row.get::<_, String>(2)?,
                "observacion": row.get::<_, String>(3)?
            }))
        })
        .map_err(|e| format!("Error ejecutando consulta para asistencia: {}", e))?;

    let mut table_asistencia = Vec::new();
    for row_result in rows_asist {
        match row_result {
            Ok(json_value) => table_asistencia.push(json_value),
            Err(e) => return Err(format!("Error procesando fila en asistencia: {}", e)),
        }
    }

    println!("📊 [PUSH] Tabla asistencia: {} registros obtenidos", table_asistencia.len());
    result.insert("asistencia".to_string(), table_asistencia);

    // Notas
    let mut stmt_notas = conn
        .prepare("SELECT estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id FROM nota")
        .map_err(|e| format!("Error preparando consulta para nota: {}", e))?;

    let rows_notas = stmt_notas
        .query_map([], |row| {
            Ok(serde_json::json!({
                "estudiante_id": row.get::<_, i64>(0)?,
                "criterio_id": row.get::<_, i64>(1)?,
                "valor": row.get::<_, f64>(2)?,
                "corte_evaluativo_id": row.get::<_, i64>(3)?,
                "asignatura_id": row.get::<_, i64>(4)?
            }))
        })
        .map_err(|e| format!("Error ejecutando consulta para nota: {}", e))?;

    let mut table_notas = Vec::new();
    for row_result in rows_notas {
        match row_result {
            Ok(json_value) => table_notas.push(json_value),
            Err(e) => return Err(format!("Error procesando fila en nota: {}", e)),
        }
    }

    println!("📊 [PUSH] Tabla nota: {} registros obtenidos", table_notas.len());
    result.insert("nota".to_string(), table_notas);

    // Indicadores
    let mut stmt_ind = conn
        .prepare("SELECT id, grado_id, asignatura_id, coalesce(corte_evaluativo_id, 0), coalesce(ano_lectivo_id, 0), orden, descripcion, activo FROM indicador")
        .map_err(|e| format!("Error preparando consulta para indicador: {}", e))?;

    let rows_ind = stmt_ind
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "grado_id": row.get::<_, i64>(1)?,
                "asignatura_id": row.get::<_, i64>(2)?,
                "corte_evaluativo_id": row.get::<_, i64>(3)?,
                "ano_lectivo_id": row.get::<_, i64>(4)?,
                "orden": row.get::<_, i64>(5)?,
                "descripcion": row.get::<_, String>(6)?,
                "activo": row.get::<_, i64>(7)? != 0
            }))
        })
        .map_err(|e| format!("Error ejecutando consulta para indicador: {}", e))?;

    let mut table_indicador = Vec::new();
    for row_result in rows_ind {
        match row_result {
            Ok(json_value) => table_indicador.push(json_value),
            Err(e) => return Err(format!("Error procesando fila en indicador: {}", e)),
        }
    }

    println!("📊 [PUSH] Tabla indicador: {} registros obtenidos", table_indicador.len());
    result.insert("indicador".to_string(), table_indicador);

    // Criterios
    let mut stmt_crit = conn
        .prepare("SELECT id, indicador_id, orden, descripcion, puntaje_maximo FROM criterio")
        .map_err(|e| format!("Error preparando consulta para criterio: {}", e))?;

    let rows_crit = stmt_crit
        .query_map([], |row| {
            let puntaje_raw: f64 = row.get(4)?;
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "indicador_id": row.get::<_, i64>(1)?,
                "orden": row.get::<_, i64>(2)?,
                "descripcion": row.get::<_, String>(3)?,
                "puntaje_maximo": puntaje_raw.round() as i64
            }))
        })
        .map_err(|e| format!("Error ejecutando consulta para criterio: {}", e))?;

    let mut table_criterio = Vec::new();
    for row_result in rows_crit {
        match row_result {
            Ok(json_value) => table_criterio.push(json_value),
            Err(e) => return Err(format!("Error procesando fila en criterio: {}", e)),
        }
    }

    println!("📊 [PUSH] Tabla criterio: {} registros obtenidos", table_criterio.len());
    result.insert("criterio".to_string(), table_criterio);

    Ok(result)
}

#[tauri::command]
async fn set_orientation(_app_handle: tauri::AppHandle, _orientation: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let orientation_value = match _orientation.as_str() {
            "portrait" => 1,
            "landscape" => 0,
            "any" => 4,
            _ => -1,
        };
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let _ = env
                .call_method(
                    activity,
                    "setRequestedOrientation",
                    "(I)V",
                    &[JValue::Int(orientation_value)],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn print_pdf(_app_handle: tauri::AppHandle, _path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let j_path = env.new_string(clean_path).map_err(|e| e.to_string())?;
            let _ = env
                .call_method(
                    activity,
                    "printPdf",
                    "(Ljava/lang/String;)V",
                    &[JValue::Object(&j_path)],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Not supported".into())
    }
}

#[tauri::command]
async fn share_pdf(_app_handle: tauri::AppHandle, _path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let j_path = env.new_string(clean_path).map_err(|e| e.to_string())?;
            let _ = env
                .call_method(
                    activity,
                    "sharePdf",
                    "(Ljava/lang/String;)V",
                    &[JValue::Object(&j_path)],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
async fn save_file_android(
    _app_handle: tauri::AppHandle,
    _path: String,
    _mime: String,
    _name: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let j_path = env.new_string(clean_path).map_err(|e| e.to_string())?;
            let j_mime = env.new_string(_mime).map_err(|e| e.to_string())?;
            let j_name = env.new_string(_name).map_err(|e| e.to_string())?;
            let _ = env
                .call_method(
                    activity,
                    "saveFile",
                    "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                    &[
                        JValue::Object(&j_path),
                        JValue::Object(&j_mime),
                        JValue::Object(&j_name),
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Guarda un archivo ya escrito por la app en Descargas/carpeta, usando
/// MediaStore en Android (sin permisos). Devuelve la ruta publica donde quedo.
/// En desktop no hace nada y devuelve cadena vacia.
#[tauri::command]
async fn guardar_en_descargas(
    _app_handle: tauri::AppHandle,
    _path: String,
    _mime: String,
    _carpeta: String,
    _nombre: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        // OJO: ndk_context NO esta inicializado en este setup. Usar el puente propio.
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_path = env.new_string(&clean_path).map_err(|e| e.to_string())?;
        let j_mime = env.new_string(&_mime).map_err(|e| e.to_string())?;
        let j_carpeta = env.new_string(&_carpeta).map_err(|e| e.to_string())?;
        let j_nombre = env.new_string(&_nombre).map_err(|e| e.to_string())?;
        let j_obj = env
            .call_method(
                activity.as_obj(),
                "saveToDownloads",
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                &[
                    JValue::Object(&j_path),
                    JValue::Object(&j_mime),
                    JValue::Object(&j_carpeta),
                    JValue::Object(&j_nombre),
                ],
            )
            .map_err(|e| format!("Error JNI saveToDownloads: {}", e))?
            .l()
            .map_err(|e| e.to_string())?;
        if j_obj.is_null() {
            return Ok(String::new());
        }
        let ruta: String = env
            .get_string(&jni::objects::JString::from(j_obj))
            .map_err(|e| e.to_string())?
            .into();
        println!("[Android] guardar_en_descargas -> {}", if ruta.is_empty() { "(fallo)" } else { &ruta });
        Ok(ruta)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (_path, _mime, _carpeta, _nombre);
        Ok(String::new())
    }
}


#[tauri::command]
async fn notify_attendance_reminder(_app_handle: tauri::AppHandle, _title: String, _body: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        println!("[Notif] notify_attendance_reminder: title='{}' body='{}'", _title, _body);
        // NOTA: ndk_context::android_context() NO está inicializado en este setup
        // (panics silenciosos). Usar SIEMPRE el puente propio initNativeBridge.
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_title = env.new_string(&_title).map_err(|e| e.to_string())?;
        let j_body = env.new_string(&_body).map_err(|e| e.to_string())?;
        env.call_method(
            activity.as_obj(),
            "notifyAttendanceReminder",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[JValue::Object(&j_title), JValue::Object(&j_body)],
        )
        .map_err(|e| format!("Error JNI notifyAttendanceReminder: {}", e))?;
        println!("[Notif] notifyAttendanceReminder invocado OK");
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        println!("[Notif] notify_attendance_reminder: no-op (no Android)");
        Ok(())
    }
}

#[tauri::command]
async fn schedule_attendance_alarm(_app_handle: tauri::AppHandle, _config: String, _db_path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        println!("[Notif] schedule_attendance_alarm: db='{}' config={}", _db_path, _config);
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_config = env.new_string(&_config).map_err(|e| e.to_string())?;
        let j_db = env.new_string(&_db_path).map_err(|e| e.to_string())?;
        env.call_method(
            activity.as_obj(),
            "scheduleAttendanceAlarm",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[JValue::Object(&j_config), JValue::Object(&j_db)],
        )
        .map_err(|e| format!("Error JNI scheduleAttendanceAlarm: {}", e))?;
        println!("[Notif] scheduleAttendanceAlarm invocado OK");
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        println!("[Notif] schedule_attendance_alarm: no-op (no Android)");
        let _ = (_config, _db_path);
        Ok(())
    }
}

#[tauri::command]
async fn cancel_attendance_alarm(_app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        println!("[Notif] cancel_attendance_alarm");
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        env.call_method(activity.as_obj(), "cancelAttendanceAlarm", "()V", &[])
            .map_err(|e| format!("Error JNI cancelAttendanceAlarm: {}", e))?;
        println!("[Notif] cancelAttendanceAlarm invocado OK");
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
async fn get_attendance_silenced_today(_app_handle: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let result = env
            .call_method(activity.as_obj(), "getAttendanceSilencedToday", "()Z", &[])
            .map_err(|e| format!("Error JNI getAttendanceSilencedToday: {}", e))?;
        let silenced = result.z().map_err(|e| e.to_string())?;
        println!("[Notif] get_attendance_silenced_today = {}", silenced);
        Ok(silenced)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(false)
    }
}

#[tauri::command]
async fn set_attendance_silenced_today(_app_handle: tauri::AppHandle, _silenced: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        println!("[Notif] set_attendance_silenced_today = {}", _silenced);
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        env.call_method(
            activity.as_obj(),
            "setAttendanceSilencedToday",
            "(Z)V",
            &[JValue::Bool(if _silenced { 1 } else { 0 })],
        )
        .map_err(|e| format!("Error JNI setAttendanceSilencedToday: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
async fn dismiss_attendance_today(_app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        println!("[Notif] dismiss_attendance_today");
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        env.call_method(activity.as_obj(), "dismissAttendanceToday", "()V", &[])
            .map_err(|e| format!("Error JNI dismissAttendanceToday: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

// ── Puente JNI nativo (Android) ──────────────────────────────────────
// Caché de (puntero a JavaVM, Activity como GlobalRef). Se llena desde
// Kotlin (MainActivity.initNativeBridge) y como respaldo desde ndk_context.
#[cfg(target_os = "android")]
static NATIVE_BRIDGE: std::sync::Mutex<Option<(usize, jni::objects::GlobalRef)>> =
    std::sync::Mutex::new(None);

/// Inicializa el puente JNI con la Activity actual. Invocado desde
/// MainActivity.onCreate (Kotlin) para no depender de ndk_context.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_keimer_schooltracker_MainActivity_initNativeBridge(
    mut env: jni::JNIEnv,
    activity: jni::objects::JObject,
) {
    let result = (|| -> Result<(), String> {
        let vm = env.get_java_vm().map_err(|e| e.to_string())?;
        let gref = env.new_global_ref(&activity).map_err(|e| e.to_string())?;
        let ptr = unsafe { vm.get_java_vm_pointer() } as usize;
        *NATIVE_BRIDGE.lock().map_err(|e| e.to_string())? = Some((ptr, gref));
        Ok(())
    })();
    match result {
        Ok(()) => println!("[Bridge] puente JNI inicializado desde Kotlin"),
        Err(e) => eprintln!("[Bridge] error inicializando desde Kotlin: {}", e),
    }
}

#[cfg(target_os = "android")]
fn obtain_native_bridge() -> Result<(jni::JavaVM, jni::objects::GlobalRef), String> {
    if let Some((vm_ptr, act)) = NATIVE_BRIDGE.lock().map_err(|e| e.to_string())?.clone() {
        let vm = unsafe { jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())? };
        return Ok((vm, act));
    }
    // Respaldo: intentar leer ndk_context (sin panic si no está listo)
    for attempt in 0..10u32 {
        let got = unsafe {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ndk_context::android_context()
            }))
            .ok()
        };
        if let Some(ctx) = got {
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            if !vm_ptr.is_null() && !activity_ptr.is_null() {
                let gref = unsafe {
                    let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
                    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
                    let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
                    let gref = env.new_global_ref(&activity).map_err(|e| e.to_string())?;
                    gref
                };
                let vm =
                    unsafe { jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())? };
                *NATIVE_BRIDGE.lock().map_err(|e| e.to_string())? =
                    Some((vm_ptr as usize, gref.clone()));
                println!("[Bridge] ndk_context listo (intento {})", attempt + 1);
                return Ok((vm, gref));
            }
        }
        println!("[Bridge] ndk_context no listo, intento {}...", attempt + 1);
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("Puente JNI no disponible (no se pudo obtener la Activity)".to_string())
}

/// Lanza el selector nativo de cuentas de Google (bottom sheet, la app no pierde
/// el primer plano). El resultado llega al frontend por el evento
/// `google-native-auth-result` (CustomEvent en window desde MainActivity).
#[tauri::command]
async fn gd_start_native_signin(server_client_id: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_client_id = env.new_string(&server_client_id).map_err(|e| e.to_string())?;
        env.call_method(
            activity.as_obj(),
            "startGoogleSignIn",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&j_client_id)],
        )
        .map_err(|e| format!("Error JNI startGoogleSignIn: {}", e))?;
        println!("[OAuth] startGoogleSignIn invocado");
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = server_client_id;
        Err("El sign-in nativo solo está disponible en Android".to_string())
    }
}

/// Pide el permiso POST_NOTIFICATIONS (Android 13+) mostrando el diálogo
/// nativo del sistema. Se invoca en la primera ejecución (WelcomePage).
#[tauri::command]
async fn gd_request_notification_permission() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        env.call_method(activity.as_obj(), "requestNotificationPermissionNow", "()V", &[])
            .map_err(|e| format!("Error JNI requestNotificationPermissionNow: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(()) // En desktop no se requiere permiso de notificaciones
    }
}

/// Estado de batería leído vía JNI en Android (no depende del WebView).
/// En desktop devuelve `charging: true, level: 100` para que el scheduler
/// nunca se bloquee por batería.
#[derive(serde::Serialize, Clone, Debug)]
struct BatteryStatus {
    charging: bool,
    level: i32,
    source: &'static str,
}

/// Estado del sonido elegido para la alarma de asistencia (solo Android).
///
/// Devuelve el JSON que arma Kotlin: `{ ok, uri, label, canalExiste }`. En
/// desktop devuelve el equivalente con el sonido por defecto para que el
/// frontend pueda pintar la UI sin ramificar por plataforma.
#[tauri::command]
async fn attendance_get_ringtone() -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_obj = env
            .call_method(
                activity.as_obj(),
                "getAttendanceRingtone",
                "()Ljava/lang/String;",
                &[],
            )
            .map_err(|e| format!("Error JNI getAttendanceRingtone: {}", e))?
            .l()
            .map_err(|e| e.to_string())?;
        if j_obj.is_null() {
            return Ok(r#"{"ok":true,"uri":"","label":"Sonido por defecto del sistema"}"#.to_string());
        }
        let s: String = env
            .get_string(&jni::objects::JString::from(j_obj))
            .map_err(|e| e.to_string())?
            .into();
        Ok(s)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(r#"{"ok":true,"uri":"","label":"Sonido por defecto del sistema"}"#.to_string())
    }
}

/// Abre el selector de sonido de Android: `"sistema"` (ringtones instalados) o
/// `"archivo"` (mp/wav/ogg del almacenamiento).
///
/// El resultado NO vuelve por acá: el picker es asíncrono y el WebView puede
/// recargarse mientras el usuario está en el selector. Kotlin guarda el URI y
/// emite el evento `android-ringtone-result` al WebView; el frontend además
/// puede releer el estado con `attendance_get_ringtone`.
#[tauri::command]
async fn attendance_pick_ringtone(tipo: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_tipo = env.new_string(&tipo).map_err(|e| e.to_string())?;
        env.call_method(
            activity.as_obj(),
            "pickAttendanceRingtone",
            "(Ljava/lang/String;)V",
            &[jni::objects::JValue::Object(&j_tipo)],
        )
        .map_err(|e| format!("Error JNI pickAttendanceRingtone: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = tipo;
        Err("La selección de sonido solo está disponible en Android.".to_string())
    }
}

/// Vuelve al sonido por defecto del sistema y recrea el canal.
#[tauri::command]
async fn attendance_reset_ringtone() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        env.call_method(activity.as_obj(), "resetAttendanceRingtone", "()V", &[])
            .map_err(|e| format!("Error JNI resetAttendanceRingtone: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
async fn gd_battery_status() -> Result<BatteryStatus, String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_obj = env
            .call_method(activity.as_obj(), "currentBatteryStatus", "()Ljava/lang/String;", &[])
            .map_err(|e| format!("Error JNI currentBatteryStatus: {}", e))?
            .l()
            .map_err(|e| e.to_string())?;
        if j_obj.is_null() {
            return Ok(BatteryStatus { charging: true, level: 100, source: "jni_null" });
        }
        let s: String = env
            .get_string(&jni::objects::JString::from(j_obj))
            .map_err(|e| e.to_string())?
            .into();
        // Formato esperado: "CHARGING|85" (CHARGING / DISCHARGING / FULL / UNKNOWN)
        let mut parts = s.splitn(2, '|');
        let status = parts.next().unwrap_or("UNKNOWN").trim().to_string();
        let level: i32 = parts
            .next()
            .and_then(|lvl| lvl.trim().parse::<i32>().ok())
            .unwrap_or(100)
            .clamp(0, 100);
        let charging = matches!(status.as_str(), "CHARGING" | "FULL");
        Ok(BatteryStatus { charging, level, source: "jni" })
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(BatteryStatus { charging: true, level: 100, source: "desktop_default" })
    }
}

/// Muestra una notificación nativa Android usando el canal "drive_backups"
/// (creado en MainActivity.onCreate). En desktop es un no-op silencioso.
#[tauri::command]
async fn gd_show_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_title = env.new_string(&title).map_err(|e| e.to_string())?;
        let j_body = env.new_string(&body).map_err(|e| e.to_string())?;
        env.call_method(
            activity.as_obj(),
            "showDriveBackupNotification",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[jni::objects::JValueGen::Object(&j_title), jni::objects::JValueGen::Object(&j_body)],
        )
        .map_err(|e| format!("Error JNI showDriveBackupNotification: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (title, body);
        Ok(())
    }
}

/// Consulta (y consume) el último resultado del sign-in nativo guardado en
/// MainActivity. Respaldo por polling para cuando una recarga del WebView
/// pierde el evento `google-native-auth-result`.
#[tauri::command]
async fn gd_take_last_native_result() -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        let (vm, activity) = obtain_native_bridge()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let j_val = env
            .call_method(activity.as_obj(), "takeLastGoogleAuthResult", "()Ljava/lang/String;", &[])
            .map_err(|e| e.to_string())?
            .l()
            .map_err(|e| e.to_string())?;
        if j_val.is_null() {
            return Ok(None);
        }
        let s: String = env
            .get_string(&jni::objects::JString::from(j_val))
            .map_err(|e| e.to_string())?
            .into();
        Ok(Some(s))
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(None)
    }
}

/// Función JNI invocada por `AttendanceNative` (Kotlin) cuando la app está
/// cerrada y dispara la alarma de asistencia. Recibe la ruta de la BD, la
/// fecha local y un JSON con los filtros, y devuelve el JSON de pendientes.
/// La consulta SQL vive SOLO en Rust (`db::grados_secciones_sin_asistencia`).
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_keimer_schooltracker_AttendanceNative_queryAttendancePending(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    db_path: jni::sys::jstring,
    fecha: jni::sys::jstring,
    filtros_json: jni::sys::jstring,
) -> jni::sys::jstring {
    use std::collections::HashMap;

    let result = (|| -> Result<String, String> {
        let db_str: String = unsafe {
                env.get_string(&jni::objects::JString::from_raw(db_path))
                    .map_err(|e| e.to_string())?
                    .into()
            };
            let fecha_str: String = unsafe {
                env.get_string(&jni::objects::JString::from_raw(fecha))
                    .map_err(|e| e.to_string())?
                    .into()
            };
            let filtros_str: String = unsafe {
                env.get_string(&jni::objects::JString::from_raw(filtros_json))
                    .map_err(|e| e.to_string())?
                    .into()
            };

        let filtros: HashMap<String, Vec<i64>> =
            serde_json::from_str(&filtros_str).map_err(|e| format!("JSON inválido: {}", e))?;

        let colegios = filtros.get("colegios").cloned().unwrap_or_default();
        let grados = filtros.get("grados").cloned().unwrap_or_default();
        let secciones = filtros.get("secciones").cloned().unwrap_or_default();

        let conn = rusqlite::Connection::open(&db_str).map_err(|e| format!("No se pudo abrir BD: {}", e))?;
        let pendientes = db::grados_secciones_sin_asistencia(&conn, &colegios, &grados, &secciones, &fecha_str)?;
        let items: Vec<serde_json::Value> = pendientes
            .iter()
            .map(|p| {
                serde_json::json!({ "grado": p.grado, "seccion": p.seccion })
            })
            .collect();
        serde_json::to_string(&items).map_err(|e| e.to_string())
    })();

    match result {
        Ok(json) => env
            .new_string(&json)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Err(e) => {
            let json = serde_json::json!({ "error": e }).to_string();
            env.new_string(&json)
                .map(|s| s.into_raw())
                .unwrap_or(std::ptr::null_mut())
        }
    }
}

// ========================
// GOOGLE DRIVE BACKUP COMMANDS
// ========================

#[tauri::command]
async fn gd_read_file_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::fs;
    
    let bytes = fs::read(&path)
        .map_err(|e| format!("Error leyendo archivo: {}", e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn gd_reload_database(app_handle: tauri::AppHandle, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let app_dir = get_profile_app_dir(&app_handle)?;
    let db_path = db::resolve_active_db_path(&app_dir);
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    *conn = Connection::open(&db_path).map_err(|e| format!("Failed to reopen database: {}", e))?;
    db::init_database(&*conn).map_err(|e| e.to_string())?;
    Ok(())
}

/// Desvincula la cuenta de Google activa: borra el marcador de cuenta, limpia
/// la configuración de nube y vuelve a abrir la base por defecto (`school.db`).
///
/// Se usa en "Empezar de cero" del Welcome: si el usuario intentó la opción de
/// Drive/Cloudflare, quedó con la cuenta enlazada y el archivo .db de esa
/// cuenta como activo. Empezar de cero debe dejarla sin nube, no seguir
/// subiendo la base nueva al namespace de la cuenta anterior.
#[tauri::command]
async fn desvincular_cuenta(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<String, String> {
    use std::fs;

    let app_dir = get_profile_app_dir(&app_handle)?;
    // Liberar el handle del archivo por cuenta ANTES de reabrir: en Windows
    // mantenerlo abierto impide operar sobre `school.db`.
    {
        let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
        *conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    }
    // 1) Quitar el marcador de cuenta activa -> resolve_active_db_path cae a school.db
    let marker = app_dir.join("active_account.txt");
    if marker.exists() {
        let _ = fs::remove_file(&marker);
    }
    // 2) Limpiar la config de nube guardada en la base (si el archivo la tenía)
    let db_path = db::resolve_active_db_path(&app_dir);
    {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        db::init_database(&conn).map_err(|e| e.to_string())?;
        let _ = conn.execute("DELETE FROM d1_config", []);
    }
    // 3) Reabrir la base por defecto
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    *conn = Connection::open(&db_path).map_err(|e| format!("Failed to reopen database: {}", e))?;
    db::init_database(&*conn).map_err(|e| e.to_string())?;
    Ok(db_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn gd_write_file_base64(path: String, content_base64: String) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::fs;

    let bytes = general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("Error decodificando base64: {}", e))?;
    let p = std::path::PathBuf::from(&path);
    // Si la base está en WAL, los archivos `-wal`/`-shm` pertenecen a la base
    // ANTERIOR. Si se dejan, SQLite los reproduce sobre el archivo recién
    // escrito y lo corrompe. Se borran antes de sobrescribir.
    for sufijo in ["-wal", "-shm"] {
        let lateral = p.with_extension(format!(
            "{}{}",
            p.extension().and_then(|e| e.to_str()).unwrap_or("db"),
            sufijo
        ));
        if lateral.exists() {
            let _ = fs::remove_file(&lateral);
        }
    }
    fs::write(&path, bytes)
    .map_err(|e| format!("Error escribiendo archivo: {}", e))?;
    Ok(())
}


/// Rutas donde suelen estar los navegadores, en orden de probabilidad.
///
/// Windows decide qué navegador abrir leyendo la asociación `http`/`https` del
/// usuario, y esa asociación muy muchas veces sigue apuntando a Edge aunque la
/// persona use Firefox a diario (Edge se auto-registra al instalarse y el
/// "predeterminado" de Windows 11 es Edge). Cuando el usuario elige un
/// navegador explícitamente en Ajustes lo arrancamos nosotros con su
/// ejecutable, sin depender de esa asociación.
///
/// Se prueba primero la ruta absoluta (Chrome y Edge suelen NO estar en el PATH)
/// y al final el nombre pelado, que cubre installs atypicalos y lo resuelve
/// `Command::spawn` via el PATH del proceso.
fn candidatos_navegador(id: &str) -> Vec<String> {
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    match id {
        "firefox" => vec![
            format!(r"{}\Mozilla Firefox\firefox.exe", pf),
            format!(r"{}\Mozilla Firefox\firefox.exe", pf86),
            "firefox.exe".into(),
        ],
        "chrome" => {
            let mut v = vec![
                format!(r"{}\Google\Chrome\Application\chrome.exe", pf),
                format!(r"{}\Google\Chrome\Application\chrome.exe", pf86),
            ];
            if !local.is_empty() {
                v.push(format!(r"{}\Google\Chrome\Application\chrome.exe", local));
            }
            v.push("chrome.exe".into());
            v
        }
        "edge" => vec![
            format!(r"{}\Microsoft\Edge\Application\msedge.exe", pf86),
            format!(r"{}\Microsoft\Edge\Application\msedge.exe", pf),
            "msedge.exe".into(),
        ],
        "brave" => vec![
            format!(r"{}\BraveSoftware\Brave-Browser\Application\brave.exe", pf),
            format!(r"{}\BraveSoftware\Brave-Browser\Application\brave.exe", pf86),
            "brave.exe".into(),
        ],
        // Cualquier otro valor se trata como una ruta/custom ya resuelta.
        _ => vec![id.to_string()],
    }
}

/// Abre la URL con el navegador que el usuario eligió en Ajustes.
///
/// Devuelve `false` si no se pudo (no está instalado, la ruta está mal, etc.)
/// para que el llamador caiga al navegador del sistema: **elegir un navegador
/// nunca puede romper el login**.
fn abrir_con_navegador(url: &str, id: &str) -> bool {
    for exe in candidatos_navegador(id) {
        match std::process::Command::new(&exe).arg(url).spawn() {
            Ok(_) => {
                println!("[Browser] abierto con '{}' ({}), como pedía el usuario", id, exe);
                return true;
            }
            Err(e) => {
                println!("[Browser] no se pudo lanzar '{}' ({}): {}", id, exe, e);
            }
        }
    }
    false
}

/// Devuelve la ruta del ejecutable que se usaría para `browser`, o `""` si no
/// se encuentra ninguno. No abre nada: es solo el diagnóstico que muestra el
/// selector ("Se abrirá: C:\...\firefox.exe"), para que el usuario pueda
/// confirmar si su preferencia se aplicó de verdad.
#[tauri::command]
fn gd_resolve_browser(browser: Option<String>) -> String {
    let id = match browser.as_deref() {
        Some(v) if !v.is_empty() && v != "default" => v,
        // Sin preferencia no hay nada que resolver: manda el del sistema.
        _ => return String::new(),
    };
    for exe in candidatos_navegador(id) {
        if std::path::Path::new(&exe).is_file() {
            return exe;
        }
    }
    println!("[Browser] no se encontró el ejecutable de '{}'", id);
    String::new()
}

#[tauri::command]
async fn gd_open_url_browser(
    app: tauri::AppHandle,
    url: String,
    browser: Option<String>,
) -> Result<(), String> {
    // 1) Navegador elegido explícitamente en Ajustes (si no, el del sistema).
    // Solo desktop: las rutas candidatas son de Windows y en Android el
    // "navegador del sistema" ya es el unico mecanismo que hay.
    #[cfg(not(target_os = "android"))]
    if let Some(id) = browser.as_deref().filter(|s| !s.is_empty() && *s != "default") {
        if abrir_con_navegador(&url, id) {
            return Ok(());
        }
        // Si falla se sigue con el del sistema, con un aviso en consola: mejor
        // un login en Edge que un login imposible.
        println!("[Browser] el navegador elegido ('{}') no se pudo abrir; se usa el del sistema", id);
    }
    #[cfg(target_os = "android")]
    let _ = &browser;

    // 2) Navegador del sistema. El plugin opener está registrado en todas las
    // plataformas (ver `run()`) y delega en ShellExecuteExW con el verbo por
    // defecto, que es lo que respeta la asociación http/https del usuario.
    #[cfg(not(target_os = "android"))]
    let _opened_by_plugin = {
        use tauri_plugin_opener::OpenerExt;
        match app.opener().open_url(&url, None::<&str>) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[Browser] opener plugin falló ({}), usando comando del sistema", e);
                false
            }
        }
    };

    // Android siempre por el plugin (el `open`/`xdg-open` de abajo no existen).
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| format!("Failed to open browser on Android: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    if !_opened_by_plugin {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    if !_opened_by_plugin {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    if !_opened_by_plugin {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    #[cfg(not(any(target_os = "android", target_os = "windows", target_os = "macos", target_os = "linux")))]
    let _ = (app, url);

    Ok(())
}

#[tauri::command]
async fn gd_start_oauth_server(port: u16) -> Result<String, String> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("No se pudo iniciar el servidor local en {}: {}", addr, e))?;
    
    let mut code = String::new();
    
    if let Ok((mut socket, _)) = listener.accept().await {
        let mut buffer = [0; 2048];
        let mut request = String::new();
        
        if let Ok(size) = socket.read(&mut buffer).await {
            request = String::from_utf8_lossy(&buffer[..size]).into_owned();
        }
        
        if let Some(code_pos) = request.find("code=") {
            let start = code_pos + 5;
            let end = request[start..]
                .find(|c| c == ' ' || c == '&')
                .map(|pos| start + pos)
                .unwrap_or(request.len());
            code = request[start..end].to_string();
        }
        
        let html = r#"<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Conexión Exitosa</title>
    <style>
        body { 
            margin: 0; 
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            background: #0f172a; 
            font-family: system-ui, -apple-system, sans-serif;
            overflow: hidden;
        }
        .bg-gradient {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.15), transparent 70%);
            pointer-events: none;
        }
        .card {
            position: relative;
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 3rem 2.5rem;
            text-align: center;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            animation: slideUp 0.6s ease-out;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon-wrapper {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, #10b981, #059669);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.4); }
            50% { box-shadow: 0 0 30px rgba(16, 185, 129, 0.6); }
        }
        .check-icon {
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
            fill: none;
            stroke-dasharray: 50;
            stroke-dashoffset: 50;
            animation: drawCheck 0.5s 0.3s forwards ease-in-out;
        }
        @keyframes drawCheck {
            to { stroke-dashoffset: 0; }
        }
        h1 {
            color: #f8fafc;
            font-size: 1.75rem;
            font-weight: 800;
            margin: 0 0 0.75rem;
            letter-spacing: -0.02em;
        }
        p {
            color: #94a3b8;
            font-size: 0.95rem;
            line-height: 1.6;
            margin: 0 0 1.5rem;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            border-radius: 9999px;
            color: #34d399;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 1.5rem;
        }
        .badge::before {
            content: '';
            width: 6px;
            height: 6px;
            background: #10b981;
            border-radius: 50%;
        }
        a.btn {
            display: inline-block;
            background: #3b82f6;
            color: white;
            text-decoration: none;
            padding: 10px 24px;
            border-radius: 12px;
            font-weight: 600;
            transition: background 0.2s;
        }
        a.btn:hover {
            background: #2563eb;
        }
    </style>
</head>
<body>
    <div class="bg-gradient"></div>
    <div class="card">
        <div class="icon-wrapper">
            <svg class="check-icon" viewBox="0 0 24 24">
                <polyline points="4 12 9 17 20 6"></polyline>
            </svg>
        </div>
        <h1>¡Conexión Exitosa!</h1>
        <p>Tu cuenta de Google Drive se ha vinculado correctamente con School Tracker Pro.<br>Redirigiendo a la aplicación...</p>
        <span class="badge">Seguro y Cifrado</span><br>
        <a href="schooltracker://" class="btn">Volver a la App</a>
    </div>
    <script>setTimeout(function(){window.location.href="schooltracker://";window.close();},500);</script>
</body>
</html>"#;
        
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.flush().await;
    }
    
    if code.is_empty() {
        return Err("No se recibió ningún código de autorización de Google.".to_string());
    }
    
    Ok(code)
}

// Solo se usan en la rama WebView de `gd_open_auth_webview`, que compila solo
// en macOS: en Android, Linux y Windows el login va por navegador del sistema y
// el código lo captura el servidor TCP. Sin el allow, `cargo check` en las demás
// plataformas las marca como dead code.
#[allow(dead_code)]
fn extract_oauth_code_from_url(raw_url: &str) -> Option<String> {
    if let Ok(parsed) = url::Url::parse(raw_url) {
        for (key, value) in parsed.query_pairs() {
            if key == "code" && !value.is_empty() {
                return Some(value.into_owned());
            }
        }
    }
    None
}

fn extract_oauth_port_from_auth_url(auth_url: &str) -> u16 {
    if let Ok(parsed) = url::Url::parse(auth_url) {
        for (key, value) in parsed.query_pairs() {
            if key == "redirect_uri" {
                if let Ok(redirect) = url::Url::parse(&value) {
                    if let Some(port) = redirect.port() {
                        return port;
                    }
                }
            }
        }
    }
    51733
}

/// Lee el parametro `error=` de una URL de callback de Google.
///
/// Valores tipicos: `access_denied` (el usuario cerro o Google's bloquea),
/// `redirect_uri_mismatch`, `invalid_client`, `invalid_scope`, o
/// `disallowed_useragent` (login dentro de una WebView embebida, que es
/// exactamente lo que pasó en Linux antes de usar el navegador del sistema).
#[allow(dead_code)]
fn extract_oauth_error_from_url(raw_url: &str) -> Option<String> {
    if let Ok(parsed) = url::Url::parse(raw_url) {
        for (key, value) in parsed.query_pairs() {
            if key == "error" {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[allow(dead_code)]
fn is_localhost_oauth_callback(raw_url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(raw_url) {
        let host = parsed.host_str().unwrap_or("");
        return (host == "localhost" || host == "127.0.0.1") && parsed.path().contains("callback");
    }
    false
}

/// Pide que la ventana principal vuelva al frente, **sin bloquear** al
/// llamador.
///
/// Hace falta porque el login de Google ocurre en el NAVEGADOR DEL SISTEMA
/// (Windows, Linux y el fallback de Android): al abrirlo, el SO le roba el
/// foco a la app, y cuando el servidor TCP recibe el `code` el usuario sigue
/// mirando el navegador —que solo muestra "Ya podés cerrar esta pestana"— y
/// tiene que ir a buscar el ícono en la barra de tareas a mano.
///
/// ⚠️ **Por qué un hilo propio y no `async_runtime::spawn`**: los métodos de
/// ventana de Tauri (`is_minimized`, `set_focus`, `set_always_on_top`, …) son
/// round-trips **síncronos** al event loop del SO: bloquean el hilo que los
/// llama hasta que el loop responde. Con `async_runtime::spawn` esos round-trips
/// ocupan un **worker de tokio**, que es el mismo runtime donde corren los
/// comandos `async` (`d1_sync_all`, `gd_snapshot_db`, …): si se quedan esperando,
/// el worker no vuelve nunca y el runtime termina sin workers, colgando el app
/// entera. Con `std::thread::spawn` un hilo colgado no cuesta nada crítico.
///
/// (La primera versión llamaba a `traer_app_al_frente` DIRECTO desde
/// `gd_open_auth_webview`, con el mutex `oauth_code_state` tomado: el comando no
/// retornaba, el `invoke` no resolvía y el WelcomePage quedaba girando para
/// siempre.)
fn devolver_el_foco(app: &tauri::AppHandle, motivo: &str) {
    let app = app.clone();
    let motivo = motivo.to_string();
    // ⚠️ `std::thread::spawn` y NO `tauri::async_runtime::spawn`. Este último
    // corre sobre un worker de tokio, y los comandos `async` de Tauri (que es lo
    // que son `d1_sync_all`, `gd_snapshot_db`, etc.) se ejecutan en ESE MISMO
    // runtime. Si las llamadas de ventana se quedan esperando al event loop del
    // SO, el worker no vuelve nunca y cada login bloqueado consumes uno: a los
    // pocos, el runtime se queda sin workers y todo comando async se cuelga
    // (el síntoma era "el spinner nunca termina y hay que reintentar"). Un hilo
    // dedicado que se cuelgue no cuesta nada crítico.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(120));
        traer_app_al_frente(&app, &motivo);
    });
}

/// Trae la ventana principal al frente: la restaura si estaba minimizada, la
/// muestra si estaba oculta y le da el foco.
///
/// Detalle de Windows: `SetForegroundWindow` está restringido a procesos que no
/// tienen el foco, así que `set_focus()` solo puede no alcanzar. El truco de
/// `always_on_top` true → false fuerza a Windows a traer la ventana adelante (es
/// lo que hacen los lanzadores y los Toasts). Va en su propio `#[cfg]` para no
/// tocar el comportamiento de Linux/macOS.
fn traer_app_al_frente(app: &tauri::AppHandle, motivo: &str) {
    let Some(win) = app.get_webview_window("main") else {
        println!("[OAuth] ventana 'main' no encontrada; no se puede traer al frente");
        return;
    };

    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    if !win.is_visible().unwrap_or(true) {
        let _ = win.show();
    }
    let _ = win.set_focus();

    #[cfg(target_os = "windows")]
    {
        // always_on_top(true) y de inmediato (false): el primer aviso la levanta
        // por encima del navegador, el segundo la devuelve a su z-order normal.
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
        let _ = win.set_always_on_top(false);
    }

    println!("[OAuth] ventana principal traida al frente ({})", motivo);
}

/// Inicia el login OAuth de Google y devuelve el `code` de autorización.
///
/// A pesar del nombre (histórico, cuando todas las plataformas de escritorio
/// usaban WebView embebida), en **Android, Linux y Windows abre el navegador
/// del sistema** y el código lo captura el servidor TCP local. Solo macOS crea
/// una ventana WebView embebida.
///
/// El nombre del comando se mantiene porque está referenciado en
/// `permissions/local-commands.toml` y en los dos call sites del frontend
/// (`CloudPage.svelte` y `lib/cloudLogin.ts`, que usa `WelcomePage`).
#[tauri::command]
async fn gd_open_auth_webview(
    app: tauri::AppHandle,
    url: String,
    browser: Option<String>,
) -> Result<String, String> {
    let port = extract_oauth_port_from_auth_url(&url);
    *oauth_code_state().lock().map_err(|e| e.to_string())? = None;
    oauth_cancel_flag().store(false, Ordering::SeqCst);
    gd_start_oauth_background(app.clone(), port).await?;

    // ── Android, Linux y Windows: navegador del SISTEMA + polling del TCP ──
    //
    // En Linux el WebView embebido (WebKitGTK) NO sirve: Google bloquea el
    // login en user-agents embebidos y responde "Something went wrong". El
    // `client_id` y el `redirect_uri` son correctos (verificado con curl: la
    // misma URL devuelve 302 a la pantalla de login), así que el problema es la
    // WebView, no la configuración. En Windows el WebView2 embebido tiene el
    // mismo problema de user agent, y además NO comparte la sesión de Google
    // del navegador, así que el usuario tenía que re-ingresar sus credenciales.
    //
    // El navegador real además es mejor UX: ya tiene la sesión de Google abierta
    // y no hay que re-ingresar. El código lo captura el servidor TCP que ya se
    // arrancó arriba (`gd_start_oauth_background`), igual que en Android.
    //
    // Solo queda macOS con la WebView embebida (WebKit del sistema, donde Google
    // sí acepta el login).
    #[cfg(any(target_os = "android", target_os = "linux", target_os = "windows"))]
    {
        if let Err(e) = gd_open_url_browser(app.clone(), url.clone(), browser.clone()).await {
            return Err(format!("No se pudo abrir el navegador del sistema: {}", e));
        }

        // 300s (1500 x 200ms). Con navegador real el usuario puede tener que
        // escribir su contraseña o pasar el 2FA, y eso tarda bastante más que
        // completar la pantalla de consentimiento.
        for _ in 0..1500 {
            if oauth_cancel_flag().load(Ordering::SeqCst) {
                oauth_cancel_flag().store(false, Ordering::SeqCst);
                devolver_el_foco(&app, "cancelado");
                return Err("Autenticación cancelada".to_string());
            }
            // El `take()` se hace en un bloque propio para SOLTAR el mutex antes
            // de tocar la ventana. Las operaciones de ventana de Tauri son
            // round-trips sincrónicos al event loop del SO: hacerlas con el lock
            // tomado bloquearía al servidor TCP y a `gd_wait_oauth_code`, que
            // compiten por el mismo mutex.
            let maybe_code = {
                let mut guard = oauth_code_state().lock().map_err(|e| e.to_string())?;
                guard.take()
            };
            if let Some(code) = maybe_code {
                println!("[OAuth] Código recibido via servidor TCP!");
                devolver_el_foco(&app, "código recibido");
                return Ok(code);
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        println!("[OAuth] tiempo de espera agotado");
        devolver_el_foco(&app, "timeout");
        return Err("Tiempo de espera agotado (¿se completó el login en el navegador?)".to_string());
    }

    // Solo macOS queda con WebView embebido
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<String>();

        let parsed_url = url::Url::parse(&url)
            .map_err(|e| format!("URL inválida: {}", e))?;

        // Cerrar ventana previa si quedó abierta de un intento anterior
        if let Some(existing) = app.get_webview_window("google-auth") {
            let _ = existing.close();
        }

        let window = tauri::WebviewWindowBuilder::new(
            &app,
            "google-auth",
            tauri::WebviewUrl::External(parsed_url),
        )
        .title("Iniciar sesión con Google")
        .inner_size(700.0, 620.0)
        .center()
        .resizable(false)
        .on_navigation(move |nav_url| {
            let s = nav_url.as_str();
            println!("[OAuth] WebView navigation: {}", &s[..s.len().min(150)]);

            // Diagnóstico: Google responde con "?error=<motivo>" cuando rechaza
            // el login ("Something went wrong" en la ventana). Sin esto el
            // usuario solo ve la pantalla de error de Google y no sabemos si es
            // redirect_uri_mismatch, disallowed_useragent o lo que sea.
            if let Some(err) = extract_oauth_error_from_url(s) {
                eprintln!("[OAuth] Google devolvio un error: {}", err);
            }

            if let Some(code) = extract_oauth_code_from_url(s) {
                println!("[OAuth] Code extracted via WebView (len={})", code.len());
                let _ = tx.send(code);
                if is_localhost_oauth_callback(s) {
                    return true;
                }
                return false;
            }

            true
        })
        .build()
        .map_err(|e| format!("Error al crear ventana: {}", e))?;

        for _ in 0..600 {
            if oauth_cancel_flag().load(Ordering::SeqCst) {
                let _ = window.close();
                oauth_cancel_flag().store(false, Ordering::SeqCst);
                return Err("Autenticación cancelada".to_string());
            }
            match rx.try_recv() {
                Ok(code) => {
                    println!("[OAuth] Code received via channel, closing WebView");
                    let _ = window.close();
                    if let Ok(mut guard) = oauth_code_state().lock() {
                        *guard = Some(code.clone());
                    }
                    return Ok(code);
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {}
            }
            {
                let mut guard = oauth_code_state().lock().map_err(|e| e.to_string())?;
                if let Some(code) = guard.take() {
                    println!("[OAuth] Code received via TCP server, closing WebView");
                    let _ = window.close();
                    return Ok(code);
                }
            }
            if app.get_webview_window("google-auth").is_none() {
                println!("[OAuth] Window closed by user");
                return Err("Autenticación cancelada".to_string());
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        let _ = window.close();
        Err("Tiempo de espera agotado".to_string())
    }
}

// ── OAuth: estado global y cancelación ──
use std::sync::OnceLock;

fn oauth_code_state() -> &'static std::sync::Mutex<Option<String>> {
    static STATE: OnceLock<std::sync::Mutex<Option<String>>> = OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(None))
}
fn oauth_cancel_flag() -> &'static AtomicBool {
    static FLAG: OnceLock<AtomicBool> = OnceLock::new();
    FLAG.get_or_init(|| AtomicBool::new(false))
}

#[tauri::command]
async fn gd_start_oauth_background(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    println!("[OAuth] gd_start_oauth_background called, port={}", port);
    *oauth_code_state().lock().map_err(|e| e.to_string())? = None;
    oauth_cancel_flag().store(false, Ordering::SeqCst);

    // Servidor arrancado una sola vez; si el bind falla se resetea el flag para
    // permitir un reintento en la próxima llamada (evita "envenenar" el estado).
    static SERVER_STARTED: AtomicBool = AtomicBool::new(false);
    if SERVER_STARTED.load(Ordering::SeqCst) {
        println!("[OAuth] TCP server already running");
        return Ok(());
    }
    if SERVER_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let handle = app;
    tokio::spawn(async move {
        use tokio::net::TcpListener;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let addr = format!("127.0.0.1:{}", port);
        println!("[OAuth] Binding TCP server to {}", addr);
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => { println!("[OAuth] TCP server bound OK"); l }
            Err(e) => {
                eprintln!("[OAuth] TCP server bind error: {}", e);
                // Permitir reintento en el próximo intento de login
                SERVER_STARTED.store(false, Ordering::SeqCst);
                return;
            }
        };

        loop {
                println!("[OAuth] Waiting for TCP connection...");
                match listener.accept().await {
                    Ok((mut socket, peer)) => {
                        println!("[OAuth] Accepted connection from {}", peer);
                        if oauth_cancel_flag().load(Ordering::SeqCst) {
                            println!("[OAuth] Cancelled, skipping connection");
                            continue;
                        }
                        let mut buffer = [0; 2048];
                        let size = match socket.read(&mut buffer).await {
                            Ok(s) => s,
                            Err(e) => { eprintln!("[OAuth] Read error: {}", e); continue; }
                        };
                        println!("[OAuth] Read {} bytes from socket", size);
                        let request = String::from_utf8_lossy(&buffer[..size]).into_owned();
                        println!("[OAuth] Request: {}", &request[..request.len().min(200)]);

                        let mut code = String::new();
                        if let Some(pos) = request.find("code=") {
                            let start = pos + 5;
                            let end = request[start..]
                                .find(|c: char| c == ' ' || c == '&')
                                .map(|p| start + p)
                                .unwrap_or(request.len());
                            if start < end {
                                code = request[start..end].to_string();
                            }
                        }

                        if !code.is_empty() {
                            println!("[OAuth] Code extracted (len={})", code.len());
                            if let Ok(mut guard) = oauth_code_state().lock() {
                                *guard = Some(code.clone());
                                println!("[OAuth] Code stored in global state");
                            }
                            let _ = handle.emit("google-auth-code", code.clone());
                        } else {
                            println!("[OAuth] No code found in request");
                        }

                        // El scheme `schooltracker-auth://` SOLO esta registrado en el
                        // AndroidManifest. En Linux/Windows/macOS el navegador no lo
                        // conoce y, tras el login, mostraria una pagina de error
                        // "no hay aplicacion asociada". Ahi se responde con un cierre
                        // limpio sin redireccion. El codigo YA quedo guardado en
                        // `oauth_code_state()`, asi que la app lo recupera igual por
                        // polling o por el evento `google-auth-code`.
                        #[cfg(target_os = "android")]
                        let callback_url = format!(
                            "schooltracker-auth://callback?code={}",
                            url::form_urlencoded::byte_serialize(code.as_bytes()).collect::<String>()
                        );
                        #[cfg(not(target_os = "android"))]
                        let callback_url = String::new();

                        // Texto y auto-redireccion segun plataforma.
                        #[cfg(target_os = "android")]
                        let (subtitulo, auto_redirect) = (
                            "Redirigiendo a la aplicacion...",
                            "<script>setTimeout(function(){window.location.href=\"__CALLBACK_URL__\";window.close();},500);</script>",
                        );
                        #[cfg(not(target_os = "android"))]
                        let (subtitulo, auto_redirect) = (
                            "Ya podes cerrar esta pestana y volver a la aplicacion.",
                            "",
                        );
                        // El boton "Volver a la App" solo tiene sentido en Android,
                        // donde el scheme abre la app. En desktop molestaria.
                        #[cfg(target_os = "android")]
                        let boton_volver = format!(
                            "<a href=\"{}\" class=\"btn\">Volver a la App</a>",
                            callback_url
                        );
                        #[cfg(not(target_os = "android"))]
                        let boton_volver = String::new();

                        let html = r#"<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Conectado</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;font-family:system-ui,sans-serif}.card{background:rgba(30,41,59,.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:3rem 2.5rem;text-align:center;max-width:420px;width:90%;animation:slideUp .6s ease-out}@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}.check{width:80px;height:80px;margin:0 auto 1.5rem;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(16,185,129,.4)}h1{color:#f8fafc;font-size:1.5rem;font-weight:700;margin:0 0 1rem}p{color:#94a3b8;font-size:.9rem;line-height:1.6;margin:0 0 1.5rem}a.btn{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:10px 24px;border-radius:12px;font-weight:600;transition:background 0.2s}a.btn:hover{background:#2563eb}</style></head><body><div class="card"><div class="check"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="4 12 9 17 20 6"/></svg></div><h1>Conectado a Google Drive</h1><p>__SUBTITULO__</p>__AUTO_REDIRECT__</div>__AUTO_REDIRECT_SCRIPT__</body></html>"#
                            .replace("__CALLBACK_URL__", &callback_url)
                            .replace("__SUBTITULO__", subtitulo)
                            .replace("__AUTO_REDIRECT__", &boton_volver)
                            .replace("__AUTO_REDIRECT_SCRIPT__", auto_redirect);
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.len(), html
                        );
                        let _ = socket.write_all(response.as_bytes()).await;
                        let _ = socket.flush().await;
                        println!("[OAuth] Response sent to browser");
                    }
                    Err(e) => {
                        eprintln!("[OAuth] Accept error: {}", e);
                    }
                }
            }
        });

    Ok(())
}

#[tauri::command]
async fn gd_wait_oauth_code(app: tauri::AppHandle, timeout_secs: u64) -> Result<String, String> {
    println!("[OAuth] gd_wait_oauth_code called, timeout={}s", timeout_secs);
    let state = oauth_code_state();
    let max_polls = timeout_secs * 5;
    for i in 0..max_polls {
        if oauth_cancel_flag().load(Ordering::SeqCst) {
            println!("[OAuth] Cancelled flag detected, returning");
            *state.lock().map_err(|e| e.to_string())? = None;
            devolver_el_foco(&app, "cancelado (polling de respaldo)");
            return Err("Autenticación cancelada".to_string());
        }
        let maybe_code = {
            let mut guard = state.lock().map_err(|e| e.to_string())?;
            guard.take()
        };
        if let Some(code) = maybe_code {
            println!("[OAuth] Code found in state, returning (len={})", code.len());
            // Mismo motivo que en `gd_open_auth_webview`: el código llegó desde el
            // navegador, hay que devolverle el foco a la app.
            devolver_el_foco(&app, "código recibido (polling de respaldo)");
            return Ok(code);
        }
        if i % 25 == 0 {
            println!("[OAuth] Waiting for code... (poll {}/{})", i, max_polls);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    println!("[OAuth] Timeout reached");
    devolver_el_foco(&app, "timeout (polling de respaldo)");
    Err("Tiempo de espera agotado".to_string())
}

#[tauri::command]
async fn gd_has_pending_oauth_code() -> Result<bool, String> {
    let guard = oauth_code_state().lock().map_err(|e| e.to_string())?;
    let has = guard.is_some();
    println!("[OAuth] gd_has_pending_oauth_code = {}", has);
    Ok(has)
}

#[tauri::command]
async fn gd_cancel_oauth() -> Result<(), String> {
    println!("[OAuth] gd_cancel_oauth called");
    oauth_cancel_flag().store(true, Ordering::SeqCst);
    *oauth_code_state().lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Snapshot consistente de la base ACTIVA, escrito en el directorio temporal
/// del sistema y con nombre FIJO (se sobrescribe en cada llamada).
///
/// Reemplaza a `gd_create_backup` para el uso frecuente de sincronización:
/// ese comando creaba un `backups/backup_<timestamp>.db` POR CADA push o
/// restore, así que la carpeta de la aplicación se llenaba de copias que nadie
/// miraba. Al vivir en TEMP y con nombre fijo no se acumula nada.
///
/// Existe además una razón funcional para copiar antes de leer: la app tiene el
/// SQLite abierto, y leer el archivo vivo mientras se escribe puede producir un
/// snapshot inconsistente. La copia es Point-in-Time y se sube esa.
#[tauri::command]
async fn gd_snapshot_db(app_handle: tauri::AppHandle, state: tauri::State<'_, DbState>) -> Result<String, String> {
    use std::fs;

    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let db_path = db::resolve_active_db_path(&app_data_dir);
    if !db_path.exists() {
        return Err("Database file not found".to_string());
    }

    let tmp_dir = std::env::temp_dir().join("schooltracker");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let snap = tmp_dir.join("snapshot.db");

    // Se hace el checkpoint y la copia con el lock tomado. Sin esto, en modo
    // WAL los datos confirmados siguen en `school.db-wal` y la copia del `.db`
    // saldría incompleta: el respaldo a Drive perdería los últimos cambios sin
    // avisar. `TRUNCATE` además deja el `-wal` en 0 bytes.
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        match conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        }) {
            Ok((busy, written, moved)) => {
                if busy == 0 {
                    println!("[Snapshot] WAL checkpoint: {} frames volcados, {} movidos", written, moved);
                }
            }
            Err(e) => println!("[Snapshot] sin checkpoint (base no está en WAL): {}", e),
        }
        fs::copy(&db_path, &snap).map_err(|e| format!("Failed to snapshot database: {}", e))?;
    }
    Ok(snap.to_string_lossy().into_owned())
}

/// Copia de seguridad de la base activa en `backups/backup_<timestamp>.db`.
///
/// Ya NO se usa para el ciclo de sincronización (ver `gd_snapshot_db`); queda
/// como utilidad manual para dejar una copia explícita antes de tocar la base.
#[tauri::command]
async fn gd_create_backup(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    use chrono::Local;
    
    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let db_path = db::resolve_active_db_path(&app_data_dir);

    if !db_path.exists() {
        return Err("Database file not found".to_string());
    }
    
    let backups_dir = app_data_dir.join("backups");
    if !backups_dir.exists() {
        fs::create_dir_all(&backups_dir).map_err(|e| format!("Failed to create backups dir: {}", e))?;
    }
    
    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S");
    let dest_path = backups_dir.join(format!("backup_{}.db", timestamp));
    
    fs::copy(&db_path, &dest_path).map_err(|e| format!("Failed to copy database: {}", e))?;
    Ok(dest_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn gd_get_backups(app_handle: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    use std::fs;
    
    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let backups_dir = app_data_dir.join("backups");
    let mut backups = Vec::new();
    
    if !backups_dir.exists() {
        return Ok(backups);
    }
    
    if let Ok(entries) = fs::read_dir(backups_dir) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let path = entry.path();
                    if let Some(ext) = path.extension() {
                        if ext == "db" {
                            let created_at = if let Ok(time) = metadata.created() {
                                let datetime: chrono::DateTime<chrono::Local> = time.into();
                                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                            } else { "Unknown".to_string() };
                            
                            backups.push(serde_json::json!({
                                "name": entry.file_name().to_string_lossy().into_owned(),
                                "path": path.to_string_lossy().into_owned(),
                                "size": metadata.len(),
                                "created_at": created_at
                            }));
                        }
                    }
                }
            }
        }
    }
    
    backups.sort_by(|a, b| b["created_at"].as_str().unwrap_or("").cmp(a["created_at"].as_str().unwrap_or("")));
    Ok(backups)
}

#[tauri::command]
async fn gd_delete_backup(path: String) -> Result<(), String> {
    use std::fs;
    let backup_path = std::path::PathBuf::from(path);
    if backup_path.exists() {
        fs::remove_file(&backup_path).map_err(|e| format!("Failed to delete backup: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn gd_import_db_from_file(app_handle: tauri::AppHandle, state: tauri::State<'_, DbState>, source_path: String) -> Result<String, String> {
    use std::fs;
    
    let import_path = std::path::PathBuf::from(&source_path);
    if !import_path.exists() {
        return Err("El archivo especificado no existe".to_string());
    }
    if !import_path.is_file() {
        return Err("La ruta especificada no es un archivo".to_string());
    }
    match import_path.extension() {
        Some(ext) if ext == "db" => {},
        _ => return Err("El archivo debe tener extensión .db".to_string()),
    }
    
    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let db_path = db::resolve_active_db_path(&app_data_dir);

    let backups_dir = app_data_dir.join("backups");
    if !backups_dir.exists() { fs::create_dir_all(&backups_dir).ok(); }
    let safety_backup = backups_dir.join(format!("safety_before_import_{}.db", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
    let _ = fs::copy(&db_path, &safety_backup);
    
    fs::copy(&import_path, &db_path).map_err(|e| format!("Failed to import database: {}", e))?;

    // Excluir la tabla d1_config (school_key / device_id) del archivo importado:
    // así se conservan los DATOS pero NO la identidad de nube del dispositivo
    // origen (que podría contaminar este dispositivo). La nube se relinka a
    // continuación vía Google (handleCloudLogin). Se reabre la conexión del
    // estado sobre el archivo ya reemplazado.
    {
        let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
        *conn = Connection::open(&db_path).map_err(|e| format!("Failed to reopen imported database: {}", e))?;
        conn.execute("DROP TABLE IF EXISTS d1_config", [])
            .map_err(|e| format!("Failed to exclude d1_config from import: {}", e))?;
        // El archivo importado puede venir de una versión anterior de la app
        // (sin colegio_grado, dia_sin_clases, columna tipo, etc.). Correr
        // init_database aquí garantiza schema + migraciones al día ANTES de que
        // cualquier sync (D1) o página intente usar tablas que aún no existen.
        db::init_database(&*conn).map_err(|e| format!("Failed to migrate imported database: {}", e))?;
    }

    Ok(db_path.to_string_lossy().into_owned())
}

/// Abre (o crea) la base de datos local de una cuenta de Google concreta y la
/// convierte en la BD activa del proceso, SIN destruir ninguna otra cuenta.
/// En la primera conexión de la instalación, si existe la BD por defecto
/// (school.db) y aún no hay ninguna cuenta con archivo propio, se migra dicha
/// BD a la cuenta para no perder los datos previos del único profesor.
#[tauri::command]
async fn open_account_db(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    email: String,
    migrate_from_default: bool,
) -> Result<String, String> {
    use std::fs;
    let app_dir = get_profile_app_dir(&app_handle)?;
    let email = email.trim().to_lowercase();
    if email.is_empty() {
        return Err("email de cuenta vacío".to_string());
    }
    let target = db::account_db_path(&app_dir, &email);

    // ¿Hay que migrar la BD por defecto (school.db) a la cuenta? Solo la primera
    // vez y si aún no existe ningún archivo de cuenta.
    let needs_migrate = !target.exists() && {
        let default = app_dir.join("school.db");
        let ya_hay_cuenta = fs::read_dir(&app_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .any(|e| {
                        let n = e.file_name().to_string_lossy().to_string();
                        n.starts_with("school_") && n.ends_with(".db")
                    })
            })
            .unwrap_or(false);
        default.exists() && migrate_from_default && !ya_hay_cuenta
    };

    // Abrir/reemplazar la conexión activa. Si vamos a mover school.db, primero
    // soltamos el handle abierto (lo cambiamos por una BD en memoria) para poder
    // renombrar el archivo en Windows sin el error "file used by another process".
    // Se mantiene el lock durante toda la operación para evitar una condición de
    // carrera con otros comandos.
    {
        let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
        if needs_migrate {
            *conn = Connection::open_in_memory()
                .map_err(|e| format!("No se pudo liberar la BD actual: {}", e))?;
            let default = app_dir.join("school.db");
            fs::rename(&default, &target)
                .map_err(|e| format!("No se pudo migrar la BD por defecto: {}", e))?;
        }
        let new_conn = Connection::open(&target)
            .map_err(|e| format!("No se pudo abrir la BD de la cuenta: {}", e))?;
        db::init_database(&new_conn).map_err(|e| e.to_string())?;
        *conn = new_conn;
    }
    db::write_active_account(&app_dir, &email)?;
    Ok(target.to_string_lossy().into_owned())
}

/// Copia de seguridad de la BD local antes de un "cambio de profesor" destructivo,
/// para poder recuperar si el restore desde la nube falla. Devuelve la ruta del backup.
#[tauri::command]
async fn create_switch_backup(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let db_path = db::resolve_active_db_path(&app_data_dir);
    if !db_path.exists() {
        return Err("No existe la base de datos para respaldar".to_string());
    }
    let backups_dir = app_data_dir.join("backups");
    if !backups_dir.exists() {
        fs::create_dir_all(&backups_dir).map_err(|e| format!("Failed to create backups dir: {}", e))?;
    }
    let backup = backups_dir.join(format!("switch_backup_{}.db", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
    fs::copy(&db_path, &backup).map_err(|e| format!("Failed to create switch backup: {}", e))?;
    Ok(backup.to_string_lossy().into_owned())
}

/// Restaura la BD local desde un respaldo de seguridad (p. ej. el creado al
/// cambiar de profesor) SIN tocar d1_config, para poder volver al estado previo
/// si un restore desde la nube falla. No borra la tabla d1_config (a diferencia
/// de gd_import_db_from_file), así la cuenta saliente queda intacta.
#[tauri::command]
async fn restore_switch_backup_db(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
    use std::fs;
    let import_path = std::path::PathBuf::from(&source_path);
    if !import_path.exists() {
        return Err("El respaldo especificado no existe".to_string());
    }
    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let db_path = db::resolve_active_db_path(&app_data_dir);
    fs::copy(&import_path, &db_path).map_err(|e| format!("Failed to restore backup: {}", e))?;
    Ok(db_path.to_string_lossy().into_owned())
}

/// Lee la school_key actualmente configurada en la BD local (antes de que se
/// limpie), para poder reusarla al importar un respaldo .db en lugar de
/// depender de /auth (que puede devolver una clave distinta a donde están los datos).
#[tauri::command]
async fn get_current_school_key(state: tauri::State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let key: Option<String> = conn
        .query_row("SELECT school_key FROM d1_config WHERE id = 1", [], |r| r.get(0))
        .ok();
    Ok(key)
}

fn get_profile_app_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    match std::env::var("SCHOOLTRACKER_PROFILE") {
        Ok(p) if !p.is_empty() => {
            let dir = app_dir.join(p);
            std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create profile dir: {}", e))?;
            Ok(dir)
        }
        _ => {
            std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
            Ok(app_dir)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init());

    // F12 abre/cierra DevTools (WebView2 en Windows no registra F12 por defecto)
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    println!("[Shortcuts] evento F12 recibido (estado: {:?})", event.state());
                    if event.state() == ShortcutState::Pressed {
                        if let Some(webview) = app.get_webview_window("main") {
                            if webview.is_devtools_open() {
                                let _ = webview.close_devtools();
                                println!("[Shortcuts] DevTools cerrados");
                            } else {
                                webview.open_devtools();
                                println!("[Shortcuts] DevTools abiertos");
                            }
                        } else {
                            println!("[Shortcuts] ventana 'main' no encontrada");
                        }
                    }
                })
                .build(),
        );
    }

    builder
        .setup(|app| {
            // Registro tolerante con cadena de respaldo: si otra app del sistema
            // ya retiene una tecla, se prueba la siguiente de la lista.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt as _;
                let candidatos = ["F11", "Ctrl+Alt+F12", "F12"];
                let mut registrado = String::new();
                for c in candidatos {
                    match app.global_shortcut().register(c) {
                        Ok(_) => {
                            println!("[Shortcuts] '{c}' -> DevTools registrado");
                            registrado = c.to_string();
                            break;
                        }
                        Err(e) => println!("[Shortcuts] '{c}' ocupado: {e}"),
                    }
                }
                if registrado.is_empty() {
                    println!("[Shortcuts] Ningun atajo disponible; alternativa: clic derecho > Inspeccionar");
                }
            }
            let app_handle = app.handle().clone();
            let app_dir = get_profile_app_dir(&app_handle).expect("Failed to get profile dir");
            let db_path = if let Some(email) = db::read_active_account(&app_dir) {
                let p = db::account_db_path(&app_dir, &email);
                if p.exists() { p } else { app_dir.join("school.db") }
            } else {
                app_dir.join("school.db")
            };
            let conn = Connection::open(db_path).expect("Failed to open database");
            // Modo WAL explícito: la app lee desde el WebView mientras el motor
            // de sync escribe por detrás, y en modo `delete` un guardado bloquea
            // a todos los lectores. OJO: en WAL los datos confirmados viven en
            // `school.db-wal` hasta el checkpoint, por eso `gd_snapshot_db`
            // hace `wal_checkpoint(TRUNCATE)` antes de copiar el `.db`.
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            let _ = conn.pragma_update(None, "synchronous", "FULL");
            db::init_database(&conn).expect("Failed to initialize database");
            app_handle.manage(DbState {
                conn: Arc::new(Mutex::new(conn)),
            });

            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_folder_and_save_file,
            get_anos,
            add_ano,
            update_ano,
            delete_ano,
            set_active_ano,
            get_cortes,
            add_corte,
            update_corte,
            delete_corte,
            set_active_corte,
            get_colegios,
            add_colegio,
update_colegio,
      delete_colegio,
      update_colegio_order,
            get_asignaturas,
            add_asignatura,
            update_asignatura,
            delete_asignatura,
            get_grados,
            add_grado,
            update_grado,
            delete_grado,
            get_secciones,
            add_seccion,
            update_seccion,
            delete_seccion,
            get_students,
            add_student,
            update_student,
            delete_student,
            delete_student_batch,
            get_subjects_by_grade,
            assign_subject_to_grade,
            unassign_subject_from_grade,
            assign_all_subjects_to_grade,
            unassign_all_subjects_from_grade,
            get_subjects_by_colegio,
            get_all_subjects,
            assign_subject_to_colegio,
            unassign_subject_from_colegio,
            assign_all_subjects_to_colegio,
            unassign_all_subjects_from_colegio,
            get_grados_config_by_colegio,
            set_colegio_grado,
            delete_colegio_grado,
            get_evaluation_config,
        update_indicador,
        get_indicadores_activos_colegio_seccion,
        set_indicador_colegio_seccion_activo,
        reset_indicadores_colegio_seccion,
        vaciar_notas_indicador,
        update_criterio,
        delete_criterio,

            get_estudiantes_by_filters,
            save_notas_estudiantes,
            delete_notas,
            get_notas_by_filters,
            get_pcts_por_corte,
            get_db_path,
            open_account_db,
            get_grade_configs,
            update_grade_config,
            get_multiplicadores,
            update_multiplicador,
            get_asistencia_estudiantes,
            get_asistencia_estudiantes_rango,
            save_asistencia,
            get_asistencia_rango,
            delete_asistencia_rango,
            get_asistencia_all,
            get_colegio_dias_asistencia,
            save_colegio_dias_asistencia,
            get_dias_sin_clases,
            set_dias_sin_clases,
            set_orientation,
            check_category_dependencies,
            delete_category_force,
            delete_category_force_batch,
            get_indicadores_all,
            get_criterios_all,
            get_notas_all,
            get_student_impact,
            reset_local_database,
            reset_profile_account,
            seed_defaults_now,
            get_grados_by_colegio,
            get_secciones_by_grado_colegio,
            get_colegio_dias_asistencia_all,
            get_grado_asignatura,
            get_colegio_asignatura,
            delete_asistencia_batch,
            get_pending_deletions,
            remove_pending_deletion,
            remove_pending_deletion_by_record,
            clear_synced_deletions,
            get_recommended_colegio,
            get_schema_sql,
            get_all_local_data_json,
            get_all_local_data_since,
            has_local_changes,
            // Nuevas funciones para tablas con claves compuestas
            get_pending_deletions_asistencia,
            remove_pending_deletion_asistencia,
            get_pending_deletions_nota,
            remove_pending_deletion_nota,
            get_pending_deletions_grado_asignatura,
            remove_pending_deletion_grado_asignatura,
            get_pending_deletions_colegio_asignatura,
            remove_pending_deletion_colegio_asignatura,
            get_pending_deletions_colegio_grado,
            remove_pending_deletion_colegio_grado,
            delete_record_local,
            print_pdf,
        share_pdf,
        save_file_android,
        guardar_en_descargas,
    run_local_backup,
    set_local_backup_config,

            gd_read_file_base64,
            gd_write_file_base64,
            gd_reload_database,
            gd_open_url_browser,
            gd_resolve_browser,
            gd_start_oauth_server,
            gd_open_auth_webview,
            gd_start_oauth_background,
            gd_wait_oauth_code,
            gd_has_pending_oauth_code,
            gd_cancel_oauth,
    gd_snapshot_db,
    desvincular_cuenta,
    gd_create_backup,
    gd_get_backups,

            gd_delete_backup,
            gd_import_db_from_file,
            create_switch_backup,
            restore_switch_backup_db,
            get_current_school_key,
            get_dashboard_stats,
            get_dashboard_detalle,
            get_grados_secciones_sin_asistencia_hoy,
            get_pendientes_asistencia_filtrados,
            notify_attendance_reminder,
            schedule_attendance_alarm,
            cancel_attendance_alarm,
            get_attendance_silenced_today,
            set_attendance_silenced_today,
            dismiss_attendance_today,
            gd_start_native_signin,
            gd_request_notification_permission,
            gd_take_last_native_result,
            gd_battery_status,
    attendance_get_ringtone,
    attendance_pick_ringtone,
    attendance_reset_ringtone,
            gd_show_notification,
            get_monthly_attendance_pct,
            get_seed_options,
            seed_selected_data,
            is_app_initialized,
            set_app_initialized,
            factory_reset,
            get_notas_count,
            get_notas_count_all,
            d1_get_config,
            d1_save_config,
            d1_clear_config,
            d1_reset_device_id,
            d1_remote_stats,
            contar_filas_sincronizables,
            d1_status,
            d1_sync_all,
            d1_wipe_remote,
            d1_reset_remote,
            d1_restore_from_cloud,
            d1_reserve_ids,
            promote_students,
            get_secundaria_colegios,
            get_app_settings,
            set_app_settings,
            migrate_settings_from_localstorage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
#[allow(non_snake_case)]
async fn delete_notas(
    state: tauri::State<'_, DbState>,
    corteEvaluativoId: i64,
    asignaturaId: i64,
    estudianteId: i64,
    criterioId: i64,
    gradoId: Option<i64>,
    seccionId: Option<i64>,
) -> Result<i64, String> {
    println!("[delete_notas] CALLED with corte={}, asig={}, est={}, crit={}, grado={}, seccion={}", corteEvaluativoId, asignaturaId, estudianteId, criterioId, gradoId.unwrap_or(0), seccionId.unwrap_or(0));
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut conditions = vec![
        "corte_evaluativo_id = ?".to_string(),
        "asignatura_id = ?".to_string(),
    ];
    let mut param_values: Vec<Box<dyn ToSql>> = Vec::new();
    param_values.push(Box::new(corteEvaluativoId));
    param_values.push(Box::new(asignaturaId));

    if estudianteId > 0 {
        conditions.push("estudiante_id = ?".to_string());
        param_values.push(Box::new(estudianteId));
    }
    if criterioId > 0 {
        conditions.push("criterio_id = ?".to_string());
        param_values.push(Box::new(criterioId));
    }
    if let (Some(gid), Some(sid)) = (gradoId, seccionId) {
        if gid > 0 && sid > 0 {
            conditions.push("estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ? AND seccion_id = ?)".to_string());
            param_values.push(Box::new(gid));
            param_values.push(Box::new(sid));
        }
    }
    let where_clause = conditions.join(" AND ");

    let param_refs: Vec<&dyn ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let select_sql = format!(
        "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE {}",
        where_clause
    );
    let mut stmt = tx.prepare(&select_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut insert_stmt = tx
        .prepare(
            "INSERT OR IGNORE INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
        )
        .map_err(|e| e.to_string())?;
    for (est_id, crit_id, corte_id, asig_id) in &rows {
        insert_stmt
            .execute(params![est_id, crit_id, corte_id, asig_id])
            .map_err(|e| e.to_string())?;
    }
    drop(insert_stmt);

    let delete_sql = format!("DELETE FROM nota WHERE {}", where_clause);
    let deleted = tx
        .execute(&delete_sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted as i64)
}
