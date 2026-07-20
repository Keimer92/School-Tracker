// Comando para ejecutar SQL directo en Postgres de Supabase (crear tablas automáticamente)
// Prueba múltiples connection strings: directo (db.<ref>.supabase.co:5432) y luego
// el connection pooler por región (aws-0-<region>.pooler.supabase.com:6543).
use futures::future::select_ok;
use sqlx::postgres::PgPoolOptions;
use std::future::Future;
use std::pin::Pin;
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

type BoxedFuture = Pin<Box<dyn Future<Output = Result<String, String>> + Send>>;

#[tauri::command]
pub async fn supabase_execute_sql(connection_strings: Vec<String>, sql: String) -> Result<String, String> {
    // Probar el primero (generalmente el directo) de forma secuencial rápida
    if let Some(first) = connection_strings.first() {
        if let Ok(ok) = try_connect(first, &sql).await {
            return Ok(ok);
        }
    }

    // Si el directo falla, intentar los poolers en paralelo y quedarnos con el primero que conecte
    let pooler_attempts: Vec<BoxedFuture> = connection_strings
        .iter()
        .skip(1)
        .map(|cs| {
            let cs = cs.clone();
            let sql = sql.clone();
            Box::pin(async move { try_connect(&cs, &sql).await }) as BoxedFuture
        })
        .collect();

    if pooler_attempts.is_empty() {
        return Err("No se pudo conectar a Postgres (sin password/configuración de BD).".to_string());
    }

    match select_ok(pooler_attempts).await {
        Ok((result, _rest)) => Ok(result),
        Err(err) => Err(format!(
            "No se pudo conectar a Postgres con ninguna configuración: {}",
            err
        )),
    }
}
