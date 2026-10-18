# AGENTS.md — School Tracker

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

Idioma del código y comentarios: **Ingles**. Mantener así.

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

## i18n (Espanol / English) - 2026-10

Infraestructura en `src/lib/i18n.svelte.ts` + diccionarios `src/lib/locales/es.ts`
y `en.ts`. Picker en `src/svelte/LanguagePicker.svelte`.

**El estado de avance (que paginas faltan) esta en `docs/I18N-PENDIENTES.md`**,
con el script `docs/i18n-status.ps1` que lo recalcula. Ahi esta el checklist para
traducir una pagina nueva y las decisiones de que NO se traduce.

### El picker en WelcomePage es un POPOVER FLOTANTE (2026-10)

`LanguagePicker` tiene **dos modos**: `flotante` (WelcomePage) y completo sin
props (Ajustes). El de WelcomePage es un boton 🌐 con popover, montado como
**hijo directo de `.welcome-page`** y NO dentro de cada vista:

- Asi cubre portada, asistente (wizard) y pantalla de nube. Antes el selector
  solo existia en la portada, asi que estando en el asistente no se podia
  cambiar de idioma.
- **Esta visible en Android**: estaba detras de un `{#if !isAndroidMobile}`, o
  sea escondida justo en el primer arranque, que es cuando mas se necesita.

Notas de implementacion:

- El boton va con `position: fixed`, NO `absolute`: `.welcome-page` tiene
  `overflow-y: auto` y con `absolute` el boton se iria con el scroll del
  asistente. Es seguro porque **ningun ancestro** (`.app-layout`,
  `.welcome-page`) tiene `transform` ni `backdrop-filter`; si alguno lo
  tuviera, ese ancestro pasaria a ser el bloque contenedor (GOTCHA de
  `position: fixed` mas abajo). Aun asi la degradacion seria benigna porque
  `.app-layout` ocupa todo el viewport.
- El `overflow` de `.welcome-page` **no** recorta al `fixed`: ese overflow solo
  recorta descendientes cuyo bloque contenedor esta en la cadena, y aca el
  bloque contenedor es la ventana.
- El popover se cierra con `pointerdown` (capture) afuera del componente y con
  Escape, registrado en un `$effect` que solo corre `expandido && flotante`, asi
  no deja listeners huerfdos cuando esta cerrado.
- Al tocar el boton se usa `ev.target instanceof Element` antes de `closest()`:
  `closest` vive en `Element`, no en `Node`, y `tsc` lo reclama.
- `setLocale(o.id)` cierra el popover apenas se elige.

### El tipado es la garantia, no un script

`es.ts` es la fuente de verdad (`export type Clave = keyof typeof es`) y `en.ts`
esta declarado como `Record<Clave, string>`. **Si se agrega una clave en espanol y
se olvida la traduccion, el `tsc` del build falla.** No hace falta ningun
comprobador de claves sincronizadas.

### El modulo es `.svelte.ts`, NO `.ts`

El estado del idioma es `let locale = $state<Locale>(...)`. Eso es lo que hace que
`t()` sea **reactivo**: al leer el rune dentro de la funcion, Svelte registra la
dependencia y toda la app se re-renderiza sola al cambiar el idioma. Con un `let`
normal en un `.ts` comun, `t()` devolveria el valor viejo y la app quedaria medio
traducida hasta que algo mas provocara un render.

Por lo mismo, **todo lo que usa `t()` tiene que ser `$derived`, no `const`**: en
`AjustesPage` los `TABS` y en `WelcomePage` los `steps` y el resumen del wizard.
Con `const` se evaluan una vez al importar el modulo y nunca cambian de idioma. Es
el error facil de cometer y no da error de compilacion: el proyecto tiene
`fail-on-warnings=false` y `$derived` acepta cualquier expresion.

### Deteccion de idioma inicial

`localStorage['stp_locale']` -> `navigator.languages` -> `navigator.language` ->
`es`. Se mira **el primer tag reconocido de la lista**, no solo el primero: con
`['pt-BR','en-US']` gana `en` (el idioma que el usuario si habla), no espanol por
defecto. Un idioma no reconocido (fr, de) cae a espanol.

⚠️ **`navigator.language` YA es el idioma del sistema** en Windows (WebView2 sigue
la display language) y en Android (WebView sigue el locale del dispositivo), asi
que no hace falta JNI para el caso pedido. La unica excepcion conocida es Android
13+ con "idiomas por app" configurado para School Tracker: ahi el WebView puede
reportar algo distinto al del sistema. Si alguna vez se nota, el enganche es un
comando `gd_system_language` con `Locale.getDefault()` en `MainActivity.kt`,
consultado antes del paso 2. No se hizo a proposito porque suma una funcion nativa
en `gen/android` (commiteado a mano) por una diferencia casi inexistente.

### Que se traduce y que no

| Se traduce | NO se traduce |
|---|---|
| Labels, botones, titulos, placeholders | **Nombres de grado/seccion/asignatura/estudiante** (datos del usuario) |
| Mensajes de error y toasts | **Valores de enum**: `tipoDesdeGrados === 'Primaria'`, `themeMode: 'claro'/'oscuro'/'sistema'`. Son claves que viajan a la BD y al resto de la app; solo se traduce la etiqueta visible |
| Textos de los modales `ask()` | `console.warn` / `println!` (codigo y comentarios siguen en espanol, por convencion del repo) |
| | **Encabezados de PDF/Excel** (`excel.ts`, `asistenciaPdf.ts`): un reporte en ingles para una direccion de colegio es raro. Si alguna vez se quiere, va con un toggle aparte |

⚠️ Si el `value` de un `<option>` o de un boton activo es una clave de dominio
(`'firefox'`, `'chrome'`), el `t()` NO se puede aplicar ahi. Para eso esta el mapa
`CLAVE_I18N` en `BrowserPicker`: traduce solo la etiqueta y deja la clave intacta
para el estado interno.

### Getters de i18n para listas y fechas (`i18n.svelte.ts`)

`tagLocale()` devuelve el tag BCP-47 activo (`en-US` / `es-ES`) y `fmtFecha(iso, opts)`
es un atajo de `toLocaleDateString(tagLocale(), opts)`. Existen porque los templates
tenian `toLocaleDateString('es-ES', ...)` con el locale **hardcodeado**: en modo ingles
el dia de la semana salia en espanol ("lunes"). Se aplica solo en el `render`, asi que
`getLocale()` queda como dependencia reactiva y la fecha se re-formatea al cambiar el
idioma.

Para un listado de valores enumerados, `OPCIONES` es el patron: el array lleva el id de
dominio, y una funcion traduce solo la etiqueta.

### Trampas concretas al traducir una pagina

- ⚠️ **Una variable local llamada `t` tapa la funcion `t()`.** En `AsistenciaPage` habia
  tres `const t = ev.target as Node` en handlers de eventos. No rompia nada porque
  dentro de esos scopes no se llamaba `t()`, pero es una bomba de relojería: el proximo
  `t('clave')` en ese scope daria "t is not a function" y el error apuntaria a la linea
  equivocada. Se renombraron a `nodo`. **Al meter `t()` en un archivo, buscar antes
  `const t =` / `let t =` / `(t) =>`.**
- ⚠️ **Las claves de dominio NO se traducen aunque "parezcan" texto.** En
  `AsistenciaPage`, `dayNames = ['domingo','lunes',...]` indexa `colegioConfig`, que viene
  de `colegio_dias_asistencia` (columnas `lunes`..`domingo`). Traducirlas rompe el filtro
  de dias habiles en silencio. Lo mismo con `handleCardClick('Presentes', ...)`: ese `type`
  era SOLO el titulo del modal, asi que ese si se pudo pasar ya traducido; la regla es
  revisar que hace el valor antes de decidir.
- ⚠️ **Los `console.warn`/`console.error` quedan en español** (convencion del repo: el
  codigo esta en español). Solo se traducen los `emit('show-toast', ...)` y los textos de
  los `ask()`.
- Las abreviaturas de una letra en las tarjetas compactas de movil (`F:`, `M:`, `E:`,
  `P:`, `A:`, `J:`) se dejaron como estan: son casi universales y la etiqueta completa ya
  aparece en las tarjetas de escritorio. Traducirlas rompe el ancho de esa fila.
- ⚠️ **Las claves nuevas van DENTRO del objeto, antes del `} as const;`.** Si se
  agregan despues del cierre, TypeScript las lee como codigo suelto y el error no
  senala la causa: aparecen decenas de `';' expected` / `Cannot find name 'as'`
  apuntando a la linea donde se agregaron (69 errores en un caso real, todos de
  este mismo bug). Al agregar un bloque grande de claves, verificar que el
  `oldString` del edit termine en `} as const;` para que el reemplazo lo conserve.
- ⚠️ **Dos archivos NO pueden compartir el mismo nombre de clave.** Con
  `ccm.sinGuardar` en dos modulos distintos salta
  `An object literal cannot have multiple properties with the same name`, y el
  mensaje muestra la clave COMPARTIDA pero no cual de los dos archivos sobra.
  Prefijar por archivo (`cc_calificaciones.*`, `ccm.*`) cuando el modulo es nuevo.
- ⚠️ **`t()` NO va dentro de un literal de string en el template.**
  `{saving ? '⏳ {t('ccm.guardando')}' : ...}` rompe con `js_parse_error` porque
  Svelte intenta parsear el `{t(` como expresion dentro del ternario. La forma
  correcta es la expresion pelada: `{saving ? t('ccm.guardando') : t('ccm.btn.guardarCambios')}`.
- ⚠️ **Cuidado con `replaceAll` sobre un string entre comillas.** Reemplazar
  `'⏳ Guardando...'` por `{t('ccm.guardando')}` deja las comillas originales y
  produce `{saving ? {t('ccm.guardando')} : ...}` (doble llave) → error de parseo.
  Revisar el diff despues de un replaceAll masivo.

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
    asistencia/              AsistenciaMainPage.svelte (wrapper sub-tabs: UN solo
                              AsistenciaPage con prop `modo` = 'tomar' | 'informe')
    notas/                   NotasMainPage.svelte (wrapper sub-tabs: UN solo
                              NotasPage con prop `modo` = 'registrar' | 'reportes')
    ajustes/                 Configuración (antes AjustesGenerales). Submódulos
                              extraídos del page shell:
       DebugPage.svelte       gestión de datos (exportar/importar/purgar +
                              info del sistema) y popover de backup automático
       InfoPage.svelte        "Acerca de": hero, features, changelog, modal
                              (va a <body> con portalToBody por ser `fixed`)
    notificaciones/          NotificacionesPage.svelte (solo Android; AlarmManager
                              nativo). Config por colegio: ventana [inicio,fin] +
                              intervalo de repetición
    globales/                módulos de catálogo con estado propio:
       CalificacionesConfig.svelte   escalas cualitativas (AA/AS/AF/AI):
                                     sigla, nombre, color y mínimo
       MultiplicadoresConfig.svelte  ponderación por criterio. Lee
                                     `get_grade_configs` SOLO para pintar
                                     nombre/color; no edita ahí
       ColegioConfigModal.svelte     ⚙️ Colegio: 4 pestañas (tipo, días,
                                     asignaturas, grados). ÚNICO lugar donde se
                                     marca cualitativo
       GradoConfigModal.svelte        ⚙️ Grado: asignaturas (currículo)
     ConfiguracionPage.svelte shell de Configuración: rail (desktop) o lista
                              (Android) + sub-navegación. Guarda el scroll de
                              la lista al entrar/salir de una sección
     CloudCards.svelte        cards Nube D1 / Respaldo Drive del sidebar. Cada
                              una abre SU modal (no navegan a ninguna página)
     modales/                 modales REUSABLES de nube (2026-10, antes
                              CloudPage + AccountPage):
       ModalBase.svelte         caparazón glass: overlay portalToBody, título,
                                ✕, `onpointerdown`+target para cerrar con el
                                fondo y `registerBackHandler` (back Android y
                                Escape de escritorio)
       ModalNubeD1.svelte       panel Cloudflare D1: última sync, botón
                                sincronizar, diagnóstico del error, worker +
                                clave enmascarada e **importación del .key**
       ModalNubeDrive.svelte    panel de Drive: login, resumen del último
                                respaldo, "crear respaldo", respaldo
                                instantáneo y lista con restaurar/eliminar
     CategoryTabContent.svelte  card/config de cada categoría en el catálogo
                              (modales add/edit, switch activo, savebar). El
                              botón ⚙️ SOLO se renderiza si recibe `onConfigClick`
     DatePickerGlass.svelte   selector de fecha con dias no habiles tachados
     FiltersModalAndroid.svelte LEFTOVER (2026-10): modal de filtros Android que
                              quedó SIN consumidores al pasar NotasPage,
                              AsistenciaPage y EstudiantesPage al riel inline
                              `FiltroRail`. Se conserva por referencia; el GOTCHA
                              del `<select>` que lo cerraba solo está más abajo.
     FiltroRail.svelte        riel de filtros INLINE para Android: rejilla de
                              `<select>` que ENVUELVE (no scroll lateral). Layout
                              compartido por NotasPage, AsistenciaPage y
                              EstudiantesPage; los estilos de los `<select>` (con
                              `:global`) viven acá para no duplicarlos.
     BtnRail.svelte           riel de BOTONES: rejilla de 3 columnas que
                              envuelve, reemplaza las filas con `overflow-x`. Los
                              BotonMod van SIN `compacto` (inyecta padding que
                              gana al CSS de la rejilla).
     AccionesRail.svelte      fila de acciones que sí scrollea de lado (una línea
                              con `overflow-x`), para botones anchos y pocos.
     ModoToggle.svelte        control segmentado de 2 opciones que alterna el
                              modo de una página con sub-tabs. Va DENTRO de la
                              barra/riel de filtros; el estado vive en el wrapper
                              y el hijo avisa por `onModoChange`. Es visible
                              TAMBIÉN en Android (variante `grande`, 2026-10): ya
                              no hay swipe en Notas ni en Asistencia.
  lib/
    asistenciaPdf.ts         generador COMPARTIDO de PDFs de asistencia
                              multipágina (una hoja por grado/sección). Escala
                              tipografía por nº de columnas Y de filas; bordes
                              únicos de 0.5mm (sub-píxel se ve irregular);
                              encabezados de fecha NUNCA rotados; chips de
                              encabezado; pie dibujado al final con el total
                              real de páginas. jspdf lazy + interop de export
                              (ver sección dedicated).
    excel.ts                 MÓDULO COMPARTIDO de exportación .xlsx con **ExcelJS**
                              (no SheetJS: la versión Community no escribe
                              estilos/anchos/color; ExcelJS sí y además trae
                              paneles congelados, autofiltro e imágenes). Se
                              carga LAZILY. Helpers: `crearLibroEstudiantes`,
                              `guardarLibro`, `agregarHoja`, `escribirPortada`,
                              `escribirCabecera`, `escribirFila` (filas 1-based,
                              Devuelven la primera fila libre siguiente).
                              `xlsx-js-style` fue ELIMINADO del proyecto;
                              `xlsx` se mantiene solo para leer/plantillas.
    instrumentosPdf.ts       PDFs de instrumentos (jspdf lazy)
    instrumentosExcel.ts      export xlsx de instrumentos
    exceljs-style.ts         helpers de estilo compartidos de Excel
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
    platform.ts              esAndroid/esWindows/esMacOS/esLinux, separadorRuta(),
                             unirRuta(), aFileURL(). VER sección "GOTCHA: Linux".
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
src-tauri/gen/               generado (ignorar; no editar a mano — EXCEPCIÓN: archivos
                             custom en android/app/src/main/java/com/keimer/schooltracker/
                             que NO son auto-generados, ver GOTCHA "Archivos Android custom")
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
  La orientación se controla desde `App.svelte`: todas las vistas quedan en
  retrato salvo Notas, que usa el sensor completo (`SCREEN_ORIENTATION_FULL_SENSOR`)
  para permitir la tabla en horizontal. `set_orientation` usa el puente JNI
  inicializado desde `MainActivity`, no `ndk_context`.
- **Build**: `npm run build` = `tsc && vite build` (estricto: `strict: true`, pero
  `noUnusedLocals/Parameters` están en `false`). Vite build tiene `minify: false`.
- **Google Drive OAuth**: tokens guardados en `localStorage['schooltracker-google-drive-settings']`.
  El servidor OAuth local se ejecuta en Rust (ventana `google-login`).
- **Sync periódico**: configurable en ajustes (segundos). Lo maneja
  `driveSyncService.ensurePeriodicSync()`. Intervalo guardado en
  `localStorage['periodic_sync_interval_seconds']`.
- **dirtyTracker**: la clave en localStorage es `stp_dirty_tables`. Función: marcar
  tablas modificadas para saber si hay cambios pendientes de subir. (Hubo una
  migración desde `turso_dirty_tables`; se eliminó en 2026-10 con Turso.)
- **Per-account DBs**: cada cuenta de Google tiene su propio archivo SQLite
  (`school_<email>.db`). El archivo activo se controla via `active_account.txt`
  y helpers `db::read_active_account` / `db::write_active_account`. NO usar
  `Connection::open("school.db")` directamente; usar `resolve_active_db_path()`.
- **Año lectivo = año calendario (REGLA)**: el año lectivo se ingresa SIEMPRE como
  año calendario de 4 dígitos (2026, 2027…), nunca como rango ("2026-2027").
  Validado en `CategoryTabContent.svelte` con `/^(19|20)\d{2}$/` (alta y edición)
  y explicado en la UI de Configuración.   Consecuencia asumida: el selector de año calendario del 
 mes desapareció de
  AsistenciaPage (tomar e informe); `anoSeleccionado` se deriva
  del año lectivo por `$effect`. Si el año lectivo es 2026, el mes se ve en 2026.
- **`position: fixed` dentro de contenedores glass**: cualquier ancestro con
  `backdrop-filter` o `transform` se convierte en bloque contenedor de sus
  descendientes `fixed`, así que un modal `position:fixed` embebido en un panel
  glass se confines y se sale de la pantalla. Solución: montarlo en `<body>` con
  una acción tipo `portalToBody` (ver modal de Sin Clases en AsistenciaPage).
- **Interop de jspdf fuera de Vite**: `const { default: jsPDF } = await import("jspdf")`
  funciona en Vite, pero al correr un `.ts` suelto en Node el constructor queda en
  `mod.default.default`. `asistenciaPdf.ts` resuelve las dos formas con
  `resolverExport()`, lo que además permite testear PDFs en Node (ver abajo).
- **Pruebas de PDF en Node**: los generadores se pueden ejercitar sin Tauri con
  `npx esbuild <test.ts> --bundle --platform=node --format=esm --external:jspdf
  --external:jspdf-autotable` y ejecutando el `.mjs` desde la raíz del proyecto
  (necesita resolver `jspdf`). Contar páginas con `/\/Type\s*\/Page[^s]/g` sobre el
  buffer, y descomprimir los streams con `zlib.inflateSync` para verificar que los
  textos se emiten como un token (ej. que `dd/mm` NO se parte en dos líneas).
  **Borrar el `.mjs` generado en la raíz**: el hook de auto-commit lo commitea.
- **Bordes de tabla PDF**: autoTable dibuja los bordes como rectángulos rellenos
  (`re`) del grosor en mm, NO como trazos. Con 0.2mm caen en SUB-PÍXEL y cada
  visor los rasteriza a 1 o 2 píxeles según dónde caigan → unas líneas se ven más
  gruesas que otras. De ahí `GROSOR_LINEA_TABLA = 0.5` (≈1.4px a 96dpi) y un
  único valor para tabla, encabezado y chips.
- **Pie de página del PDF**: dibujarlo dentro de `didDrawPage` da "Hoja 1/1" en
  cada página, porque las hojas siguientes aún no existen. Registrar el rango de
  páginas de cada tabla y pintar el pie al final, ya con `getNumberOfPages()` real.

