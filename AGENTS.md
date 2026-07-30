# AGENTS.md — School Tracker Pro

Guía para agentes (IA) que trabajen en este repositorio. Describe la arquitectura,
convenciones, comandos y los "tropezones" frecuentes.

## Qué es
Aplicación de escritorio/móvil (**Tauri 2 + Svelte 5**) para gestión escolar: años
lectivos, colegios, grados, secciones, asignaturas, estudiantes, evaluaciones
(indicadores/criterios/notas), asistencia e informes/PDF. Datos locales en **SQLite**
y sincronización en la nube mediante **Google Drive** (archivo completo `school.db`).

Idioma del código y comentarios: **español**. Mantener así.

## Stack
- **Frontend**: Svelte 5 (runes: `$state`, `$derived`, `$effect`), TypeScript, Vite 7.
- **Backend/Shell**: Tauri 2 (Rust). Ventana principal `main` (maximizada en desktop).
- **DB local**: SQLite vía `rusqlite` (features `bundled`), archivo `school.db` en el
  `app_data_dir` de Tauri (o subdirectorio según `SCHOOLTRACKER_PROFILE`).
- **Nube**: Google Drive OAuth (servidor local en Rust). Carga/descarga del archivo
  `SchoolTracker_Sync.db` completo (multipart upload, base64).
- **Otros**: `jspdf` + `jspdf-autotable` (PDF), `xlsx`.
- **Rust deps clave**: `rusqlite`, `futures`, `tokio`,
  `tauri-plugin-{fs,dialog,opener}`, `jni`/`ndk-context` (Android).

## Estructura
```
package.json                 scripts npm (dev, build, tauri, dev:android)
vite.config.ts               puerto dev 1420; plugin svelte + top-level-await
svelte.config.js             Svelte 5 (componentApi: 4 compat)
tsconfig.json                target ES2015, strict; EXCLUYE *.supabase.ts, *.backup.ts,
                              *.old.ts, tursoClient.ts, tursoSyncService.ts, supabase.ts,
                              syncService.supabase.ts, realtimeService*.ts, SyncStatus.svelte
.env                         (VITE_SUPABASE_*, VITE_TURSO_* ya no se usan)
src/
  main.ts                    bootstrap; ventana 'google-login' maneja OAuth
  App.svelte                 shell: sidebar + tabs (notas, reportes, estudiantes,
                              evaluaciones, globales, asistencia, informe, cloud, ajustes)
  App.css
  svelte/                    páginas UI (*Page.svelte) y componentes reutilizables
  lib/
    driveSyncService.ts      ÚNICO servicio de sync: pushAll/pullAll sube/baja el
                              archivo school.db completo desde/a Google Drive.
                              Contiene SyncManager (estado: status, lastUpload, lastDownload,
                              lastSync, message) con subscribe().
    syncService.ts           Delegado simple de driveSyncService (exporta syncService,
                              syncManager, type SyncStatus). También exporta forcePullAsistencia
                              y forcePullNotas que llaman a pullAllSilent().
    dirtyTracker.ts          marcas de tablas "sucias" para saber qué ha cambiado
    googleDriveBackupService.ts
    cloud/config.ts, dateUtils.ts
    autoSync.ts              helper onDataChange(table) para marcar dirty
  (Los siguientes archivos se mantienen en disco como referencia pero NO se importan
   ni typecheckean: tursoClient.ts, tursoSyncService.ts, supabase.ts,
   syncService.supabase.ts, supabase.backup.ts, realtimeService.ts,
   realtimeService.supabase.ts)
src-tauri/
  Cargo.toml                 deps Rust (ver stack)
  tauri.conf.json            productName, identifier com.keimer.schooltrackerpro, ventana,
                            plugins fs, bundle targets "all"
  src/
    main.rs                  entrypoint -> llama run()
    lib.rs                   #![tauri::command]s (CRUD, backup, etc.)
                              y run() con generate_handler! (REGISTRO de comandos)
    db.rs                    SCHEMA SQLite (init_database), migraciones, semillas,
                              macros de CRUD, comandos de borrado en cascada + pending deletions
src-tauri/gen/               generado (ignorar; no editar a mano)
```

