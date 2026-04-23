mod db;

use db::*;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[tauri::command]
fn set_orientation(_app_handle: tauri::AppHandle, _orientation: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let orientation_value = match _orientation.as_str() {
            "portrait" => 1,
            "landscape" => 0,
            "any" => 4,
            _ => -1,
        };
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let _ = env
                .call_method(
                    activity,
                    "setRequestedOrientation",
                    "(I)V",
                    &[JValue::Int(orientation_value)],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn print_pdf(_app_handle: tauri::AppHandle, _path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let j_path = env.new_string(clean_path).map_err(|e| e.to_string())?;
            let _ = env
                .call_method(
                    activity,
                    "printPdf",
                    "(Ljava/lang/String;)V",
                    &[JValue::Object(&j_path)],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Not supported".into())
    }
}

#[tauri::command]
fn share_pdf(_app_handle: tauri::AppHandle, _path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let j_path = env.new_string(clean_path).map_err(|e| e.to_string())?;
            let _ = env
                .call_method(
                    activity,
                    "sharePdf",
                    "(Ljava/lang/String;)V",
                    &[JValue::Object(&j_path)],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
fn save_file_android(
    _app_handle: tauri::AppHandle,
    _path: String,
    _mime: String,
    _name: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::JValue;
        let clean_path = _path.replace("file://", "");
        unsafe {
            let ctx = ndk_context::android_context();
            let vm_ptr = ctx.vm();
            let activity_ptr = ctx.context();
            let vm = jni::JavaVM::from_raw(vm_ptr as *mut _).map_err(|e| e.to_string())?;
            let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
            let activity = jni::objects::JObject::from_raw(activity_ptr as *mut _);
            let j_path = env.new_string(clean_path).map_err(|e| e.to_string())?;
            let j_mime = env.new_string(_mime).map_err(|e| e.to_string())?;
            let j_name = env.new_string(_name).map_err(|e| e.to_string())?;
            let _ = env
                .call_method(
                    activity,
                    "saveFile",
                    "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                    &[
                        JValue::Object(&j_path),
                        JValue::Object(&j_mime),
                        JValue::Object(&j_name),
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            if !app_dir.exists() {
                std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
            }
            let db_path = app_dir.join("database.sqlite");
            let conn = Connection::open(db_path).expect("Failed to open database");
            db::run_migrations(&conn).expect("Failed to run migrations");
            app_handle.manage(DbState {
                conn: Arc::new(Mutex::new(conn)),
            });

            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_anos,
            add_ano,
            update_ano,
            delete_ano,
            set_active_ano,
            get_cortes,
            add_corte,
            update_corte,
            delete_corte,
            set_active_corte,
            get_colegios,
            add_colegio,
            update_colegio,
            delete_colegio,
            set_active_colegio,
            update_colegio_order,
            get_asignaturas,
            add_asignatura,
            update_asignatura,
            delete_asignatura,
            get_grados,
            add_grado,
            update_grado,
            delete_grado,
            get_secciones,
            add_seccion,
            update_seccion,
            delete_seccion,
            get_students,
            add_student,
            update_student,
            delete_student,
            get_subjects_by_grade,
            assign_subject_to_grade,
            unassign_subject_from_grade,
            assign_all_subjects_to_grade,
            unassign_all_subjects_from_grade,
            get_subjects_by_colegio,
            assign_subject_to_colegio,
            unassign_subject_from_colegio,
            assign_all_subjects_to_colegio,
            unassign_all_subjects_from_colegio,
            get_evaluation_config,
            update_indicador,
            update_criterio,
            get_estudiantes_by_filters,
            save_notas_estudiantes,
            get_notas_by_filters,
            get_db_path,
            get_grade_configs,
            update_grade_config,
            get_asistencia_estudiantes,
            save_asistencia,
            delete_asistencia_batch,
            get_asistencia_rango,
            get_asistencia_all,
            get_colegio_dias_asistencia,
            save_colegio_dias_asistencia,
            set_orientation,
            print_pdf,
            share_pdf,
            save_file_android,
            check_category_dependencies,
            delete_category_force,
            get_indicadores_all,
            get_criterios_all,
            get_notas_all,
            get_student_impact,
            reset_local_database,
            get_grados_by_colegio,
            get_secciones_by_grado_colegio,
            upsert_pull_data,
            get_colegio_dias_asistencia_all,
            get_pending_deletions,
            remove_pending_deletion,
            remove_pending_deletion_by_record,
            get_recommended_colegio,
            // Nuevas funciones para tablas con claves compuestas
            get_pending_deletions_asistencia,
            remove_pending_deletion_asistencia,
            get_pending_deletions_nota,
            remove_pending_deletion_nota,
            get_pending_deletions_grado_asignatura,
            remove_pending_deletion_grado_asignatura,
            get_pending_deletions_colegio_asignatura,
            remove_pending_deletion_colegio_asignatura
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
