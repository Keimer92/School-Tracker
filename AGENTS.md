# AGENTS.md — School Tracker Pro

Guía para agentes (IA) que trabajen en este repositorio. Describe la arquitectura,
convenciones, comandos y los "tropezones" frecuentes.

## Qué es
Aplicación de escritorio/móvil (**Tauri 2 + Svelte 5**) para gestión escolar: años
lectivos, colegios, grados, secciones, asignaturas, estudiantes, evaluaciones
(indicadores/criterios/notas), asistencia e informes/PDF. Datos locales en **SQLite**
y sincronización en la nube mediante dos proveedores seleccionables: **Turso (libSQL)**
y **Supabase (Postgres)**. También respaldo en **Google Drive**.

Idioma del código y comentarios: **español**. Mantener así.

## Stack
- **Frontend**: Svelte 5 (runes: `$state`, `$derived`, `$effect`), TypeScript, Vite 7.
- **Backend/Shell**: Tauri 2 (Rust). Ventana principal `main` (maximizada en desktop).
- **DB local**: SQLite vía `rusqlite` (features `bundled`), archivo `school.db` en el
  `app_data_dir` de Tauri (o subdirectorio según `SCHOOLTRACKER_PROFILE`).
- **Nube**: `@tursodatabase/serverless` (libSQL) y `@supabase/supabase-js` v2 (anon key).
- **Otros**: `jspdf` + `jspdf-autotable` (PDF), `xlsx`, `appwrite` (dependencia presente
  pero no es el flujo principal), Google Drive OAuth (servidor local en Rust).
- **Rust deps clave**: `rusqlite`, `sqlx` (runtime-tokio-rustls + postgres, para DDL
  directo a Supabase), `futures`, `tokio`, `tauri-plugin-{fs,dialog,opener}`, `jni`/`ndk-context` (Android).

## Estructura
```
package.json                 scripts npm (dev, build, tauri, dev:android)
vite.config.ts               puerto dev 1420; plugin svelte + top-level-await
svelte.config.js             Svelte 5 (componentApi: 4 compat)
tsconfig.json                target ES2015, strict; EXCLUYE *.supabase.ts, *.backup.ts, *.old.ts
.env                         VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_DB_PASSWORD,
                              VITE_TURSO_DB_URL, VITE_TURSO_AUTH_TOKEN
src/
  main.ts                    bootstrap; ventana 'google-login' maneja OAuth
  App.svelte                 shell: sidebar + tabs (notas, reportes, estudiantes,
                              evaluaciones, globales, asistencia, informe, cloud, ajustes)
  App.css
  svelte/                    páginas UI (*Page.svelte) y componentes reutilizables
  lib/
    supabase.ts              cliente Supabase (anon). Proxy que crea client bajo demanda.
    syncService.supabase.ts  IMPLEMENTACIÓN del proveedor Supabase (sync). Contiene el DDL
                              de Postgres en ensureSchema y getSupabaseConnStrings.
    supabase.backup.ts       copia de respaldo (excluida de typecheck)
    tursoClient.ts           cliente libSQL (connect/restore/clear)
    tursoSyncService.ts      IMPLEMENTACIÓN del proveedor Turso + SyncManager (dirty tracking)
    syncService.ts           Proxy que delega al proveedor activo ('turso' | 'supabase')
    dirtyTracker.ts          marcas de tablas "sucias" para sync incremental
    googleDriveBackupService.ts
    realtimeService.ts / realtimeService.supabase.ts
    cloud/config.ts, dateUtils.ts
src-tauri/
  Cargo.toml                 deps Rust (ver stack)
  tauri.conf.json            productName, identifier com.keimer.schooltrackerpro, ventana,
                            plugins fs, bundle targets "all"
  src/
    main.rs                  entrypoint -> llama run()
    lib.rs                   #![tauri::command]s (CRUD, backup, supabase_execute_sql, etc.)
                              y run() con generate_handler! (REGISTRO de comandos)
    db.rs                    SCHEMA SQLite (init_database), migraciones, semillas,
                              macros de CRUD, comandos de borrado en cascada + pending deletions
    supabase_sql.rs          supabase_execute_sql: ejecuta DDL en Postgres (directo + pooler)
src-tauri/gen/               generado (ignorar; no editar a mano)
```

## Arquitectura de datos
1. **Local (fuente de verdad offline)**: SQLite en Rust. El frontend llama a comandos
   Rust con `invoke('nombre_comando', { args })` (`@tauri-apps/api/core`).
   Ej. `get_students`, `add_student`, `save_notas_estudiantes`, `get_pending_deletions`.
2. **Proveedor de sync activo** (`src/lib/syncService.ts`): `setActiveProvider('turso'|'supabase')`
   elige entre `tursoSyncService` y `supabaseSyncService` (mismo interfaz). Proxy `syncService`
   delega dinámicamente.
