import { invoke } from '@tauri-apps/api/core';
import { d1SyncService } from './d1SyncService';

/**
 * Push en tiempo real vía WebSocket contra el Worker (hub por school key).
 *
 - Al recibir `{"type":"changes","from":"<otro dispositivo>"}` dispara un
   `syncAllSilent()` con debounce pequeño (los ráfagas se agrupan).
 - Reconexión con backoff exponencial (1s → 30s), re-intento al recuperar red
   y al volver la app a primer plano.
 - Los pings cada 25 s los responde el servidor automáticamente sin despertar
   el Durable Object (setWebSocketAutoResponse).
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
    console.log('[WsSync] pull disparado por aviso remoto');
    void d1SyncService.syncAllSilent();
  }, PULL_DEBOUNCE_MS);
}

// ── DEBUG: inspecciona desde consola con window.__wsDebug() ──
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

function wsLog(...args: unknown[]) { console.log('[WsSync]', ...args); }

function clearPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempts));
  reconnectAttempts++;
  console.log(`[WsSync] reconectando en ${delay}ms (intento ${reconnectAttempts})`);
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
    console.error('[WsSync] error creando WebSocket:', e);
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    reconnectAttempts = 0;
    openedOnce = true;
    wsLog('✅ conectado al hub:', url);
    clearPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send('ping'); } catch {}
      }
    }, 25000);
  };
  ws.onmessage = (ev) => {
    lastMsgAt = Date.now();
    wsLog('📩 mensaje:', String(ev.data));
    try {
      const m = JSON.parse(String(ev.data));
      if (m?.type === 'changes' && m.from && m.from !== myDeviceId) {
        schedulePull();
      }
    } catch {}
  };
  ws.onclose = (ev: CloseEvent) => {
    lastClose = { code: ev.code, reason: ev.reason, at: Date.now() };
    const everOpened = openedOnce;
    wsLog(`❌ cerrado code=${ev.code} reason="${ev.reason || '-'}" (abrió antes: ${everOpened})`);
    if (!everOpened && (ev.code === 1006 || ev.code === 1015)) {
      console.warn('[WsSync] ⚠️ Nunca pudo abrirse el WebSocket. Causas típicas: ' +
        '1) El worker NO tiene desplegada la versión con /ws → ejecuta `npx wrangler deploy` en cloudflare-sync. ' +
        '2) URL/key incorrecta.');
    }
    ws = null;
    clearPing();
    scheduleReconnect();
  };
  ws.onerror = () => { wsLog('⚠️ error de socket'); };
}

/** Conecta (o reconecta si cambió la config). Idempotente. */
let lastGoodCfg: D1Cfg | null = null;

export async function ensureWsSync(): Promise<void> {
  bindGlobalListeners();
  let cfg: D1Cfg | null = null;
  try {
    cfg = await invoke<D1Cfg | null>('d1_get_config');
    if (!cfg) wsLog('d1_get_config devolvió null (sin configurar)');
  } catch (e) {
    console.error('[WsSync] ❌ d1_get_config falló:', e);
  }
  // Fallback: usar la última config buena si la consulta falla
  if (!cfg && lastGoodCfg) {
    console.warn('[WsSync] usando config cacheada tras fallo de d1_get_config');
    cfg = lastGoodCfg;
  }
  if (!cfg?.workerUrl || !cfg?.schoolKey || !cfg?.deviceId) {
    wsLog('sin config D1 — WS apagado');
    stopWsSync();
    return;
  }
  lastGoodCfg = cfg;
  intentionalClose = false;
  myDeviceId = cfg.deviceId;
  const url = buildWsUrl(cfg);
  if (!url) { wsLog('URL inválida desde workerUrl:', cfg.workerUrl); return; }
  if (ws && currentUrl === url && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  wsLog('conectando a:', url);
  closeSocketSilently();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  currentUrl = url;
  connect(url);
}

/** Cierra la conexión y cancela reconexiones (config eliminada). */
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
  window.addEventListener('online', () => { void ensureWsSync(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void ensureWsSync();
  });
}
