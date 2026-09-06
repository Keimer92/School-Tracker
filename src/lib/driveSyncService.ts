import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { markDirty, markAllDirty, markAllClean, hasDirtyTables } from './dirtyTracker';

const STORAGE_KEY = 'schooltracker-google-drive-settings';
const SYNC_FILE_PREFIX = 'SchoolTracker_Sync';
// Solo mantenemos el respaldo más reciente en Drive (uno por cuenta).
const MAX_SYNC_FILES = 1;
// Carpeta destino en Drive: Keimer Labs/School Tracker MINED
const DRIVE_FOLDER_PATH = ['Keimer Labs', 'School Tracker MINED'];
const AUTO_BACKUP_KEY = 'drive_auto_backup_minutes';
const AUTO_BACKUP_DEFAULT_MIN = 180; // cada 3 horas

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success' | 'offline';

interface DriveSettings {
  clientId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;
  googleUserEmail: string | null;
  googleUserName: string | null;
  googleUserProfilePic: string | null;
}

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  createdTime: string;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  pct: number;
}

interface SyncState {
  status: SyncStatus;
  lastSync: string | null;
  lastSyncDetails: string | null;
  message: string | null;
  lastUpload: string | null;
  lastDownload: string | null;
  downloadProgress: DownloadProgress | null;
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
    downloadProgress: null,
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
    if (!response.ok) {
      console.error('[DriveSync] Error refrescando token:', await response.text());
      // Limpiar token expirado para que la UI muestre "desconectado"
      settings.accessToken = '';
      settings.tokenExpiry = 0;
      saveSettings(settings);
      return null;
    }
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

function devicePlatform(): 'Windows' | 'Android' {
  return /Android/i.test(navigator.userAgent) ? 'Android' : 'Windows';
}

/** Etiqueta de la cuenta actual para aislar los respaldos de Drive por cuenta. */
function accountTag(): string {
  const s = getSettings() as any;
  const email = s?.googleUserEmail || '';
  const tag = (email || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return tag || 'default';
}

function timestampFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${SYNC_FILE_PREFIX}_${accountTag()}_${devicePlatform()}_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`;
}

let cachedFolderId: string | null = localStorage.getItem('drive_backup_folder_id') || null;

/** Busca una carpeta por nombre dentro de parentId (o la raíz); la crea si no existe. */
async function findOrCreateFolder(token: string, name: string, parentId: string | null): Promise<string | null> {
  const esc = name.replace(/'/g, "\\'");
  let q = `name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.files?.length) return data.files[0].id as string;
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createResp.ok) return null;
  const created = await createResp.json();
  return created.id || null;
}

/** Garantiza Keimer Labs/School Tracker MINED y devuelve el id de la carpeta final. */
async function ensureBackupFolder(token: string): Promise<string | null> {
  if (cachedFolderId) return cachedFolderId;
  let parentId: string | null = null;
  for (const name of DRIVE_FOLDER_PATH) {
    parentId = await findOrCreateFolder(token, name, parentId);
    if (!parentId) return null;
  }
  cachedFolderId = parentId;
  if (parentId) localStorage.setItem('drive_backup_folder_id', parentId);
  return parentId;
}

async function listSyncFiles(token: string): Promise<DriveFile[]> {
  // Archivos en la carpeta destino + legacy en raíz (para restaurar/limpiar),
  // filtrados por la etiqueta de la cuenta para no mezclar respaldos de distintas cuentas.
  const tag = accountTag();
  const inner = cachedFolderId
    ? `'${cachedFolderId}' in parents or name contains '${SYNC_FILE_PREFIX}_${tag}_'`
    : `name contains '${SYNC_FILE_PREFIX}_${tag}_'`;
  const q = `(${inner}) and trashed=false`;
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.files || []).map((f: any) => ({
    id: f.id, name: f.name, size: f.size || 0, createdTime: f.createdTime || '',
  }));
}

async function deleteOldSyncVersions(token: string): Promise<void> {
  const files = await listSyncFiles(token);
  if (files.length <= MAX_SYNC_FILES) return;
  const toDelete = files.slice(MAX_SYNC_FILES);
  await Promise.allSettled(
    toDelete.map(f =>
      fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    )
  );
}

function now() {
  return new Date().toISOString();
}

function fmtTime() {
  return new Date().toLocaleTimeString();
}

