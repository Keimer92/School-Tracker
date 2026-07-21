// Comando para ejecutar SQL directo en Postgres de Supabase (crear tablas automáticamente).
// En este flujo solo intentamos la configuración provista por el usuario; si falla,
// devolvemos el error real en vez de probar poolers que suelen provocar errores
// de tenant/user y confundir el diagnóstico.
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use tokio::time::timeout;

async fn try_connect(cs: &str, sql: &str) -> Result<String, String> {
    let pool = timeout(Duration::from_secs(8), PgPoolOptions::new().max_connections(1).connect(cs))
        .await
        .map_err(|_| "timeout de conexión".to_string())?
        .map_err(|e| e.to_string())?;
    sqlx::query(sql)
        .execute(&pool)
        .await
        .map(|_| "OK".to_string())
        .map_err(|e| format!("Error ejecutando SQL: {}", e))
}

/// Prueba todas las connection strings en orden y retorna la primera que funcione.
async fn try_all_connect(connection_strings: &[String], sql: &str) -> Result<String, String> {
    let mut errors: Vec<String> = Vec::new();
    for (i, cs) in connection_strings.iter().enumerate() {
        match try_connect(cs, sql).await {
            Ok(ok) => return Ok(ok),
            Err(e) => {
                errors.push(format!("[cs {}] {}", i, e));
            }
        }
    }
    Err(format!(
        "No se pudo conectar a Postgres con ninguna de las {} configuraciones: {}",
        connection_strings.len(),
        errors.join(" | ")
    ))
}

#[tauri::command]
pub async fn supabase_execute_sql(connection_strings: Vec<String>, sql: String) -> Result<String, String> {
    if connection_strings.is_empty() {
        return Err("No se pudo conectar a Postgres (sin password/configuración de BD).".to_string());
    }
    try_all_connect(&connection_strings, &sql).await
}

async fn try_select_json(cs: &str, sql: &str) -> Result<String, String> {
    let pool = timeout(Duration::from_secs(8), PgPoolOptions::new().max_connections(1).connect(cs))
        .await
        .map_err(|_| "timeout de conexión".to_string())?
        .map_err(|e| e.to_string())?;

    // Wrap in json_agg(row_to_json(...)) for a portable JSON array result
    let wrapped = format!(
        "SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM ({}) t",
        sql.trim_end_matches(';')
    );

    let result: serde_json::Value = sqlx::query_scalar(&wrapped)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Error ejecutando SELECT: {}", e))?;

    Ok(result.to_string())
}

/// Prueba todas las connection strings en orden y retorna la primera que funcione.
async fn try_all_select_json(connection_strings: &[String], sql: &str) -> Result<String, String> {
    let mut errors: Vec<String> = Vec::new();
    for (i, cs) in connection_strings.iter().enumerate() {
        match try_select_json(cs, sql).await {
            Ok(ok) => return Ok(ok),
            Err(e) => {
                errors.push(format!("[cs {}] {}", i, e));
            }
        }
    }
    Err(format!(
        "No se pudo consultar Postgres con ninguna de las {} configuraciones: {}",
        connection_strings.len(),
        errors.join(" | ")
    ))
}

#[tauri::command]
pub async fn supabase_select_json(connection_strings: Vec<String>, sql: String) -> Result<String, String> {
    if connection_strings.is_empty() {
        return Err("No se pudo conectar a Postgres (sin password/configuración de BD).".to_string());
    }
    try_all_select_json(&connection_strings, &sql).await
}
