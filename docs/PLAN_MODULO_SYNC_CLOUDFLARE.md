# Plan: Extraer la sincronización Cloudflare (D1 + WebSocket) a un módulo reutilizable

> Objetivo: convertir el sistema de sync bilateral en tiempo real de School Tracker Pro
> en un módulo independiente (`cloud-sync-kit`) que pueda integrarse en cualquier app
> Tauri 2 + SQLite con cambios mínimos, manteniendo cada detalle aprendido en producción.

---

## 1. Inventario actual (qué existe y dónde)

### 1.1 Worker Cloudflare (`cloudflare-sync/`)

| Archivo | Contenido |
|---|---|
| `src/index.ts` | Worker completo (~800 líneas): API + `SyncHub` (Durable Object) + esquema auto + auth Google |
| `wrangler.toml` | Bindings: KV `SCHOOL_ROUTING`, KV `USERS`, D1 `DB`, DO `SYNC_HUB` |
| `schema.sql`, `scripts/*.sql` | Referencia (el esquema real se auto-crea con `ensureSchema`) |
| `scripts/d1-provision.mjs` | Provisión de D1 + relleno del id en wrangler.toml |

**Rutas del worker:**
- `GET /hello` — test de conexión + `serverTime`
- `POST /push` — `{ since, deviceId, data, deletions }` → upsert LWW + tombstones + broadcast WS si hubo cambios reales
- `POST /pull` — `{ since, deviceId }` → filas ajenas al device con `updated_at > since` + tombstones + `serverTime`
- `POST /ids` — reserva de bloques de ids (`sync_metadata`, `RETURNING value`)
- `POST /auth` — login/registro con Google ID Token → asigna `schoolKey` (KV `USERS`)
- `POST /admin/users|suspend|delete-data` — administración (X-Auth-Token de admin)
- `GET /ws?key=` — upgrade WebSocket → DO `SyncHub` por school key

**Conceptos clave del worker (NO perder en la extracción):**
- **Aislamiento por namespace**: toda fila lleva `sk = hash(SHA-256)[:8]` del school key; push/pull/tombstones filtran por él. Multi-usuario en UNA sola D1.
- **Ruteo multi-DB**: header `X-School-Key` → KV `SCHOOL_ROUTING` → database_id (permite varias D1).
- **LWW por llegada**: el worker RE-SELLA `updated_at = serverNow` en cada fila pusheada y el upsert es incondicional (`ON CONFLICT ... DO UPDATE SET ... = excluded.*`).
- **Broadcast solo con cambios reales**: `/push` difunde por WS solo si `meta.changes > 0 || deletions > 0`.
- **Tombstones**: `sync_tombstone (tabla, pk JSON, updated_at, device_id, sk)` con PK `(tabla, pk, sk)`.
- **`BUSINESS_KEY`**: catálogos/entidades (`ano_lectivo`, `colegio`, `asignatura`, `grado`, `seccion`, `estudiante`, `corte_evaluativo`) se reconcilian por clave de negocio (`nombre`/`codigo`), no por id autoincrement → evita chocar con UNIQUE cuando los ids divergen tras reseeds/restores.
- **PKs compuestas**: `asistencia(estudiante_id, fecha)`, `nota(estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)`, `grado_asignatura`, `colegio_asignatura`.
- **Batching**: máximo ~90 sentencias por `env.DB.batch()` (límite D1 = 100); chunk de filas por upsert = `90 / (cols + 3)`.
- **Auto-migración tolerante**: `ensureSchema` (CREATE IF NOT EXISTS + ALTER tolerantes + índice `(sk, updated_at)` por tabla), `deUniqueTables` (reconstruye tablas con UNIQUE global una sola vez, flag en `sync_metadata`), reshape de `dia_sin_clases`, migración de `sync_tombstone` vieja.
- **`SyncHub` DO (SQLite, plan gratuito)**: `setWebSocketAutoResponse('ping'→'pong')` (pings sin despertar el DO), rutas `/connect`, `/broadcast`, `/stats`. Migración `[[migrations]] tag="v1_sync_hub" new_sqlite_classes=["SyncHub"]`.
- **CORS** para fetch del WebView (`/auth`, `/admin`); el sync de datos va por Rust y no la necesita, pero se adjunta a todas las respuestas.
- **Auth Google**: verificación RS256 de ID token contra JWKS de Google (caché por isolate), `ALLOWED_EMAILS` (vacío = cualquiera), `ADMIN_EMAILS`, "reclamo legacy" del primer admin (filas `sk` NULL/huérfanas).

