# Plan: Sync multiusuario multitenant con Cloudflare D1

Estado: **pendiente de implementar**. Este documento describe el plan aprobado.
Nada del código ha sido tocado aún.

## Objetivo

Reemplazar el sync automático por archivo completo (Google Drive) por un sync
**multiusuario por filas** usando **Cloudflare D1** como agregador en la nube,
manteniendo la arquitectura Local-First (SQLite local sigue siendo la fuente de
verdad offline).

## Decisiones fijadas (aprobadas por el usuario)

1. **IDs**: bloques de enteros reservados por el Worker (sin migración de tablas).
2. **Tenancy**: multilcolegio — el Worker rutea por `X-School-Key` a la D1 de cada
   colegio (aislamiento real, sin columnas `tenant`).
3. **Realtime**: polling primero (Durable Objects como Fase 4 opcional).
4. **Google Drive**: desaparece del sync automático; queda como botón manual
   "Backup completo a Drive" (reusar `GoogleDriveBackup`).

## Arquitectura final

```
Dispositivo A/B/C (Tauri, SQLite local offline-first)
        │ invoke()
        ▼
  Rust (rusqlite) ── nuevo transporte `d1_*` (reqwest)
        │ HTTPS + X-School-Key
        ▼
  Worker CF (auth, LWW, delta push/pull, ID blocks)
        │ binding selectivo vía REST D1 (token en Worker, NUNCA en la app)
        ▼
 D1 por colegio  (school_key → database_id en KV)
```

- Local sigue siendo la fuente de verdad offline. D1 es el agregador.
- Sync por **delta de filas** `updated_at > since`, en una sola vuelta
  (envías las tuyas, recibes las de otros), LWW por fila con tie-break
  `(updated_at, device_id)`.
- El token de D1 / de Cloudflare **nunca** va dentro de la app; todo pasa por el
  Worker con la clave compartida del colegio.

## Limitaciones free verificadas (2026)

- **D1 free**: 5 GB total, 500 MB/BD, **100K escrituras/día**, **5M lecturas/día**.
- **Workers free**: 100K requests/día.
- Sin egress, sin tarjeta.

⚠️ Punto crítico: `nota` puede llegar a cientos de miles de filas por colegio.
El **bootstrap inicial** o el **full-pull de un dispositivo nuevo** rozan el tope
diario de escrituras/lecturas. Mitigación: seed en lotes (chunks) o pasar a
D1 paid ($5) cuando aplique.

## Componentes nuevos

### 1. Cloudflare (`cloudflare-sync/` dentro del repo, con wrangler)

- **D1** `school_<id>`: mismas 16 tablas (schema copiado de
  `db.rs::init_database`) + tabla `sync_metadata(key TEXT PK, value TEXT)` con
  contadores de ID por tabla.
- **Worker** endpoints (JSON, auth `X-School-Key`; clave → `database_id` desde KV):
  - `POST /hello` — validar config/clave.
  - `POST /push` — body `{ device_id, since, tables: {t: [rows]}, deletes: [...] }`
    → upsert LWW en D1, responde pull implícito (filas desde `since` + deletes).
  - `POST /pull?since=` — filas + deletes desde `since`.
  - `POST /ids` — devuelve bloque `[start, end)` por tabla.
  - Interno: consulta a la D1 del colegio vía **REST API D1** usando un token CF
    guardado como *secret del Worker* (nunca en el cliente). Aislamiento total
    por D1 propia.
- **Provisioning**: `scripts/d1-provision.mjs` (crea D1 por colegio, registra
  key → id en KV, aplica schema).

### 2. Rust (`src-tauri`)

- **Dependencia nueva**: `reqwest` (+ cliente HTTP persistente en `DbState` /
  AppState). Config en estado: `{ worker_url, school_key }`, `device_id`
  (UUID generado una vez, en localStorage o BD).
- **Comandos nuevos** (registrar en `generate_handler!` **y** en
  `local-commands.toml` o `invoke` falla en runtime):
  - `d1_set_config(url, key)` / `d1_get_status()`
  - `d1_sync_push(since, device_id)` — arma `get_all_local_data_since` +
    `pending_deletions*`, POST al Worker, aplica la respuesta con
    `upsert_pull_data` + deletes recibidos. Marca dirty clean al éxito.
  - `d1_sync_pull(since, device_id)`
  - `d1_reserve_ids(table, count)` + `d1_bootstrap()`