## GOTCHA: Linux (2026-10) — "no es Windows" NO significa "es Android"

El backend Rust ya era multiplataforma: tiene `#[cfg(target_os = "linux")]`
en `gd_open_url_browser` (usa `xdg-open`), en los comandos JNI, etc., y
`cargo check` pasa en Linux sin tocar una línea. **Todos los problemas estaban
en el frontend**, y en un ún error de fondo: cuatro lugares asumían que si no
|Windows" entonces era "un telófono Android". En Linux de escritorio eso es
falso, y el resultado era una app que funcionaba pero con la UI del móvil.

**Regla**: para elegir entre UI ancha y UI de telófono, preguntar
"**¿soy un telófono?**" (`!isAndroid` / `esEscritorio` de `platform.ts`),
nunca "¿soy Windows?". La pregunta de plataforma real es para lo que de verdad
importa: separadores de ruta, `file://`, binario para abrir el navegador.

### Lo que estaba roto en Linux (arreglado en `9c0509f`)

1. **Separadores de ruta hardcodeados**: `/Android/i.test(ua) ? '/' : '\\'`
   en `instrumentosExcel.ts` e `instrumentosPdf.ts`. En Linux armaba
   `/home/user/Documents\SchoolTrackerPro\Plantillas`: las plantillas nunca se
   listaban y los instrumentos xlsx/pdf no se guardaban.
2. **`openUrl('file:///' + ruta)`**: en Linux daba `file:////home/...` con
   cuatro barras. Prefijar la unidad en Windows es lo que deja el host vacío.
3. **`devicePlatform()`** (`driveSyncService.ts`) devolvía `'Windows'` para todo
   lo que no fuera Android → los respaldos de Drive se nombraban
   `..._Windows_latest.db` desde Linux.
4. **`isWindows` en `AsistenciaPage.svelte`**: caía siempre en la UI angosta
   (menú de marcado diario en vez de los popovers con selector de días,
   período predeterminado "diario" en vez de "mensual", modales de 320px).

### Reglas que quedan

- **NUNCA hardcodear el separador ni armar `file://` a mano.** Usar
  `separadorRuta()`, `unirRuta()` y `aFileURL()` de `src/lib/platform.ts`.
  `excel.ts` y `DebugPage.svelte` ya lo hacían bien con
  `carpeta.includes('\\') ? '\\' : '/'`; `platform.ts` lo centraliza.
- **Cambiar la plataforma del nombre del archivo de Drive implica volver la
  bútqueda agnóstica**: `findAnyExistingBackup()` busca cualquier
  `..._latest.db` (sin filtrar por plataforma) y `isLatestFile()` acepta
  cualquier plataforma. Si no, al guardar desde Linux no se encuentra el
  `..._Windows_latest.db` y se crea una cadena de respaldos paralela en cada
  guardado. Es el mismo modo de fallo que el GOTCHA de `accountTag()` de arriba.
- **`node_modules` es específico de plataforma**: copiado desde Windows solo
  trae `@rollup/rollup-win32-*`, `@esbuild/win32-x64` y
  `@tauri-apps/cli-win32-x64-msvc`, y `svelte-check` falla con *"Cannot find
  module @rollup/rollup-linux-x64-gnu"* en los 40 componentes. Siempre
  `npm install` en la máquina nueva, nunca copiar la carpeta.
- **Empaquetado**: `targets: "all"` incluye rpm y appimage, que necesitan
  `rpmbuild` y `patchelf`. El `deb` solo necesita `dpkg-deb` + `fakeroot`.
  `libayatana-appindicator3-0.1` NO hace falta (la app no usa tray icon).
- **GOTCHA de `git-filter-repo`**: al terminar hace `git reset --hard`, asi que
  **descarta cualquier cambio sin commitear**. Commitear antes de purgar.

## GOTCHA: el temporizador de `driveAutoBackup` estaba muerto (2026-10)

Síntoma: "al entrar a la app no se hace un respaldo automático". El scheduler
existía, arrancaba bien (`App.svelte` llama `driveAutoBackup.start()`) y logueaba
`[AutoBackup] scheduler iniciado`, pero **nunca colgaba un `setTimeout`**, así
que la "capa 1" (timer adaptativo) no corría nunca. Tampoco había ninguna UI que
lo mostrara, por eso era invisible.

**Causa**: el guard de `scheduleNextRun()` era

`ts
if (!isStarted || !isRunning) return;   // <- isRunning NO va aquí
`

`start()` hace `isRunning = false` y llama a `scheduleNextRun()` justo después,
así que el guard siempre cortaba. Peor: el `finally` de `runOnce()` también
rearmaba con `isRunning === false`, así que ni después de un disparo del timer
se reprogramaba el siguiente. Dos bugs más en el mismo archivo:

- `canRunNow()` **nunca miraba `state.enabled`**: apagar el respaldo automático en
  Ajustes solo limpiaba el timer, pero los triggers pasivos
  (boot/visibility/online/hidden) seguían empujando.
- El `catch` de `runOnce()` armaba un backoff de reintento (5/15/60 min) que el
  `finally` **pisaba** con el intervalo normal, dejando el reintento al ritmo
  normal.

**Corregido**: el guard es `if (!isStarted || !state.enabled) return;`, el
`finally` usa un flag `retryArmed` para no pisar el backoff, y `notifyTrigger` ya
no rearma dos veces (aplicaba el jitter doble).

⚠️ Para ejercitarlo sin Tauri, como los PDFs: copiar el módulo a un directorio
de prueba, redirigir sus 2 imports (`@tauri-apps/api/core` y `./driveSyncService`)
a stubs, `npx esbuild test.ts --bundle --platform=node --format=esm` y correr el
`.mjs`. **Instrumentar `globalThis.setTimeout` ANTES de importar el módulo** para
poder afirmar que hay un timer vivo: `nextRunAt` solo es un número, no prueba que
el `setTimeout` exista. En Node 24 `navigator` es getter de solo lectura, hay que
usar `Object.defineProperty` para redefinirlo.

**Los triggers pasivos NO deben reprogramar el timer**: si lo hicieran, cada
`visibilitychange`/`online` empujaría la fecha límite y el respaldo nunca
dispararía. Solo el camino `timer` rearma. Es intencionado.

**Ver**: Ajustes -> Depuración -> "Respaldo automático a Drive" muestra el estado
vivo (próxima subida, intervalo, último respaldo, subida totales, último error) y
un botón "Forzar respaldo ahora" que reporta el motivo si no sube
(`no_changes` / `throttled` / `disabled`).

## GOTCHA: Google BLOQUEA el login en WebViews embebidas (2026-10)

Síntoma en Linux: al tocar "Continuar con Google" se abre la ventana
`google-auth` y Google muestra **"Something went wrong"**. En Windows/macOS
funcionaba (WebView2/WebKit = Chromium/WebKit de sistema), pero en Windows el
WebView2 embebido obligaba a re-ingresar las credenciales (no comparte la
sesión de Google del navegador) y podía fallar igual por user agent. Hoy el
navegador del sistema es el camino en escritorio salvo macOS.

**No es un problema de configuración.** El `client_id` y el
`redirect_uri=http://localhost:51733/callback` son válidos: la misma URL pedida
con `curl` y un user agent de navegador devuelve `HTTP 302` a la pantalla de
login. Lo que falla es el **user agent embebido**: Google rechaza el login OAuth
dentro de WebViews (WebKitGTK en Linux) con `error=disallowed_useragent` /
`access_denied`, y su página de error es justamente "Something went wrong".

**Solución aplicada**: el login va por **navegador del sistema** en Linux
(`xdg-open`), en Windows y en el fallback de Android, y NO por WebView. El
código lo sigue capturando el servidor TCP de `127.0.0.1:51733` con polling,
que ya existía. En macOS se mantiene la WebView (WebKit del sistema).

| Plataforma | Login | Quién captura el código |
|---|---|---|
| Android | Google Sign-In nativo (Play Services) | `serverAuthCode` |
| Linux | **navegador del sistema** (`xdg-open`) | servidor TCP + polling |
| Windows | **navegador del sistema** (plugin `opener` → `rundll32` de respaldo) | servidor TCP + polling |
| macOS | WebView embebida | `on_navigation` + servidor TCP (redundancia) |

Ventaja extra del navegador del sistema: el usuario ya tiene la sesión de
Google abierta en Firefox/Chrome/Edge, así que no re-ingresa nada.

⚠️ **El comando se llama `gd_open_auth_webview` pero en Android/Linux/Windows
NO abre ninguna WebView** — abre el navegador. El nombre es histórico (el
frontend, `permissions/local-commands.toml` y los dos call sites lo referencian);
no lo renombrar sin actualizar los tres. La WebView embebida quedó como rama
`#[cfg(target_os = "macos")]` pura dentro de `gd_open_auth_webview`.

⚠️ **Al agregar Windows a la rama del navegador, la WebView dejó de compilar en
esa plataforma**, así que `extract_oauth_code_from_url`, `is_localhost_oauth_callback`
y `extract_oauth_error_from_url` quedaron `dead code` en Windows/Linux/Android:
conservan su `#[allow(dead_code)]`. `cargo check` en Windows no detecta los
problemas de cfg de Linux/macOS: para validar la estructura de `cfg` de un
comando en varias plataformas, compilar un stub con la misma forma de `cfg`
para `x86_64-unknown-linux-gnu`, `aarch64-linux-android` y
`x86_64-apple-darwin` (`rustup target add` + `rustc --emit=metadata`, que no
necesita linker).

⚠️ **El timeout del polling pasó de 120s a 300s** (`for _ in 0..1500`): con
navegador real el usuario puede tener que escribir su contraseña o pasar el
2FA, y eso tarda mucho más que la pantalla de consentimiento.

### Volver a la app sola cuando llega el código (`devolver_el_foco`)

⚠️ **GOTCHA: los cambios en Rust NO se ven con `npm run dev`.** Ese comando
solo levanta Vite y recarga el frontend. Para probar un cambio en
`src-tauri/src/**` hay que correr `npm run dev:win` (= `tauri dev`) o
recompilar el binario; si se prueba el `.exe` viejo, los síntomas son
confusos: "la app hace X" cuando en realidad el código nuevo ni se ejecutó
(a mí me pasó: el selector de navegador "no funcionaba" porque el binario era
anterior a que existiera el parámetro). **Los `println!` de Rust solo salen en
la terminal de `tauri dev`**; en el binario compilado no hay dónde verlos, así
que para diagnosticar en una build release hay que usar `console.warn` en el
frontend (DevTools oculta `console.debug` salvo nivel "Verbose").

Como el login ocurre en el navegador del sistema, el SO le roba el foco a la
app y el usuario queda mirando una pestaña que solo dice "Ya podés cerrar esta
pestana", con la app escondida detrás. `devolver_el_foco(&app, motivo)` la
restaura si estaba minimizada, la muestra si estaba oculta y le da el foco.
Se llama en los **cuatro** caminos de salida del polling:

| Momento | Por qué |
|---|---|
| código recibido (`gd_open_auth_webview`) | camino normal |
| cancelación (`oauth_cancel_flag`) | el usuario volvió a la app a cancelar; si estaba minimizada se restaura |
| timeout agotado | el usuario cerró la pestaña del navegador sin terminar |
| los 3 anteriores en `gd_wait_oauth_code` | polling de respaldo si el WebView se recargó (por eso ese comando ahora recibe `app: AppHandle`; **Tauri lo inyecta solo**, el frontend no cambia) |

⚠️ **En Windows, `set_focus()` solo no alcanza**: `SetForegroundWindow` está
restringido a procesos que ya tienen el foco, así que la ventana puede no subir.
El truco es `set_always_on_top(true)` → `set_focus()` → `set_always_on_top(false)`
(el primero la levanta por encima del navegador, el segundo la devuelve a su
z-order normal). Es lo que hacen los lanzadores y los Toasts, y va dentro de un
`#[cfg(target_os = "windows")]` para no tocar el comportamiento de Linux/macOS.

⚠️ **GOTCHA: los métodos de ventana de Tauri son round-trips SINCRÓNICOS al
event loop del SO.** `is_minimized`, `is_visible`, `show`, `unminimize`,
`set_focus` y `set_always_on_top` bloquean el hilo que los llama hasta que el
loop del SO responde. Y el lugar donde se ejecutan decide si eso es grave:

|Dónde se ejecuta | Si se cuelga, qué pasa |
|---|---|
| Directo en el comando | el `invoke` no resuelve nunca → el WelcomePage gira para siempre |
| En un `async_runtime::spawn` | **consume un worker de tokio para siempre** → los comandos `async` (`d1_sync_all`, `gd_snapshot_db`…) se quedan sin runtime y la app entera se cuelga |
| En un `std::thread::spawn` | un hilo dedicado queda colgado; no cuesta nada crítico |

Por eso `devolver_el_foco` usa `std::thread::spawn` y NO
`tauri::async_runtime::spawn`: los comandos `async` de Tauri corren en ese mismo
runtime, así que un worker bloqueado en un round-trip al event loop deja sin
servicio a todos los demás. La API quedó en dos capas:

- `devolver_el_foco(&app, motivo)` → `std::thread::spawn` con 120 ms de margen, y
  devuelve enseguida. El comando retorna el `code` sin depender del event loop.
- `traer_app_al_frente(&app, motivo)` → sí hace las llamadas de ventana, pero
  solo corre dentro de ese hilo.

Esto se descubrió por un síntoma muy confuso: "el login se cuelga en el
WelcomePage, pero si lo reintento funciona". Era una **carrera**, no un estado
persistente: si los round-trips al event loop respondían rápido, el comando
llegaba a `return Ok(code)`; si no, se quedaba trabado. Un bug que depende de
latencia hay que sospecharlo siempre de carrera.

⚠️ **Nunca hacer operaciones de ventana con un mutex tomado**. El primer intento
las tenía dentro del `guard` de `oauth_code_state()`, que compite con el
servidor TCP y con `gd_wait_oauth_code`. Ahora el `take()` va en un bloque
propio para soltar el lock antes de tocar la ventana:

```rust
let maybe_code = {
    let mut guard = oauth_code_state().lock()?;   // el guard muere en la llave de cierre
    guard.take()
};
if let Some(code) = maybe_code { devolver_el_foco(&app, "..."); return Ok(code); }
```

### El WelcomePage no se puede quedar colgado (`conTope`)

La fase de nube del restore (reconfigurar D1 + resync + `set_app_initialized`) es
todo red: una sola llamada sin resolver (cuota de Cloudflare, worker caído, un
endpoint sin desplegar) dejaba al usuario clavado en el spinner sin error ni
salida. `conTope(tarea, ms, motivo)` corre esa cadena con un tope de 40 s; si
vence, avisa y **se entra igual a la app**, porque el respaldo de Drive ya está
escrito en disco y la nube es opcional para arrancar. Si el tope venció antes de
`entrarALaApp`, se la vuelve a llamar (idempotente: `set_app_initialized` +
`welcome-complete`).

`Promise.race` **no cancela** la tarea perdedora: si termina después, su `catch`
propio ya no molesta, y por eso `tarea` maneja sus errores internamente.

Cada paso de la cadena deja un `console.warn('[Welcome] +X.Xs …')` con el tiempo
transcurrido: es la única forma de saber en release **dónde** se colgó, porque
los `println!` de Rust no se ven fuera de `tauri dev`.

⚠️ **No se puede detectar "el usuario cerró la pestaña"**: no hay evento de
navegador que lo diga. La app solo se entera por el timeout, que es el motivo
de traerla al frente también en ese camino.

### Elegir navegador para el login (`oauthBrowser.ts`)

**No es un bug de la app**: `gd_open_url_browser` abre con
`ShellExecuteExW` (plugin `opener` → crate `open` → `open::that_detached`), que
es exactamente lo que hay que hacer para respetar el navegador del usuario. Si se
abre Edge, es porque Windows lo pidió. Se puede verificar en la máquina:

```
HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice
   ProgId = "MSEdgeHTM"     <- el que gana
HKCU\...\UrlAssociations\http\UserChoice
   ProgId = "MSEdgeHTM"
```

Edge se auto-registra al instalarse y es el predeterminado de fábrica de
Windows 11, así que esa asociación sigue apuntando a Edge aunque la persona use
Firefox. **`http` y `https` son asociaciones SEPARADAS**: basta con que `https`
siga en Edge para que el login (que es `https://accounts.google.com`) se abra en
Edge, aunque `http` esté en Firefox.

Ajustes → General → "Navegador para iniciar sesión con Google" (solo escritorio)
deja elegir entre Predeterminado del sistema / Firefox / Chrome / Edge / Brave.
Se guarda en `localStorage['stp_navegador_login']` y viaja como
`invoke('gd_open_auth_webview', { url, browser })`. **Los dos call sites
(`cloudLogin.ts` y `CloudPage.svelte`) lo pasan con `navegadorLoginArg()`**; si
no se eligió nada devuelve `undefined`, `JSON.stringify` **borra las claves
`undefined`** y el payload sale sin `browser` → Rust recibe `None` → navegador
del sistema. Ese borrado es el comportamiento correcto, no un bug a
"arreglar".

⚠️ **GOTCHA: una opción que solo existe en Ajustes es inalcanzable si se
necesita ANTES de pasar el WelcomePage.** El login arranca en la portada, así
que un selector metido solo en Ajustes deja al usuario sin poder configurarlo
exactamente cuando lo necesita (que es cuando Windows le abre Edge). La opción se
monta en los DOS lados con el mismo componente, `src/svelte/BrowserPicker.svelte`
(`compacto` en la portada, una línea desplegable; completo en Ajustes, con la
nota de `http` vs `https`). **Regla: si un ajuste afecta al primer arranque, tiene
que existir también en el WelcomePage.**

⚠️ **Mostrar la ruta resuelta, no solo el nombre elegido**: el componente llama
`gd_resolve_browser` (devuelve el ejecutable que se va a usar, o `""`) y lo
muestra como "Se abrirá: `C:\...\firefox.exe`". Sin eso el usuario no tiene forma
de distinguir "no guardó la preferencia" de "eligió uno que no tiene instalado", y
ese es exactamente el debug que faltaba. No abre nada: solo informa.

⚠️ **Elegir navegador no puede romper el login**: `abrir_con_navegador()`
recorre candidatos con `Command::spawn` y, si ninguno arranca, se cae al
navegador del sistema con un `println!`. Un login en Edge es molesto; un login
imposible es un dispositivo inutilizable.

⚠️ **Chrome y Edge NO están en el PATH** de Windows, así que el nombre pelado
alcanza solo por installs atypicos. `candidatos_navegador()` prueba primero las
rutas absolutas con `%ProgramFiles%` / `%ProgramFiles(x86)%` /
`%LOCALAPPDATA%` y el nombre pelado al final. Verificado en la máquina de
desarrollo: Firefox existe en `C:\Program Files\Mozilla Firefox\firefox.exe` y
Edge en `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

⚠️ La resolución va solo en desktop (`#[cfg(not(target_os = "android"))]`): las
rutas candidatas son de Windows y en Android el "navegador del sistema" ya es el
único mecanismo.

⚠️ **GOTCHA de Svelte: dos expresiones `{…}` en el mismo atributo `style` rompe
el parseo** ("Unterminated regular expression"), sobre todo si el atributo
ocupa varias líneas y el `? :` empieza una línea. La solución fue mover el
estilo condicional a clases CSS (`.nav-btn` + `.nav-btn.activo`) en vez de
armar el `style` con un ternario. `svelte-check` lo reporta como
`js_parse_error`, no como error de template, y el mensaje no señala la causa.

**El scheme `schooltracker-auth://` SOLO está registrado en el
AndroidManifest.** En Linux el navegador no lo conoce y tras el login mostraría
una página de error "no hay aplicación asociada". Por eso el HTML de
respuesta del servidor TCP ahora es por plataforma: en Android redirige al
scheme y muestra el botón "Volver a la App"; en desktop muestra "Ya podés
cerrar esta pestana" y no redirige. El código ya quedó guardado en
`oauth_code_state()` en ambos casos, así que la app lo recupera igual.

