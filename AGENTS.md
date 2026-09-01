# AGENTS.md — School Tracker Pro

Guía para agentes (IA) que trabajen en este repositorio. Describe la arquitectura,
convenciones, comandos y los "tropezones" frecuentes.

## Qué es
Aplicación de escritorio/móvil (**Tauri 2 + Svelte 5**) para gestión escolar: años
lectivos, colegios, grados, secciones, asignaturas, estudiantes, evaluaciones
(indicadores/criterios/notas), asistencia e informes/PDF. Datos locales en **SQLite**
y sincronización en la nube mediante **Google Drive** (archivo por cuenta
`school_<email>.db`) y **Cloudflare D1** (sync bilateral en tiempo real).

Cada cuenta de Google tiene su propio archivo SQLite local (ver sección
"Cambio de cuentas / per-account DBs"). Al cambiar de cuenta se abre el
archivo correspondiente; no se borran datos.

Idioma del código y comentarios: **español**. Mantener así.

## Stack
- **Frontend**: Svelte 5 (runes: `$state`, `$derived`, `$effect`), TypeScript, Vite 7.
- **Backend/Shell**: Tauri 2 (Rust). Ventana principal `main` (maximizada en desktop).
- **DB local**: SQLite vía `rusqlite` (features `bundled`), archivo `school.db` en el
  `app_data_dir` de Tauri (o subdirectorio según `SCHOOLTRACKER_PROFILE`).
- **Nube**: Google Drive OAuth (servidor local en Rust). Carga/descarga del archivo
  `SchoolTracker_Sync.db` completo (multipart upload, base64). Filename is
  per-account: `SchoolTracker_Sync_<email>_<platform>_<timestamp>.db`.
- **Otros**: `jspdf` + `jspdf-autotable` (PDF), `xlsx`.
- **Rust deps clave**: `rusqlite`, `futures`, `tokio`,
  `tauri-plugin-{fs,dialog,opener}`, `jni`/`ndk-context` (Android).

## Estructura
```
package.json                 scripts npm (dev, build, tauri, dev:android, dev:win)
vite.config.ts               puertos por env (VITE_PORT/HMR_PORT; default 1420/1421);
                             plugin svelte + top-level-await
svelte.config.js             Svelte 5 (componentApi: 4 compat)
tsconfig.json                target ES2015, strict; excluye solo src/svelte/GoogleDriveBackup.svelte
.env                         solo variables de Google Drive (VITE_GOOGLE_CLIENT_ID/SECRET)
src/
  main.ts                    bootstrap; ventana 'google-login' maneja OAuth
  App.svelte                 shell: sidebar + tabs (dashboard, asistencia [sub-tabs
                              tomar/informe], notas [sub-tabs registrar/reportes],
                              evaluaciones, estudiantes, globales, ajustes, cloud)
                             Páginas fusionadas: ver svelte/asistencia/ y svelte/notas/
  App.css
  svelte/                    páginas UI (*Page.svelte) y componentes reutilizables
    asistencia/              AsistenciaMainPage.svelte (wrapper sub-tabs: AsistenciaPage + InformePage)
    notas/                   NotasMainPage.svelte (wrapper sub-tabs: NotasPage + ReportesPage)
    CloudCards.svelte        cards Nube D1 / Respaldo Drive (drawer móvil + header desktop)
  lib/
    driveSyncService.ts      Respaldo por ARCHIVO COMPLETO school.db en Google Drive.
                             SyncManager (status, lastUpload/Download, lastSync,
                             downloadProgress) con subscribe(). Carpeta destino:
                             Keimer Labs/School Tracker MINED (máx 3 respaldos,
                             nombre incluye _Windows/_Android + tag de cuenta).
                             Auto-respaldo cada N min (drive_auto_backup_minutes,
                             default 180). Filename por cuenta:SchoolTracker_Sync_<tag>_<platform>_<ts>.db
    d1SyncService.ts         SYNC BILATERAL Cloudflare D1 (ver sección dedicada).
                             Dual-cursor: last_sync=servidor(pull), last_push_sync=
                             local(push). emitUpdates() dispara refrescos de páginas.
    wsSyncService.ts         Push tiempo real: WebSocket al Worker (hub por school
                             key). Auto-arranque 1.2s, backoff 1s→30s, ping 25s.
                             Debug: window.__wsDebug(). Prefijo logs [WsSync-Debug].
    syncService.ts           Delegador: enruta a d1SyncService si D1 configurado;
                             Drive queda como respaldo. invalidateD1Cache().
    dirtyTracker.ts          marcas de tablas "sucias" para saber qué ha cambiado
    googleDriveBackupService.ts
    dateUtils.ts
    autoSync.ts              helper onDataChange(table,{immediate}) → flush → syncAllSilent
src-tauri/
  Cargo.toml                 deps Rust (ver stack)
  tauri.conf.json            productName, identifier com.keimer.schooltracker, ventana,
  tauri.android.conf.json    override auto-fusionado en comandos Android:
                             devUrl http://localhost:1422 (sesión dev independiente)
                            plugins fs, bundle targets "all"
  src/
    main.rs                  entrypoint -> llama run()
    lib.rs                   #![tauri::command]s (CRUD, backup, etc.)
                               y run() con generate_handler! (REGISTRO de comandos)
                               open_account_db, get_db_path, etc.
    db.rs                    SCHEMA SQLite (init_database), migraciones, semillas,
                               macros de CRUD, comandos de borrado en cascada + pending deletions
                               + helpers per-account: sanitize_account_id, account_db_path,
                               read/write_active_account, resolve_active_db_path
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
- **tsconfig** excluye únicamente `src/svelte/GoogleDriveBackup.svelte` (componente legacy de Drive).
- **Android**: comandos de orientación/PDF/share usan JNI y están tras
  `#[cfg(target_os = "android")]`; en desktop devuelven `Err`/`Ok(())` según caso.
- **Build**: `npm run build` = `tsc && vite build` (estricto: `strict: true`, pero
  `noUnusedLocals/Parameters` están en `false`). Vite build tiene `minify: false`.
- **Google Drive OAuth**: tokens guardados en `localStorage['schooltracker-google-drive-settings']`.
  El servidor OAuth local se ejecuta en Rust (ventana `google-login`).
- **Sync periódico**: configurable en ajustes (segundos). Lo maneja
  `driveSyncService.ensurePeriodicSync()`. Intervalo guardado en
  `localStorage['periodic_sync_interval_seconds']`.
- **dirtyTracker**: la clave en localStorage es `stp_dirty_tables`. En `dirtyTracker.ts`
  hay una migración que renombra la clave histórica `turso_dirty_tables` una sola vez
  para no perder marcas pendientes. Función: marcar tablas modificadas para saber si
  hay cambios pendientes de subir.
- **Per-account DBs**: cada cuenta de Google tiene su propio archivo SQLite
  (`school_<email>.db`). El archivo activo se controla via `active_account.txt`
  y helpers `db::read_active_account` / `db::write_active_account`. NO usar
  `Connection::open("school.db")` directamente; usar `resolve_active_db_path()`.

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

