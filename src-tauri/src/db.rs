use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
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
    pub telefono: Option<String>,
    pub direccion: Option<String>,
    pub email: Option<String>,
    pub foto: Option<String>,
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
    pub orden: i64,
    pub descripcion: String,
    pub activo: bool,
    pub criterios: Vec<Criterio>,
}

pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

/// Inicializa la base de datos creando todas las tablas necesarias.
/// Esta función es idempotente: usa CREATE TABLE IF NOT EXISTS.
pub fn init_database(conn: &Connection) -> Result<(), String> {
    println!("🔄 [DB] Inicializando base de datos...");
    
    // Tablas de categorías
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
        "#,
    )
    .map_err(|e| format!("Error creando tablas de categorías: {}", e))?;

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
            telefono TEXT,
            direccion TEXT,
            email TEXT,
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
            orden INTEGER NOT NULL,
            descripcion TEXT DEFAULT '',
            activo INTEGER DEFAULT 1,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(grado_id) REFERENCES grado(id),
            FOREIGN KEY(asignatura_id) REFERENCES asignatura(id),
            FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id)
        );

        CREATE TABLE IF NOT EXISTS criterio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            indicador_id INTEGER NOT NULL,
            orden INTEGER NOT NULL,
            descripcion TEXT DEFAULT '',
            puntaje_maximo INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(indicador_id) REFERENCES indicador(id) ON DELETE CASCADE
        );
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
            sabado INTEGER DEFAULT 1,
            domingo INTEGER DEFAULT 1,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE
        );
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

    // Tabla de configuración de calificaciones
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

    // Tablas de sincronización
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
        "#,
    )
    .map_err(|e| format!("Error creando tablas de sincronización: {}", e))?;

    // Migraciones para bases de datos existentes (agregar columnas faltantes)
    // NOTA: Los datos iniciales NO se siembran aquí. Se siembran bajo demanda
    // desde el frontend después de verificar si Turso tiene datos existentes.
    // Esto evita crear datos por defecto cuando ya hay datos en la nube.
    migrate_add_columns(conn)?;
    deduplicate_criteria(conn)?;

    println!("✅ [DB] Base de datos inicializada correctamente");
    Ok(())
}

/// Agrega columnas faltantes a tablas existentes (para migraciones de bases de datos antiguas)
fn migrate_add_columns(conn: &Connection) -> Result<(), String> {
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

    // Sembrar multiplicadores por defecto si la tabla está vacía
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
        println!("✅ [DB] Multiplicadores de criterios sembrados (migración)");
    }

    // Migración: agregar columna updated_at a todas las tablas que sincronizan
    let tables_updated_at = [
        "ano_lectivo", "corte_evaluativo", "colegio", "asignatura", "grado", "seccion",
        "estudiante", "indicador", "criterio", "asistencia", "colegio_dias_asistencia",
        "nota", "configuracion_calificacion", "multiplicador_calificacion",
        "grado_asignatura", "colegio_asignatura",
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
            // SQLite no permite DEFAULT con expresión en ALTER TABLE,
            // así que agregamos sin default (nuevos registros usan DEFAULT de CREATE TABLE)
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT"),
                [],
            )
            .map_err(|e| format!("Error agregando updated_at a {table}: {e}"))?;
            // Backfill de una sola vez: las filas existentes quedan con NULL y el
            // chequeo de cambios locales (`has_local_changes`) no las detectaría.
            conn.execute(
                &format!("UPDATE {table} SET updated_at = datetime('now') WHERE updated_at IS NULL"),
                [],
            )
            .map_err(|e| format!("Error actualizando updated_at en {table}: {e}"))?;
            println!("✅ [DB] Columna updated_at agregada a {table}");
        }
    }

    Ok(())
}

/// Elimina criterios duplicados (mantiene solo los primeros 3 por indicador)
fn deduplicate_criteria(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id FROM indicador WHERE (SELECT COUNT(*) FROM criterio WHERE indicador_id = indicador.id) > 3")
        .map_err(|e| format!("Error buscando indicadores con criterios duplicados: {}", e))?;

    let indicador_ids: Vec<i64> = stmt
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for id in &indicador_ids {
        // Mantener solo los 3 criterios con orden más bajo
        conn.execute(
            "DELETE FROM criterio WHERE indicador_id = ? AND id NOT IN (SELECT id FROM criterio WHERE indicador_id = ? ORDER BY orden LIMIT 3)",
            rusqlite::params![id, id],
        )
        .map_err(|e| format!("Error eliminando criterios duplicados para indicador {}: {}", id, e))?;
    }

    if !indicador_ids.is_empty() {
        println!("🧹 [DB] Eliminados criterios duplicados para {} indicador(es)", indicador_ids.len());
    }

    Ok(())
}