**Diagnóstico**: `on_navigation` ahora loguea con `eprintln!` cuando la URL trae
`error=` (véase `extract_oauth_error_from_url`). Sin eso solo se veía la
pantalla de error de Google, sin saber el motivo. Para leerlo hay que correr
`npx tauri dev` y mirar la terminal (los `println!` de Rust no van a la consola
del navegador).

**GOTCHA al editar**: `format!("<a href=\"{}\" class=...")` — si el `\"` se
coloca después del `{}` en vez de antes, cierra el string antes de tiempo y
salta `unknown start of token: \`. Y `str::replace()` exige `&String`, no
`String`: `.replace("__X__", &boton_volver)`.

## GOTCHA: la cuota diaria de D1 se agotaba sin tocar nada (2026-10)

Síntoma: Cloudflare responde "daily quota exceeded" y el usuario jura que no
modificó nada. Con la base real (~7.960 filas sincronizables: 5.098 `nota`,
1.906 `asistencia`, 165 estudiantes, 447 `criterio`…), **12 pushes completos agotan
la cuota** (plan gratis = 100.000 filas escritas/día). Tres mecanismos disparaban
pushes completos solos:

1. **`d1_reset_device_id` anulaba los DOS cursores.** Se llama en
   `driveSyncService.downloadAndRestore()` (final de cada restore de Drive) y su
   propósito es solo renovar la identidad del dispositivo. Con
   `last_push_sync = NULL` el siguiente sync usa `push_since = "1970-01-01"` y
   reenvía **absolutamente todas** las filas. → Ahora pone solo
   `device_id` + `last_sync = NULL`; **`last_push_sync` no se toca jamás ahí**.
   - El PULL completo sí hace falta (el respaldo puede ser más viejo que la nube).
   - El PUSH no: esas filas ya están en D1 o hay versiones más nuevas, y
     reenviarlas además pisaría datos recientes (justo lo que el aviso de
     "respaldo más antiguo" intenta evitar).
2. **`WelcomePage.restoreFromDrive()` borraba la nube y re-subía todo**:
   `d1_reset_remote` + `d1_sync_all {full:true}` = ~16.000 operaciones de fila
   (7.960 de escritura) en cada primer login, sin que el usuario tocara nada.
3. **El runaway**: si el push fallaba, el `?` abortaba `d1_sync_all` ANTES del
   `UPDATE d1_config` final, así que `last_push_sync` quedaba en NULL y **cada
   trigger** (arranque, `visibilitychange`, `online`, cambio de pestaña,
   reconexión del WS, tick de 20 min) reintentaba el push completo. Un error
   puntual se convertía en el día entero de cuota.

### Freno de reintentos (nuevo)

`d1_config` gana `push_fail_count INTEGER` y `push_retry_after TEXT`
(agregadas en `migrate_add_columns` de `db.rs`). Al fallar un push se incrementa
el contador y se arma `push_retry_after = now + X` con
`PUSH_BACKOFF_MIN = [5, 15, 30, 60, 120, 240]` minutos (tope 4 h). Mientras haya
tiempo, `d1_sync_all` **omite el push y hace solo el pull** (lee, no escribe, no
gasta cuota); los cambios NO se pierden porque `last_push_sync` no avanza, así que
se reintentan al vencer la espera. Un sync que aplica bien limpia el freno.

`d1_sync_all` ganó el parámetro `force` (además de `full`): lo pasan los botones
manuales del usuario —"Sincronizar" en `CloudPage.syncD1()` y el sync post-import
de `DebugPage`— que si lo pidió explícitamente no esperan nada. **Nunca lo pases
en un trigger automático.**

El resultado ahora incluye `pushOmitido`, y `d1SyncService` lo traduce a un
mensaje en la card de Cloudflare ("Subida a la nube en pausa tras un error
anterior…") para que no parezca que los datos desaparecieron.

⚠️ **Cuando el push se omite, hay DOS cosas que NO pueden pasar** (y son la
trampa del diseño: el sync "termina bien" y da la impresión de que todo se
ordenó):

1. **`last_push_sync` NO avanza.** Si avanzara, los cambios locales que nunca
   llegaron a la nube quedarían marcados como "ya subidos" y el siguiente push
   incremental no los volvería a recoger → **pérdida silenciosa de datos**. La
   transacción final tiene una rama aparte para el caso `push_omitido` que solo
   actualiza `last_sync`.
2. **`clear_all_pending_deletions()` NO se llama.** Los borrados pendientes se
   mandan en el body del push; si el push no salió, borrar la lista local los
   pierde para siempre. La función está detrás de un `if !push_omitido`.

Los contadores del freno tampoco se limpian en ese camino (si no, la espera se
desarmaría en el mismo sync que la armó y el freno no frenaría nada).

### Evitar syncs de cuota sin cambios

- `d1_sync_all` no llama al endpoint `/push` si no hay filas nuevas ni borrados
  pendientes. Sigue haciendo `/pull` para recibir cambios remotos.
- El cursor `last_push_sync` avanza hasta la marca `updated_at` más nueva que
  realmente se incluyó en el push, además de la hora local actual. Así una fila
  con timestamp futuro (por reloj adelantado) no vuelve a seleccionarse en cada
  apertura.
- `buildUpsert()` en el Worker solo ejecuta `DO UPDATE` si cambió alguna columna
  de datos. `updated_at`, `device_id` y `sk` son metadatos re-sellados y no
  cuentan como cambio; un reenvío idéntico no escribe filas ni emite broadcast.
- `wsSyncService` es el dueño de los triggers pasivos de `visibilitychange` y
  `online`. No duplicarlos en `App.svelte`: el coalescer del sync no los elimina,
  sino que puede ejecutar un sync pendiente adicional tras el que ya está en vuelo.

### Merge en vez de wipe al restaurar Drive (nuevo)

`WelcomePage.sincronizarNubeTrasRestore()` consulta `d1_remote_stats` (endpoint
nuevo `/stats` del worker: `COUNT(*)` por tabla + tombstones, 1 petición) y
compara contra `contar_filas_sincronizables` (comando local):

| Estado de la nube | Acción | Costo |
|---|---|---|
| Tiene ≥50% de las filas locales | `d1_sync_all` (merge: push incremental + pull completo) | ~1 request, pocas escrituras |
| <50% y con tombstones | `d1_reset_remote` + `d1_sync_all {full, force}` | ~16.000 ops (solo cuando de verdad hace falta) |
| <50% sin tombstones | `d1_sync_all {full, force}` | ~8.000 escrituras |
| `/stats` falló | merge incremental (conservador: no borra nada) | barato |

⚠️ **No volver a poner el `d1_reset_remote` incondicional en el flujo de restore.**
Existe para el caso "tombstones residuales de la purga 2026-09", y `/stats` lo
detecta (tombstones > 0 con la nube vacía). Para una nube sana, el wipe es
destruir datos válidos para re-subir lo que ya estaba.

⚠️ **Los cursores son la economía del sync**: cada NULL en `last_push_sync`
significa "mandá todo". Antes de anular un cursor, preguntate si el fin es
identidad (`device_id`), reconciliación (`last_sync`) o recuperación real
(`full`). Solo el tercero justifica un push completo.

### Ejecutar este proyecto

Requiere `npx wrangler deploy` (el `/stats` nuevo no existe hasta que se despliega;
sin eso el merge cae al caso conservador y sigue funcionando, solo que no detecta
la nube vacía).

## GOTCHA: texto corrupto en el código fuente tras editar con PowerShell (2026-10)

Síntoma en la consola: los `[D1]` se ven bien pero aparece
`ðŸ”„ [DB] Inicializando base de datos...` y
`âœ… [DB] Base de datos inicializada correctamente`. OJO: **el problema NO es la
consola ni la config regional**, es el archivo. `src-tauri/src/db.rs` tenía el
texto **doblemente codificado en el código fuente** —59 ocurrencias en 50 líneas—
y es el resultado de un `Get-Content`/`Set-Content` de PowerShell sobre un
archivo UTF-8. Solo se nota en los `println!`/`eprintln!`, porque el resto son
comentarios.

Cómo se ve la firma de mojibake (UTF-8 leído como CP1252):

| Mojibake | Real | Qué pasó |
|---|---|---|
| `âœ…` | `✅` | `E2 9C 85` partido en 3 bytes CP1252 |
| `Ã­` / `Ã³` / `Ã¡` / `Ã±` | `í` `ó` `á` `ñ` | cada vocal acentuada, 2 bytes |
| `ðŸ”„` | un emoji de 4 bytes (surrogate pair) | `F0 9F xx xx` → 4 chars CP1252 |
| `Ã—` | `×` | `C3 97`, y `0x97` en CP1252 es `—` (em dash) |

Para recuperar el caracter original: codificar la tanda a CP1252 y decodificar
como UTF-8.

⚠️ **La herramienta `edit` NO puede hacer match de `─` (U+2500)** ni de otras
tandas de no-ASCII: el `oldString` hay que armarlo solo con ASCII, o el edit
falla con "Could not find oldString" aunque el texto exista (el `read` lo muestra
bien, lo que confunde y hace creer que el archivo cambió). Para una reparación
masiva de mojibake hay que ir por script: `ReadAllText(UTF8)` → reemplazar cada
tanda `[^\x00-\x7F]+` por su inverso CP1252→UTF-8 (**solo si decodifica limpio**;
el español correcto NO se toca, porque `í`→`ED` no forma UTF-8 válido) →
`WriteAllText` con `UTF8Encoding($false)`. NUNCA `Set-Content`.

⚠️ **Dos falsos positivos que hay que filtrar**, porque `[^\x00-\x7F]+` también
matchea texto sano: los guiones de caja `──` de los comentarios de sección (U+2500,
no existe en CP1252 → el `GetBytes` lanza y se deja igual, por diseño) y las
tandas mixtas `palabraÃ­` + acento legítimo (decodifican a algo inválido → también
se dejan). Por eso el criterio es "decodifica limpio", no "contiene caracteres
extraños".

⚠️ **Revisar `git diff --stat` antes de suspectar una reescritura masiva**: muestra 1 línea +/- por
línea tocada, no por carácter. Un `db.rs | 100 ++++----` con 50/50 son 50
caracteres reparados. Y verificar el resultado con un volcado de code points
(`"U+{0:X4}" -f [int]$_`), porque el `read`/`git diff` los renderizan y uno se
termina creyendo que el archivo sigue roto.

## GOTCHA: ícono genérico en el dock de COSMIC (2026-10)

Síntoma en Linux: la app corre pero el dock muestra el ícono genérico de
engranaje en vez del ícono real.

**Causa**: la app nunca estuvo *instalada*. Un binario suelto ( `./target/debug/...`)
no tiene entrada `.desktop`, y el dock de COSMIC no tiene nada con qué asociar la
ventana. No es un tema de imágenes.

**Instalación sin sudo** (Tauri genera el `.desktop` y los íconos correctos al
empaquetar, así que basta con extraer el `.deb` en `~/.local`):

`bash
npm run tauri build -- --debug --bundles deb
# o para el de release: npm run tauri build -- --bundles deb
dpkg-deb -x "src-tauri/target/{debug,release}/bundle/deb/School Tracker_*.deb" /tmp/x
install -Dm755 /tmp/x/usr/bin/school-tracker            ~/.local/bin/school-tracker
install -Dm644 "/tmp/x/usr/share/applications/School Tracker.desktop" \
             ~/.local/share/applications/school-tracker.desktop
