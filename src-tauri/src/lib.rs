mod db;

use db::*;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn upload_to_supabase(table: &str, data: Vec<serde_json::Value>) -> Result<(), String> {
    println!("🔄 [PUSH] Subiendo {} registros a tabla {}", data.len(), table);

    if data.is_empty() {
        println!("⚠️ [PUSH] Tabla {} está vacía, omitiendo", table);
        return Ok(());
    }

    // URL de Supabase
    let supabase_url = "https://[PROYECTO_REMOVIDO]";
    let supabase_key = "[CLAVE_REMOVIDA_ROTAR]";

    // Para cada registro, intentar insertarlo en Supabase
    for record in data {
        let url = format!("{}/rest/v1/{}", supabase_url, table);

        // Convertir el registro a string JSON
        let json_data = serde_json::to_string(&record)
            .map_err(|e| format!("Error serializando registro: {}", e))?;

        println!("🔄 [PUSH] Enviando registro a {}: {}", table, json_data);

        // Hacer POST request a Supabase
        let response = ureq::post(&url)
            .set("apikey", supabase_key)
            .set("Authorization", &format!("Bearer {}", supabase_key))
            .set("Content-Type", "application/json")
            .set("Prefer", "resolution=merge-duplicates")
            .send_string(&json_data);

        match response {
            Ok(resp) => {
                if resp.status() >= 200 && resp.status() < 300 {
                    println!("✅ [PUSH] Registro subido exitosamente a {}", table);
                } else {
                    let error_text = resp
                        .into_string()
                        .unwrap_or_else(|_| "Error desconocido".to_string());
                    println!("❌ [PUSH] Error HTTP {} al subir a {}: {}", resp.status(), table, error_text);
                    return Err(format!("Error HTTP {} al subir registro: {}", resp.status(), error_text));
                }
            }
            Err(e) => {
                println!("❌ [PUSH] Error de conexión al subir a {}: {}", table, e);
                return Err(format!("Error de conexión: {}", e));
            }
        }
    }

    println!("✅ [PUSH] Todos los registros de {} subidos exitosamente", table);
    Ok(())
}

