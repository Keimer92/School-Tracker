# Plan: Respaldo automático a Google Drive — Scheduler híbrido

## Contexto

Hoy `driveSyncService.setAutoBackupInterval()` ya implementa un `setInterval` fijo
(180 min por defecto) que llama `pushAll(true)` si `hasLocalChanges()`. No dispara
por `write` a la BD; es totalmente pasivo, pero tiene tres limitaciones:

1. **Ventana ciega**: si el usuario abre la app, hace muchos cambios y la cierra
   en 30 min, puede que el timer no haya llegado a disparar y los cambios se
   queden sin subir.
2. **Cuota concentrada**: todos los dispositivos del colegio suben en la misma
   ventana (180 min), agotando la cuota de Google API.
3. **Sin observabilidad**: no hay forma de saber cuándo se subió por última vez,
   por qué falló, ni de reintentar de forma inteligente.
4. **Sin batería/red**: ignora si el dispositivo está cargando o en WiFi.
5. **Multi-cuenta**: al cambiar de cuenta con `open_account_db`, la BD local
   de la cuenta saliente se reemplaza antes de cualquier respaldo.

## Objetivo

Sustituir el `setInterval` actual por un **scheduler híbrido con triggers
pasivos, jitter, throttling, batería/red, reintentos con backoff, notificaciones
Android nativas y respaldo al cambiar de cuenta**, sin disparar por `write` a la
BD.

## Decisiones de diseño ya tomadas (preguntas cerradas)

| # | Decisión | Valor |
|---|----------|-------|
| 1 | Estrategia | Híbrido: timer inteligente + triggers pasivos |
| 2 | Triggers | visibilitychange, WiFi/red buena, batería=cargando, inicio de app, cierre/visibility→hidden, **cambio de cuenta (push sincrónico antes del swap)** |
| 3 | Timer inteligente | Backoff exponencial por éxito: `min(base*2^n, max)` con `base=60 min`, `max=360 min`, jitter `±15 min` |
| 4 | Red | Solo si `effectiveType` ∈ {`4g`, `wifi`} y `saveData === false` |
| 5 | Batería | Timer se bloquea si no está cargando. Triggers manuales (visibility, WiFi, swap) pasan. Lectura vía comando Rust JNI `gd_battery_status` (no `navigator.getBattery`) |
| 6 | Cambio de cuenta | `pushAll` sincrónico en la cuenta saliente antes de `open_account_db` |
| 7 | Persistencia | Una sola clave `drive_auto_backup_state` con todo el estado. Migrar `drive_auto_backup_minutes` |
| 8 | UI | Sin CloudPage. Notificación Android nativa tras éxito, fallo 3+ veces, swap de cuenta y "llevas >24h sin subir" |
| 9 | Notificaciones | Éxito + fallo + swap + recordatorio >24h |
| 10 | Throttle | Mínimo 15 min entre subidas reales (cualquier trigger) |
| 11 | Reintentos | Backoff 5 → 15 → 60 min. Notificar al 3er fallo. Reset al primer éxito |

## Tareas de implementación (ordenadas)

### 1. Rust — comando `gd_battery_status` y `gd_show_notification`

**Archivo**: `src-tauri/src/lib.rs` y `src-tauri/src/permissions/local-commands.toml`.

Añadir dos comandos:

```rust
#[derive(serde::Serialize, Clone)]
struct BatteryStatus {
    charging: bool,
    level: i32,        // 0..100
    source: &'static str, // "jni" | "webview_unknown"
}

#[tauri::command]
async fn gd_battery_status(app: tauri::AppHandle) -> Result<BatteryStatus, String> {
    // En Android: JNI → MainActivity.currentBatteryStatus() (registra un BroadcastReceiver
    // para ACTION_BATTERY_CHANGED y devuelve un struct con {charging, level}).
    // En desktop: devuelve { charging: true, level: 100, source: "webview_unknown" } para
    // que el scheduler nunca se bloquee.
}

#[tauri::command]
async fn gd_show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    channel_id: String, // "drive_backups"
) -> Result<(), String> {
    // Llama a MainActivity.showNotification(title, body, channelId).
    // El channel ya debe estar creado en MainActivity.onCreate (verificar
    // src-tauri/gen/android/.../MainActivity.kt:308).
}
```

