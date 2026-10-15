import { driveSyncService, syncManager } from './driveSyncService';
import { d1SyncService, d1SyncManager } from './d1SyncService';
import { d1Conectado, persistirD1Conectado } from './d1Connection.svelte';
import { stopWsSync } from './wsSyncService';
import { invoke } from '@tauri-apps/api/core';

export type { SyncStatus } from './driveSyncService';
export type { D1Config, D1Status, D1SyncResult } from './d1SyncService';
export { syncManager };
export { d1SyncManager };

let cachedD1Configured: boolean | null = null;

/**
 * Is the cloud sync ACTIVE? Two conditions, and the second one is easy to
 * forget: having credentials is not the same as being connected.
 *
 * `d1Conectado()` is the user switch in the D1 panel (see
 * `lib/d1Connection.svelte.ts`): after restoring a database from Drive the user
 * can turn the cloud off so its older rows don't overwrite the restored data.
 */
export async function isD1Configured(): Promise<boolean> {
  if (!d1Conectado()) return false;
  if (cachedD1Configured !== null) return cachedD1Configured;
  try {
    const cfg = await invoke<unknown | null>('d1_get_config');
    cachedD1Configured = !!cfg;
  } catch {
    cachedD1Configured = false;
  }
  return cachedD1Configured;
}

export function invalidateD1Cache() {
  cachedD1Configured = null;
}

/**
 * Turns the Cloudflare connection on/off and does the housekeeping that goes
 * with it. Called from the D1 panel; the flag itself is persisted by
 * `d1Connection.svelte.ts`.
 *
 * On DISCONNECT: stop the periodic timer and the WebSocket, so nothing keeps
 * pulling in the background while the user works on the restored database.
 *
 * On CONNECT: a FULL sync (`full: true`) — the local database wins. A plain
 * incremental sync would merge with the stale cloud and could re-apply exactly
 * the rows the user just replaced; a full push re-stamps every local row as the
 * newest in the worker, so the cloud ends up matching what is on disk. `force`
 * skips the retry brake of a previous failed push, which at this point is
 * meaningless.
 */
export async function setD1Connected(v: boolean): Promise<void> {
  if (d1Conectado() === v) return;
  persistirD1Conectado(v);
  invalidateD1Cache();

  if (!v) {
    d1SyncService.stopPeriodicSync();
    stopWsSync();
    d1SyncManager.setState({ status: 'idle', message: null });
    return;
  }

  if (!(await isD1Configured())) return;   // no credentials: nothing to start
  try {
    await invoke('d1_sync_all', { full: true, force: true, source: 'reconnect' });
    // The state is set here instead of calling `syncAllSilent` again: that
    // would be a second full round-trip right after the first one.
    d1SyncManager.setState({ status: 'success', lastSync: new Date().toISOString(), message: null });
  } catch (e) {
    d1SyncManager.setState({ status: 'error', message: String(e) });
    console.error('[D1] falló el sync al reconectar:', e);
  }
  d1SyncService.ensurePeriodicSync();
}

async function active(): Promise<typeof driveSyncService | typeof d1SyncService> {
  // Google Drive ya no se usa para sync automático: solo respaldo manual desde
  // modal de Cloudflare D1 (`modales/ModalNubeD1.svelte`). Todo sync/data-change/periodic se delega a D1 (no-op si no está configurado).
  return d1SyncService;
}

export const forcePullAsistencia = async (fecha: string, _gradoId: number, _seccionId: number): Promise<void> => {
  const svc = await active();
  await svc.syncAllSilent();
};

export const forcePullNotas = async (
  _anoLectivoId: number, _corteId: number, _colegioId: number,
  _gradoId: number, _seccionId: number, _asignaturaId: number
): Promise<void> => {
  const svc = await active();
  await svc.syncAllSilent();
};

