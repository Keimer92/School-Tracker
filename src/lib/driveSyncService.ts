import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { markDirty, markAllDirty, markAllClean, hasDirtyTables } from './dirtyTracker';

const STORAGE_KEY = 'schooltracker-google-drive-settings';
const SYNC_FILE_NAME = 'SchoolTracker_Sync.db';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success' | 'offline';

interface DriveSettings {
  clientId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;
  deviceName: string;
  googleUserEmail: string | null;
  googleUserName: string | null;
  googleUserProfilePic: string | null;
}

interface SyncState {
  status: SyncStatus;
  lastSync: string | null;
  lastSyncDetails: string | null;
  message: string | null;
  lastUpload: string | null;
  lastDownload: string | null;
}

type SyncListener = (state: SyncState) => void;

class SyncManager {
  private state: SyncState = {
    status: 'idle',
    lastSync: localStorage.getItem('drive_last_sync_time'),
    lastSyncDetails: localStorage.getItem('drive_last_sync_details'),
    message: null,
    lastUpload: localStorage.getItem('drive_last_upload'),
    lastDownload: localStorage.getItem('drive_last_download'),
  };
  private listeners: SyncListener[] = [];

  subscribe(listener: SyncListener) {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  setState(newState: Partial<SyncState>) {
    this.state = { ...this.state, ...newState };
    if (newState.lastSync) localStorage.setItem('drive_last_sync_time', newState.lastSync);
    if (newState.lastSyncDetails) localStorage.setItem('drive_last_sync_details', newState.lastSyncDetails);
    if (newState.lastUpload) localStorage.setItem('drive_last_upload', newState.lastUpload);
    if (newState.lastDownload) localStorage.setItem('drive_last_download', newState.lastDownload);
    this.listeners.forEach(l => l(this.state));
  }

  getState() {
    return this.state;
  }

  async wrapSync(promise: Promise<any>, description: string) {
    this.setState({ status: 'syncing', message: `Sincronizando ${description}...` });
    try {
      const result = await promise;
      this.setState({
        status: 'success',
        lastSync: new Date().toISOString(),
        lastSyncDetails: description,
        message: null,
      });
      return result;
    } catch (e: any) {
      this.setState({
        status: 'error',
        message: `Error en ${description}: ${e?.message || e}`,
      });
      throw e;
    }
  }
}

export const syncManager = new SyncManager();

function getSettings(): DriveSettings | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch { return null; }
}

function saveSettings(settings: DriveSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function refreshAccessToken(): Promise<string | null> {
  const settings = getSettings();
  if (!settings?.refreshToken) return null;
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
  if (!clientSecret) { console.error('[DriveSync] VITE_GOOGLE_CLIENT_SECRET no configurado'); return null; }
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: clientSecret,
        refresh_token: settings.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) { console.error('[DriveSync] Error refrescando token:', await response.text()); return null; }
    const data = await response.json();
    settings.accessToken = data.access_token;
    settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) settings.refreshToken = data.refresh_token;
    saveSettings(settings);
    return data.access_token;
  } catch (e) {
    console.error('[DriveSync] Error refrescando token:', e);
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  const settings = getSettings();
  if (!settings) return null;
  if (settings.accessToken && settings.tokenExpiry && settings.tokenExpiry > Date.now() + 120000) {
    return settings.accessToken;
  }
  return await refreshAccessToken();
}

async function findOrCreateSyncFile(token: string): Promise<string | null> {
  const listResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${SYNC_FILE_NAME}' and trashed=false&fields=files(id,name,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listResponse.ok) { console.error('[DriveSync] Error buscando archivo:', await listResponse.text()); return null; }
  const data = await listResponse.json();
  const files = data.files || [];
  if (files.length > 0) return files[0].id;
  return null;
}

async function findSyncFile(token: string): Promise<{ id: string; modifiedTime: string } | null> {
  const listResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${SYNC_FILE_NAME}' and trashed=false&fields=files(id,name,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listResponse.ok) return null;
  const data = await listResponse.json();
  const files = data.files || [];
  if (files.length > 0) return { id: files[0].id, modifiedTime: files[0].modifiedTime };
  return null;
}

function now() {
  return new Date().toISOString();
}

function fmtTime() {
  return new Date().toLocaleTimeString();
}