# iconos: 32x32, 128x128 y 256x256@2 de /tmp/x/usr/share/icons/hicolor/
gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor
update-desktop-database ~/.local/share/applications
`

Con sudo alcanza con `sudo apt install ./School\ Tracker_*.deb`.

### Las tres piezas tienen que coincidir

| Pieza | Valor correcto | Cómo se comprueba |
|---|---|---|
| `app_id` de la ventana | `school-tracker` | `WAYLAND_DEBUG=1 app 2>&1 \| grep set_app_id` |
| `StartupWMClass` del `.desktop` | `school-tracker` | lo escribe Tauri desde el nombre del binario |
| `Icon=` | `school-tracker` | `python3 -c "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk; print(Gtk.IconTheme.get_default().lookup_icon('school-tracker',128,0).get_filename())"` |

El `.desktop` que genera Tauri tiene `StartupWMClass=school-tracker` (el **nombre del
binario**, NO el campo `identifier`). Ese es el que tiene que coincidir, así que no tocar.

### ¿POR QUÉ NO APARECÍ HASTA REINICIAR SESIÓN?

`cosmic-panel` lee las entradas `.desktop` **una sola vez al arrancar**. Se puede
comprobar que no las vigila: sus watches de inotify (en `/proc/<pid>/fdinfo`) son
solo `~/.config/cosmic/com.system76.CosmicPanel*/v1` y los directorios de tema.
Nada de `~/.local/share/applications` ni `/usr/share/applications`.

`bash
for f in /proc/$(pgrep -x cosmic-panel)/fdinfo/*; do
  grep -oE 'inotify wd:[0-9]+ ino:[0-9a-f]+' "$f"
done | sed 's/.*ino://' | while read i; do
  find ~ -maxdepth 5 -inum $((16#$i)) 2>/dev/null
done
`

Por eso un `.desktop` recién creado no aparece hasta que se reinicia el panel o la
sesión. No hay `update-desktop-database` que lo arregle.

### NO usar `app.enableGTKAppId`

Tauri 2.11 tiene ese flag (default `false`) y pone el `app_id` igual al campo
`identifier`, o sea `com.keimer.schooltracker`. Como el bundler escribe
`StartupWMClass=school-tracker`, el flag **rompe** la coincidencia. Además, con
`gtk::Application::new(Some(app_id))` la app registra un nombre en el bus de sesión
y se comporta de forma distinta. Probado con A/B: la app con el flag moría a los
10s en vez de los 30s.

### GOTCHA: `cargo build` a secas NO da un binario standalone

`tauri-codegen` decide con `dev: cfg!(not(feature = "custom-protocol"))`. Sin esa
feature, `dev = true` y el binario usa `devUrl` (`http://localhost:1420`) en vez de
embebir `frontendDist`. Escenario típico: `cargo build`, `./target/debug/school-tracker`
y la ventana en blanco porque no hay servidor de Vite corriendo.

Por eso `src-tauri/Cargo.toml` necesita la sección:

`toml
[features]
custom-protocol = ["tauri/custom-protocol"]
`

Sin ella `npm run tauri build` falla con *feature custom-protocol not found*.

**Para un binario que funcione standalone: `npm run tauri build`**, no `cargo build`.
Para desarrollo con ventana y HMR: `npx tauri dev` (que además levanta Vite).

## REGLA: datos personales y secretos NUNCA en git (2026-10)

El repo estuvo ~2 años con datos reales commitados. Se purgó todo el
historial con `git-filter-repo`, pero **cualquiera puede volver a colarlos**:

| Nunca commitear | Por qué |
|---|---|
| `*.db` / `*.sqlite` | La BD tiene los 163 estudiantes: nombre, código, teléfono, email, dirección, asistencia y notas |
| `Credenciales.xlsx` y cualquier `*.xlsx` con claves | El `schoolKey` + `workerUrl` de Cloudflare vivía en un `Credenciales.xlsx` commiteado |
| Cualquier API key o JWT en el código (`key = "eyJ..."`) | Se hallaron dos claves reales de proveedores ya retirados (una `service_role` de Postgres y un token de libSQL), ambas hardcodeadas en `lib.rs`. Una `service_role` es admin total. Jamás se hardcodea: va en `.env` o Secret Manager |
| `.wrangler/` | Estado local del CLI, nunca versionado |
| `target/` | Ver GOTCHA de `target/` en `.gitignore` (1 GB de build de Windows) |

Ya están en `.gitignore`. Si un `.db` aparece con datos de personas, tratarlo
como incidente: purgar con `git-filter-repo` **y rotar la credencial** que se
expuso. Borrar el archivo del working tree NO alcanza: sigue en el historial.

**Respaldo del historial antes de purgar** (fuera del repo, porque si queda una
rama o un tag el blob sigue siendo alcanzable):

`bash
git bundle create /tmp/rescate/historial.bundle --all
git branch -D backup-temporal   # si no, la purga no sirve
python3 /ruta/git-filter-repo --force --invert-paths --path "archivo"
# para contenido dentro de archivos que NO se pueden borrar (ej. lib.rs):
#   --replace-text (con un archivo de regex:PATRON==>REEMPLAZO)
`

## Archivos Android custom en gen/ (commiteados, NO auto-generados)

`src-tauri/gen/android/app/src/main/java/com/keimer/schooltracker/` contiene archivos
Kotlin que **NO son generados por Tauri** — son custom y se commitean a git:

| Archivo | Función |
|---------|---------|
| `MainActivity.kt` | Activity principal, Google Sign-In nativo, JNI bridge, orientación, PDF/share, `saveToDownloads()` |
| `DescargasSaver.kt` | Guarda archivos en Descargas PÚBLICAS vía `MediaStore.Downloads` (API 29+) sin permisos; API ≤28 copia directa |
| `AttendancePrefs.kt` | SharedPreferences para alarmas de asistencia |
| `AttendanceScheduler.kt` | Programación de alarma diaria (AlarmManager) |
| `AttendanceAlarmReceiver.kt` | BroadcastReceiver que dispara la alarma |
| `AttendanceDismissReceiver.kt` | Receiver para silenciar notificación del día |
| `AttendanceBootReceiver.kt` | Reprograma alarma tras reinicio del dispositivo |
| `SyncOnConnectWorker.kt` | WorkManager worker: sync D1 al recuperar conexión |
| `AttendanceNative.kt` | Puente JNI → Rust para consultar asistencia pendiente |

**GOTCHA**: al cambiar el `applicationId` (ej. `schooltrackerpro` → `schooltracker`),
estos archivos se mueven al nuevo paquete. SIEMPRE commitearlos antes de borrar
el directorio viejo. Si se pierden, hay que recrearlos manualmente (no existen en
git si no se commitearon). Dependencias en `build.gradle.kts`:
- `com.google.android.gms:play-services-auth:21.2.0` (Google Sign-In)
- `androidx.work:work-runtime:2.10.0` (WorkManager para SyncOnConnectWorker)

JNI symbols en `lib.rs` deben usar el package actual:
- `Java_com_keimer_schooltracker_MainActivity_initNativeBridge`
- `Java_com_keimer_schooltracker_AttendanceNative_queryAttendancePending`

El directorio `generated/` SÍ es auto-generado por Tauri y NO se commitea.

## Regla de modales unificados — Filtros en Android (2026-09)

Toda página con selects de catálogo (Año, Colegio, Grado, Sección, Sexo, etc.) en la
barra de filtros debe moverlos a un **modal dedicado en Android** para ahorrar
espacio vertical. Patrón (referencia: `src/svelte/AsistenciaPage.svelte`):

1. Detectar Android con `let isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));`
   (la variable ya existe en la mayoría de páginas).
2. Crear `let showFiltersModal = $state(false);`
3. En el `$effect` de back handlers, registrar el cierre por back de Android
   cuando el modal está abierto (igual que `popSemanaAbierta`).
4. En el snippet `filters` (o equivalente): envolver los selects de catálogo
   en `{#if isAndroidMobile}…botón que abre modal{:else}…selects inline{/if}`.
   El botón debe mostrar un resumen inline (`{colegio} · {sección}`) para que
   el usuario vea los filtros activos sin abrir el modal.
5. El modal usa `class="modal-overlay"` con `style="z-index:2000"` y un
   `class="modal-content category-card"` con `width:{modalCardWidth}` para
   mantener el estilo glass consistente con modales existentes. Cerrar con
   backdrop, botón ✕ y back de Android.

**NO aplica** a: Período (diario/semanal/mensual) ni selectores de fecha —
esos se quedan inline porque cambian el contenido principal de la página
y el usuario necesita verlos permanentemente.
⚠️ **SUPERADA (2026-10) por el riel inline.** `NotasPage`, `AsistenciaPage` y
`EstudiantesPage` ya NO abren modal de filtros: sus selectores de catálogo viven
en un riel inline de `<select>` (`FiltroRail`, ver "Estructura") con el MISMO
orden que la barra de escritorio (**Modo → Año → Corte → Colegio → Grado →
Sección → Sexo → Asignatura**; Asistencia mete Período + su control —fecha,
semana, mes— después de Año). El riel desarma la premisa de esta regla ("inline
cuesta altura"): ocupa lo mismo que el botón que abría el modal y ahorra el
rodeo. Sacar el `<select>` del modal NO revive el GOTCHA del cierre fantasma —ese
bug era del overlay del modal, no del select—. El componente
`FiltersModalAndroid.svelte` quedó sin consumidores; esta regla sigue vigente para
páginas NUEVAS que todavía no tengan riel.

### ⚠️ GOTCHA: un `<select>` dentro del modal lo cerraba solo (2026-10)

Síntoma: en Android, al tocar el desplegable de **Período** del modal de
filtros de `AsistenciaPage`, el modal se cerraba sin haber elegido nada.

**Causa raíz — dos piezas que se potencian:**

1. En el WebView de Android, un `<select>` **no se pinta como lista
   desplegable HTML**: se renderiza como un **popup nativo del sistema**, que
   es una ventana aparte. Cuando el usuario elige una opción y ese popup se
   cierra, el WebView re-despacha un evento sintético sobre lo que haya en esas
   coordenadas. El `target` de ese evento **ya no es el `<select>` original**:
   cae en el fondo del modal.
2. Ese evento sintético es un **`click`**, no un `pointerdown`: el `pointerdown`
   ocurrió *antes* de que se abriera el popup nativo, así que el único evento
   que sobrevive al cierre del popup es el `click`.

Como el overlay cerraba con `onclick={close}` y la única defensa era el
`stopPropagation()` del contenido, el evento fantasma llegaba al overlay y
cerraba el modal. Dependía al 100 % de que `stopPropagation` frenara un evento
cuyo target ni siquiera pasaba por el contenido.

**Fix aplicado en `FiltersModalAndroid.svelte`** (`cerrarEnFondo`), con dos
defensas independientes:

```svelte
<div class="modal-overlay" onpointerdown={cerrarEnFondo} style="z-index:2000">
```

```ts
function cerrarEnFondo(e: PointerEvent) {
  if (e.target === e.currentTarget) close();
}
```

- `pointerdown` en vez de `click`: el sintético del popup nativo es un `click`,
  así que escuchando `pointerdown` nunca llega.
- `e.target === e.currentTarget`: solo cierra si el toque es **directamente**
  sobre el fondo. Es el patrón que ya usaba el popover de semana en
  `AsistenciaPage.svelte` (línea ~1991), que por eso no tenía el bug.

**Regla**: en cualquier modal que contenga `<select>` y se toque en Android,
cerrar por `pointerdown` + `e.target === e.currentTarget`, nunca por
`onclick={close}` con `stopPropagation()` como única defensa. El fix cubre a
los tres consumidores del componente (`AsistenciaPage`, `NotasPage`,
`ReportesPage`).

## Comandos
- `npm run dev` — servidor Vite (frontend) en http://localhost:1420 (usado por Tauri dev).
- `npm run build` — typecheck (`tsc`) + `vite build` → `dist/`.
- `npm run tauri` / `npm run tauri build` — construir/ejecutar el binario Tauri (Rust).
- `npm run dev:android` / `dev:android:hot` — desarrollo en Android.
- Verificación Rust: `cd src-tauri && cargo check` (o `cargo build`).
- `npm run clean` — borra `dist/`, `src-tauri/target/` y
  `src-tauri/gen/schemas/` (dejando `node_modules`). Para recompilar desde cero.
- `npm run clean:all` — además borra `node_modules`. **Obligatorio al cambiar de
  plataforma**: los binarios nativos de `@rollup`, `@esbuild` y `@tauri-apps/cli`
  son del SO. Añade `-- --dry` a cualquiera de los dos para ver qué borraría sin
  borrar nada.
- Compilar el binario de Linux: `npm run build && cd src-tauri && cargo build --release`.
  Ojo: `bundle.targets` está en `"all"`, que en Linux quiere decir deb+rpm+appimage;
  rpm y appimage necesitan `rpmbuild` y `patchelf` (no instalados). Para solo deb:
  `npx tauri build --bundles deb`.

## Reglas para el agente (IA)

**NO HACER COMMITS**. Los commits los gestiona el usuario. El agente puede
preparar cambios, ejecutar verificaciones (`tsc`, `svelte-check`, `build`), pero
nunca debe ejecutar `git commit`, `git add` ni `git push`. Si el usuario quiere
un commit, se lo pedirá explícitamente.

## Tareas frecuentes (plantilla)
- **Agregar un campo a una tabla**: editar `CREATE TABLE` en `db.rs::init_database`.
  Si la columna puede faltar en bases existentes, añadir un `ALTER TABLE ... ADD COLUMN
  IF NOT EXISTS` en `migrate_add_columns` (db.rs).
- **Agregar un comando Rust**: función `#[tauri::command]` + registrar en `generate_handler!`
  (lib.rs) + llamarlo con `invoke(...)` desde el frontend.
- **Agregar tabla sincronizable**: crearla en `db.rs` (schema SQLite), y si debe
  participar en sync (pending deletions), definir su estrategia en `db.rs`.

## WelcomePage: 3 opciones de entrada + wizard con toggles (2026-09)

La portada quedó con **tres** tarjetas y nada más:

| # | Opción | Vista | Acción |
|---|--------|-------|--------|
| 1 | 📥 Continuar con Google | landing | `handleDriveLogin()` → `iniciarSesionGoogleConNube({skipSync:true})` → `restoreFromDrive()` |
| 2 | ☁️ Iniciar sesión y sincronizar | `view === 'cloud'` | `handleCloudLogin()` (restore autoritativo desde D1) |
| 3 | ✨ Empezar de cero | `view === 'wizard'` | Asistente de instalación |

⚠️ Se ELIMINARON los accesos secundarios de importar `.key` y `.db` de la
portada (2026-09, decisión del usuario). Consecuencia: un usuario que solo tenga
un `.key` o un `.db` ya no tiene salida desde el Welcome; si vuelve a hacer
falta, restaurar `importarArchivoConexion` / `importarBaseDatos` (se borraron
junto con sus imports `openDialog` y `readTextFile`).

**Opciones 1 y 2 son iguales salvo el ORIGEN de los datos**: ambas hacen login con
Google y obtienen el `schoolKey` automáticamente del Worker en `/auth` (NO se le
pide código al usuario). La 1 restaura el último archivo de Drive; la 2 hace
`d1_restore_from_cloud`. `handleDriveLogin` usa `skipSync:true` para no hacer un
sync con D1 que no aporta nada (la nube puede estar vacía); lo que restaura es
Drive. Se eliminó la vista intermedia `view === 'drive'` con el input de código.

**Opción 1 (Drive)**: pide el `schoolKey` (el "código" que viaja dentro del
`.key`) en un input monoespaciado. El orden importa: se configura D1 **antes**
de restaurar, porque si el pull corriera con la config vacía el Worker crearía
un schoolKey nuevo y se perdería el vínculo con los datos. La URL del worker sale
de `import.meta.env.VITE_D1_WORKER_URL` con el fallback que ya usa `pingWorker()`.

### Wizard: pasos y toggles

Orden: **Años → Asignaturas → Grados → Secciones → Colegios → Resumen**.
(Grados y Secciones se movieron antes de Colegios porque el tipo del colegio se
deduce de los grados marcados: si se pregunta colegio primero no hay con qué
deducirlo.)

- **Grados**: catálogo precargado 1er-11mo (`GRADOS_CATALOGO`), agrupado en
  Primaria (1-6) y Secundaria (7-11), con toggle "Todos" por grupo.
- **Secciones**: catálogo precargado `['A','B','C','D']` (decisión del usuario;
  antes se escribían a mano).
- Estado en `gradosMarcados` / `seccionesMarcadas` (arrays, ver Regla de Toggles).
  `currentItems()` los DERIVA para el resumen y la validación de avance, sin
  mutar estado durante el render.
- `tipoDesdeGrados` = `Secundaria` si algún grado marcado es de 7mo en adelante.
  Se aplica en `handleWizardComplete` como `colegios: inputColegios.map(c => ({...c, tipo: tipoDesdeGrados}))`.
- `sincronizarToggles()` refleja los toggles en `inputGrados`/`inputSecciones`
  justo antes de llamar a `seed_selected_data`.
- ⚠️ Se eliminó el auto-agregado de grados al crear un colegio: pisaba lo que el
  usuario había marcado a mano. El tipo ya no se elige con un segmented control.

## GOTCHA: el email de Drive NO puede depender de `userinfo` (2026-09)

`guardarSesionDrive` (cloudLogin.ts) consulta `oauth2/v2/userinfo` para guardar
`googleUserEmail`. **Si ese fetch falla** (típico en WebView Android, o cuando
el dev server de Vite se cae y recarga la página a mitad del flujo), los tokens
se guardan SIN email.

Consecuencia silenciosa: `accountTag()` (driveSyncService.ts) hace
`email || 'default'` → el tag queda `default` → `listSyncFiles` busca
`SchoolTracker_Sync_default_*` y **no encuentra los respaldos reales**, que se
llaman `SchoolTracker_Sync_<email_tag>_*`. El usuario ve "no hay respaldos" con
su backup intacto en Drive.

**Solución**: `iniciarSesionGoogleConNube` completa el perfil DESPUÉS de
`/auth`, usando `result.perfil.email` (que ya viene en la respuesta del Worker:
`perfil: { nombre, foto, email, rol }`). No depender de una segunda llamada de
red para algo que ya se sabe.

**GOTCHA relacionado**: `driveSyncService.pullAll()` retorna **en silencio** si
`listSyncFiles` viene vacío, sin lanzar error. Un caller que lo use como
"restauré bien" sigue adelante con la BD vacía. En WelcomePage se usa `pullById`
con el id del archivo ya elegido, que sí propaga el fallo.

## Regla de Toggles (2026-09) — NUNCA checkboxes

**Toda selección múltiple se hace con toggles, nunca con `<input type="checkbox">`.**
Un checkbox es un control de formulario: se hace clic, no se arrastra, ocupa poco y
no comunica su estado a un vistazo. Un toggle es un botón con estado visible (activo
= encendido con color de acento), que además se puede usar como chip, como tarjeta o
como píldora.

**Dónde SÍ se usa checkbox**: dentro de inputs de texto, para "mostrar contraseña",
o donde el control conventionally sea una casilla diminuta y el contexto sea claro.
En cualquier otro caso, toggle.

**Patrones que Replace al checkbox:**
| Contexto | Patrón |
|---|---|
| Catálogo con pocos elementos (secciones, grades) | Grid de tarjetas con toggle; la tarjeta entera es clicable y muestra el estado |
| Many items (asignaturas) | Chips toggle (`wizard-asig-chip`) con `class:active` |
| Opción única de un grupo | Segmented control (`wizard-tipo-segmented`) |
| Encabezado de un grupo | Toggle "todo" que prende/apaga el grupo completo |

**Implementación**: `class:active` + el estado en un array/objeto. Nunca
`bind:checked` con un checkbox. Estilo visual: `background` y `border-color` con el
color de acento cuando está activo; apagado con `rgba(255,255,255,0.04)`.

**GOTCHA**: el estado debe vivir en un array/objeto (p. ej. `seccionesMarcadas`) y no
en un atributo del DOM, para que Svelte 5 lo rastree. Con checkbox + `bind:checked` a
una variable suelta, los toggles quedan desincronizados al re-renderizar.

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
distinguirse visualmente. Este patrón se aplica en `ConfiguracionPage` y `AjustesPage`.

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

**Componente `CategoryTabContent` (Configuración):**
- Props: `accentColor: string`, `accentIcon: string`
- Header: `border-left: 3px solid {accentColor}` + icono circular `{accentColor}18` bg
- Botón "Agregar": gradiente `{accentColor}` → `{accentColor}dd`
- Hover: borde → `{accentColor}44`, sombra → `{accentColor}22`

**Mobile cards (Configuración/AjustesPage):**
```html
<button style="border-left: 3px solid {color}; ...">
  <div class="icon-circle" style="background: {color}18">{icon}</div>
  <span class="title">{label}</span>
  <span class="chevron">›</span>
</button>
```

**Desktop grid (Configuración):**
- Grid 3 columnas fijo (`repeat(3, 1fr)`)
- Responsive: 2 cols ≤1100px, 1 col ≤700px
- Cada `CategoryTabContent` recibe `accentColor` y `accentIcon`

**Regla**: Al crear una nueva página con secciones/categorías, usar siempre
el mapa de colores definido y pasar `accentColor`/`accentIcon` a los cards.

### Ajustes → General en Android: tarjetas compactas (2026-10)

La rama Android de `AjustesPage` (`tabActual === "configuracion"`) es una **columna
de tarjetas glass** (`section.and-settings` + `div.and-card`), una por bloque:
Apariencia (el snippet `appearanceSettings()`, COMPARTIDO con escritorio: una sola
presentación), Color de resaltado, Color por sexo, Notificaciones e Idioma.

- **Sin `category-card` externo.** Antes había un card con `padding:2rem` y cada
  bloque con `padding:1.5rem` encima: en un teléfono quedaban ~200px útiles y todo
  se veía "angosto". Ahora el padding lo aporta solo la tarjeta (`0.9rem`;
  `0.8rem` ≤520px) y el ancho es pleno.
- Encabezado uniforme por bloque con `.and-head` / `.and-head-icon` (34px) /
  `.and-head-text`, y piezas `.and-row`, `.and-swatch`, `.and-presets`,
  `.and-preset`, `.and-preview-box`, `.and-preview-chip`, `.and-btn`. Nada de
  estilos inline repetidos para el layout.
- Los textos del bloque de resaltado salieron de `t()` (antes estaban
  **hardcodeados en español**: "Personalización de Tabla de Notas", "Vista
  Previa"): ahora usan `ajustes.config.*`.
- ⚠️ El input `<input type="color">` de Android usa el id
  `highlight-color-picker-and` para no duplicar el `highlight-color-picker` del
  bloque de escritorio (con `!isAndroid` nunca coexisten, pero distintos ids
  evitan confusiones al editar).

### Debug, Info, Calificaciones y Multiplicadores: mismo lenguaje compacto (2026-10)

Las cuatro secciones del shell usan el patrón `class:compacto={isAndroid}` sobre
su `.category-card` (CSS SCOPED por componente, sin tocar markup entero):

- **Debug/Info (`.dbg-page.compacto`, `.info-page.compacto`)**: la cabecera del
  `.category-card` **SE CONSERVA** — en Android es el ÚNICO título de la
  sección (la rama Android de `AjustesPage` monta `<DebugPage />` pelado, sin
  heading). Lo que se compacta: `.dbg-body`/`.info-body` sin padding extra
  (`0 0.35rem`, gap `0.75rem`) y cada `.dbg-box`/`.info-box`/`.info-hero` como
  tarjeta glass con `padding: 0.9rem; border-radius: 16px`.
- **Calificaciones/Multiplicadores**: el padding interno `1.5rem 2rem` era
  INLINE (`style="padding:1.5rem 2rem"`); se movió a la clase `.cfg-body` para
  poder compactarlo desde el stylesheet SIN `!important` (CSS no pisa estilos
  inline). Compacto: `padding: 0.35rem`.
- ⚠️ La cabecera del `.category-card` no se puede ocultar en estas secciones:
  a diferencia de la lista de Configuración, aquí el shell no pone h1.
- ⚠️ App.css ya overridea `.category-card` en su media query móvil con
  `!important`; si un día se de-quiere el marco en Android, el `padding: 0`
  del compacto debe llevar `!important` también o lo pierde.

### Alertas de asistencia: la config vive en la BD (2026-10)

- Fuente de verdad: `app_settings` (clave `main`, tabla sincronizada por D1:
  `d1.rs`, worker `TABLES`). `notifEnabled` + `notifCfg` (mapa por colegio id →
  `{activo, inicio, fin, intervaloMin}`) ya están ahí.
- `src/lib/attendanceAlarm.ts` es el ÚNICO punto que deriva el payload nativo
  (`configDesdeSettings`) y arma/cancela la alarma (`aplicarAlarmaAsistencia`
  → `schedule_attendance_alarm`/`cancel_attendance_alarm`):
  - `NotificacionesPage.save()` llama al módulo (ya no repite la derivación ni
    escribe `localStorage` a mano: lo mantienen `appSettings.ts`).
  - `App.svelte` en el arranque (`loadAppSettings().then`, solo `isAndroid`)
    re-arma o cancela la alarma leyendo la BD. Antes la alarma SOLO se armaba
    al pulsar Guardar: el estado nativo quedaba desfasado y, si el localStorage
    del WebView se perdía, la UI mostraba las alertas desactivadas aunque la
    BD las conservara (el síntoma "se desactivan solas al reabrir la app").
  - `NotificacionesPage.loadSettings()` lee `loadAppSettings()` (BD) y solo cae
    al localStorage si la BD no trae config.
- La EJECUCIÓN de la alarma sigue siendo por-dispositivo
  (`AttendancePrefs.kt`): AlarmManager es local al equipo, NO va por D1; lo
  sincronizable es la CONFIG.
- El aviso "pendientes al abrir la app" (`avisarPendientesAlAbrir`) también lee
  la BD. Antes leía el localStorage con el FORMATO VIEJO (`colegios` = array de
  objetos contra un `Vec<i64>`, y `hora` que ya no existe) → el aviso estaba
  muerto en silencio.

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
   - **Android / Linux / Windows**: abre el **navegador del sistema** vía
     `tauri-plugin-opener` (`app.opener().open_url(...)`, con `xdg-open` /
     `rundll32` como respaldo) y **hace polling** de `oauth_code_state()`
     cada 200 ms (hasta 300 s). ⚠️ El path de Android con navegador es NO
     fiable en dispositivo real: Android congela el proceso en background y el
     TCP server no responde (por eso el flujo principal en Android es Google
     Sign-In nativo).
   - **Solo macOS**: crea una ventana WebView `"google-auth"` con el
     callback `on_navigation`. Si la URL contiene `code=` lo envía por canal; si es el
     callback localhost (`is_localhost_oauth_callback`) devuelve `true` para que la
     navegación ocurra y el **servidor TCP también lo capture** (respaldo). Cierra la
     ventana al recibir el código y detecta cierre manual por el usuario → "cancelada".
     ⚠️ Con navegador del sistema no se puede detectar "el usuario cerró la
     pestaña": el flujo queda esperando al timeout salvo que se pulse Cancelar
     (`gd_cancel_oauth`), que sí aborta el polling por el flag.
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
1. Frontend (`WelcomePage.handleDriveConnect` / `ModalNubeDrive.initGoogleAuth`) detecta
   Android → `invoke("gd_start_native_signin", { serverClientId })`.
2. Rust JNI (`obtain_native_bridge`) → `MainActivity.startGoogleSignIn(serverClientId)`
   → lanza intent de GoogleSignIn vía `googleSignInLauncher` (`registerForActivityResult`
   en `onCreate`). El selector nativo de Google se encarga de la elección de cuenta;
   no se llama `signOut()` asíncrono antes de lanzar el picker (era race condition:
   `signOut()` podía borrar la cuenta recién seleccionada entre el picker y
   `getLastSignedInAccount()` en `requestDriveToken`, dejando el segundo login sin
   sesión y sin forma de reintentar).
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

#### Credencial de DISPOSITIVO de Drive (2026-10) — el otro camino de Android

El `serverAuthCode` (paso 5) sirve para el **primer** login del WelcomePage, pero
tiene un techo: ese canje no puede pedir `access_type=offline`, así que Google solo
entrega el `refresh_token` en la PRIMERA autorización y la sesión moría a la hora.
Por eso la vinculación desde el modal de Drive ya **no canjea el código**: pide una
credencial de dispositivo, que Play Services reemite sola cuando vence.

| Pieza | Dónde |
|---|---|
| `requestDriveToken()` + `emitDriveTokenResult` + `takeLastDriveTokenResult` | `MainActivity.kt` (ejecutor propio: `getToken` es bloqueante con red) |
| `gd_request_drive_token` / `gd_take_drive_token_result` | `lib.rs` (JNI, patrón take) |
| Vinculación inicial | `ModalNubeDrive.pedirTokenNativo()` |
| Renovación automática (cuando el access vence) | `driveSyncService.tokenNativoAndroid()`, último recurso de `getValidToken` |

⚠️ **El scope NECESITA el prefijo `oauth2:`.** `GoogleAuthUtil.getToken` documenta
`scope` como *"a String representing the authentication scope, **prefixed with
`oauth2:`"*, y así es como decide el flujo la implementación de referencia
(`service.startsWith("oauth2:")` → si no, lo trata como un `service` heredado). Un
scope pelado (`https://www.googleapis.com/auth/drive.file`) hace que la petición NO
sea de OAuth2: `getToken` falla o devuelve algo que la API de Drive rechaza. **Es un
string, así que ni `tsc`, ni `cargo check`, ni `compileUniversalDebugKotlin` lo
detectan** — solo se ve en un dispositivo. Correcto:
`"oauth2:https://www.googleapis.com/auth/drive.file"` (y `requestScopes(Scope("https://…"))`
en el sign-in, que ahí SÍ va sin prefijo).

⚠️ **`drive.file` NO habilita `oauth2/v2/userinfo`.** Pedir el perfil con esa
credencial da 403. El email/nombre/foto salen del propio selector nativo
(`res.email` / `res.displayName` / `res.photoUrl`), así que `vincularConTokenNativo`
recibe el perfil COMPLETO y no llama a `fetchUserInfo` (era una petición muerta; en
escritorio sí se usa, porque ese OAuth pide además `userinfo.email`/`userinfo.profile`).

⚠️ **Cancelar no puede cerrar el selector nativo.** El bottom sheet de Google no se
cierra por código, así que su resultado llega igual después de "Cancelar". Sin el flag
`authCancelled`, el `while` del sondeo seguía escuchando y el login cancelado se
concretaba solo. Ahora `cancelAuth()` lo pone, el sondeo corta ANTES de consumir el
resultado (que queda en el slot nativo para el próximo intento) y
`handleGoogleNativeResult` lo descarta por el camino del evento.

⚠️ **Sin refresh token es lo NORMAL en Android**, no una sesión rota: el cartel
`sinRenovacionAutomatica` (que sí aplica en escritorio, donde el OAuth pide
`offline`) tiene que excluir Android o empuja a revincular en bucle justo después de
vincularse. Si la renovación falla de verdad, el aviso sale igual por
`sesionFallida === 'sin-refresh'`.

El error del picker se traduce con **`lib/googleSignInError.ts`** (`explicarSignInNativo`):
el `statusCode` 10 es `DEVELOPER_ERROR` y hay que decirlo explícito, porque es el
fallo más común (cliente OAuth de Android sin registrar en GCP con el paquete + SHA-1)
y un `(10)` pelado no dice nada. Lo usan los DOS call sites: `cloudLogin.ts` y
`ModalNubeDrive.svelte`.

### Dev Android / Windows — sesiones independientes (2026-08 / 2026-10)

Los dos entornos corren **simultáneamente sin pelearse por puertos**:

| Sesión | Comando | Vite | HMR |
|---|---|---|---|
| Windows | `npm run dev:win` (= `tauri dev`) | 1420 | 1421 |
| Android | `npm run dev:android` / `dev:android:hmr` (= `tauri android dev --host 127.0.0.1`) | **1422** | desactivado |

Cómo: `src-tauri/tauri.android.conf.json` fija directamente `"beforeDevCommand": "npx vite --port 1422"`
y `"devUrl": "http://localhost:1422"`. HMR está desactivado (`server.hmr: false`).

⚠️ **REGLA CRÍTICA EN WINDOWS: `tauri android dev --host 127.0.0.1`**:
En Windows, el CLI de Tauri por defecto sustituye el host por la dirección IP de red pública/LAN
de la PC (p. ej. `192.168.x.x`). El Firewall de Windows bloquea conexiones entrantes desde el teléfono
hacia esa IP LAN, provocando un timeout seguido de `custom protocol timed out` y la pantalla de error
`net::ERR_CONNECTION_REFUSED`. La opción `--host` requiere una dirección IP, por eso `localhost`
no es un valor válido; `127.0.0.1` conserva el acceso por loopback.
Para evitarlo y canalizar todo el tráfico a través del cable USB mediante ADB reverse (`adb reverse tcp:1422 tcp:1422`),
el comando **SIEMPRE debe llevar el flag `--host 127.0.0.1`** en `package.json`. No se requieren scripts
envoltorios (`scripts/vite-android.mjs` o `scripts/android-hmr.mjs` fueron eliminados por innecesarios).


**GOTCHAS**:
- Todos estos comandos deben estar en `src-tauri/permissions/local-commands.toml`
  (`commands.allow`) o `invoke` falla en runtime.
- En **dev Android el HMR de Vite está desactivado** (`vite.config.ts`:
  `server.hmr: false`).
- Asegurar que el reenvío de puertos USB esté activo si se reconecta el cable:
  `adb reverse tcp:1422 tcp:1422`.
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
- `AsistenciaPage.svelte` → `selectedStudentDetail` (detalle), `showSummaryModal`
  (resumen), `obsModalStudent` (observación) y `printHtml` (vista de impresión)
- `CloudPage.svelte` → eliminada; el cierre lo hace `modales/ModalBase.svelte`
  (`registerBackHandler` mientras el panel está abierto)
- `ConfiguracionPage.svelte` → vuelve a la lista desde una sección (`activa` a
  `null`; solo Android) y cierra primero los modales de catálogo abiertos
  (`colegioConfig` / `gradoConfig`). Además restaura el scroll de la lista, que
  se pierde porque al entrar a una sección la lista se desmonta entera.
  - ⚠️ **Al ABRIR una sección hay que volver el scroll ARRIBA** (`abrir()` hace
    `tick().then(() => sc.scrollTop = 0)`). El scroller es un ANCESTRO de la lista
    (el scroll no vive en la lista), así que al desmontarla **conserva su
    `scrollTop`**: sin el reset, la sección entraba "empezando" por donde estaba
    la lista — General abría en "Personalización de tabla de notas" y no en
    Apariencia/Tema. El reset va dentro del `tick` porque el contenido nuevo
    todavía no está montado; el `scrollerDe(listaRef)` sí sirve porque el ancestro
    sigue montado.
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
- Reconexión backoff 1s?30s; reintentos en online y 
isibilitychange.
- Ping cada 25s (respondido sin despertar el DO).
- Filtra avisos propios (rom === myDeviceId) — requiere IDs únicos (ver abajo).
- Debug: window.__wsDebug(); prefijo [WsSync-Debug] (console.debug).

### Disparadores de sync (todos terminan en syncAllSilent)

startup · WS aviso remoto · visibilitychange(foreground) · online ·
navegación entre tabs · tick periódico (input en CloudPage, min 3 min).
emitUpdates() SOLO si el sync trajo/aplicó cambios ? páginas refrescan en
sitio (listas con {#each … (est.id)} keyed: sin saltos de scroll).

### Aviso (toast) de sync en Android (2026-10)

`src/lib/d1SyncNotify.ts`: cuando un sync mueve datos, **solo en Android**, sale
un toast (el mismo `emit('show-toast', ...)` que usan las páginas, que pinta
`App.svelte`).

- Se llama **en un solo sitio**: dentro de `syncAllSilent`, y solo si
  `hadChanges`. No lo llames desde los triggers: es un aviso, no un
  orquestador, y regarlo por los triggers es cómo se termina avisando dos veces
  del mismo sync.
- **Solo si movió datos** (push, pull o borrados). Un tick sin cambios no avisa:
  con los triggers pasivos (visibilitychange, online, WS, tick de 20 min) el
  aviso saldría cada pocos minutos y perdería todo su valor.
- **Anti-spam calcado de `driveInstantBackup`**: mínimo 45 s entre avisos, y los
  que caen dentro de la ventana se consolidan en "{n} sincronizaciones". Es el
  otro flujo del proyecto que avisa "se subió/bajó algo" y ya tenía resuelto el
  mismo problema; miralo antes de inventar otra convención.
- Un **push omitido** por el freno de reintentos no se avisa: no salió nada, y
  avisar de una sincronización que no ocurrió es peor que no avisar. Si además
  hubo pull, los datos sí bajaron y el aviso sale igual.
- Claves i18n `d1n.*` en `es.ts` / `en.ts` (el tipado `Record<Clave,string>`
  obliga a traducir las dos).

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
  [WsSync-Debug]), Android  db logcat -s RustStdoutStderr (líneas [D1]
  sync INICIO/PUSH/PULL/FIN con cursores y contadores), servidor
  
px wrangler tail.

### Páginas fusionadas (sub-tabs) — patrón

src/svelte/asistencia/AsistenciaMainPage.svelte y
src/svelte/notas/NotasMainPage.svelte: wrappers con props
{ pageActive, subTabRequest }, siempre abren en el sub-tab principal salvo
subTabRequest (quick-actions del Dashboard mapean en App.handleTabChange:
'informe'→asistencia, 'reportes'→notas).
Hijos reciben `visible` para condicionar `registerBackHandler`. Swipe
horizontal Android alterna sub-tabs (ignora gestos sobre scroll-x propios o
modales fixed z=100).

**El conmutador de sub-tabs vive en la barra de FILTROS del hijo, no en el
wrapper** (`src/svelte/ModoToggle.svelte`, 2026-10). Antes cada wrapper dibujaba
una caja glass con dos botones arriba del contenido; apilada con el SearchFab y
con el FilterContainer eran TRES barras seguidas y la página se veía pesada.
Ahora es un `FilterGroup` más (etiqueta `comun.modo` = "Modo:") al inicio de la
fila, con el mismo alto que `.filter-select`, y `activeSub` sigue viviendo en el
wrapper: el hijo solo avisa por `onModoChange`.

- `AsistenciaPage` y `NotasPage` reciben `modo` + `onModoChange` (cada uno sabe
  cuáles son SUS ids). Antes NotasPage/ReportesPage usaban el prop `subTab`: se
  renombró a `modo` al fusionarlos.
- Etiquetas cortas: `subtab.tomarCorto` ("Asistencia") / `subtab.informe` y
  `subtab.registrarCorto` ("Notas") / `subtab.reportes`. Las largas
  (`tomarAsistencia`, `registrar`) son el `title`/tooltip de cada opción.
- ✅ **CAMBIÓ (2026-10): el modo es igual que en Windows.** El `ModoToggle` es
  visible TAMBIÉN en Android (variante `grande`, primera pieza del header/riel) y
  el **swipe horizontal se eliminó** en `NotasMainPage` Y `AsistenciaMainPage`.
  Antes Android no tenía ningún control visible del modo (solo swipe), y el
  swipe se **ignoraba** cuando iniciaba en una zona con `overflow-x` propio
  (chips mensuales, filas semanales, tablas anchas): en esas zonas no había forma
  de cambiar de modo. Ahora el control está siempre visible, con el mismo
  componente que escritorio.
- ⚠️ No volver a agregar una barra de sub-tabs en el wrapper: es exactamente lo
  que se quitó (tres barras seguidas sobre los filtros). Si un wrapper
  necesita un control propio, que sea flotante y solo para desktop.

**Los dos wrappers montan UN SOLO hijo** (mismo patrón desde 2026-10):

| Wrapper | Hijos | Por qué |
|---|---|---|
| `AsistenciaMainPage` | `<AsistenciaPage modo={activeSub} onModoChange={switchTo} visible={pageActive} />` | los dos modos son el mismo componente (ver abajo) |
| `NotasMainPage` | `<NotasPage modo={activeSub} onModoChange={switchTo} visible={pageActive} />` | ídem: `ReportesPage` se absorbió dentro de `NotasPage` |

⚠️ `visible` es **la página a la vista**, no "soy el sub-tab activo". Un solo
componente con dos mitades no puede tener dos `visible` distintos, y no le hace
falta: cambiar de modo ya no dispara el refresco al volver a verse (que antes
recargaba en silencio la mitad que entraba). Ese refresco sigue pasando al
reingresar a la página desde otra pestaña, que es cuando de verdad hay datos
nuevos.

#### `AsistenciaPage` con `modo: 'tomar' | 'informe'` (2026-10)

`InformePage.svelte` (~1400 líneas) **se eliminó** y su contenido se mudó a
`AsistenciaPage`: eran ~39 % de código duplicado (tabla, filtros, estadísticas,
modales de detalle/resumen). Un solo `modo` prop decide si se escribe o solo se
lee. Lo que los separa:

- **`enInforme`** = `$derived(modo === 'informe')`. Gatea: `onclick` de celdas y
  chips (`onclick={enInforme ? undefined : () => cicloEstado(...)}`), la fila de
  acciones (imprimir/exportar vs Sin Clases/Limpiar/Rellenar/Guardar),
  `handleFilterChange` (en informe no hay borradores que preguntar) y los
  encabezados de fecha (sin `clickHeaderFecha` ni el tooltip "Click para marcar").
- **`periodoEfectivo`** = `$derived(enInforme && periodo === 'diario' ? 'semanal' : periodo)`.
  El informe no ofrece "Diario". **Todas** las comparaciones del archivo usan
  `periodoEfectivo`; `periodo` crudo solo se lee en el init, en el `void` del
  effect, en `localStorage.setItem` y en el `onchange` del select. Así volver a
  Tomar asistencia restaura el "diario" del usuario.
- **Mes cortado en HOY**: `getFechasPeriodo()` trunca el mes en curso cuando
  `enInforme` (no anunciar días sin datos). En semanal ambos modos usan la semana
  completa.
- **Estadísticas**: `getStats`/`totalEstudiantes`/`totalM`/`totalF`/`asistenciaPct`
  leen `filteredEstudiantes`; `getMultiStats`/`totalPosibleMulti` leen
  `filteredEstudiantesMulti`. Cambiar un filtro cambia las tarjetas.
- **Datos**: en informe la tabla se renderiza desde `estudiantesMulti`
  (mismas filas que `get_asistencia_rango`, verificadas en `db.rs:4756/4842`);
  `reporte`/`fetchReporte`/`getEstadoEnFecha` desaparecieron.
- **Export/PDF mantienen su propio fetch** (`exportarPdfAsistencia` llama
  `get_asistencia_rango` por cada pareja colegio×grado×sección): su alcance es
  TODOS los colegios, no el filtro en pantalla.
- **Refresco al cambiar de modo**: un `$effect` con el patrón `wasModo` cierra
  los popovers de ambos modos y re-carga con el rango nuevo (el mes cortado en
  hoy es distinto). Los effects con deps explícitas llevan `void modo;`.
- **`visible`** ahora significa "la página está a la vista" para LOS DOS modos, no
  "estoy en el sub-tab tomar".
- **Layout Android (2026-10)**: los filtros de catálogo viven en el riel inline
  `FiltroRail` (se eliminó `FiltersModalAndroid` de esta página) con el orden de
  escritorio: **Año → Período → [fecha/semana/mes] → Colegio → Grado → Sección →
  Sexo**. El modo usa el mismo `ModoToggle` que escritorio (variante `grande`, en
  su propia fila) y el swipe del wrapper se eliminó (ver `AsistenciaMainPage`).
  - El control de período en el riel Android es nativo (`<select>` de mes y de
    semana) en vez del popover de escritorio: en el WebView el `<select>` abre el
    popup del sistema y así no hay que duplicar el `pop-wrap`. El **DatePicker de
    diario vive SOLO en el riel**, como una celda normal de la rejilla (va justo
    después del selector de Período y usa `.rail-fecha` para igualar la altura/
    tipografía de los `<select>`), que es donde está en escritorio (es un filtro).
    Antes quedaba además en la fila de acciones → **se veía duplicado**.
  - La fila de acciones `.android-actions` es una **rejilla**, no un flex que
    envuelve ni un scroll lateral: en Android es **2 columnas (2×2)** —con
    `class:acc-grid` y las reglas `:global(.btn-mod…)` en el `<style>` de la
    página, en vez de reusar `<BtnRail>` porque la fila comparte markup con
    escritorio y lleva el `pop-wrap` + su popover portalado—, y en escritorio
    sigue siendo el flex de siempre. Además, **Guardar se renderiza en TODOS los
    períodos** en Android: antes solo salía en diario, así que en semanal/mensual
    el borrador de `draftMulti` no tenía forma de persistirse desde el teléfono
    (era un bug real, no un rediseño). El estado `dpAbierto` (que existía para
    desactivar el `overflow-x` mientras el DatePicker estaba abierto) se eliminó
    junto con el DatePicker duplicado.
  - **La tarjeta semanal Android usa `fechasVisibles`, no `fechasPeriodo`**
    (2026-10). Listaba `fechasPeriodo` en un `overflow-x:auto` con
    `min-width:68px` por día: el día marcado sin clases aparecía **marcable** (no
    seguía la convención de escritorio) y las columnas no entraban en el panel.
    Ahora recorre `fechasVisibles` —igual que la tabla de escritorio— y los días
    `fv.sinClases` se pintan con un chip 🚫 **no marcable** (nunca un `P/A/J`).
    Las columnas van con **`flex:1 1 0;min-width:0`** (reparten el ancho del panel
    y quedan centradas), no con scroll lateral.
  - **La tarjeta mensual Android agrupa por semana pero en UNA fila horizontal**
    (2026-10). Antes listaba `fechasPeriodo` en una sola fila con scroll
    (`mensual-chip-row`). Se itera **`semanasMes`** (mismo corte por el primer día
    hábil del colegio que la tabla de escritorio), pero **los días siguen en una
    única línea horizontal con scroll**, no en una fila por semana: la semana se
    marca con la píldora `S{n}` y un separador vertical a su izquierda
    (`.mensual-semana-grupo`). ⚠️ Poner cada semana en su propia fila (flex-column)
    deja los días **apilados en vertical**, que es justo lo que NO se quiere: la
    referencia es la tabla de escritorio, que es una sola línea horizontal.
  - **Los chips 🚫 son REACTIVABLES en ambas tarjetas** (2026-10). Tocar el chip de
    un día sin clases llama `desactivarSinClases([fecha])` (con su confirmación),
    el mismo gesto que el clic en el encabezado de la columna en escritorio. En
    `enInforme` (solo lectura) van `cursor:default` y sin `onclick`. El chip mensual
    lleva el 🚫 **inline, al lado del número** (`.mensual-chip.conf-sin-clases` con
    `width:auto`), no como `::after`: la fila tiene `overflow-x:auto` y eso hace que
    `overflow-y` compute a `auto`, así que un pseudo-elemento que sobresalga del chip
    se ve **entrecortado**.
    **Regla**: un día sin clases NUNCA se pinta como celda marcable; se pinta 🚫 y
    se usa para reactivar, no para marcar P/A/J.
  - **`fechasPeriodo` es `$derived`, no `$state`** (2026-10). Se llenaba dentro de
    `fetchEstudiantesMulti`, que corre en `untrack()`: al entrar a semanal/mensual
    la carga de estudiantes leía los `diasSinClases` **viejos**, el día sin clases
    entraba en la lista y solo se corregía al recargar el período. Como `$derived`
    (`getDiasHabilitados(getFechasPeriodo())`) reacciona a `diasSinClases` y
    `colegioConfig`. Regla: **si un valor depende de `diasSinClases`, tiene que ser
    `$derived` o recalcularse al cambiar las marcas, nunca asignarse dentro de un
    fetch que va en `untrack()`**.
  - **El banner `panelSinClases` tiene una variante COMPACTA en Android** (2026-10).
    El de escritorio (con `min-width:220px` en el texto, `padding:.7rem .9rem` y el
    botón "♻️ Reactivar clases" ancho) se comía un pedazo grande de la pantalla. En
    Android va **ícono + título (a lo sumo 2 líneas) + alcance/motivo en un renglón
    truncado**, y "Reactivar" como **botón ícono** (♻️). Se elige con
    `{#if isAndroidMobile}` dentro del MISMO snippet para que la información sea
    idéntica en las dos plataformas.

⚠️ `AsistenciaMainPage` **no** debe volver al montaje perezoso por sub-tab: con un
solo hijo no hay nada que montar por separado, y `display:none` por sub-tab
perdería el draft y el scroll del modo que se dejó.

**Refrescos silenciosos sin perder posición**: listas con each KEYED
((est.id)); NotasPage preserva currentStudentIdx en el refresh silencioso;
nunca reconstruir toda la lista sin clave (salta scroll al inicio).

#### `NotasPage` con `modo: 'registrar' | 'reportes'` (2026-10)

`ReportesPage.svelte` (~1500 líneas) **se eliminó** y su contenido se mudó a
`NotasPage`: eran ~40 % de código que ahora vive en un solo componente. Un solo
`modo` prop decide si se **escribe** ("registrar") o solo se **lee** ("reportes").
Lo que los separa:

- **`enReporte`** = `$derived(modo === 'reportes')`. Gatea: todo el flujo de
  escritura (handlers de celdas, popovers de edición, botón Guardar, deshacer,
  distribución masiva, instrumentos) está envuelto en `{#if !enReporte}`. El
  modo "reportes" es **estrictamente de solo lectura**.
- **Estado de filtros totalmente independiente**: ambas mitades mantienen sus
  propios `repSelected*` / `selected*`. Cambiar de modo restaura exactamente
  lo que cada uno tenía seleccionado; el borrador escrito en "registrar"
  sobrevive al viaje por "reportes" sin recargar.
- **Catálogos compartidos (solo lectura)**: `gradeConfigs`, `multiplicadores`,
  `notaMapping`, `qualitativeWeights`, `reverseQualitativeWeights`,
  `calcularNotaCualitativaFinal`, `searchTerm`, `showAnoDropdown` son
  **una sola copia**. Los fetches de catálogos (años, cortes, colegios,
  asignaturas, grados, secciones) **no** se comparten: cada mitad tiene sus
  propios `repAnos` / `anos`, etc., porque la lógica de selección/reseteo
  difiere (reportes siempre setea el activo; registrar preserva lo que el
  usuario eligió).
- **`visible`** es **la página a la vista**, no "soy el sub-tab activo". Un
  solo componente con dos mitades no puede tener dos `visible` distintos, y
  no le hace falta: cambiar de modo **ya no dispara el refresco** al volver a
  verse (que antes recargaba en silencio la mitad que entraba). Ese refresco
  sigue pasando al reingresar a la página desde otra pestaña, que es cuando
  de verdad hay datos nuevos.
- **Swipe en Android**: idéntico a `AsistenciaPage` — el wrapper
  (`NotasMainPage`) maneja el gesto; en escritorio el `ModoToggle` de la
  barra de filtros lo hace.

##### El reporte tiene DOS presentaciones, según la geometría (2026-10)

| Geometría | Presentación | Por qué |
|---|---|---|
| Android en **vertical** | `.rep-boleta`: una tarjeta por estudiante (nombre + NF + chips `Ind. N`) | la tabla de 7 columnas (nombre + hasta 5 indicadores + NF) necesita `min-width:max-content`, así que en ~380px obliga a scroll horizontal y solo se ven 2 columnas: leer la fila de un estudiante es ir y volver |
| Escritorio y Android en **horizontal** | `.rep-tabla` de siempre | ahí sí hay ancho para las 7 columnas, y es de donde sale el PDF/impresión |

- El interruptor es `repEsBoleta = $derived(repIsAndroidMobile && repEsPortrait)`;
  `repEsPortrait` se recalcula en el `checkMobile` que ya escuchaba `resize`
  (rotar en Android lo dispara, no hace falta un listener propio).
- ⚠️ Esto **no revierte** el commit `bde8320` ("mobile report view to use a table
  layout"). Aquel cambio quitó una lista de tarjetas que era un **segundo
  componente con su propia carga de datos**. La boleta es el mismo
  `filteredReporte` con los mismos helpers (`getNoteColor`,
  `getIndicatorMaxScore`, `colorSexo`, `totalPuntajeMaximoConfig`), y con
  `specialCorte` oculta los chips igual que la tabla oculta las columnas.
  **No crear un componente aparte ni volver a consultar la BD para la boleta.**
- Las estadísticas viven en un `{#snippet estadisticasReporte(kpi)}` porque se
  pintan en dos sitios: con la boleta van ARRIBA como tira de KPIs horizontal
  (`.kpi-strip`: una sola línea, `overflow-x`, etiquetas a `.68rem`) y con la
  tabla van DEBAJO como la grilla de siempre. Duplicar el markup es como se
  desincronizan las dos vistas.
- El `#each` de la boleta va **keyed** por `estudiante.id` (refrescos silenciosos
  sin perder scroll), igual que las listas de asistencia.
- ⚠️ Se **quitó** el parche `.table-card{min-height:45dvh}` del bug "el reporte
  se ve como una card comprimida": en vertical ya no se dibuja la tabla, así que
  no hay dos bloques compitiendo por la misma altura. No volver a agregarlo; si
  la tabla se aplasta, el problema es la competencia de alturas (ver el
  `@media (max-width:1024px)` de `NotasPage`), no la falta de un piso.
- ⚠️ En el MARKUP solo valen los comentarios `<!-- -->`. Un `{# ... #}` o un
  `/* ... */` se compilan como nodo de texto y el usuario ve el comentario
  impreso (mismo GOTCHA que en `AsistenciaPage`).

⚠️ `NotasMainPage` **no** debe volver al montaje perezoso por sub-tab: con un
solo hijo no hay nada que montar por separado, y `display:none` por sub-tab
perdería el draft de "registrar" y el estado de "reportes".

**Refrescos silenciosos sin perder posición**: listas con each KEYED
((est.id)); NotasPage preserva `currentStudentIdx` en el refresh silencioso;
nunca reconstruir toda la lista sin clave (salta scroll al inicio).

##### Layout Android de `NotasPage`: riel de filtros, bandas fusionadas y pestañas de indicador (2026-10)

El chrome de `registrar` en Android eran **5 tarjetas apiladas** (buscador,
botón de filtros, acciones, navegación de estudiante, Nota Final) ≈ **300px**
sobre los ~712px útiles: ~42 % de la pantalla antes de ver una nota. Ahora son
unas **4 filas compactas** (riel de filtros que envuelve + 2 filas de botones +
la barra de estudiante).

Qué se cambió (aplica a `registrar` y `reportes`):

1. **Los filtros de catálogo ya NO van en un modal**; van en el riel inline
   compartido `FiltroRail` (rejilla de `<select>`). Lo que empezó como excepción
   para `NotasPage` es hoy la REGLA: `AsistenciaPage` y `EstudiantesPage` usan el
   mismo componente (ver "Regla de modales unificados" más abajo).
   - La premisa del modal era "inline cuesta espacio vertical". El riel compacto
     **desarma la premisa**: ocupa lo mismo que ocupaba el botón que abría el
     modal, y ahorra el rodeo Filtros → elegir → Aplicar.
   - Sacarlos del modal **no** reintroduce el GOTCHA del "cierre fantasma": ese
     bug era del overlay (el `click` sintético del popup nativo caía en el
     fondo), no del `<select>`. Inline el popup nativo queda sobre la página y
     no hay overlay que se cierre.
   - `NotasPage` es la página con **más** chrome de la app (6 filtros + corte +
     asignatura + 4 acciones), por eso fue la primera.
   - ⚠️ El orden de los `<select>` es el de ESCRITORIO (**Año → Corte → Colegio →
     Grado → Sección → Sexo → Asignatura**): el Corte va ANTES del Colegio, que
     es la corrección pedida por el usuario (2026-10). No reordenar "por lógica de
     dependencia" (colegio antes de grado): la vista manda.
   - ⚠️ El riel es una **rejilla que ENVUELVE** (`display:grid` +
     `repeat(auto-fit,minmax(84px,1fr))`), **no** un `flex` de una sola fila con
     `overflow-x`. Con `overflow-x` en un teléfono de 360px solo quedaban ~3 de
     los 7 selects a la vista: los de la derecha existían pero no se descubrían
     (nada indicaba que hubiera más). La rejilla pone ~4 por fila → **2 filas** y
     se ven todos; cuesta ~40px más y los `<select>` llevan
     `width:100%;min-width:0;text-overflow:ellipsis` (el ancho lo manda la
     columna, no el `option` más largo como en el `<select>` suelto).
2. **Las filas de utilería dejaron de ser tarjetas**: buscador y acciones ya no
   llevan `class="category-card"` (`.acciones-rail`), así no pagan `padding` +
   `margin` + marco cada una.
2b. **Las acciones son DOS filas de 3 botones** (`.btn-rail`, otra rejilla de 3
   columnas), sin el botón `⋯`. En Android el `⋯` abría un popover con tres
   opciones (Instrumentos / Distribuir / Eliminar notas) y esas tres bajaron a
   una segunda fila junto a Guardar / Deshacer / Rehacer, con su mismo ícono,
   tono (`azul`/`violeta`/`rojo`) y `sub`. Así las 6 acciones se ven de entrada,
   sin abrir nada.
   - ⚠️ El `⋯` + popover **sigue existiendo para escritorio** (mismo `popAcciones`
     / `togglePopAcciones`): solo se quitó del branch Android. No borrar el
     estado ni el panel `{#if popAcciones}` sin revisar el branch de escritorio.
   - ⚠️ Las reglas de `.btn-rail` necesitan `:global(.btn-mod…)`: `.btn-mod` es el
     nodo raíz de `BotonMod` y **no lleva el hash de scope** de `NotasPage`, así
     que un selector `.btn-rail .btn-mod` pelado no matchea. El `min-width:0` en el
     botón es lo que deja que la etiqueta se recorte con elipsis en vez de forzar
     la columna a crecer (grid usa el `min-content` del ítem como mínimo).
   - Los botones van **sin `compacto`**: ese prop inyecta `padding` en el `style`
     en línea y ganaría al padding reducido del CSS.
3. **Estudiante + Nota Final son UNA caja de DOS filas**
   (`.notas-barra-estudiante`, hoy `flex-direction:column`): primero la fila de
   navegación (◀ / nombre / ▶) y debajo la Nota Final (`.nf-est`), las dos a ancho
   completo. Antes eran dos tarjetas apiladas (~125px) y después se fusionaron en
   UNA fila (~52px), pero **el nombre se recortaba con elipsis** (`white-space:nowrap`
   + `text-overflow:ellipsis`) y la NF le robaba ancho.
   - ⚠️ El nombre del carrusel lleva `white-space:normal` + `overflow-wrap:anywhere`
     **a propósito**: un nombre largo envuelve a 2 líneas en vez de recortarse, y por
     eso la NF vive en su propia fila (si volviera a la misma fila competirían por el
     ancho y uno de los dos se recorta). No volver a fusionarlas en una sola fila.
4. **Los indicadores son PESTAÑAS, no un scroll vertical** (`.ind-tabs` +
   `.ind-tab`). Con 1-3 criterios por indicador, uno solo entra holgado en el
   área: en vez de apilar los 5 (bajar hasta el 5to era el viaje) se salta con
   un tap. El punto de cada pestaña lleva el color de la nota del indicador.
   - ⚠️ **NO convertir esto en carrusel con swipe**: el modo tiene su control
     visible (`ModoToggle`) y las pestañas se eligen con tap. Un swipe aquí no
     compite con nada, pero se descartó por la razón de más abajo (en Android ya
     no hay gestos de swipe).
   - El estado es `indicadorSelId` (**el `id`, no el índice**): al cambiar de
     asignatura/corte `indicadoresSeccion` se reconstruye entero y un índice
     quedaría apuntando a otro indicador (o fuera de rango). Con el `id` la
     pestaña activa sobrevive y cae al primero si desaparece.
   - **NO se resetea al cambiar de estudiante**: el flujo real es "cargo el
     indicador 2 a todos"; si saltar de alumno volviera al indicador 1, cada uno
     costaría una pestaña extra.
5. **`resumenIndicador(estudianteId, ind)`** centraliza el cálculo
   (total/máximo/escala/sigla/color) que antes estaba **duplicado en dos IIFE**
   distintas del markup (una para el color, otra para el texto). Ahora lo usan
   las pestañas y el encabezado del indicador abierto.
6. **El modo (`ModoToggle`) es visible en Android, igual que en escritorio, y el
   SWIPE se eliminó** (2026-10). Antes en Android el único control del modo era el
   swipe horizontal del wrapper. Ahora `NotasPage` dibuja el MISMO `ModoToggle`
   que el branch de escritorio (variante `grande`, fila propia, primera pieza del
   header sticky de cada uno de los dos branches: `registrar` y `reportes`) y
   `NotasMainPage` **ya no tiene handlers de touch**.
   - ⚠️ Se quitaron **los dos** swipes: el del wrapper (cambio de modo) **y** el
     del contenedor de notas del hijo (navegación entre estudiantes, antes en
     `ontouchstart`/`ontouchend` sobre `notasScrollRef`). La navegación entre
     estudiantes es SOLO por ◀/▶ y por la lista (tocar el nombre). Motivo: "como
     en Windows" no hay ningún gesto, y un toque dentro del área de notas no debe
     poder leerse como navegación.
   - El estado del modo sigue viviendo en `NotasMainPage` (`activeSub`); el
     `ModoToggle` solo avisa por `onModoChange` y el wrapper pasa `modo`.
7. **BUG: el carrusel volvía al primer estudiante tras tocar una nota**
   (2026-10). Causa: el `$effect` que reencuadra el índice reseteaba a 0 cuando
   `filteredNotas` quedaba **vacío** (`else if (n.length === 0) currentStudentIdx = 0`).
   Durante un refresco silencioso la lista pasa un instante sin filas, el effect
   la ve vacía, pone el índice en 0 y cuando las filas vuelven el `keepIdx` de
   `fetchEstudiantes` ya parte de 0: la posición se perdió.
   - ⚠️ Ahora el effect **solo reencuadra hacia arriba** (`currentStudentIdx >
     n.length - 1` → `n.length - 1`) y clampa negativos; **nunca** vuelve a 0 por
     lista vacía. El reinicio por cambio de FILTRO es otro effect (el de
     `filtersRef`), que es donde corresponde.
   - `fetchEstudiantes` preserva con `if (keepIdx < data.length) currentStudentIdx
     = keepIdx` partiendo del índice actual.

⚠️ `FiltersModalAndroid` **quedó sin consumidores** (2026-10): `NotasPage` ya no
lo importaba y `AsistenciaPage` / `EstudiantesPage` migraron al riel inline. El
archivo se conserva por referencia (documenta el GOTCHA del `<select>` que lo
cerraba solo), pero no se usa en ninguna página.

Clases CSS de los rieles: viven en los COMPONENTES compartidos (2026-10), no en
el `<style>` de una página: `FiltroRail.svelte` (`.filtro-rail` + estilos de
`<select>`), `BtnRail.svelte` (`.btn-rail` + reglas `:global(.btn-mod…)`) y
`AccionesRail.svelte` (`.acciones-rail`). Lo específico de `NotasPage` sigue en su
`<style>`: `.notas-barra-estudiante`, `.nav-est-fila`, `.nf-est`, `.ind-tabs`,
`.ind-tab`, `.ind-tab-dot`, `.ind-tab-val`.

### ⚠️ El popover de indicador/criterio va PORTALADO a `<body>` (2026-10)

`NotasPage` abre un popover al pulsar la cabecera de un indicador o criterio. Es
`position: fixed`, pero se renderiza DENTRO de contenedores glass
(`.category-card` con `backdrop-filter`), así que su bloque contenedor era ese
card y las coordenadas de VIEWPORT (que `abrirPopover` calcula del disparador) lo
mandaban **fuera de pantalla** en Android. Fix: `use:portalToBody` en el panel (el
mismo GOTCHA de AGENTS para menús/desplegables) **+** un `$effect` que, ya
renderizado, **reencuadra** el panel al viewport: si no entra por abajo lo sube
POR ENCIMA del disparador, y el guard `nx/ny !== x/y` evita el bucle (al
recolocar, el `getBoundingClientRect` ya cae dentro y no se vuelve a escribir).

⚠️ **Etiquetas de las tarjetas de estadísticas de la tabla** (`.summary-label`):
en el `@media (max-width:1024px)` estaban en `.56rem` **con elipsis**, así que
"Promedio grupal" / "Estudiantes" se truncaban justo cuando la tabla deja de
dibujarse (horizontal del teléfono / tablet). Ahora van a `.62rem` con
`white-space:normal` (`overflow-wrap:anywhere`) para que **envuelvan a 2 líneas**
en vez de recortarse. La tarjeta crece con el contenido (`min-height` es solo
piso). La **tira de KPIs** de la boleta (`.kpi-strip .summary-label`) se fija a
`nowrap` a propósito: es una sola línea horizontal con scroll, y ahí envolver
rompería la altura de la tira.

## Días sin clases (2026-08) — feriados por sección o colegio

Tabla `dia_sin_clases` (ver esquema; añadir fila en la lista de tablas).
Comandos: `get_dias_sin_clases(colegioId, gradoId?, seccionId?, fechaInicio, fechaFin)`
y `set_dias_sin_clases(..., fechas[], descripcion, activo)` (bulk transaccional,
pending deletions al borrar). Registrados en generate_handler + local-commands.toml.

**Alcances**: `grado_id`+`seccion_id` con valor = solo esa sección DE ese grado
(las secciones son catálogos compartidos entre grados: sin `grado_id`, una marca
"A" afectaría a todos los grados); ambos NULL = todo el colegio.
**No existe un nivel "todos los colegios"**: `colegio_id` es NOT NULL, así que
para aplicar a todos hay que ITERAR el catálogo de colegios llamando a
`set_dias_sin_clases` una vez por colegio, siempre con `gradoId`/`seccionId` en
`null` (ver `aplicarEnTodosLosColegios()` en AsistenciaPage).

**UI (AsistenciaPage)**:
- Botón "🚫 Sin Clases" junto a Limpiar, disponible en **diario, semanal Y
  mensual**. Popover con MOTIVO OBLIGATORIO + alcance y confirmación nativa
  (`ask`); desmarcar también confirma. En mensual el popover abre con un
  **selector de semana** (`semanasMes`) porque "todo el mes" no aplica.
- Alcances del popover: sección / colegio / **TODOS los colegios** (y el espejo
  "reactivar en todos los colegios" cuando ya está marcado).
- Diario marcado → banner ámbar glass + lista vacía. Semanal/mensual: los días
  marcados NO desaparecen; encabezado de columna ámbar 🚫 y celda combinada
  (`rowspan`) con el motivo vertical.
- Click en el ENCABEZADO de una fecha (semanal/mensual) marca/desmarca esa
  fecha puntual (popover contextual, `colFechaObjetivo`).
- El popover va montado en `<body>` con una acción `portalToBody` (GOTCHA de
  `position: fixed` en contenedores glass). En escritorio: centrado con
  `padding-top:14vh`, fondo transparente y SIN blur para que la tabla siga
  viéndose; en Android: modal centrado con blur.
- `fechasPeriodo` excluye los días sin clases (no cuentan P/A/J ni %);
  `fechasVisibles` los incluye para pintarlos.

**Semanas en la vista mensual** (`semanasMes`, ambas páginas): las columnas se
agrupan por el PRIMER DÍA HÁBIL DEL COLEGIO (`primerDiaSemana`, derivado de
`colegioConfig` lunes→domingo), no por lunes: un colegio martes-sábado tiene su
semana empezando el martes. Cada bloque lleva separador vertical (`.sep-semana`),
píldora `S1`/`S2`… en su primera columna, y "Semana N" en el tooltip de cada fecha.
Al pasar el cursor por una semana en el popover de Sin Clases, esa semana se
resalta en la tabla (`semanaHover`, `semanaHoverRango`).

**Sub-tab Informe (modo lectura de `AsistenciaPage`)**: columnas omitidas de
reportes; nota en PDF/impresión ("Sin clases: dd/mm (motivo)"); en mensual/
semanal el día marcado lleva celda combinada (rowSpan autoTable / rowspan HTML);
banner on-screen cuando el período entero está marcado (`panelSinClases(true)`).

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
  el sub-tab Informe seguía mostrando asistencia ya limpiada.
- Botón Limpiar usa diálogo nativo `ask` (modal custom eliminado).

## Interruptor conectar/desconectar Cloudflare (2026-10)

**Por qué existe**: restaurar un `.db` de Google Drive NO alcanza. El camino de
restore llama `d1_reset_device_id`, que pone `last_sync = NULL`; el siguiente
sync hace entonces un **pull COMPLETO** de la nube y vuelve a pisar la base que
el usuario acaba de restaurar (que es más nueva). Nada dentro del sync puede
distinguir "la nube tiene la razón" de "la nube está vieja".

- **Estado**: `src/lib/d1Connection.svelte.ts` (`d1Conectado()` reactivo +
  `persistirD1Conectado()`). Vive en **localStorage** (`stp_d1_conectado`), NO
  en `d1_config`, y a propósito:
  · es una decisión **por dispositivo**, no un dato que deba viajar a la nube;
  · un respaldo restaurado trae su propio `d1_config`: un flag guardado ahí se
    volvería a poner solo al restaurar ese `.db`;
  · sobrevive al reinicio de la app, que es justo lo que se pidió.
  Solo un `"false"` explícito desconecta: un valor corrupto nunca frena el sync.
- **Orquestación**: `syncService.setD1Connected(v)`.
  · Desconectar → `stopPeriodicSync()` + `stopWsSync()` (nada sigue bajando datos).
  · Conectar → `d1_sync_all {full: true, force: true}` (**push completo**: la
    base local gana; un incremental volvería a mezclar la nube vieja) y recién
    después se rearma el timer.
- **Guardas** (defensa en capas): `isD1Configured()` devuelve `false`;
  `d1SyncService.syncAllSilent()` corta; `ensurePeriodicSync()` ni arma el timer;
  el restore de Drive solo llama `d1_reset_device_id` si está conectado.
- Drive sigue respaldando con normalidad estando desconectado: lo de Cloudflare
  es `autoSync.flush()` → `syncService.syncAllSilent()`, y `scheduleInstantBackup()`
  va por su cuenta.

⚠️ **GOTCHA: la info de "sin clases" se muestra con UN snippet, no con dos ramas.**
El mismo hecho se mostraba de dos formas según cómo se llegara al período
(mover el dropdown de semana, cambiar de colegio…): el panel de "período sin
clases" salía solo si `fechasPeriodo` quedaba vacío, y si quedaba un solo día con
clases salía la grilla con columnas 🚫 y el motivo solo en el `title`/celda
combinada. Mover un dropdown cambiaba la representación entera.

Ahora hay un `{#snippet panelSinClases(soloAviso)}` que se usa en los dos casos:
en lugar de la grilla cuando el período está entero marcado, y **encima** de la
grilla cuando solo hay días marcados (`periodoTieneMarcas`). Misma información
—alcance, motivo y botón de reactivar— en el mismo sitio, y la grilla sigue
visible cuando quedan días con clases (que es información que sí sirve).
Cambiar el markup por duplicado es como volvió la inconsistencia.

⚠️ **GOTCHA: `/* … */` en el MARKUP de Svelte se renderiza como texto visible.**
Un `/** … */` antes de un `{#snippet}` NO es un comentario para Svelte:
el compilador lo compila como un nodo de texto
(`$.from_html('<div>a</div> /** … */ <!>')`) y el usuario ve el
comentario impreso en la página. En el markup solo valen los comentarios
HTML `<!-- … -->` (nodo de comentario en el DOM, invisible) o nada;
los comentarios de código van dentro de `<script>`. (Pasó en
AsistenciaPage: el doc-comment del snippet salía en la UI.)

⚠️ **GOTCHA: sin `colegio_dias_asistencia`, el fallback de días hábiles NO puede
ser "los 7 días".** `getDiasHabilitadosBase()` / `getDiasHabilitados()` devuelven
`soloSinDomingo(fechas)` cuando el colegio no tiene config semanal. Antes
devolvían los 7 días, y como "Marcar en TODOS los colegios" marca los 7 días del
calendario a propósito (ver `objetivosSinClases`), ese colegio siempre tenía días
"laborables" sin marcar: la semana marcada JAMÁS se veía completa y la página
seguía mostrando la grilla por días con el motivo en cada columna, en vez del
panel de "período sin clases". Resultado visible: la misma semana se veía con dos
presentaciones distintas según el colegio del dropdown (el que tiene config
mostraba el panel, el que no tenía la grilla). Solo cae el domingo: sábado no,
porque los colegios martes-sábado son un caso real.

⚠️ **GOTCHA: leer el motivo de un día marcado tiene que tolerar marcas duplicadas.**
`coberturaSinClases()` responde con la PRIMERA fila que cubre el día y la consulta
viene `ORDER BY fecha` solamente. Si el mismo día tiene dos marcas (una de colegio
+ una de sección que quedó de antes), la que responde puede ser la que no tiene
descripción: el motivo aparecía para un colegio y desaparecía para otro según qué
sección coincidía. `motivoSinClasesEn()` ahora cae a cualquier otra fila de esa
fecha que sí tenga motivo.

Relacionado: `fetchDiasSinClases()` exige **solo** el colegio, y manda
`gradoId/seccionId` en `null` cuando aún valen 0. Antes exigía también grado y
sección, y justo tras cambiar de colegio esas dos valen 0 → se vaciaba
`diasSinClases` y el período se quedaba sin motivo hasta que otro fetch lo
llenara. Las marcas a nivel colegio son las que produce "Marcar todo este colegio"
y "Marcar en TODOS los colegios", así que son las que no pueden faltar.

⚠️ **GOTCHA: `invoke()` con un argumento `undefined` rompe el comando, no la app.**
El payload se serializa con `JSON.stringify`, y las claves cuyo valor es
`undefined` **se pierden**. Rust recibe entonces un mapa sin la clave y contesta
`missing required key <nombre>` en vez de "valor inválido", que es un mensaje
confuso si el valor venía de `array[0]`.

Caso real (2026-10): `fetchEstudiantesMulti` filtraba los días marcados "sin
clases" (`getDiasHabilitados`) y pasaba `fechaInicio: fechas[0]`. Al marcar una
semana entera sin clases el array queda VACÍO → `fechas[0]` es `undefined` → la
clave desaparece → `get_asistencia_estudiantes_rango missing required key
fechaInicio` en cada refresco, y la vista quedaba en el estado "sin días
hábiles".

**Regla**: antes de invocar con `algo[0]` / `algo[algo.length - 1]`, comprobar
`length === 0` y salir con el estado vacío ya pintado en la UI. Un período
completo marcado "sin clases" es un estado VÁLIDO: se muestra un panel ámbar con
el motivo y un botón para reactivar, no la caja roja de "no hay días hábiles"
(que es para cuando el colegio no trabaja ese día según su configuración
semanal). Ojo: `fetchDiasSinClases` sí puede usar `getFechasPeriodo()` pelado
porque una semana/mes siempre tiene al menos un día.

⚠️ **GOTCHA: no montar el sync en un `$effect` que escriba en la BD.**
`saveAppSettings()` llama `onDataChange(..., immediate)` → `flush()` → **push a
Cloudflare + subida a Drive**. Un efecto que guarde en cada montaje dispara las
dos nubes sin que el usuario haya tocado nada: el rail de Configuración monta
las páginas al pasar el cursor (`hoverAbrir`, 200 ms), así que "abrir el rail y
llegar a Depuración" gastaba dos sincronizaciones reales. Persistir SIEMPRE desde
la acción del usuario (`handleUpdateHighlightColor`), nunca desde un efecto que
observe el estado.

## Nube como MODALES (2026-10) — `CloudPage` y `AccountPage` eliminados

`CloudPage` (página) y `AccountPage` (página) **ya no existen**. Motivo: con la
nube de un solo usuario la página de cuenta no aportaba nada, y el contenido de
nube se usa desde cualquier parte, no desde un destino de navegación.

- **Estado global**: `src/lib/cloudPanels.svelte.ts` con
  `openCloudPanel('d1' | 'drive')`, `closeCloudPanel()`, `isCloudPanelOpen(panel)`.
  Es un `let` + `$state` en un módulo **`.svelte.ts`** (igual que `i18n.svelte.ts`):
  leído desde el template queda como dependencia y Svelte re-renderiza solo. Con
  un `let` normal en un `.ts`, abrir el panel no re-renderizaría nada.
- **Montaje**: `<ModalNubeD1 />` y `<ModalNubeDrive />` se montan UNA vez en
  `App.svelte` (fuera del layout), no en el componente que dispara el click. Es lo
  que mantiene una sola fuente de verdad de la sesión de Drive y del estado D1.
  Ambos devuelven vacío (`{#if abierto}`) mientras no están abiertos.
- **Puntos de entrada**: card ☁️ y card Drive del sidebar (`CloudCards`, solo
  desktop) y los chips del header de Android (`mobile-sync-chip` / `mobile-drive-btn`).
  Ambos chips del header ahora abren panel (el de Drive antes era solo informativo).
- **Rail de Configuración**: sin entradas "Nube" ni "Cuenta". Los destinos legacy
  `cloud`/`account` en `App.TAB_A_SECCION_AJUSTES` caen en `general`.
- **Traspaso de dispositivo**: vivía en AccountPage; ahora es una caja en
  `ajustes/DebugPage.svelte` con claves `dpg.traspaso.*` (el orden de borrado lo
  sigue mandando `lib/deviceHandover.ts`).

**Para abrir un modal de nube desde cualquier página nueva**:

```ts
import { openCloudPanel } from "../lib/cloudPanels.svelte";
// ...
onclick={() => openCloudPanel('d1')}     // o 'drive'
```

⚠️ **GOTCHA: no volver a navegar a una sección de nube**. Si el panel se necesita
en otro lugar, se abre el store. Duplicar la sesión de Drive en dos componentes
es un error difícil de ver: el dispositivo queda con dos tokens distintos y el
respaldo manual falla sin explicación.

**Métricas de sync en Android (2026-10)**: `ModalNubeD1` muestra la tirita de
▲ subidas / ▼ bajadas / ✕ borrados de la última sync que en escritorio vive en
la card Nube D1 del sidebar (`CloudCards`). Es SOLO Android (`esAndroid` por
user-agent): en escritorio la card del sidebar ya lo hace y el panel no la
duplica. Fuente: `d1SyncState.lastResult` (el mismo `d1SyncManager`).

⚠️ **GOTCHA (lectura del .key)**: el `.key` se lee con el comando Rust
`gd_read_file_base64` + `TextDecoder`, **no** con `readTextFile` del plugin-fs:
las capabilities de `src-tauri/capabilities/default.json` no incluyen
`fs:allow-read-text-file`, y el scope de `fs:allow-read-file` solo cubre
AppData/Downloads/Documents/Home/Temp (un `.key` en otra unidad fallaría).

## Credenciales Cloudflare (.key): generación e importación (2026-08, ajustado 2026-10)

- **Formato .key**: JSON `{workerUrl, schoolKey}`.
- **Generar**: `cloudflare-sync/scripts/generate-key.mjs` (node ≥ 18).
  - Sin args: re-emite la clave YA aprovisionada de `cloud-keys.json` → es el caso
    habitual para dar de alta otro equipo.
  - `--nueva`: acuña una `stp_` + 18 hex, la registra en el KV `SCHOOL_ROUTING`
    apuntando a la misma base D1 y actualiza `school-keys.json` (necesita wrangler).
  - `--slug`, `--out`, `--url`, `--key`, `--solo-json` para casos puntuales.
  - La URL del worker se resuelve en este orden: `--url` → `DEFAULT_WORKER_URL` de
    `src/lib/cloudAuth.ts` (misma URL que usa el login) → `wrangler deployments list`.
    Si no aparece, aborta con instrucción en vez de adivinar.
  - Salida por defecto: `<repo>/schooltracker-<slug>.key`. **`.key` está en
    `.gitignore` (raíz y `cloudflare-sync/`): es una credencial.**
- **Importar**: `modales/ModalNubeD1.svelte` → "🔑 Importar .key" (`open` dialog →
  `gd_read_file_base64` → `d1_save_config` → `d1_sync_all {force:true}`).
  El acceso por `.key` del Welcome se quitó en 2026-09 a propósito; el modal D1
  es ahora el único punto de importación.
- **Protección anti-mezcla**: si la config existente difiere del `.key`, se avisa
  con `ask` y, si acepta, `d1_clear_config` antes de guardar → nuevo device_id,
  cursores en cero. El primer sync va en try/catch aparte: la clave ya quedó
  guardada, así que un fallo de red no debe reportarse como importación fallida.
- **Clave enmascarada** en la UI (`••••••` + últimos 4).
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

## Reparación de datos dañados en la nube/local (2026-09)

Después de la purga del perfil y al importar una base de datos vieja, aparecieron
varios problemas combinados. Documentación de síntomas, causas raíz y soluciones:

### Síntoma 1: "no such table: colegio_grado" al sincronizar tras importar una DB vieja

- **Causa**: las migraciones de schema (tablas nuevas `colegio_grado`,
  `dia_sin_clases`, columnas `tipo`, etc.) solo corrían en el arranque de la app,
  NUNCA al importar un archivo. El sync D1 arranca en cuanto se guarda y fallaba al
  leer tablas que la base vieja no tenía.
- **Solución**: `gd_import_db_from_file` (lib.rs) ahora ejecuta `db::init_database`
  justo después de reemplazar el archivo y reabrir la conexión, creando tablas
  faltantes + migraciones antes de que cualquier cosa use la base. En Ajustes,
  `handleImportDB` hace lo mismo via `gd_reload_database`.

**GOTCHA**: NUNCA olvidar que importar una DB no es "copiar un archivo": al importar
hay que re-ejecutar `init_database` (schema + migraciones) para bases viejas.

### Síntoma 2: Tombbstones residuales borran los datos recién subidos al refrescar

- **Síntoma**: se importa la base buena, el Dashboard muestra estudiantes/grados/
  secciones, pero al refrescar TODO desaparece. El archivo local sigue con tamaño
  grande (SQLite no libera espacio sin `VACUUM`, aunque borre filas lógicamente).
- **Causa**: la purga dejó ~6.235 tombstones en la nube con `updated_at` avanzado.
  Al volver a subir (full:true) la base buena, el pull posterior aplicaba esos
  tombstones residuales (mayores que el cursor) y borraban las filas recién subidas.
  El pull completo del arranque al refrescar era el que los propagaba.
- **Solución**: nuevo endpoint **`/reset`** en el worker (`cloudflare-sync/src/index.ts`):
  borra TODAS las filas Y TODOS los tombstones de un namespace, validado por
  `X-School-Key` (mismo nivel de auth que push/pull). Comando Rust `d1_reset_remote`
  (`d1.rs`) que llama a `/reset` y pone ambos cursores a NULL. El flujo de importación
  y el botón "Sync completo" ahora hacen `d1_reset_remote` → `d1_sync_all { full:true }`.

**GOTCHA**: `d1_reset_remote` extremo cuidado — borra toda la nube de la cuenta. Se usa
solo en el flujo de importación de una base buena (reset nube → subir todo).
### Síntoma 3: `HTTP 400: table colegio_grado has no column named device_id`

- **Síntoma**: al hacer sync tras importar: `Worker error (HTTP 400): D1 batch error:
  D1_ERROR: table colegio_grado has no column named device_id: SQLITE_ERROR`.
- **Causa**: el esquema remoto (`ensureSchema`) creaba las tablas de catálogo SIN la
  columna `device_id`, pero `buildUpsert` del worker inserta SIEMPRE `device_id` y `sk`
  en TODAS las tablas. Solo `dia_sin_clases` y `id`/`sk` tenían esas columnas; al tocar
  `colegio_grado`, el push intentaba insertar en una columna inexistente → 400.
- **Solución**: en `ensureSchema`, el bucle que agrega `sk` a todas las tablas
  sincronizadas ahora TAMBIÉN agrega `device_id` vía `ALTER TABLE ... ADD COLUMN
  device_id TEXT` envuelto en try/catch. **Requiere redeploy del worker** tras editar:
  `cd cloudflare-sync; npx wrangler deploy`.

**GOTCHA**: `ensureSchema` usa ALTER tolerante (try/catch) porque no puede crear una
tabla con columnas que quizá ya existan en bases D1 viejas. Tras cada cambio de

## Cruce de catálogos entre dispositivos (2026-09) — colegio_grado y relaciones huérfanas

**Síntoma**: los datos descargados de la nube "intercruzan" colegios — un colegio
aparece con grados/secciones/asignaturas de otro, o un colegio fantasma (id=1)
hereda la configuración de un colegio real.

**Causa raíz (2 mecanismos combinados)**:
1. **PKs fantasma por seed/wizard en dispositivos frescos**: la BD histórica del
   usuario tiene colegios con ids 2 y 3 (hubo otro colegio con id 1 antes). Una
   BD nueva auto-numera el primer colegio como id=1; si ese device sube sus
   `colegio_grado`, la nube queda con filas de un colegio que ya no existe, y
   cualquier device futuro que cree un colegio con id=1 las "hereda" (el upsert
   del worker es incondicional — LWW por llegada).
2. **Relaciones huérfanas sin FK enforcement**: el apply del sync no valida FKs;
   al borrar el usuario asignaturas (p. ej. dejó solo "Ingles"), las filas de
   `grado_asignatura`/`colegio_asignatura` que las referenciaban quedaron
   huérfanas y se sincronizaron entre devices.

**Solución aplicada**:
- **Limpieza de nube vía tombstones directos** (curl/PowerShell contra `/push`,
  `deletions: [{tabla, pk[]}]`): borrar filas huérfanas de la nube SIN reset
  completo → los tombstones se propagan por pull a todos los devices.
  Preferible a `d1_reset_remote` cuando la mayoría de la nube está bien.
- **`cleanup_orphan_relations` (db.rs, dentro de `init_database`)**: al arrancar,
  borra localmente `colegio_grado`/`colegio_asignatura`/`grado_asignatura` que
  apunten a catálogos inexistentes. Higiénico e idempotente.
- **Gate en `seed_default_data`**: si `d1_config.school_key` está configurada,
  NO sembrar catálogos instanciados (cortes evaluativos; ya no se siembran
  colegios/grados/asignaturas desde refactor previo) — la nube aporta la verdad
  en el primer pull/restore.
- **Regla de negocio confirmada por el usuario**: ambos colegios = "Primaria";
  Manuel Ignacio ofrece solo 3er grado (sección C) y 5to grado (secciones C y D);
  Candelario Sotelo grados 1-6 (sección A); única asignatura "Ingles".

**GOTCHA**: los ids auto-increment de BDs distintas NO son comparables entre
dispositivos. Nunca asumir que colegio/grado/seccion id=1 significa lo mismo en
dos devices: la identidad real es la fila sincronizada por PK, y un PK colisionado
con contenido distinto = mezcla. Si se crea contenido offline en un device nuevo
con nube configurada, verificar que no reutilice PKs ya ocupadas en la nube.
`cloudflare-sync`, SIEMPRE desplegar con wrangler — un worker viejo contra cliente nuevo
da fallos mudos.

### Comandos nuevos de este ciclo

| Comando | Archivo | Descripción |
|---------|---------|-------------|
| `d1_wipe_remote` | d1.rs | Pull completo con deviceId "probe" → envía todas las PKs como tombstones por `/push` en lotes de 100 → borra toda la nube de la cuenta. Cursores a NULL. |
| `d1_reset_remote` | d1.rs | Llama al endpoint `/reset` del worker (borra filas + tombstones) y pone cursores a NULL. Usado al importar una DB buena. |
| `reset_local_database` | db.rs | Borra todo lo local (conserva `d1_config`), re-siembra defaults, inicializa schema + migraciones. |

Todos registrados en `generate_handler!` (lib.rs) y `local-commands.toml`.

### Botón de purga en Ajustes → Debug

- **Escritorio**: "Zona de Peligro" de la card de Depuración (grid de 2 columnas):
  Reiniciar Local / Limpiar Nube / **🧨 Purgar Perfil** / Fábrica + nota explicativa.
- **Android**: otra card de Depuración dentro del bloque móvil, mismo `handleWipeProfileData`.
- `handleWipeProfileData`: confirmación doble → `d1_wipe_remote` (best-effort, si no hay
  D1 configurado avisa y continúa) → `reset_local_database` → toast.
- **GOTCHA**: la app tiene DOS cards de Depuración por plataforma (escritorio vs Android).
  Un botón X agregado a una NO aparece en la otra: hay que editarlos en ambos bloques.
### Diagnóstico de errores de sync en el frontend

- **`console.debug` es invisible por defecto**: DevTools solo muestra logs de nivel
  "Verbose" (debug) si activas el filtro. Los logs de ERROR deben usar `console.warn`
  / `console.error` para ser visibles sin configuración.
- **Los errores de Tauri llegan como string plano**, no como objeto `Error`: un
  mensaje largo del Worker podía quedar recortado a un número (p. ej. "error 6233"
  era en realidad el CONTADOR `del=6233` de tombstones aplicados, no un fallo).
- En `d1SyncService.ts` los logs se serializan con `JSON.stringify(e, Object.getOwnPropertyNames(e))`
  para capturar TODO el objeto, y el último error queda en `window.__d1LastError`.
- **CloudPage card D1**: en estado de error muestra botones "▼ Ver diagnóstico completo"
  (timestamp, online, mensaje completo, error JSON) y "📋 Copiar diagnóstico".

**GOTCHA conocido**: en la card del sidebar el número es el estado/mensaje recortado;
el detalle real está en la card Cloudflare de CloudPage o en `window.__d1LastError`.

### Sync completo forzado y auto-sync al importar

- Botón verde **"Sync completo"** en CloudPage: llama `d1_sync_all { full:true }`
  (ignora los doble-cursores y re-sube TODA la base local a la nube). Antes hacía
  solo reset; ahora `d1_reset_remote` → `d1_sync_all { full:true }`.
- `handleImportDB` (Ajustes → Debug → Importar): tras copiar + migrar
  (`gd_reload_database`), dispara automáticamente `d1_reset_remote` → `d1_sync_all
  { full:true }`. Toast con conteo: "✅ Base importada, migrada y sincronizada (X
  filas en la nube)". Si D1 no está configurado o falla, toast de advertencia + recordatorio
  del botón "Sync completo". Los 3 botones de importación muestran "⏳ Importando +
  sincronizando…" y se deshabilitan mientras dura. Los `invoke` de migración y sync van
  en try/catch SEPARADOS: si el sync falla la base ya quedó importada y migrada.