/// Inserta datos iniciales si las tablas están vacías
pub fn seed_default_data(conn: &Connection) -> Result<(), String> {
    // Verificar si ya hay datos (localmente o de sincronización previa)
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ano_lectivo", [], |row| row.get(0))
        .unwrap_or(0);

    if count > 0 {
        println!("📊 [DB] Datos encontrados en base de datos local, omitiendo sembrado de datos por defecto");
        return Ok(());
    }

    println!("🌱 [DB] Base de datos vacía, sembrando datos iniciales...");

    // Años lectivos
    conn.execute(
        "INSERT INTO ano_lectivo (nombre) VALUES ('2026')",
        [],
    ).ok();
    conn.execute(
        "INSERT INTO ano_lectivo (nombre) VALUES ('2027')",
        [],
    ).ok();
    conn.execute(
        "INSERT INTO ano_lectivo (nombre) VALUES ('2028')",
        [],
    ).ok();

    // Cortes evaluativos
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

    // Colegios
    conn.execute(
        "INSERT INTO colegio (nombre, orden) VALUES ('Candelario Sotelo', 1)",
        [],
    ).ok();
    conn.execute(
        "INSERT INTO colegio (nombre, orden) VALUES ('Manuel Ignacio Pereira Quintana', 2)",
        [],
    ).ok();

    // Asignaturas
    let asignaturas = vec![
        ("Ingles", 0),
        ("Matematicas", 0),
        ("Fisica", 0),
        ("Biologia", 0),
        ("Ciencias Naturales", 0),
        ("Ciencias Sociales", 0),
        ("TAC", 1),
        ("AEP", 1),
        ("Convivencia & Civismo", 1),
        ("Creciendo en Valores", 1),
        ("Derecho & Dignidad de la Mujer", 1),
        ("Educación Física", 1),
    ];

    for (nombre, cualitativo) in asignaturas {
        conn.execute(
            "INSERT INTO asignatura (nombre, cualitativo) VALUES (?, ?)",
            rusqlite::params![nombre, cualitativo],
        ).ok();
    }

    // Grados - 1er y 2do grado son cualitativos por defecto
    let grados_cualitativos = vec!["1er grado", "2do grado"];
    let grados_default = vec![
        "1er grado", "2do grado", "3er grado", "4to grado", "5to grado",
        "6to grado", "7mo grado", "8vo grado", "9no grado", "10mo grado", "11mo grado",
    ];

    for nombre in grados_default {
        let cualitativo = if grados_cualitativos.contains(&nombre) { 1 } else { 0 };
        conn.execute(
            "INSERT INTO grado (nombre, cualitativo) VALUES (?, ?)",
            rusqlite::params![nombre, cualitativo],
        )
        .ok();
    }

    // Secciones
    for nombre in ["A", "B", "C", "D"] {
        conn.execute("INSERT INTO seccion (nombre) VALUES (?)", [nombre])
            .ok();
    }

    // Asignar todas las asignaturas a todos los grados
    conn.execute(
        "INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id)
         SELECT g.id, a.id FROM grado g CROSS JOIN asignatura a",
        [],
    )
    .ok();

    // Asignar todas las asignaturas a todos los colegios
    conn.execute(
        "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id)
         SELECT c.id, a.id FROM colegio c CROSS JOIN asignatura a",
        [],
    )
    .ok();

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
        println!("✅ [DB] Migración de calificaciones completada");
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
            println!("✅ [DB] Datos iniciales de calificaciones sembrados");
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

    println!("✅ [DB] Datos iniciales sembrados correctamente");
    Ok(())
}