#[tauri::command]
fn sync_push_all_to_cloud(state: tauri::State<'_, DbState>) -> Result<(), String> {
    println!("🔄 [PUSH] Iniciando subida de datos locales a Supabase");

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let user_id = match get_current_user_id(&mut conn) {
        Ok(id) => id,
        Err(_) => return Err("Usuario no autenticado".to_string()),
    };

    println!("🔄 [PUSH] User ID: {}", user_id);

    // Obtener y subir cada tabla
    let tables_data = get_all_local_data(&mut conn)?;
    println!("🔄 [PUSH] Datos obtenidos localmente: {} tablas", tables_data.len());

    for (table_name, records) in tables_data {
        if let Err(e) = upload_to_supabase(&table_name, records) {
            println!("❌ [PUSH] Error subiendo tabla {}: {}", table_name, e);
            return Err(format!("Error subiendo tabla {}: {}", table_name, e));
        }
    }

    println!("✅ [PUSH] Subida completada exitosamente");
    Ok(())
}

        // URL de Supabase
        let supabase_url = "https://[PROYECTO_REMOVIDO]";
        let supabase_key = "[CLAVE_REMOVIDA_ROTAR]";

        // Para cada registro, intentar insertarlo en Supabase
        for record in data {
            let url = format!("{}/rest/v1/{}", supabase_url, table);

            // Convertir el registro a string JSON
            let json_data = serde_json::to_string(&record)
                .map_err(|e| format!("Error serializando registro: {}", e))?;

            println!("🔄 [PUSH] Enviando registro a {}: {}", table, json_data);

            // Hacer POST request a Supabase
            let response = ureq::post(&url)
                .set("apikey", supabase_key)
                .set("Authorization", &format!("Bearer {}", supabase_key))
                .set("Content-Type", "application/json")
                .set("Prefer", "resolution=merge-duplicates") // Para manejar duplicados
                .send_string(&json_data);

            match response {
                Ok(resp) => {
                    if resp.status() >= 200 && resp.status() < 300 {
                        println!("✅ [PUSH] Registro subido exitosamente a {}", table);
                    } else {
                        let error_text = resp.into_string()
                            .unwrap_or_else(|_| "Error desconocido".to_string());
                        println!("❌ [PUSH] Error HTTP {} al subir a {}: {}", resp.status(), table, error_text);
                        return Err(format!("Error HTTP {} al subir registro: {}", resp.status(), error_text));
                    }
                }
                Err(e) => {
                    println!("❌ [PUSH] Error de conexión al subir a {}: {}", table, e);
                    return Err(format!("Error de conexión: {}", e));
                }
            }
        }

        println!("✅ [PUSH] Todos los registros de {} subidos exitosamente", table);
        Ok(())
    };

    // Obtener y subir cada tabla
    let tables_data = get_all_local_data(&mut conn)?;
    println!("🔄 [PUSH] Datos obtenidos localmente: {} tablas", tables_data.len());

    for (table_name, records) in tables_data {
        if let Err(e) = upload_to_supabase(&table_name, records) {
            println!("❌ [PUSH] Error subiendo tabla {}: {}", table_name, e);
            return Err(format!("Error subiendo tabla {}: {}", table_name, e));
        }
    }

    println!("✅ [PUSH] Subida completada exitosamente");
    Ok(())
}

        // URL de Supabase
        let supabase_url = "https://[PROYECTO_REMOVIDO]";
        let supabase_key = "[CLAVE_REMOVIDA_ROTAR]";

        // Para cada registro, intentar insertarlo en Supabase
        for record in data {
            let url = format!("{}/rest/v1/{}", supabase_url, table);

            // Convertir el registro a string JSON
            let json_data = serde_json::to_string(&record)
                .map_err(|e| format!("Error serializando registro: {}", e))?;

            println!("🔄 [PUSH] Enviando registro a {}: {}", table, json_data);

            // Hacer POST request a Supabase
            let response = ureq::post(&url)
                .set("apikey", supabase_key)
                .set("Authorization", &format!("Bearer {}", supabase_key))
                .set("Content-Type", "application/json")
                .set("Prefer", "resolution=merge-duplicates") // Para manejar duplicados
                .send_string(&json_data);

            match response {
                Ok(resp) => {
                    if resp.status() >= 200 && resp.status() < 300 {
                        println!("✅ [PUSH] Registro subido exitosamente a {}", table);
                    } else {
                        let error_text = resp
                            .into_string()
                            .unwrap_or_else(|_| "Error desconocido".to_string());
                        println!("❌ [PUSH] Error HTTP {} al subir a {}: {}", resp.status(), table, error_text);
                        return Err(format!("Error HTTP {} al subir registro: {}", resp.status(), error_text));
                    }
                }
                Err(e) => {
                    println!("❌ [PUSH] Error de conexión al subir a {}: {}", table, e);
                    return Err(format!("Error de conexión: {}", e));
                }
            }
        }

        println!("✅ [PUSH] Todos los registros de {} subidos exitosamente", table);
        Ok(())
    };

    // Obtener y subir cada tabla
    let tables_data = get_all_local_data(&mut conn)?;
    println!("🔄 [PUSH] Datos obtenidos localmente: {} tablas", tables_data.len());

    for (table_name, records) in tables_data {
        if let Err(e) = upload_to_supabase(&table_name, records) {
            println!("❌ [PUSH] Error subiendo tabla {}: {}", table_name, e);
            return Err(format!("Error subiendo tabla {}: {}", table_name, e));
        }
    }

    println!("✅ [PUSH] Subida completada exitosamente");
    Ok(())
}

fn get_current_user_id(_conn: &mut rusqlite::Connection) -> Result<String, String> {
    // Por ahora, retornamos un user_id de ejemplo
    // En una implementación real, esto vendría de la sesión del usuario
    Ok("f4100785-8cd0-45d8-aace-2d320e2aad81".to_string())
}

