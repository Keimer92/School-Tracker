import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { markDirty, markAllDirty, markAllClean, hasDirtyTables } from './dirtyTracker';

const STORAGE_KEY = 'schooltracker-google-drive-settings';
const SYNC_FILE_PREFIX = 'SchoolTracker_Sync';
// Total de archivos de respaldo que se conservan en Drive por cuenta:
//   1) el archivo estable "_latest" (se ACTUALIZA en cada guardado) y
//   2) el snapshot con timestamp más reciente.
// Los que sobran se borran (Drive los manda a la papelera, por eso el total
// se mantiene en 2: crear un archivo por cada guardado llenaría la cuota).
const MAX_SYNC_FILES = 2;
const LATEST_SUFFIX = 'latest';
// Carpeta destino en Drive: Keimer Labs/School Tracker MINED
const DRIVE_FOLDER_PATH = ['Keimer Labs', 'School Tracker MINED'];
const AUTO_BACKUP_KEY = 'drive_auto_backup_minutes';
const AUTO_BACKUP_DEFAULT_MIN = 180; // cada 3 horas (temporizador desactivado)
/** El temporizador periódico solo corre si esta clave está en 'true'. */
const AUTO_BACKUP_ENABLED_KEY = 'drive_auto_backup_enabled';

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
  /** Última modificación en Drive: para el archivo "_latest" es el backup real. */
  modifiedTime?: string;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  pct: number;
}

/** Progreso de subida a Drive (bytes reales del .db, no del base64). */
export interface UploadProgress {
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
  /** Progreso de la subida en curso (null si no hay ninguna). */
  uploadProgress: UploadProgress | null;
  /** Tamaño (bytes) del último archivo de respaldo enviado a Drive. */
  lastUploadBytes: number | null;
  /** Momento + tamaño del último respaldo confirmado en Drive (lo fija el refresco de la lista). */
  lastUploadFile: { when: string | null; bytes: number | null; name: string | null } | null;
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
    uploadProgress: null,
    lastUploadBytes: parseInt(localStorage.getItem('drive_last_upload_bytes') || '', 10) || null,
    lastUploadFile: null,
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
    if (newState.lastUploadBytes) localStorage.setItem('drive_last_upload_bytes', String(newState.lastUploadBytes));
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
      const texto = await response.text();
      // 400 invalid_grant / 401 = el refresh_token quedo revocado o invalido:
      // eso SI requiere rehacer el login. Cualquier otro status (429 por cuota,
      // 5xx del servidor de Google) es pasajero y se conserva la sesion.
      const definitivo = response.status === 400 || response.status === 401;
      if (definitivo) {
        console.error('[DriveSync] Refresh token rechazado; se pide re-login:', texto);
        settings.accessToken = '';
        settings.tokenExpiry = 0;
        saveSettings(settings);
      } else {
        console.warn(`[DriveSync] Refresh falló con HTTP ${response.status} (transitorio, se conserva la sesion):`, texto);
      }
      return null;
    }
    const data = await response.json();
    settings.accessToken = data.access_token;
    settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) settings.refreshToken = data.refresh_token;
    saveSettings(settings);
    return data.access_token;
  } catch (e) {
    // FALLO TRANSITORIO (red, TLS, Android sin cobertura momentanea). NO se
    // toca el token: `refreshToken` sigue siendo valido y el proximo intento
    // se recupera solo. Borrarlo aqui hacia que la UI mostrara "desconectado"
    // y el usuario tuviera que rehacer el login por un fallo de red pasajero.
    console.warn('[DriveSync] Fallo transitorio al refrescar el token (se conserva la sesion):', e);
    return null;
  }
}

/**
 * Intenta recuperar la sesion sin intervencion del usuario: si el
 * `accessToken` quedo vacio (o por vencer) pero hay `refreshToken`, renueva.
 * La UI deriva "conectado" de `accessToken` no vacio, asi que sin esto un
 * fallo pasajero se ve como sesion perdida.
 */
export async function ensureDriveSession(): Promise<boolean> {
  const settings = getSettings();
  if (!settings?.refreshToken) return false;
  if (settings.accessToken && settings.tokenExpiry && settings.tokenExpiry > Date.now() + 120000) {
    return true;
  }
  const token = await refreshAccessToken();
  return !!token;
}