- Registrar ambos en `generate_handler!` en `lib.rs`.
- Añadir a `local-commands.toml`:
  ```toml
  "gd_battery_status",
  "gd_show_notification",
  ```
- En `MainActivity.kt` añadir un método estático `currentBatteryStatus(): BatteryStatus`
  que use `registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))` y
  lea extras `BatteryManager.EXTRA_STATUS` (`BATTERY_STATUS_CHARGING` /
  `BATTERY_STATUS_DISCHARGING`) y `EXTRA_LEVEL`/`EXTRA_SCALE`. Cachear el último
  estado conocido durante 60 s para no martillar al sistema en cada llamada.

### 2. TypeScript — nuevo módulo `src/lib/driveAutoBackup.ts`

Crear este archivo (no se toca `driveSyncService.ts` salvo lo mínimo).
Responsabilidades:

- Mantener el estado del scheduler.
- Exponer `driveAutoBackup.start()` / `.stop()` / `.notifyTrigger(reason)`.
- Escuchar eventos del navegador y del ciclo de vida de Tauri.
- Coordinar con `driveSyncService.pushAllSilent` (ya existe en
  `src/lib/driveSyncService.ts:458`) y `pushAll` (línea 396).

**Estructura del estado** (persiste en `localStorage['drive_auto_backup_state']`):

```ts
type AutoBackupState = {
  enabled: boolean;                    // default: true si hay token, false si no
  baseIntervalMin: number;             // default 60
  maxIntervalMin: number;              // default 360
  jitterMin: number;                   // default 15
  currentIntervalMin: number;          // arranca en baseIntervalMin
  onlyWifi: boolean;                   // default true (WiFi o 4g sin saveData)
  onlyWhenCharging: boolean;            // default false (timer); los otros triggers pasan
  lastSuccessAt: number | null;        // epoch ms
  lastErrorAt: number | null;
  lastErrorMsg: string | null;
  consecutiveFails: number;           // 0..3
  nextRunAt: number | null;            // epoch ms, persistido
  totalUploads: number;
  totalBytes: number;                  // opcional
};
```

**API pública**:

```ts
export const driveAutoBackup = {
  start(): void,                // arma listeners + timer, lee estado persistido
  stop(): void,                 // limpia timer, deja listeners
  notifyTrigger(reason: TriggerReason): Promise<void>,
  // Internos:
  scheduleNextRun(): void,
  runOnce(reason: TriggerReason): Promise<void>,
  recordSuccess(): void,
  recordFailure(err: string): void,
  shouldThrottle(): boolean,    // lastSuccessAt < now - 15min → false
  canRunNow(): Promise<{ ok: boolean; reason?: string }>,
  // Para cambio de cuenta:
  flushBeforeAccountSwap(): Promise<void>,
};
```

**Migración**: en el primer `start()`, si existe `localStorage['drive_auto_backup_minutes']`
y no existe `drive_auto_backup_state`, inicializar el estado con
`baseIntervalMin` = valor antiguo, `currentIntervalMin` = valor antiguo.

### 3. Triggers a registrar en `start()`

| Evento | Filtros | Acción |
|--------|---------|--------|
| `visibilitychange` a `visible` | `hasLocalChanges()` + throttle + WiFi/4g | `notifyTrigger('visibility')` |
| `visibilitychange` a `hidden` | `hasLocalChanges()` + throttle | `pushAllSilent` fire-and-forget (no await) |
| `window.addEventListener('online', ...)` | throttle + WiFi/4g | `notifyTrigger('online')` |
| `window.addEventListener('offline', ...)` | siempre | pausar timer hasta `online` |
| Timer (`setTimeout` recursivo con `currentIntervalMin ± jitter`) | battery=cargando + WiFi/4g + throttle + `hasLocalChanges()` | `notifyTrigger('timer')` |
| `App.svelte` `onMount` (boot) | throttle + WiFi/4g | `notifyTrigger('boot')` |
| `open_account_db` saliente (vía wrapper en `applyAccountStores` o similar) | siempre, sincrónico | `flushBeforeAccountSwap()` |