- **Flujo correcto tras importar una base buena**: importar → (ya migra y hace reset+
  full sync solo) → refrescar NO debe perder datos porque no hay tombstones residuales.
  Si algo se pierde al refrescar, el problema son tombstones viejos en la nube (usar
  `/reset` o `d1_reset_remote`).
## GOTCHA: Minify de Android + JNI de Rust (crash en release al iniciar Google Sign-In, 2026-09)

**Síntoma**: la app compilada en **release** quedaba bien al arrancar, pero al tocar
"Continuar con Google" en WelcomePage **se cerraba sin mensaje**. En debug no ocurría.

**Causa raíz**:en `src-tauri/gen/android/app/build.gradle.kts`, el buildType `release`
tenía `isMinifyEnabled = true` (R8/ProGuard con `proguard-android-optimize`), mientras
debug usa `false`. R8 **no puede ver** los métodos Java/Kotlin que se invocan **desde Rust
vía JNI por nombre** (`call_method("startGoogleSignIn", ...)` en `lib.rs`), y los ve como
"código muerto" → los **elimina o renombra**.Resultado: al tocar el login, el
`call_method` JNI fallaba y la app crasheaba.Lo mismo rompía `initNativeBridge`,
`requestNotificationPermissionNow` y los métodos de `AttendanceNative` (todos enlazados a
símbolos `Java_com_keimer_schooltracker_*`).