## Arquitectura de datos
1. **Local (fuente de verdad offline)**: SQLite en Rust. El frontend llama a comandos
   Rust con `invoke('nombre_comando', { args })` (`@tauri-apps/api/core`).
   Ej. `get_students`, `add_student`, `save_notas_estudiantes`, `get_pending_deletions`.
2. **Google Drive (sync)**: `driveSyncService.ts` implementa pushAll/pullAll.
   - **pushAll**: respaldo local → subida multipart a Drive como `SchoolTracker_Sync.db`
   - **pullAll**: descarga desde Drive → safety backup → reemplaza DB local → emite eventos
3. **Pending deletions**: los borrados locales se registran en tablas
   `sync_pending_deletions` (simple, columna `tabla`/`registro_id`) y
   `sync_pending_deletions_asistencia`, `_nota`, `_grado_asignatura`,
   `_colegio_asignatura` (claves compuestas). Al borrar en `db.rs`,
   SIEMPRE insertar en la tabla de pending correspondiente dentro de la
   misma transacción.

## Convenciones y GOTCHAS (leer antes de editar)
- **Nuevos comandos Rust**: definir `#[tauri::command]` en `lib.rs` o `db.rs` y
  **registrarlos en `generate_handler![...]` dentro de `run()` (lib.rs)**. Si no se
  registran, `invoke` falla en runtime (no en compile).
- **Cambios de schema**: reflejar SOLO en `src-tauri/src/db.rs` → `init_database`.
  (No hay schema remoto que mantener).
- **Svelte 5 runes**: estado con `$state`, efectos con `$effect`. No usar stores globales
  salvo que sea necesario.
- **tsconfig** excluye `*.supabase.ts`, `*.backup.ts`, `*.old.ts`,
  `tursoClient.ts`, `tursoSyncService.ts`, `supabase.ts`, `syncService.supabase.ts`,
  `realtimeService.ts`, `realtimeService.supabase.ts`, `SyncStatus.svelte`.
- **Android**: comandos de orientación/PDF/share usan JNI y están tras
  `#[cfg(target_os = "android")]`; en desktop devuelven `Err`/`Ok(())` según caso.
- **Build**: `npm run build` = `tsc && vite build` (estricto: `strict: true`, pero
  `noUnusedLocals/Parameters` están en `false`). Vite build tiene `minify: false`.
- **Google Drive OAuth**: tokens guardados en `localStorage['schooltracker-google-drive-settings']`.
  El servidor OAuth local se ejecuta en Rust (ventana `google-login`).
- **Sync periódico**: configurable en ajustes (segundos). Lo maneja
  `driveSyncService.ensurePeriodicSync()`. Intervalo guardado en
  `localStorage['periodic_sync_interval_seconds']`.
- **dirtyTracker**: la clave en localStorage se llama `turso_dirty_tables` (nombre
  histórico, no cambiar para no romper datos existentes). Función: marcar tablas
  modificadas para saber si hay cambios pendientes de subir.

### Archivos de referencia (no tocar)

Los siguientes archivos se conservan en disco como referencia histórica pero NO deben
ser modificados ni importados. Están excluidos del typecheck en `tsconfig.json`:

- `src/lib/tursoClient.ts` — cliente libSQL (antes usado con Turso)
- `src/lib/tursoSyncService.ts` — implementación Turso del sync
- `src/lib/supabase.ts` — cliente Supabase anon
- `src/lib/syncService.supabase.ts` — implementación Supabase del sync
- `src/lib/supabase.backup.ts` — respaldo
- `src/lib/realtimeService.ts` / `src/lib/realtimeService.supabase.ts` — realtime
- `src/svelte/SyncStatus.svelte` — componente de estado de sync (sin usar)

