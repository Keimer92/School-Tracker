// Comando para ejecutar SQL directo en Postgres de Supabase (crear tablas automáticamente).
// En este flujo solo intentamos la configuración provista por el usuario; si falla,
// devolvemos el error real en vez de probar poolers que suelen provocar errores
// de tenant/user y confundir el diagnóstico.
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use tokio::time::timeout;

async fn try_connect(cs: &str, sql: &str) -> Result<String, String> {
    let pool = timeout(Duration::from_secs(5), PgPoolOptions::new().max_connections(1).connect(cs))
        .await
        .map_err(|_| "timeout de conexión".to_string())?
        .map_err(|e| e.to_string())?;
    sqlx::query(sql)
        .execute(&pool)
        .await
        .map(|_| "OK".to_string())
        .map_err(|e| format!("Error ejecutando SQL: {}", e))
}

#[tauri::command]
pub async fn supabase_execute_sql(connection_strings: Vec<String>, sql: String) -> Result<String, String> {
    if let Some(first) = connection_strings.first() {
        match try_connect(first, &sql).await {
            Ok(ok) => return Ok(ok),
            Err(e) => {
                return Err(format!(
                    "No se pudo conectar a Postgres con la configuración proporcionada: {}",
                    e
                ));
            }
        }
    }

    Err("No se pudo conectar a Postgres (sin password/configuración de BD).".to_string())
}
