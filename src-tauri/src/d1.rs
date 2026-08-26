use crate::db::*;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ============================================================================
// Configuración D1 (guardada en la tabla d1_config, una sola fila)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct D1Config {
    pub worker_url: String,
    pub school_key: String,
    pub device_id: String,
    /// Cursor del PULL: hora del SERVIDOR (autoritativo, inmune a desfases).
    pub last_sync: Option<String>,
    /// Cursor del PUSH: hora LOCAL (consistente con los updated_at que el
    /// propio dispositivo estampa en sus filas). Separado del cursor de pull
    /// para que un reloj local atrasado/adelantado nunca coma ediciones.
    pub last_push_sync: Option<String>,
}

fn read_config(conn: &rusqlite::Connection) -> Result<Option<D1Config>, String> {
    let mut stmt = conn.prepare(
        "SELECT worker_url, school_key, device_id, last_sync, last_push_sync FROM d1_config WHERE id = 1",
    ).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([], |row| {
            Ok(D1Config {
                worker_url: row.get(0)?,
                school_key: row.get(1)?,
                device_id: row.get(2)?,
                last_sync: row.get(3)?,
                last_push_sync: row.get(4).unwrap_or(None),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.next().transpose().map_err(|e| e.to_string())
}

fn write_config(conn: &rusqlite::Connection, cfg: &D1Config) -> Result<(), String> {
    conn.execute(
        "INSERT INTO d1_config (id, worker_url, school_key, device_id, last_sync, last_push_sync, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET worker_url = ?1, school_key = ?2, device_id = ?3, last_sync = ?4, last_push_sync = ?5, updated_at = datetime('now')",
        params![cfg.worker_url, cfg.school_key, cfg.device_id, cfg.last_sync, cfg.last_push_sync],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn generate_device_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("dev-{}-{:x}", Utc::now().timestamp_millis(), nanos)
}

fn now_sqlite() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

// ============================================================================
// HTTP hacia el Worker (ureq)
// ============================================================================

fn http_post_json(
    base_url: &str,
    school_key: &str,
    path: &str,
    body: Value,
) -> Result<Value, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build();
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    println!("[D1] POST {} (key={}…)", url, &school_key[..school_key.len().min(8)]);
    let resp = agent
        .post(&url)
        .set("Content-Type", "application/json")
        .set("X-School-Key", school_key)
        .send_json(body);

    // En ureq 2.x las respuestas 4xx/5xx llegan como Err(Error::Status(code, response)).
    // En ese caso hay que leer el body para obtener el mensaje real del Worker.
    let resp = match resp {
        Ok(r) => r,
        Err(ureq::Error::Status(code, response)) => {
            let text = response.into_string().unwrap_or_default();
            println!("[D1] HTTP {} en {} -> {}", code, path, &text[..text.len().min(300)]);
            let parsed_err: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let detail = parsed_err
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or(&text)
                .to_string();
            return Err(format!("Worker error (HTTP {}): {}", code, detail));
        }
        Err(e) => {
            println!("[D1] red FAIL {}: {}", url, e);
            return Err(format!("Error de red hacia el Worker ({}): {}", url, e));
        }
    };

    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&text).map_err(|_| text.clone())?;
    if status >= 400 || parsed.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let err = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or(&text)
            .to_string();
        println!("[D1] HTTP {} (ok=false) en {} -> {}", status, path, &err[..err.len().min(300)]);
        return Err(format!("Worker error (HTTP {}): {}", status, err));
    }
    println!("[D1] HTTP {} OK {}", status, path);
    Ok(parsed)
}

// ============================================================================
// Comandos de configuración
// ============================================================================

#[tauri::command]
pub fn d1_get_config(state: tauri::State<'_, DbState>) -> Result<Option<D1Config>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    read_config(&conn)
}

#[tauri::command]
pub fn d1_save_config(
    state: tauri::State<'_, DbState>,
    worker_url: String,
    school_key: String,
) -> Result<D1Config, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut cfg = read_config(&conn)?.unwrap_or(D1Config {
        worker_url: String::new(),
        school_key: String::new(),
        device_id: String::new(),
        last_sync: None,
        last_push_sync: None,
    });
    cfg.worker_url = worker_url;
    cfg.school_key = school_key;
    if cfg.device_id.is_empty() {
        cfg.device_id = generate_device_id();
    }
    write_config(&conn, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn d1_clear_config(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM d1_config WHERE id = 1", [])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Regenera el device_id de esta instalación. Necesario cuando la identidad
/// se duplicó entre dispositivos (p. ej. al restaurar un respaldo de Drive que
/// incluyó la tabla d1_config): con ids compartidos, el LWW no puede
/// desempatar y el filtro de avisos propios del WebSocket descarta los
/// cambios del otro dispositivo.
#[tauri::command]
pub fn d1_reset_device_id(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let new_id = generate_device_id();
    let n = conn
        .execute(
            // Ambos cursores a NULL fuerzan push+pull completos desde época en
            // el próximo sync (idempotente gracias al upsert LWW del worker).
            // Útil cuando el cursor quedó ADELANTE del reloj real (desfase entre
            // dispositivos) o tras restaurar respaldos que duplican identidad.
            "UPDATE d1_config SET device_id = ?1, last_sync = NULL, last_push_sync = NULL WHERE id = 1",
            rusqlite::params![new_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("D1 no está configurado".to_string());
    }
    Ok(new_id)
}

#[tauri::command]
pub fn d1_status(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let cfg = read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?;
    drop(conn);
    let resp = http_post_json(&cfg.worker_url, &cfg.school_key, "/hello", json!({}))?;
    Ok(resp)
}

// ============================================================================
// Payload de push: datos locales desde `since` + borrados pendientes
// ============================================================================

/// Columnas de clave primaria por tabla (espejo de TABLES en el worker).
fn pk_cols(table: &str) -> &'static [&'static str] {
    match table {
        "grado_asignatura" => &["grado_id", "asignatura_id"],
        "colegio_asignatura" => &["colegio_id", "asignatura_id"],
        "colegio_dias_asistencia" => &["colegio_id"],
        "dia_sin_clases" => &["id"],
        "nota" => &["estudiante_id", "criterio_id", "corte_evaluativo_id", "asignatura_id"],
        "asistencia" => &["estudiante_id", "fecha"],
        _ => &["id"],
    }
}

/// Parte de PK canónica: "v1|v2|"
fn pk_part(table: &str, row: &Map<String, Value>) -> String {
    let mut s = String::new();
    for c in pk_cols(table) {
        let v = row.get(*c).cloned().unwrap_or(Value::Null);
        s.push_str(&v.to_string());
        s.push('|');
    }
    s
}

/// Clave completa del anti re-relevo: "tabla|pk|updated_at"
fn row_recent_key(table: &str, row: &Map<String, Value>) -> String {
    let ua = row.get("updated_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
    format!("{}|{}|{}", table, pk_part(table, row), ua)
}

fn collect_local_data_since(
    conn: &rusqlite::Connection,
    since: &str,
    recent: &std::collections::HashSet<String>,
) -> Result<Value, String> {
    let table_names = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "indicador", "criterio",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion",
        "colegio_dias_asistencia", "asistencia", "nota",
        "dia_sin_clases",
    ];

    let mut result = Map::new();
    for table in &table_names {
        // NOTA: sin filtro por device_id (no todas las tablas locales lo tienen).
        // El bucle de re-relevo ya está cortado aguas arriba: el worker re-sella
        // updated_at con su reloj y los cursores (pull=servidor, push=local)
        // garantizan que una fila aplicada por pull quede fuera del siguiente push.
        let query = format!("SELECT * FROM {} WHERE updated_at > ?1", table);
        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| format!("Error preparando {}: {}", table, e))?;
        let column_count = stmt.column_count();
        let column_names: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();
        let rows: Vec<Value> = stmt
            .query_map([since], |row| {
                let mut map = Map::new();
                for (i, col_name) in column_names.iter().enumerate() {
                    let val = match row.get_ref(i) {
                        Ok(rusqlite::types::ValueRef::Null) => Value::Null,
                        Ok(rusqlite::types::ValueRef::Integer(n)) => json!(n),
                        Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
                        Ok(rusqlite::types::ValueRef::Text(t)) => {
                            Value::String(String::from_utf8_lossy(t).to_string())
                        }
                        Ok(rusqlite::types::ValueRef::Blob(_)) => Value::Null,
                        Err(_) => Value::Null,
                    };
                    map.insert(col_name.clone(), val);
                }
                Ok(Value::Object(map))
            })
            .map_err(|e| format!("Error query {}: {}", table, e))?
            .filter_map(|r| r.ok())
            .filter(|row| {
                // Excluir filas recién pulladas y aún sin modificación local:
                // evita re-relevar datos ajenos (bucle de sincronización).
                match row.as_object() {
                    Some(obj) => {
                        let key = row_recent_key(table, obj);
                        !recent.contains(&key)
                    }
                    None => true,
                }
            })
            .collect();
        result.insert(table.to_string(), Value::Array(rows));
    }
    Ok(Value::Object(result))
}

fn collect_pending_deletions(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let mut deletions: Vec<Value> = Vec::new();

    let mut stmt = conn
        .prepare("SELECT tabla, registro_id FROM sync_pending_deletions")
        .map_err(|e| e.to_string())?;
    let simple: Vec<(String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (tabla, id) in simple {
        deletions.push(json!({ "tabla": tabla, "pk": [id] }));
    }

    let mut stmt = conn
        .prepare("SELECT estudiante_id, fecha FROM sync_pending_deletions_asistencia")
        .map_err(|e| e.to_string())?;
    let asis: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (est, fecha) in asis {
        deletions.push(json!({ "tabla": "asistencia", "pk": [est, fecha] }));
    }

    let mut stmt = conn
        .prepare("SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM sync_pending_deletions_nota")
        .map_err(|e| e.to_string())?;
    let notas: Vec<(i64, i64, i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (est, crit, corte, asig) in notas {
        deletions.push(json!({ "tabla": "nota", "pk": [est, crit, corte, asig] }));
    }

    let mut stmt = conn
        .prepare("SELECT grado_id, asignatura_id FROM sync_pending_deletions_grado_asignatura")
        .map_err(|e| e.to_string())?;
    let ga: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (g, a) in ga {
        deletions.push(json!({ "tabla": "grado_asignatura", "pk": [g, a] }));
    }

    let mut stmt = conn
        .prepare("SELECT colegio_id, asignatura_id FROM sync_pending_deletions_colegio_asignatura")
        .map_err(|e| e.to_string())?;
    let ca: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (c, a) in ca {
        deletions.push(json!({ "tabla": "colegio_asignatura", "pk": [c, a] }));
    }

    Ok(deletions)
}

// ============================================================================
// Aplicación del pull (merged truth) en SQLite local
// ============================================================================

fn sqlite_value_to_json(v: &Value) -> rusqlite::types::Value {
    match v {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        _ => rusqlite::types::Value::Null,
    }
}

// INSERT OR REPLACE genérico a partir de las columnas del JSON (claves del objeto).
fn upsert_row(conn: &rusqlite::Connection, table: &str, row: &Map<String, Value>) -> Result<(), String> {
    // asistencia: PK local = id autoinc, pero la clave de negocio sincronizable es
    // (estudiante_id, fecha). El id remoto puede chocar con un id local existente, así
    // que se upserta por la clave de negocio y se conserva el id local.
    if table == "asistencia" {
        return upsert_asistencia(conn, row);
    }
    let cols: Vec<String> = row.keys().cloned().collect();
    if cols.is_empty() {
        return Ok(());
    }
    let placeholders = cols.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
        table,
        cols.join(", "),
        placeholders
    );
    let vals: Vec<rusqlite::types::Value> = cols
        .iter()
        .map(|c| sqlite_value_to_json(&row.get(c).unwrap_or(&Value::Null)))
        .collect();
    let refs: Vec<&dyn rusqlite::types::ToSql> = vals.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
    conn.execute(&sql, refs.as_slice())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// Upsert de asistencia por clave de negocio (estudiante_id, fecha).
// Si el registro remoto ya existe localmente con otro id, se actualiza la fila existente
// (estado/observación/updated_at) en lugar de insertar un id duplicado.
fn upsert_asistencia(conn: &rusqlite::Connection, row: &Map<String, Value>) -> Result<(), String> {
    let get = |k: &str| sqlite_value_to_json(&row.get(k).cloned().unwrap_or(Value::Null));
    let (est, fecha) = (get("estudiante_id"), get("fecha"));
    let estado = get("estado");
    let observacion = get("observacion");
    let updated_at = get("updated_at");
    conn.execute(
        "INSERT INTO asistencia (estudiante_id, fecha, estado, observacion, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(estudiante_id, fecha) DO UPDATE SET
           estado = excluded.estado,
           observacion = excluded.observacion,
           updated_at = excluded.updated_at",
        rusqlite::params![est, fecha, estado, observacion, updated_at],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// Borrado local por pk (array de valores según la definición de PK de cada tabla).
fn delete_by_pk(conn: &rusqlite::Connection, table: &str, pk: &Value) -> Result<(), String> {
    let arr: Vec<&Value> = pk.as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let sql = match table {
        "asistencia" if arr.len() >= 2 => {
            format!("DELETE FROM asistencia WHERE estudiante_id = ? AND fecha = ?")
        }
        "nota" if arr.len() >= 4 => {
            "DELETE FROM nota WHERE estudiante_id = ? AND criterio_id = ? AND corte_evaluativo_id = ? AND asignatura_id = ?".to_string()
        }
        "grado_asignatura" if arr.len() >= 2 => {
            "DELETE FROM grado_asignatura WHERE grado_id = ? AND asignatura_id = ?".to_string()
        }
        "colegio_asignatura" if arr.len() >= 2 => {
            "DELETE FROM colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?".to_string()
        }
        "colegio_dias_asistencia" => "DELETE FROM colegio_dias_asistencia WHERE colegio_id = ?".to_string(),
        _ => format!("DELETE FROM {} WHERE id = ?", table),
    };
    let vals: Vec<rusqlite::types::Value> = arr.iter().map(|v| sqlite_value_to_json(v)).collect();
    let refs: Vec<&dyn rusqlite::types::ToSql> = vals.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
    conn.execute(&sql, refs.as_slice())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn clear_all_pending_deletions(conn: &rusqlite::Connection) -> Result<(), String> {
    for t in [
        "sync_pending_deletions",
        "sync_pending_deletions_asistencia",
        "sync_pending_deletions_nota",
        "sync_pending_deletions_grado_asignatura",
        "sync_pending_deletions_colegio_asignatura",
    ] {
        let _ = conn.execute(&format!("DELETE FROM {}", t), []);
    }
    Ok(())
}

// ============================================================================
// Comando principal: syncAll (push + pull + apply)
// ============================================================================

#[tauri::command]
pub async fn d1_sync_all(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let cfg = read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?;

    // ── Anti re-relevo: recordar filas recién PULLADAS para no volver a
    // pushearlas mientras no se modifiquen localmente. Corte elástico: sin
    // esta memoria, filas con updated_at "a futuro" (relojes torcidos) eran
    // re-enviadas por cada dispositivo y revertaban cambios ajenos.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_recent_pulls (
            tabla TEXT NOT NULL,
            pk TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            ts INTEGER NOT NULL,
            PRIMARY KEY (tabla, pk)
        );"
    )
    .map_err(|e| e.to_string())?;
    let now_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    conn.execute(
        "DELETE FROM sync_recent_pulls WHERE ts < ?1",
        params![now_epoch.saturating_sub(86400)],
    )
    .map_err(|e| e.to_string())?;

    // Cargar conjunto de recién-pullados: clave = "tabla|pk|updated_at"
    let mut recent: std::collections::HashSet<String> = Default::default();
    {
        let mut stmt = conn
            .prepare("SELECT tabla, pk, updated_at FROM sync_recent_pulls")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (t, p, u) = r.map_err(|e| e.to_string())?;
            recent.insert(format!("{}|{}|{}", t, p, u));
        }
    }

    // DOS cursores independientes:
    //  - push_since  = reloj LOCAL (comparable con los updated_at que este
    //    dispositivo estampa en sus propias filas) -> nunca come ediciones propias.
    //  - since (pull) = reloj del SERVIDOR (autoritativo entre dispositivos).
    let push_since = cfg
        .last_push_sync
        .clone()
        .unwrap_or_else(|| "1970-01-01 00:00:00".to_string());
    let since = cfg
        .last_sync
        .clone()
        .unwrap_or_else(|| "1970-01-01 00:00:00".to_string());
    println!(
        "[D1] sync INICIO device={}… push_since=\"{}\" pull_since=\"{}\"",
        &cfg.device_id[..cfg.device_id.len().min(16)],
        push_since,
        since
    );

    // ---- 0. Purga de huérfanos: asistencias cuyo estudiante ya no existe
    // (p. ej. borrados previos al fix de tombstones). Idempotente: registra
    // los tombstones y borra localmente; el push de esta misma pasada
    // propaga la eliminación a la nube.
    {
        let n = conn.execute(
            "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha)
             SELECT a.estudiante_id, a.fecha FROM asistencia a
             LEFT JOIN estudiante e ON e.id = a.estudiante_id
             WHERE e.id IS NULL",
            [],
        )
        .map_err(|e| e.to_string())?;
        if n > 0 {
            conn.execute(
                "DELETE FROM asistencia WHERE estudiante_id NOT IN (SELECT id FROM estudiante)",
                [],
            )
            .map_err(|e| e.to_string())?;
            println!("[D1] purga: {} asistencias huérfanas marcadas para borrar en nube", n);
        }
    }

    // ---- 1. PUSH (cursor local)
    let data = collect_local_data_since(&conn, &push_since, &recent)?;
    let deletions = collect_pending_deletions(&conn)?;
    drop(conn);

    let total_push: usize = data
        .as_object()
        .map(|m| m.values().filter_map(|v| v.as_array()).map(|a| a.len()).sum())
        .unwrap_or(0);
    println!(
        "[D1] push: {} filas en {} tablas, {} borrados pendientes",
        total_push,
        data.as_object().map(|m| m.len()).unwrap_or(0),
        deletions.len()
    );

    let push_body = json!({
        "since": push_since,
        "deviceId": cfg.device_id,
        "data": data,
        "deletions": deletions,
    });
    let push_resp = http_post_json(&cfg.worker_url, &cfg.school_key, "/push", push_body)?;

    // ---- 2. PULL
    let pull_body = json!({
        "since": since,
        "deviceId": cfg.device_id,
    });
    let pull_resp = http_post_json(&cfg.worker_url, &cfg.school_key, "/pull", pull_body)?;

    // ---- 3. Apply
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = OFF", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut pulled_counts: Map<String, Value> = Map::new();
    if let Some(rows) = pull_resp.get("rows").and_then(|v| v.as_object()) {
        for (table, arr) in rows {
            if let Some(entries) = arr.as_array() {
                let mut n = 0;
                for entry in entries {
                    if let Some(obj) = entry.as_object() {
                        upsert_row(&tx, table, obj)?;
                        // Registrar en anti re-relevo: esta fila (pk + sello)
                        // no debe volver a pushearse sin modificación local.
                        let key = row_recent_key(table, obj);
                        tx.execute(
                            "INSERT INTO sync_recent_pulls (tabla, pk, updated_at, ts)
                             VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT(tabla, pk) DO UPDATE SET updated_at = excluded.updated_at, ts = excluded.ts",
                            params![table, pk_part(table, obj), obj.get("updated_at").and_then(|v| v.as_str()).unwrap_or(""), now_epoch],
                        )
                        .map_err(|e| e.to_string())?;
                        let _ = key;
                        n += 1;
                    }
                }
                pulled_counts.insert(table.clone(), json!(n));
            }
        }
    }

    let mut deleted_count = 0u64;
    if let Some(deleted) = pull_resp.get("deleted").and_then(|v| v.as_array()) {
        for d in deleted {
            let tabla = d.get("tabla").and_then(|v| v.as_str()).unwrap_or("");
            let pk = d.get("pk").cloned().unwrap_or(Value::Null);
            // Ignorar tombstones creados por este mismo dispositivo (ya aplicados localmente).
            let dev = d.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
            if dev == cfg.device_id {
                continue;
            }
            delete_by_pk(&tx, tabla, &pk)?;
            deleted_count += 1;
        }
    }

    // Confirmar: los borrados pendientes locales ya se aplicaron en el Worker
    clear_all_pending_deletions(&tx)?;

    // Cursor AUTORITATIVO del servidor (reloj único de Cloudflare). Antes se
    // usaba el reloj local de cada dispositivo: un reloj adelantado hacía que
    // su cursor superara los updated_at de las filas escritas por el otro y
    // éstas nunca se pullaban ("la nueva sí llegó, la anterior no").
    let new_sync = pull_resp
        .get("serverTime")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(now_sqlite);
    println!("[D1] nuevo cursor last_sync=\"{}\" (fuente: {})", new_sync,
        if pull_resp.get("serverTime").is_some() { "servidor" } else { "reloj local (fallback)" });
    let new_push_cursor = now_sqlite(); // reloj LOCAL: par del cursor de push
    tx.execute(
        "UPDATE d1_config SET last_sync = ?1, last_push_sync = ?2, updated_at = datetime('now') WHERE id = 1",
        params![new_sync, new_push_cursor],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    let applied = push_resp.get("applied").cloned().unwrap_or(Value::Null);
    println!(
        "[D1] sync FIN device={}… push={:?} pull={} tablas ({} filas) del={} nuevo_since=\"{}\"",
        &cfg.device_id[..cfg.device_id.len().min(16)],
        applied,
        pulled_counts.len(),
        pulled_counts.values().filter_map(|v| v.as_u64()).sum::<u64>(),
        deleted_count,
        new_sync
    );
    Ok(json!({
        "ok": true,
        "pushed": applied,
        "pulled": pulled_counts,
        "deletedApplied": deleted_count,
        "lastSync": new_sync,
    }))
}

// ============================================================================
// Reserva de bloques de IDs (F2)
// ============================================================================

#[tauri::command]
pub async fn d1_reserve_ids(
    state: tauri::State<'_, DbState>,
    blocks: HashMap<String, i64>,
) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let cfg = read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?;
    drop(conn);

    let body = json!({ "deviceId": cfg.device_id, "blocks": blocks });
    let resp = http_post_json(&cfg.worker_url, &cfg.school_key, "/ids", body)?;

    if let Some(b) = resp.get("blocks").and_then(|v| v.as_object()) {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        for (tabla, range) in b {
            let start = range.get("start").and_then(|v| v.as_i64()).unwrap_or(0);
            let end = range.get("end").and_then(|v| v.as_i64()).unwrap_or(0);
            conn.execute(
                "INSERT INTO d1_id_blocks (tabla, next_id, end_id, updated_at)
                 VALUES (?1, ?2, ?3, datetime('now'))
                 ON CONFLICT(tabla) DO UPDATE SET next_id = ?2, end_id = ?3, updated_at = datetime('now')",
                params![tabla, start, end],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(resp)
}