export const driveSyncService = {
  _periodicTimer: null as ReturnType<typeof setInterval> | null,
  _syncLock: false,

  syncAll: async (): Promise<void> => {
    await driveSyncService.syncAllSilent(true);
  },

  syncAllSilent: async (dispatchEvents: boolean = true): Promise<void> => {
    while ((driveSyncService as any)._syncLock) {
      await new Promise(r => setTimeout(r, 500));
    }
    (driveSyncService as any)._syncLock = true;
    try {
      await driveSyncService.pushAll();
      await driveSyncService.pullAll();
      syncManager.setState({
        lastSync: now(),
        lastSyncDetails: `Sync completo (${fmtTime()})`,
      });
      if (dispatchEvents) {
        try {
          await emit("catalog-updated");
          await emit("student-updated", { timestamp: Date.now() });
          await emit("notas-updated", { timestamp: Date.now() });
          await emit("asistencia-updated");
          await emit("grade-configs-updated");
          await emit("subjects-updated");
        } catch (e) {
          console.warn("[DriveSync] Error emitiendo eventos:", e);
        }
        window.dispatchEvent(new CustomEvent('schooltracker-sync', { detail: { timestamp: Date.now() } }));
      }
    } catch (e) {
      console.error('[DriveSync] Error en syncAllSilent:', e);
    } finally {
      (driveSyncService as any)._syncLock = false;
    }
  },

  pushAll: async (force: boolean = false): Promise<void> => {
    const token = await getValidToken();
    if (!token) throw new Error('Google Drive no está vinculado');
    if (!navigator.onLine) {
      syncManager.setState({ status: 'offline', message: 'Sin conexión' });
      return;
    }
    await syncManager.wrapSync((async () => {
      const localBackupPath = await invoke<string>('gd_create_backup');
      try {
        const dbBase64 = await invoke<string>('gd_read_file_base64', { path: localBackupPath });
        const settings = getSettings();
        const deviceName = settings?.deviceName?.replace(/\s+/g, '_') || 'unknown';
        const timestampStr = now();
        const metadata = {
          name: SYNC_FILE_NAME,
          description: JSON.stringify({ device: deviceName, timestamp: timestampStr, type: 'schooltracker_sync' }),
        };
        const existingId = await findSyncFile(token);
        if (existingId) {
          const boundary = 'schooltracker_sync_boundary';
          const multipartBody =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: application/octet-stream\r\n` +
            `Content-Transfer-Encoding: base64\r\n\r\n` +
            `${dbBase64}\r\n` +
            `--${boundary}--`;
          const xhr = await new Promise<{ status: number }>((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('PATCH', `https://www.googleapis.com/upload/drive/v3/files/${existingId.id}?uploadType=multipart`);
            x.setRequestHeader('Authorization', `Bearer ${token}`);
            x.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
            x.onload = () => resolve({ status: x.status });
            x.onerror = () => reject(new Error('Network error'));
            x.send(multipartBody);
          });
          console.log(`[DriveSync] Archivo actualizado, status: ${xhr.status}`);
        } else {
          const boundary = 'schooltracker_sync_boundary';
          const multipartBody =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: application/octet-stream\r\n` +
            `Content-Transfer-Encoding: base64\r\n\r\n` +
            `${dbBase64}\r\n` +
            `--${boundary}--`;
          const xhr = await new Promise<{ status: number }>((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
            x.setRequestHeader('Authorization', `Bearer ${token}`);
            x.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
            x.onload = () => resolve({ status: x.status });
            x.onerror = () => reject(new Error('Network error'));
            x.send(multipartBody);
          });
          console.log(`[DriveSync] Archivo creado, status: ${xhr.status}`);
        }
        try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}
        syncManager.setState({ lastUpload: now() });
      } catch (e) {
        try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}
        throw e;
      }
    })(), 'subir a Google Drive');
  },

  pushAllSilent: async (force: boolean = false): Promise<void> => {
    try {
      await driveSyncService.pushAll(force);
    } catch (e) {
      console.warn('[DriveSync] Push Silent error:', e);
    }
  },

  forcePushAll: async (): Promise<void> => {
    await driveSyncService.pushAll(true);
  },

  forcePushAllSilent: async (): Promise<void> => {
    try {
      await driveSyncService.pushAll(true);
    } catch (e) {
      console.warn('[DriveSync] Force Push Silent error:', e);
    }
  },

  pullAll: async (): Promise<void> => {
    const token = await getValidToken();
    if (!token) throw new Error('Google Drive no está vinculado');
    if (!navigator.onLine) {
      syncManager.setState({ status: 'offline', message: 'Sin conexión' });
      return;
    }
    await syncManager.wrapSync((async () => {
      const file = await findSyncFile(token);
      if (!file) {
        console.log('[DriveSync] No hay archivo de sync en Drive');
        return;
      }
      const lastPull = localStorage.getItem('drive_last_pull_time');
      if (lastPull && file.modifiedTime <= lastPull) {
        console.log('[DriveSync] Archivo remoto no ha cambiado desde último pull');
        return;
      }
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Error descargando: ${response.statusText}`);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.includes(',') ? result.split(',')[1] : result;
          resolve(base64Data);
        };
        reader.onerror = () => reject(new Error('Error leyendo blob'));
        reader.readAsDataURL(blob);
      });
      const dbPath = await invoke<string>('get_db_path');
      await invoke('gd_create_backup', {});
      await invoke('gd_write_file_base64', { path: dbPath, contentBase64: base64 });
      localStorage.setItem('drive_last_pull_time', new Date().toISOString());
      syncManager.setState({ lastDownload: now() });
      console.log('[DriveSync] Archivo descargado y restaurado correctamente');
    })(), 'descargar desde Google Drive');
  },

  pullAllSilent: async (): Promise<void> => {
    try {
      await driveSyncService.pullAll();
    } catch (e) {
      console.warn('[DriveSync] Pull Silent error:', e);
    }
  },

  ensurePeriodicSync: () => {
    if ((driveSyncService as any)._periodicTimer) return;
    driveSyncService.startPeriodicSync();
  },

  startPeriodicSync: () => {
    const intervalStr = localStorage.getItem('periodic_sync_interval_seconds');
    const interval = Math.max(30, Math.min(300, parseInt(intervalStr || '60') || 60)) * 1000;
    if ((driveSyncService as any)._periodicTimer) clearInterval((driveSyncService as any)._periodicTimer);
    (driveSyncService as any)._periodicTimer = setInterval(async () => {
      if (!getValidToken()) {
        driveSyncService.stopPeriodicSync();
        return;
      }
      syncManager.setState({ status: 'syncing', message: 'Sync automático...' });
      await driveSyncService.syncAllSilent(false);
      try { await emit("notas-updated", { timestamp: Date.now() }); } catch {}
      try { await emit("asistencia-updated"); } catch {}
      syncManager.setState({ status: 'idle', message: null });
    }, interval);
  },

  stopPeriodicSync: () => {
    if ((driveSyncService as any)._periodicTimer) {
      clearInterval((driveSyncService as any)._periodicTimer);
      (driveSyncService as any)._periodicTimer = null;
    }
  },

  getUserId: async (): Promise<string | null> => {
    const settings = getSettings();
    return settings?.googleUserEmail || settings?.googleUserName || null;
  },

  testConnection: async (): Promise<{ ok: boolean; latency: number; error?: string }> => {
    const token = await getValidToken();
    if (!token) return { ok: false, latency: 0, error: 'Google Drive no está vinculado' };
    try {
      const start = performance.now();
      const response = await fetch('https://www.googleapis.com/drive/v3/files?pageSize=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const latency = Math.round(performance.now() - start);
      if (!response.ok) return { ok: false, latency, error: response.statusText };
      return { ok: true, latency };
    } catch (e: any) {
      return { ok: false, latency: 0, error: e?.message || String(e) };
    }
  },

  connectAndSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    const token = await getValidToken();
    if (!token) return { ok: false, error: 'No se pudo obtener token de acceso' };
    const test = await driveSyncService.testConnection();
    if (!test.ok) return { ok: false, error: test.error };
    markAllDirty();
    return { ok: true };
  },

  runSchemaSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    return { ok: true };
  },

  wipeRemoteData: async (): Promise<void> => {
    const token = await getValidToken();
    if (!token) return;
    await syncManager.wrapSync((async () => {
      const file = await findSyncFile(token);
      if (file) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      localStorage.removeItem('drive_last_pull_time');
      syncManager.setState({
        lastSync: null, lastUpload: null, lastDownload: null,
      });
    })(), 'eliminar datos remotos');
  },

  disconnect: () => {
    driveSyncService.stopPeriodicSync();
    localStorage.removeItem(STORAGE_KEY);
    syncManager.setState({
      status: 'idle', lastSync: null, lastUpload: null, lastDownload: null, message: null,
    });
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
