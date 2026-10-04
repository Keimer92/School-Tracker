use crate::db::*;
use chrono::Utc;
use rusqlite::params;
use tauri::Emitter;
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
///
/// ⚠️ Solo pone `last_sync` (cursor de PULL) en NULL, NUNCA `last_push_sync`.
///
/// Antes los ponía los dos en NULL y por eso **restaurar un respaldo de Drive
/// re-subía la base entera a D1** (con `push_since = 1970`, el worker escribe
/// las ~8.000 filas otra vez: 12 restores agotaban la cuota diaria de D1 sin
/// que el usuario tocara nada).
///
/// - El PULL completo sí hace falta: el respaldo puede ser más viejo que lo que
///   hay en la nube, y sin cursor las filas que el otro device subió después no
///   llegarían nunca.
/// - El PUSH no: las filas del respaldo ya están en D1 (o hay versiones más
///   nuevas). Reenviarlas no agrega nada y además pisaría datos más recientes,
///   que es justo lo que el aviso de "respaldo más antiguo" intenta evitar.
#[tauri::command]
pub fn d1_reset_device_id(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let new_id = generate_device_id();
    let n = conn
        .execute(
            "UPDATE d1_config SET device_id = ?1, last_sync = NULL WHERE id = 1",
            rusqlite::params![new_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("D1 no está configurado".to_string());
    }
    Ok(new_id)
}

/// howMany veces se reintenta el push tras fallos consecutivos, en minutos.
/// El último valor es el tope: a partir de ahí se espera 4 h entre intentos.
///
/// La cuota diaria de D1 (100.000 filas escritas en el plan gratis) se agota
/// con ~12 pushes completos de esta base, así que reintentar sin pausa es lo
/// que convierte un error puntual en un día entero de sync roto.
const PUSH_BACKOFF_MIN: [i64; 6] = [5, 15, 30, 60, 120, 240];

/// Registra un push fallido: sube el contador y calcula `push_retry_after`.
fn registrar_push_fallido(conn: &rusqlite::Connection, motivo: &str) -> Result<(), String> {
    let prev: i64 = conn
        .query_row(
            "SELECT COALESCE(push_fail_count, 0) FROM d1_config WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let n = prev + 1;
    let idx = ((n - 1).max(0) as usize).min(PUSH_BACKOFF_MIN.len() - 1);
    let minutos = PUSH_BACKOFF_MIN[idx];
    conn.execute(
        "UPDATE d1_config SET push_fail_count = ?1,
             push_retry_after = datetime('now', ?2),
             updated_at = datetime('now')
         WHERE id = 1",
        params![n, format!("+{} minutes", minutos)],
    )
    .map_err(|e| e.to_string())?;
    println!(
        "[D1] push FALLIDO (#{}) -> no se reintenta hasta {} ({} min). Motivo: {}",
        n, minutos, minutos, motivo
    );
    Ok(())
}

/// Un push exitoso (o un sync bien aplicado) limpia el freno.
fn limpiar_push_fallidos(conn: &rusqlite::Connection) {
    let _ = conn.execute(
        "UPDATE d1_config SET push_fail_count = 0, push_retry_after = NULL WHERE id = 1",
        [],
    );
}

/// ¿Estamos dentro de la ventana de espera del freno?
fn push_en_espera(conn: &rusqlite::Connection) -> Option<String> {
    let hasta: Option<String> = conn
        .query_row(
            "SELECT push_retry_after FROM d1_config WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let hasta = hasta?;
    let esperando: i64 = conn
        .query_row(
            "SELECT CAST((julianday(?1) - julianday('now')) * 24 * 60 AS INTEGER)",
            params![hasta],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if esperando > 0 {
        Some(format!("{} min", esperando))
    } else {
        None
    }
}

/// Cuántas filas tiene guardadas la nube para este `schoolKey` (y cuántos
/// tombstones). Lo usa el WelcomePage para decidir si la nube está vacía o
/// atrasada: en ese caso único conviene un push completo; si ya tiene datos,
/// un merge incremental es infinitamente más barato y no arriesga pisarlos.
#[tauri::command]
pub fn d1_remote_stats(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    let cfg = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?
    };
    let resp = http_post_json(&cfg.worker_url, &cfg.school_key, "/stats", json!({}))?;
    Ok(resp)
}

/// Cuántas filas sincronizables hay ahora mismo en la base local.
///
/// Se compara contra `d1_remote_stats` para decidir si la nube está vacía o
/// atrasada (ahí toca push completo) o si ya tiene datos (donde alcanza con un
/// merge incremental). Solo cuenta las tablas que el worker guarda.
#[tauri::command]
pub fn contar_filas_sincronizables(state: tauri::State<'_, DbState>) -> Result<i64, String> {
    const TABLAS: &[&str] = &[
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio",
        "asistencia", "colegio_dias_asistencia", "nota", "dia_sin_clases",
        "indicador_colegio_seccion_activo", "app_settings",
    ];
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut total: i64 = 0;
    for t in TABLAS {
        // Una tabla puede no existir todavia en bases viejas: se ignora.
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{}\"", t), [], |r| r.get(0))
            .unwrap_or(0);
        total += n;
    }
    Ok(total)
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
        "colegio_grado" => &["colegio_id", "grado_id"],
        "colegio_dias_asistencia" => &["colegio_id"],
        "dia_sin_clases" => &["id"],
        "nota" => &["estudiante_id", "criterio_id", "corte_evaluativo_id", "asignatura_id"],
        "indicador_colegio_seccion_activo" => &["colegio_id", "seccion_id", "indicador_id"],
        "asistencia" => &["estudiante_id", "fecha"],
        "app_settings" => &["key"],
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
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio", "indicador_colegio_seccion_activo",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion",
        "colegio_dias_asistencia", "asistencia", "nota",
        "dia_sin_clases", "app_settings",
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

    let mut stmt = conn
        .prepare("SELECT colegio_id, grado_id FROM sync_pending_deletions_colegio_grado")
        .map_err(|e| e.to_string())?;
    let cg: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for (c, g) in cg {
        deletions.push(json!({ "tabla": "colegio_grado", "pk": [c, g] }));
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

// Tablas catálogo/entidades reconciliadas por su clave de negocio (nombre/codigo)
// en lugar del id autoincrement, preservando el id local (los FK locales lo referencian).
const BUSINESS_KEY_TABLES: &[(&str, &str)] = &[
    ("ano_lectivo", "nombre"),
    ("corte_evaluativo", "nombre"),
    ("colegio", "nombre"),
    ("asignatura", "nombre"),
    ("grado", "nombre"),
    ("seccion", "nombre"),
    ("estudiante", "codigo"),
];

// Upsert de catálogo/entidades por su clave de negocio (nombre/codigo).
// Actualiza la fila local existente (conservando su id) o inserta una nueva
// (id autoincrement local) si la clave de negocio no existe. Evita colisionar
// con UNIQUE(nombre/codigo) cuando los ids locales divergen de los remotos
// tras reseeds/restores.
fn upsert_catalog(conn: &rusqlite::Connection, table: &str, bk: &str, row: &Map<String, Value>) -> Result<(), String> {
    let cols: Vec<String> = row.keys().cloned().filter(|c| c.as_str() != "id").collect();
    if cols.is_empty() {
        return Ok(());
    }
    let set_clause = cols.iter().map(|c| format!("{} = ?", c)).collect::<Vec<_>>().join(", ");
    let update_sql = format!("UPDATE {} SET {} WHERE {} = ?", table, set_clause, bk);
    let mut up_params: Vec<rusqlite::types::Value> = cols
        .iter()
        .map(|c| sqlite_value_to_json(&row.get(c).cloned().unwrap_or(Value::Null)))
        .collect();
    let bk_val = sqlite_value_to_json(&row.get(bk).cloned().unwrap_or(Value::Null));
    up_params.push(bk_val);
    let up_refs: Vec<&dyn rusqlite::types::ToSql> = up_params.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
    let updated = conn.execute(&update_sql, up_refs.as_slice()).map_err(|e| e.to_string())?;
    if updated == 0 {
        let placeholders = cols.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let insert_sql = format!("INSERT INTO {} ({}) VALUES ({})", table, cols.join(", "), placeholders);
        let vals: Vec<rusqlite::types::Value> = cols
            .iter()
            .map(|c| sqlite_value_to_json(&row.get(c).cloned().unwrap_or(Value::Null)))
            .collect();
        let refs: Vec<&dyn rusqlite::types::ToSql> = vals.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
        conn.execute(&insert_sql, refs.as_slice())
            .map(|_| ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// INSERT OR REPLACE genérico a partir de las columnas del JSON (claves del objeto).
fn upsert_row(conn: &rusqlite::Connection, table: &str, row: &Map<String, Value>) -> Result<(), String> {
    // asistencia: PK local = id autoinc, pero la clave de negocio sincronizable es
    // (estudiante_id, fecha). El id remoto puede chocar con un id local existente, así
    // que se upserta por la clave de negocio y se conserva el id local.
    if table == "asistencia" {
        return upsert_asistencia(conn, row);
    }
    // criterio: la clave de negocio es (indicador_id, orden). El PK `id` puede
    // divergir entre dispositivos; insertar por id creaba DUPLICADOS (mismo
    // indicador/orden con dos ids) al hacer pull tras un import/restore.
    if table == "criterio" {
        return upsert_criterio(conn, row);
    }
    // Catálogo/entidades: reconciliar por la clave de negocio (nombre/codigo) y
    // conservar el id local para no romper los FK que las referencian.
    for (t, bk) in BUSINESS_KEY_TABLES {
        if *t == table {
            return upsert_catalog(conn, table, bk, row);
        }
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

// Inserta filas durante un restore autoritativo conservando los IDs remotos.
// La BD local se limpia antes, así que no hace falta reconciliar por nombre y
// las relaciones con claves compuestas conservan sus referencias originales.
fn insert_restore_row(conn: &rusqlite::Connection, table: &str, row: &Map<String, Value>) -> Result<(), String> {
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
    let get = |k: &str| sqlite_value_to_json(row.get(k).unwrap_or(&Value::Null));
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

// Upsert de criterio por clave de negocio (indicador_id, orden).
// Conserva el id local (las notas referencian criterio_id) y solo actualiza
// los campos editables. Evita duplicados "mismo orden, dos ids" en el pull.
fn upsert_criterio(conn: &rusqlite::Connection, row: &Map<String, Value>) -> Result<(), String> {
    let get = |k: &str| sqlite_value_to_json(row.get(k).unwrap_or(&Value::Null));
    let (ind, orden) = (get("indicador_id"), get("orden"));
    let desc = get("descripcion");
    let puntaje = get("puntaje_maximo");
    let updated_at = get("updated_at");
    conn.execute(
        "INSERT INTO criterio (indicador_id, orden, descripcion, puntaje_maximo, updated_at, id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(indicador_id, orden) DO UPDATE SET
           descripcion = excluded.descripcion,
           puntaje_maximo = excluded.puntaje_maximo,
           updated_at = excluded.updated_at",
        rusqlite::params![ind, orden, desc, puntaje, updated_at, get("id")],
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
        "colegio_grado" if arr.len() >= 2 => {
            "DELETE FROM colegio_grado WHERE colegio_id = ? AND grado_id = ?".to_string()
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
        "sync_pending_deletions_colegio_grado",
    ] {
        let _ = conn.execute(&format!("DELETE FROM {}", t), []);
    }
    Ok(())
}

// ============================================================================
// Comando principal: syncAll (push + pull + apply)
// ============================================================================

/// Sync bilateral: push de lo local + pull de la nube + apply.
///
/// `full = true` ignora los cursores y manda toda la base (cambio de cuenta,
/// importación de un .db). `force = true` ignora el freno de reintentos del
/// push: lo usan los botones manuales del usuario, que si lo pidió él no se
/// espera al próximo ventana.
#[tauri::command]
pub async fn d1_sync_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    full: Option<bool>,
    force: Option<bool>,
) -> Result<Value, String> {
    let force = force.unwrap_or(false);
    // Fase local (síncrona). Se acota el lock en este bloque para que el
    // MutexGuard NO cruce ningún .await (el futuro del comando debe ser Send).
    // Todo el trabajo de BD ocurre aquí, antes de lanzar la red con spawn_blocking.
    let now_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (cfg, push_since, since, data, deletions, esperando_push) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let cfg = read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?;
        let is_full = full.unwrap_or(false);

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
        conn.execute(
            "DELETE FROM sync_recent_pulls WHERE ts < ?1",
            params![now_epoch.saturating_sub(86400)],
        )
        .map_err(|e| e.to_string())?;

        // Cargar conjunto de recién-pullados: clave = "tabla|pk|updated_at"
        let mut recent: std::collections::HashSet<String> = Default::default();
        if !is_full {
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
        // `full` (usado al cambiar de cuenta, antes de borrar) fuerza un push
        // completo ignorando cursores: garantiza que la nube de la cuenta que
        // sale quede 100% al día aunque el último restore haya dejado
        // last_push_sync = now y un push incremental enviaría 0 filas.
        let push_since = if is_full {
            "1970-01-01 00:00:00".to_string()
        } else {
            cfg.last_push_sync
                .clone()
                .unwrap_or_else(|| "1970-01-01 00:00:00".to_string())
        };
        let since = cfg
            .last_sync
            .clone()
            .unwrap_or_else(|| "1970-01-01 00:00:00".to_string());
        println!(
            "[D1] sync INICIO device={}… schoolKey={}… push_since=\"{}\" pull_since=\"{}\"",
            &cfg.device_id[..cfg.device_id.len().min(16)],
            &cfg.school_key[..cfg.school_key.len().min(10)],
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

        // ---- 1. PUSH (cursor local): leer toda la BD local modificada.
        let data = collect_local_data_since(&conn, &push_since, &recent)?;
        let deletions = collect_pending_deletions(&conn)?;
        let esperando_push = push_en_espera(&conn);
        (cfg, push_since, since, data, deletions, esperando_push)
    };

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

    // ---- Freno de reintentos.
    //
    // Si el push anterior falló y todavía estamos dentro de la ventana de
    // espera, se OMITE el push y se sigue solo con el pull (que lee, no escribe,
    // y por tanto no consume la cuota de escrituras). Los cambios pendientes NO
    // se pierden: `last_push_sync` no avanza, así que se reintentan en el
    // primer sync posterior a que venza la espera.
    //
    // Sin esto, un push completo fallido (típicamente por cuota diaria de D1)
    // se reintentaba en CADA trigger —arranque, volver a primer plano, `online`,
    // cambio de pestaña, reconexión del WebSocket, tick de 20 min— y con ~8.000
    // filas por push eso vaciaba la cuota del día entero sin que el usuario
    // hubiera tocado nada. `force` lo reservan los botones manuales.
    let push_omitido = match esperando_push.as_ref() {
        Some(espera) if !force => {
            println!(
                "[D1] push OMITIDO por el freno de reintentos (faltan {}). El pull sigue adelante; \
                 los {} cambios pendientes se reintentan al vencer la espera.",
                espera, total_push
            );
            true
        }
        Some(espera) => {
            println!("[D1] push FORZADO por el usuario (freno activo, quedaban {}).", espera);
            false
        }
        None => false,
    };

    let push_resp: Value = if push_omitido {
        json!({ "ok": true, "applied": {}, "omitidoPorFreno": true })
    } else {
        let push_body = json!({
            "since": push_since,
            "deviceId": cfg.device_id,
            "data": data,
            "deletions": deletions,
        });
        // La red es bloqueante (ureq). Ejecutarla dentro de spawn_blocking para que
        // este comando async SI ceda el hilo: así el loop de eventos que atiende el
        // WebView (Android incluido) no se satura y el modal de progreso no se ve
        // congelado durante los segundos que dura el viaje al Worker.
        let _ = app.emit("d1-sync-progress", json!({ "message": "Subiendo cambios a la nube…" }));
        let intento = tauri::async_runtime::spawn_blocking({
            let cfg = cfg.clone();
            let push_body = push_body.clone();
            move || http_post_json(&cfg.worker_url, &cfg.school_key, "/push", push_body)
        })
        .await
        .map_err(|e| format!("Error en push (hilo): {}", e))?;

        match intento {
            Ok(v) => v,
            Err(e) => {
                // Se registra el fallo ANTES de propagarlo, y con lock propio para
                // no interferir con la transaccion de mas abajo. El sync se aborta
                // aca (no se hace pull) a proposito: el pull podria pisar cambios
                // locales que todavia no se han subido a la nube.
                if let Ok(conn) = state.conn.lock() {
                    let _ = registrar_push_fallido(&conn, &e);
                }
                return Err(e);
            }
        }
    };

    // ---- 2. PULL
    let pull_body = json!({
        "since": since,
        "deviceId": cfg.device_id,
    });
    let _ = app.emit("d1-sync-progress", json!({ "message": "Descargando cambios de la nube…" }));
    let pull_resp = tauri::async_runtime::spawn_blocking({
        let cfg = cfg.clone();
        let pull_body = pull_body.clone();
        move || http_post_json(&cfg.worker_url, &cfg.school_key, "/pull", pull_body)
    })
    .await
    .map_err(|e| format!("Error en pull (hilo): {}", e))??;

    // ---- 3. Apply
    let _ = app.emit("d1-sync-progress", json!({ "message": "Guardando datos localmente…" }));
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

    // El sync llego bien: si venia de un push fallido, el freno se limpia y el
    // proximo sync vuelve a intentarlo con normalidad.
    limpiar_push_fallidos(&tx);

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    let applied = push_resp.get("applied").cloned().unwrap_or(Value::Null);
    println!(
        "[D1] sync FIN device={}… push={:?}{} pull={} tablas ({} filas) del={} nuevo_since=\"{}\"",
        &cfg.device_id[..cfg.device_id.len().min(16)],
        applied,
        if push_omitido { " (OMITIDO)" } else { "" },
        pulled_counts.len(),
        pulled_counts.values().filter_map(|v| v.as_u64()).sum::<u64>(),
        deleted_count,
        new_sync
    );
    Ok(json!({
        "ok": true,
        "pushed": applied,
        "pushOmitido": push_omitido,
        "pulled": pulled_counts,
        "deletedApplied": deleted_count,
        "lastSync": new_sync,
    }))
}
// ============================================================================
// Purga TOTAL de la nube D1 del perfil (school key) — sin tocar la config local
// ----------------------------------------------------------------------------
// Estrategia: /pull completo con un deviceId "probe" (el worker excluye en /pull
// las filas escritas por el propio device_id; con un id distinto devuelve TODO),
// luego /push por lotes con TODAS las PKs como tombstones. El worker borra cada
// fila acotada al namespace (sk) y registra tombstones para que los demás
// dispositivos también las eliminen. Al final, cursores a NULL para que el
// próximo sync sea push+pull completos.
// ============================================================================
#[tauri::command]
pub async fn d1_wipe_remote(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    let cfg = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?
    };

    // ── 1. Pull completo (deviceId probe → no excluye filas propias) ──
    let pull_body = json!({ "since": "1970-01-01 00:00:00", "deviceId": "wipe-probe" });
    let resp = tauri::async_runtime::spawn_blocking({
        let cfg = cfg.clone();
        move || http_post_json(&cfg.worker_url, &cfg.school_key, "/pull", pull_body)
    })
    .await
    .map_err(|e| format!("Error en pull (hilo): {}", e))??;

    // ── 2. Construir la lista de borrados [{tabla, pk}] con PKs en orden ──
    let table_names = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio", "indicador_colegio_seccion_activo",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion",
        "colegio_dias_asistencia", "asistencia", "nota",
        "dia_sin_clases", "app_settings",
    ];
    let mut deletions: Vec<Value> = Vec::new();
    if let Some(rows) = resp.get("rows").and_then(|v| v.as_object()) {
        for table in &table_names {
            if let Some(entries) = rows.get(*table).and_then(|v| v.as_array()) {
                for entry in entries {
                    if let Some(obj) = entry.as_object() {
                        let pk: Vec<Value> = pk_cols(table)
                            .iter()
                            .map(|c| obj.get(*c).cloned().unwrap_or(Value::Null))
                            .collect();
                        deletions.push(json!({ "tabla": table, "pk": pk }));
                    }
                }
            }
        }
    }
    let total = deletions.len();
    println!("[D1] wipe: {} filas a borrar en la nube (device={}…)", total, &cfg.device_id[..cfg.device_id.len().min(16)]);

    // ── 3. Push de tombstones por lotes (el worker crea 2 statements por fila) ──
    for chunk in deletions.chunks(100) {
        let body = json!({ "deviceId": cfg.device_id, "data": {}, "deletions": chunk });
        let _ = tauri::async_runtime::spawn_blocking({
            let cfg = cfg.clone();
            move || http_post_json(&cfg.worker_url, &cfg.school_key, "/push", body)
        })
        .await
        .map_err(|e| format!("Error en push (hilo): {}", e))??;
    }

    // ── 4. Cursores a NULL → el próximo sync será push+pull completos ──
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE d1_config SET last_sync = NULL, last_push_sync = NULL, updated_at = datetime('now') WHERE id = 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    println!("[D1] wipe FIN: nube vaciada ({} filas borradas)", total);
    Ok(json!({ "ok": true, "deleted": total }))
}

// ============================================================================
// Reseteo TOTAL de la nube D1 del perfil (school key): borra TODAS las filas y
// TODOS los tombstones (incluidos los residuales de purgas previas). Se usa
// ANTES de importar un backup completo: sin esto, los tombstones residuales
// (con updated_at más reciente que los datos restaurados) borrarían en el pull
// las filas recién subidas → "los datos desaparecen al refrescar".
// ============================================================================
#[tauri::command]
pub async fn d1_reset_remote(state: tauri::State<'_, DbState>) -> Result<Value, String> {
    let cfg = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?
    };
    let resp = tauri::async_runtime::spawn_blocking({
        let cfg = cfg.clone();
        move || http_post_json(&cfg.worker_url, &cfg.school_key, "/reset", json!({}))
    })
    .await
    .map_err(|e| format!("Error en reset (hilo): {}", e))??;
    // Cursores a NULL → el próximo sync será push+pull completos desde época.
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE d1_config SET last_sync = NULL, last_push_sync = NULL, updated_at = datetime('now') WHERE id = 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    println!("[D1] reset FIN: nube purgada (datos + tombstones)");
    Ok(resp)
}

// ============================================================================
// Restauración autoritativa desde la nube (modo "recuperar / cambiar cuenta")

// ============================================================================
// Restauración autoritativa desde la nube (modo "recuperar / cambiar cuenta")
// ----------------------------------------------------------------------------
// Diferencias con d1_sync_all:
//   * Regenera el device_id de la instalación ANTES del pull. El Worker excluye
//     en /pull las filas escritas por el propio device_id, así que si reusamos
//     el device_id anterior (el que subió originalmente los datos) el pull
//     vendría VACÍO y la recuperación fallaría en silencio.
//   * BORRA todas las tablas locales (incluidas las de catálogo con UNIQUE)
//     antes de aplicar, de modo que el pull sea la fuente de verdad y no
//     colisione por ids distintos en columnas UNIQUE (p. ej. corte_evaluativo.nombre).
//   * NO hace push: es una restauración nube→local, no una mezcla.
// ============================================================================
#[tauri::command]
pub async fn d1_restore_from_cloud(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<Value, String> {
    let now_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // 1) Config: regenerar device_id y anular cursores para un pull completo.
    let cfg = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let mut cfg = read_config(&conn)?.ok_or_else(|| "D1 no está configurado".to_string())?;
        cfg.device_id = generate_device_id();
        cfg.last_sync = None;
        cfg.last_push_sync = None;
        write_config(&conn, &cfg)?;
        cfg
    };
    println!(
        "[D1] restore INICIO device={}… (regenerado) schoolKey={}…",
        &cfg.device_id[..cfg.device_id.len().min(16)],
        &cfg.school_key[..cfg.school_key.len().min(8)]
    );

    // 2) PULL completo PRIMERO (el device_id nuevo trae TODAS las filas de la
    // nube). Si el pull falla, la BD local queda intacta.
    let pull_body = json!({
        "since": "1970-01-01 00:00:00",
        "deviceId": cfg.device_id,
    });
    let _ = app.emit("d1-sync-progress", json!({ "message": "Descargando datos de la nube…" }));
    let pull_resp = tauri::async_runtime::spawn_blocking({
        let cfg = cfg.clone();
        let pull_body = pull_body.clone();
        move || http_post_json(&cfg.worker_url, &cfg.school_key, "/pull", pull_body)
    })
    .await
    .map_err(|e| format!("Error en pull (hilo): {}", e))??;

    // 3) Aplicar en UNA sola transacción como restore autoritativo. Se limpian
    // los datos locales antes de insertar y se conservan los IDs remotos;
    // así las relaciones (colegio_grado, estudiantes, notas, etc.) siguen
    // apuntando a los mismos catálogos que en la nube.
    let _ = app.emit("d1-sync-progress", json!({ "message": "Guardando datos localmente…" }));
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for table in [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "indicador", "criterio", "indicador_colegio_seccion_activo",
        "estudiante", "configuracion_calificacion", "multiplicador_calificacion",
        "colegio_dias_asistencia", "asistencia", "nota", "dia_sin_clases", "app_settings",
    ] {
        tx.execute(&format!("DELETE FROM {}", table), [])
            .map_err(|e| format!("Error limpiando {}: {}", table, e))?;
    }

    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_recent_pulls (
            tabla TEXT NOT NULL, pk TEXT NOT NULL, updated_at TEXT NOT NULL, ts INTEGER NOT NULL,
            PRIMARY KEY (tabla, pk)
        );",
    )
    .map_err(|e| e.to_string())?;
    // Limpiar solo la memoria anti re-relevo (no las tablas de datos): cada
    // pull regenera el device_id, así que las filas pulled no deben re-enviarse.
    tx.execute("DELETE FROM sync_recent_pulls", [])
        .map_err(|e| e.to_string())?;

    let mut pulled_counts: Map<String, Value> = Map::new();
    if let Some(rows) = pull_resp.get("rows").and_then(|v| v.as_object()) {
        for (table, arr) in rows {
            if let Some(entries) = arr.as_array() {
                let mut n = 0;
                for entry in entries {
                    if let Some(obj) = entry.as_object() {
                        insert_restore_row(&tx, table, obj)?;
                        tx.execute(
                            "INSERT INTO sync_recent_pulls (tabla, pk, updated_at, ts)
                             VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT(tabla, pk) DO UPDATE SET updated_at = excluded.updated_at, ts = excluded.ts",
                            params![table, pk_part(table, obj), obj.get("updated_at").and_then(|v| v.as_str()).unwrap_or(""), now_epoch],
                        )
                        .map_err(|e| e.to_string())?;
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
            let dev = d.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
            if dev == cfg.device_id {
                continue;
            }
            delete_by_pk(&tx, tabla, &pk)?;
            deleted_count += 1;
        }
    }

    let new_sync = pull_resp
        .get("serverTime")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(now_sqlite);
    let new_push_cursor = now_sqlite();
    tx.execute(
        "UPDATE d1_config SET last_sync = ?1, last_push_sync = ?2, updated_at = datetime('now') WHERE id = 1",
        params![new_sync, new_push_cursor],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    let _ = app.emit("schooltracker-sync", json!({ "source": "restore" }));
    let _ = app.emit("data-updated", json!({ "source": "restore" }));

    let pulled_total: u64 = pulled_counts.values().filter_map(|v| v.as_u64()).sum();
    let pulled_detail: Vec<String> = pulled_counts
        .iter()
        .map(|(t, n)| format!("{}:{}", t, n.as_u64().unwrap_or(0)))
        .collect();
    println!(
        "[D1] restore FIN device={}… schoolKey={}… pull={} tablas ({} filas) [{}] del={} nuevo_since=\"{}\"",
        &cfg.device_id[..cfg.device_id.len().min(16)],
        &cfg.school_key[..cfg.school_key.len().min(10)],
        pulled_counts.len(),
        pulled_total,
        pulled_detail.join(", "),
        deleted_count,
        new_sync
    );
    Ok(json!({
        "ok": true,
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