## Regla de modales unificados
Cuando una entidad (ej. Colegio, Grado) tenga **múltiples acciones de configuración**
(editar nombre, asignar días, asignar asignaturas, cambiar tipo, etc.), se usa **UN
solo botón ⚙️** que abre un **modal unificado** con todas las opciones organizadas en
secciones o segmented controls (tabs). **NO crear botones separados** por cada acción
(✎ editar, 📅 días, 📚 asignaturas, 🛠️ config). Ejemplo:
- Colegio → un solo ⚙️ → modal con: editar nombre + segmented control (🏫 Tipo /
  📅 Días / 📚 Asignaturas).
- Grado → un solo ⚙️ → modal con: editar nombre + 📚 Asignaturas.

Esto mantiene la UI limpia y consistente. La excepción son entidades con una sola
acción (como Sección: solo editar/eliminar).

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

### Acentos por categoría (2026-08)

Cada sección/categoría usa un **color de acento** e **icono** único para
distinguirse visualmente. Este patrón se aplica en `GlobalesPage` y `AjustesPage`.

**Paleta Pastel Suave (estándar):**

| Categoría | Color | Icono |
|-----------|-------|-------|
| Notas | `#fbbf24` | ⭐ |
| Año Lectivo | `#818cf8` | 📅 |
| Corte Evaluativo | `#f472b6` | ✂️ |
| Asignatura | `#60a5fa` | 📚 |
| Colegio | `#34d399` | 🏫 |
| Grado | `#fb923c` | 📊 |
| Sección | `#a78bfa` | 👥 |
| Configuración | `#60a5fa` | ⚙️ |
| Notificaciones | `#fbbf24` | 🔔 |
| Almacenamiento | `#34d399` | 📦 |
| Debug | `#ef4444` | 🐛 |
| Info | `#a78bfa` | 📖 |

**Componente `CategoryTabContent` (GlobalesPage):**
- Props: `accentColor: string`, `accentIcon: string`
- Header: `border-left: 3px solid {accentColor}` + icono circular `{accentColor}18` bg
- Botón "Agregar": gradiente `{accentColor}` → `{accentColor}dd`
- Hover: borde → `{accentColor}44`, sombra → `{accentColor}22`

**Mobile cards (GlobalesPage/AjustesPage):**
```html
<button style="border-left: 3px solid {color}; ...">
  <div class="icon-circle" style="background: {color}18">{icon}</div>
  <span class="title">{label}</span>
  <span class="chevron">›</span>
</button>
```

**Desktop grid (GlobalesPage):**
- Grid 3 columnas fijo (`repeat(3, 1fr)`)
- Responsive: 2 cols ≤1100px, 1 col ≤700px
- Cada `CategoryTabContent` recibe `accentColor` y `accentIcon`

**Regla**: Al crear una nueva página con secciones/categorías, usar siempre
el mapa de colores definido y pasar `accentColor`/`accentIcon` a los cards.

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
2. Leer el archivo activo de la cuenta (Rust `get_db_path` → `resolve_active_db_path`)
3. Subir a Drive como `SchoolTracker_Sync_<tag>_<platform>_<timestamp>.db`:
   - Usar `accountTag()` (sanitizado de `googleUserEmail`) para aislar respaldos por cuenta.
   - Si la carpeta cacheada 404 → limpiar caché, recrear carpeta, reintentar una vez.
   - Crear archivo multipart POST.
4. `deleteOldSyncVersions` mantiene máx 3 respaldos **por cuenta** (filtra por tag).
5. Actualizar `syncManager` estado: `lastUpload`, `lastSync`

### pullAll (descarga)

1. Obtener token OAuth
2. Buscar archivos `SchoolTracker_Sync_<tag>_` en Drive (solo la cuenta activa).
3. Si no existen → abortar (no hay datos remotos)
4. Descargar contenido (base64 → ArrayBuffer)
5. Hacer **safety backup** del archivo activo antes de sobrescribir
6. Reemplazar archivo activo con el contenido descargado
7. `d1_reset_device_id` tras restaurar (evita colisión de device_id)
8. Actualizar `syncManager` estado: `lastDownload`, `lastSync`
9. Emitir eventos `sync-completed`, `data-updated`

### Periodic sync

`driveSyncService.ensurePeriodicSync()` inicia un `setInterval` que llama a
`syncAllSilent()` cada N segundos. El intervalo se guarda en
`localStorage['periodic_sync_interval_seconds']`.

### SyncManager