**Solución aplicada**:
- **`isMinifyEnabled = false`** en el bloque `release` de `build.gradle.kts` (igual que debug).
- **`proguard-rules.pro`**:keep rules de defensa en caso de reactivar minify:

```proguard
-keep class com.keimer.schooltracker.MainActivity {
    public void startGoogleSignIn(java.lang.String;
    public void requestNotificationPermissionNow();
    void initNativeBridge();
}
-keepclasseswithmembernames class * { native <methods>; }
-keep class com.keimer.schooltracker.AttendanceNative { public *; }
-keep class com.keimer.schooltracker.AttendancePrefs { public *; }
```

**GOTCHA**: `gradlew assembleRelease` invocado directo falla con
`A problem occurred starting process 'command 'npm.bat''` — es un error de **entorno**
(npm no está en el PATH del proceso Gradle por separado), no del código.El APK release
debe compilarse con **`npm run tauri android build`** (que configura el PATH y ejecuta
el bundling completo dela cadena).

## GOTCHA: Cambio de applicationId y el icon del launcher (2026-09)

Tras pasar el `applicationId` de `com.keimer.schooltrackerpro` a
`com.keimer.schooltracker`, el icono del launcher puede aparecer "en blanco"/genérico
o quedar el de la versión anterior**:

- **Los recursos de icono están correctos**: `res/mipmap-*/ic_launcher.png` (+ `_round`
  y `_foreground`) existen en todas las densidades con tamaños válidos,y el
  `AndroidManifest.xml` los referencia con `android:icon="@mipmap/ic_launcher"`.
