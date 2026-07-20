import { tursoSyncService } from './tursoSyncService';
import { syncService as supabaseSyncService } from './syncService.supabase';

export type { SyncStatus } from './tursoSyncService';
export { syncManager } from './tursoSyncService';

export type SyncProviderType = 'turso' | 'supabase';

const STORAGE_KEY = 'sync_provider';

function loadProvider(): SyncProviderType {
  if (typeof localStorage === 'undefined') return 'turso';
  return (localStorage.getItem(STORAGE_KEY) as SyncProviderType) || 'turso';
}

let _activeProvider: SyncProviderType = loadProvider();
const _providerListeners: Set<() => void> = new Set();

function getService() {
  return _activeProvider === 'turso' ? tursoSyncService : supabaseSyncService;
}

export function getActiveProvider(): SyncProviderType {
  return _activeProvider;
}

export function onProviderChange(cb: () => void) {
  _providerListeners.add(cb);
  return () => _providerListeners.delete(cb);
}

export function setActiveProvider(p: SyncProviderType) {
  if (p === _activeProvider) return;
  try { getService().stopPeriodicSync?.(); } catch {}
  _activeProvider = p;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, p);
  }
  _providerListeners.forEach(cb => cb());
}

export const syncService = new Proxy({} as typeof tursoSyncService, {
  get(_, prop) {
    return (getService() as any)[prop];
  },
});

export const forcePullAsistencia = async (fecha: string, _gradoId: number, _seccionId: number): Promise<void> => {
  const svc = getService();
  await (svc.pullAllSilent?.() ?? svc.pullAll());
};

export const forcePullNotas = async (
  _anoLectivoId: number, _corteId: number, _colegioId: number,
  _gradoId: number, _seccionId: number, _asignaturaId: number
): Promise<void> => {
  const svc = getService();
  await (svc.pullAllSilent?.() ?? svc.pullAll());
};