/// Alias para compatibilidad hacia atrás
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
// Estructuras para sincronización de eliminaciones (claves compuestas)
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

    // Lista de tablas a vaciar en orden para respetar llaves foráneas
    let tables = [
        "asistencia",
        "nota",
        "criterio",
        "indicador",
        "grado_asignatura",
        "colegio_asignatura",
        "estudiante",
        "seccion",
        "grado",
        "asignatura",
        "colegio_dias_asistencia",
        "colegio",
        "corte_evaluativo",
        "ano_lectivo",
        "configuracion_calificacion",
    ];

    // Desactivar temporalmente las llaves foráneas para un borrado limpio
    conn_guard
        .execute("PRAGMA foreign_keys = OFF", [])
        .map_err(|e| e.to_string())?;

    for table in tables.iter() {
        // Borrar tabla (si existe) para un reset completo
        match conn_guard.execute(&format!("DROP TABLE IF EXISTS {}", table), []) {
            Ok(_) => {}
            Err(e) => {
                let err_msg = e.to_string();
                let _ = conn_guard.execute("PRAGMA foreign_keys = ON", []);
                return Err(format!("Error al eliminar tabla {}: {}", table, err_msg));
            }
        }
    }

    // Limpieza adicional: Si existía el colegio con el typo, borrarlo explícitamente por si acaso
    // (Útil para limpiar bases de datos existentes sin reset completo de tablas si se desea,
    // pero aquí estamos dentro del reset así que las tablas ya están vacías).

    conn_guard
        .execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| e.to_string())?;

    // Después de limpiar, volvemos a ejecutar las migraciones para asegurar
    // que las tablas se vuelvan a crear
    run_migrations(&conn_guard)?;

    // Sembrar datos iniciales (reset siempre crea defaults)
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

    // Registrar la eliminación de la entidad principal
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
        .prepare("SELECT id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, telefono, direccion, email, foto FROM estudiante")
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
                telefono: row.get(8)?,
                direccion: row.get(9)?,
                email: row.get(10)?,
                foto: row.get(11)?,
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
        "INSERT INTO estudiante (nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, telefono, direccion, email, foto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            student.nombre,
            student.codigo,
            student.sexo,
            student.ano_lectivo_id,
            student.grado_id,
            student.seccion_id,
            student.colegio_id,
            student.telefono,
            student.direccion,
            student.email,
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
        "UPDATE estudiante SET nombre = ?, codigo = ?, sexo = ?, ano_lectivo_id = ?, grado_id = ?, seccion_id = ?, colegio_id = ?, telefono = ?, direccion = ?, email = ?, foto = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![
            student.nombre,
            student.codigo,
            student.sexo,
            student.ano_lectivo_id,
            student.grado_id,
            student.seccion_id,
            student.colegio_id,
            student.telefono,
            student.direccion,
            student.email,
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

    // Mapear el día de la semana a la columna de la base de datos
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

    // Buscar colegios habilitados para hoy, ordenados alfabéticamente
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

    // 1. Eliminar el estudiante
    tx.execute("DELETE FROM estudiante WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;

    // 2. Registrar la eliminación pendiente para sincronización
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
    
    // Usar LEFT JOIN para obtener todas las asignaturas, incluso si no hay relación en grado_asignatura
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
    // Limpiar pending deletion previa para evitar que upsert_pull_data borre el registro recién asignado
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

    // Solo registrar si la relación existe
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM grado_asignatura WHERE grado_id = ? AND asignatura_id = ?)",
        [gradoId, asignaturaId],
        |row| row.get(0),
    ).unwrap_or(false);

    if exists {
        // Registrar eliminación pendiente
        conn.execute(
            "INSERT INTO sync_pending_deletions_grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
            [gradoId, asignaturaId],
        ).map_err(|e| e.to_string())?;

        // Eliminar la relación
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
    // Limpiar pending deletion previa para evitar que upsert_pull_data borre el recién asignado
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

    // Solo registrar si la relación existe
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?)",
        [colegioId, asignaturaId],
        |row| row.get(0),
    ).unwrap_or(false);

    if exists {
        // Registrar eliminación pendiente
        conn.execute(
            "INSERT INTO sync_pending_deletions_colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
            [colegioId, asignaturaId],
        ).map_err(|e| e.to_string())?;

        // Eliminar la relación
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
        "INSERT INTO colegio (nombre, activo, cualitativo, orden) VALUES (?, 0, 0, ?)",
        rusqlite::params![nombre, max_order + 1],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn update_colegio(
    state: tauri::State<'_, DbState>,
    id: i64,
    nombre: String,
    cualitativo: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE colegio SET nombre = ?, cualitativo = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
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
) -> Result<Vec<Indicador>, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        // Check if config exists
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM indicador WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ?",
                [gradoId, asignaturaId, corteEvaluativoId],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if count == 0 {
            // Seed 8 indicators
            for i in 1..=8 {
                let activo = if i <= 5 { 1 } else { 0 }; // First 5 active by default
                tx.execute(
                    "INSERT INTO indicador (grado_id, asignatura_id, corte_evaluativo_id, orden, descripcion, activo) VALUES (?, ?, ?, ?, ?, ?)",
                    rusqlite::params![gradoId, asignaturaId, corteEvaluativoId, i, "", activo],
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
        } else {
            // Check if there are any active indicators, if not, activate the first 5
            let active_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM indicador WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND activo = 1",
                    [gradoId, asignaturaId, corteEvaluativoId],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            if active_count == 0 {
                // Activate first 5 indicators by default
                tx.execute(
                    "UPDATE indicador SET activo = 1 WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? AND orden <= 5",
                    [gradoId, asignaturaId, corteEvaluativoId],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Now fetch the full tree
    // Note: We use the existing locked connection 'conn'

    let mut stmt = conn
        .prepare(
            "SELECT id, orden, descripcion, activo FROM indicador 
             WHERE grado_id = ? AND asignatura_id = ? AND corte_evaluativo_id = ? 
             ORDER BY orden",
        )
        .map_err(|e| e.to_string())?;

    let indicadores = stmt
        .query_map([gradoId, asignaturaId, corteEvaluativoId], |row| {
            let id: i64 = row.get(0)?;
            let orden: i64 = row.get(1)?;
            let descripcion: String = row.get(2)?;
            let activo: bool = row.get::<_, i64>(3)? == 1;

            Ok(Indicador {
                id: Some(id),
                grado_id: gradoId,
                asignatura_id: asignaturaId,
                corte_evaluativo_id: corteEvaluativoId,
                orden,
                descripcion,
                activo,
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

        // Self-heal: if criteria are empty (shouldn't happen), create defaults
        // If more than 3 (duplicates), keep only first 3 by orden and delete extras
        if criterios.is_empty() {
            let scores = [7, 7, 6];
            for (j, score) in scores.iter().enumerate() {
                conn.execute(
                    "INSERT INTO criterio (indicador_id, orden, descripcion, puntaje_maximo) VALUES (?, ?, ?, ?)",
                    rusqlite::params![ind.id, (j + 1) as i64, "", score],
                )
                .map_err(|e| e.to_string())?;
            }
            let criterios_recargados = c_stmt
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
            ind.criterios = criterios_recargados;
        } else if criterios.len() > 3 {
            let mut sorted = criterios;
            sorted.sort_by_key(|c| c.orden);
            let (keep, extra) = sorted.split_at(3);
            for dup in extra {
                if let Some(did) = dup.id {
                    conn.execute("DELETE FROM criterio WHERE id = ?", [did])
                        .map_err(|e| e.to_string())?;
                }
            }
            ind.criterios = keep.to_vec();
        } else {
            ind.criterios = criterios;
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
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE indicador SET descripcion = ?, activo = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![descripcion, if activo { 1 } else { 0 }, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
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
// Estructura específica para estudiantes en la página de notas
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
                "INSERT OR REPLACE INTO nota (estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id) 
                 VALUES (?, ?, ?, ?, ?)",
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
            // Default to all days enabled if no config exists
            Ok(ColegioDiasAsistencia {
                colegio_id: colegioId,
                lunes: true,
                martes: true,
                miercoles: true,
                jueves: true,
                viernes: true,
                sabado: true,
                domingo: true,
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
#[serde(rename_all = "camelCase")]
#[allow(non_snake_case)]
pub struct NotaEstudianteRequest {
    pub estudianteId: i64,
    pub notas: Vec<NotaRequest>,
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
        "INSERT OR REPLACE INTO multiplicador_calificacion (id, multiplicador) VALUES (?, ?)",
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

#[tauri::command]
pub async fn get_db_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    let profile = std::env::var("SCHOOLTRACKER_PROFILE").unwrap_or_default();
    let db_path = if !profile.is_empty() {
        let dir = app_dir.join(&profile);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir.join("school.db")
    } else {
        app_dir.join("school.db")
    };
    Ok(db_path.to_string_lossy().to_string())
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
        return Err("Fecha inválida".to_string());
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
             updated_at = datetime('now')",
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

#[derive(Debug, Serialize, Deserialize)]
pub struct AsistenciaCloudRecord {
    pub id: i64,
    pub estudiante_id: i64,
    pub fecha: String,
    pub estado: String,
    pub observacion: Option<String>,
    pub user_id: String,
}

#[tauri::command]
pub async fn upsert_asistencia_from_cloud(
    state: tauri::State<'_, DbState>,
    records: Vec<AsistenciaCloudRecord>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let count = records.len();
    for record in &records {
        tx.execute(
            "INSERT OR REPLACE INTO asistencia (id, estudiante_id, fecha, estado, observacion) 
             VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                record.id,
                record.estudiante_id,
                &record.fecha,
                &record.estado,
                &record.observacion
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    println!("[CloudSync] {} registros de asistencia guardados desde Supabase", count);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotaCloudRecord {
    pub id: Option<i64>,
    pub estudiante_id: i64,
    pub indicador_id: Option<i64>,
    pub criterio_id: i64,
    pub ano_lectivo_id: Option<i64>,
    pub corte_id: i64,
    pub colegio_id: Option<i64>,
    pub grado_id: Option<i64>,
    pub seccion_id: Option<i64>,
    pub asignatura_id: i64,
    pub puntaje: f64,
    pub estado: Option<String>,
}

#[tauri::command]
pub async fn upsert_notas_from_cloud(
    state: tauri::State<'_, DbState>,
    notas: Vec<NotaCloudRecord>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let count = notas.len();
    for n in &notas {
        tx.execute(
            "INSERT OR REPLACE INTO nota (estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id) 
             VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                n.estudiante_id,
                n.criterio_id,
                n.puntaje,
                n.corte_id,
                n.asignatura_id
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    println!("[CloudSync] {} registros de notas guardados desde Supabase", count);
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
            // Registrar la eliminación pendiente ANTES de eliminar
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
        .prepare("SELECT id, grado_id, asignatura_id, corte_evaluativo_id, orden, descripcion, activo FROM indicador")
        .map_err(|e| e.to_string())?;

    let indicadores = stmt
        .query_map([], |row| {
            Ok(Indicador {
                id: Some(row.get(0)?),
                grado_id: row.get(1)?,
                asignatura_id: row.get(2)?,
                corte_evaluativo_id: row.get(3)?,
                orden: row.get(4)?,
                descripcion: row.get(5)?,
                activo: row.get::<_, i64>(6)? == 1,
                criterios: vec![], // No necesitamos cargar criterios aquí para sync simple
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullData {
    pub anos: Vec<CategoryItem>,
    pub cortes: Vec<CategoryItem>,
    pub colegios: Vec<CategoryItem>,
    pub asignaturas: Vec<CategoryItem>,
    pub grados: Vec<CategoryItem>,
    pub secciones: Vec<CategoryItem>,
    pub estudiantes: Vec<Student>,
    pub indicadores: Vec<Indicador>,
    pub criterios: Vec<Criterio>,
    pub notas: Vec<NotaResponse>,
    pub asistencia: Vec<AsistenciaRecord>,
    pub grade_configs: Vec<GradeConfig>,
    pub multiplicadores: Vec<MultiplicadorItem>,
    pub grado_asignatura: Vec<(i64, i64)>,
    pub colegio_asignatura: Vec<(i64, i64)>,
    pub colegio_dias_asistencia: Vec<ColegioDiasAsistencia>,
    pub is_partial: Option<bool>,
}

#[tauri::command]
pub async fn upsert_pull_data(state: tauri::State<'_, DbState>, data: PullData) -> Result<(), String> {
    let is_partial = data.is_partial.unwrap_or(false);

    println!("[upsert_pull_data] Recibidos: anos={}, cortes={}, colegios={}, asignaturas={}, grados={}, secciones={}, estudiantes={}, indicadores={}, criterios={}, notas={}, asistencia={}, gradeConfigs={}, multiplicadores={}, gradoAsignatura={}, colegioAsignatura={}, colegioDias={}",
        data.anos.len(), data.cortes.len(), data.colegios.len(), data.asignaturas.len(),
        data.grados.len(), data.secciones.len(), data.estudiantes.len(), data.indicadores.len(),
        data.criterios.len(), data.notas.len(), data.asistencia.len(), data.grade_configs.len(),
        data.multiplicadores.len(),
        data.grado_asignatura.len(), data.colegio_asignatura.len(), data.colegio_dias_asistencia.len()
    );

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Función auxiliar para insertar items de categorías
    let upsert_category =
        |tx: &rusqlite::Transaction, table: &str, items: &[CategoryItem]| -> Result<(), String> {
            for item in items {
                tx.execute(
                    &format!(
                        "INSERT OR REPLACE INTO {} (id, nombre, cualitativo) VALUES (?, ?, ?)",
                        table
                    ),
                    rusqlite::params![
                        item.id,
                        item.nombre,
                        if item.cualitativo.unwrap_or(false) {
                            1
                        } else {
                            0
                        }
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        };

    // Función auxiliar para categorías con 'activo'
    let upsert_category_active = |tx: &rusqlite::Transaction,
                                  table: &str,
                                  items: &[CategoryItem]|
     -> Result<(), String> {
        for item in items {
            tx.execute(
                &format!("INSERT OR REPLACE INTO {} (id, nombre, activo, cualitativo) VALUES (?, ?, ?, ?)", table),
                rusqlite::params![
                    item.id, 
                    item.nombre, 
                    if item.activo.unwrap_or(false) { 1 } else { 0 },
                    if item.cualitativo.unwrap_or(false) { 1 } else { 0 }
                ],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    };

    upsert_category_active(&tx, "ano_lectivo", &data.anos)?;
    upsert_category_active(&tx, "corte_evaluativo", &data.cortes)?;
    upsert_category_active(&tx, "colegio", &data.colegios)?;
    upsert_category(&tx, "asignatura", &data.asignaturas)?;
    upsert_category(&tx, "grado", &data.grados)?;
    upsert_category(&tx, "seccion", &data.secciones)?;

    for e in &data.estudiantes {
        tx.execute(
            "INSERT OR REPLACE INTO estudiante (id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, telefono, direccion, email, foto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![e.id, e.nombre, e.codigo, e.sexo, e.ano_lectivo_id, e.grado_id, e.seccion_id, e.colegio_id, e.telefono, e.direccion, e.email, e.foto],
        ).map_err(|e| e.to_string())?;
    }

    for i in &data.indicadores {
        tx.execute(
            "INSERT OR REPLACE INTO indicador (id, grado_id, asignatura_id, corte_evaluativo_id, orden, descripcion, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![i.id, i.grado_id, i.asignatura_id, i.corte_evaluativo_id, i.orden, i.descripcion, if i.activo { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    for c in &data.criterios {
        tx.execute(
            "INSERT OR REPLACE INTO criterio (id, indicador_id, orden, descripcion, puntaje_maximo) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![c.id, c.indicador_id, c.orden, c.descripcion, c.puntaje_maximo],
        ).map_err(|e| e.to_string())?;
    }

    let mut nota_count = 0usize;
    for n in &data.notas {
        tx.execute(
            "INSERT OR REPLACE INTO nota (estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![n.estudiante_id, n.criterio_id, n.valor, n.corte_evaluativo_id.unwrap_or(0), n.asignatura_id.unwrap_or(0)],
        ).map_err(|e| e.to_string())?;
        nota_count += 1;
        if nota_count % 500 == 0 {
            println!("[upsert_pull_data] notas insertadas: {}/{}", nota_count, data.notas.len());
        }
    }
    println!("[upsert_pull_data] Total notas insertadas: {}/{}", nota_count, data.notas.len());

    for a in &data.asistencia {
        // En SQLite la asistencia tiene un ID autoincremental, pero en sync usamos (estudiante_id, fecha) como clave.
        // Si viene un ID desde Supabase, lo usamos. Si no, dejamos que SQLite lo maneje o usemos INSERT OR REPLACE por el UNIQUE.
        if let Some(id) = a.id {
            tx.execute(
                "INSERT OR REPLACE INTO asistencia (id, estudiante_id, fecha, estado, observacion) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![id, a.estudiante_id, a.fecha, a.estado, a.observacion],
            ).map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT OR REPLACE INTO asistencia (estudiante_id, fecha, estado, observacion) VALUES (?, ?, ?, ?)",
                rusqlite::params![a.estudiante_id, a.fecha, a.estado, a.observacion],
            ).map_err(|e| e.to_string())?;
        }
    }

    for gc in &data.grade_configs {
        tx.execute(
            "INSERT OR REPLACE INTO configuracion_calificacion (id, nombre, color, minimo) VALUES (?, ?, ?, ?)",
            rusqlite::params![gc.id, gc.nombre, gc.color, gc.minimo],
        ).map_err(|e| e.to_string())?;
    }

    for m in &data.multiplicadores {
        tx.execute(
            "INSERT OR REPLACE INTO multiplicador_calificacion (id, multiplicador) VALUES (?, ?)",
            rusqlite::params![m.id, m.multiplicador],
        ).map_err(|e| e.to_string())?;
    }

    for (grado_id, asignatura_id) in &data.grado_asignatura {
        tx.execute(
            "INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
            rusqlite::params![grado_id, asignatura_id],
        )
        .map_err(|e| e.to_string())?;
    }

    for (colegio_id, asignatura_id) in &data.colegio_asignatura {
        tx.execute(
            "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
            rusqlite::params![colegio_id, asignatura_id],
        )
        .map_err(|e| e.to_string())?;
    }

    for cda in &data.colegio_dias_asistencia {
        tx.execute(
            "INSERT OR REPLACE INTO colegio_dias_asistencia (colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![cda.colegio_id, cda.lunes, cda.martes, cda.miercoles, cda.jueves, cda.viernes, cda.sabado, cda.domingo],
        ).map_err(|e| e.to_string())?;
    }

    // SINCRONIZACIÓN DE ELIMINACIONES (SYNC BIDIRECCIONAL)
    // 1. Primero, eliminar registros locales que están marcados como pendientes de borrado
    //    (evita que reaparezcan tras un pullAll si aún no se sincronizó su borrado)
    let pending_tables = [
        "estudiante",
        "colegio",
        "grado",
        "seccion",
        "asignatura",
        "ano_lectivo",
        "corte_evaluativo",
        "indicador",
        "criterio",
    ];

    for table in &pending_tables {
        let _ = tx.execute(
            &format!("DELETE FROM {} WHERE id IN (SELECT registro_id FROM sync_pending_deletions WHERE tabla = ?)", table),
            [*table],
        );
    }
    // Limpiar pending deletions simples: la nube es autoritativa durante pullAll
    let _ = tx.execute("DELETE FROM sync_pending_deletions", []);

    // 2. Eliminar registros locales que NO existen en la nube pero tampoco están en pending_deletions
    //    (significa que fueron eliminados en otro dispositivo)

    // Recopilar IDs recibidos de la nube
    let cloud_ano_ids: std::collections::HashSet<i64> =
        data.anos.iter().filter_map(|a| a.id).collect();
    let cloud_corte_ids: std::collections::HashSet<i64> =
        data.cortes.iter().filter_map(|c| c.id).collect();
    let cloud_colegio_ids: std::collections::HashSet<i64> =
        data.colegios.iter().filter_map(|c| c.id).collect();
    let cloud_asignatura_ids: std::collections::HashSet<i64> =
        data.asignaturas.iter().filter_map(|a| a.id).collect();
    let cloud_grado_ids: std::collections::HashSet<i64> =
        data.grados.iter().filter_map(|g| g.id).collect();
    let cloud_seccion_ids: std::collections::HashSet<i64> =
        data.secciones.iter().filter_map(|s| s.id).collect();
    let cloud_estudiante_ids: std::collections::HashSet<i64> =
        data.estudiantes.iter().filter_map(|e| e.id).collect();
    let cloud_indicador_ids: std::collections::HashSet<i64> =
        data.indicadores.iter().filter_map(|i| i.id).collect();
    let cloud_criterio_ids: std::collections::HashSet<i64> =
        data.criterios.iter().filter_map(|c| c.id).collect();

    // Función auxiliar para eliminar registros que no existen en la nube
    let delete_not_in_cloud = |tx: &rusqlite::Transaction,
                               table: &str,
                               cloud_ids: &std::collections::HashSet<i64>|
     -> Result<(), rusqlite::Error> {
        if cloud_ids.is_empty() {
            // Si no hay datos en la nube, no eliminamos nada localmente (excepto pending_deletions)
            return Ok(());
        }

        // Crear placeholders para los IDs de la nube (?1, ?2, ?3...)
        let placeholders = cloud_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

        // Eliminar registros que:
        // 1. NO están en la lista de IDs de la nube
        // 2. NO están en sync_pending_deletions (evita borrar los que el usuario local eliminó y aún no sincronizó)
        let sql = format!(
            "DELETE FROM {} WHERE id NOT IN ({}) AND id NOT IN (SELECT registro_id FROM sync_pending_deletions WHERE tabla = ?)",
            table, placeholders
        );

        let mut params: Vec<&dyn rusqlite::ToSql> = cloud_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        params.push(&table);

        tx.execute(&sql, rusqlite::params_from_iter(params))?;
        Ok(())
    };

    // Ejecutar limpieza para cada tabla (ignorando errores individualmente para no bloquear si una tabla falla)
    if !is_partial {
        let _ = delete_not_in_cloud(&tx, "ano_lectivo", &cloud_ano_ids);
        let _ = delete_not_in_cloud(&tx, "corte_evaluativo", &cloud_corte_ids);
        let _ = delete_not_in_cloud(&tx, "colegio", &cloud_colegio_ids);
        let _ = delete_not_in_cloud(&tx, "asignatura", &cloud_asignatura_ids);
        let _ = delete_not_in_cloud(&tx, "grado", &cloud_grado_ids);
        let _ = delete_not_in_cloud(&tx, "seccion", &cloud_seccion_ids);
        let _ = delete_not_in_cloud(&tx, "estudiante", &cloud_estudiante_ids);
        let _ = delete_not_in_cloud(&tx, "indicador", &cloud_indicador_ids);
        let _ = delete_not_in_cloud(&tx, "criterio", &cloud_criterio_ids);
    }

    // ============================================================================
    // SINCRONIZACIÓN DE ELIMINACIONES - TABLAS CON CLAVES COMPUESTAS
    // ============================================================================

    // 1. Procesar eliminaciones pendientes de asistencia antes de insertar nuevos
    // (evita conflictos UNIQUE cuando se re-inserta un registro eliminado localmente pendiente)
    let _ = tx.execute(
        "DELETE FROM asistencia WHERE (estudiante_id, fecha) IN (SELECT estudiante_id, fecha FROM sync_pending_deletions_asistencia)",
        [],
    );
    let _ = tx.execute("DELETE FROM sync_pending_deletions_asistencia", []);

    // 2. Procesar eliminaciones pendientes de notas
    let _ = tx.execute(
        "DELETE FROM nota WHERE (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) IN (SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM sync_pending_deletions_nota)",
        [],
    );
    let _ = tx.execute("DELETE FROM sync_pending_deletions_nota", []);

    // 3. Procesar eliminaciones pendientes de grado_asignatura
    let _ = tx.execute(
        "DELETE FROM grado_asignatura WHERE (grado_id, asignatura_id) IN (SELECT grado_id, asignatura_id FROM sync_pending_deletions_grado_asignatura)",
        [],
    );
    let _ = tx.execute("DELETE FROM sync_pending_deletions_grado_asignatura", []);

    // 4. Procesar eliminaciones pendientes de colegio_asignatura
    let _ = tx.execute(
        "DELETE FROM colegio_asignatura WHERE (colegio_id, asignatura_id) IN (SELECT colegio_id, asignatura_id FROM sync_pending_deletions_colegio_asignatura)",
        [],
    );
    let _ = tx.execute("DELETE FROM sync_pending_deletions_colegio_asignatura", []);

    // Las pending deletions se limpian aquí porque durante pullAll la nube es la fuente
// autoritativa. Si una nota fue eliminada localmente pero aún existe en la nube,
// la restauramos y descartamos la pending deletion obsoleta.
// pushAll() también las envía al proveedor remoto.

    // ============================================================================
    // ============================================================================
    // SINCRONIZACIÓN BIDIRECCIONAL - No eliminar registros locales durante pullAll()
    // Para evitar perder datos de bases de datos antiguas importadas
    // ============================================================================

    // NOTA: Durante pullAll(), solo sincronizamos los datos de la nube hacia local,
    // pero NO eliminamos registros locales que no existan en la nube.
    // Esto permite restaurar bases de datos antiguas sin perder datos.
    //
    // Si necesitas eliminar registros locales que no están en la nube,
    // usa la opción "Limpiar Nube" en Ajustes > Debugging > Reiniciar DB Local

    tx.commit().map_err(|e| e.to_string())?;
    println!("[upsert_pull_data] ✅ Transacción completada exitosamente");
    Ok(())
    })();
    conn.execute("PRAGMA foreign_keys = ON", []).ok();
    if result.is_ok() {
        // Verificar que las notas se insertaron correctamente
        let check_count: Result<i64, _> = conn.query_row("SELECT COUNT(*) FROM nota", [], |row| row.get(0));
        match check_count {
            Ok(c) => println!("[upsert_pull_data] 🎉 Notas en SQLite después del sync: {}", c),
            Err(e) => println!("[upsert_pull_data] ⚠️ Error verificando conteo de notas: {}", e),
        }
        println!("[upsert_pull_data] 🎉 Función completada exitosamente");
    } else {
        println!("[upsert_pull_data] ❌ Función completada con error: {:?}", result);
    }
    result
}

/// Diagnóstico: muestra el conteo de notas en SQLite filtrado por grado/sección/corte/asignatura
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

/// Diagnóstico: muestra cantidad total de notas en SQLite
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
    
    println!("🗑️ [DB] delete_record_local: {} con id {:?}", table, id);

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
            return Err("Nota requiere clave compuesta para eliminación".to_string());
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GradoCount {
    pub grado: String,
    pub count: i64,
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

    let total_grados: i64 = conn
        .query_row("SELECT COUNT(*) FROM grado", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let total_colegios: i64 = conn
        .query_row("SELECT COUNT(*) FROM colegio", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let total_secciones: i64 = conn
        .query_row("SELECT COUNT(*) FROM seccion", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

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

    // Students per grade
    let mut stmt_students_grade = if colegioId.is_some() {
        conn.prepare("SELECT g.nombre, COUNT(e.id) FROM estudiante e JOIN grado g ON e.grado_id = g.id WHERE e.colegio_id = ?1 GROUP BY e.grado_id ORDER BY g.nombre")
    } else {
        conn.prepare("SELECT g.nombre, COUNT(e.id) FROM estudiante e JOIN grado g ON e.grado_id = g.id GROUP BY e.grado_id ORDER BY g.nombre")
    }.map_err(|e| e.to_string())?;
    
    let estudiantes_por_grado: Vec<GradoCount> = if let Some(cid) = colegioId {
        stmt_students_grade.query_map(rusqlite::params![cid], |row| Ok(GradoCount { grado: row.get(0)?, count: row.get(1)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    } else {
        stmt_students_grade.query_map([], |row| Ok(GradoCount { grado: row.get(0)?, count: row.get(1)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
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
    })
}

#[tauri::command]
pub async fn check_turso_connectivity(turso_url: String) -> Result<bool, String> {
    // Timeout corto: 5 segundos para no bloquear
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(5))
        .build();
    match agent.head(&turso_url).call() {
        Ok(_) => Ok(true),
        Err(e) => {
            println!("[check_turso_connectivity] Error: {}", e);
            Ok(false)
        }
    }
}

// ============================================================================
// Estructuras para el wizard de inicialización
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
pub struct SeedSelections {
    pub anos: Vec<String>,
    pub colegios: Vec<String>,
    pub grados: Vec<String>,
    pub secciones: Vec<String>,
    pub asignaturas: Vec<String>,
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
            SeedOptionCualitativo { nombre: "Educación Física".into(), cualitativo: true },
        ],
    })
}

#[tauri::command]
pub async fn seed_selected_data(state: tauri::State<'_, DbState>, selections: SeedSelections) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;

    // 1. Años lectivos seleccionados
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

    // 3. Colegios seleccionados
    for nombre in &selections.colegios {
        let orden = if nombre == "Candelario Sotelo" { 1 } else { 2 };
        conn.execute(
            "INSERT OR IGNORE INTO colegio (nombre, orden) VALUES (?, ?)",
            rusqlite::params![nombre, orden],
        ).map_err(|e| e.to_string())?;
    }

    // 4. Asignaturas seleccionadas
    for nombre in &selections.asignaturas {
        let cualitativo = matches!(nombre.as_str(), "TAC" | "AEP" | "Convivencia & Civismo" | "Creciendo en Valores" | "Derecho & Dignidad de la Mujer" | "Educación Física");
        conn.execute(
            "INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES (?, ?)",
            rusqlite::params![nombre, if cualitativo { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    // 5. Grados seleccionados
    for nombre in &selections.grados {
        let cualitativo = matches!(nombre.as_str(), "1er grado" | "2do grado");
        conn.execute(
            "INSERT OR IGNORE INTO grado (nombre, cualitativo) VALUES (?, ?)",
            rusqlite::params![nombre, if cualitativo { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }

    // 6. Secciones seleccionadas
    for nombre in &selections.secciones {
        conn.execute(
            "INSERT OR IGNORE INTO seccion (nombre) VALUES (?)",
            [nombre],
        ).map_err(|e| e.to_string())?;
    }

    // 7. Producto cartesiano grado × asignatura (solo para grados y asignaturas seleccionados)
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
        for n in &selections.grados { params.push(Box::new(n.clone())); }
        for n in &selections.asignaturas { params.push(Box::new(n.clone())); }
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice()).map_err(|e| e.to_string())?;
    }

    // 8. Producto cartesiano colegio × asignatura
    if !selections.colegios.is_empty() && !selections.asignaturas.is_empty() {
        let placeholders_c = selections.colegios.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let placeholders_a = selections.asignaturas.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id)
             SELECT c.id, a.id FROM colegio c
             CROSS JOIN asignatura a
             WHERE c.nombre IN ({}) AND a.nombre IN ({})",
            placeholders_c, placeholders_a
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for n in &selections.colegios { params.push(Box::new(n.clone())); }
        for n in &selections.asignaturas { params.push(Box::new(n.clone())); }
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice()).map_err(|e| e.to_string())?;
    }

    // 9. Configuración de calificaciones (siempre)
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

    println!("✅ [DB] Datos seleccionados insertados correctamente");
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

#[tauri::command]
pub async fn factory_reset(state: tauri::State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let tables = [
        "asistencia", "nota", "criterio", "indicador",
        "grado_asignatura", "colegio_asignatura", "estudiante",
        "seccion", "grado", "asignatura", "colegio_dias_asistencia",
        "colegio", "corte_evaluativo", "ano_lectivo",
        "configuracion_calificacion",
        "multiplicador_calificacion",
        "sync_pending_deletions", "sync_pending_deletions_asistencia",
        "sync_pending_deletions_nota", "sync_pending_deletions_grado_asignatura",
        "sync_pending_deletions_colegio_asignatura",
    ];

    conn.execute("PRAGMA foreign_keys = OFF", []).map_err(|e| e.to_string())?;

    for table in tables.iter() {
        conn.execute(&format!("DROP TABLE IF EXISTS {}", table), []).map_err(|e| e.to_string())?;
    }

    // Recrear tablas vacías
    drop(conn);
    let conn2 = state.conn.lock().map_err(|e| e.to_string())?;
    init_database(&conn2)?;

    // Limpiar flag de inicialización
    conn2.execute("DELETE FROM app_meta WHERE key = 'initialized'", []).map_err(|e| e.to_string())?;

    conn2.execute("PRAGMA foreign_keys = ON", []).map_err(|e| e.to_string())?;

    println!("✅ [DB] Factory reset completado");
    Ok(())
}