function toSqliteUtc(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function hasLocalChanges(): Promise<boolean> {
  if (hasDirtyTables()) return true;
  const since = toSqliteUtc(localStorage.getItem('drive_last_sync_time'));
  if (!since) return false;
  try {
    return await invoke<boolean>('has_local_changes', { since });
  } catch (e) {
    console.error('[DriveSync] Error chequeando cambios locales:', e);
    return true;
  }
}

/** Descarga un archivo de Drive y lo restaura como base de datos local. */
async function downloadAndRestore(token: string, fileId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Error descargando: ${response.statusText}`);

  // Descarga en streaming con reporte de progreso (bytes vs Content-Length)
  syncManager.setState({ downloadProgress: { loaded: 0, total: 0, pct: 0 } });
  let blob: Blob;
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastReported = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const pct = contentLength > 0 ? Math.min(100, Math.floor((loaded / contentLength) * 100)) : -1;
      // Notificar solo cuando cambia el porcentaje entero (máx ~100 updates)
      if (pct !== lastReported) {
        lastReported = pct;
        syncManager.setState({ downloadProgress: { loaded, total: contentLength, pct: Math.max(0, pct) } });
      }
    }
    blob = new Blob(chunks as BlobPart[]);
  } else {
    blob = await response.blob();
  }
  syncManager.setState({ downloadProgress: { loaded: blob.size, total: blob.size, pct: 100 } });

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
  syncManager.setState({ downloadProgress: null });
  await invoke('gd_write_file_base64', { path: dbPath, contentBase64: base64 });
  await invoke('gd_reload_database', {});
  // La identidad del dispositivo NUNCA debe viajar dentro de un respaldo:
  // si el backup incluyó la tabla d1_config, restaurarla duplicaría el
  // device_id entre dispositivos y rompería el push en tiempo real.
  try { await invoke('d1_reset_device_id'); } catch {}
  syncManager.setState({ lastDownload: now() });
  markAllClean();
  // Refrescar TODAS las páginas con los datos del respaldo recién restaurado.
  // Sin estos eventos, las páginas ya montadas siguen mostrando la caché/anterior
  // en memoria y no se enteran de que la base se sobrescribió.
  try {
    await emit('catalog-updated', { timestamp: Date.now() });
    await emit('student-updated', { timestamp: Date.now() });
    await emit('notas-updated', { timestamp: Date.now() });
    await emit('asistencia-updated', { timestamp: Date.now() });
    await emit('subjects-updated', { timestamp: Date.now() });
    await emit('grade-configs-updated', { timestamp: Date.now() });
    await emit('data-updated', { timestamp: Date.now() });
  } catch (e) {
    console.error('[DriveSync] Error emitiendo eventos post-restore:', e);
  }
}

export const driveSyncService = {
  _periodicTimer: null as ReturnType<typeof setInterval> | null,
  _syncLock: false,

  listSyncFiles,
  hasLocalChanges,

  /** Info del respaldo más reciente en Drive para esta cuenta (o null si no hay). */
  getLatestBackup: async (): Promise<DriveFile | null> => {
    const token = await getValidToken();
    if (!token) return null;
    const files = await listSyncFiles(token);
    if (files.length === 0) return null;
    return files.reduce((a, b) => a.createdTime >= b.createdTime ? a : b);
  },

  syncAll: async (): Promise<void> => {
    await driveSyncService.syncAllSilent(true);
  },

  syncAllSilent: async (dispatchEvents: boolean = true): Promise<void> => {
    while ((driveSyncService as any)._syncLock) {
      await new Promise(r => setTimeout(r, 500));
    }
    (driveSyncService as any)._syncLock = true;
    try {
      const token = await getValidToken();
      if (token && navigator.onLine) {
        // Drive es SOLO respaldo: nunca se restaura automáticamente desde aquí.
        // Solo subimos (push) si hay cambios locales; el restore es manual
        // (botón "Restaurar"). Así un respaldo antiguo de Drive no sobreescribe
        // los datos de Cloudflare (p. ej. tras un cambio de cuenta).
        const localChanges = await hasLocalChanges();
        if (localChanges) {
          await driveSyncService.pushAll();
        }
      }
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
      const dbBase64 = await invoke<string>('gd_read_file_base64', { path: localBackupPath });
      let folderId = await ensureBackupFolder(token);
      const send = async (fid: string | null) => {
        const fileName = timestampFileName();
        const metadata: any = {
          name: fileName, mimeType: 'application/octet-stream',
          appProperties: { devicePlatform: devicePlatform() },
        };
        if (fid) metadata.parents = [fid];
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
        return { xhr, fileName };
      };
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const { xhr, fileName } = await send(folderId);
        console.debug(`[DriveSync] Archivo creado, status: ${xhr.status} (${fileName})`);
        if (xhr.status === 404 && cachedFolderId) {
          console.warn('[DriveSync] Carpeta destino no encontrada (404); reintentando con carpeta recién creada');
          cachedFolderId = null;
          localStorage.removeItem('drive_backup_folder_id');
          folderId = await ensureBackupFolder(token);
          continue;
        }
        try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}
        await deleteOldSyncVersions(token);
        syncManager.setState({ lastUpload: now() });
        markAllClean();
        ok = true;
      }
      if (!ok) {
        throw new Error('La carpeta de respaldo desapareció; reintenta para recrearla');
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
      const files = await listSyncFiles(token);
      if (files.length === 0) {
        console.debug('[DriveSync] No hay archivos de sync en Drive');
        return;
      }
      const newest = files.reduce((a, b) => a.createdTime >= b.createdTime ? a : b);
      await downloadAndRestore(token, newest.id);
      console.debug('[DriveSync] Archivo descargado y restaurado correctamente');
    })(), 'descargar desde Google Drive');
  },

  pullById: async (fileId: string): Promise<void> => {
    const token = await getValidToken();
    if (!token) throw new Error('Google Drive no está vinculado');
    if (!navigator.onLine) {
      syncManager.setState({ status: 'offline', message: 'Sin conexión' });
      return;
    }
    await syncManager.wrapSync((async () => {
      await downloadAndRestore(token, fileId);
    })(), 'restaurar respaldo');
  },

  pullAllSilent: async (): Promise<void> => {
    try {
      await driveSyncService.pullAll();
    } catch (e) {
      console.warn('[DriveSync] Pull Silent error:', e);
    }
  },

  pullAllGuarded: async (): Promise<{ pulled: boolean; blocked: boolean }> => {
    if (await hasLocalChanges()) {
      return { pulled: false, blocked: true };
    }
    await driveSyncService.pullAll();
    return { pulled: true, blocked: false };
  },

  ensurePeriodicSync: () => {
    if ((driveSyncService as any)._periodicTimer) return;
    driveSyncService.startPeriodicSync();
  },

  startPeriodicSync: () => {
    // Google Drive ya no sincroniza automáticamente: solo se usa como respaldo
    // manual desde la página de nube (CloudPage).
  },

  stopPeriodicSync: () => {
    if ((driveSyncService as any)._periodicTimer) {
      clearInterval((driveSyncService as any)._periodicTimer);
      (driveSyncService as any)._periodicTimer = null;
    }
  },

  _autoBackupTimer: null as ReturnType<typeof setInterval> | null,

  /** Configura el respaldo automático a Drive cada N minutos (0 = desactivado). */
  setAutoBackupInterval: (minutes: number): void => {
    const mins = Math.max(0, Math.round(minutes));
    localStorage.setItem(AUTO_BACKUP_KEY, String(mins));
    if ((driveSyncService as any)._autoBackupTimer) {
      clearInterval((driveSyncService as any)._autoBackupTimer);
      (driveSyncService as any)._autoBackupTimer = null;
    }
    if (!mins) return;
    (driveSyncService as any)._autoBackupTimer = setInterval(async () => {
      try {
        const token = await getValidToken();
        if (!token || !navigator.onLine) return;
        // Solo sube si hubo cambios locales desde el último respaldo
        if (!(await hasLocalChanges())) return;
        console.debug('[DriveSync] Respaldo automático iniciando...');
        await driveSyncService.pushAll(true);
        console.debug('[DriveSync] Respaldo automático completado');
      } catch (e) {
        console.warn('[DriveSync] Error en respaldo automático:', e);
      }
    }, mins * 60000);
    console.debug(`[DriveSync] Respaldo automático activo cada ${mins} min`);
  },

  /** Arranca el respaldo automático con el intervalo guardado (default: 180 min). */
  ensureAutoBackup: (): void => {
    if ((driveSyncService as any)._autoBackupTimer) return;
    const stored = parseInt(localStorage.getItem(AUTO_BACKUP_KEY) || '', 10);
    const mins = Number.isFinite(stored) && stored > 0 ? stored : AUTO_BACKUP_DEFAULT_MIN;
    driveSyncService.setAutoBackupInterval(mins);
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
      const files = await listSyncFiles(token);
      await Promise.allSettled(
        files.map(f =>
          fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {})
        )
      );
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