Objeto singleton en `driveSyncService` con estado reactivo:
```ts
## Cambio de applicationId a com.keimer.schooltracker (2026-09)

El `applicationId` de Android (y el `identifier` de Tauri) pasó de
`com.keimer.schooltrackerpro` a **`com.keimer.schooltracker`**.

Archivos tocados:
- `src-tauri/tauri.conf.json` → `"identifier": "com.keimer.schooltracker"`
- `src-tauri/gen/android/app/build.gradle.kts` → `applicationId = "com.keimer.schooltracker"`

**IMPORTANTE — qué NO se cambió y por qué:**
- El `namespace` en `build.gradle.kts` sigue siendo `com.keimer.schooltrackerpro`,
  igual que los paquetes Kotlin (`src/main/java/com/keimer/schooltrackerpro/*.kt`).
  Razón: los símbolos JNI en `lib.rs` (`Java_com_keimer_schooltrackerpro_MainActivity_initNativeBridge`,
  `Java_com_keimer_schooltrackerpro_AttendanceNative_queryAttendancePending`)
  derivan del paquete Java/Kotlin de las clases, NO del applicationId.
  Renombrar el paquete Kotlin requeriría mover los archivos de `gen/android`,
  redeclarar los símbolos JNI en Rust y actualizar todas las referencias.
- El deep link scheme `schooltracker://` (OAuth callback en lib.rs) es
  independiente del applicationId; se actualizó junto con el paquete (2026-09).

**Consecuencias del cambio:**
- En el dispositivo, la app se instala como un paquete NUEVO (`com.keimer.schooltracker`):
  no actualiza sobre una instalación previa `com.keimer.schooltrackerpro`, hay que
  desinstalar la anterior manualmente.
- **GCP Console**: el cliente OAuth tipo Android debe estar registrado con el
  paquete `com.keimer.schooltracker` (además de los SHA-1 de abajo). Si solo está
  el cliente antiguo, el Sign-In nativo devolverá DEVELOPER_ERROR (statusCode 10).
- El `identifier` de Tauri también afecta rutas de datos en desktop en instalaciones
  nuevas (app data dir por identifier). No afecta las DBs per-account ya creadas
  si el directorio de datos es el mismo; verificar en caso de perder datos.


syncManager.subscribe((state) => { ... })
// state: { status, lastUpload, lastDownload, lastSync, message }
```

### OAuth de Google Drive

**IMPORTANTE (2026-08)**: En Android el flujo principal es **Google Sign-In NATIVO**
(bottom sheet de Play Services, ver sección siguiente). El flujo de navegador/TCP
descrito aquí abajo queda como flujo de **desktop** (Windows/macOS/Linux) y
respaldo histórico en Android.

**Desktop**: Google Cloud Console NO acepta schemes custom (`schooltracker://...`)
porque no tienen TLD público. El redirect URI real (web client, registrado junto a
`http://127.0.0.1:51733/callback`) es `http://localhost:51733/callback`. OAuth se
inicia desde `CloudPage.svelte` y `WelcomePage.svelte` llamando a
`invoke("gd_open_auth_webview", { url })`.

El flujo usa **doble vía de captura del código** (redundancia) + estado global en Rust
para sobrevivir recargas de página/HMR:

1. **Frontend** construye la auth URL
   (`accounts.google.com/o/oauth2/v2/auth?...redirect_uri=http://localhost:51733/callback&access_type=offline&prompt=consent`)
   y llama a `gd_open_auth_webview`.
2. **`gd_open_auth_webview`** (`lib.rs`):
   - Extrae el puerto (`extract_oauth_port_from_auth_url`) y limpia estado/cancelación.
   - Llama a `gd_start_oauth_background` (servidor TCP en `127.0.0.1:51733`).
   - **Android (solo fallback)**: abre el navegador del sistema vía `tauri-plugin-opener`
     (`app.opener().open_url(...)`) y **hace polling** de `oauth_code_state()`
     cada 200 ms (hasta ~120 s). ⚠️ Este path es NO fiable en dispositivo real:
     Android congela el proceso en background y el TCP server no responde.
   - **Desktop**: crea una ventana WebView `"google-auth"` con el
     callback `on_navigation`. Si la URL contiene `code=` lo envía por canal; si es el
     callback localhost (`is_localhost_oauth_callback`) devuelve `true` para que la
     navegación ocurra y el **servidor TCP también lo capture** (respaldo). Cierra la
     ventana al recibir el código y detecta cierre manual por el usuario → "cancelada".
3. **`gd_start_oauth_background`** (`lib.rs`): servidor TCP asíncrono arrancado una sola
   vez (flag `SERVER_STARTED: AtomicBool`, task `tokio::spawn` con `AppHandle` propio)
   → **sobrevive recargas**; si el bind falla el flag se resetea para reintentar
   (antes usaba `OnceLock` y quedaba "envenenado" para siempre). Lee el request HTTP,
   extrae `code=`, lo guarda en `oauth_code_state()`, emite el evento
   `google-auth-code` y responde HTML que redirige a `schooltracker-auth://callback?code=...`
   (scheme custom registrado en el AndroidManifest; antes apuntaba a
   `schooltracker://` que NO está registrado → el navegador nunca volvía a la app).
4. **Estado global** (OnceLock, sobrevive recargas de página):
   - `oauth_code_state()` → `Mutex<Option<String>>` con el código pendiente.
   - `oauth_cancel_flag()` → `AtomicBool` para cancelar desde el frontend.
5. **Comandos auxiliares**:
   - `gd_wait_oauth_code(timeout_secs)`: hace polling del estado (respeta cancelación).
   - `gd_has_pending_oauth_code(): bool`: para recuperar un código tras recarga de página
     (`CloudPage.onMount` lo revisa y continúa el flujo si existe).
   - `gd_cancel_oauth()`: activa el flag de cancelación y limpia el estado (botones
     "Cancelar" en ambas páginas).
6. **`gd_open_url_browser(app, url)`**: recibe `AppHandle` y en Android usa
   `tauri-plugin-opener` (plugin registrado en `run()`); en desktop usa
   `rundll32`/`open`/`xdg-open`.

### OAuth nativo en Android (flujo principal, 2026-08)

Google Sign-In clásico (`com.google.android.gms:play-services-auth:21.2.0`) con
`requestServerAuthCode(webClientId)` + scope `drive.file`. La app **nunca sale del
primer plano** → evita el congelamiento del proceso que mataba el flujo por navegador.

Cadena completa:
1. Frontend (`WelcomePage.handleDriveConnect` / `CloudPage.initGoogleAuth`) detecta
   Android → `invoke("gd_start_native_signin", { serverClientId })`.
2. Rust JNI (`obtain_native_bridge`) → `MainActivity.startGoogleSignIn(serverClientId)`
   → lanza intent de GoogleSignIn vía `googleSignInLauncher`
   (`registerForActivityResult` en `onCreate`). Antes hace `signOut()` (async;
   normalmente Google auto-selecciona la última cuenta = "Welcome back" sin picker).
3. Resultado → `handleGoogleSignInResult` → JSON `{ok, serverAuthCode, email,
   displayName, photoUrl}` o `{ok:false, cancelled, statusCode, error}`
   (statusCode 12501 = cancelado por usuario; 10 = DEVELOPER_ERROR → falta registrar
   el cliente Android con el SHA-1 en GCP).
4. **Doble entrega al frontend** (redundancia anti-recarga de WebView):
   - Evento JS: `emitGoogleAuthResult` inyecta CustomEvent `google-native-auth-result`
     en `window` (⚠️ NO usar `window.__TAURI__.event.emit` como único medio: sin
     `withGlobalTauri:true` ese global NO existe).
   - Estático Kotlin `lastNativeAuthResult` + comando Rust
     `gd_take_last_native_result` (patrón take). Las páginas hacen polling cada 1 s
     hasta 180 s como respaldo.
5. Frontend intercambia el `serverAuthCode` en `finishDriveAuth(code, "")` /
   `exchangeCode(code, "")`: POST `oauth2.googleapis.com/token` con web client id +
   secret y **SIN redirect_uri** (se omite la clave cuando viene vacío). Devuelve
   access+refresh tokens que se guardan en
   `localStorage['schooltracker-google-drive-settings']` → todo el resto de la app
   (driveSyncService, refresh, push/pull) funciona sin cambios.

Piezas clave:
- `MainActivity.kt`: `initNativeBridge()` (external, llamado en `onCreate`),
  `startGoogleSignIn`, `handleGoogleSignInResult`, `emitGoogleAuthResult`,
  `lastNativeAuthResult` (@Volatile static), `takeLastGoogleAuthResult`.
- `lib.rs`: `NATIVE_BRIDGE: Mutex<Option<(usize /*vm ptr*/, GlobalRef)>>`,
  `Java_..._MainActivity_initNativeBridge` (llenar caché),
  `obtain_native_bridge()` (cache-first; fallback ndk_context con catch_unwind),
  comandos `gd_start_native_signin`, `gd_take_last_native_result`.
- GCP Console requiere clientes OAuth tipo **Android** (paquete
  `com.keimer.schooltracker`): SHA-1 debug
  `49:50:A3:FF:0E:BB:34:AC:A9:44:45:90:F0:BB:83:54:E7:47:58:E5`, SHA-1 release keystore
  `3C:7D:22:D4:97:D0:E3:72:51:83:85:B2:12:01:45:15:30:77:0F:78`, y el SHA-1 de
  **Play App Signing** cuando se publique en la tienda (Play Console → Firma de apps).

GOTCHAS aprendidos (no repetir):
- **`ndk_context::android_context()` NO está inicializado** en este setup de Tauri 2
  (el glue nunca llama initialize) → panics "android context was not initialized".
  SIEMPRE usar el puente propio (`initNativeBridge` desde Kotlin + `NATIVE_BRIDGE`);
  envolver cualquier acceso legacy en `catch_unwind`.
- **Svelte 5**: `onMount` debe importarse estáticamente y llamarse durante la
  inicialización del componente (nada de `import("svelte").then(...)` ni awaits previos).
- Un guard tipo `if (authHandled) return` al inicio de un async + setear la flag ANTES
  de llamarlo = la función se auto-bloquea (bug real que dejó el flujo colgado).
- Los eventos JS muere si el WebView se recarga (HMR): por eso existe el polling.
- Barra de progreso de descarga: `syncManager.downloadProgress {loaded,total,pct}`;
  streaming con `response.body.getReader()` vs header `Content-Length`; UI en
  WelcomePage (primera conexión) y CloudPage (restaurar).

### Dev Android / Windows — sesiones independientes (2026-08)

Los dos entornos corren **simultáneamente sin pelearse por puertos**:

| Sesión | Comando | Vite | HMR |
|---|---|---|---|
| Windows | `npm run dev:win` (= `tauri dev`) | 1420 | 1421 |
| Android | `npm run dev:android` (= `tauri android dev`) | **1422** | **1423** |

Cómo: `vite.config.ts` lee `VITE_PORT`/`HMR_PORT` del entorno;
`src-tauri/tauri.android.conf.json` (auto-fusionado en comandos Android) fija
`devUrl http://localhost:1422`; `scripts/vite-android.mjs` es el
`beforeDevCommand` de esa config: hace `adb reverse tcp:1422/1423` y arranca
Vite con los env vars. Sin reverse de 1423 el WebSocket de HMR falla
(`ERR_CONNECTION_REFUSED`), Vite recarga la página y se pierden eventos/invoke
pendientes (`Cannot redefine property: postMessage/__TAURI_PATTERN__`).
Alternativa WiFi/emulador: `dev:android:hmr` / `dev:android:device`
(`scripts/android-hmr.mjs`, setea `TAURI_DEV_HOST`).