## Comandos
- `npm run dev` — servidor Vite (frontend) en http://localhost:1420 (usado por Tauri dev).
- `npm run build` — typecheck (`tsc`) + `vite build` → `dist/`.
- `npm run tauri` / `npm run tauri build` — construir/ejecutar el binario Tauri (Rust).
- `npm run dev:android` / `dev:android:hot` — desarrollo en Android.
- Verificación Rust: `cd src-tauri && cargo check` (o `cargo build`).

## Tareas frecuentes (plantilla)
- **Agregar un campo a una tabla**: editar `CREATE TABLE` en `db.rs::init_database`.
  Si la columna puede faltar en bases existentes, añadir un `ALTER TABLE ... ADD COLUMN
  IF NOT EXISTS` en `migrate_add_columns` (db.rs).
- **Agregar un comando Rust**: función `#[tauri::command]` + registrar en `generate_handler!`
  (lib.rs) + llamarlo con `invoke(...)` desde el frontend.
- **Agregar tabla sincronizable**: crearla en `db.rs` (schema SQLite), y si debe
  participar en sync (pending deletions), definir su estrategia en `db.rs`.

## Estilo UI (Apple-style Glassmorphism)
Toda la interfaz debe seguir un diseño **glassmorphism minimalista tipo Apple**:

- **Cards/containers**: `background: rgba(255,255,255,0.02)`, `backdrop-filter: blur(20px)`,
  `border: 1px solid rgba(255,255,255,0.06)`, `border-radius: 16-18px`.
- **Elementos listados** (rows, items): `background: rgba(255,255,255,0.02)`,
  `backdrop-filter: blur(10px)`, `border: 1px solid rgba(255,255,255,0.06)`,
  `border-radius: 12px`. Hover: `borderColor` → color acento, `background` ligeramente más claro.
- **Botones primarios**: `background: linear-gradient(135deg, ...)` con `box-shadow` suave,
  efecto `translateY(-1px)` en hover y `translateY(1px)` en mousedown.
- **Botones de acción secundarios** (editar, eliminar, configurar): fondo semitransparente
  `rgba(color, 0.1)`, `border: 1px solid rgba(color, 0.2)`, hover: `rgba(color, 0.2)`.
- **Modales**: overlay con `backdrop-filter: blur(8px)`, contenido con
  `background: rgba(20,24,31,0.85)`, `backdrop-filter: blur(24px)`,
  `border-radius: 20px`, `box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6)`.
- **Inputs**: `background: rgba(255,255,255,0.06)`, `border: 1px solid rgba(255,255,255,0.1)`,
  `border-radius: 8px`, focus: `borderColor` → color acento.
- **Etiquetas/labels**: mayúsculas, `letter-spacing: 0.5px`, color `#64748b`, tamaño `0.65rem`.
- **Barras de acento**: líneas verticales de 3-4px con el color temático (`border-radius: 2px`).
- **Transiciones**: `transition: all 0.2s ease` en elementos interactivos.
- **Sin sombras fuertes** ni bordes gruesos; priorizar sutileza y claridad visual.

## Flujo de sincronización con Google Drive

### Visión general

La sincronización es **Local-First y basada en archivo completo**: los cambios se
escriben primero en SQLite (Rust), luego se **sube el archivo entero** a Google Drive.

```
Frontend (Svelte)
   ↓ invoke('comando_rust')
SQLite (local, fuente de verdad)
   ↓ driveSyncService.pushAll() / pullAll()
Google Drive (SchoolTracker_Sync.db)
```

### pushAll (subida)

1. Obtener token OAuth de `localStorage['schooltracker-google-drive-settings']`
2. Leer el archivo `school.db` local (Rust `get_db_path`)
3. Subir a Drive como `SchoolTracker_Sync.db`:
   - Buscar archivo existente por nombre en Drive
   - Si existe → multipart update (PATCH)
   - Si no existe → multipart create (POST)
4. Actualizar `syncManager` estado: `lastUpload`, `lastSync`
5. Emitir evento `sync-completed`