### 1.2 Backend Rust (`src-tauri/src/d1.rs`)

| Comando | Función |
|---|---|
| `d1_get_config` / `d1_save_config` / `d1_clear_config` | Config en tabla `d1_config` (id=1): worker_url, school_key, device_id, last_sync, last_push_sync |
| `d1_reset_device_id` | Regenera device_id + ambos cursores a NULL (re-sync completo idempotente) |
| `d1_status` | Ping `/hello` con latencia |
| `d1_sync_all` | **El corazón**: push + pull + apply en una transacción |
| `d1_restore_from_cloud` | Restauración autoritativa nube→local (regenera device_id, borra tablas locales, NO pushea) |
| `d1_reserve_ids` | Reserva bloques de ids en `d1_id_blocks` |

**Detalles críticos de `d1_sync_all` (NO perder):**
1. **DOS cursores** en `d1_config`:
   - `last_sync` = `serverTime` del `/pull` (autoritativo ENTRE dispositivos).
   - `last_push_sync` = hora LOCAL (comparable con los `updated_at` que este dispositivo estampa).
   - NUNCA mezclarlos: con un solo cursor, un reloj local torcido comía ediciones propias o ignoraba las del otro.
2. **Anti re-relevo** (`sync_recent_pulls`): cada fila aplicada por pull se registra `(tabla, pk, updated_at, ts)`; `collect_local_data_since` EXCLUYE esas filas del push hasta que se modifiquen localmente. Purga de entradas >24 h. Sin esto, filas con stamp "a futuro" circulaban entre dispositivos revertándose.
3. **`PK cols` espejo del worker** (`pk_cols()`) + `pk_part()` ("v1|v2|") + `row_recent_key()` ("tabla|pk|updated_at").
4. **Locks sin cruzar `.await`**: fase local síncrona (leer config + recolectar data + deletions), luego red con `spawn_blocking` (ureq es bloqueante) para no congelar el WebView (importante en Android).
5. **HTTP**: `ureq` con timeouts (10 s connect / 60 s total); 4xx/5xx de ureq 2.x llegan como `Err(Error::Status)` → leer body para el mensaje real del Worker.
6. **Apply del pull**: transacción con `PRAGMA foreign_keys = OFF`; upserts por clave de negocio para catálogos (`upsert_catalog`, conserva id local por los FK), `upsert_asistencia` por `(estudiante_id, fecha)`, `INSERT OR REPLACE` genérico para el resto; registro en `sync_recent_pulls`; tombstones propios ignorados por `device_id`.
7. **Cursores al final**: `last_sync = serverTime` (fallback reloj local), `last_push_sync = now_sqlite()` (local).
8. **Deletions**: 5 tablas de pendientes (simple / asistencia / nota / grado_asignatura / colegio_asignatura); se limpian SOLO tras confirmar que el Worker las aplicó.
9. **Purga de huérfanos**: asistencias sin estudiante → se marcan como pending deletion y se borran localmente (idempotente).
10. **`full=true`**: push completo desde época (cambio de cuenta: garantiza que la nube de la cuenta que sale quede al día).
11. Eventos `d1-sync-progress` para UI de progreso.

### 1.3 Frontend (`src/lib/`)

