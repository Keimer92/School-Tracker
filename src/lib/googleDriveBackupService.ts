import { invoke } from '@tauri-apps/api/core';

const DEFAULT_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
const STORAGE_KEY = 'schooltracker-google-drive-settings';

interface GoogleDriveSettings {
  clientId: string;
  backupEnabled: boolean;
  backupInterval: number;
  lastBackupTime: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;
  deviceName: string;
  googleUserEmail: string | null;
  googleUserName: string | null;
  googleUserProfilePic: string | null;
}

const pruneOldGoogleDriveBackups = async (token: string, folderId: string, currentFileName: string) => {
  try {
    const listResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27%20in%20parents%20and%20trashed%3Dfalse&fields=files(id,name,createdTime)&orderBy=createdTime%20desc`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await listResponse.json();
    const files = data.files || [];
    const toDelete = files.filter((f: any) => f.name !== currentFileName);
    for (const file of toDelete) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  } catch (e) {
    console.error('GD_BACKUP: Error during old backups pruning:', e);
  }
};

export const runAutomaticGoogleDriveBackupIfNeeded = async () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const settings: GoogleDriveSettings = JSON.parse(stored);
    if (!settings.backupEnabled || !settings.refreshToken || !settings.accessToken) return;

    if (settings.lastBackupTime) {
      const lastBackup = new Date(settings.lastBackupTime).getTime();
      const now = Date.now();
      const intervalMs = settings.backupInterval * 60 * 60 * 1000;
      if (now - lastBackup < intervalMs) return;
    }

    console.log('GD_BACKUP: Running automatic backup...');

    const token = await (async () => {
      const now = Date.now();
      if (settings.accessToken && settings.tokenExpiry && settings.tokenExpiry > now + 120000) {
        return settings.accessToken;
      }
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: DEFAULT_CLIENT_SECRET,
          refresh_token: settings.refreshToken!,
          grant_type: 'refresh_token',
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const updated = { ...settings, accessToken: data.access_token, tokenExpiry: Date.now() + (data.expires_in * 1000) };
      if (data.refresh_token) updated.refreshToken = data.refresh_token;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return data.access_token;
    })();

    if (!token) return;

    const localBackupPath = await invoke<string>('gd_create_backup');
    const dbBase64 = await invoke<string>('gd_read_file_base64', { path: localBackupPath });

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name%3D%27SchoolTracker%20Backups%27%20and%20mimeType%3D%27application%2Fvnd.google-apps.folder%27%20and%20trashed%3Dfalse`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchResponse.json();
    let folderId: string;

    if (searchData.files && searchData.files.length > 0) {
      folderId = searchData.files[0].id;
    } else {
      const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SchoolTracker Backups', mimeType: 'application/vnd.google-apps.folder' }),
      });
      const folder = await createResponse.json();
      folderId = folder.id;
    }

    const timestampStr = new Date().toISOString();
    const cleanDate = timestampStr.split('T')[0];
    const deviceName = settings.deviceName.replace(/\s+/g, '_');

    const fileName = `SchoolTracker_Backup_${deviceName}_${cleanDate}.db`;

    const metadata = {
      name: fileName,
      parents: [folderId],
      description: JSON.stringify({ device: settings.deviceName, timestamp: timestampStr, type: 'schooltracker_backup' })
    };

    const boundary = 'schooltracker_backup_boundary';
    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/octet-stream\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${dbBase64}\r\n` +
      `--${boundary}--`;

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.statusText));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(multipartBody);
    });

    try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}
    await pruneOldGoogleDriveBackups(token, folderId, fileName);

    const updated = { ...settings, lastBackupTime: timestampStr };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    console.log('GD_BACKUP: Automatic backup completed');
  } catch (e) {
    console.error('GD_BACKUP: Automatic backup failed:', e);
  }
};
