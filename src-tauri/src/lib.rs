mod db;

use db::*;
use rusqlite::Connection;
use rusqlite::params;
use rusqlite::types::ToSql;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[tauri::command]
fn create_folder_and_save_file(folder_path: String, file_path: String, file_data: Vec<u8>) -> Result<(), String> {
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
fn get_schema_sql(state: tauri::State<'_, DbState>) -> Result<String, String> {
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
fn get_all_local_data_json(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let table_names = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "indicador", "criterio",
        "estudiante", "configuracion_calificacion", "colegio_dias_asistencia",
        "asistencia", "nota",
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
async fn gd_write_file_base64(path: String, content_base64: String) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::fs;
    
    let bytes = general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("Error decodificando base64: {}", e))?;
    fs::write(&path, bytes)
        .map_err(|e| format!("Error escribiendo archivo: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn gd_open_url_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let _ = url;

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
        }
        .badge::before {
            content: '';
            width: 6px;
            height: 6px;
            background: #10b981;
            border-radius: 50%;
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
        <p>Tu cuenta de Google Drive se ha vinculado correctamente con School Tracker Pro.</p>
        <span class="badge">Seguro y Cifrado</span>
    </div>
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

#[tauri::command]
async fn gd_create_backup(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    use chrono::Local;
    
    let app_data_dir = get_profile_app_dir(&app_handle)?;
    let db_path = app_data_dir.join("school.db");
    
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
async fn gd_import_db_from_file(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
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
    let db_path = app_data_dir.join("school.db");
    
    let backups_dir = app_data_dir.join("backups");
    if !backups_dir.exists() { fs::create_dir_all(&backups_dir).ok(); }
    let safety_backup = backups_dir.join(format!("safety_before_import_{}.db", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
    let _ = fs::copy(&db_path, &safety_backup);
    
    fs::copy(&import_path, &db_path).map_err(|e| format!("Failed to import database: {}", e))?;
    Ok(db_path.to_string_lossy().into_owned())
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
        _ => Ok(app_dir),
    }
}

fn buscar_pocketbase_binary(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let binary_suffix = if cfg!(target_os = "windows") { ".exe" } else { "" };

    // Collect all possible directories to search
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();

    // 1. resource_dir/binaries (Tauri v2 dev: src-tauri/binaries)
    if let Ok(d) = app_handle.path().resource_dir() {
        dirs.push(d.join("binaries"));
    }

    // 2. CARGO_MANIFEST_DIR/binaries (compile-time known for dev)
    if let Ok(d) = std::env::var("CARGO_MANIFEST_DIR") {
        dirs.push(std::path::PathBuf::from(d).join("binaries"));
    }

    // 3. current_dir/binaries
    if let Ok(d) = std::env::current_dir() {
        dirs.push(d.join("binaries"));
    }

    // 4. current_dir/src-tauri/binaries
    if let Ok(d) = std::env::current_dir() {
        dirs.push(d.join("src-tauri").join("binaries"));
    }

    // 5. Plain "binaries" relative path
    dirs.push(std::path::PathBuf::from("binaries"));

    // 6. Exe parent dir/binaries (for production)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("binaries"));
        }
    }

    for dir in &dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("pocketbase") && name.ends_with(binary_suffix) {
                    println!("✅ [Sidecar] PocketBase binary encontrado: {:?}", entry.path());
                    return Some(entry.path());
                }
            }
        }
    }

    eprintln!("⚠️ [Sidecar] PocketBase binary no encontrado en ninguno de estos directorios:");
    for dir in &dirs {
        eprintln!("    - {:?} (exists: {})", dir, dir.exists());
    }
    None
}

static PB_STARTED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub fn iniciar_pocketbase(app_handle: &tauri::AppHandle, app_dir: &std::path::Path) {
    if PB_STARTED.get().is_some() { return; }
    if let Some(pb_path) = buscar_pocketbase_binary(app_handle) {
        let pb_data_dir = app_dir.join("pb_data");
        if !pb_data_dir.exists() {
            let _ = std::fs::create_dir_all(&pb_data_dir);
        }
        println!("🔄 [Sidecar] Iniciando PocketBase desde {:?}...", pb_path);
        match std::process::Command::new(&pb_path)
            .arg("serve")
            .arg("--dev")
            .args([
                "--dir", &pb_data_dir.to_string_lossy(),
                "--http=127.0.0.1:8090",
            ])
            .spawn()
        {
            Ok(child) => {
                println!("✅ [Sidecar] PocketBase iniciado (PID: {})", child.id());
                let _ = PB_STARTED.set(true);
            }
            Err(e) => println!("❌ [Sidecar] Error iniciando PocketBase: {}", e),
        }
    } else {
        println!("⚠️ [Sidecar] PocketBase binary no encontrado");
    }
}

#[tauri::command]
fn get_pocketbase_status() -> Result<bool, String> {
    Ok(PB_STARTED.get().is_some())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())

        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_dir = get_profile_app_dir(&app_handle).expect("Failed to get profile dir");
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

            // Iniciar PocketBase como sidecar
            iniciar_pocketbase(&app_handle, &app_dir);

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
            get_evaluation_config,
            update_indicador,
            update_criterio,
            get_estudiantes_by_filters,
            save_notas_estudiantes,
            delete_notas,
            get_notas_by_filters,
            get_db_path,
            get_grade_configs,
            update_grade_config,
            get_asistencia_estudiantes,
            save_asistencia,
            upsert_asistencia_from_cloud,
            upsert_notas_from_cloud,
            get_asistencia_rango,
            get_asistencia_all,
            get_colegio_dias_asistencia,
            save_colegio_dias_asistencia,
            set_orientation,
            check_category_dependencies,
            delete_category_force,
            delete_category_force_batch,
            get_indicadores_all,
            get_criterios_all,
            get_notas_all,
            get_student_impact,
            reset_local_database,
            seed_defaults_now,
            get_grados_by_colegio,
            get_secciones_by_grado_colegio,
            upsert_pull_data,
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
            // Nuevas funciones para tablas con claves compuestas
            get_pending_deletions_asistencia,
            remove_pending_deletion_asistencia,
            get_pending_deletions_nota,
            remove_pending_deletion_nota,
            get_pending_deletions_grado_asignatura,
            remove_pending_deletion_grado_asignatura,
            get_pending_deletions_colegio_asignatura,
            remove_pending_deletion_colegio_asignatura,
            delete_record_local,
            print_pdf,
            share_pdf,
            save_file_android,
            check_turso_connectivity,
            gd_read_file_base64,
            gd_write_file_base64,
            gd_open_url_browser,
            gd_start_oauth_server,
            gd_create_backup,
            gd_get_backups,
            gd_delete_backup,
            gd_import_db_from_file,
            get_pocketbase_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
#[allow(non_snake_case)]
fn delete_notas(
    state: tauri::State<'_, DbState>,
    corteEvaluativoId: i64,
    asignaturaId: i64,
    estudianteId: i64,
    criterioId: i64,
) -> Result<i64, String> {
    println!("[delete_notas] CALLED with corte={}, asig={}, est={}, crit={}", corteEvaluativoId, asignaturaId, estudianteId, criterioId);
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
    let where_clause = conditions.join(" AND ");

    let param_refs: Vec<&dyn ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    // Insert into sync_pending_deletions_nota first
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

    // Delete from nota table
    let delete_sql = format!("DELETE FROM nota WHERE {}", where_clause);
    let deleted = tx
        .execute(&delete_sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted as i64)
}