### pullAll (descarga)

1. Obtener token OAuth
2. Buscar `SchoolTracker_Sync.db` en Drive por nombre
3. Si no existe → abortar (no hay datos remotos)
4. Descargar contenido (base64 → ArrayBuffer)
5. Hacer **safety backup** del `school.db` local antes de sobrescribir
6. Reemplazar `school.db` local con el contenido descargado
7. Actualizar `syncManager` estado: `lastDownload`, `lastSync`
8. Emitir eventos `sync-completed`, `data-updated`

### Periodic sync

`driveSyncService.ensurePeriodicSync()` inicia un `setInterval` que llama a
`syncAllSilent()` cada N segundos. El intervalo se guarda en
`localStorage['periodic_sync_interval_seconds']`.

### SyncManager

Objeto singleton en `driveSyncService` con estado reactivo:
```ts
syncManager.subscribe((state) => { ... })
// state: { status, lastUpload, lastDownload, lastSync, message }
```

## Esquema de Base de Datos y Datos Iniciales

### Inicialización

La BD se crea en `app_data_dir/school.db` al arrancar la app vía `init_database()` en
`lib.rs:setup`. Es **idempotente** (`CREATE TABLE IF NOT EXISTS`). Los datos iniciales
se siembran bajo demanda desde el frontend (`seed_defaults_now`) después de verificar
si hay datos existentes (evita duplicar defaults).

### Tablas creadas en `init_database` (`src-tauri/src/db.rs:61`)