- **db.rs — IDs por bloque**: hooks en los ~5 sitios de inserción que usan
  `last_insert_rowid()` (`db.rs:853, 943, 1965, 2677, 2790`):
  - Si hay bloque reservado local, insertar con `id` explícito del bloque.
  - Si el bloque se agota sin conexión, mostrar "Conecta para agregar"
    (o reservar bloques grandes; 1000/día es más que suficiente por instalación).
- **LWW local**: aplicar filas remotas con
  `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > t.updated_at`
  dentro de una transacción.

### 3. Frontend (Svelte)

- **`d1SyncService.ts`**: reusa `SyncManager` + `dirtyTracker`; `syncD1()`
  (push↔pull estilo `syncAllSilent`); `ensurePeriodicSyncD1()` (intervalo
  configurable, polling) + sync al ganar foco + manual.
- **UI**: formulario de configuración D1 (URL del Worker + clave del colegio)
  en CloudPage/Ajustes; estado de última sync; botón "Backup a Drive" separado.
- **App.svelte**: startup y `autoSync.onDataChange(dirty)` apuntan a D1; la
  lógica `hasLocalChanges` / `pullAllGuarded` de Drive se reutiliza para la
  orquestación local.

## Riesgos y gotchas

- **Límites free**: 100K escrituras/día y 5M lecturas/día por D1. El bootstrap
  de un colegio con muchas notas puede superarlo → seed en lotes o D1 paid ($5).
  Cada dispositivo nuevo hace un full-pull inicial (contar lecturas).
- **Datos preexistentes**: un dispositivo que ya tenía filas locales con ids
  1..500 y otro colega con sus propios 1..500 → **riesgo de colisión en el
  primer push**. `d1_bootstrap()` (F2) resuelve: el maestro siembra D1; los
  demás adoptan D1 y **renumeran** solo sus filas locales sin par en D1
  (ids frescos del bloque + remapeo de FKs en una transacción).
- **Relojes/latencia**: LWW con `updated_at` local → drift de reloj puede perder
  ediciones; mitigar con tie-break `device_id`.
- **Seguridad**: nunca exponer token CF ni D1 en el cliente; todo pasa por el
  Worker con `X-School-Key`. No usar el REST directo de D1 desde la app.
- GOTCHA de siempre: todo comando nuevo Rust debe ir en `generate_handler!` +
  `local-commands.toml` o falla en runtime (no en compile).

## Fases y esfuerzo

| Fase | Contenido | Esfuerzo |
|---|---|---|
| F0 | Cuenta CF, provision script, Worker + D1 + schema, wrangler | ~0.5-1 día |
| F1 | `d1_*` en Rust, transporte push/pull/deletes, sync manual 2 dispositivos | ~1-2 días |
| F2 | IDs por bloques en db.rs, `d1_reserve_ids`, `d1_bootstrap` (rebase de datos preexistentes) | ~2-3 días |
| F3 | UI config/estado, polling periódico, Drive → backup manual | ~1 día |
| F4 (opcional) | Realtime con Durable Objects | ~2-3 días |

## Archivos a tocar

- `src-tauri/src/lib.rs` — comandos `d1_*`, registro en `generate_handler!`.
- `src-tauri/src/db.rs` — hooks de IDs por bloque en los puntos de
  `last_insert_rowid()`.
- `src-tauri/Cargo.toml` — dependencia `reqwest`.
- `src-tauri/permissions/local-commands.toml` — permitir los comandos `d1_*`.
- `src/lib/d1SyncService.ts` — nuevo servicio de sync D1.
- `src/lib/syncService.ts`, `src/lib/driveSyncService.ts`, `src/lib/dirtyTracker.ts`,
  `src/lib/autoSync.ts` — orquestación / dejar Drive como backup manual.
- `src/svelte/CloudPage.svelte`, `src/svelte/AjustesPage.svelte` — UI de configuración.
- `src/App.svelte` — startup + trigger de sync D1.
- Nuevo `cloudflare-sync/` — Worker + wrangler.toml + schema.
- Nuevo `scripts/d1-provision.mjs` — provisioning de D1/KV por colegio.