export const syncService = {
  /** Connect/disconnect Cloudflare D1 (persisted; stops/starts the machinery). */
  setD1Connected,
  ensurePeriodicSync: async (): Promise<void> => {
    const svc = await active();
    svc.ensurePeriodicSync();
  },
  syncAllSilent: async (dispatchEvents: boolean = true, source: string = 'unspecified'): Promise<void> => {
    const svc = await active();
    await svc.syncAllSilent(dispatchEvents, source);
  },
  diagnoseRemote: async (): Promise<string | null> => {
    const svc = await active();
    return typeof (svc as any).diagnoseRemote === 'function' ? await (svc as any).diagnoseRemote() : null;
  },
  ensureSchema: async (): Promise<void> => {},
  ensureStudentsDependencies: async (): Promise<void> => {},
  getTableName: (table: string): string => table,
  getUserId: async (): Promise<string | null> => {
    const svc = await active();
    return svc.getUserId();
  },
  pullAll: async (): Promise<void> => {
    const svc = await active();
    await svc.pullAll();
  },
  pullAllSilent: async (): Promise<void> => {
    const svc = await active();
    await svc.pullAllSilent();
  },
  startPeriodicSync: async (): Promise<void> => {
    const svc = await active();
    svc.startPeriodicSync();
  },
  stopPeriodicSync: async (): Promise<void> => {
    driveSyncService.stopPeriodicSync();
    d1SyncService.stopPeriodicSync();
  },
  syncAll: async (): Promise<void> => {
    const svc = await active();
    await svc.syncAll();
  },
  syncPendingDeletions: async (): Promise<void> => {
    const svc = await active();
    await svc.syncPendingDeletions();
  },
  syncStudent: async (student: any, isNew?: boolean): Promise<void> => {
    const svc = await active();
    await svc.syncStudent(student, isNew);
  },
  syncGradeConfig: async (config: any): Promise<void> => {
    const svc = await active();
    await svc.syncGradeConfig(config);
  },
  wipeRemoteData: async (): Promise<void> => {
    const svc = await active();
    await svc.wipeRemoteData();
  },
  forcePushAll: async (): Promise<void> => {
    const svc = await active();
    await svc.forcePushAll();
  },
  forcePushAllSilent: async (): Promise<void> => {
    const svc = await active();
    await svc.forcePushAllSilent();
  },
  pullAllGuarded: async (): Promise<{ pulled: boolean; blocked: boolean }> => {
    const svc = await active();
    return svc.pullAllGuarded();
  },
  pushAll: async (): Promise<void> => {
    const svc = await active();
    await svc.pushAll();
  },
  pushAllSilent: async (): Promise<void> => {
    const svc = await active();
    await svc.pushAllSilent();
  },
  connectAndSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    const svc = await active();
    return svc.connectAndSetup();
  },
  runSchemaSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    const svc = await active();
    return svc.runSchemaSetup();
  },
  testConnection: async (): Promise<{ ok: boolean; latency: number; error?: string }> => {
    const svc = await active();
    return svc.testConnection();
  },
  syncGlobal: async (table: string, data?: any, isNew?: boolean): Promise<void> => {
    const svc = await active();
    await svc.syncGlobal(table, data, isNew);
  },
  deleteGlobal: async (table: string, id: number): Promise<void> => {
    const svc = await active();
    await svc.deleteGlobal(table, id);
  },
  syncStudentsBatch: async (students: any[]): Promise<void> => {
    const svc = await active();
    await svc.syncStudentsBatch(students);
  },
  deleteStudent: async (id: number): Promise<void> => {
    const svc = await active();
    await svc.deleteStudent(id);
  },
  syncColegioSubjects: async (colegioId: number, subjectIds: number[]): Promise<void> => {
    const svc = await active();
    await svc.syncColegioSubjects(colegioId, subjectIds);
  },
  syncColegioDias: async (config: any): Promise<void> => {
    const svc = await active();
    await svc.syncColegioDias(config);
  },
  syncGradeSubjects: async (gradoId: number): Promise<void> => {
    const svc = await active();
    await svc.syncGradeSubjects(gradoId);
  },
  syncEvaluacionConfig: async (indicadores: any[]): Promise<void> => {
    const svc = await active();
    await svc.syncEvaluacionConfig(indicadores);
  },
  syncNotasBatch: async (notas: any[]): Promise<void> => {
    const svc = await active();
    await svc.syncNotasBatch(notas);
  },
  syncAsistenciaBatch: async (records: any[]): Promise<void> => {
    const svc = await active();
    await svc.syncAsistenciaBatch(records);
  },
  disconnect: async (): Promise<void> => {
    driveSyncService.disconnect();
    d1SyncService.disconnect();
  },
};