fn get_all_local_data(
    conn: &mut rusqlite::Connection,
) -> Result<HashMap<String, Vec<serde_json::Value>>, String> {
    let mut result = HashMap::new();

    // Procesar cada tabla individualmente
    // Categorías (años, cortes, colegios)
    let category_tables = vec![
        ("ano_lectivo", "SELECT id, nombre, activo, cualitativo FROM ano_lectivo"),
        ("corte_evaluativo", "SELECT id, nombre, activo, cualitativo FROM corte_evaluativo"),
        ("colegio", "SELECT id, nombre, activo, cualitativo FROM colegio"),
    ];

    for (table_name, query) in category_tables {
        let mut stmt = conn.prepare(query)
            .map_err(|e| format!("Error preparando consulta para {}: {}", table_name, e))?;

        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "nombre": row.get::<_, String>(1)?,
                "activo": row.get::<_, bool>(2)?,
                "cualitativo": row.get::<_, Option<String>>(3)?
            }))
        }).map_err(|e| format!("Error ejecutando consulta para {}: {}", table_name, e))?;

        let mut table_data = Vec::new();
        for row_result in rows {
            match row_result {
                Ok(json_value) => table_data.push(json_value),
                Err(e) => return Err(format!("Error procesando fila en {}: {}", table_name, e)),
            }
        }

        println!("📊 [PUSH] Tabla {}: {} registros obtenidos", table_name, table_data.len());
        result.insert(table_name.to_string(), table_data);
    }

    // Asignaturas, grados, secciones
    let simple_tables = vec![
        ("asignatura", "SELECT id, nombre, cualitativo FROM asignatura"),
        ("grado", "SELECT id, nombre, cualitativo FROM grado"),
        ("seccion", "SELECT id, nombre, cualitativo FROM seccion"),
    ];

    for (table_name, query) in simple_tables {
        let mut stmt = conn.prepare(query)
            .map_err(|e| format!("Error preparando consulta para {}: {}", table_name, e))?;

        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "nombre": row.get::<_, String>(1)?,
                "cualitativo": row.get::<_, Option<String>>(2)?
            }))
        }).map_err(|e| format!("Error ejecutando consulta para {}: {}", table_name, e))?;

        let mut table_data = Vec::new();
        for row_result in rows {
            match row_result {
                Ok(json_value) => table_data.push(json_value),
                Err(e) => return Err(format!("Error procesando fila en {}: {}", table_name, e)),
            }
        }

        println!("📊 [PUSH] Tabla {}: {} registros obtenidos", table_name, table_data.len());
        result.insert(table_name.to_string(), table_data);
    }

    Ok(result)
}
        }

        println!(
            "📊 [PUSH] Tabla {}: {} registros obtenidos",
            table_name,
            table_data.len()
        );
        result.insert(table_name.to_string(), table_data);
    }

    Ok(result)
}

#[tauri::command]
fn set_orientation(_app_handle: tauri::AppHandle, _orientation: String) -> Result<(), String> {
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
fn print_pdf(_app_handle: tauri::AppHandle, _path: String) -> Result<(), String> {
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
fn share_pdf(_app_handle: tauri::AppHandle, _path: String) -> Result<(), String> {
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
fn save_file_android(
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            if !app_dir.exists() {
                std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
            }
            let db_path = app_dir.join("database.sqlite");
            let conn = Connection::open(db_path).expect("Failed to open database");
            db::run_migrations(&conn).expect("Failed to run migrations");
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
            set_active_colegio,
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
            get_subjects_by_grade,
            assign_subject_to_grade,
            unassign_subject_from_grade,
            assign_all_subjects_to_grade,
            unassign_all_subjects_from_grade,
            get_subjects_by_colegio,
            assign_subject_to_colegio,
            unassign_subject_from_colegio,
            assign_all_subjects_to_colegio,
            unassign_all_subjects_from_colegio,
            get_evaluation_config,
            update_indicador,
            update_criterio,
            get_estudiantes_by_filters,
            save_notas_estudiantes,
            get_notas_by_filters,
            get_db_path,
            get_grade_configs,
            update_grade_config,
            get_asistencia_estudiantes,
            save_asistencia,
            get_asistencia_rango,
            get_asistencia_all,
            get_colegio_dias_asistencia,
            save_colegio_dias_asistencia,
            set_orientation,
            check_category_dependencies,
            delete_category_force,
            get_indicadores_all,
            get_criterios_all,
            get_notas_all,
            get_asistencia_all,
            get_student_impact,
            reset_local_database,
            get_grados_by_colegio,
            get_secciones_by_grado_colegio,
            upsert_pull_data,
            get_colegio_dias_asistencia_all,
            delete_asistencia_batch,
            get_pending_deletions,
            remove_pending_deletion,
            remove_pending_deletion_by_record,
            get_recommended_colegio,
            sync_push_all_to_cloud,
            // Nuevas funciones para tablas con claves compuestas
            get_pending_deletions_asistencia,
            remove_pending_deletion_asistencia,
            get_pending_deletions_nota,
            remove_pending_deletion_nota,
            get_pending_deletions_grado_asignatura,
            remove_pending_deletion_grado_asignatura,
            get_pending_deletions_colegio_asignatura,
            remove_pending_deletion_colegio_asignatura
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
