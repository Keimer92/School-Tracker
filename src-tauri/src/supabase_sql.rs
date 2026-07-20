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
    let mut direct_err: Option<String> = None;
    if let Some(first) = connection_strings.first() {
        match try_connect(first, &sql).await {
            Ok(ok) => return Ok(ok),
            Err(e) => direct_err = Some(e),
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
        return Err(direct_err.unwrap_or_else(|| {
            "No se pudo conectar a Postgres (sin password/configuración de BD).".to_string()
        }));
    }

    match select_ok(pooler_attempts).await {
        Ok((result, _rest)) => Ok(result),
        Err(err) => Err(format!(
            "No se pudo conectar a Postgres con ninguna configuración: {}",
            err
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pct_encode(s: &str) -> String {
        let mut out = String::new();
        for c in s.chars() {
            match c {
                '@' => out.push_str("%40"),
                ':' => out.push_str("%3A"),
                '/' => out.push_str("%2F"),
                '%' => out.push_str("%25"),
                '?' => out.push_str("%3F"),
                '#' => out.push_str("%23"),
                _ => out.push(c),
            }
        }
        out
    }

    #[tokio::test]
    #[ignore]
    async fn verify_supabase_connectivity_and_ddl() {
        let url = std::env::var("VITE_SUPABASE_URL").expect("VITE_SUPABASE_URL");
        let pw = std::env::var("VITE_SUPABASE_DB_PASSWORD").expect("VITE_SUPABASE_DB_PASSWORD");
        let cleaned = url
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        let ref_part = cleaned.split(".supabase").next().unwrap_or("");
        let enc = pct_encode(&pw);
        let direct = format!(
            "postgresql://postgres:{}@db.{}.supabase.co:5432/postgres?sslmode=require",
            enc, ref_part
        );
        let regions = [
            "aws-0-us-east-1", "aws-0-us-east-2", "aws-0-us-west-1", "aws-0-us-west-2",
            "aws-0-ca-central-1", "aws-0-eu-west-1", "aws-0-eu-west-2", "aws-0-eu-west-3",
            "aws-0-eu-central-1", "aws-0-eu-north-1", "aws-0-ap-south-1",
            "aws-0-ap-southeast-1", "aws-0-ap-southeast-2", "aws-0-ap-northeast-1",
            "aws-0-ap-northeast-2", "aws-0-sa-east-1", "aws-0-af-south-1",
        ];
        let mut conn_strings = vec![direct];
        for r in regions {
            conn_strings.push(format!(
                "postgresql://postgres.{}:{}@{}.pooler.supabase.com:6543/postgres?sslmode=require",
                ref_part, enc, r
            ));
        }

        let r = supabase_execute_sql(
            conn_strings,
            "CREATE TABLE IF NOT EXISTS _st_verify (id SERIAL PRIMARY KEY); DROP TABLE IF EXISTS _st_verify;".to_string(),
        )
        .await;
        println!("RESULT: {:?}", r);
        assert!(r.is_ok(), "Conexión/DDL falló: {:?}", r);
    }
}