/**
 * Recupera el email de la cuenta si se perdio.
 *
 * Sin `googleUserEmail`, `accountTag()` cae a "default", el nombre del archivo
 * deja de coincidir con el que hay en Drive y la app CREA un respaldo nuevo en
 * cada guardado (copias duplicadas). El email no se puede deducir del token, asi
 * que la unica fuente es lacached del perfil o el nombre de cuenta guardado.
 */
export async function ensureDriveAccountEmail(): Promise<boolean> {
  const settings = getSettings();
  if (!settings || settings.googleUserEmail) return !!settings?.googleUserEmail;

  // 1) Email de la cuenta activa ya guardado (no requiere red).
  try {
    const mod = await import("../lib/accountProfiles");
    const email = mod.getCurrentEmail?.() || "";
    if (email) {
      settings.googleUserEmail = email;
      saveSettings(settings);
      console.warn("[DriveSync] Se restauró el email de la cuenta activa:", email);
      return true;
    }
  } catch { /* el modulo puede no estar disponible */ }

  // 2) Sin perfil local: solo el refresh token puede confirmarlo, y no trae el
  //    email. Se deja el estado como estaba y se avisa una vez.
  console.warn("[DriveSync] No se pudo recuperar el email de la cuenta; el respaldo usará el tag 'default'.");
  return false;
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

/**
 * Nombre ESTABLE del archivo de respaldo. No lleva timestamp: se sobrescribe en
 * cada guardado (PATCH) en vez de crear un archivo nuevo, para no gastar cuota de
 * API de escritura ni dejar copias. Manual y automático usan el mismo nombre.
 */
function latestFileName(): string {
  return `${SYNC_FILE_PREFIX}_${accountTag()}_${devicePlatform()}_${LATEST_SUFFIX}.db`;
}

function isLatestFile(f: DriveFile): boolean {
  return f.name === latestFileName();
}

function recencyOf(f: DriveFile): string {
  return f.modifiedTime || f.createdTime || '';
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

async function listSyncFilesRaw(token: string): Promise<DriveFile[]> {
  // Solo los respaldos de ESTA cuenta (prefijo por tag), en la carpeta destino
  // o en cualquier otro sitio por si la carpeta cambió. Sin podar.
  const tag = accountTag();
  const q = `name contains '${SYNC_FILE_PREFIX}_${tag}_' and trashed=false`;
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.files || []).map((f: any) => ({
    id: f.id, name: f.name, size: f.size || 0,
    createdTime: f.createdTime || '', modifiedTime: f.modifiedTime || '',
  }));
}

/** Busca un respaldo por nombre exacto (sin podar). */
  async function findSyncFileByName(token: string, name: string): Promise<DriveFile | null> {
    const q = `name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed=false`;
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,createdTime,modifiedTime)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const f = (data.files || [])[0];
    return f ? { id: f.id, name: f.name, size: f.size || 0, createdTime: f.createdTime || '', modifiedTime: f.modifiedTime || '' } : null;
  }

  /**
   * Busca CUALQUIER respaldo de la cuenta dentro de la carpeta destino. Es el
   * fallback cuando el nombre exacto no aparece.
   *
   * Por que hace falta: `accountTag()` deriva del email, y si `googleUserEmail`
   * se perdió (falla `userinfo` en el login) el tag cae a `default`, con lo que
   * el nombre buscado ya no existe en Drive. Sin este fallback la app no
   * encuentra nada y CREA un archivo nuevo en cada guardado, dejando copias
   * duplicadas. Reutilizando el respaldo que ya existe, la app converge sola a un
   * unico archivo por cuenta.
   */
  async function findAnyExistingBackup(token: string, folderId: string | null): Promise<DriveFile | null> {
    const platform = devicePlatform();
    const clauses = [`name contains '${SYNC_FILE_PREFIX}_'`, 'trashed=false'];
    if (folderId) clauses.push(`'${folderId}' in parents`);
    const q = `${clauses.join(' and ')} and name contains '_${platform}_${LATEST_SUFFIX}.db'`;
    try {
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,size,createdTime,modifiedTime)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const files = data.files || [];
      if (files.length === 0) return null;
      // Si hay varias copias, se queda con la mas reciente.
      const f = files[0];
      return { id: f.id, name: f.name, size: f.size || 0, createdTime: f.createdTime || '', modifiedTime: f.modifiedTime || '' };
    } catch {
      return null;
    }
  }


