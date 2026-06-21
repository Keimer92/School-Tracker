export { tursoSyncService as syncService, syncManager } from './tursoSyncService';
export type { SyncStatus } from './tursoSyncService';

export const forcePullAsistencia = async (fecha: string, _gradoId: number, _seccionId: number): Promise<void> => {
  const { tursoSyncService } = await import('./tursoSyncService');
  await tursoSyncService.pullAllSilent();
};

export const forcePullNotas = async (
  _anoLectivoId: number, _corteId: number, _colegioId: number,
  _gradoId: number, _seccionId: number, _asignaturaId: number
): Promise<void> => {
  const { tursoSyncService } = await import('./tursoSyncService');
  await tursoSyncService.pullAllSilent();
};
