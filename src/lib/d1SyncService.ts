import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { markDirty, markAllDirty, markAllClean } from './dirtyTracker';

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
    while ((d1SyncService as any)._syncLock) {
      await new Promise(r => setTimeout(r, 500));
    }
    (d1SyncService as any)._syncLock = true;
    try {
      const cfg = await getConfig();
      if (!cfg) return null;
      if (!navigator.onLine) {
        d1SyncManager.setState({ status: 'offline', message: 'Sin conexión' });
        return null;
      }
      d1SyncManager.setState({ status: 'syncing', message: `Sincronizando con la nube D1...` });
      const result = await invoke<D1SyncResult>('d1_sync_all');
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
      d1SyncManager.setState({
        status: 'error',
        message: `Error en sync: ${e?.message || e}`,
      });
      console.error('[D1Sync] Error en syncAllSilent:', e);
      return null;
    } finally {
      (d1SyncService as any)._syncLock = false;
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
    const intervalStr = localStorage.getItem('periodic_sync_interval_seconds');
    const interval = Math.max(30, Math.min(3600, parseInt(intervalStr || '300') || 300)) * 1000;
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