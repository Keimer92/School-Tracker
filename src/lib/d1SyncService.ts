import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { markDirty, markAllDirty, markAllClean, getDirtyTables } from './dirtyTracker';

/** Minutos entre sincronizaciones periódicas. Fijo, sin ajuste en la UI. */
export const SYNC_PERIODICO_MIN = 20;

export type D1Status = 'idle' | 'syncing' | 'error' | 'success' | 'offline';

export interface D1Config {
  workerUrl: string;
  schoolKey: string;
  deviceId: string;
  lastSync: string | null;
}

export interface D1SyncResult {
  ok: boolean;
  pushed: unknown;
  pulled: Record<string, number>;
  deletedApplied: number;
  lastSync: string;
}

interface D1SyncState {
  status: D1Status;
  lastSync: string | null;
  message: string | null;
  lastResult: D1SyncResult | null;
}

type D1SyncListener = (state: D1SyncState) => void;

class D1SyncManager {
  private state: D1SyncState = {
    status: 'idle',
    lastSync: localStorage.getItem('d1_last_sync_time'),
    message: null,
    lastResult: null,
  };
  private listeners: D1SyncListener[] = [];

  subscribe(listener: D1SyncListener) {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  setState(newState: Partial<D1SyncState>) {
    this.state = { ...this.state, ...newState };
    if (newState.lastSync) localStorage.setItem('d1_last_sync_time', newState.lastSync);
    this.listeners.forEach(l => l(this.state));
  }

  getState() {
    return this.state;
  }
}

export const d1SyncManager = new D1SyncManager();

async function getConfig(): Promise<D1Config | null> {
  try {
    return await invoke<D1Config | null>('d1_get_config');
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function fmtTime() {
  return new Date().toLocaleTimeString();
}

async function emitUpdates() {
  try {
    await emit("catalog-updated");
    await emit("student-updated", { timestamp: Date.now() });
    await emit("notas-updated", { timestamp: Date.now() });
    await emit("asistencia-updated");
    await emit("grade-configs-updated");
    await emit("subjects-updated");
  } catch (e) {
    console.warn('[D1Sync] Error emitiendo eventos:', e);
  }
  window.dispatchEvent(new CustomEvent('schooltracker-sync', { detail: { timestamp: Date.now() } }));
}

export const d1SyncService = {
  _periodicTimer: null as ReturnType<typeof setInterval> | null,
  _syncLock: false,
  /**
   * Hay un sync pendiente de correr (alguien pidio sincronizar mientras otro
   * estaba en vuelo). Antes esto no existia: los llamadores hacian spin-wait de
   * 500ms y al liberarse el lock ejecutaban UN SYNC COMPLETO cada uno. Como
   * `d1_sync_all` son 2 peticiones al worker (/push + /pull), un rafaga de N
   * triggers (visibilitychange + online + navegacion + WS) gastaba 2N peticiones
   * en vez de 2. En Android, con el WebView entrando y saliendo de primer plano,
   * eso es lo que disparaba el aviso de "casi llego al limite diario".
   * Ahora se COALESCEN: si ya hay un sync en vuelo se marca el pendiente y se
   * retorna, de modo que N llamadas se reducen a 1 sync extra (como maximo).
   */
  _syncPending: false,

  getConfig,
  saveConfig: async (workerUrl: any, schoolKey: any): Promise<D1Config> => {
    // Defensa: a veces se pasa un objeto de config completo en lugar de strings
    // sueltos (p. ej. saveConfig(cfg) en vez de saveConfig(cfg.workerUrl, cfg.schoolKey)).
    // Extraemos los valores correctos y avisamos para rastrear la fuente.
    if (workerUrl && typeof workerUrl === 'object') {
      schoolKey = schoolKey ?? workerUrl.schoolKey ?? workerUrl.school_key;
      workerUrl = workerUrl.workerUrl ?? workerUrl.worker_url;
      console.warn('[saveConfig] se recibió un objeto en workerUrl; se extrajo', { workerUrl, schoolKey });
    }
    if (schoolKey && typeof schoolKey === 'object') {
      schoolKey = schoolKey.schoolKey ?? schoolKey.school_key;
      console.warn('[saveConfig] schoolKey llegó como objeto; se extrajo', schoolKey);
    }
    if (typeof workerUrl !== 'string' || typeof schoolKey !== 'string') {
      throw new Error(`saveConfig: args inválidos (workerUrl=${typeof workerUrl}, schoolKey=${typeof schoolKey})`);
    }
    const cfg = await invoke<D1Config>('d1_save_config', { workerUrl, schoolKey });
    return cfg;
  },

  clearConfig: async (): Promise<void> => {
    await invoke('d1_clear_config');
  },

  syncAll: async (): Promise<D1SyncResult> => {
    const result = await d1SyncService.syncAllSilent(true);
    if (!result) throw new Error('Sync D1 falló');
    return result;
  },

  syncAllSilent: async (dispatchEvents: boolean = true): Promise<D1SyncResult | null> => {
    const self = d1SyncService as any;
    if (self._syncLock) {
      // Coalescer en vez de encolar: el sync en vuelo ya recogera los cambios
      // que se acabaron de marcar, asi que basta con dejar constancia de que
      // hay otro pendiente. Ver la nota de `_syncPending`.
      self._syncPending = true;
      return null;
    }
    self._syncLock = true;
    try {
      const cfg = await getConfig();
      if (!cfg) return null;
      if (!navigator.onLine) {
        d1SyncManager.setState({ status: 'offline', message: 'Sin conexión' });
        return null;
      }
      d1SyncManager.setState({ status: 'syncing', message: `Sincronizando con la nube D1...` });
      console.debug(`[D1Debug] sync INICIO · tablas sucias: [${getDirtyTables().join(', ') || 'ninguna'}]`);
      const result = await invoke<D1SyncResult>('d1_sync_all');
      console.debug('[D1Debug] sync resultado crudo:', JSON.stringify(result).slice(0, 1500));
      d1SyncManager.setState({
        status: 'success',
        lastSync: nowIso(),
        message: null,
        lastResult: result,
      });
      const p = Object.values(result?.pushed || {}).reduce((a, b) => a + Number(b || 0), 0);
      const l = Object.values(result?.pulled || {}).reduce((a, b) => a + Number(b || 0), 0);
      const d = Number(result?.deletedApplied || 0);
      const hadChanges = p + l + d > 0;
      // Emitir eventos SOLO si hubo cambios reales (push o pull o borrados):
      // así el tick periódico puede avisar a las páginas sin spamearlas.
      if (hadChanges && dispatchEvents) {
        await emitUpdates();
        console.debug(`[D1Debug] sync OK · push=${p} pull=${l} del=${d} → eventos enviados a páginas`);
      } else {
        console.debug(`[D1Debug] sync OK · push=${p} pull=${l} del=${d} (sin cambios)`);
      } 
      markAllClean();
      return result;
    } catch (e: any) {
      // ── Diagnóstico detallado del error de sync ──
      // El error de Tauri llega como string (no Error); serializar TODO para
      // no perder información (mensajes largos del worker/Rust, etc.)
      let completo: string = '';
      try {
        completo = JSON.stringify(e, Object.getOwnPropertyNames(e || {}), 2);
      } catch { completo = String(e); }
      const detalle = {
        mensaje: e?.message || String(e),
        stack: e?.stack || null,
        completo,
        completoLen: completo.length,
        online: navigator.onLine,
        ts: new Date().toISOString(),
      };
      // Inspección manual desde consola: window.__d1LastError
      (window as any).__d1LastError = detalle;
      // console.warn (NO debug): DevTools oculta console.debug salvo nivel "Verbose"
      console.warn('[D1Sync] ════ ERROR EN SYNC ════');
      console.warn('[D1Sync] mensaje:', detalle.mensaje);
      if (detalle.stack) console.warn('[D1Sync] stack:', detalle.stack);
      console.warn('[D1Sync] error completo (JSON):', completo);
      console.warn('[D1Sync] contexto:', { online: detalle.online, ts: detalle.ts, msgLen: detalle.mensaje.length });
      d1SyncManager.setState({
        status: 'error',
        message: `Error en sync: ${detalle.mensaje} (detalle completo en consola [D1Sync] o window.__d1LastError)`,
      });
      console.error('[D1Sync] Error en syncAllSilent:', e);
      return null;
    } finally {
      (d1SyncService as any)._syncLock = false;
      // Si alguien pidio sync durante el vuelo, se corre UNO mas (no uno por
      // cada llamador). Se hace fuera del lock para no re-entrar en cola.
      if ((d1SyncService as any)._syncPending) {
        (d1SyncService as any)._syncPending = false;
        void d1SyncService.syncAllSilent(dispatchEvents);
      }
    }
  },

  pushAll: async (): Promise<void> => {
    await d1SyncService.syncAllSilent();
  },

  pushAllSilent: async (): Promise<void> => {
    try { await d1SyncService.syncAllSilent(); } catch {}
  },

  forcePushAll: async (): Promise<void> => {
    await d1SyncService.syncAllSilent();
  },

  forcePushAllSilent: async (): Promise<void> => {
    try { await d1SyncService.syncAllSilent(); } catch {}
  },

  pullAll: async (): Promise<void> => {
    await d1SyncService.syncAllSilent();
  },

  pullAllSilent: async (): Promise<void> => {
    try { await d1SyncService.syncAllSilent(); } catch {}
  },

  pullAllGuarded: async (): Promise<{ pulled: boolean; blocked: boolean }> => {
    await d1SyncService.syncAllSilent();
    return { pulled: true, blocked: false };
  },

  ensurePeriodicSync: () => {
    if ((d1SyncService as any)._periodicTimer) return;
    d1SyncService.startPeriodicSync();
  },

      startPeriodicSync: () => {
        // Intervalo FIJO de 20 minutos. Antes se leía de localStorage y había un
        // control en CloudPage para cambiarlo; el sync es crítico y una ventana
        // más corta solo gasta cuota de D1 (que ya es el límite que se está
        // topando). La clave vieja se limpia para que un valor previo no sobreviva.
        localStorage.removeItem('periodic_sync_interval_seconds');
        const interval = SYNC_PERIODICO_MIN * 60 * 1000;

    if ((d1SyncService as any)._periodicTimer) clearInterval((d1SyncService as any)._periodicTimer);
    (d1SyncService as any)._periodicTimer = setInterval(async () => {
      const cfg = await getConfig();
      if (!cfg) {
        d1SyncService.stopPeriodicSync();
        return;
      }
      // Bilateral: sincroniza SIEMPRE (push de cambios locales + PULL de cambios
      // remotos) y con eventos activos: si trajo datos, las páginas se refrescan.
      await d1SyncService.syncAllSilent(true);
    }, interval);
  },

  stopPeriodicSync: () => {
    if ((d1SyncService as any)._periodicTimer) {
      clearInterval((d1SyncService as any)._periodicTimer);
      (d1SyncService as any)._periodicTimer = null;
    }
  },

  getUserId: async (): Promise<string | null> => {
    const cfg = await getConfig();
    return cfg?.deviceId || null;
  },

  testConnection: async (): Promise<{ ok: boolean; latency: number; error?: string }> => {
    try {
      const start = performance.now();
      const resp = await invoke<{ ok?: boolean; error?: string }>('d1_status');
      const latency = Math.round(performance.now() - start);
      if (resp?.ok === false) return { ok: false, latency, error: resp.error || 'Error de conexión' };
      return { ok: true, latency };
    } catch (e: any) {
      return { ok: false, latency: 0, error: e?.message || String(e) };
    }
  },

  connectAndSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    const test = await d1SyncService.testConnection();
    if (!test.ok) return { ok: false, error: test.error };
    markAllDirty();
    return { ok: true };
  },

  runSchemaSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    return { ok: true };
  },

  wipeRemoteData: async (): Promise<void> => {},

  disconnect: () => {
    d1SyncService.stopPeriodicSync();
    d1SyncManager.setState({ status: 'idle', lastSync: null, message: null, lastResult: null });
  },

  syncGradeConfig: async (config: any): Promise<void> => {
    markDirty('configuracion_calificacion');
  },

  syncGlobal: async (table: string, data?: any, isNew?: boolean): Promise<void> => {
    markDirty(table);
  },

  deleteGlobal: async (table: string, id: number): Promise<void> => {
    markDirty(table);
  },

  syncStudent: async (student: any, isNew?: boolean): Promise<void> => {
    markDirty('estudiante');
  },

  syncStudentsBatch: async (students: any[]): Promise<void> => {
    markDirty('estudiante');
  },

  deleteStudent: async (id: number): Promise<void> => {
    markDirty('estudiante');
  },

  syncColegioSubjects: async (colegioId: number, subjectIds: number[]): Promise<void> => {
    markDirty('colegio_asignatura');
  },

  syncColegioDias: async (config: any): Promise<void> => {
    markDirty('colegio_dias_asistencia');
  },

  syncGradeSubjects: async (gradoId: number): Promise<void> => {
    markDirty('grado_asignatura');
  },

  syncEvaluacionConfig: async (indicadores: any[]): Promise<void> => {
    markDirty('indicador');
    markDirty('criterio');
  },

  syncNotasBatch: async (notas: any[]): Promise<void> => {
    markDirty('nota');
  },

  syncAsistenciaBatch: async (records: any[]): Promise<void> => {
    markDirty('asistencia');
  },

  syncPendingDeletions: async (): Promise<void> => {},
};