**GOTCHAS**:
- Todos estos comandos deben estar en `src-tauri/permissions/local-commands.toml`
  (`commands.allow`) o `invoke` falla en runtime.
- En **dev Android el HMR de Vite está ACTIVO** (`vite.config.ts`: `server.hmr` con
  `protocol: 'ws'`, `port: HMR_PORT` — 1421 desktop / 1423 Android). Antes estaba
  deshabilitado porque el WebSocket de HMR se caía al abrir el navegador del sistema
  durante el OAuth y recargaba la página; ese problema ya no existe.
  Para que el HMR funcione en el dispositivo, la app debe cargar el dev server desde una IP
  alcanzable (emulador `10.0.2.2` o IP LAN en dispositivo físico): usar
  `npm run dev:android:hmr` / `npm run dev:android:device` (`scripts/android-hmr.mjs`, que
  setea `TAURI_DEV_HOST`), no `npm run dev:android` (usa adb reverse solo para el puerto 1420).
- Los `println!("[OAuth] ...")` de Rust son los logs de depuración del flujo (van a
  stdout/logcat, no a la consola del navegador).
- `GoogleDriveBackup.svelte` usa el comando antiguo `gd_start_oauth_server` (otro flujo).

## Botón "atrás" en Android (back navigation)

### Por qué el back cierra la app (investigación)

El comportamiento por defecto de Tauri en Android **cierra la app** cuando el back no
encuentra historial de navegación:

1. La app es una **SPA**: los tabs cambian con estado Svelte (`activeTab` en
   `App.svelte`) y CSS `display`, **sin `history.pushState`**. El WebView solo tiene
   1 entrada de historial (la página inicial).
2. El SDK **tauri-android** (Kotlin) registra un `OnBackPressedCallback` en
   `AppPlugin.kt` (`tauri-2.x.x/mobile/android/src/main/java/app/tauri/AppPlugin.kt`):
   - Si `webView.canGoBack()` → `goBack()` (navega atrás en el historial).
   - Si **no hay historial** → `activity.onBackPressed()` → `finish()` → **la app se cierra**.
   - Si hay un **listener JS registrado** (`onBackButtonPress`) → enruta el back al JS
     con payload `{ canGoBack }` y **NO cierra la app**.
3. `TauriActivity.kt` (generado) sobreescribe `handleBackNavigation = false`, desactivando
   el fallback de `WryActivity` (que sí revisaba `canGoBack()`).
4. Conclusión: sin listener JS ni historial, todo back cae en `finish()` → la app se sale.

### Solución implementada (referencia para apps futuras)

Usar la API oficial **`onBackButtonPress`** de `@tauri-apps/api/app` (disponible desde
`@tauri-apps/api@2.9.0` y `tauri >= 2.9.0`; este repo usa api 2.11.1 / tauri 2.11.5).
Al registrarla, `AppPlugin` enruta el back al JS y **nunca cierra la app por sí mismo**
(`handleOnBackPressed` no llama a `super`). El cierre/minimizado se decide en JS.

**Arquitectura del manejo de back (JS):**
1. `src/lib/androidBack.ts` — registro de handlers por página (pila LIFO):
   - `registerBackHandler(fn: () => boolean): () => void` → cada página registra un
     handler mientras tiene un modal/estado interno abierto (devuelve `true` si lo consumió).
   - `handleBack(): boolean` → ejecuta el handler más interno.
2. `App.svelte`:
   - **No hay historial de tabs** (`tabHistory` se eliminó): el back **no** vuelve a tabs
     anteriores ni minimiza la app.
   - `goBack()`: 1) `handleBack()` (modales internos) → si `true`, listo;
     2) si el OAuth está en progreso → `gd_cancel_oauth`;
     3) si el drawer móvil está abierto → cerrarlo;
     4) si no → mostrar un **snackbar** (`showToast("No hay más páginas atrás")`).
   - `onBackButtonPress` registrado en `onMount`, `unregister()` en `onDestroy`.

- Para **salir/minimizar** de verdad en Android no hay comando JS oficial (`plugin:app|exit`
  del SDK Kotlin **no se expone como comando Rust** — `extend_api` rechaza comandos no
  declarados). Si en el futuro se necesita, el patrón es un `#[tauri::command]` Rust con JNI
  (`ndk_context` + `jni`) que llame `activity.moveTaskToBack(true)` (igual que `set_orientation`
  en `lib.rs`), o `app.exit(0)` para terminar el proceso.

**Integración con modales internos (por página):**
Cada página usa `$effect` (Svelte 5) que registra el handler mientras el modal/estado interno
está abierto, y solo cuando la página está activa (prop `pageActive`):
- `EstudiantesPage.svelte` → `isModalOpen` (form de estudiante)
- `AsistenciaPage.svelte` / `InformePage.svelte` → `selectedStudentDetail` (detalle)
- `CloudPage.svelte` → `showConfirm`
- `GlobalesPage.svelte` → sub-navegación: modales de materias/días/asignaturas
  (`selectedColegioForSubjects` → `selectedGrade` → `selectedColegio`), detalle de categoría
  (`selectedCategory`) y sub-tab `Notas` (`selectedTab`)
- `AjustesPage.svelte` → sub-tab (`activeTab !== null` → vuelve a la lista; solo Android)
- `CategoryTabContent.svelte` → modales `showPrompt` / `showDeleteConfirm` / `showBatchDeleteConfirm`
- `GoogleDriveBackup.svelte` es legacy (no se monta en `App.svelte`); no se toca.

**GOTCHAS:**
- `onBackButtonPress` **solo existe en Android**: en JS llama a `plugin:app|register_listener`,
  que está implementado únicamente en el plugin Kotlin `AppPlugin` (no hay handler en el core
  Rust de `tauri`). En desktop (Windows/macOS/Linux) ese comando **no existe** y el `invoke`
  falla con `app.registerListener not allowed. Command not found`, rompiendo `onMount` de
  `App.svelte`. Por eso el registro se guarda con `if (isAndroid)` (detectado por user-agent)
  y `try/catch`. No intentar registrarlo en desktop.
- El back con listener registrado **consume el evento**; todo el manejo se hace en JS.
- Las páginas quedan **montadas** con `display:none` al cambiar de tab, por eso los handlers
  de sub-navegación se registran solo con `pageActive={activeTab === '...'}` (si no, un back
  en otra pestaña dispararía handlers ocultos).