/**
 * Conserva el archivo "_latest" (respaldo instantáneo) y, si queda espacio, el
 * snapshot más reciente; borra el resto. Devuelve la lista ya podada, ordenada
 * por más reciente primero (modifiedTime: en "_latest" es el backup real).
 */
async function pruneSyncFiles(token: string, files: DriveFile[]): Promise<DriveFile[]> {
  const byRecent = [...files].sort((a, b) => recencyOf(b).localeCompare(recencyOf(a)));
  const keep: DriveFile[] = [];
  const latest = byRecent.find(isLatestFile);
  if (latest) keep.push(latest);
  for (const f of byRecent) {
    if (keep.length >= MAX_SYNC_FILES) break;
    if (f === latest) continue;
    keep.push(f);
  }
  const keepIds = new Set(keep.map(f => f.id));
  const toDelete = files.filter(f => !keepIds.has(f.id));
  if (toDelete.length > 0) {
    console.debug(`[DriveSync] Podando ${toDelete.length} respaldo(es) antiguo(s) de Drive`);
    await Promise.allSettled(
      toDelete.map(f =>
        fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
      )
    );
  }
  return keep.sort((a, b) => recencyOf(b).localeCompare(recencyOf(a)));
}

async function listSyncFiles(token: string): Promise<DriveFile[]> {
  const files = await listSyncFilesRaw(token);
  if (files.length <= MAX_SYNC_FILES) {
    return [...files].sort((a, b) => recencyOf(b).localeCompare(recencyOf(a)));
  }
  return pruneSyncFiles(token, files);
}