El timer **se cancela** y **se reprograma** en cada trigger real (no espera al
intervalo completo si ya hay cambios). Esto se hace guardando `nextRunAt` en
localStorage para sobrevivir a un HMR / recargar la página.

### 4. `canRunNow()` — orquestación de filtros

```ts
async function canRunNow(): Promise<{ ok: boolean; reason?: string }> {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  if (shouldThrottle()) return { ok: false, reason: 'throttled' };

  // Network quality
  if (onlyWifi) {
    const c: any = (navigator as any).connection;
    if (c) {
      if (c.saveData) return { ok: false, reason: 'saveData' };
      const t = c.effectiveType;
      if (t && !['4g', 'wifi'].includes(t) && c.type !== 'wifi') {
        return { ok: false, reason: 'slow_network' };
      }
    }
  }

  // Battery (solo en timer; otros triggers saltan este check)
  if (onlyWhenCharging) {
    const b = await invoke<BatteryStatus>('gd_battery_status');
    if (!b.charging) return { ok: false, reason: 'not_charging' };
  }

  if (!await hasLocalChanges()) return { ok: false, reason: 'no_changes' };
  return { ok: true };
}
```

### 5. Cambio de cuenta — `flushBeforeAccountSwap`

Localizar en el código el punto donde se llama a `open_account_db` (ver
`AGENTS.md` "Cambio de cuentas / per-account DBs"). El flujo actual:

```
iniciarSesionGoogleConNube → authWithGoogleIdToken
  → open_account_db (NUEVO: antes, hacer pushAll de la cuenta saliente)
  → conectarConCredenciales
  → applyAccountStores
```

Modificar: ANTES de `open_account_db(email_nuevo)`, si
`hasLocalChanges()` (de la cuenta actual), llamar `await driveAutoBackup.flushBeforeAccountSwap()`
que internamente hace `pushAll(true)` con timeout de 30 s. Si falla, loguear y
continuar con el cambio de cuenta igualmente (no bloquear el login).

### 6. Backoff y reintentos

- Tras éxito: `currentIntervalMin = min(currentIntervalMin * 2, maxIntervalMin)`.
- Tras fallo: `currentIntervalMin = baseIntervalMin` (reset).
- `consecutiveFails++`. Si llega a 3: `gd_show_notification("☁️ Respaldo a Drive falló 3 veces", lastErrorMsg)`.
- Backoff entre reintentos: 5 min, 15 min, 60 min (no subir inmediatamente
  otra vez al fallar; programar `setTimeout` interno y salir del run actual).

### 7. Notificaciones Android nativas

Llamar `invoke('gd_show_notification', { title, body, channelId: 'drive_backups' })`
en estos casos:

- **Éxito de timer/visibility/online/boot** (sólo si `consecutiveFails >= 1` antes,
  o si han pasado >24h desde la última notificación de éxito). Tono:
  "✅ Respaldo guardado" + nombre corto del archivo.
- **3 fallos consecutivos**: "❌ Respaldo a Drive falló 3 veces" + último error.
- **Cambio de cuenta**: "📤 Cuenta anterior respaldada antes de cambiar".
- **Recordatorio >24h sin subir (con cambios)**: al volver a `visible`,
  si `lastSuccessAt < now - 24h` y `hasLocalChanges()`: "⚠️ Tienes cambios sin
  respaldar desde hace más de 24h".

### 8. Integración en `App.svelte`