| Archivo | Rol | App-específico |
|---|---|---|
| `d1SyncService.ts` | Fachada UI: `d1SyncManager` (estado reactivo), `syncAllSilent` (lock + online + eventos si hubo cambios), sync periódico (30s–1h), `testConnection`, aliases `pushAll/pullAll/...` | Solo `emitUpdates()` (eventos de páginas) |
| `wsSyncService.ts` | WebSocket tiempo real: auto-arranque 1.2 s, backoff 1s→30s, ping 25 s, debounce pull 700 ms, filtro de avisos propios (`from === myDeviceId`), reintentos en `online` / `connectivity-android` (Android) / `visibilitychange`, debug `window.__wsDebug()` | Nada (ya es genérico salvo el import) |
| `dirtyTracker.ts` | Marcas de tablas sucias en `localStorage['stp_dirty_tables']` (migración desde clave legacy) | Lista `ALL_TABLES` |
| `autoSync.ts` | `onDataChange(table, {immediate})` → debounce 2 s → flush con drenaje de cola | Nada |
| `syncService.ts` | Delegador (hoy 100% D1; Drive queda como respaldo manual) | Histórico de Drive |

---

## 2. Qué es genérico y qué es app-específico

### Genérico (va al módulo, sin cambios)
- Worker: `/push`, `/pull`, `/hello`, `/ws`, `SyncHub`, batching, LWW con re-sello, tombstones, namespace `sk`, ruteo KV, `ensureSchema` parametrizado, `/ids`.
- Rust: `d1_config` + doble cursor, `d1_sync_all`, `d1_restore_from_cloud`, anti re-relevo, `http_post_json`, device_id, reserva de ids.
- Frontend: `wsSyncService` completo, `autoSync`, `dirtyTracker` (con lista inyectada), `d1SyncManager`/estado/reactividad/sync periódico.

### App-específico (se INYECTA como configuración/manifest)
1. **`TABLES`** (worker) y lista de tablas + PKs (Rust `pk_cols` + `collect_local_data_since`): definir un **manifest compartido** (JSON/TS) `{ tabla: { pk: string[], cols: string[], businessKey?: string } }` usado por worker y Rust.
2. **`BUSINESS_KEY`** por tabla.
3. **Tablas de pending deletions** (5 tablas con claves compuestas específicas) → declarar en el manifest: `deletions: [{ source: 'sync_pending_deletions', tabla, pkCols: ['registro_id'] }, ...]`.
4. **Nombres de eventos de refresco de UI** (`emitUpdates`: `catalog-updated`, `student-updated`, ...) → callback inyectado.
5. **Esquema SQL de las tablas de datos** (CREATE TABLE) → el módulo lo recibe como lista de DDL.
6. **Auth de usuarios** (`/auth` Google, ADMIN/ALLOWED emails, USERS KV, reclamo legacy) → sub-módulo opcional; alternativamente auth por API key.
7. **Purga de huérfanos** (asistencia→estudiante) → hooks opcionales `prePushHooks` (SQL de purga).

---

## 3. Diseño del módulo: `cloud-sync-kit`

```
cloud-sync-kit/
├── manifest.schema.json        # contrato del manifest de tablas
├── worker/
│   ├── src/
│   │   ├── index.ts            # router genérico (push/pull/hello/ids/ws)
│   │   ├── hub.ts              # SyncHub DO (idéntico al actual)
│   │   ├── schema.ts           # ensureSchema + deUniqueTables (parametrizados por manifest)
│   │   ├── upsert.ts           # buildUpsert (LWW + re-sello + business key)
│   │   ├── auth-google.ts      # (opcional) verifyGoogleIdToken + USERS KV + admin
│   │   └── types.ts            # Env, manifest types
│   ├── wrangler.template.toml  # placeholders de bindings/ids
│   └── scripts/provision.mjs   # provisión D1/KV + seteo de wrangler.toml
├── tauri/                      # crate Rust reutilizable
│   ├── src/
│   │   ├── lib.rs              # pub fn register_sync_commands(builder) + DbState trait
│   │   ├── config.rs           # d1_config + doble cursor + device_id
│   │   ├── http.rs             # http_post_json (ureq, manejo 4xx)
│   │   ├── sync.rs             # d1_sync_all + anti re-relevo + apply (parametrizado por manifest)
│   │   ├── restore.rs          # d1_restore_from_cloud
│   │   └── ids.rs              # d1_reserve_ids
│   └── manifest.json           # generado desde el manifest (compartido con el worker)
├── web/                        # package npm (TS puro)
│   ├── src/
│   │   ├── client.ts           # d1SyncService genérico (lock, periodic, estado)
│   │   ├── ws.ts               # wsSyncService (tal cual, con callback onRemoteChange)
│   │   ├── dirty.ts            # dirtyTracker (lista de tablas inyectada)
│   │   ├── autosync.ts         # onDataChange/flush
│   │   └── index.ts            # createCloudSync({ manifest, tauriInvoke?, events })
│   └── package.json
├── examples/school-tracker/    # integración de referencia (este proyecto)
└── README.md                   # setup end-to-end (wrangler, GCP, .key, integración)
```

