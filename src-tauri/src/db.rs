use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryItem {
    pub id: Option<i64>,
    pub nombre: String,
    pub activo: Option<bool>,
    pub cualitativo: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Student {
    pub id: Option<i64>,
    pub nombre: String,
    pub codigo: String,
    pub sexo: String,
    pub ano_lectivo_id: i64,
    pub grado_id: i64,
    pub seccion_id: i64,
    pub colegio_id: i64,
    pub foto: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PromoteResult {
    pub promoted: i64,
    pub graduated: i64,
    #[serde(default)]
    pub pending_sixth_graders: Vec<PendingSixthGrader>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingSixthGrader {
    pub estudiante_id: i64,
    pub nombre: String,
    pub colegio_origen_id: i64,
    pub colegio_origen_nombre: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColegioInfo {
    pub id: i64,
    pub nombre: String,
    pub tipo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Criterio {
    pub id: Option<i64>,
    pub indicador_id: Option<i64>,
    pub orden: i64,
    pub descripcion: String,
    pub puntaje_maximo: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Indicador {
    pub id: Option<i64>,
    pub grado_id: i64,
    pub asignatura_id: i64,
    pub corte_evaluativo_id: i64,
    pub ano_lectivo_id: i64,
    pub orden: i64,
    pub descripcion: String,
    pub activo: bool,
    pub instrumento: String,
    pub criterios: Vec<Criterio>,
}

pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

/// Inicializa la base de datos creando todas las tablas necesarias.
/// Esta funciÃ³n es idempotente: usa CREATE TABLE IF NOT EXISTS.
pub fn init_database(conn: &Connection) -> Result<(), String> {
    println!("ðŸ”„ [DB] Inicializando base de datos...");
    
    // Tablas de categorÃ­as
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ano_lectivo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            activo INTEGER DEFAULT 0,
            cualitativo INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS corte_evaluativo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            activo INTEGER DEFAULT 0,
            cualitativo INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS colegio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            activo INTEGER DEFAULT 0,
            cualitativo INTEGER DEFAULT 0,
            orden INTEGER DEFAULT 0,
            tipo TEXT DEFAULT 'Primaria',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS asignatura (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            cualitativo INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS grado (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            cualitativo INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS seccion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            cualitativo INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS d1_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            worker_url TEXT NOT NULL DEFAULT '',
            school_key TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            last_sync TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS d1_id_blocks (
            tabla TEXT PRIMARY KEY,
            next_id INTEGER NOT NULL DEFAULT 0,
            end_id INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        "#,
    )
    .map_err(|e| format!("Error creando tablas de categorÃ­as: {}", e))?;

    // Tabla de estudiantes (estructura unificada)
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS estudiante (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            codigo TEXT NOT NULL UNIQUE,
            sexo TEXT CHECK(sexo IN ('M', 'F')) NOT NULL,
            ano_lectivo_id INTEGER NOT NULL,
            grado_id INTEGER NOT NULL,
            seccion_id INTEGER NOT NULL,
            colegio_id INTEGER NOT NULL,
            foto TEXT,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(ano_lectivo_id) REFERENCES ano_lectivo(id),
            FOREIGN KEY(grado_id) REFERENCES grado(id),
            FOREIGN KEY(seccion_id) REFERENCES seccion(id),
            FOREIGN KEY(colegio_id) REFERENCES colegio(id)
        );
        "#,
    )
    .map_err(|e| format!("Error creando tabla estudiante: {}", e))?;

    // Tablas de relaciones muchos a muchos
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS grado_asignatura (
            grado_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (grado_id, asignatura_id),
            FOREIGN KEY(grado_id) REFERENCES grado(id) ON DELETE CASCADE,
            FOREIGN KEY(asignatura_id) REFERENCES asignatura(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS colegio_asignatura (
            colegio_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (colegio_id, asignatura_id),
            FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE,
            FOREIGN KEY(asignatura_id) REFERENCES asignatura(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS colegio_grado (
            colegio_id INTEGER NOT NULL,
            grado_id INTEGER NOT NULL,
            activo INTEGER DEFAULT 1,
            cualitativo INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (colegio_id, grado_id),
            FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE,
            FOREIGN KEY(grado_id) REFERENCES grado(id) ON DELETE CASCADE
        );
        "#,
    )
    .map_err(|e| format!("Error creando tablas de relaciones: {}", e))?;

    // Tablas de evaluaciones
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS indicador (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grado_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            corte_evaluativo_id INTEGER NOT NULL,
            ano_lectivo_id INTEGER NOT NULL DEFAULT 0,
            orden INTEGER NOT NULL,
            descripcion TEXT DEFAULT '',
            activo INTEGER DEFAULT 1,
            instrumento TEXT NOT NULL DEFAULT 'general',
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(grado_id) REFERENCES grado(id),
            FOREIGN KEY(asignatura_id) REFERENCES asignatura(id),
            FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id),
            FOREIGN KEY(ano_lectivo_id) REFERENCES ano_lectivo(id)
        );

        CREATE TABLE IF NOT EXISTS criterio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            indicador_id INTEGER NOT NULL,
            orden INTEGER NOT NULL,
            descripcion TEXT DEFAULT '',
            puntaje_maximo INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(indicador_id) REFERENCES indicador(id) ON DELETE CASCADE,
            UNIQUE(indicador_id, orden)
        );

        -- Bandera de "suma al total" POR COLEGIO Y SECCION. El indicador
        -- (descripcion y puntos) es global por grado/asignatura/corte/ano; esta
        -- tabla solo guarda la excepcion. Si no hay fila para un colegio/seccion,
        -- manda el `indicador.activo` global como valor por defecto.
        CREATE TABLE IF NOT EXISTS indicador_colegio_seccion_activo (
            colegio_id INTEGER NOT NULL,
            seccion_id INTEGER NOT NULL,
            indicador_id INTEGER NOT NULL,
            activo INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (colegio_id, seccion_id, indicador_id),
            FOREIGN KEY(indicador_id) REFERENCES indicador(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ind_colegio_seccion
            ON indicador_colegio_seccion_activo(colegio_id, seccion_id, indicador_id);
        "#,
    )
    .map_err(|e| format!("Error creando tablas de evaluaciones: {}", e))?;

    // Tablas de asistencia
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS asistencia (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            estudiante_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            estado TEXT CHECK(estado IN ('P', 'A', 'J')) NOT NULL,
            observacion TEXT,
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(estudiante_id, fecha),
            FOREIGN KEY(estudiante_id) REFERENCES estudiante(id) ON DELETE CASCADE
        );

    CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (
    colegio_id INTEGER PRIMARY KEY,
    lunes INTEGER DEFAULT 1,
    martes INTEGER DEFAULT 1,
    miercoles INTEGER DEFAULT 1,
    jueves INTEGER DEFAULT 1,
    viernes INTEGER DEFAULT 1,
    sabado INTEGER DEFAULT 0,
    domingo INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE
    );


        CREATE TABLE IF NOT EXISTS dia_sin_clases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            colegio_id INTEGER NOT NULL,
            grado_id INTEGER,
            seccion_id INTEGER,
            fecha TEXT NOT NULL,
            descripcion TEXT NOT NULL DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE,
            FOREIGN KEY(grado_id) REFERENCES grado(id) ON DELETE CASCADE,
            FOREIGN KEY(seccion_id) REFERENCES seccion(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_dia_sin_clases_unica
            ON dia_sin_clases(colegio_id, IFNULL(grado_id, 0), IFNULL(seccion_id, 0), fecha);
        "#,
    )
    .map_err(|e| format!("Error creando tablas de asistencia: {}", e))?;

    // Tabla de notas
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS nota (
            estudiante_id INTEGER NOT NULL,
            criterio_id INTEGER NOT NULL,
            valor REAL NOT NULL,
            corte_evaluativo_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id),
            FOREIGN KEY(estudiante_id) REFERENCES estudiante(id) ON DELETE CASCADE,
            FOREIGN KEY(criterio_id) REFERENCES criterio(id) ON DELETE CASCADE,
            FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id),
            FOREIGN KEY(asignatura_id) REFERENCES asignatura(id)
        );
        "#,
    )
    .map_err(|e| format!("Error creando tabla nota: {}", e))?;

    // Tabla de configuraciÃ³n de calificaciones
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS configuracion_calificacion (
            id TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            color TEXT NOT NULL,
            minimo INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        "#,
    )
    .map_err(|e| format!("Error creando tabla configuracion_calificacion: {}", e))?;

    // Tablas de sincronizaciÃ³n
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sync_pending_deletions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tabla TEXT NOT NULL,
            registro_id INTEGER NOT NULL,
            fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pending_deletions_asistencia (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            estudiante_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pending_deletions_nota (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            estudiante_id INTEGER NOT NULL,
            criterio_id INTEGER NOT NULL,
            corte_evaluativo_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS multiplicador_calificacion (
            id TEXT PRIMARY KEY,
            multiplicador REAL NOT NULL DEFAULT 1.0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sync_pending_deletions_grado_asignatura (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grado_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pending_deletions_colegio_asignatura (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            colegio_id INTEGER NOT NULL,
            asignatura_id INTEGER NOT NULL,
            fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pending_deletions_colegio_grado (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            colegio_id INTEGER NOT NULL,
            grado_id INTEGER NOT NULL,
            fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .map_err(|e| format!("Error creando tablas de sincronización: {}", e))?;

    // Tabla de configuración de la app (key-value, sincronizable)
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now'))
        );
        "#,
    )
    .map_err(|e| format!("Error creando tabla app_settings: {}", e))?;

// Migraciones para bases de datos existentes (agregar columnas faltantes)
    // NOTA: Los datos iniciales NO se siembran aquí. Se siembran bajo demanda
    // desde el frontend después de verificar si ya existen datos locales.
    // Esto evita crear datos por defecto cuando ya hay datos guardados.
    migrate_add_columns(conn)?;
    deduplicate_criteria(conn)?;
    cleanup_orphan_relations(conn)?;

    println!("âœ… [DB] Base de datos inicializada correctamente");
    Ok(())
}

/// Elimina filas de relación que apuntan a catálogos eliminados (huérfanas).
///
/// Los dispositivos pueden recibirlas por pull si la nube tuvo filas de
/// épocas anteriores (p. ej. `colegio_grado` de un colegio que ya no existe,
/// o `grado_asignatura` de asignaturas borradas por el usuario). Sin FK
/// enforcement en la fase de aplicación del sync, estas filas persisten y
/// los JOIN de selectores pueden "cruzar" colegios/grados/asignaturas.
/// Es idempotente: tras limpiar la nube, el pull ya no las re-introduce.
fn cleanup_orphan_relations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        DELETE FROM colegio_grado WHERE colegio_id NOT IN (SELECT id FROM colegio);
        DELETE FROM colegio_asignatura
            WHERE colegio_id NOT IN (SELECT id FROM colegio)
               OR asignatura_id NOT IN (SELECT id FROM asignatura);
        DELETE FROM grado_asignatura
            WHERE grado_id NOT IN (SELECT id FROM grado)
               OR asignatura_id NOT IN (SELECT id FROM asignatura);
        DELETE FROM indicador_colegio_seccion_activo
            WHERE indicador_id NOT IN (SELECT id FROM indicador)
               OR seccion_id NOT IN (SELECT id FROM seccion)
               OR colegio_id NOT IN (SELECT id FROM colegio);
        "#,
    )
    .map_err(|e| format!("Error limpiando relaciones huérfanas: {}", e))?;
    Ok(())
}

/// Agrega columnas faltantes a tablas existentes (para migraciones de bases de datos antiguas)
fn migrate_add_columns(conn: &Connection) -> Result<(), String> {
    // Cursor de PUSH separado del cursor de PULL en d1_config (reloj local vs servidor)
    let has_last_push: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('d1_config') WHERE name = 'last_push_sync'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_last_push {
        conn.execute(
            "ALTER TABLE d1_config ADD COLUMN last_push_sync TEXT",
            [],
        )
        .map_err(|e| format!("Error agregando columna last_push_sync: {}", e))?;
    }

    // Agregar columna 'minimo' a configuracion_calificacion si no existe
    let has_instrumento: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('indicador') WHERE name = 'instrumento'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_instrumento {
        conn.execute(
            "ALTER TABLE indicador ADD COLUMN instrumento TEXT NOT NULL DEFAULT 'general'",
            [],
        )
        .map_err(|e| format!("Error agregando columna instrumento: {}", e))?;
    }
    // 'general' retirado como tipo: las filas históricas pasan a escala
    conn.execute(
        "UPDATE indicador SET instrumento = 'escala' WHERE instrumento = 'general'",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Agregar columna 'ano_lectivo_id' a indicador si no existe
    let has_ano_lectivo: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('indicador') WHERE name = 'ano_lectivo_id'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_ano_lectivo {
        conn.execute(
            "ALTER TABLE indicador ADD COLUMN ano_lectivo_id INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Error agregando columna ano_lectivo_id: {}", e))?;

        // Backfill: indicators with ano_lectivo_id = 0 belong to the active year.
        // Move them so get_evaluation_config finds them when filtering by real ano_id.
        conn.execute(
            "UPDATE indicador SET ano_lectivo_id = (SELECT id FROM ano_lectivo WHERE activo = 1 LIMIT 1) WHERE ano_lectivo_id = 0",
            [],
        ).ok();
    }

    // Migrate indicators stuck at ano_lectivo_id=0 to the active year.
    // This is a safe, idempotent UPDATE — no DELETEs, no re-parenting.
    conn.execute(
        "UPDATE indicador SET ano_lectivo_id = (SELECT id FROM ano_lectivo WHERE activo = 1 LIMIT 1) WHERE ano_lectivo_id = 0 AND EXISTS (SELECT 1 FROM ano_lectivo WHERE activo = 1)",
        [],
    ).ok();

    // Agregar columna 'minimo' a configuracion_calificacion si no existe
    let has_minimo: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('configuracion_calificacion') WHERE name = 'minimo'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_minimo {
        conn.execute(
            "ALTER TABLE configuracion_calificacion ADD COLUMN minimo INTEGER DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Error agregando columna minimo: {}", e))?;
    }

    // Agregar columna 'nombre' a configuracion_calificacion si no existe
    let has_nombre: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('configuracion_calificacion') WHERE name = 'nombre'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_nombre {
        conn.execute(
            "ALTER TABLE configuracion_calificacion ADD COLUMN nombre TEXT DEFAULT ''",
            [],
        )
        .map_err(|e| format!("Error agregando columna nombre: {}", e))?;
        
        // Actualizar nombres para registros existentes
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Avanzado' WHERE id = 'AA'", []).ok();
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Satisfactorio' WHERE id = 'AS'", []).ok();
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Fundamental' WHERE id = 'AF'", []).ok();
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Inicial' WHERE id = 'AI'", []).ok();
        
        // Para registros old
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Avanzado' WHERE id = 'destacado'", []).ok();
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Satisfactorio' WHERE id = 'satisfactorio'", []).ok();
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Fundamental' WHERE id = 'basico'", []).ok();
        conn.execute("UPDATE configuracion_calificacion SET nombre = 'Aprendizaje Inicial' WHERE id = 'insuficiente'", []).ok();
    }

    // Agregar columna 'activo' a colegio si no existe
    let has_activo_colegio: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('colegio') WHERE name = 'activo'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_activo_colegio {
        conn.execute(
            "ALTER TABLE colegio ADD COLUMN activo INTEGER DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Error agregando columna activo a colegio: {}", e))?;
    }

    // Agregar columna 'tipo' a colegio si no existe
    let has_tipo_colegio: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('colegio') WHERE name = 'tipo'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_tipo_colegio {
        conn.execute(
            "ALTER TABLE colegio ADD COLUMN tipo TEXT DEFAULT 'Primaria'",
            [],
        )
        .map_err(|e| format!("Error agregando columna tipo a colegio: {}", e))?;
    }

    // Sembrar multiplicadores por defecto si la tabla estÃ¡ vacÃ­a
    let has_multiplicadores: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM multiplicador_calificacion",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !has_multiplicadores {
        let defaults = vec![
            ("AA", 1.0),
            ("AS", 0.85),
            ("AF", 0.65),
            ("AI", 0.40),
        ];
        for (id, mult) in defaults {
            conn.execute(
                "INSERT OR IGNORE INTO multiplicador_calificacion (id, multiplicador) VALUES (?, ?)",
                rusqlite::params![id, mult],
            ).ok();
        }
        println!("âœ… [DB] Multiplicadores de criterios sembrados (migraciÃ³n)");
    }

    // MigraciÃ³n: agregar columna updated_at a todas las tablas que sincronizan
    let tables_updated_at = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "estudiante", "indicador", "criterio", "asistencia", "colegio_dias_asistencia", "dia_sin_clases",
        "nota", "configuracion_calificacion", "multiplicador_calificacion",
        "grado_asignatura", "colegio_asignatura", "colegio_grado",
    ];
    for table in &tables_updated_at {
        let has_col: bool = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = 'updated_at'"),
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) > 0;
        if !has_col {
            // SQLite no permite DEFAULT con expresiÃ³n en ALTER TABLE,
            // asÃ­ que agregamos sin default (nuevos registros usan DEFAULT de CREATE TABLE)
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT"),
                [],
            )
            .map_err(|e| format!("Error agregando updated_at a {table}: {e}"))?;
            // Backfill de una sola vez: las filas existentes quedan con NULL y el
            // chequeo de cambios locales (`has_local_changes`) no las detectarÃ­a.
            conn.execute(
                &format!("UPDATE {table} SET updated_at = datetime('now') WHERE updated_at IS NULL"),
                [],
            )
            .map_err(|e| format!("Error actualizando updated_at en {table}: {e}"))?;
            println!("âœ… [DB] Columna updated_at agregada a {table}");
        }
    }

    // Migración: dia_sin_clases ahora incluye grado_id (alcance = sección DE un grado).
    // La tabla es nueva y solo contenía marcas de prueba; si tiene el shape viejo
    // (sin grado_id) se recrea limpia para mantener el índice único correcto.
    {
        let has_grado: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('dia_sin_clases') WHERE name = 'grado_id'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dia_sin_clases'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if table_exists > 0 && has_grado == 0 {
            conn.execute("DROP TABLE dia_sin_clases", [])
                .map_err(|e| format!("Error eliminando dia_sin_clases obsoleta: {e}"))?;
            conn.execute_batch(
                r#"
                CREATE TABLE dia_sin_clases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    colegio_id INTEGER NOT NULL,
                    grado_id INTEGER,
                    seccion_id INTEGER,
                    fecha TEXT NOT NULL,
                    descripcion TEXT NOT NULL DEFAULT '',
                    updated_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE,
                    FOREIGN KEY(grado_id) REFERENCES grado(id) ON DELETE CASCADE,
                    FOREIGN KEY(seccion_id) REFERENCES seccion(id) ON DELETE CASCADE
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_dia_sin_clases_unica
                    ON dia_sin_clases(colegio_id, IFNULL(grado_id, 0), IFNULL(seccion_id, 0), fecha);
                "#,
            )
            .map_err(|e| format!("Error recreando dia_sin_clases: {e}"))?;
            println!("✅ [DB] dia_sin_clases recreada con grado_id");
        }
    }

    // Backfill colegio_grado: asignar grados por tipo a colegios existentes.
    // Primaria → grados 1-6, Secundaria → grados 7-11 (todos activos, cualitativo heredado del grado).
    {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('colegio_grado') WHERE name = 'colegio_id'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);
        if count > 0 {
            let colegios: Vec<(i64, String)> = {
                let mut stmt = conn
                    .prepare("SELECT id, COALESCE(tipo, 'Primaria') FROM colegio")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                rows
            };
            for (colegio_id, tipo) in &colegios {
                seed_colegio_grados(conn, *colegio_id, tipo)?;
            }
            println!("✅ [DB] colegio_grado poblada para {} colegios", colegios.len());
        }
    }

    Ok(())
}

