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
   - La creación de tablas intenta en orden: (1) conexión **directa a Postgres** vía Rust
      (`supabase_execute_sql`) con fallback a **connection pooler** por región,
      (2) **RPC `exec_sql`** vía PostgREST (requiere crear la función `exec_sql` una vez
      en SQL Editor), (3) devuelve el script DDL para pegar manualmente.
      Requiere la **DB password** para la opción (1); para (2) solo anon key.
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
- **Pooler hostname Supabase**: El formato correcto NO es `${ref}.pooler.supabase.com`
  (no existe para proyectos recientes). Usar `aws-<region>.pooler.supabase.com` con
  usuario `postgres.<projectRef>`. Ver `getSupabaseConnStrings` en `syncService.supabase.ts`.
- **onConflict sin user_id**: Las PK/UNIQUE de las tablas en Supabase NO incluyen
  `user_id`. Todos los `onConflict` en `upsert()` deben usar solo la PK real, sin
  `user_id`. Ej: `onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id'`
  (no incluir `user_id` al final). Si se incluye, PostgREST lanza `42P10`.
- **activo/cualitativo como INTEGER**: En Postgres son columnas `INTEGER`, pero desde
  Svelte/JS pueden llegar como booleano `true/false`. Siempre envolver con `Number()`
  antes de enviar en upsert: `activo: Number(item.activo)`. Si no, Postgres lanza
  `22P02 invalid input syntax for type integer: "true"`.
- **configuracion_calificacion**: Es la única tabla que NO tiene columna `user_id`.
  Por lo tanto, en `pullAll` no se filtra por `user_id`, y en los upserts de `syncGradeConfig`
  y `syncAll` no se incluye `user_id` en el payload.
- **Diagnóstico remoto (`diagnoseRemote`)**: Función que recorre las 15 tablas vía
  PostgREST y muestra ✅/❌ con conteo de registros. Se llama al inicio de `syncAll`.
- **Error logging (`logPgError`)**: Helper que imprime `code`, `message`, `details`,
  `hint` del error de PostgREST. Usar en todos los catch/error handlers en vez de
  `console.error("msg:", error)`.

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

## Setup de Supabase (para usuarios nuevos)

Hay dos formas de configurar Supabase. La **opción A (recomendada)** requiere un solo
paso manual y luego la app crea/migra todo automáticamente. La **opción B** es el método
manual completo.

---

### Opción A: Crear función `exec_sql` (recomendada)

Con solo crear la función `exec_sql` una vez en SQL Editor, la app puede crear y migrar
todas las tablas automáticamente usando solo la anon key (sin DB password).