### Contrato de integración (lo único que toca la app huésped)

```ts
// web/src/index.ts
export interface CloudSyncOptions {
  manifest: TableManifest;              // tablas, pks, cols, businessKey, deletions
  emitUpdates: () => Promise<void>;     // eventos de refresco de UI de la app
  localStoragePrefix?: string;          // default 'cloudsync' (evita colisiones)
  periodicIntervalKey?: string;
  debugFlags?: string[];                // p.ej. ['ws'] → window.__wsDebug()
}
export function createCloudSync(opts: CloudSyncOptions): CloudSyncHandle
```

```ts
// manifest (compartido worker ↔ rust ↔ web, un solo JSON generado de una fuente)
{
  "tables": {
    "colegio": { "pk": ["id"], "businessKey": "nombre" },
    "asistencia": { "pk": ["estudiante_id", "fecha"] },
    "nota": { "pk": ["estudiante_id", "criterio_id", "corte_evaluativo_id", "asignatura_id"] }
  },
  "deletions": [
    { "source": "sync_pending_deletions", "table": "*", "pkCols": ["registro_id"] },
    { "source": "sync_pending_deletions_asistencia", "table": "asistencia",
      "pkCols": ["estudiante_id", "fecha"] }
  ],
  "ddl": ["CREATE TABLE IF NOT EXISTS ..."],   // espejo del esquema local
  "orphanPurges": ["INSERT INTO sync_pending_deletions_asistencia ... SELECT ..."]
}
```

**Rust**: los comandos se exponen vía `cloud_sync_kit::register(builder, Manifest::from_json(...), DbState)`; el crate NO conoce `estudiante` ni `nota`, solo el manifest.

---

## 4. Fases de migración (incremental, sin romper producción)

### Fase 0 — Preparación (sin cambios de comportamiento)
1. Congelar el comportamiento actual con tests de humo: `npx wrangler deploy --dry-run` en CI; `curl` a `/hello`, `/push` y `/pull` con una key de pruebas; verificar `npx wrangler tail` muestra `[push] ... cambiosReales=Y`.
2. Crear el repo/package `cloud-sync-kit` y copiar (no mover) los archivos actuales.
3. Definir `manifest.schema.json` y generar el primer manifest desde `TABLES`/`BUSINESS_KEY`/`pk_cols` actuales.

### Fase 1 — Worker genérico
1. Refactor `index.ts` → módulos (`hub.ts`, `schema.ts`, `upsert.ts`); `TABLES`/`BUSINESS_KEY` pasan a construirse del manifest embebido (import de JSON con `import manifest from './manifest.json'`).
2. `ensureSchema`/`deUniqueTables` parametrizados por manifest (el DDL de datos sigue viniendo del manifest; el DDL de infraestructura — `sync_tombstone`, `sync_metadata`, `device_id`, índices `sk` — lo agrega el kit).
3. Desplegar y verificar: **mismo D1 y KV actuales** (no debe haber migración de datos; los nombres de tablas/columnas no cambian).
4. Validación: sync desde un cliente real; `wrangler tail` sin errores; pull devuelve las mismas filas que antes.

### Fase 2 — Crate Rust `cloud-sync-kit`
1. Mover `d1.rs` al crate con el manifest inyectado: `pk_cols()`, `collect_local_data_since` (lista de tablas), `BUSINESS_KEY_TABLES`, y las 5 tablas de deletions pasan a leerse del manifest.
2. Mantener los NOMBRES de comandos (`d1_sync_all`, etc.) para no tocar el frontend aún; opcionalmente con alias.
3. **GOTCHAS que deben sobrevivir al traslado** (checklist):
   - [ ] Lock de `conn` sin cruzar `.await`; red en `spawn_blocking`.
   - [ ] Doble cursor intacto (pull=servidor, push=local).
   - [ ] `sync_recent_pulls` con purge 24 h y exclusión en `collect_local_data_since`.
   - [ ] `PRAGMA foreign_keys = OFF` en la transacción de apply.
   - [ ] Tombstones propios ignorados por `device_id`.
   - [ ] Deletions limpiadas SOLO tras confirmación del Worker.
   - [ ] `full=true` para push completo.
   - [ ] Eventos `d1-sync-progress`.
