import { invoke } from '@tauri-apps/api/core';
import { d1SyncService } from './d1SyncService';

/**
 * Push en tiempo real via WebSocket contra el Worker (hub por school key).
 *
 * - Al recibir `{"type":"changes","from":"<otro dispositivo>"}` dispara un
 *   `syncAllSilent()` con debounce pequeno (las rafagas se agrupan).
 * - Reconexion con backoff exponencial (1s -> 30s), reintento al recuperar red
 *   y al volver la app a primer plano.
 * - Los pings cada 25 s los responde el servidor automaticamente sin despertar
 *   el Durable Object (setWebSocketAutoResponse).
 */

interface D1Cfg {
  workerUrl: string;
  schoolKey: string;
  deviceId: string;
  lastSync: string | null;
}

let ws: WebSocket | null = null;
let myDeviceId = '';
let currentUrl = '';
let intentionalClose = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;

const PULL_DEBOUNCE_MS = 700;
const MAX_BACKOFF_MS = 30000;

function buildWsUrl(cfg: D1Cfg): string | null {
  try {
    const u = new URL(cfg.workerUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = (u.pathname.replace(/\/+$/, '')) + '/ws';
    u.search = '';
    u.searchParams.set('key', cfg.schoolKey);
    u.searchParams.set('device', cfg.deviceId);
    return u.toString();
  } catch {
    return null;
  }
}

function schedulePull() {
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => {
    pullTimer = null;
    console.debug('[WsSync-Debug] pull disparado por aviso remoto');
    void d1SyncService.syncAllSilent();
  }, PULL_DEBOUNCE_MS);
}

// -- DEBUG: inspecciona desde consola con window.__wsDebug() --
let lastClose: { code: number; reason: string; at: number } | null = null;
let lastMsgAt = 0;
let openedOnce = false;

(window as any).__wsDebug = () => ({
  estado: ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'null',
  url: currentUrl,
  deviceId: myDeviceId,
  openedOnce,
  lastMsgAt: lastMsgAt ? new Date(lastMsgAt).toLocaleTimeString() : null,
  lastClose,
  reconnectAttempts,
  intentionalClose,
});

function wsLog(...args: unknown[]) { console.debug('[WsSync-Debug]', ...args); }

// Auto-arranque desacoplado de App.svelte: garantiza intento de conexion
// ~1.2s despues de cargar el bundle, venga de donde venga.
if (typeof window !== 'undefined') {
  setTimeout(() => { void ensureWsSync(); }, 1200);
}

let lastGoodCfg: D1Cfg | null = null;

function clearPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempts));
  reconnectAttempts++;
  console.debug(`[WsSync-Debug] reconectando en ${delay}ms (intento ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureWsSync();
  }, delay);
}

function closeSocketSilently() {
  if (!ws) return;
  const s = ws;
  ws = null;
  s.onopen = null; s.onmessage = null; s.onclose = null; s.onerror = null;
  try { s.close(); } catch {}
  clearPing();
}

function connect(url: string) {
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.error('[WsSync-Debug] error creando WebSocket:', e);
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    reconnectAttempts = 0;
    openedOnce = true;
    wsLog('conectado al hub:', url);
    clearPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send('ping'); } catch {}
      }
    }, 25000);
  };
  ws.onmessage = (ev) => {
    lastMsgAt = Date.now();
    try {
      const m = JSON.parse(String(ev.data));
      if (m?.type === 'changes') {
        // Los IDs ya son únicos por instalación: los avisos propios se
        // ignoran para no disparar un sync redundante tras cada guardado.
        if (m.from === myDeviceId) return;
        console.debug('[WsSync-Debug] aviso remoto de cambios desde', m.from);
        schedulePull();
      }
    } catch {}
  };
  ws.onclose = (ev: CloseEvent) => {
    lastClose = { code: ev.code, reason: ev.reason, at: Date.now() };
    const everOpened = openedOnce;
    wsLog(`cerrado code=${ev.code} reason="${ev.reason || '-'}" (abrio antes: ${everOpened})`);
    if (!everOpened && (ev.code === 1006 || ev.code === 1015)) {
      console.warn('[WsSync-Debug] AVISO: Nunca pudo abrirse el WebSocket. Causas tipicas: ' +
        '1) El worker NO tiene desplegada la version con /ws -> ejecuta `npx wrangler deploy` en cloudflare-sync. ' +
        '2) URL/key incorrecta.');
    }
    ws = null;
    clearPing();
    scheduleReconnect();
  };
  ws.onerror = () => { wsLog('error de socket'); };
}

/** Conecta (o reconecta si cambio la config). Idempotente. */
export async function ensureWsSync(): Promise<void> {
  bindGlobalListeners();
  let cfg: D1Cfg | null = null;
  try {
    cfg = await invoke<D1Cfg | null>('d1_get_config');
    if (!cfg) wsLog('d1_get_config devolvio null (sin configurar)');
  } catch (e) {
    console.error('[WsSync-Debug] d1_get_config fallo:', e);
  }
  // Fallback: usar la ultima config buena si la consulta falla
  if (!cfg && lastGoodCfg) {
    console.warn('[WsSync-Debug] usando config cacheada tras fallo de d1_get_config');
    cfg = lastGoodCfg;
  }
  if (!cfg?.workerUrl || !cfg?.schoolKey || !cfg?.deviceId) {
    wsLog('sin config D1 � WS apagado');
    stopWsSync();
    return;
  }
  lastGoodCfg = cfg;
  intentionalClose = false;
  myDeviceId = cfg.deviceId;
  const url = buildWsUrl(cfg);
  if (!url) { wsLog('URL invalida desde workerUrl:', cfg.workerUrl); return; }
  if (ws && currentUrl === url && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  wsLog('conectando a:', url);
  closeSocketSilently();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  currentUrl = url;
  connect(url);
}

/** Cierra la conexion y cancela reconexiones (config eliminada). */
export function stopWsSync(): void {
  intentionalClose = true;
  closeSocketSilently();
  currentUrl = '';
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pullTimer) { clearTimeout(pullTimer); pullTimer = null; }
  reconnectAttempts = 0;
}

function bindGlobalListeners() {
  if (listenersBound) return;
  listenersBound = true;
  window.addEventListener('online', () => { void syncAfterReconnect(); });
  // Android (MainActivity.kt registerConnectivityListener) despacha 'connectivity-android'
  // con {online:true} cuando el sistema recupera la red, incluso en segundo plano
  // (el NetworkCallback vive a nivel de proceso, no de Activity en primer plano).
  window.addEventListener('connectivity-android', (e: Event) => {
    const detail = (e as CustomEvent<{ online?: boolean }>).detail;
    if (detail && detail.online) void syncAfterReconnect();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncAfterReconnect();
  });
}

let reconnectSyncing = false;
/** Al recuperar la conexión (o volver a primer plano) fuerza un sync D1 inmediato
 *  (empuja los cambios locales en cola por estar offline + jala los remotos). */
async function syncAfterReconnect() {
  wsLog('red disponible / foreground: reconectando WS y sincronizando D1');
  void ensureWsSync();
  if (reconnectSyncing) return;
  reconnectSyncing = true;
  try {
    await d1SyncService.syncAllSilent();
  } catch (e) {
    console.error('[WsSync-Debug] syncAllSilent tras reconexion fallo:', e);
  } finally {
    reconnectSyncing = false;
  }
}
