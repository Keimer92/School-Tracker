<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";

  const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  const DEFAULT_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "";
  const DESKTOP_REDIRECT_URI = 'http://localhost:51733/callback';
  const ANDROID_REDIRECT_URI = 'http://127.0.0.1:51733/callback';
  const STORAGE_KEY = 'schooltracker-google-drive-settings';
  const CACHE_KEY = 'schooltracker-google-drive-backups-cache';

  interface GoogleDriveSettings {
    clientId: string; backupEnabled: boolean; backupInterval: number; backupIntervalUnit: 'minutes' | 'hours' | 'days'; lastBackupTime: string | null;
    accessToken: string | null; refreshToken: string | null; tokenExpiry: number | null;
    deviceName: string; googleUserEmail: string | null; googleUserName: string | null; googleUserProfilePic: string | null;
  }
  interface GoogleDriveFile { id: string; name: string; size: number; createdTime: string; device: string; }

  let settings: GoogleDriveSettings = $state({
    clientId: DEFAULT_CLIENT_ID, backupEnabled: false, backupInterval: 20, backupIntervalUnit: 'minutes', lastBackupTime: null,
    accessToken: null, refreshToken: null, tokenExpiry: null, deviceName: 'PC Principal',
    googleUserEmail: null, googleUserName: null, googleUserProfilePic: null,
  });
  let isLoading = $state(false);
  let isRefreshing = $state(false);
  let isTesting = $state(false);
  let driveFiles: GoogleDriveFile[] = $state([]);
  let isFetchingFiles = $state(false);
  let backupProgress: 'idle' | 'backing_up' | 'uploading' | 'done' = $state('idle');
  let progressBytes = $state({ loaded: 0, total: 0 });
  let imgError = $state(false);
  let showConfirm = $state(false);
  let confirmTitle = $state("");
  let confirmMessage = $state("");
  let confirmVariant: 'danger' | 'warning' | 'info' = $state('danger');
  let restoreFileId: string | null = $state(null);

  $effect(() => { if (settings.googleUserProfilePic) imgError = false; });

  onMount(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        settings = { ...settings, ...parsed, clientId: parsed.clientId || DEFAULT_CLIENT_ID, backupInterval: parsed.backupInterval || 20, backupIntervalUnit: parsed.backupIntervalUnit || 'minutes', deviceName: parsed.deviceName || 'PC Principal' };
      } catch (e) { console.error('Failed to parse Google Drive settings:', e); }
    }
    if (settings.accessToken) {
      fetchDriveFiles();
    }
  });

  function saveSettings(newSettings: GoogleDriveSettings) {
    settings = newSettings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (!settings.refreshToken) return null;
    const now = Date.now();
    if (settings.accessToken && settings.tokenExpiry && settings.tokenExpiry > now + 120000) return settings.accessToken;
    isRefreshing = true;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: settings.clientId, client_secret: DEFAULT_CLIENT_SECRET, refresh_token: settings.refreshToken, grant_type: 'refresh_token' }),
      });
      if (!response.ok) throw new Error(`Refresh token failed: ${response.statusText}`);
      const data = await response.json();
      const updated = { ...settings, accessToken: data.access_token, tokenExpiry: Date.now() + (data.expires_in * 1000) };
      if (data.refresh_token) updated.refreshToken = data.refresh_token;
      saveSettings(updated);
      return data.access_token;
    } catch (e) {
      console.error('GD_BACKUP: Failed to refresh access token:', e);
      emit("show-toast", { message: "Sesión de Google Drive expirada. Vuelve a vincular tu cuenta.", type: "error" });
      return null;
    } finally { isRefreshing = false; }
  }

  async function fetchGoogleUserInfo(token: string) {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        saveSettings({ ...settings, googleUserEmail: data.email || null, googleUserName: data.name || null, googleUserProfilePic: data.picture || null });
      }
    } catch (e) { console.error('GD_BACKUP: Failed to fetch user info:', e); }
  }

  async function initGoogleAuth() {
    if (!settings.clientId) { emit("show-toast", { message: "❌ No hay Client ID configurado", type: "error" }); return; }
    isLoading = true;
    try {
      const port = 51733;
      const codePromise = invoke<string>("gd_start_oauth_server", { port });
      const isAndroid = /Android/i.test(navigator.userAgent);
      const redirectUri = isAndroid ? ANDROID_REDIRECT_URI : DESKTOP_REDIRECT_URI;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=consent`;
      await openUrl(authUrl);
      const code = await codePromise;
      if (code) {
        await exchangeCode(code);
      }
    } catch (e) {
      console.error('GD_BACKUP: Google Auth failed:', e);
      emit("show-toast", { message: "❌ Error al autenticar con Google: " + e, type: "error" });
    } finally { isLoading = false; }
  }

  async function exchangeCode(code: string) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const redirectUri = isAndroid ? ANDROID_REDIRECT_URI : DESKTOP_REDIRECT_URI;
    isLoading = true;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: settings.clientId, client_secret: DEFAULT_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${response.statusText}`);
      const data = await response.json();
      const newSettings = { ...settings, accessToken: data.access_token, refreshToken: data.refresh_token || settings.refreshToken, tokenExpiry: Date.now() + (data.expires_in * 1000) };
      saveSettings(newSettings);
      await fetchGoogleUserInfo(data.access_token);
      emit("show-toast", { message: "✅ Google Drive vinculado exitosamente", type: "success" });
    } catch (e) {
      console.error('GD_BACKUP: Token exchange failed:', e);
      emit("show-toast", { message: "❌ Error al vincular Google Drive", type: "error" });
    } finally { isLoading = false; }
  }

  async function testConnection() {
    isTesting = true;
    try {
      const token = await refreshAccessToken();
      if (!token) { emit("show-toast", { message: "❌ No hay sesión activa", type: "error" }); return; }
      const response = await fetch('https://www.googleapis.com/drive/v3/files?pageSize=1', { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        emit("show-toast", { message: "✅ Conexión con Google Drive exitosa", type: "success" });
        await fetchGoogleUserInfo(token);
      } else { emit("show-toast", { message: "❌ Error de conexión: " + response.statusText, type: "error" }); }
    } catch (e) { emit("show-toast", { message: "❌ Error: " + e, type: "error" }); }
    finally { isTesting = false; }
  }

  async function disconnect() {
    saveSettings({ ...settings, accessToken: null, refreshToken: null, tokenExpiry: null, googleUserEmail: null, googleUserName: null, googleUserProfilePic: null });
    emit("show-toast", { message: "✅ Google Drive desconectado", type: "success" });
  }

  async function fetchDriveFiles() {
    const token = await refreshAccessToken();
    if (!token) return;
    isFetchingFiles = true;
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=name contains 'schooltracker' and trashed=false&orderBy=createdTime desc&pageSize=20&fields=files(id,name,size,createdTime)`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        const files: GoogleDriveFile[] = (data.files || []).map((f: any) => ({ id: f.id, name: f.name, size: f.size || 0, createdTime: f.createdTime || f.modifiedTime || '', device: '' }));
        driveFiles = files.slice(0, 2);
        localStorage.setItem(CACHE_KEY, JSON.stringify(files.slice(0, 2)));
      }
    } catch (e) { console.error('GD_BACKUP: Failed to fetch files:', e); }
    finally { isFetchingFiles = false; }
  }

  function devicePrefix() {
    return `schooltracker_backup_${settings.deviceName.replace(/\s+/g, '_')}`;
  }

  async function deleteOldDeviceBackups(token: string): Promise<void> {
    try {
      const q = `name contains '${devicePrefix()}' and trashed=false`;
      const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return;
      const data = await resp.json();
      const oldFiles: { id: string; name: string }[] = data.files || [];
      for (const f of oldFiles) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      }
    } catch (e) { console.warn('GD_BACKUP: Error limpiando backups viejos:', e); }
  }

  async function performBackup() {
    const token = await refreshAccessToken();
    if (!token) { emit("show-toast", { message: "❌ No hay sesión activa en Google Drive", type: "error" }); return; }
    backupProgress = 'backing_up';
    try {
      const dbPath = await invoke<string>("get_db_path");
      const cleanDate = new Date().toISOString().split('T')[0];
      const deviceName = settings.deviceName.replace(/\s+/g, '_');
      const fileName = `SchoolTracker_Backup_${deviceName}_${cleanDate}.db`;
      backupProgress = 'uploading';
                // Read file and upload  
                const fileContentBase64 = await invoke<string>("gd_read_file_base64", { path: dbPath });  
                const byteArray = Uint8Array.from(atob(fileContentBase64), c => c.charCodeAt(0));  
                const blob = new Blob([byteArray], { type: 'application/octet-stream' });
      progressBytes = { loaded: 0, total: byteArray.length };
      const metadata = { name: fileName, mimeType: 'application/octet-stream' };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (response.ok) {
        const uploadedFile = await response.json();
        const now = new Date().toISOString();
        saveSettings({ ...settings, lastBackupTime: now, backupEnabled: true });
        backupProgress = 'done';
        emit("show-toast", { message: "✅ Respaldo subido a Google Drive", type: "success" });
        setTimeout(() => { backupProgress = 'idle'; }, 2000);
        try {
          const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=name contains 'SchoolTracker_Backup_${deviceName}' and trashed=false&orderBy=createdTime desc`, { headers: { Authorization: `Bearer ${token}` } });
          const searchData = await searchResp.json();
          const oldFiles = (searchData.files || []).filter((f: any) => f.id !== uploadedFile.id);
          for (const f of oldFiles) {
            await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          }
        } catch (e) { console.warn('GD_BACKUP: Error limpiando backups viejos:', e); }
        fetchDriveFiles();
      } else { throw new Error(`Upload failed: ${response.statusText}`); }
    } catch (e) {
      console.error('GD_BACKUP: Backup failed:', e);
      emit("show-toast", { message: "❌ Error al hacer respaldo: " + e, type: "error" });
      backupProgress = 'idle';
    }
  }

  async function restoreFromDrive(fileId: string) {
    const token = await refreshAccessToken();
    if (!token) return;
    isLoading = true;
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64 = btoa(String.fromCharCode(...uint8Array));
        const dbPath = await invoke<string>("get_db_path");
        await invoke("gd_write_file_base64", { path: dbPath, contentBase64: base64 });
        emit("show-toast", { message: "✅ Base de datos restaurada desde Google Drive. Reinicia la app.", type: "success" });
      } else { throw new Error(`Download failed: ${response.statusText}`); }
    } catch (e) {
      console.error('GD_BACKUP: Restore failed:', e);
      emit("show-toast", { message: "❌ Error al restaurar: " + e, type: "error" });
    } finally { isLoading = false; }
  }

  function requestRestore(fileId: string, fileName: string) {
    confirmTitle = "⚠️ Restaurar Respaldo";
    confirmMessage = `¿Estás seguro de querer restaurar "${fileName}"?\n\nSe sobrescribirá la base de datos actual.\nEsta acción no se puede deshacer.`;
    confirmVariant = 'danger';
    restoreFileId = fileId;
    showConfirm = true;
  }

  async function executeDelete(fileId: string) {
    const token = await refreshAccessToken();
    if (!token) return;
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      driveFiles = driveFiles.filter(f => f.id !== fileId);
      emit("show-toast", { message: "✅ Respaldo eliminado", type: "success" });
    } catch (e) { emit("show-toast", { message: "❌ Error al eliminar: " + e, type: "error" }); }
  }

  function requestDelete(fileId: string, fileName: string) {
    confirmTitle = "🗑️ Eliminar Respaldo";
    confirmMessage = `¿Eliminar "${fileName}" de Google Drive?`;
    confirmVariant = 'warning';
    restoreFileId = fileId;
    showConfirm = true;
  }

  const isConnected = $derived(!!settings.accessToken);
  const isAndroid = /Android/i.test(navigator.userAgent);