- Durante el OAuth en Android la app queda en segundo plano (navegador del sistema), así
  que el back no interfiere; `goBack()` llama `gd_cancel_oauth` si hay un flujo activo
  (`isBackAuthInProgress`).
- El payload `{ canGoBack }` del evento se ignora: el historial del WebView no se usa (SPA).

## Esquema de Base de Datos y Datos Iniciales

### Inicialización

La BD se crea en `app_data_dir/school.db` al arrancar la app vía `init_database()` en
`lib.rs:setup`. Es **idempotente** (`CREATE TABLE IF NOT EXISTS`). Los datos iniciales
se siembran bajo demanda desde el frontend (`seed_defaults_now`) después de verificar
si hay datos existentes (evita duplicar defaults).

**Cambio de cuentas / per-account DBs**: cada cuenta de Google tiene su propio
archivo SQLite (`school_<email>.db`). El activo se controla con `active_account.txt`
(marca el email de la cuenta activa). Helpers en `db.rs`:
- `sanitize_account_id(email)` → sufijo de archivo seguro.
- `account_db_path(dir, email)` → `dir/school_<tag>.db`.
- `read_active_account(dir)` / `write_active_account(dir, email)`.
- `resolve_active_db_path(dir)` → ruta del archivo activo (o `school.db` por defecto).

`open_account_db(email, migrateFromDefault)` abre/crea el archivo de la cuenta,
migra `school.db` solo la primera vez (si no hay otro `school_*.db`), cierra la
conexión activa para liberar el handle de Windows antes del rename, y escribe la marca.
Se registra en `generate_handler!` + `local-commands.toml`.

**GOTCHA rename**: `fs::rename` de un archivo SQLite bloqueado por `rusqlite` falla
con "os error 32". Antes de renombrar, se reemplaza la conexión activa con
`Connection::open_in_memory()` (manteniendo el lock) para liberar el handle.

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
| `colegio_grado` | `(colegio_id, grado_id)` | `activo INTEGER DEFAULT 1`, `cualitativo INTEGER DEFAULT 0`, `updated_at TEXT` | FK CASCADE. Grados que ofrece cada colegio según su tipo |
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
| `sync_pending_deletions_colegio_grado` | `id` | `colegio_id`, `grado_id`, `fecha_intento` | |
| `dia_sin_clases` | `id` (INTEGER PK AUTOINCREMENT) | `colegio_id`, `grado_id NULL`, `seccion_id NULL`, `fecha TEXT`, `descripcion TEXT NOT NULL`, `updated_at` | Feriados/días sin clases. UNIQUE(colegio_id, IFNULL(grado_id,0), IFNULL(seccion_id,0), fecha). grado/seccion NULL = nivel colegio. Sincronizada en D1 |

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
- `colegio_grado` poblada (backfill) para colegios existentes según su tipo: Primaria → grados 1-6, Secundaria → grados 7-11 (activo=1, cualitativo heredado del grado)
- `updated_at TEXT DEFAULT (datetime('now'))` en las 16 tablas sincronizables (si no existe)

### Flujo de llamada

1. `lib.rs:setup` → `init_database()` (crea tablas + migraciones). Si `active_account.txt`
   existe y el archivo correspondiente, abre ese en lugar de `school.db`.
2. Frontend (`App.svelte` `onMount`): llama `invoke("seed_defaults_now")` →
   `seed_default_data()` si BD vacía.



## Sincronización Cloudflare D1 — bilateral y en tiempo real (2026-08)

Reemplaza al modelo viejo (solo push por cambios locales). Hoy: **cualquier
guardado en cualquier dispositivo se refleja en los demás en ~1 segundo**,
sin tocar nada, e inmune a desfases de reloj entre dispositivos.

### Arquitectura

`
GUARDAS local → onDataChange(table,{immediate}) → d1_sync_all (Rust)
   +- PUSH  /push  : filas PROPIAS > last_push_sync (reloj LOCAL)
   +- PULL  /pull  : todo lo ajeno > last_sync      (reloj SERVIDOR)
Worker: aplica con updated_at sellado por SU reloj; si escribió algo real
   → difunde por WebSocket a todos los sockets del school key.
Peers (WS): {"type":"changes"} → syncAllSilent() con debounce 700ms
   ? emitUpdates() ? eventos a páginas ? refresco en sitio (keyed).
`

**DOS CURSORES en d1_config (clave del diseño):**
- last_sync = serverTime del worker (/pull). Autoritativo ENTRE dispositivos.
- last_push_sync = hora LOCAL. Comparable con los updated_at que este
  dispositivo estampa en sus filas.
NUNCA mezclarlos: con un solo cursor, un reloj local adelantado/atrasado
hacía que el push comiera sus propias ediciones o que el pull ignorara las
del otro ("la nueva sí llegó, la anterior no").

**LWW por llegada**: el worker RE-SELLA updated_at = serverNow en cada fila
pusheada y el upsert es INCONDICIONAL (sin WHERE comparando stamps heredados).
"Último en llegar al servidor gana". Los relojes de clientes no participan.

**Anti re-relevo** (sync_recent_pulls tabla local): cada fila aplicada por
pull se registra (tabla|pk|updated_at); collect_local_data_since excluye
esas filas hasta que se modifiquen localmente. Sin esto, filas con stamp "a
futuro" (reloj torcido) circulaban entre dispositivos revertándose.

**Broadcast solo con cambios reales**: /push difunde únicamente si
meta.changes > 0 || deletions > 0. Un UPDATE idéntico o un sync sin cambios
NO difunde → sin bucles ni tormentas de auto-eco.

### Worker (cloudflare-sync/) — desplegar tras cada cambio

`powershell
cd cloudflare-sync; npx wrangler deploy
`
?? Un deploy olvidado = cliente nuevo contra worker viejo = fallos mudos
(p. ej. /ws 404). Verificar con 
px wrangler deployments list.

- SyncHub: **Durable Object SQLite** (plan gratuito) por school key, API de
  hibernación + setWebSocketAutoResponse('ping'?'pong') (pings sin despertar DO).
  Rutas: /ws?key= (upgrade validando key vs KV) → /connect; /broadcast.
- Migración en wrangler.toml: [[migrations]] tag="v1_sync_hub"
  new_sqlite_classes=["SyncHub"].
- /pull devuelve serverTime (cursor autoritativo) y **excluye filas del
  propio device** (IFNULL(device_id,'') != ?2) — no re-recibas lo tuyo.
- Logs para 
px wrangler tail: [push] device=… enviadas=X cambiosReales=Y.

### Frontend (src/lib/wsSyncService.ts)

- Auto-arranque 1.2s post-load (desacoplado de App.svelte).
- Reconexión backoff 1s?30s; reintentos en online y isibilitychange.
- Ping cada 25s (respondido sin despertar el DO).
- Filtra avisos propios (rom === myDeviceId) — requiere IDs únicos (ver abajo).
- Debug: window.__wsDebug(); prefijo [WsSync-Debug] (console.debug).

### Disparadores de sync (todos terminan en syncAllSilent)