| Tabla | PK | Columnas clave | Notas |
|-------|----|----------------|-------|
| `ano_lectivo` | `id` (INTEGER PK AUTOINCREMENT) | `nombre TEXT UNIQUE`, `activo INTEGER DEFAULT 0`, `cualitativo INTEGER DEFAULT 0`, `updated_at TEXT` | |
| `corte_evaluativo` | `id` | `nombre TEXT UNIQUE`, `activo INTEGER`, `cualitativo INTEGER`, `updated_at TEXT` | |
| `colegio` | `id` | `nombre TEXT UNIQUE`, `activo INTEGER`, `cualitativo INTEGER`, `orden INTEGER`, `updated_at TEXT` | |
| `asignatura` | `id` | `nombre TEXT UNIQUE`, `cualitativo INTEGER`, `updated_at TEXT` | |
| `grado` | `id` | `nombre TEXT UNIQUE`, `cualitativo INTEGER`, `updated_at TEXT` | |
| `seccion` | `id` | `nombre TEXT UNIQUE`, `cualitativo INTEGER`, `updated_at TEXT` | |
| `estudiante` | `id` | `nombre TEXT`, `codigo TEXT UNIQUE`, `sexo TEXT CHECK(M\|F)`, `ano_lectivo_id`, `grado_id`, `seccion_id`, `colegio_id`, `telefono`, `direccion`, `email`, `foto`, `updated_at TEXT` | FKs a las tablas de catálogo |
| `configuracion_calificacion` | `id` (TEXT PK) | `nombre TEXT`, `color TEXT`, `minimo INTEGER`, `updated_at TEXT` | |
| `multiplicador_calificacion` | `id` (TEXT PK) | `multiplicador REAL NOT NULL DEFAULT 1.0`, `updated_at TEXT` | |
| `grado_asignatura` | `(grado_id, asignatura_id)` | `updated_at TEXT` | FK CASCADE |
| `colegio_asignatura` | `(colegio_id, asignatura_id)` | `updated_at TEXT` | FK CASCADE |
| `indicador` | `id` | `grado_id`, `asignatura_id`, `corte_evaluativo_id`, `orden`, `descripcion TEXT DEFAULT ''`, `activo INTEGER DEFAULT 1`, `updated_at TEXT` | |
| `criterio` | `id` | `indicador_id`, `orden`, `descripcion TEXT DEFAULT ''`, `puntaje_maximo INTEGER`, `updated_at TEXT` | FK CASCADE sobre indicador |
| `asistencia` | `id` | `estudiante_id`, `fecha TEXT`, `estado TEXT CHECK(P\|A\|J)`, `observacion TEXT`, `updated_at TEXT` | `UNIQUE(estudiante_id, fecha)` |
| `colegio_dias_asistencia` | `colegio_id` | `lunes..domingo INTEGER DEFAULT 1`, `updated_at TEXT` | |
| `nota` | `(estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)` | `valor REAL`, `updated_at TEXT` | PK compuesta |
| `configuracion_calificacion` | `id` (TEXT PK) | `nombre TEXT`, `color TEXT`, `minimo INTEGER` | |
| `sync_pending_deletions` | `id` | `tabla TEXT`, `registro_id INTEGER`, `fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | |
| `sync_pending_deletions_asistencia` | `id` | `estudiante_id`, `fecha TEXT`, `fecha_intento` | |
| `sync_pending_deletions_nota` | `id` | `estudiante_id`, `criterio_id`, `corte_evaluativo_id`, `asignatura_id`, `fecha_intento` | |
| `sync_pending_deletions_grado_asignatura` | `id` | `grado_id`, `asignatura_id`, `fecha_intento` | |
| `sync_pending_deletions_colegio_asignatura` | `id` | `colegio_id`, `asignatura_id`, `fecha_intento` | |

### Datos semilla (`seed_default_data` en `db.rs:396`)

Solo se siembran si `SELECT COUNT(*) FROM ano_lectivo` es 0 (BD vacía).

| Tabla | Datos insertados |
|-------|-----------------|
| `ano_lectivo` | `2026`, `2027`, `2028` |
| `corte_evaluativo` | `1er corte evaluativo`, `2do corte evaluativo`, `3er corte evaluativo`, `4to corte evaluativo` |
| `colegio` | `Candelario Sotelo` (orden 1), `Manuel Ignacio Pereira Quintana` (orden 2) |
| `asignatura` | Cuantitativas: `Ingles`, `Matematicas`, `Fisica`, `Biologia`, `Ciencias Naturales`, `Ciencias Sociales`. Cualitativas: `TAC`, `AEP`, `Convivencia & Civismo`, `Creciendo en Valores`, `Derecho & Dignidad de la Mujer`, `Educación Física` |
| `grado` | `1er grado` a `11mo grado`. 1er y 2do grado son cualitativos (`cualitativo=1`). |
| `seccion` | `A`, `B`, `C`, `D` |
| `grado_asignatura` | Todas las asignaturas × todos los grados (CROSS JOIN) |
| `colegio_asignatura` | Todas las asignaturas × todos los colegios (CROSS JOIN) |
| `configuracion_calificacion` | `AA` (#22c55e, min 90), `AS` (#3b82f6, min 70), `AF` (#eab308, min 50), `AI` (#ef4444, min 0) |
| `multiplicador_calificacion` | `AA` (1.0), `AS` (0.85), `AF` (0.65), `AI` (0.40) — mismo `id` que `configuracion_calificacion` |

### Migraciones (columnas agregadas post-creación)

En `migrate_add_columns` (`db.rs:299`):
- `configuracion_calificacion.minimo INTEGER DEFAULT 0` (si no existe)
- `configuracion_calificacion.nombre TEXT DEFAULT ''` (si no existe) + backfill nombres para ids viejos (`destacado`→`AA` etc.)
- `colegio.activo INTEGER DEFAULT 0` (si no existe)
- `multiplicador_calificacion` relleno con valores por defecto (AA=1.0, AS=0.85, AF=0.65, AI=0.40) si la tabla está vacía (siembra retroactiva para bases existentes)
- `updated_at TEXT DEFAULT (datetime('now'))` en las 16 tablas sincronizables (si no existe)

### Flujo de llamada

1. `lib.rs:setup` → `init_database()` (crea tablas + migraciones)
2. Frontend (`App.svelte` `onMount`): llama `invoke("seed_defaults_now")` →
   `seed_default_data()` si BD vacía.