/// Siembra los grados correspondientes al tipo de un colegio en `colegio_grado`
/// (INSERT OR IGNORE: no toca grados ya configurados manualmente).
fn seed_colegio_grados(conn: &Connection, colegio_id: i64, tipo: &str) -> Result<(), String> {
    let (min_grado, max_grado) = if tipo == "Secundaria" {
        (7i64, 11i64)
    } else {
        (1i64, 6i64)
    };
    let mut stmt = conn
        .prepare("SELECT id, cualitativo FROM grado")
        .map_err(|e| e.to_string())?;
    let grados: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for (grado_id, cualitativo) in grados {
        let n = parse_grade_number(conn, grado_id);
        if let Some(num) = n {
            if num >= min_grado && num <= max_grado {
                conn.execute(
                    "INSERT OR IGNORE INTO colegio_grado (colegio_id, grado_id, activo, cualitativo, updated_at) VALUES (?, ?, 1, ?, datetime('now'))",
                    rusqlite::params![colegio_id, grado_id, cualitativo],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Parsea el número inicial del nombre del grado ("1er grado" → 1).
fn parse_grade_number(conn: &Connection, grado_id: i64) -> Option<i64> {
    let mut stmt = conn
        .prepare("SELECT nombre FROM grado WHERE id = ?")
        .ok()?;
    let name: Option<String> = stmt.query_row([grado_id], |row| row.get(0)).ok();
    drop(stmt);
    let nombre = name?;
    let stripped = nombre.replace(" grado", "").replace("Grado", "");
    let clean: String = stripped.chars().take_while(|c| c.is_ascii_digit()).collect();
    clean.parse::<i64>().ok()
}

/// Indicador con criterios anómalos (COUNT<>3, órdenes duplicados o gaps).
fn criteria_need_repair(conn: &Connection, ind_id: i64) -> Result<bool, String> {
    let (cnt, distinct_o, in_range, distinct_in_range, dup_groups) = conn
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM criterio WHERE indicador_id = ?1),
               (SELECT COUNT(DISTINCT orden) FROM criterio WHERE indicador_id = ?1),
               (SELECT COUNT(*) FROM criterio WHERE indicador_id = ?1 AND orden BETWEEN 1 AND 3),
               (SELECT COUNT(DISTINCT orden) FROM criterio WHERE indicador_id = ?1 AND orden BETWEEN 1 AND 3),
               (SELECT COUNT(*) FROM (SELECT orden FROM criterio WHERE indicador_id = ?1 GROUP BY orden HAVING COUNT(*) > 1))",
            [ind_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(cnt != 3 || dup_groups > 0 || in_range != distinct_in_range || distinct_o != cnt)
}

/// Repara UN indicador a la secuencia canónica 1,2,3 (ver deduplicate_criteria).
fn repair_one_indicator_criteria(conn: &Connection, ind_id: i64) -> Result<(), String> {
    // Cargar filas con conteo de notas para elegir cuál conservar.
    let rows: Vec<(i64, i64, i64)> = {
        let mut c_stmt = conn
            .prepare(
                "SELECT c.id, c.orden, COALESCE((SELECT COUNT(*) FROM nota n WHERE n.criterio_id = c.id), 0)
                 FROM criterio c WHERE c.indicador_id = ?1 ORDER BY c.orden, c.id",
            )
            .map_err(|e| e.to_string())?;
        let v = c_stmt
            .query_map([ind_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        v
    };

    // ── 1. Deduplicar por orden: conservar la fila preferente ──
    let mut by_orden: std::collections::BTreeMap<i64, Vec<(i64, i64)>> =
        std::collections::BTreeMap::new();
    for (id, orden, notas) in &rows {
        by_orden.entry(*orden).or_default().push((*id, *notas));
    }
    for (_orden, mut group) in by_orden {
        if group.len() <= 1 {
            continue;
        }
        // Preferir la fila con más notas; empate → id más bajo (la original).
        group.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        for (dup_id, _) in group.iter().skip(1) {
            conn.execute(
                "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES ('criterio', ?1)",
                [*dup_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM criterio WHERE id = ?1", [*dup_id])
                .map_err(|e| e.to_string())?;
        }
    }

    // ── 2. Borrar órdenes fuera de 1..=3 (con tombstone) ──
    {
        let garbage: Vec<i64> = {
            let mut s = conn
                .prepare(
                    "SELECT id FROM criterio WHERE indicador_id = ?1 AND orden NOT BETWEEN 1 AND 3",
                )
                .map_err(|e| e.to_string())?;
            let v = s
                .query_map([ind_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            v
        };
        for id in garbage {
            conn.execute(
                "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES ('criterio', ?1)",
                [id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM criterio WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
        }
    }

    // ── 3. Rellenar huecos 1..=3 ──
    let present: Vec<i64> = {
        let mut c_stmt = conn
            .prepare("SELECT orden FROM criterio WHERE indicador_id = ?1")
            .map_err(|e| e.to_string())?;
        let v = c_stmt
            .query_map([ind_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        v
    };
    let scores = [7, 7, 6];
    for orden in 1i64..=3 {
        if !present.contains(&orden) {
            let score = scores[(orden - 1) as usize];
            conn.execute(
                "INSERT INTO criterio (indicador_id, orden, descripcion, puntaje_maximo, updated_at)
                 VALUES (?1, ?2, '', ?3, datetime('now'))",
                rusqlite::params![ind_id, orden, score],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // ── 4. Si quedaron más de 3 filas, borrar extras (con tombstone) ──
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM criterio WHERE indicador_id = ?1",
            [ind_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 3 {
        let extras: Vec<i64> = {
            let mut d_stmt = conn
                .prepare(
                    "SELECT id FROM criterio WHERE indicador_id = ?1
                     ORDER BY orden DESC, id DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let v = d_stmt
                .query_map(rusqlite::params![ind_id, count - 3], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            v
        };
        for id in extras {
            conn.execute(
                "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES ('criterio', ?1)",
                [id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM criterio WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Repara criterios de cada indicador a la secuencia canónica 1,2,3.
///
/// Cubre dos fallos reales:
/// 1. Duplicados de `orden` con COUNT=3 (patrón 1,1,2): los dedup viejos solo
///    miraban COUNT>3, así que este patrón era invisible.
/// 2. El self-heal de `get_evaluation_config` (sort+split_at(3)) BORRABA el
///    `orden=3` legítimo al haber un duplicado de `orden=1` (4 filas → 1,1,2).
///
/// Estrategia idempotente y segura para sync:
/// - Por cada `orden` duplicado, conserva la fila con más notas (o el id más
///   bajo si ambas no tienen); registra pending deletion de las demás para que
///   la nube reciba el tombstone.
/// - Si falta algún `orden` en 1..=3, lo inserta con el score por defecto.
/// - Si sobran órdenes fuera de 1..=3 o de más de 3 filas, los borra con
///   pending deletion.
/// - NO renumerar filas existentes: eso rompería la semántica de las notas.
fn deduplicate_criteria(conn: &Connection) -> Result<(), String> {
    let indicador_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT i.id FROM indicador i
                 LEFT JOIN criterio c ON c.indicador_id = i.id
                 GROUP BY i.id
                 HAVING COUNT(c.id) <> 3
                    OR COUNT(c.id) <> COUNT(DISTINCT c.orden)
                    OR SUM(CASE WHEN c.orden BETWEEN 1 AND 3 THEN 1 ELSE 0 END) <>
                        COUNT(DISTINCT CASE WHEN c.orden BETWEEN 1 AND 3 THEN c.orden END)",
            )
            .map_err(|e| format!("Error buscando indicadores con criterios a reparar: {}", e))?;
        let v = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        v
    };

    let mut fixed = 0usize;
    for ind_id in &indicador_ids {
        repair_one_indicator_criteria(conn, *ind_id)?;
        fixed += 1;
    }

    // UNIQUE(indicador_id, orden) para bases existentes (CREATE TABLE solo aplica
    // a DBs nuevas). Tras la reparación no puede fallar por duplicados.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_criterio_indicador_orden
         ON criterio(indicador_id, orden)",
        [],
    )
    .map_err(|e| format!("Error creando índice UNIQUE de criterio: {e}"))?;

    if fixed > 0 {
        println!("🧩 [DB] Criterios reparados en {} indicador(es)", fixed);
    }

    Ok(())
}

/// Inserta datos iniciales si las tablas estÃ¡n vacÃ­as
pub fn seed_default_data(conn: &Connection) -> Result<(), String> {
    // Verificar si ya hay datos (localmente o de sincronizaciÃ³n previa)
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ano_lectivo", [], |row| row.get(0))
        .unwrap_or(0);

    if count > 0 {
        println!("ðŸ“Š [DB] Datos encontrados en base de datos local, omitiendo sembrado de datos por defecto");
        return Ok(());
    }

    println!("ðŸŒ± [DB] Base de datos vacÃ­a, sembrando datos iniciales...");

    // Opción 1 (anti-cruce de catálogos): si la nube D1 está configurada,
    // NO sembrar datos de usuario/instancia — el primer pull/restore trae
    // la verdad de la nube (colegios, grados, secciones, cortes, etc.).
    // Sembrarlos aquí crearía filas fantasma con PKs que colisionan con
    // las sincronizadas y "mezclan" catálogos entre dispositivos.
    let cloud_configured: bool = conn
        .query_row(
            "SELECT COALESCE((SELECT school_key FROM d1_config WHERE id = 1), '') != ''",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false);
    if cloud_configured {
        println!("[DB] Nube D1 configurada: omitiendo siembra de catálogos (los aporta la nube)");
    }

    // Cortes evaluativos (configuración de sistema, no introducida por el usuario)
    if !cloud_configured {
        conn.execute(
            "INSERT INTO corte_evaluativo (nombre) VALUES ('1er corte evaluativo')",
            [],
        ).ok();
        conn.execute(
            "INSERT INTO corte_evaluativo (nombre) VALUES ('2do corte evaluativo')",
            [],
        ).ok();
        conn.execute(
            "INSERT INTO corte_evaluativo (nombre) VALUES ('3er corte evaluativo')",
            [],
        ).ok();
        conn.execute(
            "INSERT INTO corte_evaluativo (nombre) VALUES ('4to corte evaluativo')",
            [],
        ).ok();
    }

    // NOTA: Los catálogos de usuario (año lectivo, colegio, asignatura, grado,
    // sección) YA NO se siembran por defecto. Ahora el usuario los crea en el
    // asistente "Configurar manualmente" (WelcomePage), por lo que arrancan
    // vacíos y el wizard los puebla con lo que el usuario introduzca. Las
    // relaciones grado_asignatura / colegio_asignatura también quedan vacías
    // hasta que el usuario defina grados y asignaturas.

    // Migrar IDs de calificaciones si existen los viejos
    let needs_migration: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM configuracion_calificacion WHERE id = 'destacado'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if needs_migration {
        conn.execute(
            "UPDATE configuracion_calificacion SET id = 'AA' WHERE id = 'destacado'",
            [],
        )
        .ok();
        conn.execute(
            "UPDATE configuracion_calificacion SET id = 'AS' WHERE id = 'satisfactorio'",
            [],
        )
        .ok();
        conn.execute(
            "UPDATE configuracion_calificacion SET id = 'AF' WHERE id = 'basico'",
            [],
        )
        .ok();
        println!("âœ… [DB] MigraciÃ³n de calificaciones completada");
    } else {
        // Si no hay registros, insertar los nuevos
        let is_empty: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM configuracion_calificacion",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) == 0;

        if is_empty {
            let configs = vec![
                ("AA", "Aprendizaje Avanzado", "#22c55e", 90),
                ("AS", "Aprendizaje Satisfactorio", "#3b82f6", 70),
                ("AF", "Aprendizaje Fundamental", "#eab308", 50),
                ("AI", "Aprendizaje Inicial", "#ef4444", 0),
            ];
            for (id, nombre, color, minimo) in configs {
                conn.execute(
                    "INSERT OR IGNORE INTO configuracion_calificacion (id, nombre, color, minimo) VALUES (?, ?, ?, ?)",
                    rusqlite::params![id, nombre, color, minimo],
                )
                .ok();
            }
            println!("âœ… [DB] Datos iniciales de calificaciones sembrados");
        }
    }

    // Multiplicadores de criterios
    let multiplicadores = vec![
        ("AA", 1.0),
        ("AS", 0.85),
        ("AF", 0.65),
        ("AI", 0.40),
    ];
    for (id, mult) in multiplicadores {
        conn.execute(
            "INSERT OR IGNORE INTO multiplicador_calificacion (id, multiplicador) VALUES (?, ?)",
            rusqlite::params![id, mult],
        ).ok();
    }

    println!("âœ… [DB] Datos iniciales sembrados correctamente");
    Ok(())
}

/// Borra TODOS los datos del usuario y la metadatos de sincronización local,
/// dejando el esquema intacto. Se usa al cambiar de cuenta de profesor para
/// aislar totalmente cada perfil: la BD local queda vacía y luego se restaura
/// desde la nube de la nueva cuenta (Cloudflare D1 / Drive).
pub fn truncate_all_local_data(conn: &Connection) -> Result<(), String> {
    conn.execute("PRAGMA foreign_keys = OFF", [])
        .map_err(|e| e.to_string())?;
    let tables: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    for t in &tables {
        tx.execute(&format!("DELETE FROM \"{}\"", t), [])
            .map_err(|e| format!("Error limpiando tabla {}: {}", t, e))?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| e.to_string())?;
    init_database(conn)?;
    println!("[DB] Base de datos local reiniciada (reset de perfil)");
    Ok(())
}

/// Alias para compatibilidad hacia atrÃ¡s
pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    init_database(conn)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudentImpact {
    pub total_notas: i64,
    pub total_asistencias: i64,
}

// ============================================================================
// Estructuras para sincronizaciÃ³n de eliminaciones (claves compuestas)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeletionAsistencia {
    pub id: i64,
    pub estudiante_id: i64,
    pub fecha: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeletionNota {
    pub id: i64,
    pub estudiante_id: i64,
    pub criterio_id: i64,
    pub corte_evaluativo_id: i64,
    pub asignatura_id: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeletionGradoAsignatura {
    pub id: i64,
    pub grado_id: i64,
    pub asignatura_id: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeletionColegioAsignatura {
    pub id: i64,
    pub colegio_id: i64,
    pub asignatura_id: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeletionColegioGrado {
    pub id: i64,
    pub colegio_id: i64,
    pub grado_id: i64,
}

#[tauri::command]
pub async fn get_student_impact(
    state: tauri::State<'_, DbState>,
    student_id: i64,
) -> Result<StudentImpact, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let total_notas: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM nota WHERE estudiante_id = ?",
            [student_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total_asistencias: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM asistencia WHERE estudiante_id = ?",
            [student_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(StudentImpact {
        total_notas,
        total_asistencias,
    })
}

#[tauri::command]
pub async fn reset_local_database(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
    // Reinicio "suave" de datos locales: borra datos de usuario y pendientes de
    // sincronización, PERO conserva d1_config para no desvincular la nube (la
    // próxima sync re-trae los datos del profesor actual desde su nube).
    conn_guard.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;
    let tables: Vec<String> = {
        let mut stmt = conn_guard
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_config' AND name != 'app_meta'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let tx = conn_guard.unchecked_transaction().map_err(|e| e.to_string())?;
    for t in &tables {
        tx.execute(&format!("DELETE FROM \"{}\"", t), [])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    conn_guard.execute("PRAGMA foreign_keys = ON", []).map_err(|e| e.to_string())?;
    run_migrations(&conn_guard)?;
    seed_default_data(&conn_guard)?;
    Ok(())
}

/// Reinicio TOTAL del perfil al cambiar de cuenta de profesor: borra TODAS las
/// tablas (incluida d1_config y los pendientes de sincronización) para aislar
/// totalmente cada perfil. Luego la app restaura los datos desde la nube de la
/// nueva cuenta.
#[tauri::command]
pub async fn reset_profile_account(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
    truncate_all_local_data(&conn_guard)?;
    seed_default_data(&conn_guard)?;
    Ok(())
}

#[tauri::command]
pub async fn seed_defaults_now(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
    seed_default_data(&conn_guard)
}

// Macro to generate CRUD commands for each table
macro_rules! create_crud_commands {
    ($table:ident, $get_all:ident, $add:ident, $update:ident, $delete:ident) => {
        #[tauri::command]
        pub async fn $get_all(state: tauri::State<'_, DbState>) -> Result<Vec<CategoryItem>, String> {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(concat!(
                    "SELECT id, nombre, cualitativo FROM ",
                    stringify!($table)
                ))
                .map_err(|e| e.to_string())?;

            let items = stmt
                .query_map([], |row| {
                    Ok(CategoryItem {
                        id: Some(row.get(0)?),
                        nombre: row.get(1)?,
                        activo: None,
                        cualitativo: Some(row.get::<_, i64>(2)? == 1),
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            Ok(items)
        }

        #[tauri::command]
        pub async fn $add(state: tauri::State<'_, DbState>, nombre: String) -> Result<i64, String> {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                concat!(
                    "INSERT INTO ",
                    stringify!($table),
                    " (nombre, cualitativo) VALUES (?, 0)"
                ),
                [&nombre],
            )
            .map_err(|e| e.to_string())?;

            Ok(conn.last_insert_rowid())
        }

        // Tables without activo: update + updated_at
        #[tauri::command]
        pub async fn $update(
            state: tauri::State<'_, DbState>,
            id: i64,
            nombre: String,
            cualitativo: bool,
        ) -> Result<(), String> {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                concat!(
                    "UPDATE ",
                    stringify!($table),
                    " SET nombre = ?, cualitativo = ?, updated_at = datetime('now') WHERE id = ?"
                ),
                rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        }

        #[tauri::command]
        pub async fn $delete(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
            let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            tx.execute(
                concat!("DELETE FROM ", stringify!($table), " WHERE id = ?"),
                [id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                rusqlite::params![stringify!($table), id],
            )
            .map_err(|e| e.to_string())?;

            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        }
    };
}

// Macro for tables with 'activo' column
macro_rules! create_crud_commands_active {
    ($table:ident, $get_all:ident, $add:ident, $update:ident, $delete:ident, $set_active:ident) => {
        #[tauri::command]
        pub async fn $get_all(state: tauri::State<'_, DbState>) -> Result<Vec<CategoryItem>, String> {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            // Check if column exists or handle simpler: Just select. If migration ran, it exists.
            let mut stmt = conn
                .prepare(concat!(
                    "SELECT id, nombre, activo, cualitativo FROM ",
                    stringify!($table)
                ))
                .map_err(|e| e.to_string())?;

            let items = stmt
                .query_map([], |row| {
                    Ok(CategoryItem {
                        id: Some(row.get(0)?),
                        nombre: row.get(1)?,
                        activo: Some(row.get::<_, i64>(2)? == 1),
                        cualitativo: Some(row.get::<_, i64>(3)? == 1),
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            Ok(items)
        }

        #[tauri::command]
        pub async fn $add(state: tauri::State<'_, DbState>, nombre: String) -> Result<i64, String> {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                concat!(
                    "INSERT INTO ",
                    stringify!($table),
                    " (nombre, activo, cualitativo) VALUES (?, 0, 0)"
                ),
                [&nombre],
            )
            .map_err(|e| e.to_string())?;

            Ok(conn.last_insert_rowid())
        }

        // Tables with activo: update + updated_at
        #[tauri::command]
        pub async fn $update(
            state: tauri::State<'_, DbState>,
            id: i64,
            nombre: String,
            cualitativo: bool,
        ) -> Result<(), String> {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                concat!(
                    "UPDATE ",
                    stringify!($table),
                    " SET nombre = ?, cualitativo = ?, updated_at = datetime('now') WHERE id = ?"
                ),
                rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        }

        #[tauri::command]
        pub async fn $delete(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
            let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            tx.execute(
                concat!("DELETE FROM ", stringify!($table), " WHERE id = ?"),
                [id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                rusqlite::params![stringify!($table), id],
            )
            .map_err(|e| e.to_string())?;

            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        }

        #[tauri::command]
        pub async fn $set_active(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
            let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            // Deactivate all
            tx.execute(
                concat!(
                    "UPDATE ",
                    stringify!($table),
                    " SET activo = 0, updated_at = datetime('now')"
                ),
                [],
            )
            .map_err(|e| e.to_string())?;

            // Activate selected
            tx.execute(
                concat!(
                    "UPDATE ",
                    stringify!($table),
                    " SET activo = 1, updated_at = datetime('now') WHERE id = ?"
                ),
                [id],
            )
            .map_err(|e| e.to_string())?;

            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        }
    };
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCheckResponse {
    pub has_students: bool,
    pub has_grades: bool,
    pub has_notes: bool,
    pub has_attendance: bool,
    pub student_count: i64,
    pub note_count: i64,
    pub attendance_count: i64,
}

#[tauri::command]
pub async fn check_category_dependencies(
    state: tauri::State<'_, DbState>,
    table: String,
    id: i64,
) -> Result<DeleteCheckResponse, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut response = DeleteCheckResponse {
        has_students: false,
        has_grades: false,
        has_notes: false,
        has_attendance: false,
        student_count: 0,
        note_count: 0,
        attendance_count: 0,
    };

    match table.as_str() {
        "ano_lectivo" => {
            response.student_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM estudiante WHERE ano_lectivo_id = ?",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            response.attendance_count = conn.query_row("SELECT COUNT(*) FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
            response.note_count = conn.query_row("SELECT COUNT(*) FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
        }
        "corte_evaluativo" => {
            response.note_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM nota WHERE corte_evaluativo_id = ?",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
        }
        "colegio" => {
            response.student_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM estudiante WHERE colegio_id = ?",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            response.attendance_count = conn.query_row("SELECT COUNT(*) FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
            response.note_count = conn.query_row("SELECT COUNT(*) FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
        }
        "asignatura" => {
            response.note_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM nota WHERE asignatura_id = ?",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            response.has_grades = conn
                .query_row(
                    "SELECT COUNT(*) FROM grado_asignatura WHERE asignatura_id = ?",
                    [id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;
        }
        "grado" => {
            response.student_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM estudiante WHERE grado_id = ?",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            response.attendance_count = conn.query_row("SELECT COUNT(*) FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
            response.note_count = conn.query_row("SELECT COUNT(*) FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
            response.has_grades = conn
                .query_row(
                    "SELECT COUNT(*) FROM grado_asignatura WHERE grado_id = ?",
                    [id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;
        }
        "seccion" => {
            response.student_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM estudiante WHERE seccion_id = ?",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            response.attendance_count = conn.query_row("SELECT COUNT(*) FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
            response.note_count = conn.query_row("SELECT COUNT(*) FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)", [id], |row| row.get(0)).unwrap_or(0);
        }
        _ => return Err("Tabla no reconocida".to_string()),
    }

    response.has_students = response.student_count > 0;
    response.has_notes = response.note_count > 0;
    response.has_attendance = response.attendance_count > 0;

    Ok(response)
}

#[tauri::command]
pub async fn delete_category_force(
    state: tauri::State<'_, DbState>,
    table: String,
    id: i64,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    match table.as_str() {
        "ano_lectivo" => {
            // Registrar eliminaciones de notas en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)"
            ).map_err(|e| e.to_string())?;
            let notas: Vec<(i64, i64, i64, i64)> = stmt
                .query_map([id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, crit_id, corte_id, asig_id) in notas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
                    rusqlite::params![est_id, crit_id, corte_id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar eliminaciones de asistencia en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)"
            ).map_err(|e| e.to_string())?;
            let asignaciones: Vec<(i64, String)> = stmt
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, fecha) in asignaciones {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                    rusqlite::params![est_id, fecha],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar eliminaciones de estudiantes
            let mut stmt = tx
                .prepare("SELECT id FROM estudiante WHERE ano_lectivo_id = ?")
                .map_err(|e| e.to_string())?;
            let estudiantes: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for est_id in estudiantes {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["estudiante", est_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM estudiante WHERE ano_lectivo_id = ?", [id])
                .map_err(|e| e.to_string())?;
        }
        "corte_evaluativo" => {
            // Registrar eliminaciones de notas
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE corte_evaluativo_id = ?"
            ).map_err(|e| e.to_string())?;
            let notas: Vec<(i64, i64, i64, i64)> = stmt
                .query_map([id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, crit_id, corte_id, asig_id) in notas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
                    rusqlite::params![est_id, crit_id, corte_id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM nota WHERE corte_evaluativo_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar indicadores
            let mut stmt = tx
                .prepare("SELECT id FROM indicador WHERE corte_evaluativo_id = ?")
                .map_err(|e| e.to_string())?;
            let indicadores: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for ind_id in indicadores {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["indicador", ind_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM indicador WHERE corte_evaluativo_id = ?", [id])
                .map_err(|e| e.to_string())?;
        }
        "colegio" => {
            // Registrar notas en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)"
            ).map_err(|e| e.to_string())?;
            let notas: Vec<(i64, i64, i64, i64)> = stmt
                .query_map([id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, crit_id, corte_id, asig_id) in notas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
                    rusqlite::params![est_id, crit_id, corte_id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar asignaciones en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)"
            ).map_err(|e| e.to_string())?;
            let asignaciones: Vec<(i64, String)> = stmt
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, fecha) in asignaciones {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                    rusqlite::params![est_id, fecha],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar estudiantes
            let mut stmt = tx
                .prepare("SELECT id FROM estudiante WHERE colegio_id = ?")
                .map_err(|e| e.to_string())?;
            let estudiantes: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for est_id in estudiantes {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["estudiante", est_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM estudiante WHERE colegio_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar colegio_dias_asistencia
            tx.execute(
                "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                rusqlite::params!["colegio_dias_asistencia", id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM colegio_dias_asistencia WHERE colegio_id = ?",
                [id],
            )
            .map_err(|e| e.to_string())?;

            // Registrar colegio_asignatura
            let mut stmt = tx
                .prepare("SELECT asignatura_id FROM colegio_asignatura WHERE colegio_id = ?")
                .map_err(|e| e.to_string())?;
            let asignaturas: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for asig_id in asignaturas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
                    rusqlite::params![id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM colegio_asignatura WHERE colegio_id = ?", [id])
                .map_err(|e| e.to_string())?;
        }
        "asignatura" => {
            // Registrar notas
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE asignatura_id = ?"
            ).map_err(|e| e.to_string())?;
            let notas: Vec<(i64, i64, i64, i64)> = stmt
                .query_map([id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, crit_id, corte_id, asig_id) in notas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
                    rusqlite::params![est_id, crit_id, corte_id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM nota WHERE asignatura_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar indicadores
            let mut stmt = tx
                .prepare("SELECT id FROM indicador WHERE asignatura_id = ?")
                .map_err(|e| e.to_string())?;
            let indicadores: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for ind_id in indicadores {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["indicador", ind_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM indicador WHERE asignatura_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar grado_asignatura
            let mut stmt = tx
                .prepare("SELECT grado_id FROM grado_asignatura WHERE asignatura_id = ?")
                .map_err(|e| e.to_string())?;
            let grados: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for grado_id in grados {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
                    rusqlite::params![grado_id, id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM grado_asignatura WHERE asignatura_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar colegio_asignatura
            let mut stmt = tx
                .prepare("SELECT colegio_id FROM colegio_asignatura WHERE asignatura_id = ?")
                .map_err(|e| e.to_string())?;
            let colegios: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for colegio_id in colegios {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
                    rusqlite::params![colegio_id, id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute(
                "DELETE FROM colegio_asignatura WHERE asignatura_id = ?",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
        "grado" => {
            // Registrar notas en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)"
            ).map_err(|e| e.to_string())?;
            let notas: Vec<(i64, i64, i64, i64)> = stmt
                .query_map([id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, crit_id, corte_id, asig_id) in notas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
                    rusqlite::params![est_id, crit_id, corte_id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar asignaciones en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)"
            ).map_err(|e| e.to_string())?;
            let asignaciones: Vec<(i64, String)> = stmt
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, fecha) in asignaciones {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                    rusqlite::params![est_id, fecha],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar estudiantes
            let mut stmt = tx
                .prepare("SELECT id FROM estudiante WHERE grado_id = ?")
                .map_err(|e| e.to_string())?;
            let estudiantes: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for est_id in estudiantes {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["estudiante", est_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM estudiante WHERE grado_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar indicadores
            let mut stmt = tx
                .prepare("SELECT id FROM indicador WHERE grado_id = ?")
                .map_err(|e| e.to_string())?;
            let indicadores: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for ind_id in indicadores {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["indicador", ind_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM indicador WHERE grado_id = ?", [id])
                .map_err(|e| e.to_string())?;

            // Registrar grado_asignatura
            let mut stmt = tx
                .prepare("SELECT asignatura_id FROM grado_asignatura WHERE grado_id = ?")
                .map_err(|e| e.to_string())?;
            let asignaturas: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for asig_id in asignaturas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
                    rusqlite::params![id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM grado_asignatura WHERE grado_id = ?", [id])
                .map_err(|e| e.to_string())?;
        }
        "seccion" => {
            // Registrar notas en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)"
            ).map_err(|e| e.to_string())?;
            let notas: Vec<(i64, i64, i64, i64)> = stmt
                .query_map([id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, crit_id, corte_id, asig_id) in notas {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)",
                    rusqlite::params![est_id, crit_id, corte_id, asig_id],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar asignaciones en cascada
            let mut stmt = tx.prepare(
                "SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)"
            ).map_err(|e| e.to_string())?;
            let asignaciones: Vec<(i64, String)> = stmt
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for (est_id, fecha) in asignaciones {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                    rusqlite::params![est_id, fecha],
                ).map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)", [id]).map_err(|e| e.to_string())?;

            // Registrar estudiantes
            let mut stmt = tx
                .prepare("SELECT id FROM estudiante WHERE seccion_id = ?")
                .map_err(|e| e.to_string())?;
            let estudiantes: Vec<i64> = stmt
                .query_map([id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            for est_id in estudiantes {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
                    rusqlite::params!["estudiante", est_id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute("DELETE FROM estudiante WHERE seccion_id = ?", [id])
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Tabla no reconocida".to_string()),
    }

    // Registrar la eliminaciÃ³n de la entidad principal
    tx.execute(
        "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
        rusqlite::params![&table, id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(&format!("DELETE FROM {} WHERE id = ?", table), [id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_category_force_batch(
    state: tauri::State<'_, DbState>,
    table: String,
    ids: Vec<i64>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for &id in &ids {
        match table.as_str() {
            "ano_lectivo" => {
                let mut stmt = tx.prepare(
                    "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)"
                ).map_err(|e| e.to_string())?;
                let notas: Vec<(i64, i64, i64, i64)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, crit_id, corte_id, asig_id) in notas {
                    tx.execute("INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)", rusqlite::params![est_id, crit_id, corte_id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)").map_err(|e| e.to_string())?;
                let asistencias: Vec<(i64, String)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, fecha) in asistencias {
                    tx.execute("INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)", rusqlite::params![est_id, fecha]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE ano_lectivo_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM estudiante WHERE ano_lectivo_id = ?").map_err(|e| e.to_string())?;
                let estudiantes: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for est_id in estudiantes {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["estudiante", est_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM estudiante WHERE ano_lectivo_id = ?", [id]).map_err(|e| e.to_string())?;
            }
            "corte_evaluativo" => {
                let mut stmt = tx.prepare("SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE corte_evaluativo_id = ?").map_err(|e| e.to_string())?;
                let notas: Vec<(i64, i64, i64, i64)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, crit_id, corte_id, asig_id) in notas {
                    tx.execute("INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)", rusqlite::params![est_id, crit_id, corte_id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM nota WHERE corte_evaluativo_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM indicador WHERE corte_evaluativo_id = ?").map_err(|e| e.to_string())?;
                let indicadores: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for ind_id in indicadores {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["indicador", ind_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM indicador WHERE corte_evaluativo_id = ?", [id]).map_err(|e| e.to_string())?;
            }
            "colegio" => {
                let mut stmt = tx.prepare("SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)").map_err(|e| e.to_string())?;
                let notas: Vec<(i64, i64, i64, i64)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, crit_id, corte_id, asig_id) in notas {
                    tx.execute("INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)", rusqlite::params![est_id, crit_id, corte_id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)").map_err(|e| e.to_string())?;
                let asistencias: Vec<(i64, String)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, fecha) in asistencias {
                    tx.execute("INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)", rusqlite::params![est_id, fecha]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE colegio_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM estudiante WHERE colegio_id = ?").map_err(|e| e.to_string())?;
                let estudiantes: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for est_id in estudiantes {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["estudiante", est_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM estudiante WHERE colegio_id = ?", [id]).map_err(|e| e.to_string())?;

                tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["colegio_dias_asistencia", id]).map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM colegio_dias_asistencia WHERE colegio_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT asignatura_id FROM colegio_asignatura WHERE colegio_id = ?").map_err(|e| e.to_string())?;
                let asignaturas: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for asig_id in asignaturas {
                    tx.execute("INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)", rusqlite::params![id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM colegio_asignatura WHERE colegio_id = ?", [id]).map_err(|e| e.to_string())?;
            }
            "asignatura" => {
                let mut stmt = tx.prepare("SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE asignatura_id = ?").map_err(|e| e.to_string())?;
                let notas: Vec<(i64, i64, i64, i64)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, crit_id, corte_id, asig_id) in notas {
                    tx.execute("INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)", rusqlite::params![est_id, crit_id, corte_id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM nota WHERE asignatura_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM indicador WHERE asignatura_id = ?").map_err(|e| e.to_string())?;
                let indicadores: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for ind_id in indicadores {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["indicador", ind_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM indicador WHERE asignatura_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT grado_id FROM grado_asignatura WHERE asignatura_id = ?").map_err(|e| e.to_string())?;
                let grados: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for grado_id in grados {
                    tx.execute("INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)", rusqlite::params![grado_id, id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM grado_asignatura WHERE asignatura_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT colegio_id FROM colegio_asignatura WHERE asignatura_id = ?").map_err(|e| e.to_string())?;
                let colegios: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for colegio_id in colegios {
                    tx.execute("INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)", rusqlite::params![colegio_id, id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM colegio_asignatura WHERE asignatura_id = ?", [id]).map_err(|e| e.to_string())?;
            }
            "grado" => {
                let mut stmt = tx.prepare("SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)").map_err(|e| e.to_string())?;
                let notas: Vec<(i64, i64, i64, i64)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, crit_id, corte_id, asig_id) in notas {
                    tx.execute("INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)", rusqlite::params![est_id, crit_id, corte_id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)").map_err(|e| e.to_string())?;
                let asistencias: Vec<(i64, String)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, fecha) in asistencias {
                    tx.execute("INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)", rusqlite::params![est_id, fecha]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE grado_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM estudiante WHERE grado_id = ?").map_err(|e| e.to_string())?;
                let estudiantes: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for est_id in estudiantes {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["estudiante", est_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM estudiante WHERE grado_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM indicador WHERE grado_id = ?").map_err(|e| e.to_string())?;
                let indicadores: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for ind_id in indicadores {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["indicador", ind_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM indicador WHERE grado_id = ?", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT asignatura_id FROM grado_asignatura WHERE grado_id = ?").map_err(|e| e.to_string())?;
                let asignaturas: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for asig_id in asignaturas {
                    tx.execute("INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)", rusqlite::params![id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM grado_asignatura WHERE grado_id = ?", [id]).map_err(|e| e.to_string())?;
            }
            "seccion" => {
                let mut stmt = tx.prepare("SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)").map_err(|e| e.to_string())?;
                let notas: Vec<(i64, i64, i64, i64)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, crit_id, corte_id, asig_id) in notas {
                    tx.execute("INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?)", rusqlite::params![est_id, crit_id, corte_id, asig_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM nota WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT estudiante_id, fecha FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)").map_err(|e| e.to_string())?;
                let asistencias: Vec<(i64, String)> = stmt
                    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                drop(stmt);
                for (est_id, fecha) in asistencias {
                    tx.execute("INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)", rusqlite::params![est_id, fecha]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM asistencia WHERE estudiante_id IN (SELECT id FROM estudiante WHERE seccion_id = ?)", [id]).map_err(|e| e.to_string())?;

                let mut stmt = tx.prepare("SELECT id FROM estudiante WHERE seccion_id = ?").map_err(|e| e.to_string())?;
                let estudiantes: Vec<i64> = stmt.query_map([id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                drop(stmt);
                for est_id in estudiantes {
                    tx.execute("INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)", rusqlite::params!["estudiante", est_id]).map_err(|e| e.to_string())?;
                }
                tx.execute("DELETE FROM estudiante WHERE seccion_id = ?", [id]).map_err(|e| e.to_string())?;
            }
            _ => return Err("Tabla no reconocida".to_string()),
        }

        tx.execute(
            "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
            rusqlite::params![&table, id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(&format!("DELETE FROM {} WHERE id = ?", table), [id])
            .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_grados_by_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    _anoLectivoId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT g.id, g.nombre, g.cualitativo
             FROM grado g
             INNER JOIN estudiante e ON g.id = e.grado_id
             WHERE e.colegio_id = ?
             ORDER BY g.nombre",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([colegioId], |row| {
            Ok(CategoryItem {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                activo: None,
                cualitativo: Some(row.get::<_, i64>(2)? == 1),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_secciones_by_grado_colegio(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    colegioId: i64,
    anoLectivoId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT s.id, s.nombre
             FROM seccion s
             INNER JOIN estudiante e ON s.id = e.seccion_id
             WHERE e.grado_id = ? AND e.colegio_id = ? AND e.ano_lectivo_id = ?
             ORDER BY s.nombre",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([gradoId, colegioId, anoLectivoId], |row| {
            Ok(CategoryItem {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                activo: None,
                cualitativo: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

// Student CRUD Commands
#[tauri::command]
pub async fn get_students(state: tauri::State<'_, DbState>) -> Result<Vec<Student>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, foto FROM estudiante")
        .map_err(|e| e.to_string())?;

    let students = stmt
        .query_map([], |row| {
            Ok(Student {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                codigo: row.get(2)?,
                sexo: row.get(3)?,
                ano_lectivo_id: row.get(4)?,
                grado_id: row.get(5)?,
                seccion_id: row.get(6)?,
                colegio_id: row.get(7)?,
                foto: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(students)
}

#[tauri::command]
pub async fn add_student(state: tauri::State<'_, DbState>, student: Student) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO estudiante (nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, foto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            student.nombre,
            student.codigo,
            student.sexo,
            student.ano_lectivo_id,
            student.grado_id,
            student.seccion_id,
            student.colegio_id,
            student.foto
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn update_student(state: tauri::State<'_, DbState>, student: Student) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE estudiante SET nombre = ?, codigo = ?, sexo = ?, ano_lectivo_id = ?, grado_id = ?, seccion_id = ?, colegio_id = ?, foto = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![
            student.nombre,
            student.codigo,
            student.sexo,
            student.ano_lectivo_id,
            student.grado_id,
            student.seccion_id,
            student.colegio_id,
            student.foto,
            student.id
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recommended_colegio(state: tauri::State<'_, DbState>) -> Result<i64, String> {
    use chrono::{Datelike, Local};
    let now = Local::now();
    let weekday = now.weekday();

    // Mapear el dÃ­a de la semana a la columna de la base de datos
    let column = match weekday {
        chrono::Weekday::Mon => "lunes",
        chrono::Weekday::Tue => "martes",
        chrono::Weekday::Wed => "miercoles",
        chrono::Weekday::Thu => "jueves",
        chrono::Weekday::Fri => "viernes",
        chrono::Weekday::Sat => "sabado",
        chrono::Weekday::Sun => "domingo",
    };

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Buscar colegios habilitados para hoy, ordenados alfabÃ©ticamente
    let mut stmt = conn
        .prepare(&format!(
            "SELECT c.id FROM colegio c 
         INNER JOIN colegio_dias_asistencia cda ON c.id = cda.colegio_id 
         WHERE cda.{} = 1 
         ORDER BY c.nombre ASC LIMIT 1",
            column
        ))
        .map_err(|e| e.to_string())?;

    let colegio_id = stmt.query_row([], |row| row.get::<_, i64>(0)).unwrap_or(0);

    Ok(colegio_id)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeletion {
    pub id: i64,
    pub tabla: String,
    pub registro_id: i64,
}

#[tauri::command]
pub async fn get_pending_deletions(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PendingDeletion>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, tabla, registro_id FROM sync_pending_deletions")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(PendingDeletion {
                id: row.get(0)?,
                tabla: row.get(1)?,
                registro_id: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn remove_pending_deletion(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_pending_deletions WHERE id = ?", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_pending_deletion_by_record(
    state: tauri::State<'_, DbState>,
    tabla: String,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_pending_deletions WHERE tabla = ? AND registro_id = ?",
        rusqlite::params![tabla, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_synced_deletions(state: tauri::State<'_, DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("DELETE FROM sync_pending_deletions WHERE id IN ({})", placeholders);
    let params: Vec<rusqlite::types::Value> = ids.iter().map(|id| rusqlite::types::Value::Integer(*id)).collect();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ============================================================================
// Funciones para manejar eliminaciones de tablas con claves compuestas
// ============================================================================

#[tauri::command]
pub async fn get_pending_deletions_asistencia(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PendingDeletionAsistencia>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, estudiante_id, fecha FROM sync_pending_deletions_asistencia")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(PendingDeletionAsistencia {
                id: row.get(0)?,
                estudiante_id: row.get(1)?,
                fecha: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn remove_pending_deletion_asistencia(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_pending_deletions_asistencia WHERE id = ?",
        [id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pending_deletions_nota(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PendingDeletionNota>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM sync_pending_deletions_nota")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(PendingDeletionNota {
                id: row.get(0)?,
                estudiante_id: row.get(1)?,
                criterio_id: row.get(2)?,
                corte_evaluativo_id: row.get(3)?,
                asignatura_id: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn remove_pending_deletion_nota(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_pending_deletions_nota WHERE id = ?", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pending_deletions_grado_asignatura(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PendingDeletionGradoAsignatura>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, grado_id, asignatura_id FROM sync_pending_deletions_grado_asignatura")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(PendingDeletionGradoAsignatura {
                id: row.get(0)?,
                grado_id: row.get(1)?,
                asignatura_id: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn remove_pending_deletion_grado_asignatura(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_pending_deletions_grado_asignatura WHERE id = ?",
        [id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pending_deletions_colegio_asignatura(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PendingDeletionColegioAsignatura>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, colegio_id, asignatura_id FROM sync_pending_deletions_colegio_asignatura",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(PendingDeletionColegioAsignatura {
                id: row.get(0)?,
                colegio_id: row.get(1)?,
                asignatura_id: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn remove_pending_deletion_colegio_asignatura(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_pending_deletions_colegio_asignatura WHERE id = ?",
        [id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_student(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Registrar eliminaciones pendientes de las filas dependientes
    //    (asistencia/nota) ANTES del cascade, para que la nube también
    //    las borre y no queden huérfanas que el pull revive.
    let mut stmt = tx.prepare("SELECT id, fecha FROM asistencia WHERE estudiante_id = ?1").map_err(|e| e.to_string())?;
    let filas: Vec<(i64, String)> = stmt
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    for (_, fecha) in &filas {
        tx.execute(
            "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
            rusqlite::params![id, fecha],
        )
        .map_err(|e| e.to_string())?;
    }

    // 2. Eliminar el estudiante
    tx.execute("DELETE FROM estudiante WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;

    // 3. Registrar la eliminaciÃ³n pendiente para sincronizaciÃ³n
    tx.execute(
        "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
        rusqlite::params!["estudiante", id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_student_batch(state: tauri::State<'_, DbState>, ids: Vec<i64>) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for &id in &ids {
        // Tombstones de asistencia antes del cascade (ver delete_student)
        let mut stmt = tx.prepare("SELECT fecha FROM asistencia WHERE estudiante_id = ?1").map_err(|e| e.to_string())?;
        let fechas: Vec<String> = stmt
            .query_map([id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        for fecha in &fechas {
            tx.execute(
                "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                rusqlite::params![id, fecha],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute("DELETE FROM estudiante WHERE id = ?", [id])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES (?, ?)",
            rusqlite::params!["estudiante", id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// Curriculum (Grade-Subject) Commands
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_subjects_by_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    
    // Usar LEFT JOIN para obtener todas las asignaturas, incluso si no hay relaciÃ³n en grado_asignatura
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.nombre, a.cualitativo 
             FROM asignatura a
             LEFT JOIN grado_asignatura ga ON a.id = ga.asignatura_id AND ga.grado_id = ?
             WHERE ga.grado_id = ? OR ga.grado_id IS NULL",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([gradoId, gradoId], |row| {
            Ok(CategoryItem {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                activo: None,
                cualitativo: Some(row.get::<_, i64>(2)? == 1),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Si no hay resultados con LEFT JOIN, devolver todas las asignaturas
    if items.is_empty() {
        let mut stmt_all = conn
            .prepare("SELECT id, nombre, cualitativo FROM asignatura")
            .map_err(|e| e.to_string())?;
            
        let all_items = stmt_all
            .query_map([], |row| {
                Ok(CategoryItem {
                    id: Some(row.get(0)?),
                    nombre: row.get(1)?,
                    activo: None,
                    cualitativo: Some(row.get::<_, i64>(2)? == 1),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
            
        return Ok(all_items);
    }

    Ok(items)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn assign_subject_to_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Limpiar pending deletion previa para evitar que un pull borre el registro recién asignado
    let _ = conn.execute(
        "DELETE FROM sync_pending_deletions_grado_asignatura WHERE grado_id = ? AND asignatura_id = ?",
        [gradoId, asignaturaId],
    );
    conn.execute(
        "INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
        [gradoId, asignaturaId],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unassign_subject_from_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Solo registrar si la relaciÃ³n existe
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM grado_asignatura WHERE grado_id = ? AND asignatura_id = ?)",
        [gradoId, asignaturaId],
        |row| row.get(0),
    ).unwrap_or(false);

    if exists {
        // Registrar eliminaciÃ³n pendiente
        conn.execute(
            "INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
            [gradoId, asignaturaId],
        ).map_err(|e| e.to_string())?;

        // Eliminar la relaciÃ³n
        conn.execute(
            "DELETE FROM grado_asignatura WHERE grado_id = ? AND asignatura_id = ?",
            [gradoId, asignaturaId],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn assign_all_subjects_to_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id) 
         SELECT ?, id FROM asignatura",
        [gradoId],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unassign_all_subjects_from_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Registrar todas las relaciones existentes como eliminaciones pendientes
    let mut stmt = conn
        .prepare("SELECT asignatura_id FROM grado_asignatura WHERE grado_id = ?")
        .map_err(|e| e.to_string())?;
    let asignaturas: Vec<i64> = stmt
        .query_map([gradoId], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for asig_id in asignaturas {
        conn.execute(
            "INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
            rusqlite::params![gradoId, asig_id],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute("DELETE FROM grado_asignatura WHERE grado_id = ?", [gradoId])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_subjects_by_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.nombre, a.cualitativo
              FROM asignatura a
              INNER JOIN colegio_asignatura ca ON a.id = ca.asignatura_id
              WHERE ca.colegio_id = ?
              ORDER BY a.nombre",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([colegioId], |row| {
            Ok(CategoryItem {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                activo: None,
                cualitativo: Some(row.get(2)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_all_subjects(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, nombre, cualitativo FROM asignatura ORDER BY nombre")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(CategoryItem {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                activo: None,
                cualitativo: Some(row.get(2)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn assign_subject_to_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Limpiar pending deletion previa para evitar que un pull borre el recién asignado
    let _ = conn.execute(
        "DELETE FROM sync_pending_deletions_colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?",
        [colegioId, asignaturaId],
    );

    conn.execute(
        "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
        [colegioId, asignaturaId],
    )
    .map(|_rows| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unassign_subject_from_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Solo registrar si la relaciÃ³n existe
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?)",
        [colegioId, asignaturaId],
        |row| row.get(0),
    ).unwrap_or(false);

    if exists {
        // Registrar eliminaciÃ³n pendiente
        conn.execute(
            "INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
            [colegioId, asignaturaId],
        ).map_err(|e| e.to_string())?;

        // Eliminar la relaciÃ³n
        conn.execute(
            "DELETE FROM colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?",
            [colegioId, asignaturaId],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn assign_all_subjects_to_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id) 
         SELECT ?, id FROM asignatura",
        [colegioId],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn unassign_all_subjects_from_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Registrar todas las relaciones existentes como eliminaciones pendientes
    let mut stmt = conn
        .prepare("SELECT asignatura_id FROM colegio_asignatura WHERE colegio_id = ?")
        .map_err(|e| e.to_string())?;
    let asignaturas: Vec<i64> = stmt
        .query_map([colegioId], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for asig_id in asignaturas {
        conn.execute(
            "INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
            rusqlite::params![colegioId, asig_id],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "DELETE FROM colegio_asignatura WHERE colegio_id = ?",
        [colegioId],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// ---- Grados por colegio (colegio_grado) ----

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GradoColegioItem {
    pub id: i64,
    pub nombre: String,
    pub activo: bool,
    pub cualitativo: bool,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_grados_config_by_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<Vec<GradoColegioItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.nombre, cg.activo, cg.cualitativo
              FROM grado g
              INNER JOIN colegio_grado cg ON g.id = cg.grado_id
              WHERE cg.colegio_id = ?
              ORDER BY CAST(SUBSTR(g.nombre, 1, 2) AS INTEGER)",
        )
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([colegioId], |row| {
            Ok(GradoColegioItem {
                id: row.get(0)?,
                nombre: row.get(1)?,
                activo: row.get::<_, i64>(2)? == 1,
                cualitativo: row.get::<_, i64>(3)? == 1,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_colegio_grado(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    gradoId: i64,
    activo: bool,
    cualitativo: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO colegio_grado (colegio_id, grado_id, activo, cualitativo, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(colegio_id, grado_id) DO UPDATE SET activo = excluded.activo, cualitativo = excluded.cualitativo, updated_at = datetime('now')",
        rusqlite::params![colegioId, gradoId, if activo { 1 } else { 0 }, if cualitativo { 1 } else { 0 }],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn delete_colegio_grado(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    gradoId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM colegio_grado WHERE colegio_id = ? AND grado_id = ?)",
        [colegioId, gradoId],
        |row| row.get(0),
    ).unwrap_or(false);
    if exists {
        conn.execute(
            "INSERT INTO sync_pending_deletions_colegio_grado (colegio_id, grado_id) VALUES (?, ?)",
            [colegioId, gradoId],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM colegio_grado WHERE colegio_id = ? AND grado_id = ?",
            [colegioId, gradoId],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_pending_deletions_colegio_grado(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PendingDeletionColegioGrado>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, colegio_id, grado_id FROM sync_pending_deletions_colegio_grado",
        )
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], |row| {
            Ok(PendingDeletionColegioGrado {
                id: row.get(0)?,
                colegio_id: row.get(1)?,
                grado_id: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub async fn remove_pending_deletion_colegio_grado(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_pending_deletions_colegio_grado WHERE id = ?",
        [id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// Generate commands for each category
create_crud_commands_active!(
    ano_lectivo,
    get_anos,
    add_ano,
    update_ano,
    delete_ano,
    set_active_ano
);
create_crud_commands_active!(
    corte_evaluativo,
    get_cortes,
    add_corte,
    update_corte,
    delete_corte,
    set_active_corte
);
// Colegio CRUD Commands (Manual implementation for Order support)
#[tauri::command]
pub async fn get_colegios(state: tauri::State<'_, DbState>) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, nombre, activo, cualitativo FROM colegio ORDER BY orden ASC, nombre ASC",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(CategoryItem {
                id: Some(row.get(0)?),
                nombre: row.get(1)?,
                activo: Some(row.get::<_, i64>(2)? == 1),
                cualitativo: Some(row.get::<_, i64>(3)? == 1),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn add_colegio(state: tauri::State<'_, DbState>, nombre: String) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Get max order
    let max_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(orden), 0) FROM colegio", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO colegio (nombre, activo, cualitativo, orden, tipo) VALUES (?, 0, 0, ?, 'Primaria')",
        rusqlite::params![nombre, max_order + 1],
    )
    .map_err(|e| e.to_string())?;

    let new_id = conn.last_insert_rowid();

    // Heredar todas las asignaturas existentes para este colegio
    let mut stmt = conn
        .prepare("SELECT id FROM asignatura")
        .map_err(|e| e.to_string())?;
    let asignaturas: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for aid in asignaturas {
        conn.execute(
            "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id, updated_at) VALUES (?, ?, datetime('now'))",
            rusqlite::params![new_id, aid],
        )
        .map_err(|e| e.to_string())?;
    }

    // Heredar los grados por defecto (Primaria) para este colegio
    seed_colegio_grados(&conn, new_id, "Primaria")?;

    Ok(new_id)
}

#[tauri::command]
pub async fn update_colegio(
    state: tauri::State<'_, DbState>,
    id: i64,
    nombre: String,
    cualitativo: bool,
    tipo: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let old_tipo: String = conn
        .query_row("SELECT COALESCE(tipo, 'Primaria') FROM colegio WHERE id = ?", [id], |row| row.get(0))
        .unwrap_or_else(|_| "Primaria".to_string());
    conn.execute(
        "UPDATE colegio SET nombre = ?, cualitativo = ?, tipo = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, tipo, id],
    )
    .map_err(|e| e.to_string())?;
    // Si cambió el tipo, re-sembrar grados por defecto del nuevo tipo
    if old_tipo != tipo {
        seed_colegio_grados(&conn, id, &tipo)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_colegio(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM colegio WHERE id = ?", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_colegio(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Deactivate all
    tx.execute("UPDATE colegio SET activo = 0, updated_at = datetime('now')", [])
        .map_err(|e| e.to_string())?;

    // Activate selected
    tx.execute("UPDATE colegio SET activo = 1, updated_at = datetime('now') WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_colegio_order(
    state: tauri::State<'_, DbState>,
    items: Vec<CategoryItem>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, item) in items.iter().enumerate() {
        if let Some(id) = item.id {
            tx.execute(
                "UPDATE colegio SET orden = ?, updated_at = datetime('now') WHERE id = ?",
                rusqlite::params![index as i64, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
create_crud_commands!(
    asignatura,
    get_asignaturas,
    add_asignatura,
    update_asignatura,
    delete_asignatura
);
create_crud_commands!(grado, get_grados, add_grado, update_grado, delete_grado);
create_crud_commands!(
    seccion,
    get_secciones,
    add_seccion,
    update_seccion,
    delete_seccion
);

// Evaluations Commands
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_evaluation_config(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    asignaturaId: i64,
    corteEvaluativoId: i64,
    anoLectivoId: i64,
) -> Result<Vec<Indicador>, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        // Safety: if anoLectivoId is 0 (before catalogs load), don't seed.
        // The frontend guards should prevent this, but just in case.
        if anoLectivoId == 0 {
            return Ok(vec![]);
        }

        // Check if config exists for the requested year
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM indicador WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND ano_lectivo_id = ?",
                [gradoId, asignaturaId, corteEvaluativoId, anoLectivoId],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if count == 0 {
            // Before seeding, check if there are indicators at ano_lectivo_id=0
            // for the same combo — migrate them instead of creating duplicates.
            let orphan_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM indicador WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND ano_lectivo_id = 0",
                    [gradoId, asignaturaId, corteEvaluativoId],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if orphan_count > 0 {
                // Migrate orphans to the correct year
                tx.execute(
                    "UPDATE indicador SET ano_lectivo_id = ? WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND ano_lectivo_id = 0",
                    rusqlite::params![anoLectivoId, gradoId, asignaturaId, corteEvaluativoId],
                )
                .map_err(|e| e.to_string())?;
            } else {
                // Seed 8 indicadores: solo los 5 primeros quedan ACTIVOS, porque
                // la evaluación usa 100 pts y cada indicador activo vale 20
                // (8 x 20 = 160 pts no cabe). Los 3 últimos nacen inactivos y el
                // usuario decide el intercambio desde NotasPage.
                for i in 1..=8 {
                    let activo = if i <= 5 { 1 } else { 0 };
                    tx.execute(
                        "INSERT INTO indicador (grado_id, asignatura_id, corte_evaluativo_id, ano_lectivo_id, orden, descripcion, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        rusqlite::params![gradoId, asignaturaId, corteEvaluativoId, anoLectivoId, i, "", activo],
                    )
                    .map_err(|e| e.to_string())?;

                    let indicador_id = tx.last_insert_rowid();

                    // Seed 3 criteria per indicator
                    // Default scores: 7, 7, 6 = 20 pts
                    let scores = [7, 7, 6];
                    for (j, score) in scores.iter().enumerate() {
                        tx.execute(
                            "INSERT INTO criterio (indicador_id, orden, descripcion, puntaje_maximo) VALUES (?, ?, ?, ?)",
                            rusqlite::params![indicador_id, (j + 1) as i64, "", score],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        } else {
            // Check if there are any active indicators, if not, activate all 8
            let active_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM indicador WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND ano_lectivo_id = ? AND activo = 1",
                    [gradoId, asignaturaId, corteEvaluativoId, anoLectivoId],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            if active_count == 0 {
                // Activate all 8 indicators by default
                tx.execute(
                    "UPDATE indicador SET activo = 1 WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND ano_lectivo_id = ?",
                    [gradoId, asignaturaId, corteEvaluativoId, anoLectivoId],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Now fetch the full tree

    let mut stmt = conn
        .prepare(
            "SELECT id, orden, descripcion, activo, COALESCE(instrumento,'general') FROM indicador
             WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND ano_lectivo_id = ?
             ORDER BY orden",
        )
        .map_err(|e| e.to_string())?;

    let indicadores = stmt
        .query_map([gradoId, asignaturaId, corteEvaluativoId, anoLectivoId], |row| {
            let id: i64 = row.get(0)?;
            let orden: i64 = row.get(1)?;
            let descripcion: String = row.get(2)?;
            let activo: bool = row.get::<_, i64>(3)? == 1;
            let instrumento: String = row.get(4)?;

            Ok(Indicador {
                id: Some(id),
                grado_id: gradoId,
                asignatura_id: asignaturaId,
                corte_evaluativo_id: corteEvaluativoId,
                ano_lectivo_id: anoLectivoId,
                orden,
                descripcion,
                activo,
                instrumento,
                criterios: Vec::new(), // Will fill momentarily
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Populate criteria for each indicator
    let mut result = indicadores;
    for ind in &mut result {
        let mut c_stmt = conn
            .prepare("SELECT id, orden, descripcion, puntaje_maximo FROM criterio WHERE indicador_id = ? ORDER BY orden")
            .map_err(|e| e.to_string())?;

        let criterios = c_stmt
            .query_map([ind.id], |row| {
                Ok(Criterio {
                    id: Some(row.get(0)?),
                    indicador_id: ind.id,
                    orden: row.get(1)?,
                    descripcion: row.get(2)?,
                    puntaje_maximo: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // Self-heal de criterios: usar la MISMA reparación que al arrancar.
        // La versión vieja (sort + split_at(3)) borraba el orden=3 legítimo
        // cuando había un duplicado de orden=1 (4 filas → se quedaba 1,1,2).
        {
            drop(c_stmt);
            if let Some(ind_id) = ind.id {
                if criteria_need_repair(&conn, ind_id)? {
                    repair_one_indicator_criteria(&conn, ind_id)?;
                    let mut s = conn
                        .prepare(
                            "SELECT id, orden, descripcion, puntaje_maximo FROM criterio WHERE indicador_id = ?1 ORDER BY orden",
                        )
                        .map_err(|e| e.to_string())?;
                    let recargados = s
                        .query_map([ind_id], |row| {
                            Ok(Criterio {
                                id: Some(row.get(0)?),
                                indicador_id: ind.id,
                                orden: row.get(1)?,
                                descripcion: row.get(2)?,
                                puntaje_maximo: row.get(3)?,
                            })
                        })
                        .map_err(|e| e.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?;
                    drop(s);
                    ind.criterios = recargados;
                } else {
                    ind.criterios = criterios;
                }
            } else {
                ind.criterios = criterios;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn update_indicador(
    state: tauri::State<'_, DbState>,
    id: i64,
    descripcion: String,
    activo: bool,
    instrumento: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Instrumento opcional para retrocompatibilidad con llamadas existentes
    // (EvaluacionesPage): si viene None se conserva el valor actual.
    let n = if let Some(instr) = instrumento {
        let instr = if instr.trim().is_empty() { "general".to_string() } else { instr.trim().to_lowercase() };
        conn.execute(
            "UPDATE indicador SET descripcion = ?, activo = ?, instrumento = ?, updated_at = datetime('now') WHERE id = ?",
            rusqlite::params![descripcion, if activo { 1 } else { 0 }, instr, id],
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.execute(
            "UPDATE indicador SET descripcion = ?, activo = ?, updated_at = datetime('now') WHERE id = ?",
            rusqlite::params![descripcion, if activo { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?
    };
    if n == 0 {
        return Err(format!("Indicador {} no encontrado", id));
    }
    Ok(())
}

/// Vacía las notas de los criterios de un indicador **de un solo corte y
/// asignatura**, sin borrar el indicador ni sus criterios: las celdas quedan
/// listas para volver a llenarse. Los indicadores jamas se eliminan, por eso
/// esta es la via para "empezar de cero" con un indicador. Registra tombstones
/// para que el vaciado llegue al resto de dispositivos por el sync de D1.
/// Devuelve cuantas notas borro.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn vaciar_notas_indicador(
    state: tauri::State<'_, DbState>,
    id: i64,
    corteId: i64,
    asignaturaId: i64,
) -> Result<usize, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let existe: i64 = tx
        .query_row("SELECT COUNT(*) FROM indicador WHERE id = ?", [id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if existe == 0 {
        let _ = tx.rollback();
        return Err(format!("Indicador {} no encontrado", id));
    }
    if corteId <= 0 {
        let _ = tx.rollback();
        return Err("No hay corte evaluativo seleccionado".to_string());
    }

    let criterios: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM criterio WHERE indicador_id = ?")
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        ids
    };

    // Solo las notas de ESTE corte y asignatura: los demas cortes no se tocan.
    let mut total_notas = 0usize;
    for crit_id in &criterios {
        let notas: Vec<(i64, i64, i64, i64)> = {
            let mut stmt = tx
                .prepare(
                    "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id
                     FROM nota
                     WHERE criterio_id = ?1 AND corte_evaluativo_id = ?2 AND asignatura_id = ?3",
                )
                .map_err(|e| e.to_string())?;
            let filas = stmt
                .query_map(rusqlite::params![crit_id, corteId, asignaturaId], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            filas
        };
        for (est_id, c_id, corte_id, asig_id) in notas {
            tx.execute(
                "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
                 VALUES (?, ?, ?, ?)",
                rusqlite::params![est_id, c_id, corte_id, asig_id],
            )
            .map_err(|e| e.to_string())?;
        }
        total_notas += tx
            .execute(
                "DELETE FROM nota
                 WHERE criterio_id = ?1 AND corte_evaluativo_id = ?2 AND asignatura_id = ?3",
                rusqlite::params![crit_id, corteId, asignaturaId],
            )
            .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(total_notas)
}

/// Elimina un criterio (una columna de la tabla) y todas sus notas.
/// Al borrar un criterio se renumeran los `orden` restantes de su indicador para
/// que no queden huecos en C1, C2, C3.
#[tauri::command]
pub async fn delete_criterio(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let indicador_id: Option<i64> = tx
        .query_row("SELECT indicador_id FROM criterio WHERE id = ?", [id], |row| row.get(0))
        .ok();

    let notas: Vec<(i64, i64, i64, i64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id
                 FROM nota WHERE criterio_id = ?",
            )
            .map_err(|e| e.to_string())?;
        let filas = stmt
            .query_map([id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        filas
    };
    for (est_id, c_id, corte_id, asig_id) in notas {
        tx.execute(
            "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
             VALUES (?, ?, ?, ?)",
            rusqlite::params![est_id, c_id, corte_id, asig_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM nota WHERE criterio_id = ?", [id])
        .map_err(|e| e.to_string())?;

    let borrados = tx
        .execute("DELETE FROM criterio WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    if borrados == 0 {
        let _ = tx.rollback();
        return Err(format!("Criterio {} no encontrado", id));
    }
    tx.execute(
        "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES ('criterio', ?)",
        [id],
    )
    .map_err(|e| e.to_string())?;

    // Renumerar el orden de los criterios restantes del indicador (sin UNIQUE clash).
    if let Some(ind_id) = indicador_id {
        let restantes: Vec<i64> = {
            let mut stmt = tx
                .prepare("SELECT id FROM criterio WHERE indicador_id = ? ORDER BY orden, id")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map([ind_id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            ids
        };
        for (i, crit_id) in restantes.iter().enumerate() {
            tx.execute(
                "UPDATE criterio SET orden = ? WHERE id = ?",
                rusqlite::params![-((i + 1) as i64), crit_id],
            )
            .map_err(|e| e.to_string())?;
        }
        for (i, crit_id) in restantes.iter().enumerate() {
            tx.execute(
                "UPDATE criterio SET orden = ? WHERE id = ?",
                rusqlite::params![(i + 1) as i64, crit_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Indicadores que suman al total **para un colegio + seccion** concretos.
///
/// Hereda del global (`indicador.activo`) y aplica encima las excepciones de la
/// tabla `indicador_colegio_seccion_activo`: si esa pareja tiene fila para un
/// indicador, manda esa; si no, manda el global. Asi cada colegio puede usar un
/// juego distinto de indicadores sin tocar la configuracion global.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_indicadores_activos_colegio_seccion(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    seccionId: i64,
    gradoId: i64,
    asignaturaId: i64,
    corteEvaluativoId: i64,
) -> Result<Vec<i64>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if colegioId <= 0 || seccionId <= 0 || gradoId <= 0 || asignaturaId <= 0 || corteEvaluativoId <= 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT i.id
             FROM indicador i
             LEFT JOIN indicador_colegio_seccion_activo s
                    ON s.indicador_id = i.id AND s.seccion_id = ?2 AND s.colegio_id = ?1
             WHERE i.grado_id = ?3 AND i.asignatura_id = ?4 AND i.corte_evaluativo_id = ?5
               AND COALESCE(s.activo, i.activo) = 1
             ORDER BY i.orden",
        )
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map(
            rusqlite::params![colegioId, seccionId, gradoId, asignaturaId, corteEvaluativoId],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

/// Fija si un indicador suma al total para un colegio + seccion (no toca el global).
#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_indicador_colegio_seccion_activo(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    seccionId: i64,
    indicadorId: i64,
    activo: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if colegioId <= 0 || seccionId <= 0 {
        return Err("Falta seleccionar colegio o sección".to_string());
    }
    let existe: i64 = conn
        .query_row("SELECT COUNT(*) FROM indicador WHERE id = ?", [indicadorId], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if existe == 0 {
        return Err(format!("Indicador {} no encontrado", indicadorId));
    }
    conn.execute(
        "INSERT INTO indicador_colegio_seccion_activo (colegio_id, seccion_id, indicador_id, activo, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(colegio_id, seccion_id, indicador_id)
         DO UPDATE SET activo = excluded.activo, updated_at = datetime('now')",
        rusqlite::params![colegioId, seccionId, indicadorId, if activo { 1 } else { 0 }],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Devuelve colegio + seccion a los globales (borra sus excepciones).
/// Solo borra las de la combinacion grado/asignatura/corte indicada: las
/// excepciones de otros grados se respetan.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn reset_indicadores_colegio_seccion(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    seccionId: i64,
    gradoId: i64,
    asignaturaId: i64,
    corteEvaluativoId: i64,
) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if colegioId <= 0 || seccionId <= 0 || gradoId <= 0 || asignaturaId <= 0 || corteEvaluativoId <= 0 {
        return Ok(0);
    }
    let n = conn
        .execute(
            "DELETE FROM indicador_colegio_seccion_activo
             WHERE colegio_id = ?1 AND seccion_id = ?2
               AND indicador_id IN (
                   SELECT id FROM indicador
                   WHERE grado_id = ?3 AND asignatura_id = ?4 AND corte_evaluativo_id = ?5
               )",
            rusqlite::params![colegioId, seccionId, gradoId, asignaturaId, corteEvaluativoId],
        )
        .map_err(|e| e.to_string())?;
    Ok(n)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn update_criterio(
    state: tauri::State<'_, DbState>,
    id: i64,
    descripcion: String,
    puntajeMaximo: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE criterio SET descripcion = ?, puntaje_maximo = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![descripcion, puntajeMaximo, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// NotasPage Commands
// Estructura especÃ­fica para estudiantes en la pÃ¡gina de notas
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EstudianteNota {
    pub id: i64,
    pub nombre: String,
    pub sexo: String,
    pub grado_id: i64,
    pub seccion_id: i64,
    pub grado: String,
    pub seccion: String,
    pub cualitativo: bool,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_estudiantes_by_filters(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    seccionId: i64,
) -> Result<Vec<EstudianteNota>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.nombre, e.sexo, e.grado_id, e.seccion_id, g.nombre as grado, s.nombre as seccion, g.cualitativo
             FROM estudiante e
             INNER JOIN grado g ON e.grado_id = g.id
             INNER JOIN seccion s ON e.seccion_id = s.id
             WHERE e.grado_id = ? AND e.seccion_id = ?
             ORDER BY e.nombre",
        )
        .map_err(|e| e.to_string())?;

    let estudiantes = stmt
        .query_map([gradoId, seccionId], |row| {
            Ok(EstudianteNota {
                id: row.get(0)?,
                nombre: row.get(1)?,
                sexo: row.get(2)?,
                grado_id: row.get(3)?,
                seccion_id: row.get(4)?,
                grado: row.get(5)?,
                seccion: row.get(6)?,
                cualitativo: row.get::<_, i64>(7)? == 1,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(estudiantes)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn save_notas_estudiantes(
    state: tauri::State<'_, DbState>,
    notas: Vec<NotaEstudianteRequest>,
    corteId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for nota_est in notas {
        for nota in &nota_est.notas {
            tx.execute(
                "INSERT INTO nota (estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id) 
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
                 DO UPDATE SET
                   valor = excluded.valor,
                   updated_at = CASE WHEN valor IS NOT excluded.valor
                     THEN datetime('now') ELSE updated_at END",
                rusqlite::params![
                    nota_est.estudianteId,
                    nota.criterioId,
                    nota.valor,
                    corteId,
                    asignaturaId
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        // Criterios que el usuario dejo vacios: la fila se borra de verdad (antes
        // el upsert la dejaba intacta y la nota reaparecia al recargar). El
        // tombstone se registra en la misma transaccion para que el sync D1
        // propague el borrado al resto de dispositivos.
        for criterio_id in &nota_est.borrados {
            let filas = tx
                .execute(
                    "DELETE FROM nota
                     WHERE estudiante_id = ?1 AND criterio_id = ?2
                       AND corte_evaluativo_id = ?3 AND asignatura_id = ?4",
                    rusqlite::params![nota_est.estudianteId, *criterio_id, corteId, asignaturaId],
                )
                .map_err(|e| e.to_string())?;
            if filas > 0 {
                tx.execute(
                    "INSERT INTO sync_pending_deletions_nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
                     VALUES (?, ?, ?, ?)",
                    rusqlite::params![nota_est.estudianteId, *criterio_id, corteId, asignaturaId],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_colegio_dias_asistencia(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<ColegioDiasAsistencia, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo 
             FROM colegio_dias_asistencia 
             WHERE colegio_id = ?",
        )
        .map_err(|e| e.to_string())?;

    let res = stmt.query_row(rusqlite::params![colegioId], |row| {
        Ok(ColegioDiasAsistencia {
            colegio_id: row.get(0)?,
            lunes: row.get(1)?,
            martes: row.get(2)?,
            miercoles: row.get(3)?,
            jueves: row.get(4)?,
            viernes: row.get(5)?,
            sabado: row.get(6)?,
            domingo: row.get(7)?,
        })
    });

    match res {
        Ok(config) => Ok(config),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Sin fila guardada, el colegio trabaja de lunes a viernes (el mismo
            // default del asistente de Welcome). Antes devolvía los 7 días en
            // `true`, y como el filtro de días hábiles del frontend descarta solo
            // los que están en `false`, el colegio terminaba dando clases sábado
            // y domingo: se veían columnas de fin de semana en la grilla y fines
            // de semana en la lista de días para marcar.
            Ok(ColegioDiasAsistencia {
                colegio_id: colegioId,
                lunes: true,
                martes: true,
                miercoles: true,
                jueves: true,
                viernes: true,
                sabado: false,
                domingo: false,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn save_colegio_dias_asistencia(
    state: tauri::State<'_, DbState>,
    config: ColegioDiasAsistencia,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
         "INSERT INTO colegio_dias_asistencia (colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
          ON CONFLICT(colegio_id) DO UPDATE SET 
          lunes = excluded.lunes, 
          martes = excluded.martes, 
          miercoles = excluded.miercoles, 
          jueves = excluded.jueves, 
          viernes = excluded.viernes, 
          sabado = excluded.sabado, 
          domingo = excluded.domingo,
          updated_at = datetime('now')",
        rusqlite::params![
            config.colegio_id,
            config.lunes,
            config.martes,
            config.miercoles,
            config.jueves,
            config.viernes,
            config.sabado,
            config.domingo
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiaSinClase {
    pub id: i64,
    pub colegio_id: i64,
    pub grado_id: Option<i64>,
    pub seccion_id: Option<i64>,
    pub fecha: String,
    pub descripcion: String,
}

/// Devuelve los días sin clases que aplican a una sección de un grado dentro de
/// un rango (incluye las marcas a nivel colegio, con grado_id/seccion_id NULL).
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_dias_sin_clases(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    gradoId: Option<i64>,
    seccionId: Option<i64>,
    fechaInicio: String,
    fechaFin: String,
) -> Result<Vec<DiaSinClase>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, colegio_id, grado_id, seccion_id, fecha, descripcion
             FROM dia_sin_clases
             WHERE colegio_id = ?1 AND fecha >= ?2 AND fecha <= ?3
               AND ((grado_id IS NULL AND seccion_id IS NULL)
                    OR (grado_id IS ?4 AND seccion_id IS ?5))
             ORDER BY fecha",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![colegioId, fechaInicio, fechaFin, gradoId, seccionId],
            |row| {
                Ok(DiaSinClase {
                    id: row.get(0)?,
                    colegio_id: row.get(1)?,
                    grado_id: row.get(2)?,
                    seccion_id: row.get(3)?,
                    fecha: row.get(4)?,
                    descripcion: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Marca o desmarca días sin clases. `gradoId`/`seccionId` = None → marca a nivel
/// colegio; con valores → solo esa sección de ese grado. Al desmarcar elimina las
/// filas del alcance indicado y registra los borrados en sync_pending_deletions.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_dias_sin_clases(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    gradoId: Option<i64>,
    seccionId: Option<i64>,
    fechas: Vec<String>,
    descripcion: String,
    activo: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if activo {
        for fecha in &fechas {
            tx.execute(
                "INSERT INTO dia_sin_clases (colegio_id, grado_id, seccion_id, fecha, descripcion, updated_at)
                 VALUES (?, ?, ?, ?, ?, datetime('now'))
                 ON CONFLICT(colegio_id, IFNULL(grado_id, 0), IFNULL(seccion_id, 0), fecha) DO UPDATE SET
                   descripcion = excluded.descripcion,
                   updated_at = excluded.updated_at",
                rusqlite::params![colegioId, gradoId, seccionId, fecha, descripcion],
            )
            .map_err(|e| format!("Error marcando {}: {}", fecha, e))?;
        }
    } else {
        for fecha in &fechas {
            let ids: Vec<i64> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT id FROM dia_sin_clases
                         WHERE colegio_id = ?1 AND fecha = ?2
                           AND grado_id IS ?3 AND seccion_id IS ?4",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(rusqlite::params![colegioId, fecha, gradoId, seccionId], |r| r.get::<_, i64>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            };
            for id in ids {
                tx.execute(
                    "INSERT INTO sync_pending_deletions (tabla, registro_id) VALUES ('dia_sin_clases', ?)",
                    rusqlite::params![id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM dia_sin_clases WHERE id = ?", [id])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(non_snake_case)]
pub struct NotaEstudianteRequest {
    pub estudianteId: i64,
    pub notas: Vec<NotaRequest>,
    /// Criterios que el usuario dejo vacios y hay que borrar de `nota`.
    #[serde(default)]
    pub borrados: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(non_snake_case)]
pub struct NotaRequest {
    pub criterioId: i64,
    pub valor: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColegioDiasAsistencia {
    pub colegio_id: i64,
    pub lunes: bool,
    pub martes: bool,
    pub miercoles: bool,
    pub jueves: bool,
    pub viernes: bool,
    pub sabado: bool,
    pub domingo: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotaResponse {
    pub estudiante_id: i64,
    pub criterio_id: i64,
    pub valor: f64,
    pub corte_evaluativo_id: Option<i64>,
    pub asignatura_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GradeConfig {
    pub id: String,
    pub nombre: String,
    pub color: String,
    pub minimo: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MultiplicadorItem {
    pub id: String,
    pub multiplicador: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsistenciaRecord {
    pub id: Option<i64>,
    pub estudiante_id: i64,
    pub fecha: String,
    pub estado: String,
    pub observacion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsistenciaEstudiante {
    pub id: i64,
    pub nombre: String,
    pub codigo: String,
    pub sexo: String,
    pub estado: Option<String>,
    pub observacion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyPctItem {
    pub estudiante_id: i64,
    pub pct: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsistenciaReporteItem {
    pub id: i64,
    pub nombre: String,
    pub sexo: String,
    pub fechas: Vec<String>,        // "YYYY-MM-DD:ESTADO"
    pub observaciones: Vec<String>, // "YYYY-MM-DD:OBSERVACION"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsistenciaEstudianteDia {
    pub fecha: String,
    pub estado: Option<String>,
    pub observacion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsistenciaEstudianteMulti {
    pub id: i64,
    pub nombre: String,
    pub codigo: String,
    pub sexo: String,
    pub dias: Vec<AsistenciaEstudianteDia>,
}

#[tauri::command]
pub async fn get_grade_configs(state: tauri::State<'_, DbState>) -> Result<Vec<GradeConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, nombre, color, minimo FROM configuracion_calificacion")
        .map_err(|e| e.to_string())?;

    let configs = stmt
        .query_map([], |row| {
            Ok(GradeConfig {
                id: row.get(0)?,
                nombre: row.get(1)?,
                color: row.get(2)?,
                minimo: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(configs)
}

#[tauri::command]
pub async fn update_grade_config(
    state: tauri::State<'_, DbState>,
    id: String,
    nombre: String,
    color: String,
    minimo: i32,
    old_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE configuracion_calificacion SET id = ?, nombre = ?, color = ?, minimo = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![id, nombre, color, minimo, old_id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_multiplicadores(state: tauri::State<'_, DbState>) -> Result<Vec<MultiplicadorItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, multiplicador FROM multiplicador_calificacion")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], |row| {
            Ok(MultiplicadorItem {
                id: row.get(0)?,
                multiplicador: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub async fn update_multiplicador(
    state: tauri::State<'_, DbState>,
    id: String,
    multiplicador: f64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO multiplicador_calificacion (id, multiplicador) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET
           multiplicador = excluded.multiplicador,
           updated_at = CASE WHEN multiplicador IS NOT excluded.multiplicador
             THEN datetime('now') ELSE updated_at END",
        rusqlite::params![id, multiplicador],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_notas_by_filters(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    seccionId: i64,
    corteId: i64,
    asignaturaId: i64,
) -> Result<Vec<NotaResponse>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT n.estudiante_id, n.criterio_id, n.valor 
             FROM nota n
             INNER JOIN estudiante e ON n.estudiante_id = e.id
             WHERE e.grado_id = ? AND e.seccion_id = ? 
             AND n.corte_evaluativo_id = ? AND n.asignatura_id = ?",
        )
        .map_err(|e| e.to_string())?;

    let notas = stmt
        .query_map([gradoId, seccionId, corteId, asignaturaId], |row| {
            Ok(NotaResponse {
                estudiante_id: row.get(0)?,
                criterio_id: row.get(1)?,
                valor: row.get(2)?,
                corte_evaluativo_id: Some(corteId),
                asignatura_id: Some(asignaturaId),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notas)
}

/// Porcentaje final (nota final del corte) por estudiante para varios cortes.
/// SOLO LECTURA: no siembra indicadores ni configuración (a diferencia de
/// `get_evaluation_config`, que crea 8 indicadores si el corte no tiene config).
/// Se usa en NotasPage para comparar el rendimiento de cortes anteriores.
/// Suma solo criterios con nota de indicadores activos del mismo grado/asignatura,
/// replicando la regla de cálculo de ReportesPage.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CortePctRow {
    pub corte_id: i64,
    pub estudiante_id: i64,
    pub total: f64,
    pub maximo: f64,
    pub pct: i64,
}

#[tauri::command]
pub async fn get_pcts_por_corte(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    seccionId: i64,
    asignaturaId: i64,
    cortesIds: Vec<i64>,
) -> Result<Vec<CortePctRow>, String> {
    if cortesIds.is_empty() {
        return Ok(vec![]);
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let ids = cortesIds
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT n.corte_evaluativo_id, n.estudiante_id, SUM(n.valor), SUM(c.puntaje_maximo)
         FROM nota n
         INNER JOIN criterio c ON c.id = n.criterio_id
         INNER JOIN indicador i ON i.id = c.indicador_id
         INNER JOIN estudiante e ON e.id = n.estudiante_id
         WHERE i.activo = 1
         AND i.asignatura_id = n.asignatura_id
         AND i.grado_id = e.grado_id
         AND e.grado_id = {grado}
         AND e.seccion_id = {seccion}
         AND n.asignatura_id = {asignatura}
         AND n.corte_evaluativo_id IN ({ids})
         GROUP BY n.corte_evaluativo_id, n.estudiante_id",
        grado = gradoId,
        seccion = seccionId,
        asignatura = asignaturaId,
        ids = ids
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let total: f64 = row.get(2)?;
            let maximo: f64 = row.get(3)?;
            let pct = if maximo > 0.0 {
                ((total / maximo) * 100.0).round() as i64
            } else {
                0
            };
            Ok(CortePctRow {
                corte_id: row.get(0)?,
                estudiante_id: row.get(1)?,
                total,
                maximo,
                pct,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Normaliza un email de cuenta para usarlo como sufijo de archivo de BD.
/// Ej: "Plbarostegui92@gmail.com" -> "plbarostegui92_gmail_com"
pub fn sanitize_account_id(email: &str) -> String {
    let mut s: String = email
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    while s.contains("__") {
        s = s.replace("__", "_");
    }
    s.trim_matches('_').to_string()
}

/// Ruta del archivo que marca la cuenta de Google activa en este dispositivo.
fn active_marker_path(app_dir: &std::path::Path) -> std::path::PathBuf {
    app_dir.join("active_account.txt")
}

/// Lee el email de la cuenta activa (o None si no hay ninguna marcada).
pub fn read_active_account(app_dir: &std::path::Path) -> Option<String> {
    match std::fs::read_to_string(active_marker_path(app_dir)) {
        Ok(s) => {
            let s = s.trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        Err(_) => None,
    }
}

/// Persiste el email de la cuenta activa para reabrir su BD al iniciar la app.
pub fn write_active_account(app_dir: &std::path::Path, email: &str) -> Result<(), String> {
    std::fs::write(active_marker_path(app_dir), email)
        .map_err(|e| format!("No se pudo guardar la cuenta activa: {}", e))
}

/// Ruta del archivo SQLite de una cuenta concreta.
pub fn account_db_path(app_dir: &std::path::Path, email: &str) -> std::path::PathBuf {
    app_dir.join(format!("school_{}.db", sanitize_account_id(email)))
}

/// Ruta de la BD que debe usarse ahora: la de la cuenta activa si existe,
/// si no la BD por defecto (school.db) por compatibilidad con instalaciones previas.
pub fn resolve_active_db_path(app_dir: &std::path::Path) -> std::path::PathBuf {
    if let Some(email) = read_active_account(app_dir) {
        let p = account_db_path(app_dir, &email);
        if p.exists() {
            return p;
        }
    }
    app_dir.join("school.db")
}

#[tauri::command]
pub async fn get_db_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    let profile = std::env::var("SCHOOLTRACKER_PROFILE").unwrap_or_default();
    let dir = if !profile.is_empty() {
        let dir = app_dir.join(&profile);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir
    } else {
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        app_dir
    };
    Ok(resolve_active_db_path(&dir).to_string_lossy().to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_asistencia_estudiantes(
    state: tauri::State<'_, DbState>,
    fecha: String,
    _anoLectivoId: i64,
    _colegioId: i64,
    gradoId: i64,
    seccionId: i64,
    sexo: Option<String>,
) -> Result<Vec<AsistenciaEstudiante>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

let mut query = String::from(
        "SELECT e.id, e.nombre, e.codigo, e.sexo, a.estado, COALESCE(a.observacion, '') as observacion
         FROM estudiante e
         LEFT JOIN asistencia a ON e.id = a.estudiante_id AND a.fecha = ?
         WHERE e.grado_id = ? AND e.seccion_id = ?"
    );

    let mut params: Vec<Box<dyn rusqlite::ToSql>> =
        vec![Box::new(fecha), Box::new(gradoId), Box::new(seccionId)];

    if let Some(s) = sexo {
        if !s.is_empty() {
            query.push_str(" AND e.sexo = ?");
            params.push(Box::new(s));
        }
    }

    query.push_str(" ORDER BY e.nombre");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), |row| {
            Ok(AsistenciaEstudiante {
                id: row.get(0)?,
                nombre: row.get(1)?,
                codigo: row.get(2)?,
                sexo: row.get(3)?,
                estado: row.get(4)?,
                observacion: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_monthly_attendance_pct(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    seccionId: i64,
    fecha: String,
) -> Result<Vec<MonthlyPctItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if fecha.len() < 7 {
        return Err("Fecha invÃ¡lida".to_string());
    }
    let mes = &fecha[..7];
    let mes_pattern = format!("{}%", mes);
    let mut stmt = conn.prepare(
        "SELECT e.id,
           CASE WHEN COUNT(a.id) > 0
             THEN ROUND(CAST(SUM(CASE WHEN a.estado = 'P' THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id) * 100, 1)
             ELSE 0.0 END as pct
         FROM estudiante e
         LEFT JOIN asistencia a ON e.id = a.estudiante_id AND a.fecha LIKE ?
         WHERE e.grado_id = ? AND e.seccion_id = ?
         GROUP BY e.id
         ORDER BY e.nombre"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(
        rusqlite::params![mes_pattern, gradoId, seccionId],
        |row| Ok(MonthlyPctItem {
            estudiante_id: row.get(0)?,
            pct: row.get(1)?,
        })
    ).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_asistencia_estudiantes_rango(
    state: tauri::State<'_, DbState>,
    fechaInicio: String,
    fechaFin: String,
    gradoId: i64,
    seccionId: i64,
    sexo: Option<String>,
) -> Result<Vec<AsistenciaEstudianteMulti>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT e.id, e.nombre, e.codigo, e.sexo FROM estudiante e
         WHERE e.grado_id = ? AND e.seccion_id = ?"
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(gradoId), Box::new(seccionId)];

    if let Some(ref s) = sexo {
        if !s.is_empty() {
            sql.push_str(" AND e.sexo = ?");
            params.push(Box::new(s.clone()));
        }
    }
    sql.push_str(" ORDER BY e.nombre");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let estudiantes: Vec<(i64, String, String, String)> = stmt
        .query_map(rusqlite::params_from_iter(params), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if estudiantes.is_empty() {
        return Ok(vec![]);
    }

    let ids: Vec<i64> = estudiantes.iter().map(|e| e.0).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let asistencia_sql = format!(
        "SELECT estudiante_id, fecha, estado, COALESCE(observacion, '') FROM asistencia
         WHERE estudiante_id IN ({}) AND fecha >= ? AND fecha <= ?
         ORDER BY estudiante_id, fecha",
        placeholders
    );

    let mut asistencia_params: Vec<Box<dyn rusqlite::ToSql>> =
        ids.iter().map(|id| Box::new(*id) as Box<dyn rusqlite::ToSql>).collect();
    asistencia_params.push(Box::new(fechaInicio));
    asistencia_params.push(Box::new(fechaFin));

    let mut asistencia_stmt = conn.prepare(&asistencia_sql).map_err(|e| e.to_string())?;
    let asistencia_rows: Vec<(i64, String, String, String)> = asistencia_stmt
        .query_map(rusqlite::params_from_iter(asistencia_params), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    use std::collections::HashMap;
    let mut asistencia_map: HashMap<i64, Vec<AsistenciaEstudianteDia>> = HashMap::new();
    for (est_id, fecha, estado, obs) in asistencia_rows {
        asistencia_map.entry(est_id).or_default().push(AsistenciaEstudianteDia {
            fecha,
            estado: Some(estado),
            observacion: if obs.is_empty() { None } else { Some(obs) },
        });
    }

    let result = estudiantes
        .into_iter()
        .map(|(id, nombre, codigo, sexo)| AsistenciaEstudianteMulti {
            id,
            nombre,
            codigo,
            sexo,
            dias: asistencia_map.remove(&id).unwrap_or_default(),
        })
        .collect();

    Ok(result)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_asistencia_rango(
    state: tauri::State<'_, DbState>,
    fechaInicio: String,
    fechaFin: String,
    _anoLectivoId: i64,
    _colegioId: i64,
    gradoId: i64,
    seccionId: i64,
) -> Result<Vec<AsistenciaReporteItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 1. Obtener todos los estudiantes filtrados
    let mut stmt_est = conn
        .prepare(
            "SELECT id, nombre, sexo FROM estudiante
         WHERE grado_id = ? AND seccion_id = ?
         ORDER BY nombre",
        )
        .map_err(|e| e.to_string())?;

    let estudiantes = stmt_est
        .query_map([gradoId, seccionId], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 2. Obtener toda la asistencia en el rango para esos filtros
    let mut stmt_asist = conn
        .prepare(
            "SELECT a.estudiante_id, a.fecha, a.estado, COALESCE(a.observacion, '')
         FROM asistencia a
         INNER JOIN estudiante e ON a.estudiante_id = e.id
         WHERE a.fecha >= ? AND a.fecha <= ?
         AND e.grado_id = ? AND e.seccion_id = ?",
        )
        .map_err(|e| e.to_string())?;

    let asignaciones = stmt_asist
        .query_map(
            rusqlite::params![fechaInicio, fechaFin, gradoId, seccionId],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 3. Agrupar
    let mut result = Vec::new();
    for (id, nombre, sexo) in estudiantes {
        let mut fechas = Vec::new();
        let mut observaciones = Vec::new();
        for (asist_est_id, fecha, estado, obs) in &asignaciones {
            if *asist_est_id == id {
                fechas.push(format!("{}:{}", fecha, estado));
                if !obs.is_empty() {
                    observaciones.push(format!("{}:{}", fecha, obs));
                }
            }
        }
        result.push(AsistenciaReporteItem {
            id,
            nombre,
            sexo,
            fechas,
            observaciones,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn save_asistencia(
    state: tauri::State<'_, DbState>,
    records: Vec<AsistenciaRecord>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for record in records {
        tx.execute(
            "INSERT INTO asistencia (estudiante_id, fecha, estado, observacion) 
             VALUES (?, ?, ?, ?) 
             ON CONFLICT(estudiante_id, fecha) DO UPDATE SET 
             estado = excluded.estado, 
             observacion = excluded.observacion,
             updated_at = CASE WHEN estado IS NOT excluded.estado OR observacion IS NOT excluded.observacion
               THEN datetime('now') ELSE updated_at END",
            rusqlite::params![
                record.estudiante_id,
                record.fecha,
                record.estado,
                record.observacion
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_asistencia_batch(
    state: tauri::State<'_, DbState>,
    estudiante_ids: Vec<i64>,
    fecha: String,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for id in estudiante_ids {
        // Verificar si existe el registro antes de eliminarlo
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM asistencia WHERE estudiante_id = ? AND fecha = ?)",
                rusqlite::params![id, &fecha],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if exists {
            // Registrar la eliminaciÃ³n pendiente ANTES de eliminar
            tx.execute(
                "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                rusqlite::params![id, &fecha],
            ).map_err(|e| e.to_string())?;

            // Eliminar el registro
            tx.execute(
                "DELETE FROM asistencia WHERE estudiante_id = ? AND fecha = ?",
                rusqlite::params![id, &fecha],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_asistencia_rango(
    state: tauri::State<'_, DbState>,
    estudiante_ids: Vec<i64>,
    fecha_inicio: String,
    fecha_fin: String,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for id in estudiante_ids {
        let mut stmt = tx
            .prepare("SELECT fecha FROM asistencia WHERE estudiante_id = ? AND fecha >= ? AND fecha <= ?")
            .map_err(|e| e.to_string())?;
        let fechas: Vec<String> = stmt
            .query_map(rusqlite::params![id, &fecha_inicio, &fecha_fin], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        for fecha in &fechas {
            tx.execute(
                "INSERT INTO sync_pending_deletions_asistencia (estudiante_id, fecha) VALUES (?, ?)",
                rusqlite::params![id, fecha],
            ).map_err(|e| e.to_string())?;
        }

        tx.execute(
            "DELETE FROM asistencia WHERE estudiante_id = ? AND fecha >= ? AND fecha <= ?",
            rusqlite::params![id, &fecha_inicio, &fecha_fin],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_indicadores_all(state: tauri::State<'_, DbState>) -> Result<Vec<Indicador>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, grado_id, asignatura_id, corte_evaluativo_id, COALESCE(ano_lectivo_id, 0), orden, descripcion, activo, COALESCE(instrumento,'general') FROM indicador")
        .map_err(|e| e.to_string())?;

    let indicadores = stmt
        .query_map([], |row| {
            Ok(Indicador {
                id: Some(row.get(0)?),
                grado_id: row.get(1)?,
                asignatura_id: row.get(2)?,
                corte_evaluativo_id: row.get(3)?,
                ano_lectivo_id: row.get(4)?,
                orden: row.get(5)?,
                descripcion: row.get(6)?,
                activo: row.get::<_, i64>(7)? == 1,
                instrumento: row.get(8)?,
                criterios: vec![],
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(indicadores)
}

#[tauri::command]
pub async fn get_criterios_all(state: tauri::State<'_, DbState>) -> Result<Vec<Criterio>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, indicador_id, orden, descripcion, puntaje_maximo FROM criterio")
        .map_err(|e| e.to_string())?;

    let criterios = stmt
        .query_map([], |row| {
            Ok(Criterio {
                id: Some(row.get(0)?),
                indicador_id: Some(row.get(1)?),
                orden: row.get(2)?,
                descripcion: row.get(3)?,
                puntaje_maximo: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(criterios)
}

#[tauri::command]
pub async fn get_notas_all(state: tauri::State<'_, DbState>) -> Result<Vec<NotaResponse>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id FROM nota")
        .map_err(|e| e.to_string())?;

    let notas = stmt
        .query_map([], |row| {
            Ok(NotaResponse {
                estudiante_id: row.get(0)?,
                criterio_id: row.get(1)?,
                valor: row.get(2)?,
                corte_evaluativo_id: Some(row.get(3)?),
                asignatura_id: Some(row.get(4)?),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notas)
}

#[tauri::command]
pub async fn get_asistencia_all(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<AsistenciaRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, estudiante_id, fecha, estado, COALESCE(observacion, '') FROM asistencia")
        .map_err(|e| e.to_string())?;

    let registros = stmt
        .query_map([], |row| {
            Ok(AsistenciaRecord {
                id: Some(row.get(0)?),
                estudiante_id: row.get(1)?,
                fecha: row.get(2)?,
                estado: row.get(3)?,
                observacion: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(registros)
}


/// DiagnÃ³stico: muestra el conteo de notas en SQLite filtrado por grado/secciÃ³n/corte/asignatura
#[tauri::command]
pub async fn get_notas_count(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    seccionId: i64,
    corteId: i64,
    asignaturaId: i64,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM nota n INNER JOIN estudiante e ON n.estudiante_id = e.id WHERE e.grado_id = ? AND e.seccion_id = ? AND n.corte_evaluativo_id = ? AND n.asignatura_id = ?",
        rusqlite::params![gradoId, seccionId, corteId, asignaturaId],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    println!("[diagnose] notas en SQLite (grado={}, seccion={}, corte={}, asig={}): {}", gradoId, seccionId, corteId, asignaturaId, count);
    Ok(count)
}

/// DiagnÃ³stico: muestra cantidad total de notas en SQLite
#[tauri::command]
pub async fn get_notas_count_all(state: tauri::State<'_, DbState>) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM nota", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    println!("[diagnose] Total notas en SQLite: {}", count);
    Ok(count)
}

#[tauri::command]
pub async fn delete_record_local(
    state: tauri::State<'_, DbState>,
    table: String,
    id: serde_json::Value,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    
    println!("ðŸ—‘ï¸ [DB] delete_record_local: {} con id {:?}", table, id);

    let sql = match table.as_str() {
        "asistencia" => {
            // Asistencia usa clave compuesta o ID. Si viene un objeto, es clave compuesta.
            if let Some(obj) = id.as_object() {
                let student_id = obj.get("estudianteId").or_else(|| obj.get("estudiante_id")).and_then(|v| v.as_i64());
                let fecha = obj.get("fecha").and_then(|v| v.as_str());
                if let (Some(sid), Some(f)) = (student_id, fecha) {
                    conn.execute("DELETE FROM asistencia WHERE estudiante_id = ? AND fecha = ?", rusqlite::params![sid, f])
                        .map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
            "DELETE FROM asistencia WHERE id = ?"
        },
        "nota" => {
            if let Some(obj) = id.as_object() {
                let est_id = obj.get("estudianteId").or_else(|| obj.get("estudiante_id")).and_then(|v| v.as_i64());
                let crit_id = obj.get("criterioId").or_else(|| obj.get("criterio_id")).and_then(|v| v.as_i64());
                let corte_id = obj.get("corteId").or_else(|| obj.get("corte_evaluativo_id")).and_then(|v| v.as_i64());
                let asig_id = obj.get("asignaturaId").or_else(|| obj.get("asignatura_id")).and_then(|v| v.as_i64());
                
                if let (Some(sid), Some(cid), Some(coid), Some(aid)) = (est_id, crit_id, corte_id, asig_id) {
                    conn.execute(
                        "DELETE FROM nota WHERE estudiante_id = ? AND criterio_id = ? AND corte_evaluativo_id = ? AND asignatura_id = ?",
                        rusqlite::params![sid, cid, coid, aid]
                    ).map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
            return Err("Nota requiere clave compuesta para eliminaciÃ³n".to_string());
        },
        "grado_asignatura" => "DELETE FROM grado_asignatura WHERE grado_id = ? AND asignatura_id = ?",
        "colegio_asignatura" => "DELETE FROM colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?",
        "colegio_dias_asistencia" => "DELETE FROM colegio_dias_asistencia WHERE colegio_id = ?",
        _ => "DELETE FROM {} WHERE id = ?",
    };

    let sql_final = if sql.contains("{}") {
        sql.replace("{}", &table)
    } else {
        sql.to_string()
    };

    if let Some(id_int) = id.as_i64() {
        conn.execute(&sql_final, [id_int]).map_err(|e| e.to_string())?;
    } else if let Some(id_str) = id.as_str() {
        conn.execute(&sql_final, [id_str]).map_err(|e| e.to_string())?;
    } else {
        // Para tablas con claves compuestas que no se manejaron arriba
        return Err(format!("ID no soportado para tabla {}", table));
    }

    Ok(())
}

#[tauri::command]
pub async fn get_colegio_dias_asistencia_all(

    state: tauri::State<'_, DbState>,
) -> Result<Vec<ColegioDiasAsistencia>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo FROM colegio_dias_asistencia")
        .map_err(|e| e.to_string())?;

    let configs = stmt
        .query_map([], |row| {
            Ok(ColegioDiasAsistencia {
                colegio_id: row.get(0)?,
                lunes: row.get(1)?,
                martes: row.get(2)?,
                miercoles: row.get(3)?,
                jueves: row.get(4)?,
                viernes: row.get(5)?,
                sabado: row.get(6)?,
                domingo: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(configs)
}

#[tauri::command]
pub async fn get_grado_asignatura(state: tauri::State<'_, DbState>) -> Result<Vec<GradoAsignaturaRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT grado_id, asignatura_id FROM grado_asignatura").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| {
        Ok(GradoAsignaturaRecord {
            grado_id: row.get(0)?,
            asignatura_id: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub async fn get_colegio_asignatura(state: tauri::State<'_, DbState>) -> Result<Vec<ColegioAsignaturaRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT colegio_id, asignatura_id FROM colegio_asignatura").map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| {
        Ok(ColegioAsignaturaRecord {
            colegio_id: row.get(0)?,
            asignatura_id: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(items)
}

#[derive(serde::Serialize)]
pub struct GradoAsignaturaRecord {
    pub grado_id: i64,
    pub asignatura_id: i64,
}

#[derive(serde::Serialize)]
pub struct ColegioAsignaturaRecord {
    pub colegio_id: i64,
    pub asignatura_id: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total_estudiantes: i64,
    pub total_notas: i64,
    pub total_asistencias: i64,
    pub total_grados: i64,
    pub total_colegios: i64,
    pub total_secciones: i64,
    pub total_asignaturas: i64,
    pub ano_activo: String,
    pub colegio_activo: String,
    pub estudiantes_hoy: i64,
    pub presentes_hoy: i64,
    pub ausentes_hoy: i64,
    pub justificados_hoy: i64,
    pub estudiantes_por_grado: Vec<GradoCount>,
    pub estudiantes_por_grado_seccion: Vec<GradoSeccionCount>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GradoCount {
    pub grado: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GradoSeccionCount {
    pub grado: String,
    pub seccion: String,
    pub colegio: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetalleItem {
    pub nombre: String,
    pub colegio: Option<String>,
    pub actualizado: String,
}

/// Detalle para las cards del dashboard: lista de colegios o de las instancias
/// reales (colegio, grado/sección) en uso, con su última modificación.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_dashboard_detalle(
    state: tauri::State<'_, DbState>,
    tipo: String,
    colegioId: Option<i64>,
) -> Result<Vec<DetalleItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    match tipo.as_str() {
        "colegio" => {
            let mut stmt = conn
                .prepare("SELECT nombre, COALESCE(updated_at, '') FROM colegio ORDER BY nombre")
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map([], |row| {
                    Ok(DetalleItem { nombre: row.get(0)?, colegio: None, actualizado: row.get(1)? })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(items)
        }
        "grado" | "seccion" => {
            let (tabla, col) = if tipo == "grado" { ("grado", "g") } else { ("seccion", "s") };
            let sql = format!(
                "SELECT DISTINCT c.nombre, {}.nombre, COALESCE({}.updated_at, '')
                 FROM estudiante e
                 JOIN {} {} ON e.{}_id = {}.id
                 JOIN colegio c ON e.colegio_id = c.id
                 WHERE (?1 IS NULL OR e.colegio_id = ?1)
                 ORDER BY c.nombre, {}.nombre",
                col, col, tabla, col, tabla, col, col
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let items = stmt
                .query_map(rusqlite::params![colegioId], |row| {
                    Ok(DetalleItem {
                        colegio: Some(row.get(0)?),
                        nombre: row.get(1)?,
                        actualizado: row.get(2)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(items)
        }
        "asignatura" => {
            // Catálogo global de asignaturas (sin desglose por colegio)
            let mut stmt = conn
                .prepare("SELECT nombre, COALESCE(updated_at, '') FROM asignatura ORDER BY nombre")
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map([], |row| {
                    Ok(DetalleItem { nombre: row.get(0)?, colegio: None, actualizado: row.get(1)? })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(items)
        }
        _ => Err(format!("Tipo desconocido: {}", tipo)),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GradoSeccionSinAsistencia {
    pub grado: String,
    pub seccion: String,
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_dashboard_stats(
    state: tauri::State<'_, DbState>,
    fechaHoy: String,
    colegioId: Option<i64>,
) -> Result<DashboardStats, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let total_estudiantes: i64 = if let Some(cid) = colegioId {
        conn.query_row("SELECT COUNT(*) FROM estudiante WHERE colegio_id = ?1", rusqlite::params![cid], |row| row.get(0)).map_err(|e| e.to_string())?
    } else {
        conn.query_row("SELECT COUNT(*) FROM estudiante", [], |row| row.get(0)).map_err(|e| e.to_string())?
    };

    let total_notas: i64 = if let Some(cid) = colegioId {
        conn.query_row("SELECT COUNT(n.estudiante_id) FROM nota n JOIN estudiante e ON n.estudiante_id = e.id WHERE e.colegio_id = ?1", rusqlite::params![cid], |row| row.get(0)).map_err(|e| e.to_string())?
    } else {
        conn.query_row("SELECT COUNT(*) FROM nota", [], |row| row.get(0)).map_err(|e| e.to_string())?
    };

    let total_asistencias: i64 = if let Some(cid) = colegioId {
        conn.query_row("SELECT COUNT(a.id) FROM asistencia a JOIN estudiante e ON a.estudiante_id = e.id WHERE e.colegio_id = ?1", rusqlite::params![cid], |row| row.get(0)).map_err(|e| e.to_string())?
    } else {
        conn.query_row("SELECT COUNT(*) FROM asistencia", [], |row| row.get(0)).map_err(|e| e.to_string())?
    };

    // Grados y secciones REALES: los catálogos grado/seccion son genéricos y
    // compartidos entre colegios, así que la unidad real es la COMBINACIÓN
    // (colegio, grado) / (colegio, sección) que existe entre los estudiantes.
    let total_grados: i64 = conn
        .query_row(
            "SELECT COALESCE(COUNT(*), 0) FROM (
               SELECT DISTINCT colegio_id, grado_id FROM estudiante
               WHERE grado_id IS NOT NULL AND (?1 IS NULL OR colegio_id = ?1)
             )",
            rusqlite::params![colegioId], |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total_colegios: i64 = conn
        .query_row("SELECT COUNT(*) FROM colegio", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let total_secciones: i64 = conn
        .query_row(
            "SELECT COALESCE(COUNT(*), 0) FROM (
               SELECT DISTINCT colegio_id, seccion_id FROM estudiante
               WHERE seccion_id IS NOT NULL AND (?1 IS NULL OR colegio_id = ?1)
             )",
            rusqlite::params![colegioId], |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Asignaturas: catálogo GLOBAL (a diferencia de grados/secciones, no se
    // cuentan por combinación con el colegio).
    let total_asignaturas: i64 = conn
        .query_row("SELECT COUNT(*) FROM asignatura", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let ano_activo: String = conn
        .query_row(
            "SELECT COALESCE(nombre, '') FROM ano_lectivo WHERE activo = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    let colegio_activo: String = if let Some(cid) = colegioId {
        conn.query_row("SELECT COALESCE(nombre, '') FROM colegio WHERE id = ?1", rusqlite::params![cid], |row| row.get(0)).unwrap_or_default()
    } else {
        conn.query_row("SELECT COALESCE(nombre, '') FROM colegio WHERE activo = 1 LIMIT 1", [], |row| row.get(0)).unwrap_or_default()
    };

    // Attendance counts for today
    let estudiantes_hoy: i64 = if let Some(cid) = colegioId {
        conn.query_row("SELECT COUNT(a.id) FROM asistencia a JOIN estudiante e ON a.estudiante_id = e.id WHERE a.fecha = ?1 AND e.colegio_id = ?2", rusqlite::params![&fechaHoy, cid], |row| row.get(0)).map_err(|e| e.to_string())?
    } else {
        conn.query_row("SELECT COUNT(*) FROM asistencia WHERE fecha = ?1", rusqlite::params![&fechaHoy], |row| row.get(0)).map_err(|e| e.to_string())?
    };

    let (presentes_hoy, ausentes_hoy, justificados_hoy): (i64, i64, i64) = if let Some(cid) = colegioId {
        conn.query_row("SELECT COALESCE(SUM(CASE WHEN a.estado = 'P' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN a.estado = 'A' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN a.estado = 'J' THEN 1 ELSE 0 END), 0) FROM asistencia a JOIN estudiante e ON a.estudiante_id = e.id WHERE a.fecha = ?1 AND e.colegio_id = ?2", rusqlite::params![&fechaHoy, cid], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|e| e.to_string())?
    } else {
        conn.query_row("SELECT COALESCE(SUM(CASE WHEN estado = 'P' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN estado = 'A' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN estado = 'J' THEN 1 ELSE 0 END), 0) FROM asistencia WHERE fecha = ?1", rusqlite::params![&fechaHoy], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|e| e.to_string())?
    };

    // Estudiantes por grado + sección (cada combo colegio+grado+sección con su
    // propia barra). Ordenado por colegio, grado y sección.
    let mut stmt_grado_seccion = conn
        .prepare(
            "SELECT g.nombre, s.nombre, c.nombre, COUNT(e.id)
             FROM estudiante e
             JOIN grado g ON e.grado_id = g.id
             JOIN seccion s ON e.seccion_id = s.id
             JOIN colegio c ON e.colegio_id = c.id
             WHERE (?1 IS NULL OR e.colegio_id = ?1)
             GROUP BY e.colegio_id, e.grado_id, e.seccion_id
             ORDER BY c.nombre, g.nombre, s.nombre",
        )
        .map_err(|e| e.to_string())?;

    let estudiantes_por_grado_seccion: Vec<GradoSeccionCount> = stmt_grado_seccion
        .query_map(rusqlite::params![colegioId], |row| {
            Ok(GradoSeccionCount {
                grado: row.get(0)?,
                seccion: row.get(1)?,
                colegio: row.get(2)?,
                count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Estudiantes por grado (resumen por grado, sumando todas las secciones) —
    // útil para retro-compatibilidad y para el total por grado.
    let estudiantes_por_grado: Vec<GradoCount> = {
        let mut map: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
        for gs in &estudiantes_por_grado_seccion {
            *map.entry(gs.grado.clone()).or_insert(0) += gs.count;
        }
        map.into_iter()
            .map(|(grado, count)| GradoCount { grado, count })
            .collect()
    };

    Ok(DashboardStats {
        total_estudiantes,
        total_notas,
        total_asistencias,
        total_grados,
        total_colegios,
        total_secciones,
        total_asignaturas,
        ano_activo,
        colegio_activo,
        estudiantes_hoy,
        presentes_hoy,
        ausentes_hoy,
        justificados_hoy,
        estudiantes_por_grado,
        estudiantes_por_grado_seccion,
    })
}


fn weekday_column(fecha: &str) -> Option<&'static str> {
    use chrono::{Datelike, NaiveDate};
    let date = NaiveDate::parse_from_str(fecha, "%Y-%m-%d").ok()?;
    let column = match date.weekday() {
        chrono::Weekday::Mon => "lunes",
        chrono::Weekday::Tue => "martes",
        chrono::Weekday::Wed => "miercoles",
        chrono::Weekday::Thu => "jueves",
        chrono::Weekday::Fri => "viernes",
        chrono::Weekday::Sat => "sabado",
        chrono::Weekday::Sun => "domingo",
    };
    Some(column)
}

/// Grados/secciones con estudiantes que aún no tienen asistencia en la fecha,
/// considerando solo colegios laborables ese día y los filtros opcionales
/// (lista vacía = todos). Es la ÚNICA implementación de esta consulta; la usan
/// tanto el comando Tauri como el receiver de alarma (vía JNI).
pub fn grados_secciones_sin_asistencia(
    conn: &Connection,
    colegios: &[i64],
    grados: &[i64],
    secciones: &[i64],
    fecha: &str,
) -> Result<Vec<GradoSeccionSinAsistencia>, String> {
    let Some(column) = weekday_column(fecha) else {
        return Ok(Vec::new());
    };

    // Colegios laborables el día de la fecha (los demás no se avisan).
    let colegios_laborables: Vec<i64> = if colegios.is_empty() {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT c.id FROM colegio c
                 LEFT JOIN colegio_dias_asistencia d ON d.colegio_id = c.id
                 WHERE COALESCE(d.{}, 1) = 1",
                column
            ))
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        ids
    } else {
        let mut laborables = Vec::new();
        for &cid in colegios {
            let laborable: i64 = conn
                .query_row(
                    &format!("SELECT COALESCE({}, 1) FROM colegio_dias_asistencia WHERE colegio_id = ?1", column),
                    rusqlite::params![cid],
                    |row| row.get(0),
                )
                .unwrap_or(1);
            if laborable != 0 {
                laborables.push(cid);
            }
        }
        laborables
    };

    if colegios_laborables.is_empty() {
        return Ok(Vec::new());
    }

    let mut where_parts = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    let placeholders_colegios: Vec<String> = (0..colegios_laborables.len()).map(|_| "?".to_string()).collect();
    where_parts.push(format!("e.colegio_id IN ({})", placeholders_colegios.join(",")));
    params.extend(colegios_laborables.iter().map(|v| rusqlite::types::Value::Integer(*v)));

    if !grados.is_empty() {
        let ph: Vec<String> = (0..grados.len()).map(|_| "?".to_string()).collect();
        where_parts.push(format!("e.grado_id IN ({})", ph.join(",")));
        params.extend(grados.iter().map(|v| rusqlite::types::Value::Integer(*v)));
    }
    if !secciones.is_empty() {
        let ph: Vec<String> = (0..secciones.len()).map(|_| "?".to_string()).collect();
        where_parts.push(format!("e.seccion_id IN ({})", ph.join(",")));
        params.extend(secciones.iter().map(|v| rusqlite::types::Value::Integer(*v)));
    }

    where_parts.push("e.ano_lectivo_id = (SELECT id FROM ano_lectivo WHERE activo = 1)".to_string());

    let sql = format!(
        "SELECT g.nombre, s.nombre
         FROM estudiante e
         INNER JOIN grado g ON g.id = e.grado_id
         INNER JOIN seccion s ON s.id = e.seccion_id
         WHERE {}
         GROUP BY e.grado_id, e.seccion_id
         HAVING SUM(CASE WHEN EXISTS (
             SELECT 1 FROM asistencia a WHERE a.estudiante_id = e.id AND a.fecha = ?
         ) THEN 1 ELSE 0 END) < COUNT(*)
         ORDER BY g.nombre, s.nombre
         ORDER BY g.nombre, s.nombre",
        where_parts.join(" AND ")
    );

    let mut params_ref: Vec<&dyn rusqlite::ToSql> = Vec::new();
    for p in &params {
        params_ref.push(p);
    }
    params_ref.push(&fecha);

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params_from_iter(params_ref.iter().copied()), |row| {
            Ok(GradoSeccionSinAsistencia {
                grado: row.get(0)?,
                seccion: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub async fn get_grados_secciones_sin_asistencia_hoy(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    fecha: String,
) -> Result<Vec<GradoSeccionSinAsistencia>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    grados_secciones_sin_asistencia(&conn, &[colegioId], &[], &[], &fecha)
}

/// Versión con filtros múltiples (cole_gios/grados/secciones vacíos = todos).
/// La usa el check al abrir de la app y comparte la misma implementación que el JNI.
#[tauri::command]
pub async fn get_pendientes_asistencia_filtrados(
    state: tauri::State<'_, DbState>,
    colegios: Vec<i64>,
    grados: Vec<i64>,
    secciones: Vec<i64>,
    fecha: String,
) -> Result<Vec<GradoSeccionSinAsistencia>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    grados_secciones_sin_asistencia(&conn, &colegios, &grados, &secciones, &fecha)
}


// ============================================================================
// Estructuras para el wizard de inicializaciÃ³n
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedOptionItem {
    pub nombre: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedOptionCualitativo {
    pub nombre: String,
    pub cualitativo: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedOptionConOrden {
    pub nombre: String,
    pub orden: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedOptions {
    pub anos: Vec<SeedOptionItem>,
    pub colegios: Vec<SeedOptionConOrden>,
    pub grados: Vec<SeedOptionCualitativo>,
    pub secciones: Vec<SeedOptionItem>,
    pub asignaturas: Vec<SeedOptionCualitativo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedItem {
    pub nombre: String,
    pub cualitativo: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColegioDias {
    pub lunes: bool,
    pub martes: bool,
    pub miercoles: bool,
    pub jueves: bool,
    pub viernes: bool,
    pub sabado: bool,
    pub domingo: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColegioSeed {
    pub nombre: String,
    #[serde(default = "default_tipo")]
    pub tipo: String,
    pub dias: ColegioDias,
    pub asignaturas: Vec<String>,
}

fn default_tipo() -> String { "Primaria".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedSelections {
    pub anos: Vec<String>,
    pub colegios: Vec<ColegioSeed>,
    pub grados: Vec<SeedItem>,
    pub secciones: Vec<String>,
    pub asignaturas: Vec<SeedItem>,
}

#[tauri::command]
pub async fn get_seed_options() -> Result<SeedOptions, String> {
    Ok(SeedOptions {
        anos: vec![
            SeedOptionItem { nombre: "2026".into() },
            SeedOptionItem { nombre: "2027".into() },
            SeedOptionItem { nombre: "2028".into() },
        ],
        colegios: vec![
            SeedOptionConOrden { nombre: "Candelario Sotelo".into(), orden: 1 },
            SeedOptionConOrden { nombre: "Manuel Ignacio Pereira Quintana".into(), orden: 2 },
        ],
        grados: vec![
            SeedOptionCualitativo { nombre: "1er grado".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "2do grado".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "3er grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "4to grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "5to grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "6to grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "7mo grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "8vo grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "9no grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "10mo grado".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "11mo grado".into(), cualitativo: false },
        ],
        secciones: vec![
            SeedOptionItem { nombre: "A".into() },
            SeedOptionItem { nombre: "B".into() },
            SeedOptionItem { nombre: "C".into() },
            SeedOptionItem { nombre: "D".into() },
        ],
        asignaturas: vec![
            SeedOptionCualitativo { nombre: "Ingles".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "Matematicas".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "Fisica".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "Biologia".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "Ciencias Naturales".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "Ciencias Sociales".into(), cualitativo: false },
            SeedOptionCualitativo { nombre: "TAC".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "AEP".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "Convivencia & Civismo".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "Creciendo en Valores".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "Derecho & Dignidad de la Mujer".into(), cualitativo: true },
            SeedOptionCualitativo { nombre: "EducaciÃ³n FÃ­sica".into(), cualitativo: true },
        ],
    })
}

#[tauri::command]
pub async fn seed_selected_data(state: tauri::State<'_, DbState>, selections: SeedSelections) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;

    // 1. AÃ±os lectivos seleccionados
    for nombre in &selections.anos {
        conn.execute(
            "INSERT OR IGNORE INTO ano_lectivo (nombre) VALUES (?)",
            [nombre],
        ).map_err(|e| e.to_string())?;
    }

    // 2. Cortes evaluativos (siempre todos)
    for nombre in &["1er corte evaluativo", "2do corte evaluativo", "3er corte evaluativo", "4to corte evaluativo"] {
        conn.execute(
            "INSERT OR IGNORE INTO corte_evaluativo (nombre) VALUES (?)",
            [nombre],
        ).map_err(|e| e.to_string())?;
    }

    // 3. Colegios seleccionados (orden = orden de captura, para respetar el
    // orden en que el usuario los introdujo en el asistente manual)
    for (idx, c) in selections.colegios.iter().enumerate() {
        let orden = (idx + 1) as i64;
        let tipo = if c.tipo == "Secundaria" { "Secundaria" } else { "Primaria" };
        conn.execute(
            "INSERT OR IGNORE INTO colegio (nombre, tipo, orden) VALUES (?, ?, ?)",
            rusqlite::params![c.nombre, tipo, orden],
        ).map_err(|e| e.to_string())?;
    }

    // 3b. (movido más abajo, después de insertar los grados: ver paso 5b-bis)

    // 4. Asignaturas seleccionadas (cualitativo definido por el usuario)
    for a in &selections.asignaturas {
        conn.execute(
            "INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES (?, ?)",
            rusqlite::params![a.nombre, if a.cualitativo { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    // 5. Grados seleccionados (cualitativo definido por el usuario)
    for g in &selections.grados {
        conn.execute(
            "INSERT OR IGNORE INTO grado (nombre, cualitativo) VALUES (?, ?)",
            rusqlite::params![g.nombre, if g.cualitativo { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    // 5b-bis. Grados por colegio según su tipo (Primaria → 1-6, Secundaria → 7-11).
    //
    // DEBE ir DESPUÉS del paso 5: `seed_colegio_grados` inserta una fila por
    // cada grado que ya exista en la tabla `grado` y que corresponda al tipo
    // del colegio. Con este bloque antes de los grados, la tabla estaba vacía y
    // la relación quedaba con 0 filas: el colegio no ofrecía ningún grado y el
    // usuario no podía matricular estudiantes.
    for c in &selections.colegios {
        let tipo = if c.tipo == "Secundaria" { "Secundaria" } else { "Primaria" };
        let colegio_id: Option<i64> = conn
            .query_row("SELECT id FROM colegio WHERE nombre = ?", [&c.nombre], |row| row.get(0))
            .ok();
        if let Some(cid) = colegio_id {
            seed_colegio_grados(&conn, cid, tipo)?;
        }
    }

    // 5b. Días de clase y asignaturas por colegio (selección manual del usuario)
    for c in &selections.colegios {
        conn.execute(
            "INSERT OR IGNORE INTO colegio_dias_asistencia (colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo)
             VALUES ((SELECT id FROM colegio WHERE nombre = ?1), ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                c.nombre,
                if c.dias.lunes { 1 } else { 0 },
                if c.dias.martes { 1 } else { 0 },
                if c.dias.miercoles { 1 } else { 0 },
                if c.dias.jueves { 1 } else { 0 },
                if c.dias.viernes { 1 } else { 0 },
                if c.dias.sabado { 1 } else { 0 },
                if c.dias.domingo { 1 } else { 0 },
            ],
        ).map_err(|e| e.to_string())?;
        for a_nombre in &c.asignaturas {
            conn.execute(
                "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id)
                 SELECT co.id, a.id FROM colegio co, asignatura a
                 WHERE co.nombre = ?1 AND a.nombre = ?2",
                rusqlite::params![c.nombre, a_nombre],
            ).map_err(|e| e.to_string())?;
        }
    }

    // 6. Secciones seleccionadas
    for nombre in &selections.secciones {
        conn.execute(
            "INSERT OR IGNORE INTO seccion (nombre) VALUES (?)",
            [nombre],
        ).map_err(|e| e.to_string())?;
    }

    // 7. Producto cartesiano grado Ã— asignatura (solo para grados y asignaturas seleccionados)
    if !selections.grados.is_empty() && !selections.asignaturas.is_empty() {
        let placeholders_g = selections.grados.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let placeholders_a = selections.asignaturas.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id)
             SELECT g.id, a.id FROM grado g
             CROSS JOIN asignatura a
             WHERE g.nombre IN ({}) AND a.nombre IN ({})",
            placeholders_g, placeholders_a
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for g in &selections.grados { params.push(Box::new(g.nombre.clone())); }
        for a in &selections.asignaturas { params.push(Box::new(a.nombre.clone())); }
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice()).map_err(|e| e.to_string())?;
    }

    // 9. ConfiguraciÃ³n de calificaciones (siempre)
    let configs = vec![
        ("AA", "Aprendizaje Avanzado", "#22c55e", 90),
        ("AS", "Aprendizaje Satisfactorio", "#3b82f6", 70),
        ("AF", "Aprendizaje Fundamental", "#eab308", 50),
        ("AI", "Aprendizaje Inicial", "#ef4444", 0),
    ];
    for (id, nombre, color, minimo) in configs {
        conn.execute(
            "INSERT OR IGNORE INTO configuracion_calificacion (id, nombre, color, minimo) VALUES (?, ?, ?, ?)",
            rusqlite::params![id, nombre, color, minimo],
        ).map_err(|e| e.to_string())?;
    }

    // 10. Multiplicadores de criterios (siempre)
    let multiplicadores = vec![
        ("AA", 1.0),
        ("AS", 0.85),
        ("AF", 0.65),
        ("AI", 0.40),
    ];
    for (id, mult) in multiplicadores {
        conn.execute(
            "INSERT OR IGNORE INTO multiplicador_calificacion (id, multiplicador) VALUES (?, ?)",
            rusqlite::params![id, mult],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute("PRAGMA foreign_keys = ON", []).map_err(|e| e.to_string())?;

    println!("âœ… [DB] Datos seleccionados insertados correctamente");
    Ok(())
}

#[tauri::command]
pub async fn is_app_initialized(state: tauri::State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Verificar flag en app_meta
    let flag: Result<String, _> = conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'initialized'",
        [],
        |row| row.get(0),
    );
    if let Ok(v) = flag {
        if v == "true" {
            return Ok(true);
        }
    }
    // Fallback: verificar si hay datos reales en tablas principales
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ano_lectivo",
        [],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if count > 0 {
        // Auto-marcar como inicializado
        conn.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('initialized', 'true')",
            [],
        ).ok();
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
pub async fn set_app_initialized(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('initialized', 'true')",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Lee todas las configuraciones de la app (key-value JSON).
#[tauri::command]
pub async fn get_app_settings(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result: Result<String, _> = conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'main'",
        [],
        |row| row.get(0),
    );
    match result {
        Ok(v) => Ok(v),
        Err(_) => Ok("{}".to_string()),
    }
}

/// Guarda configuraciones de la app (upsert del JSON completo).
#[tauri::command]
pub async fn set_app_settings(state: tauri::State<'_, DbState>, settings_json: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('main', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')",
        rusqlite::params![settings_json],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Migra configuraciones de localStorage a la tabla app_settings (una sola vez).
/// Devuelve el JSON migrado para que el frontend actualice su estado.
#[tauri::command]
pub async fn migrate_settings_from_localstorage(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Si ya hay datos, no migrar
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM app_settings WHERE key = 'main'",
        [],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if count > 0 {
        let existing: String = conn.query_row(
            "SELECT value FROM app_settings WHERE key = 'main'",
            [],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        return Ok(existing);
    }
    // Tabla vacía: devolver JSON vacío para que el frontend migre desde localStorage
    Ok("{}".to_string())
}

#[tauri::command]
pub async fn factory_reset(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let tables = [
        "asistencia", "nota", "criterio", "indicador",
        "grado_asignatura", "colegio_asignatura", "colegio_grado", "estudiante",
        "seccion", "grado", "asignatura", "colegio_dias_asistencia", "dia_sin_clases",
        "colegio", "corte_evaluativo", "ano_lectivo",
        "configuracion_calificacion",
        "multiplicador_calificacion",
        "sync_pending_deletions", "sync_pending_deletions_asistencia",
        "sync_pending_deletions_nota", "sync_pending_deletions_grado_asignatura",
        "sync_pending_deletions_colegio_asignatura",
        "sync_pending_deletions_colegio_grado",
    ];

    conn.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;

    for table in tables.iter() {
        conn.execute(&format!("DROP TABLE IF EXISTS {}", table), []).map_err(|e| e.to_string())?;
    }

    // Recrear tablas vacÃ­as
    drop(conn);
    let conn2 = state.conn.lock().map_err(|e| e.to_string())?;
    init_database(&conn2)?;

    // Limpiar flag de inicializaciÃ³n
    conn2.execute("DELETE FROM app_meta WHERE key = 'initialized'", []).map_err(|e| e.to_string())?;

    conn2.execute("PRAGMA foreign_keys = ON", []).map_err(|e| e.to_string())?;

    println!("âœ… [DB] Factory reset completado");
    Ok(())
}

fn get_grade_number(conn: &Connection, grado_id: i64) -> Result<Option<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT nombre FROM grado WHERE id = ?")
        .map_err(|e| e.to_string())?;
    let name: Option<String> = stmt.query_row([grado_id], |row| row.get(0)).ok();
    drop(stmt);
    match name {
        Some(n) => {
            let stripped = n.replace(" grado", "").replace("Grado", "");
            let clean: String = stripped.chars().take_while(|c| c.is_ascii_digit()).collect();
            Ok(clean.parse::<i64>().ok())
        }
        None => Ok(None),
    }
}

fn get_colegio_tipo(conn: &Connection, colegio_id: i64) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT tipo FROM colegio WHERE id = ?")
        .map_err(|e| e.to_string())?;
    let tipo: Option<String> = stmt.query_row([colegio_id], |row| row.get(0)).ok();
    drop(stmt);
    Ok(tipo.unwrap_or_else(|| "Primaria".to_string()))
}

fn get_grade_order_map(conn: &Connection) -> Result<HashMap<i64, i64>, String> {
    let mut stmt = conn
        .prepare("SELECT id, nombre FROM grado ORDER BY nombre")
        .map_err(|e| e.to_string())?;
    let grades: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut numbered: Vec<(i64, i64)> = Vec::new();
    for (id, name) in grades {
        let stripped = name.replace(" grado", "").replace("Grado", "");
        let clean: String = stripped.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = clean.parse::<i64>() {
            numbered.push((id, n));
        }
    }
    numbered.sort_by_key(|(_, n)| *n);

    let mut map = HashMap::new();
    for i in 0..numbered.len().saturating_sub(1) {
        map.insert(numbered[i].0, numbered[i + 1].0);
    }
    Ok(map)
}

#[tauri::command]
pub async fn promote_students(
    state: tauri::State<'_, DbState>,
    from_ano_id: i64,
    to_ano_id: i64,
    colegio_destino_map: Option<HashMap<i64, i64>>,
) -> Result<PromoteResult, String> {
    if from_ano_id == to_ano_id {
        return Err("Los años deben ser diferentes".to_string());
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let grade_map = get_grade_order_map(&conn)?;

    if grade_map.is_empty() {
        return Err("No hay grados definidos".to_string());
    }

    // Buscar colegios Secundaria disponibles
    let mut stmt_sec = conn
        .prepare("SELECT id, nombre, tipo FROM colegio WHERE tipo = 'Secundaria'")
        .map_err(|e| e.to_string())?;
    let secundaria_colegios: Vec<(i64, String, String)> = stmt_sec
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt_sec);

    // Buscar grado 7mo (destino para estudiantes de6to que migran a Secundaria)
    let grado_7mo_id: Option<i64> = {
        let mut stmt_g = conn
            .prepare("SELECT id FROM grado WHERE nombre LIKE '7mo%' OR nombre LIKE '7°%' LIMIT 1")
            .map_err(|e| e.to_string())?;
        let result = stmt_g.query_row([], |row| row.get(0)).ok();
        drop(stmt_g);
        result
    };

    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.nombre, e.codigo, e.sexo, e.grado_id, e.seccion_id, e.colegio_id, e.foto, g.nombre as grado_nombre
             FROM estudiante e
             JOIN grado g ON e.grado_id = g.id
             WHERE e.ano_lectivo_id = ?",
        )
        .map_err(|e| e.to_string())?;

    let students: Vec<(
        i64, String, String, String, i64, i64, i64, Option<String>, String,
    )> = stmt
        .query_map([from_ano_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get(8)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    drop(stmt);

    let mut promoted = 0i64;
    let mut graduated = 0i64;
    let mut pending_sixth_graders: Vec<PendingSixthGrader> = Vec::new();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for student in &students {
        let (id, nombre, codigo, sexo, grado_id, seccion_id, colegio_id, foto, _grado_nombre) =
            student;

        let grado_num = get_grade_number(&tx, *grado_id)?.unwrap_or(0);
        let colegio_tipo = get_colegio_tipo(&tx, *colegio_id)?;

        // Caso especial:6to grado en colegio Primaria → migrar a Secundaria
        if grado_num == 6 && colegio_tipo == "Primaria" {
            if secundaria_colegios.is_empty() {
                // No hay colegio Secundaria → se queda en el año origen (no se promueve)
                graduated += 1;
                continue;
            }

            // Determinar colegio destino
            let destino_colegio_id = if let Some(ref map) = colegio_destino_map {
                map.get(colegio_id).copied()
            } else if secundaria_colegios.len() == 1 {
                // Solo 1 colegio Secundaria → migrar automáticamente
                Some(secundaria_colegios[0].0)
            } else {
                // Múltiples colegios Secundaria → devolver pendientes para que el frontend pida selección
                let origen_nombre: String = {
                    let mut stmt_cn = tx
                        .prepare("SELECT nombre FROM colegio WHERE id = ?")
                        .map_err(|e| e.to_string())?;
                    let n = stmt_cn.query_row([*colegio_id], |row| row.get(0)).unwrap_or_default();
                    drop(stmt_cn);
                    n
                };
                pending_sixth_graders.push(PendingSixthGrader {
                    estudiante_id: *id,
                    nombre: nombre.clone(),
                    colegio_origen_id: *colegio_id,
                    colegio_origen_nombre: origen_nombre,
                });
                continue;
            };

            let destino_id = match destino_colegio_id {
                Some(id) => id,
                None => {
                    graduated += 1;
                    continue;
                }
            };

            let next_grade_id = match grado_7mo_id {
                Some(id) => id,
                None => {
                    // No existe grado7mo, buscar el siguiente en el map
                    match grade_map.get(grado_id) {
                        Some(&id) => id,
                        None => {
                            graduated += 1;
                            continue;
                        }
                    }
                }
            };

            let new_id = tx
                .execute(
                    "INSERT INTO estudiante (nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, foto, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                    rusqlite::params![nombre, codigo, sexo, to_ano_id, next_grade_id, seccion_id, destino_id, foto],
                )
                .map_err(|e| e.to_string())?;

            promoted += 1;

            tx.execute(
                "INSERT INTO nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id, valor, updated_at) SELECT ?, criterio_id, corte_evaluativo_id, asignatura_id, valor, datetime('now') FROM nota WHERE estudiante_id = ?",
                rusqlite::params![new_id, id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO asistencia (estudiante_id, fecha, estado, observacion, updated_at) SELECT ?, fecha, estado, observacion, datetime('now') FROM asistencia WHERE estudiante_id = ?",
                rusqlite::params![new_id, id],
            )
            .map_err(|e| e.to_string())?;

            continue;
        }

        // Caso normal: siguiente grado en el mismo colegio
        if let Some(&next_grade_id) = grade_map.get(grado_id) {
            let new_id = tx
                .execute(
                    "INSERT INTO estudiante (nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, foto, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                    rusqlite::params![nombre, codigo, sexo, to_ano_id, next_grade_id, seccion_id, colegio_id, foto],
                )
                .map_err(|e| e.to_string())?;

            promoted += 1;

            tx.execute(
                "INSERT INTO nota (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id, valor, updated_at) SELECT ?, criterio_id, corte_evaluativo_id, asignatura_id, valor, datetime('now') FROM nota WHERE estudiante_id = ?",
                rusqlite::params![new_id, id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO asistencia (estudiante_id, fecha, estado, observacion, updated_at) SELECT ?, fecha, estado, observacion, datetime('now') FROM asistencia WHERE estudiante_id = ?",
                rusqlite::params![new_id, id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            graduated += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(PromoteResult { promoted, graduated, pending_sixth_graders })
}

#[tauri::command]
pub async fn get_secundaria_colegios(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<ColegioInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, nombre, tipo FROM colegio WHERE tipo = 'Secundaria' ORDER BY nombre")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ColegioInfo {
                id: row.get(0)?,
                nombre: row.get(1)?,
                tipo: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