startup · WS aviso remoto · visibilitychange(foreground) · online ·
navegación entre tabs · tick periódico (input en CloudPage, min 3 min).
emitUpdates() SOLO si el sync trajo/aplicó cambios ? páginas refrescan en
sitio (listas con {#each … (est.id)} keyed: sin saltos de scroll).

### Identidad de dispositivo (¡crítico!)

d1_config.device_id es POR INSTALACIÓN. El respaldo de Google Drive copia
el school.db completo INCLUSA esa tabla → restaurarlo duplica identidades:
con IDs iguales, cada peer descarta los avisos del otro como "propios" y el
tiempo real muere silenciosamente (los pulls por cursor/timer siguen, por eso
"funciona al recargar").
- **Regenerar ID**: CloudPage ? botón naranja (comando d1_reset_device_id;
  también pone ambos cursores a NULL ? re-push+re-pull completos una vez,
  idempotente). Úsalo si dos equipos muestran el mismo ID.
- Prevención: tras restaurar un respaldo Drive, driveSyncService.pullAll
  regenera el ID automáticamente.

### GOTCHAS D1 (aprendidos con sangre)

- **ndk_context NO inicializado** en este setup Tauri 2 → puente propio JNI
  (initNativeBridge desde Kotlin) + catch_unwind en cualquier acceso legacy.
- **esbuild (wrangler/vite) NO hace typecheck**: una variable sin declarar en
  el worker o un import mal nombrado revienta SOLO en runtime. Tras editar
  cloudflare-sync, probar con 
px wrangler deploy --dry-run y validar rutas
  con curl antes de culpar al cliente.
- **PowerShell Set-Content/Get-Content -Raw corrompe UTF-8 sin BOM**
  (acentos → `Ã¡`, emojis → `📩`). Editar archivos fuente SOLO con herramientas
  de edición; si ya ocurrió: re-leer como UTF8, re-codificar bytes vía
  Windows-1252 y re-escribir UTF8 sin BOM (transformación inversa exacta).
- Errores de red TLS puntuales (10054) son transitorios: el siguiente
  disparador/tick recupera todo; no agregar retries agresivos.
- Diagnóstico rápido: consola Windows filtro Debug ([D1Debug],
  [WsSync-Debug]), Android db logcat -s RustStdoutStderr (líneas [D1]
  sync INICIO/PUSH/PULL/FIN con cursores y contadores), servidor
  
px wrangler tail.

### Páginas fusionadas (sub-tabs) — patrón

src/svelte/asistencia/AsistenciaMainPage.svelte y
src/svelte/notas/NotasMainPage.svelte: wrappers con segmented control glass,
props { pageActive, subTabRequest }, montaje perezoso (cada hijo se monta al
primera visita y queda oculto con display:none — preserva estado/drafts),
siempre abren en el sub-tab principal salvo subTabRequest (quick-actions del
Dashboard mapean en App.handleTabChange: 'informe'→asistencia, 'reportes'→notas).
Hijos reciben isible para condicionar egisterBackHandler. Swipe
horizontal Android alterna sub-tabs (ignora gestos sobre scroll-x propios o
modales fixed z=100).

**Refrescos silenciosos sin perder posición**: listas con each KEYED
((est.id)); NotasPage preserva currentStudentIdx en el refresh silencioso;
nunca reconstruir toda la lista sin clave (salta scroll al inicio).

## Días sin clases (2026-08) — feriados por sección o colegio

Tabla `dia_sin_clases` (ver esquema; añadir fila en la lista de tablas).
Comandos: `get_dias_sin_clases(colegioId, gradoId?, seccionId?, fechaInicio, fechaFin)`
y `set_dias_sin_clases(..., fechas[], descripcion, activo)` (bulk transaccional,
pending deletions al borrar). Registrados en generate_handler + local-commands.toml.

**Alcances**: `grado_id`+`seccion_id` con valor = solo esa sección DE ese grado
(las secciones son catálogos compartidos entre grados: sin `grado_id`, una marca
"A" afectaría a todos los grados); ambos NULL = todo el colegio.

**UI (AsistenciaPage)**:
- Botón "🚫 Sin Clases" junto a Limpiar (solo diario/semanal). Popover con MOTIVO
  OBLIGATORIO + alcance (sección / colegio) y confirmación nativa (`ask`);
  desmarcar también confirma.
- Diario marcado → banner ámbar glass + lista vacía. Semanal/mensual: los días
  marcados NO desaparecen; encabezado de columna ámbar 🚫 y celda combinada
  (`rowspan`) con el motivo vertical.
- Click en el ENCABEZADO de una fecha (semanal/mensual) marca/desmarca esa
  fecha puntual (popover contextual, `colFechaObjetivo`).
- `fechasPeriodo` excluye los días sin clases (no cuentan P/A/J ni %);
  `fechasVisibles` los incluye para pintarlos.

**InformePage**: columnas omitidas de reportes; nota en PDF/impresión
("Sin clases: dd/mm (motivo)"); diario muestra "SIN CLASES" en la columna
Estado COMBINADA (rowSpan autoTable / rowspan HTML); banner on-screen.

**DatePickerGlass inteligente**: prop `diaHabilitado(iso)` — días no hábiles del
colegio o marcados sin clases se ven tachados/no seleccionables (también "Hoy").

**GOTCHAS nuevos**:
- El worker D1 agrega `device_id` a TODAS las tablas que guarda: el CREATE TABLE
  remoto debe incluirlo (ensureSchema ya lo maneja + ALTER tolerante).
- Bucle `$effect`: fetchEstudiantesMulti lee `diasSinClases` y el efecto llamaba
  `fetchDiasSinClases` que lo reasignaba → re-disparo infinito ("Cargando..." a
  cada rato). Regla: fetch dentro de efectos va en `untrack()` y reasignar estado
  solo si cambió el contenido (comparar JSON).

## Promoción de estudiantes (2026-08)

Sistema automático para copiar estudiantes de un año lectivo al siguiente,
incrementando su grado (1er→2do, 2do→3ro, ..., 11mo=graduado) con lógica
especial para 6to grado (transición Primaria→Secundaria).

### Diseño

- **Tabla `grado` compartida entre años**: no hay grados por año. El grado se
  hereda del `ano_lectivo_id` del estudiante.
- **Orden de grado**: se deriva parseando el número al inicio del nombre
  (`"1er grado"`→1, `"2do grado"`→2, ..., `"11mo grado"`→11).
- **Tabla `colegio` con tipo**: `tipo TEXT DEFAULT 'Primaria'` (Primaria=1-6,
  Secundaria=7-11). Los grados se asignan por tipo de colegio.
- **Promoción normal**: estudiantes en 1er-5to grado se copian al año destino
  con grado incrementado (+1) y **mismo colegio**.
- **6to grado (transición)**: estudiantes en 6to grado (último de Primaria):
  - Si **no hay colegio Secundaria** → se quedan en el año origen (no se promueven).
  - Si hay **exactamente 1 colegio Secundaria** → se mueven a ese colegio con
    grado 7mo (año destino).
  - Si hay **múltiples colegios Secundaria** → se muestra un modal preguntando
    a qué colegio se mueven (solo para 6to grado).
- **Graduación**: estudiantes en 11mo grado NO se promueven (se graduaron).

### Backend (Rust)

**`src-tauri/src/db.rs`**:
```rust
struct PromoteResult { promoted: i64, graduated: i64 }

fn get_grade_order_map(conn) -> Result<HashMap<i64, i64>, String>
// → HashMap<grado_id, next_grado_id> (11mo → no está en el map)

fn get_grade_number(conn, grado_id) -> Result<Option<i64>, String>
// → parsea el número del nombre del grado (1er→1, 2do→2, etc.)

#[tauri::command]
fn promote_students(conn, from_ano_id, to_ano_id, colegio_destino_map?) -> Result<PromoteResult, String>
// 1. Valida que los años sean distintos
// 2. Obtiene todos los estudiantes del año origen
// 3. Para cada estudiante:
//    - Si grado=6to y hay colegio Secundaria:
//      - Si colegio_destino_map tiene entry para este colegio → mover ahí con grado 7mo
//      - Si 1 solo colegio Secundaria → mover automáticamente
//      - Si no hay Secundaria → quedarse en origen (graduated)
//    - Si tiene siguiente grado (normal) → INSERT en año destino con grado+1
//    - Copia notas (nota) y asistencia (asistencia)
//    - Si es 11mo (sin siguiente) → cuenta como graduated
// 4. Retorna { promoted, graduated }

#[tauri::command]
fn get_secundaria_colegios(conn) -> Result<Vec<ColegioInfo>, String>
// → lista de colegios con tipo='Secundaria' (para el modal de selección)
```

**`src-tauri/src/lib.rs`**: `promote_students` y `get_secundaria_colegios`
  registrados en `generate_handler!`
**`src-tauri/permissions/local-commands.toml`**: ambos en `commands.allow`

### Frontend (EstudiantesPage.svelte)

**Estado**:
- `showPromoteBanner`, `promoteFromAno`, `promoteToAno`, `promoteStudentCount`, `isPromoting`
- `showColegioPicker`, `secundariaColegios`, `pendingSixthGraders`, `selectedColegioId`

**Lógica**:
- `checkPromotionEligibility()` — detecta año activo con estudiantes + año nuevo
- Antes de promover, verifica si hay estudiantes en 6to grado:
  - Si 0 colegios Secundaria → promueve normalmente (6to se queda)
  - Si 1 colegio Secundaria → promueve con migración automática de 6to
  - Si >1 colegio Secundaria → abre modal `showColegioPicker`
- `handlePromoteStudents()` — confirma, llama `invoke('promote_students')`, toast
- `handleColegioSelected(colegioId)` — completa la promoción con el colegio destino

**UI**:
- Banner púrpura con botones Promover/Descartar
- Modal picker de colegio Secundaria (solo si >1 y hay estudiantes en 6to)

### Gotchas

- **11mo grado = graduados**: no hay grado 12, los estudiantes de 11mo no se promueven.
- **6to grado = transición**: solo se mueve si hay colegio Secundaria.
- **Grado compartido entre años**: la tabla `grado` no tiene añolectivo; el año se hereda del `ano_lectivo_id` del estudiante.
- **Copia de datos**: se copian `nota` y `asistencia` al año destino; los catálogos (grado, seccion, asignatura) son globales.
- **colegio_destino_map**: parámetro opcional `HashMap<i64, i64>` (colegio_origen → colegio_destino) para resolver la selección del usuario en el modal.

## Grados por tipo de colegio (colegio_grado) — configuración unificada

Desde 2026-08, los grados son **fijos y globales** (1ro-11mo) y cada colegio
tiene su `tipo` (Primaria/Secundaria) que determina qué grados le corresponden:
- **Primaria** → grados 1-6
- **Secundaria** → grados 7-11

### Tabla `colegio_grado`

Relación muchos-a-muchos colegio↔grado con flags propios:

| Columna | Tipo | Notas |
|---------|------|-------|
| `colegio_id` | INTEGER | FK colegio, CASCADE |
| `grado_id` | INTEGER | FK grado, CASCADE |
| `activo` | INTEGER DEFAULT 1 | El grado está disponible en ese colegio |
| `cualitativo` | INTEGER DEFAULT 0 | Flag cualitativo POR COLEGIO (independiente del global del grado) |
| `updated_at` | TEXT | Sync D1 |

**Siembra/backfill**: `seed_colegio_grados(conn, colegio_id, tipo)` inserta
(INSERT OR IGNORE) los grados del tipo con `activo=1` y cualitativo heredado del
grado global. Se llama desde:
- `migrate_add_columns` (backfill de colegios existentes al arrancar)
- `seed_selected_data` (wizard: por cada colegio según su tipo)
- `add_colegio` (default Primaria)
- `update_colegio` (si cambia el `tipo`, re-siembra los grados del nuevo tipo)

### UI — modal unificado de Colegio

- Card **Grado** en Globales quedó **solo lectura**: sin Agregar/Editar/
  Eliminar/Renombrar ni toggle global de cualitativo. El botón ⚙️ de cada grado
  solo abre el modal de **asignaturas** (currículo `grado_asignatura`), sin campo
  de nombre.
- El modal ⚙️ de **Colegio** ganó una 4ta pestaña **📊 Grados**: lista los grados
  del colegio con toggle **activo** (switch), toggle **cualitativo** (switch) y
  botón 🗑 para eliminar el grado de ese colegio (confirma con `ask`, registra
  pending deletion). Botón "💾 Guardar grados" persiste.

### Comandos Rust

- `get_grados_config_by_colegio(colegioId)` → `[{id, nombre, activo, cualitativo}]`
  (NO confundir con el `get_grados_by_colegio` existente, que filtra grados de
  estudiantes de un colegio para los selectores).
- `set_colegio_grado(colegioId, gradoId, activo, cualitativo)` → upsert.
- `delete_colegio_grado(colegioId, gradoId)` → elimina + registra
  `sync_pending_deletions_colegio_grado`.
- `get_pending_deletions_colegio_grado` / `remove_pending_deletion_colegio_grado`.

Registrados en `generate_handler!` (lib.rs) y `local-commands.toml`.

### Sync

`colegio_grado` es sincronizable (espejo de `colegio_asignatura`): PK compuesta
`(colegio_id, grado_id)`, en `pk_cols`/`table_names` de `d1.rs`, en `lib.rs`
(`get_all_local_data_since`/`has_local_changes`), en `dirtyTracker.ts` y en el
worker (`TABLES`, `ensureSchema`).

## Limpieza y toggle de asistencia (2026-08)

- Re-tocar el mismo estado (P/A/J) LIMPIA la marca. En diario los handlers van en
  `onclick` del `<label>` SIN `<input type=radio>` oculto: los radios no disparan
  `onchange` al re-clicar, y el label reenvía un clic sintético al input que
  disparaba el handler DOS veces (toggle anulado → parecía congelado).
- `saveChanges`/`saveChangesMulti` BORRAN las celdas vaciadas
  (`delete_asistencia_batch`) antes de guardar: si no, quedaban huérfanas en BD y
  InformePage seguía mostrando asistencia ya limpiada.
- Botón Limpiar usa diálogo nativo `ask` (modal custom eliminado).

## Credenciales Cloudflare (.key) + Welcome (2026-08)

- **Formato .key**: JSON `{workerUrl, schoolKey}` (plantilla `schooltracker.key`
  en raíz del proyecto, añadida a `.gitignore`).
- **Exportar**: CloudPage botón "📤 Exportar clave" (diálogo save nativo).
- **Importar**: WelcomePage 3ra tarjeta "Tengo un archivo de conexión" → `open`
  dialog → valores pasan UNA vez a `d1_save_config` (solo SQLite/d1_config;
  nunca localStorage ni bundle). Ejecuta primer `d1_sync_all`; nube vacía → wizard.
- **Protección anti-mezcla**: si la config existente difiere del .key (p. ej. una
  BD restaurada desde Drive trae su propia `d1_config`), se avisa y reemplaza
  LIMPIO: `d1_clear_config` antes de guardar → nuevo device_id, cursores en cero,
  re-sync completo. Implementado en CloudPage y WelcomePage.
- **Modal Configurar D1**: ya no tiene inputs; SOLO importa archivo .key.
- **Clave enmascarada** en UI: card muestra `••••••••{últimos 4}`; formulario
  manual eliminado.
- **Notificaciones Android**: comando `gd_request_notification_permission`
  (JNI → `MainActivity.requestNotificationPermissionNow()`, POST_NOTIFICATIONS)
  se invoca al completar la primera ejecución (ambos caminos del Welcome).

## Worker D1: esquema auto-creado

`ensureSchema` (cloudflare-sync/src/index.ts) crea TODAS las tablas
sincronizables (`CREATE TABLE IF NOT EXISTS` espejo de TABLES, PKs compuestas
correctas) + `sync_tombstone` + reshape de `dia_sin_clases`. Una base D1 nueva
queda operativa al primer sync. Tras cada cambio del worker:
`npx wrangler deploy` (obligatorio).

## Sidebar/Header móvil (2026-08)

- Chip compacto `mobile-sync-chip` en `mobile-header` (App.svelte) a la derecha
  del título: punto coloreado por estado D1 + ☁️, tap abre pestaña Nube.
- Drawer móvil: solo card "Respaldo Drive" (`CloudCards` prop `ocultarD1`),
  texto compacto responsivo (una línea, ellipsis).
- Card Respaldo Drive (todas las plataformas): tap = respaldo manual real
  (`driveSyncService.pushAll()`); si Drive no está vinculado lleva a pestaña
  Nube. Spinner + "Subiendo…" durante la subida.
- GOTCHA: meter widgets de CloudCards dentro del header flex rompe layouts
  (ancho mínimo/media queries propios); usar chips dedicados.
- GOTCHA: NUNCA editar AGENTS.md vía PowerShell (Get-Content/Set-Content) —
  corrompe UTF-8 igual que los fuentes; usar solo herramientas de edición.

## Cambio de cuentas / per-account DBs (2026-08)

Cada cuenta de Google tiene su propio archivo SQLite local, eliminando la
necesidad de borrar/restaurar al cambiar de cuenta. La sincronización con
Cloudflare D1 y Google Drive es de respaldo; el archivo local siempre es la
fuente de verdad.

### Archivos por cuenta

| Ruta | Contenido |
|------|-----------|
| `app_data_dir/school.db` | BD por defecto (solo instalaciones antiguas sin per-account) |
| `app_data_dir/school_<tag>.db` | BD de una cuenta concreta (`tag` = email sanitizado) |
| `app_data_dir/active_account.txt` | Email de la cuenta activa (marca de archivo) |

- `sanitize_account_id(email)` → `plbarostegui92_gmail_com`
- `account_db_path(dir, email)` → `dir/school_<tag>.db`
- `resolve_active_db_path(dir)` → ruta del archivo activo (o `school.db` si no hay marker)

### Comando Rust: `open_account_db`

```rust
#[tauri::command]
async fn open_account_db(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    email: String,
    migrate_from_default: bool,
) -> Result<String, String>
```

1. Calcula ruta del archivo `school_<tag>.db`.
2. Si no existe y `school.db` es la primera (no hay otros `school_*`):
   - **Libera el handle**: reemplaza la conexión activa con `Connection::open_in_memory()`
     para soltar el lock de Windows sobre `school.db`.
   - Renombra `school.db` → `school_<tag>.db`.
3. Abre `school_<tag>.db`, init_database, reemplaza la conexión activa, escribe marker.

**GOTCHA rename**: `fs::rename` de un SQLite abierto falla con "os error 32" en Windows.
Se reemplaza la conexión con `Connection::open_in_memory()` ANTES de renombrar.

### Flujo de cambio de cuentas

**Stored (sin re-auth)**:
1. `invoke('open_account_db', { email })` → abre archivo propio.
2. `applyAccountStores(...)` → tokens + perfil.
3. `ensureWsSync()` → reconecta al hub de la nueva cuenta.
4. `invoke('d1_sync_all', {})` → push+pull con la nube de esa cuenta.
5. `driveSyncService.pushAll()` → respaldo a Drive (con `accountTag()` en el nombre).

**OAuth (nueva cuenta)**:
1. `iniciarSesionGoogleConNube(...)` → OAuth → `open_account_db(email)` internamente
   (antes de `conectarConCredenciales` para que la config de nube vaya al archivo correcto).
2. `applyAccountStores(...)`.
3. `finalizeAccountSwitch({ cloud })` → saveConfig + sync + Drive push.

**Primera conexión (welcome)**:
- `iniciarSesionGoogleConNube` → `open_account_db` migra `school.db` → `school_<email>.db`
  (el usuario conserva sus datos del primer setup).

### Drive por cuenta

`accountTag()` genera un sufijo a partir del email para aislar respaldos:
- Filename: `SchoolTracker_Sync_<tag>_<platform>_<timestamp>.db`
- `listSyncFiles` filtra por `name contains 'SchoolTracker_Sync_<tag>_'`
- `deleteOldSyncVersions` solo borra versiones de la misma cuenta (máx 3)

**Retry en pushAll**: si el POST devuelve 404 (carpeta cacheada stale), se invalida
el caché, se recrea la carpeta vía `ensureBackupFolder`, y se reintenta una vez.

### Comandos Rust relacionados (todos en `local-commands.toml`)

| Comando | Descripción |
|---------|-------------|
| `open_account_db` | Abre/crea archivo de una cuenta + migra school.db si es primera vez |
| `get_db_path` | Devuelve la ruta del archivo activo (`resolve_active_db_path`) |
| `gd_reload_database` | Reabre la conexión activa (usa `resolve_active_db_path`) |
| `gd_import_db_from_file` | Importa .db en el archivo activo |
| `gd_create_backup` | Copia el archivo activo para backup temporal |

### Helpers en `db.rs`

| Función | Descripción |
|---------|-------------|
| `sanitize_account_id(email)` | Email → sufijo de archivo seguro |
| `account_db_path(dir, email)` | Ruta del archivo de una cuenta |
| `read_active_account(dir)` | Lee `active_account.txt` → Option<String> |
| `write_active_account(dir, email)` | Escribe `active_account.txt` |
| `resolve_active_db_path(dir)` | Ruta activa (account file o school.db fallback) |

### Gotchas per-account

- **`fs::rename` con SQLite abierto** → "os error 32". Solución: `Connection::open_in_memory()`
  antes de rename para liberar el handle.
- **`d1_config` se escribe ANTES del rename**: `iniciarSesionGoogleConNube` llama
  `open_account_db` DESPUÉS de `authWithGoogleIdToken` pero ANTES de
  `conectarConCredenciales`, para que la config de nube se guarde en el archivo nuevo.
- **school.db como fallback**: `resolve_active_db_path` devuelve `school.db` si no hay
  marker o si el archivo del marker no existe (backward compat).
- **Migración solo una vez**: solo ocurre si NO hay ningún `school_*.db` en el dir.
  Si ya existe uno, se crea archivo vacío para la nueva cuenta.