4. `cargo check` + sync real desde la app (Windows y Android).

### Fase 3 — Paquete web `@cloud-sync-kit/web`
1. `createCloudSync({...})` que instancie client+ws+dirty+autosync con el manifest y callbacks de la app.
2. `d1SyncService.ts`/`wsSyncService.ts`/`dirtyTracker.ts`/`autoSync.ts` del proyecto se reducen a thin wrappers (o se importan directo del paquete).
3. **Eventos**: `emitUpdates()` sigue siendo 100% de la app (callback inyectado).
4. `npm run build` (tsc estricto) + verificación manual: sync bilateral entre 2 dispositivos, WS aviso→debounce 700 ms→refresh en sitio.

### Fase 4 — Limpieza y documentación
1. Eliminar código duplicado de `src/lib/*` (delegar en el paquete); `syncService.ts` queda como fachada de compatibilidad de la app.
2. README del kit: setup Cloudflare (D1+KV+DO+secrets `CF_API_TOKEN`), vars (`GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `ALLOWED_EMAILS`), provisión (`d1-provision.mjs`), archivo `.key` `{workerUrl, schoolKey}`, integración en 3 pasos (manifest + register Rust + createCloudSync), despliegue (`npx wrangler deploy` tras cada cambio) y diagnóstico (`wrangler tail`, `window.__wsDebug()`, logcat `-s RustStdoutStderr`).
3. Actualizar AGENTS.md para apuntar al módulo.

---

## 5. Decisiones y trade-offs

| Tema | Decisión | Por qué |
|---|---|---|
| Fuente del manifest | Un JSON compartido, importado por worker (esbuild soporta JSON) y parseado por Rust (serde_json) | Una sola fuente de verdad; evita desincronización de PKs/cols |
| Auth | Sub-módulo opcional `auth-google.ts`; alternativa auth por API key simple | No toda app huésped usa Google |
| Rust como crate local (`path = "../cloud-sync-kit/tauri"`) antes que publicar | Evita versionado prematuro | Publicar a crates.io/npm cuando haya un segundo consumidor real |
| Nombres de comandos | Mantener `d1_*` (alias de compatibilidad) | Migración sin tocar todas las páginas |
| Anti re-relevo | Queda en el kit (tabla `sync_recent_pulls` la crea el kit) | Es infraestructura, no dominio |
| Purga de huérfanos | Hook SQL inyectado (no genérico automático) | Las relaciones FK son de la app |

## 6. Riesgos y mitigaciones

- **Worker desplegado ≠ cliente nuevo** (el clásico `/ws` 404): el kit incluirá en el README el checklist `wrangler deploy --dry-run` + `wrangler deployments list`, y el cliente debe loggear si el WS nunca abrió (code 1006/1015) con el aviso de desplegar el worker (ya existe en `wsSyncService`).
- **Regresión de cursores**: cubrir con prueba manual documentada — reloj de dispositivo adelantado 10 min → editar en el otro → el pull debe traer la fila (el cursor pull es serverTime).
- **Identidad duplicada tras restore de Drive**: el kit expondrá `resetDeviceId()` como parte del handle y documentará cuándo usarlo (el kit regenera device_id en `restoreFromCloud` y tras restaurar respaldos de archivo completo).
- **Colisiones de localStorage**: prefijo configurable (`cloudsync_`), migración única desde claves legacy (`stp_dirty_tables`, `d1_last_sync_time`, `periodic_sync_interval_seconds`).
- **UTF-8/PowerShell**: el kit se edita solo con herramientas de edición (no Get-Content/Set-Content -Raw), documentado en el README.
