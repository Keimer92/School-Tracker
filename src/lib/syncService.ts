export { pocketbaseSyncService as syncService, syncManager } from './pocketbaseSyncService';
export type { SyncStatus } from './pocketbaseSyncService';

export const forcePullAsistencia = async (fecha: string, _gradoId: number, _seccionId: number): Promise<void> => {
  console.log('[ForcePull] PocketBase no necesita forcePull - los datos ya están sincronizados');
};

export const forcePullNotas = async (
  _anoLectivoId: number, _corteId: number, _colegioId: number,
  _gradoId: number, _seccionId: number, _asignaturaId: number
): Promise<void> => {
  console.log('[ForcePull] PocketBase no necesita forcePull - los datos ya están sincronizados');
};