1. Ve a [Supabase Dashboard](https://supabase.com) → tu proyecto → **SQL Editor**.
2. Crea una **New query**.
3. Pega esto y ejecútalo (▶️ Run):

```sql
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

4. En tu app, ve a **Ajustes → Nube**, selecciona **Supabase**, y pega:
   - **URL**: `https://<tu-project-ref>.supabase.co`
   - **Anon Key**: Settings → API → anon public
   - **DB Password** (opcional, solo si quieres conexión directa alternativa)

5. En la app, presiona **Sincronizar**. Si faltan tablas, la app las creará automáticamente
   vía `supabase.rpc('exec_sql', ...)`.

> **Importante**: Si ya ejecutaste el script DDL manual antes, la app detecta que las tablas
> existen y omite la creación. La función `exec_sql` solo se necesita para proyectos nuevos
> o cuando haya que agregar columnas automáticamente.

---

### Opción B: Crear tablas manualmente (script DDL completo)

Si prefieres crear todo manualmente o no puedes crear la función `exec_sql`:

1. Ve a **SQL Editor** → **New query**.
2. Pega el script completo de abajo y ejecútalo.
3. En la app, configura URL + Anon Key igual que en la opción A.
4. Sincroniza.

#### Script DDL completo

```sql
CREATE TABLE IF NOT EXISTS ano_lectivo (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS corte_evaluativo (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS colegio (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS asignatura (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS grado (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS seccion (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS estudiante (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, codigo TEXT NOT NULL, sexo TEXT NOT NULL, ano_lectivo_id INTEGER NOT NULL, grado_id INTEGER NOT NULL, seccion_id INTEGER NOT NULL, colegio_id INTEGER NOT NULL, telefono TEXT, direccion TEXT, email TEXT, foto TEXT, user_id TEXT);
CREATE TABLE IF NOT EXISTS configuracion_calificacion (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, color TEXT NOT NULL, minimo INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grado_asignatura (grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, user_id TEXT, PRIMARY KEY (grado_id, asignatura_id));
CREATE TABLE IF NOT EXISTS colegio_asignatura (colegio_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, user_id TEXT, PRIMARY KEY (colegio_id, asignatura_id));
CREATE TABLE IF NOT EXISTS indicador (id SERIAL PRIMARY KEY, grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, corte_evaluativo_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', activo INTEGER DEFAULT 1, user_id TEXT);
CREATE TABLE IF NOT EXISTS criterio (id SERIAL PRIMARY KEY, indicador_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', puntaje_maximo INTEGER NOT NULL, user_id TEXT);
CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (colegio_id INTEGER PRIMARY KEY, lunes INTEGER DEFAULT 1, martes INTEGER DEFAULT 1, miercoles INTEGER DEFAULT 1, jueves INTEGER DEFAULT 1, viernes INTEGER DEFAULT 1, sabado INTEGER DEFAULT 1, domingo INTEGER DEFAULT 1, user_id TEXT);
CREATE TABLE IF NOT EXISTS asistencia (id SERIAL PRIMARY KEY, estudiante_id INTEGER NOT NULL, fecha TEXT NOT NULL, estado TEXT NOT NULL, observacion TEXT, user_id TEXT, UNIQUE(estudiante_id, fecha));
CREATE TABLE IF NOT EXISTS nota (estudiante_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, valor DOUBLE PRECISION NOT NULL, corte_evaluativo_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, user_id TEXT, PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id));
CREATE TABLE IF NOT EXISTS sync_deletions (id SERIAL PRIMARY KEY, table_name TEXT NOT NULL, record_id INTEGER NOT NULL, deleted_at TEXT DEFAULT now()::text, user_id TEXT);
CREATE TABLE IF NOT EXISTS sync_batch (id SERIAL PRIMARY KEY, table_name TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL, user_id TEXT, created_at TEXT DEFAULT now()::text);
ALTER TABLE grado ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE seccion ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE criterio ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE grado_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE colegio_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE colegio_dias_asistencia ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE ano_lectivo DISABLE ROW LEVEL SECURITY;
ALTER TABLE corte_evaluativo DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio DISABLE ROW LEVEL SECURITY;
ALTER TABLE asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE grado DISABLE ROW LEVEL SECURITY;
ALTER TABLE seccion DISABLE ROW LEVEL SECURITY;
ALTER TABLE estudiante DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_calificacion DISABLE ROW LEVEL SECURITY;
ALTER TABLE grado_asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio_asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE indicador DISABLE ROW LEVEL SECURITY;
ALTER TABLE criterio DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio_dias_asistencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE asistencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE nota DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_deletions DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_batch DISABLE ROW LEVEL SECURITY;
```

> Si ya ejecutaste este script antes y luego agregas nuevas tablas/columnas,
> los `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
> son seguros de re-ejecutar (idempotentes).

---

### Notas de estado reciente (contexto)
- El proyecto Supabase de ejemplo es `qtbmvoutxdiarcbxrest` (GCP). El host directo
  `db.<ref>.supabase.co` es IPv6-only, y los poolers regionales pueden no resolver
  en todas las redes. Por eso se recomienda la creación de `exec_sql` o el script DDL
  manual vía SQL Editor.
- `ensureSchema` intenta crear tablas en este orden:
  1. **Conexión directa Postgres** vía Rust (`supabase_execute_sql`) con pooler fallback.
     Requiere DB password. Puede fallar si IPv6 no está disponible o el pooler no reconoce
     el tenant.
  2. **RPC `exec_sql`** vía PostgREST (solo anon key). Requiere que la función exista en
     el proyecto. Es el método recomendado porque solo necesita la URL y anon key.
  3. Si ambos fallan, devuelve el script DDL completo para pegar manualmente en SQL Editor.