- **Causa real**: al cambiar applicationId, la app se instala como **paquete NUEVO**;el
  Android Launcher **cachea** el icono de la instalación anterior(id viejo). Además
  `ic_launcher.png` se genera a partir de `src-tauri/icons/icon.png` (el icon del bundle),
  no del `label/icono personalizado` del WebView.

- **Fix**:
  1. Desinstalar la app antigua (`com.keimer.schooltrackerpro`) manualmente primero.


  2. Si el icono general no es el deseado editor:reemplazar `src-tauri/icons/icon.png`


      (y los `32x32/128x128`) y **re-generar el proyecto Android** para que Tauri
      cope los PNG a `mipmap` (o copiar manualmente los PNG nuevos a `res/mipmap-*/`).
  3. Tras reinstalar, refrescar el launcher(reiniciar el dispositivo) para
      limpiar la caché de iconos.

## NotasPage: distribución, deshacer y guardado (2026-09)

- **Distribución monótona**: `pesoLetra(nota)` reparte un presupuesto de puntos en
  los 3 indicadores activos y devuelve `C1 <= C2 <= C3` (nunca al revés). Con meta
  65 y pesos 7/7/6 produce `AI/AF/AS`, no `AI/AS/AF`. Es el orden natural
  (más fácil de arriba hacia abajo).
