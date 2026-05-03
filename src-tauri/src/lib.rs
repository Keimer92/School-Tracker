mod db;

use db::*;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn upload_to_supabase(table: &str, data: Vec<serde_json::Value>, _user_id: &str) -> Result<(), String> {
    println!(
        "🔄 [PUSH] Subiendo {} registros a tabla {}",
        data.len(),
        table
    );

    if data.is_empty() {
        println!("⚠️ [PUSH] Tabla {} está vacía, omitiendo", table);
        return Ok(());
    }

    // URL de Supabase
    let supabase_url = "https://[PROYECTO_REMOVIDO]";
    let supabase_key = "[CLAVE_REMOVIDA_ROTAR]";

    // Tablas que tienen user_id en Supabase
    let tables_with_user_id = vec!["ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "estudiante", "asistencia", "nota", "indicador", "criterio"];
    let has_user_id = tables_with_user_id.contains(&table);

    // Ahora usamos UPSERT con resolution=merge-duplicates, no hay necesidad de delete previo
    println!("🔄 [PUSH] Subiendo {} registros a {}", data.len(), table);
    
    // Para cada registro, intentar upsert en Supabase
for record in data {
        let url = format!("{}/rest/v1/{}", supabase_url, table);

        // Columnas que existen en cada tabla de Supabase (excluir las que no existen)
        let columns_to_exclude = match table {
            "colegio" | "asignatura" | "grado" | "seccion" | "estudiante" | "asistencia" | "nota" | "criterio" | "indicador" => vec!["activo"],
            _ => vec![],
        };
        
        let exclude_user_id = !has_user_id;
        
        // Filtrar columnas que no existen en la tabla y convertir booleanos
        let mut record_filtered = serde_json::Map::new();
        if let serde_json::Value::Object(obj) = record {
            for (key, value) in obj {
                if columns_to_exclude.contains(&key.as_str()) {
                    continue;
                }
                if exclude_user_id && key == "user_id" {
                    continue;
                }
                // Convertir boolean a numero para PostgreSQL
                // Convertir strings vacíos a valor por defecto
                let new_value = match value {
                    serde_json::Value::Bool(ref b) => {
                        if *b {
                            serde_json::Value::Number(serde_json::Number::from(1))
                        } else {
                            serde_json::Value::Number(serde_json::Number::from(0))
                        }
                    },
                    serde_json::Value::String(ref s) if s.is_empty() => {
                        serde_json::Value::String("Sin descripción".to_string())
                    },
                    // user_id ya es String, déjalo como está
                    _ => value.clone(),
                };
                record_filtered.insert(key.clone(), new_value);
            }
        }
        
        // Convertir el registro a string JSON
        let json_data = serde_json::to_string(&record_filtered)
            .map_err(|e| format!("Error serializando registro: {}", e))?;

        println!("🔄 [PUSH] Enviando registro a {}: {}", table, json_data);

        // Hacer POST request a Supabase - usar upsert con resolution=merge-duplicates
        let response = ureq::post(&url)
            .set("apikey", supabase_key)
            .set("Authorization", &format!("Bearer {}", supabase_key))
            .set("Content-Type", "application/json")
            .set("Prefer", "return=minimal,resolution=merge-duplicates")
            .send_string(&json_data);

        match response {
            Ok(resp) => {
                let status = resp.status();
                if status >= 200 && status < 300 {
                    println!("✅ [PUSH] Registro subido exitosamente a {}", table);
                } else {
                    let error_text = resp.into_string().unwrap_or_else(|_| "Error desconocido".to_string());
                    println!(
                        "❌ [PUSH] Error HTTP {} al subir a {}: {}",
                        status, table, error_text
                    );
                    // Intentar parsear el error JSON
                    if let Ok(err_json) = serde_json::from_str::<serde_json::Value>(&error_text) {
                        if let Some(msg) = err_json.get("message") {
                            println!("❌ [PUSH] Mensaje de error: {}", msg);
                        }
                        if let Some(details) = err_json.get("details") {
                            println!("❌ [PUSH] Detalles: {}", details);
                        }
                    }
                    return Err(format!(
                        "Error HTTP {} al subir registro: {}",
                        status, error_text
                    ));
                }
            }
            Err(e) => {
                let error_text = format!("Error: {:?}", e);
                println!("❌ [PUSH] Error de conexión al subir a {}: {}", table, error_text);
                return Err(format!("Error de conexión: {}", error_text));
            }
        }
    }

println!(
        "✅ [PUSH] Todos los registros de {} subidos exitosamente",
        table
    );
    Ok(())
}

#[tauri::command]
fn sync_push_all_to_cloud(state: tauri::State<'_, DbState>, user_id: String) -> Result<(), String> {
    println!("🔄 [PUSH] Iniciando sincronización en background (async)...");
    
    if user_id.is_empty() {
        return Err("Usuario no autenticado".to_string());
    }

    // Obtener la conexión y datos antes de iniciar el thread
    let tables_data = {
        let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
        get_all_local_data(&mut conn)?
    };

    println!("🔄 [PUSH] Datos obtenidos localmente: {} tablas", tables_data.len());

    // Clonar los datos necesarios para el thread
    let user_id_clone = user_id.clone();
    let tables_clone = tables_data.clone();

    // Ejecutar la sincronización en un hilo separado sin bloquear la UI
    std::thread::spawn(move || {
        // No podemos usar 'state' aquí porque es de otro thread
        // Necesitamos crear una nueva conexión para este hilo
        // Pero por ahora, simplemente ejecutamos la lógica de upload
        
        let table_order = vec![
            "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
            "indicador", "criterio",
            "estudiante", "asistencia", "nota"
        ];

        for table_name in table_order {
            let records = match tables_clone.get(table_name) {
                Some(r) => r.clone(),
                None => continue,
            };

            let tables_with_user_id = vec![
                "ano_lectivo", "corte_evaluativo", "colegio", "asignatura",
                "grado", "seccion",
                "estudiante", "asistencia", "nota", "indicador", "criterio"
            ];

            let should_add_user_id = tables_with_user_id.contains(&table_name);

            let records_with_user_id: Vec<serde_json::Value> = records
                .into_iter()
                .map(|mut record| {
                    if should_add_user_id {
                        if let serde_json::Value::Object(ref mut obj) = record {
                            obj.insert(
                                "user_id".to_string(),
                                serde_json::Value::String(user_id_clone.clone()),
                            );
                        }
                    }
                    record
                })
                .collect();

            println!(
                "🔄 [PUSH] Subiendo {} registros a {}",
                records_with_user_id.len(),
                table_name
            );

            if let Err(e) = upload_to_supabase(&table_name, records_with_user_id, &user_id_clone) {
                println!("❌ [PUSH] Error en {}: {}", table_name, e);
            }
        }

        println!("✅ [PUSH] Sincronización en background completada");
    });

    // Devolver inmediatamente al frontend
    println!("🔄 [PUSH] Sincronización iniciada en background, UI libre");
    Ok(())
}

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
        .prepare("SELECT id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, coalesce(colegio_id, 0), telefono, direccion, email FROM estudiante")
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
                "colegio_id": row.get::<_, i64>(7)?,
                "telefono": row.get::<_, String>(8)?,
                "direccion": row.get::<_, String>(9)?,
                "email": row.get::<_, String>(10)?
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
        .prepare("SELECT id, grado_id, asignatura_id, coalesce(corte_evaluativo_id, 0), orden, descripcion, activo FROM indicador")
        .map_err(|e| format!("Error preparando consulta para indicador: {}", e))?;

    let rows_ind = stmt_ind
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "grado_id": row.get::<_, i64>(1)?,
                "asignatura_id": row.get::<_, i64>(2)?,
                "corte_evaluativo_id": row.get::<_, i64>(3)?,
                "orden": row.get::<_, i64>(4)?,
                "descripcion": row.get::<_, String>(5)?,
                "activo": row.get::<_, i64>(6)? != 0
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

#[allow(dead_code)]
#[allow(dead_code)]
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

#[allow(dead_code)]
#[allow(dead_code)]
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

#[allow(dead_code)]
#[allow(dead_code)]
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
            let db_path = app_dir.join("school.db");
            let conn = Connection::open(db_path).expect("Failed to open database");
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
