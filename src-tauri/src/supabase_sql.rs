// Comando para ejecutar SQL directo en Postgres de Supabase (crear tablas automáticamente)
use sqlx::postgres::PgPoolOptions;

#[tauri::command]
async fn supabase_execute_sql(connection_string: String, sql: String) -> Result<String, String> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&connection_string)
        .await
        .map_err(|e| format!("Error conectando a Postgres: {}", e))?;

    sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Error ejecutando SQL: {}", e))?;

    Ok("OK".to_string())
}