- Regla de puntaje: máximo **5 indicadores activos**, máximo **20 puntos** cada uno,
  total **100**.
- Los indicadores/criterios **no se borran** desde el flujo normal de notas (el
  borrado real va por `vaciar_notas_indicador` / `delete_criterio` en GlobalesPage)
  para no perder notas ya escritas.
- **Estado sucio vs BD**: `savedBaseline` guarda un snapshot al abrir/guardar y
  `notasIguales()` decide si hay cambios. El botón Guardar se habilita solo con
  diferencias reales (borrar una nota cuenta como cambio).
- Deshacer/rehacer con Ctrl+Z / Ctrl+Y, con limpieza de snapshots para no
  arrastrar historial infinito.
- Al guardar se envían también los `borrados` (notas que estaban en BD y se
  borraron), que generan tombstones de sync.

## Indicadores activos por colegio + sección (2026-09)

La **descripción y los puntos** de un indicador son GLOBALES (por
grado/asignatura/corte/año); solo el **activo** se personaliza por colegio/sección.

- Tabla `indicador_colegio_seccion_activo` (`colegio_id`, `indicador_id`, `activo`,
  `updated_at`), PK compuesta. Reemplaza a la antigua `indicador_seccion_activo`
  (eliminada de local y nube).
- Comandos: `get_indicadores_activos_colegio_seccion(colegioId, gradoId, seccionId,
  asignaturaId, corteEvaluativoId, anoLectivoId)`, `set_indicador_colegio_seccion_activo`
  y `reset_indicadores_colegio_seccion`. Registrados en `generate_handler!` +
  `local-commands.toml`; sincronizada en D1 (`d1.rs`, `lib.rs`, `dirtyTracker.ts`,
  worker `TABLES`/`ensureSchema`).
- `NotasPage.svelte` es la ÚNICA página con el switch de activo (por fila, para
  colegio+sección). `EvaluacionesPage` edita solo descripción y puntos (labels
  informativos, sin switch) con botón Guardar explícito + chip "Sin guardar".
- Regla de evaluación: máximo 5 indicadores activos, máximo 20 puntos cada uno,
  total 100.
- `ReportesPage` debe filtrar por estos activos: `idsActivosDe(colegioId, seccionId,
  gradoId)` resuelve el set y los reportes lo usan en la tabla, en el PDF normal y
  en el PDF masivo (si no, el total sale sobre 8 indicadores).

## Filtro de período en Asistencia/Informe (2026-09)

- **Mensual es el predeterminado** en ambos modos (`periodo` inicial `"mensual"`).
  El sub-tab Informe **no ofrece "Diario"**: se resuelve con
  `periodoEfectivo = $derived(enInforme && periodo === 'diario' ? 'semanal' : periodo)`,
  así el valor persistido sigue siendo `periodo` crudo y volver a Tomar
  asistencia restaura el "diario" que el usuario había elegido. Todas las
  comparaciones del archivo usan `periodoEfectivo`, nunca `periodo`.
- Si queda persistido `"diario"` en `localStorage['asistencia_periodo']` y se abre
  en escritorio, se migra a `"mensual"` al arrancar (si no, el `<select>` queda sin
  opción coincidente). La preferencia guardada del usuario siempre se respeta.
- Orden de los filtros: **Año Lectivo → Período → control del período**
  (Fecha / Semana de / Mes) → Colegio, Grado, Sección, Sexo. Es el mismo en
  escritorio y en el riel Android (`FiltroRail`); en Android el Año es el primer
  `<select>` del riel (ya no lo pone un modal).
- En mensual NO hay selector de año calendario: se deriva del año lectivo.

## Export PDF (2026-09)

### Notas (ReportesPage)
- Dos botones con alcance distinto, ambos unificados en `exportarPdfs(alcance)`:
  - 🔴 **PDF colegio** → un PDF por grado×sección del colegio filtrado
  - 📚 **Exportar Todo** → todos los colegios del año lectivo
- Cada par lleva su propio `colegioId` en el array `pares`; si no, al exportar
  todo se mezclarían configuración y datos de un colegio con los de otro.
- En Android se copian a Descargas vía `guardar_en_descargas` (ver abajo).

### Asistencia (sub-tab Informe) — `src/lib/asistenciaPdf.ts`
- Un solo PDF con **una hoja por grado/sección** de TODOS los colegios.
  Alcance único (se quitó el botón por colegio); el nombre del archivo es
  `Asistencia_<Mes o Semana N>_<Año>.pdf` (con espacios, SIN guiones bajos) y la
  subcarpeta `Documents/School Tracker/<año> - Asistencia <etiqueta>/`.
- El módulo escala tipografía por nº de columnas **y** de filas para que cada
  sección entre en una hoja; con 45+ estudiantes en mensual se acepta una 2ª hoja
  antes que letra ilegible (piso 6.5pt).
- Encabezado en CHIPS redondeados (verde claro / gris / ámbar) con barra de acento,
  igual que la vista de impresión. El chip de sección es **por hoja**, no la lista
  completa; la lista de todas vive en el pie (`Sección N de M`).

### Guardado en Android (MediaStore)
- Comando Rust `guardar_en_descargas(path, mime, carpeta, nombre)` (registrado en
  `generate_handler!` + `local-commands.toml`) → JNI → `MainActivity.saveToDownloads`
  → `DescargasSaver.guardar` con `MediaStore.Downloads` (API 29+) e
  `RELATIVE_PATH = "Download/<carpeta>/"`. Sin permisos de almacenamiento.
- `carpeta` acepta ruta anidada: se pasa `School Tracker/<subcarpeta>` para no
  dejar los archivos sueltos en `Download/School Tracker/`.
- En desktop el mismo comando devuelve `""` (no-op) y se abre la carpeta.

## Auto-actualización desde GitHub Releases (2026-10)

La app se actualiza bajando el asset del último release publicado en GitHub.
Vive en `src/lib/updateService.ts` (detección + descarga + instalación) y la UI
en `src/svelte/ajustes/DebugPage.svelte` (card 🔄, claves `dbg.update.*`). El
release lo arma `.github/workflows/release.yaml` (Windows + Android) y **solo se
crea si la versión de `tauri.conf.json` difiere del último tag**, así que un
`workflow_dispatch` sin cambios de versión no publica nada.

Flujo: `releases/latest` → `elegirAsset()` → descarga por `fetch` con progreso →
escribe en `$APPCACHE` → `invoke('gd_instalar_actualizacion')` → en Windows
`gd_salir_app` (el .exe en uso no se puede sobrescribir y el NSIS se quedaría
esperando).

### ⚠️ GOTCHA: `openPath` del plugin-opener NO estaba habilitado

`opener:default` es solo `allow-open-url` + `allow-reveal-item-in-dir` +
`allow-default-urls`. **`open_path` NO está incluido**, así que el `invoke`
moría con "not allowed" en Windows y en Android. El precedente del repo es
siempre `openUrl(aFileURL(...))`; nunca se había usado `openPath`.

### ⚠️ GOTCHA: `$APPCACHE` no estaba en ningún scope de escritura

`fs:allow-write-file` solo listaba `$APPDATA`, `$DOWNLOAD`, `$DOCUMENT`, `$HOME`
y `$TEMP`, y `fs:default` deja los directorios de la app en **solo lectura**. El
instalador se escribe en `appCacheDir()` → `writeFile` fallaba. Se habilitó
`fs:allow-appcache-write-recursive` (que es `write-all` + scope recursivo de
APPCACHE, no un `allow-write-file` suelto).

⚠️ **No cambiar a `$TEMP`** pensando que es "más libre": en Android `temp_dir()`
es `/data/local/tmp`, que la app **no puede escribir**. Y no hay que crear el
directorio a mano: en Windows `$APPCACHE` es la carpeta de datos del WebView2 y
en Android es `getCacheDir()`, ambos ya existen (igual se deja un
`mkdir(..., {recursive:true}).catch(()=>{})` defensivo, como en
`instrumentosExcel.ts`).

### ⚠️ GOTCHA: en Android `file://` no sirve, va FileProvider

Con `targetSdk 36` (y desde la API 24, el `minSdk` del proyecto) compartir un
archivo con otra app por `file://` lanza `FileUriExposedException`. El
plugin-opener arma `Intent(ACTION_VIEW, path.toUri())`, o sea que **en Android
`openPath` habría fallado aunque tuviera el permiso**. El APK va por FileProvider:
`content://<applicationId>.fileprovider/...`, cubierto por
`res/xml/file_paths.xml` (`cache-path`). Además hay que declarar

```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

en `gen/android/app/src/main/AndroidManifest.xml`, o el instalador rechaza el
origen de la instalación (desde Android 8 es obligatorio para instalar APKs
propios).

### La salida limpia: un solo comando Rust `gd_instalar_actualizacion`

Un comando para las dos plataformas, justamente porque el archivo está en la
caché privada de la app y abrirlo desde JS no es viable:

| Plataforma | Qué hace |
|---|---|
| Desktop | `tauri_plugin_opener::open_path` por la **API de Rust**, no por su comando IPC → no hay que abrir `opener:allow-open-path` ni ningún scope. Es el `ShellExecuteExW` del sistema, igual que un doble clic |
| Android | JNI → `MainActivity.installApk` → `FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)` + `ACTION_VIEW` (MIME `application/vnd.android.package-archive`) + `FLAG_GRANT_READ_URI_PERMISSION` |

⚠️ **El scope de una capability solo se paga desde el comando IPC del plugin.**
Llamando a la API de Rust dentro de un comando propio `gd_*` (ya cubierto por
`allow-local-commands`) no hay scope que habilitar. Es el mismo patrón que ya
usaba `gd_open_url_browser` con `app.opener().open_url(...)`.

⚠️ **La app NO se instala sola**: Android siempre pide confirmación del usuario
(no hay update silencioso sin root ni sin instalador privilegiado). El comando
solo abre el instalador del sistema.

### Firma: el APK de Android solo instala sobre la misma keystore

Si el equipo tiene instalado un build de `npm run dev:android` (debug) o una
versión de Play Store, el APK de la release dará **"Aplicación no instalada"**:
Android exige que la firma coincida con la de la app ya instalada. El primer uso
además pide habilitar "Instalar aplicaciones desconocidas" para School Tracker
(lo gestiona el instalador del sistema). El `versionCode` no es problema: sale
de `app/tauri.properties`, que el CLI autogenera desde la versión
(`1.1.8` → `1001008`) y está gitignoreado.

### Dos bugs silenciosos que no detecta el build

- `DebugPage.svelte` leía `updateInfo.nota` cuando el campo real es **`notas`**:
  las notas del release nunca se veían. Ni `tsc` ni `vite build` lo detectan
  porque **`tsc` no revisa las plantillas `.svelte`** (mismo hueco que el
  `js_parse_error` del GOTCHA de Svelte).
- La versión en el bloque SISTEMA era un literal `1.2.0` cuando
  `tauri.conf.json` decía `1.1.8`; ahora sale de `getVersion()`.

### Verificar sin dispositivo

```powershell
npm run build                                   # tsc + vite (NO mira plantillas .svelte)
cd src-tauri; cargo check                       # rama desktop + VALIDA las capabilities
cargo check --target aarch64-linux-android      # rama JNI de Android
cd gen\android; .\gradlew.bat :app:compileUniversalDebugKotlin
```

⚠️ El task del gradle es **`compileUniversalDebugKotlin`**: `compileDebugKotlin`
es **ambiguo** (`compileArmDebugKotlin`, `compileUniversalDebugKotlin`, …) y
Gradle falla antes de compilar nada. Un `--dry-run` confirma además que ese task
**no** arrastra `cargo build`, así que es un chequeo de Kotlin barato (segundos)
sin tocar el Rust de Android.