3. **Supabase (proveedor)**:
   - Cliente **anon** (`supabase.ts`). NO hay auth de usuario; `getUserId()` en
     `syncService.supabase.ts` devuelve un **UUID de dispositivo estable** guardado en
     `localStorage['sb_device_user_id']` (no usar `auth.getUser()`).
   - DDL automático en `ensureSchema()` (Postgres mirror del schema local). Crea tablas y
     luego corre "fixes" idempotentes: `ALTER TABLE grado/seccion/asignatura ADD COLUMN IF NOT EXISTS user_id`
     y `ALTER TABLE <todas> DISABLE ROW LEVEL SECURITY` (la app usa anon key → RLS debe estar
     desactivado para permitir DML).
   - La creación de tablas usa conexión **directa a Postgres** vía Rust
     (`supabase_execute_sql`) con fallback a **connection pooler** por región
     (AWS + GCP) construido en `getSupabaseConnStrings()`. Requiere la **DB password**
     (campo en Ajustes → Nube, o `VITE_SUPABASE_DB_PASSWORD`). Si se pega un
     `postgresql://...` completo, se usa directo.
4. **Turso (proveedor por defecto)**: cliente libSQL (`tursoClient.ts`), credenciales en
   `localStorage` o `.env` (`VITE_TURSO_DB_URL`/`VITE_TURSO_AUTH_TOKEN`).
5. **Pending deletions**: los borrados locales se registran en tablas
   `sync_pending_deletions` (simple, columna `tabla`/`registro_id`) y
   `sync_pending_deletions_asistencia`, `_nota`, `_grado_asignatura`,
   `_colegio_asignatura` (claves compuestas). El sync las propaga a la nube y luego las limpia.
   Al borrar en `db.rs`, SIEMPRE insertar en la tabla de pending correspondiente dentro de la
   misma transacción.

## Convenciones y GOTCHAS (leer antes de editar)
- **Nuevos comandos Rust**: definir `#[tauri::command]` en `lib.rs` o `db.rs` y
  **registrarlos en `generate_handler![...]` dentro de `run()` (lib.rs)**. Si no se
  registran, `invoke` falla en runtime (no en compile).
- **Cambios de schema**: deben reflejarse en **dos lados**:
  - `src-tauri/src/db.rs` → `init_database` (SQLite; usa `AUTOINCREMENT`, `datetime('now')`,
    FKs `ON DELETE CASCADE`).
  - `src/lib/syncService.supabase.ts` → DDL dentro de `ensureSchema` (Postgres; usa `SERIAL`,
    `now()::text`, columnas `user_id TEXT`). Mantener ambos en sincronía.
- **Supabase**: anon key + RLS desactivado + `user_id` = device UUID. No filtrar borrados por
  `user_id` (las tablas grado/seccion/asignatura pueden no tener la columna). El DDL necesita
  la DB password; si falta, `ensureSchema` cae al fallback RPC `exec_sql` (requiere esa función
  en el servidor).
- **Composite-key tables**: `nota`, `asistencia`, `grado_asignatura`, `colegio_asignatura`
  usan su propia tabla de pending deletions. No reusar `sync_pending_deletions` para ellas.
- **Svelte 5 runes**: estado con `$state`, efectos con `$effect`. No usar stores globales
  salvo que sea necesario. `*.backup.ts` y `*.old.ts` están excluidos del typecheck.
- **tsconfig** excluye `*.supabase.ts`, `*.backup.ts`, `*.old.ts` (no se typechequean con `tsc`).
- **Android**: comandos de orientación/PDF/share usan JNI y están tras
  `#[cfg(target_os = "android")]`; en desktop devuelven `Err`/`Ok(())` según caso.
- **Build**: `npm run build` = `tsc && vite build` (es estricto: `strict: true`, pero
  `noUnusedLocals/Parameters` están en `false`). Vite build tiene `minify: false`.

## Comandos
- `npm run dev` — servidor Vite (frontend) en http://localhost:1420 (usado por Tauri dev).
- `npm run build` — typecheck (`tsc`) + `vite build` → `dist/`.
- `npm run tauri` / `npm run tauri build` — construir/ejecutar el binario Tauri (Rust).
- `npm run dev:android` / `dev:android:hot` — desarrollo en Android.
- Verificación Rust: `cd src-tauri && cargo check` (o `cargo build`).
- No hay suite de tests automatizada configurada; el "test" de Supabase se hacía con un
  `#[cfg(test)] mod tests` temporal en `supabase_sql.rs` (ya removido).

## Tareas frecuentes (plantilla)
- **Agregar un campo a una tabla**: editar `CREATE TABLE` en `db.rs::init_database` y en el DDL
  de `ensureSchema` (Supabase); si la columna puede faltar en BDs existentes, añadir un
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en `migrate_add_columns` (db.rs) y en los "fixes"
  de `ensureSchema`.
- **Agregar un comando Rust**: función `#[tauri::command]` + registrar en `generate_handler!`
  (lib.rs) + llamarlo con `invoke(...)` desde el frontend.
- **Agregar tabla sincronizable a la nube**: crearla en ambos schemas, añadirla a
  `get_all_local_data_json` (lib.rs) y a los maps de tablas base en `syncService.supabase.ts`,
  y decidir su estrategia de pending deletions.
- **Cambiar proveedor de sync por defecto**: `setActiveProvider()` / clave `sync_provider` en
  localStorage (`syncService.ts`).

## Notas de estado reciente (contexto)
- El proyecto Supabase de ejemplo es `qtbmvoutxdiarcbxrest` (GCP). El host directo
  `db.<ref>.supabase.co` es IPv6-only y el sandbox no resuelve pooler GCP, por lo que la
  verificación end-to-end del DDL debe hacerse en la máquina del usuario.
- `ensureSchema` corre sus "fixes" (add user_id + DISABLE RLS) en cada arranque (primer sync),
  de forma idempotente, para reparar esquemas ya creados.
