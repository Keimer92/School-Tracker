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

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    let migrations = [
        include_str!("../migrations/20240131000000_init.sql"),
        include_str!("../migrations/20240131000001_add_active_column.sql"),
        include_str!("../migrations/20240131000002_create_evaluations.sql"),
        include_str!("../migrations/20240201000001_add_contact_info.sql"),
        include_str!("../migrations/20240201000002_add_grade_colors.sql"),
        include_str!("../migrations/20240201000003_add_qualitative_to_grades.sql"),
        include_str!("../migrations/20240201000004_set_default_qualitative_grades.sql"),
        include_str!("../migrations/20240201000005_add_thresholds_to_grades.sql"),
        include_str!("../migrations/20240201000006_set_default_thresholds.sql"),
        include_str!("../migrations/20240203000000_create_attendance.sql"),
        include_str!("../migrations/20240203000001_add_colegio_attendance_days.sql"),
        include_str!("../migrations/20240205000000_update_default_subjects.sql"),
        include_str!("../migrations/20240207000000_add_ela_malpaisillo.sql"),
        include_str!("../migrations/20240220000000_add_colegio_order.sql"),
        include_str!("../migrations/20240221000000_add_colegio_subjects.sql"),
        include_str!("../migrations/20240326000000_add_sync_pending_deletions.sql"),
        include_str!("../migrations/20260326000000_add_student_foto.sql"),
        include_str!("../migrations/20240417000000_extend_sync_pending_deletions.sql"),
        include_str!("../migrations/20260423000000_fix_estudiante_table.sql"),
    ];

    for migration in migrations.iter() {
        let _migration_name = migration.lines().next().unwrap_or("unknown");
        println!("🔄 [MIGRATION] Ejecutando migración...");

        // Split the migration into individual statements
        let statements: Vec<&str> = migration
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        let mut migration_success = true;
        for statement in statements {
            if statement.is_empty() || statement.starts_with("--") {
                continue;
            }
            match conn.execute_batch(statement) {
                Ok(_) => {}
                Err(e) => {
                    let error_msg = e.to_string();
                    // Ignore "duplicate column name" errors as migrations should be idempotent
                    if error_msg.contains("duplicate column name") {
                        println!("⚠️ [MIGRATION] Ignorando columna duplicada: {}", error_msg);
                    } else {
                        println!(
                            "⚠️ [MIGRATION] Error en declaración: {} - {}",
                            statement, error_msg
                        );
                        migration_success = false;
                    }
                }
            }
        }

        if migration_success {
            println!("✅ [MIGRATION] Migración ejecutada exitosamente");
        } else {
            println!("⚠️ [MIGRATION] Migración completada con errores");
        }
    }

    Ok(())
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
pub fn get_student_impact(
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
pub fn reset_local_database(state: tauri::State<'_, DbState>) -> Result<(), String> {
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
    // que los datos iniciales (semillas) se vuelvan a crear inmediatamente
    run_migrations(&conn_guard)?;

    Ok(())
}

// Macro to generate CRUD commands for each table
macro_rules! create_crud_commands {
    ($table:ident, $get_all:ident, $add:ident, $update:ident, $delete:ident) => {
        #[tauri::command]
        pub fn $get_all(state: tauri::State<'_, DbState>) -> Result<Vec<CategoryItem>, String> {
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
        pub fn $add(state: tauri::State<'_, DbState>, nombre: String) -> Result<i64, String> {
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

        #[tauri::command]
        pub fn $update(
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
                    " SET nombre = ?, cualitativo = ? WHERE id = ?"
                ),
                rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        }

        #[tauri::command]
        pub fn $delete(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
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
        pub fn $get_all(state: tauri::State<'_, DbState>) -> Result<Vec<CategoryItem>, String> {
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
        pub fn $add(state: tauri::State<'_, DbState>, nombre: String) -> Result<i64, String> {
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

        #[tauri::command]
        pub fn $update(
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
                    " SET nombre = ?, cualitativo = ? WHERE id = ?"
                ),
                rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        }

        #[tauri::command]
        pub fn $delete(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
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
        pub fn $set_active(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
            let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            // Deactivate all
            tx.execute(
                concat!("UPDATE ", stringify!($table), " SET activo = 0"),
                [],
            )
            .map_err(|e| e.to_string())?;

            // Activate selected
            tx.execute(
                concat!(
                    "UPDATE ",
                    stringify!($table),
                    " SET activo = 1 WHERE id = ?"
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
pub fn check_category_dependencies(
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
pub fn delete_category_force(
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
#[allow(non_snake_case)]
pub fn get_grados_by_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    anoLectivoId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT g.id, g.nombre, g.cualitativo
             FROM grado g
             INNER JOIN estudiante e ON g.id = e.grado_id
             WHERE e.colegio_id = ? AND e.ano_lectivo_id = ?
             ORDER BY g.nombre",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([colegioId, anoLectivoId], |row| {
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
pub fn get_secciones_by_grado_colegio(
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
pub fn get_students(state: tauri::State<'_, DbState>) -> Result<Vec<Student>, String> {
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
pub fn add_student(state: tauri::State<'_, DbState>, student: Student) -> Result<i64, String> {
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
pub fn update_student(state: tauri::State<'_, DbState>, student: Student) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE estudiante SET nombre = ?, codigo = ?, sexo = ?, ano_lectivo_id = ?, grado_id = ?, seccion_id = ?, colegio_id = ?, telefono = ?, direccion = ?, email = ?, foto = ? WHERE id = ?",
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
pub fn get_recommended_colegio(state: tauri::State<'_, DbState>) -> Result<i64, String> {
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
pub fn get_pending_deletions(
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
pub fn remove_pending_deletion(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_pending_deletions WHERE id = ?", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_pending_deletion_by_record(
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

// ============================================================================
// Funciones para manejar eliminaciones de tablas con claves compuestas
// ============================================================================

#[tauri::command]
pub fn get_pending_deletions_asistencia(
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
pub fn remove_pending_deletion_asistencia(
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
pub fn get_pending_deletions_nota(
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
pub fn remove_pending_deletion_nota(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_pending_deletions_nota WHERE id = ?", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pending_deletions_grado_asignatura(
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
pub fn remove_pending_deletion_grado_asignatura(
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
pub fn get_pending_deletions_colegio_asignatura(
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
pub fn remove_pending_deletion_colegio_asignatura(
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
pub fn delete_student(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
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

// Curriculum (Grade-Subject) Commands
#[tauri::command]
#[allow(non_snake_case)]
pub fn get_subjects_by_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.nombre, a.cualitativo 
             FROM asignatura a
             INNER JOIN grado_asignatura ga ON a.id = ga.asignatura_id
             WHERE ga.grado_id = ?",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([gradoId], |row| {
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
pub fn assign_subject_to_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)",
        [gradoId, asignaturaId],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn unassign_subject_from_grade(
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
pub fn assign_all_subjects_to_grade(
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
pub fn unassign_all_subjects_from_grade(
    state: tauri::State<'_, DbState>,
    gradoId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM grado_asignatura WHERE grado_id = ?", [gradoId])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_subjects_by_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<Vec<CategoryItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.nombre, a.cualitativo
              FROM asignatura a
              ORDER BY a.nombre",
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
pub fn assign_subject_to_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)",
        [colegioId, asignaturaId],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn unassign_subject_from_colegio(
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
pub fn assign_all_subjects_to_colegio(
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
pub fn unassign_all_subjects_from_colegio(
    state: tauri::State<'_, DbState>,
    colegioId: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
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
pub fn get_colegios(state: tauri::State<'_, DbState>) -> Result<Vec<CategoryItem>, String> {
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
pub fn add_colegio(state: tauri::State<'_, DbState>, nombre: String) -> Result<i64, String> {
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
pub fn update_colegio(
    state: tauri::State<'_, DbState>,
    id: i64,
    nombre: String,
    cualitativo: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE colegio SET nombre = ?, cualitativo = ? WHERE id = ?",
        rusqlite::params![nombre, if cualitativo { 1 } else { 0 }, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_colegio(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM colegio WHERE id = ?", [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_active_colegio(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Deactivate all
    tx.execute("UPDATE colegio SET activo = 0", [])
        .map_err(|e| e.to_string())?;

    // Activate selected
    tx.execute("UPDATE colegio SET activo = 1 WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_colegio_order(
    state: tauri::State<'_, DbState>,
    items: Vec<CategoryItem>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, item) in items.iter().enumerate() {
        if let Some(id) = item.id {
            tx.execute(
                "UPDATE colegio SET orden = ? WHERE id = ?",
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
pub fn get_evaluation_config(
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

        ind.criterios = criterios;
    }

    Ok(result)
}

#[tauri::command]
pub fn update_indicador(
    state: tauri::State<'_, DbState>,
    id: i64,
    descripcion: String,
    activo: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE indicador SET descripcion = ?, activo = ? WHERE id = ?",
        rusqlite::params![descripcion, if activo { 1 } else { 0 }, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_criterio(
    state: tauri::State<'_, DbState>,
    id: i64,
    descripcion: String,
    puntajeMaximo: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE criterio SET descripcion = ?, puntaje_maximo = ? WHERE id = ?",
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
pub fn get_estudiantes_by_filters(
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
pub fn save_notas_estudiantes(
    state: tauri::State<'_, DbState>,
    notas: Vec<NotaEstudianteRequest>,
    corteId: i64,
    asignaturaId: i64,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for nota_est in notas {
        for nota in nota_est.notas {
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
pub fn get_colegio_dias_asistencia(
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
pub fn save_colegio_dias_asistencia(
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
         domingo = excluded.domingo",
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
    pub color: String,
    pub minimo: i32,
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
pub struct AsistenciaReporteItem {
    pub id: i64,
    pub nombre: String,
    pub sexo: String,
    pub fechas: Vec<String>,        // "YYYY-MM-DD:ESTADO"
    pub observaciones: Vec<String>, // "YYYY-MM-DD:OBSERVACION"
}

#[tauri::command]
pub fn get_grade_configs(state: tauri::State<'_, DbState>) -> Result<Vec<GradeConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, color, minimo FROM configuracion_calificacion")
        .map_err(|e| e.to_string())?;

    let configs = stmt
        .query_map([], |row| {
            Ok(GradeConfig {
                id: row.get(0)?,
                color: row.get(1)?,
                minimo: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(configs)
}

#[tauri::command]
pub fn update_grade_config(
    state: tauri::State<'_, DbState>,
    id: String,
    color: String,
    minimo: i32,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE configuracion_calificacion SET color = ?, minimo = ? WHERE id = ?",
        rusqlite::params![color, minimo, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_notas_by_filters(
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
pub fn get_db_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    let db_path = app_dir.join("school.db");
    Ok(db_path.to_string_lossy().to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_asistencia_estudiantes(
    state: tauri::State<'_, DbState>,
    fecha: String,
    anoLectivoId: i64,
    colegioId: i64,
    gradoId: i64,
    seccionId: i64,
    sexo: Option<String>,
) -> Result<Vec<AsistenciaEstudiante>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut query = String::from(
        "SELECT e.id, e.nombre, e.codigo, e.sexo, a.estado, a.observacion 
         FROM estudiante e 
         LEFT JOIN asistencia a ON e.id = a.estudiante_id AND a.fecha = ? 
         WHERE e.ano_lectivo_id = ? AND e.colegio_id = ? AND e.grado_id = ? AND e.seccion_id = ?",
    );

    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![
        Box::new(fecha),
        Box::new(anoLectivoId),
        Box::new(colegioId),
        Box::new(gradoId),
        Box::new(seccionId),
    ];

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
pub fn get_asistencia_rango(
    state: tauri::State<'_, DbState>,
    fechaInicio: String,
    fechaFin: String,
    anoLectivoId: i64,
    colegioId: i64,
    gradoId: i64,
    seccionId: i64,
) -> Result<Vec<AsistenciaReporteItem>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 1. Obtener todos los estudiantes filtrados
    let mut stmt_est = conn
        .prepare(
            "SELECT id, nombre, sexo FROM estudiante 
         WHERE ano_lectivo_id = ? AND colegio_id = ? AND grado_id = ? AND seccion_id = ? 
         ORDER BY nombre",
        )
        .map_err(|e| e.to_string())?;

    let estudiantes = stmt_est
        .query_map([anoLectivoId, colegioId, gradoId, seccionId], |row| {
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
         AND e.ano_lectivo_id = ? AND e.colegio_id = ? AND e.grado_id = ? AND e.seccion_id = ?",
        )
        .map_err(|e| e.to_string())?;

    let asignaciones = stmt_asist
        .query_map(
            rusqlite::params![
                fechaInicio,
                fechaFin,
                anoLectivoId,
                colegioId,
                gradoId,
                seccionId
            ],
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
pub fn save_asistencia(
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
             observacion = excluded.observacion",
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
pub fn delete_asistencia_batch(
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
pub fn get_indicadores_all(state: tauri::State<'_, DbState>) -> Result<Vec<Indicador>, String> {
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
pub fn get_criterios_all(state: tauri::State<'_, DbState>) -> Result<Vec<Criterio>, String> {
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
pub fn get_notas_all(state: tauri::State<'_, DbState>) -> Result<Vec<NotaResponse>, String> {
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
pub fn get_asistencia_all(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<AsistenciaRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, estudiante_id, fecha, estado, observacion FROM asistencia")
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
    pub grado_asignatura: Vec<(i64, i64)>,
    pub colegio_asignatura: Vec<(i64, i64)>,
    pub colegio_dias_asistencia: Vec<ColegioDiasAsistencia>,
}

#[tauri::command]
pub fn upsert_pull_data(state: tauri::State<'_, DbState>, data: PullData) -> Result<(), String> {
    println!("🔄 [DB] upsert_pull_data llamado con datos:");
    println!("   - años: {}", data.anos.len());
    println!("   - cortes: {}", data.cortes.len());
    println!("   - colegios: {}", data.colegios.len());
    println!("   - asignaturas: {}", data.asignaturas.len());
    println!("   - grados: {}", data.grados.len());
    println!("   - secciones: {}", data.secciones.len());
    println!("   - estudiantes: {}", data.estudiantes.len());
    println!("   - indicadores: {}", data.indicadores.len());
    println!("   - criterios: {}", data.criterios.len());
    println!("   - notas: {}", data.notas.len());
    println!("   - asistencia: {}", data.asistencia.len());

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
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

    for n in &data.notas {
        tx.execute(
            "INSERT OR REPLACE INTO nota (estudiante_id, criterio_id, valor, corte_evaluativo_id, asignatura_id) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![n.estudiante_id, n.criterio_id, n.valor, n.corte_evaluativo_id, n.asignatura_id],
        ).map_err(|e| e.to_string())?;
    }

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
            "INSERT OR REPLACE INTO configuracion_calificacion (id, color, minimo) VALUES (?, ?, ?)",
            rusqlite::params![gc.id, gc.color, gc.minimo],
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
    let _ = delete_not_in_cloud(&tx, "ano_lectivo", &cloud_ano_ids);
    let _ = delete_not_in_cloud(&tx, "corte_evaluativo", &cloud_corte_ids);
    let _ = delete_not_in_cloud(&tx, "colegio", &cloud_colegio_ids);
    let _ = delete_not_in_cloud(&tx, "asignatura", &cloud_asignatura_ids);
    let _ = delete_not_in_cloud(&tx, "grado", &cloud_grado_ids);
    let _ = delete_not_in_cloud(&tx, "seccion", &cloud_seccion_ids);
    let _ = delete_not_in_cloud(&tx, "estudiante", &cloud_estudiante_ids);
    let _ = delete_not_in_cloud(&tx, "indicador", &cloud_indicador_ids);
    let _ = delete_not_in_cloud(&tx, "criterio", &cloud_criterio_ids);

    // ============================================================================
    // SINCRONIZACIÓN DE ELIMINACIONES - TABLAS CON CLAVES COMPUESTAS
    // ============================================================================

    // 1. Procesar eliminaciones pendientes de asistencia antes de insertar nuevos
    // (evita conflictos UNIQUE cuando se re-inserta un registro eliminado localmente pendiente)
    let _ = tx.execute(
        "DELETE FROM asistencia WHERE (estudiante_id, fecha) IN (SELECT estudiante_id, fecha FROM sync_pending_deletions_asistencia)",
        [],
    );

    // 2. Procesar eliminaciones pendientes de notas
    let _ = tx.execute(
        "DELETE FROM nota WHERE (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id) IN (SELECT estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id FROM sync_pending_deletions_nota)",
        [],
    );

    // 3. Procesar eliminaciones pendientes de grado_asignatura
    let _ = tx.execute(
        "DELETE FROM grado_asignatura WHERE (grado_id, asignatura_id) IN (SELECT grado_id, asignatura_id FROM sync_pending_deletions_grado_asignatura)",
        [],
    );

    // 4. Procesar eliminaciones pendientes de colegio_asignatura
    let _ = tx.execute(
        "DELETE FROM colegio_asignatura WHERE (colegio_id, asignatura_id) IN (SELECT colegio_id, asignatura_id FROM sync_pending_deletions_colegio_asignatura)",
        [],
    );

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
    println!("✅ [DB] upsert_pull_data completado exitosamente");
    Ok(())
}

#[tauri::command]
pub fn get_colegio_dias_asistencia_all(
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