</script>

<div>
  {#if !isConnected}
    <div style="text-align: center; padding: 2rem 1rem;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">☁️</div>
      <h4 style="color: #e2e8f0; margin: 0 0 0.5rem 0;">Google Drive Backup</h4>
      <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Vincula tu cuenta de Google para respaldar automáticamente tu base de datos.</p>
      {#if settings.clientId}
        <button onclick={initGoogleAuth} disabled={isLoading} style="padding: 0.8rem 2rem; background: linear-gradient(135deg, #4285F4, #34A853); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem; cursor: pointer; box-shadow: 0 4px 16px rgba(66,133,244,0.3);">{isLoading ? 'Conectando...' : '🔗 Vincular Google Drive'}</button>
      {:else}
        <div style="background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.2); border-radius: 8px; padding: 0.8rem; font-size: 0.8rem; color: #eab308; max-width: 400px; margin: 0 auto;">
          ⚠️ No hay Client ID configurado. Define VITE_GOOGLE_CLIENT_ID en tu archivo .env
        </div>
      {/if}
      {#if settings.accessToken}
        <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center;">
          <button onclick={testConnection} disabled={isTesting} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.8rem;">{isTesting ? 'Probando...' : 'Probar conexión'}</button>
        </div>
      {/if}
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <!-- User Info -->
      <div style="display: flex; align-items: center; gap: 1rem; padding: 1rem; background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        {#if settings.googleUserProfilePic && !imgError}
          <img src={settings.googleUserProfilePic} alt="Profile" style="width: 40px; height: 40px; border-radius: 50%;" onerror={() => imgError = true} />
        {:else}
          <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: white;">{settings.googleUserName?.charAt(0) || 'G'}</div>
        {/if}
        <div style="flex: 1;">
          <div style="color: #e2e8f0; font-weight: 600;">{settings.googleUserName || 'Usuario de Google'}</div>
          <div style="color: #94a3b8; font-size: 0.8rem;">{settings.googleUserEmail || ''}</div>
        </div>
        <button onclick={disconnect} style="padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.75rem;">Desconectar</button>
      </div>

      <!-- Backup Button -->
      <button onclick={performBackup} disabled={backupProgress !== 'idle'} style="padding: 1rem; background: linear-gradient(135deg, #10b981, #059669); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
        {#if backupProgress === 'backing_up'}
          <span style="display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></span> Preparando respaldo...
        {:else if backupProgress === 'uploading'}
          <span style="display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></span> Subiendo... ({progressBytes.loaded}/{progressBytes.total})
        {:else if backupProgress === 'done'}
          ✅ Respaldo completado
        {:else}
          ☁️ Hacer Respaldo Ahora
        {/if}
      </button>

      {#if settings.lastBackupTime}
        <div style="font-size: 0.8rem; color: #64748b; text-align: center;">Último respaldo: {new Date(settings.lastBackupTime).toLocaleString('es-ES')}</div>
      {/if}

      <!-- Settings -->
      <div style="padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem;">
          <span style="color: #e2e8f0; font-size: 0.85rem;">Nombre del dispositivo</span>
          <input type="text" bind:value={settings.deviceName} oninput={() => { saveSettings(settings); }} style="padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; width: 150px; text-align: right;" />
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
          <span style="color: #e2e8f0; font-size: 0.85rem;">Intervalo de respaldo</span>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <input type="number" bind:value={settings.backupInterval} min={1} max={settings.backupIntervalUnit === 'minutes' ? 180 : settings.backupIntervalUnit === 'hours' ? 168 : 30} oninput={() => { saveSettings(settings); }} style="padding: 0.4rem 0.5rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; width: 52px; text-align: center;" />
            <select bind:value={settings.backupIntervalUnit} onchange={() => { saveSettings(settings); }} style="padding: 0.4rem 0.4rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.75rem; outline: none; cursor: pointer;">
              <option value="minutes">minutos</option>
              <option value="hours">horas</option>
              <option value="days">días</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Backup Files -->
      <div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
          <h5 style="margin: 0; color: #e2e8f0;">Respaldos en la Nube</h5>
          <button onclick={fetchDriveFiles} disabled={isFetchingFiles} style="padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.75rem;">{isFetchingFiles ? 'Cargando...' : '↻ Refrescar'}</button>
        </div>
        {#if driveFiles.length === 0}
          <div style="text-align: center; padding: 2rem; color: #64748b; font-size: 0.85rem;">No hay respaldos en la nube. Haz clic en "Hacer Respaldo" para crear uno.</div>
        {:else}
          {#each driveFiles as file (file.id)}
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0.75rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 0.4rem; border: 1px solid rgba(255,255,255,0.05);">
              <div style="flex: 1; min-width: 0;">
                <div style="color: #e2e8f0; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{file.name}</div>
                <div style="color: #64748b; font-size: 0.7rem;">{file.createdTime ? new Date(file.createdTime).toLocaleString('es-ES') : '—'} • {(file.size / 1024).toFixed(1)} KB</div>
              </div>
              <div style="display: flex; gap: 0.3rem; flex-shrink: 0;">
                <button onclick={() => requestRestore(file.id, file.name)} disabled={isLoading} style="padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid rgba(var(--primary-rgb),0.3); background: rgba(var(--primary-rgb),0.1); color: var(--primary-color); cursor: pointer; font-size: 0.7rem;">Restaurar</button>
                <button onclick={() => requestDelete(file.id, file.name)} style="padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.7rem;">🗑</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  {#if showConfirm}
    <div class="modal-overlay" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);">
      <div class="modal-content" style="width: 420px; max-width: 90%; padding: 1.5rem; background: linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.99)); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; box-shadow: 0 25px 60px rgba(0,0,0,0.6);">
        <h3 style="margin-top: 0; color: {confirmVariant === 'danger' ? '#f87171' : '#eab308'};">{confirmTitle}</h3>
        <div style="white-space: pre-wrap; margin: 1.5rem 0; color: #e2e8f0; font-size: 0.9rem; line-height: 1.5;">{confirmMessage}</div>
        <div style="display: flex; justify-content: flex-end; gap: 1rem;">
          <button onclick={() => showConfirm = false} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Cancelar</button>
          <button onclick={async () => { if (restoreFileId) { isLoading = true; if (confirmVariant === 'warning') await executeDelete(restoreFileId); else await restoreFromDrive(restoreFileId); isLoading = false; } showConfirm = false; }} disabled={isLoading} style="padding: 0.5rem 1.25rem; border-radius: 8px; border: none; background: {confirmVariant === 'danger' ? '#ef4444' : '#eab308'}; color: white; font-weight: 700; cursor: pointer; font-size: 0.85rem;">{isLoading ? 'Procesando...' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
