import { driveSyncService, syncManager } from './driveSyncService';

export type { SyncStatus } from './driveSyncService';
export { syncManager };

export const syncService = driveSyncService;

export const forcePullAsistencia = async (fecha: string, _gradoId: number, _seccionId: number): Promise<void> => {
  await syncService.pullAllSilent();
};

export const forcePullNotas = async (
  _anoLectivoId: number, _corteId: number, _colegioId: number,
  _gradoId: number, _seccionId: number, _asignaturaId: number
): Promise<void> => {
  await syncService.pullAllSilent();
};