async function deleteOldSyncVersions(token: string): Promise<void> {
  const files = await listSyncFilesRaw(token);
  if (files.length > MAX_SYNC_FILES) await pruneSyncFiles(token, files);
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

  /**
   * VALIDAR antes de sobrescribir. La base local es la fuente de verdad: si el
   * respaldo de Drive llega vacío o corrupto, escribirlo a ciegas la deja en 0
   * bytes y se pierde TODO el trabajo local sin aviso. Se comprueba que el
   * archivo tenga tamaño razonable y que empiece con la firma de SQLite.
   */
  if (blob.size < 4096) {
    throw new Error(`El respaldo está vacío o truncado (${blob.size} bytes). No se restauró para no perder los datos locales.`);
  }
  const cabecera = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const firma = new TextDecoder().decode(cabecera);
  if (!firma.startsWith('SQLite format 3')) {
    throw new Error('El archivo descargado de Drive no es una base de datos válida. No se restauró.');
  }
  // Copia de seguridad en TEMP (fuera de la carpeta de la app, que se pidió
  // dejar limpia) por si el restore resultara corrupto y hay que volver atrás.
  try { await invoke('gd_snapshot_db'); } catch (e) { console.warn('[DriveSync] sin copia previa:', e); }

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
  syncManager.setState({ downloadProgress: null });
  // Sin copia de seguridad previa: el respaldo de Drive que se está
  // descargando es el respaldo. (Antes se guardaba un backup_<timestamp>.db en
  // la carpeta de la app en cada restauración, llenándola de copias.)
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

/** Tamaño real (bytes) del .db a partir de su base64 (4 chars base64 = 3 bytes). */
function bytesFromBase64(b64: string): number {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = (clean.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * Sube la base (base64) a Drive. Con `fileId` actualiza el archivo existente
 * (PATCH, no crea otro); sin él crea uno nuevo (POST) en `folderId`.
 * `onProgress` reporta bytes REALES del .db (el body va en base64).
 */
async function uploadDbFile(
  token: string,
  dbBase64: string,
  fileName: string,
  folderId: string | null,
  fileId: string | null,
  onProgress?: (p: UploadProgress) => void
): Promise<{ status: number }> {
  const metadata: any = {
    name: fileName,
    mimeType: 'application/octet-stream',
    appProperties: { devicePlatform: devicePlatform(), backupAt: now() },
  };
  // Al actualizar NO se envía parents: no queremos mover el archivo de carpeta.
  if (!fileId && folderId) metadata.parents = [folderId];
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
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`;
  return await new Promise<{ status: number }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(fileId ? 'PATCH' : 'POST', url);
    x.setRequestHeader('Authorization', `Bearer ${token}`);
    x.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
    if (onProgress) {
      const dbBytes = bytesFromBase64(dbBase64);
      x.upload.onprogress = (e: ProgressEvent) => {
        // e.loaded/e.total son bytes del BODY (base64 + cabeceras): escala a bytes del .db
        const ratio = e.total > 0 ? e.loaded / e.total : 0;
        const loaded = Math.min(dbBytes, Math.round(dbBytes * ratio));
        onProgress({ loaded, total: dbBytes, pct: Math.min(100, Math.round(ratio * 100)) });
      };
    }
    x.onload = () => resolve({ status: x.status });
    x.onerror = () => reject(new Error('Network error'));
    x.send(multipartBody);
  });
}

/**
 * Respaldo instantáneo: actualiza en Drive el archivo estable "..._latest.db"
 * con el contenido actual de la base. Se dispara tras cada guardado (notas,
 * asistencia, estudiantes, catálogos...) a través de autoSync.
 *
   * Se ACTUALIZA en lugar de crear un archivo por guardado. Motivo: la API de
   * Drive `files.delete` borra de forma PERMANENTE (no pasa por la papelera, y
   * ver https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete),
   * pero un archivo por cada guardado igual genera peticiones y cuota de API sin
   * necesidad: la cuenta de un usuario normal se limita a ~1000 solicitudes de
   * escritura por 100 segundos, y guardado tras guardado la revienta. Además el
   * archivo de Drive no lo necesita actualizado: la nube autoritativa es D1.
   * Un solo archivo `_latest` actualizado es el estado actual conocido, que es lo
   * que necesita un primer arranque en otro equipo.

 */
async function pushLatestBackup(): Promise<{ ok: boolean; reason?: string; created?: boolean }> {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
    const token = await getValidToken();
    if (!token) return { ok: false, reason: 'no_drive' };
    const fileName = latestFileName();
    // La carpeta se resuelve ANTES de buscar el archivo: el fallback la necesita
    // para acotar la busqueda a los respaldos de la app.
    const folderId = await ensureBackupFolder(token);
    let existente = await findSyncFileByName(token, fileName);
    let reutilizado = false;
    if (!existente) {
      // No hay archivo con ESE nombre (p. ej. porque `accountTag()` cayo a
      // 'default' al perderse el email). Antes de crear uno nuevo se reusa el
      // respaldo que ya haya, para no duplicar en cada guardado.
      existente = await findAnyExistingBackup(token, folderId);
      reutilizado = !!existente;
    }
    // Snapshot en TEMP con nombre fijo: copia consistente del SQLite abierto
    // para subir, sin dejar archivos en la carpeta de la aplicación.
    const localBackupPath = await invoke<string>('gd_snapshot_db');
    let dbBytes = 0;
    try {
      const dbBase64 = await invoke<string>('gd_read_file_base64', { path: localBackupPath });
      dbBytes = bytesFromBase64(dbBase64);
      const onProgress = (p: UploadProgress) => syncManager.setState({ uploadProgress: p });
      let res = await uploadDbFile(token, dbBase64, fileName, folderId, existente?.id ?? null, onProgress);
      if ((res.status === 404 || res.status === 410) && existente?.id) {
        // El archivo se borró desde Drive: se recrea.
        res = await uploadDbFile(token, dbBase64, fileName, folderId, null, onProgress);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status} al actualizar el respaldo en Drive`);
      }
    } finally {
      syncManager.setState({ uploadProgress: null });
      try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}
    }
    await deleteOldSyncVersions(token);
    syncManager.setState({ lastUpload: now(), lastUploadBytes: dbBytes || null });
    markAllClean();
    if (reutilizado && existente) {
      console.warn(
        `[DriveSync] No se encontró "${fileName}"; se reutilizó el respaldo existente "${existente.name}". ` +
        'Probablemente se perdió el email de la cuenta (accountTag() cayó a "default").'
      );
    }
    return { ok: true, created: !existente };
  }