Importar `driveAutoBackup` y llamar `driveAutoBackup.start()` en `onMount`. En
`onDestroy` llamar `stop()`. Solo si `navigator.onLine` y/o si hay token Drive
guardado (leer `schooltracker-google-drive-settings`).

### 9. Telemetría mínima en consola

```ts
console.debug('[AutoBackup] trigger', reason, 'nextRunIn', mins, 'min');
```

## Archivos a tocar

| Archivo | Cambio |
|---------|--------|
| `src-tauri/src/lib.rs` | Añadir `gd_battery_status`, `gd_show_notification` |
| `src-tauri/src/permissions/local-commands.toml` | Whitelistear los dos comandos |
| `src-tauri/gen/android/.../MainActivity.kt` | Añadir `currentBatteryStatus()` JNI + crear canal `drive_backups` si no existe |
| `src/lib/driveAutoBackup.ts` | **Nuevo** — scheduler completo |
| `src/lib/driveSyncService.ts` | No tocar (reutiliza `pushAll`/`pushAllSilent`/`hasLocalChanges`) |
| `src/App.svelte` | Llamar `driveAutoBackup.start()` en `onMount` |
| `src/lib/...` (multi-cuenta) | Llamar `flushBeforeAccountSwap()` antes de `open_account_db` |
| `src/svelte/CloudPage.svelte` (opcional) | Botón "Respaldar ahora" que llama `driveAutoBackup.runOnce('manual')` |

## Validación (cómo probarlo)

1. `cd src-tauri && cargo check` debe pasar (los nuevos comandos no rompen tipos).
2. `npm run build` debe pasar.
3. Escenario manual:
   - Vincular Google Drive en la app.
   - Hacer 1 cambio (agregar estudiante).
   - Cerrar la app en <5 min.
   - Verificar en Drive: archivo nuevo con la fecha de hoy. La notificación "✅
     Respaldo guardado" debe aparecer.
4. Escenario batería:
   - En Android, forzar modo avión → respaldo NO debe dispararse.
   - Quitar modo avión + conectar a cargador → en el próximo timer (≤75 min con
     jitter) el push debe dispararse.
5. Escenario WiFi:
   - Cambiar a datos móviles 3G (`navigator.connection.effectiveType = '3g'`).
     Verificar en DevTools que el push se salta con `console.debug` "slow_network".
6. Escenario cambio de cuenta:
   - Conectar cuenta A, hacer cambios, vincular cuenta B. Verificar que se
     subió la BD de A antes del swap (mirar Drive con el tag de la cuenta A).
7. Escenario fallo:
   - Revocar el token OAuth desde la consola de Google. Verificar 3 notificaciones
     "❌ Respaldo falló" tras 3 intentos.
8. Multi-triggers:
   - visibilitychange, online y timer casi simultáneos. Verificar que solo se
     hace UN push real (el log de "throttled" debe aparecer en los otros 2).

## Riesgos abiertos / decisiones fuera de alcance

- **Sin UI de configuración**: el usuario no puede cambiar `baseIntervalMin`,
  `onlyWifi`, etc. desde la app. Si el usuario pide UI, abrir un segundo plan
  para añadirla a CloudPage con sliders.
- **Sin test E2E del scheduler**: la validación es manual. Los unit tests del
  scheduler requerirían mockear `navigator`, `localStorage`, `invoke` — fuera
  del alcance de este plan.
- **Batería en desktop**: el comando Rust devuelve `charging: true` para que el
  scheduler nunca se bloquee en Windows/macOS. Si el usuario quiere bloquear
  el timer en laptop sin cargador, hay que añadir otra fuente de verdad (no
  alcance de este plan).
- **Migración del estado**: si el usuario tenía `drive_auto_backup_minutes=180`
  y la app se actualiza, en el primer `start()` se migra a `baseIntervalMin=180`.
  No se rompe.
- **El push de visibilidad→hidden es best-effort**: WebView Android puede matar
  la promesa. Aceptable porque el timer + WiFi vuelven a intentarlo.
