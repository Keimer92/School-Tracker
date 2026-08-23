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
                             nombre incluye _Windows/_Android). Auto-respaldo cada N
                             min (drive_auto_backup_minutes, default 180).
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
  tauri.conf.json            productName, identifier com.keimer.schooltrackerpro, ventana,
  tauri.android.conf.json    override auto-fusionado en comandos Android:
                             devUrl http://localhost:1422 (sesión dev independiente)
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

### OAuth de Google Drive

**IMPORTANTE (2026-08)**: En Android el flujo principal es **Google Sign-In NATIVO**
(bottom sheet de Play Services, ver sección siguiente). El flujo de navegador/TCP
descrito aquí abajo queda como flujo de **desktop** (Windows/macOS/Linux) y
respaldo histórico en Android.

**Desktop**: Google Cloud Console NO acepta schemes custom (`schooltrackerpro://...`)
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
   `schooltrackerpro://` que NO está registrado → el navegador nunca volvía a la app).
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
  `com.keimer.schooltrackerpro`): SHA-1 debug
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
  (acentos ? Ã¡, emojis ? ðŸ“©). Editar archivos fuente SOLO con herramientas
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