export const driveSyncService = {
  _periodicTimer: null as ReturnType<typeof setInterval> | null,
  _syncLock: false,

  listSyncFiles,
  hasLocalChanges,
  pushLatestBackup,
  latestFileName,

  /**
   * Registra el último respaldo **confirmado en la nube** (tras listar los
   * archivos). El botón "Refrescar" lo usa para que la card de Drive y el chip
   * del sidebar muestren el momento y el tamaño reales, no el estado local.
   */
  setLastUploadFromDrive: (file: DriveFile | null): void => {
    if (!file) return;
    const when = file.modifiedTime || file.createdTime || null;
    syncManager.setState({
      lastUpload: when,
      lastUploadBytes: file.size || null,
      lastUploadFile: { when, bytes: file.size || null, name: file.name },
    });
  },

  /** Info del respaldo más reciente en Drive para esta cuenta (o null si no hay).
   *  Se mide por modifiedTime: el archivo "_latest" se actualiza en cada guardado
   *  sin recrearse, así que su createdTime es antiguo pero su contenido es el fresco. */
  getLatestBackup: async (): Promise<DriveFile | null> => {
    const token = await getValidToken();
    if (!token) return null;
    const files = await listSyncFiles(token);
    if (files.length === 0) return null;
    return files.reduce((a, b) => recencyOf(b) >= recencyOf(a) ? b : a);
  },

  /**
   * Todos los respaldos de la cuenta, del más reciente al más viejo.
   *
   * Útil cuando el más nuevo está corrupto o vacío (p. ej. si un respaldo
   * automático corrió con la base ya purgada y sobrescribió el "_latest"):
   * se puede probar el siguiente en vez de quedarse sin datos.
   */
  listBackups: async (): Promise<DriveFile[]> => {
    const token = await getValidToken();
    if (!token) return [];
    return listSyncFiles(token);
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

  /**
   * "Crear respaldo" manual. Delega en `pushLatestBackup`: ahora usa el MISMO
   * nombre estable `_latest` que el respaldo automático y sobrescribe ese
   * archivo, en vez de crear uno nuevo con fecha y hora.
   *
   * Antes cada respaldo manual generaba `..._<fecha>_<hora>.db`. Con la retención
   * en 2 archivos, esos timestamped caían casi enseguida en la poda, así que el
   * botón no compraba ninguna garantía: al primer arranque de otro equipo se
   * restauraba igual el `_latest`. Un solo nombre elimina la ambigüedad y deja un
   * único archivo, que es el que se descarga.
   */
  pushAll: async (force: boolean = false): Promise<void> => {
    const token = await getValidToken();
    if (!token) throw new Error('Google Drive no está vinculado');
    if (!navigator.onLine) {
      syncManager.setState({ status: 'offline', message: 'Sin conexión' });
      return;
    }
    await syncManager.wrapSync((async () => {
      const res = await pushLatestBackup();
      if (!res.ok) {
        throw new Error(
          res.reason === 'offline' ? 'Sin conexión'
            : res.reason === 'no_drive' ? 'Google Drive no está vinculado'
            : 'No se pudo crear el respaldo'
        );
      }
    })(), 'subir a Google Drive').finally(() => syncManager.setState({ uploadProgress: null }));
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
      // Por modifiedTime: el archivo "_latest" se actualiza en cada guardado y su
      // createdTime es antiguo, pero su contenido es el más fresco.
      const newest = files.reduce((a, b) => recencyOf(b) >= recencyOf(a) ? b : a);
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

  /**
   * Arranca el respaldo automático periódico.
   *
   * DESACTIVADO por decisión del usuario (2026-09): el respaldo queda a cargo
   * de `driveInstantBackup`, que sube 5 s después de cada guardado. Este
   * temporizador solo mantenía una segunda vía cada 3 h que subía la base
   * aunque no hubiera cambios, gastando cuota de Drive/D1 a la nada.
   *
   * Se conserva la función (y `setAutoBackupInterval`) por si alguna vez se
   * quiere reactivar desde Ajustes; para que no se dispare solo, se ignora el
   * intervalo salvo que esté explícitamente habilitado con la clave
   * `drive_auto_backup_enabled`.
   */
  ensureAutoBackup: (): void => {
    if (localStorage.getItem(AUTO_BACKUP_ENABLED_KEY) !== 'true') {
      console.debug('[DriveSync] Temporizador de respaldo automático desactivado');
      return;
    }
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
