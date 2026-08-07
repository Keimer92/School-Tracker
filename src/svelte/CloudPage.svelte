<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { syncService, syncManager, type SyncStatus } from "../lib/syncService";
  import type { DriveFile } from "../lib/driveSyncService";
  import { driveSyncService } from "../lib/driveSyncService";
  import { registerBackHandler, setBackAuthInProgress } from "../lib/androidBack";

  const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  const STORAGE_KEY = 'schooltracker-google-drive-settings';

  interface DriveSettings {
    clientId: string;
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiry: number | null;
    googleUserEmail: string | null;
    googleUserName: string | null;
    googleUserProfilePic: string | null;
  }

  let settings: DriveSettings = $state({
    clientId: DEFAULT_CLIENT_ID,
    accessToken: null, refreshToken: null, tokenExpiry: null,
    googleUserEmail: null, googleUserName: null, googleUserProfilePic: null,
  });

  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  const storedSyncSeconds = parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '300', 10);
  let syncInterval = $state(Math.round((storedSyncSeconds || 300) / 60));
  let isAuthLoading = $state(false);
  let isFetchingFiles = $state(false);
  let isTesting = $state(false);
  let syncFiles: DriveFile[] = $state([]);
  let imgError = $state(false);
  let showConfirm = $state(false);
  let confirmTitle = $state("");
  let confirmMessage = $state("");
  let confirmVariant: 'danger' | 'warning' | 'info' = $state('danger');
  let confirmAction: (() => Promise<void>) | null = $state(null);

  const isConnected = $derived(!!settings.accessToken);
  const isAndroid = /Android/i.test(navigator.userAgent);

  $effect(() => { if (settings.googleUserProfilePic) imgError = false; });

  $effect(() => {
    if (showConfirm) {
      return registerBackHandler(() => { showConfirm = false; return true; });
    }
  });

  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        settings = { ...settings, ...parsed };
        settings.clientId = parsed.clientId || DEFAULT_CLIENT_ID;
      }
    } catch {}
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (!settings.refreshToken) return null;
    const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
    if (!clientSecret) return null;
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: clientSecret,
          refresh_token: settings.refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      settings.accessToken = data.access_token;
      settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
      if (data.refresh_token) settings.refreshToken = data.refresh_token;
      saveSettings();
      return data.access_token;
    } catch { return null; }
  }

  async function getValidToken(): Promise<string | null> {
    if (settings.accessToken && settings.tokenExpiry && settings.tokenExpiry > Date.now() + 120000) {
      return settings.accessToken;
    }
    return await refreshAccessToken();
  }

  async function initGoogleAuth() {
    if (!settings.clientId) { await emit("show-toast", { message: "❌ No hay Client ID configurado", type: "error" }); return; }
    isAuthLoading = true;
    setBackAuthInProgress(true);
    try {
      const port = 51733;
      const redirectUri = `http://localhost:${port}/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=consent`;
      const code = await invoke<string>("gd_open_auth_webview", { url: authUrl });
      if (code) await exchangeCode(code, redirectUri);
    } catch (e) {
      console.error('Google Auth failed:', e);
      await emit("show-toast", { message: "❌ Error al autenticar con Google: " + e, type: "error" });
    } finally { isAuthLoading = false; setBackAuthInProgress(false); }
  }

  async function exchangeCode(code: string, redirectUri: string) {
    const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
    isAuthLoading = true;
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: settings.clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      if (!resp.ok) throw new Error(`Token exchange failed: ${resp.statusText}`);
      const data = await resp.json();
      settings.accessToken = data.access_token;
      settings.refreshToken = data.refresh_token || settings.refreshToken;
      settings.tokenExpiry = Date.now() + (data.expires_in * 1000);
      saveSettings();
      await fetchUserInfo(data.access_token);
      await emit("show-toast", { message: "✅ Google Drive vinculado exitosamente", type: "success" });
      await refreshFiles();
    } catch (e) {
      console.error('Token exchange failed:', e);
      await emit("show-toast", { message: "❌ Error al vincular Google Drive", type: "error" });
    } finally { isAuthLoading = false; }
  }

  async function fetchUserInfo(token: string) {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) {
        const data = await resp.json();
        settings.googleUserEmail = data.email || null;
        settings.googleUserName = data.name || null;
        settings.googleUserProfilePic = data.picture || null;
        saveSettings();
      }
    } catch {}
  }

  async function testConnection() {
    isTesting = true;
    try {
      const result = await driveSyncService.testConnection();
      if (result.ok) {
        await emit("show-toast", { message: "✅ Conexión con Google Drive exitosa", type: "success" });
        const token = await getValidToken();
        if (token) await fetchUserInfo(token);
      } else {
        await emit("show-toast", { message: "❌ Error de conexión: " + (result.error || 'Desconocido'), type: "error" });
      }
    } catch (e) {
      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
    } finally { isTesting = false; }
  }

  async function cancelAuth() {
    setBackAuthInProgress(false);
    try { await invoke("gd_cancel_oauth"); } catch {}
    isAuthLoading = false;
    await emit("show-toast", { message: "Autenticación cancelada", type: "info" });
  }

  async function disconnect() {
    settings.accessToken = null;
    settings.refreshToken = null;
    settings.tokenExpiry = null;
    settings.googleUserEmail = null;
    settings.googleUserName = null;
    settings.googleUserProfilePic = null;
    saveSettings();
    syncFiles = [];
    await emit("show-toast", { message: "✅ Google Drive desconectado", type: "success" });
  }

  async function refreshFiles() {
    isFetchingFiles = true;
    try {
      const token = await getValidToken();
      if (token) syncFiles = await driveSyncService.listSyncFiles(token);
    } catch {} finally { isFetchingFiles = false; }
  }

  function fmtSize(bytes: number): string {
    return (bytes / 1024).toFixed(1) + ' KB';
  }

  function fmtDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES');
  }

  function confirm(msg: string, title: string, variant: 'danger' | 'warning' | 'info', action: () => Promise<void>) {
    confirmTitle = title;
    confirmMessage = msg;
    confirmVariant = variant;
    confirmAction = action;
    showConfirm = true;
  }

  async function requestRestore(file: DriveFile) {
    confirm(`¿Restaurar "${file.name}"?\n\nSe sobrescribirá la base de datos actual.\nEsta acción no se puede deshacer.`, "⚠️ Restaurar Respaldo", 'danger', async () => {
      const res = await syncService.pullAllGuarded();
      if (res.blocked) {
        await emit("show-toast", { message: "⚠️ Tienes cambios locales sin sincronizar. Sube primero.", type: "warning" });
      }
    });
  }

  async function requestDelete(file: DriveFile) {
    confirm(`¿Eliminar "${file.name}" de Google Drive?`, "🗑️ Eliminar Respaldo", 'warning', async () => {
      const token = await getValidToken();
      if (!token) return;
      await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      syncFiles = syncFiles.filter(f => f.id !== file.id);
      await emit("show-toast", { message: "✅ Respaldo eliminado", type: "success" });
    });
  }

  onMount(async () => {
    const unsub = syncManager.subscribe((state) => { syncStatus = state; });
    loadSettings();
    if (settings.accessToken) await refreshFiles();
    // Auto-detect pending OAuth code (por si la página recargó durante el flujo)
    if (!settings.accessToken && !isAuthLoading) {
      try {
        const hasCode = await invoke<boolean>("gd_has_pending_oauth_code");
        if (hasCode) {
          isAuthLoading = true;
          setBackAuthInProgress(true);
          const code = await invoke<string>("gd_wait_oauth_code", { timeoutSecs: 10 });
          const port = 51733;
          if (code) await exchangeCode(code, `http://localhost:${port}/callback`);
          isAuthLoading = false;
          setBackAuthInProgress(false);
        }
      } catch {}
    }
    return unsub;
  });
</script>

<div class="cloud-page">
  <div class="cloud-card">
    <div class="cloud-card-header">
      <h3>
        <span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="var(--primary-color)"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
          Google Drive
        </span>
      </h3>
    </div>

    <div style="padding: 0 1.5rem 1.5rem;">
      {#if syncStatus.status === 'error' && syncStatus.message}
        <div style="margin-bottom: 1rem; padding: 0.9rem 1rem; border-radius: 12px; border: 1px solid rgba(248,113,113,0.25); background: rgba(239,68,68,0.12); color: #fecaca; font-size: 0.8rem; line-height: 1.45;">
          <div style="font-weight: 700; margin-bottom: 0.25rem;">⚠️ Error de sincronización</div>
          <div>{syncStatus.message}</div>
        </div>
      {/if}

      {#if !isConnected}
        <!-- Not connected -->
        <div style="text-align: center; padding: 2rem 1rem;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">☁️</div>
          <h4 style="color: #e2e8f0; margin: 0 0 0.5rem 0;">Sincronización en la Nube</h4>
          <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Vincula tu cuenta de Google Drive para respaldar y sincronizar tus datos.</p>
          {#if settings.clientId}
            {#if isAuthLoading}
              <div style="display: flex; flex-direction: column; align-items: center; gap: 0.75rem;">
                <div style="padding: 0.8rem 2rem; background: linear-gradient(135deg, #4285F4, #34A853); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem; opacity: 0.7; cursor: default;">
                  Conectando...
                </div>
                <button onclick={cancelAuth} style="background: transparent; border: 1px solid rgba(239,68,68,0.35); color: #f87171; padding: 0.45rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.2s;">
                  Cancelar
                </button>
              </div>
            {:else}
              <button onclick={initGoogleAuth} style="padding: 0.8rem 2rem; background: linear-gradient(135deg, #4285F4, #34A853); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem; cursor: pointer; box-shadow: 0 4px 16px rgba(66,133,244,0.3);">
                🔗 Vincular Google Drive
              </button>
            {/if}
          {:else}
            <div style="background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.2); border-radius: 8px; padding: 0.8rem; font-size: 0.8rem; color: #eab308; max-width: 400px; margin: 0 auto;">
              ⚠️ No hay Client ID configurado. Define VITE_GOOGLE_CLIENT_ID en tu archivo .env
            </div>
          {/if}
        </div>
      {:else}
        <!-- Connected -->
        <!-- User Info -->
        <div style="display: flex; align-items: center; gap: 1rem; padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%); border-radius: 14px; border: 1px solid rgba(var(--primary-rgb), 0.12); margin-bottom: 1.25rem;">
          {#if settings.googleUserProfilePic && !imgError}
            <img src={settings.googleUserProfilePic} alt="" style="width: 36px; height: 36px; border-radius: 50%;" onerror={() => imgError = true} />
          {:else}
            <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: white;">{settings.googleUserName?.charAt(0) || 'G'}</div>
          {/if}
          <div style="flex: 1;">
            <div style="color: #f1f5f9; font-weight: 600; font-size: 0.85rem;">
              {settings.googleUserName || 'Usuario de Google'}
            </div>
            <div style="color: #64748b; font-size: 0.75rem;">
              {settings.googleUserEmail || ''}
              {#if syncStatus.lastSync}
                · Última sync: {new Date(syncStatus.lastSync).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {/if}
            </div>
          </div>
          {#if !isAndroid}
            <div style="display: flex; gap: 6px;">
              <button onclick={testConnection} disabled={isTesting} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #94a3b8; cursor: pointer; font-size: 0.7rem;">{isTesting ? '...' : 'Probar'}</button>
              <button onclick={disconnect} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.7rem;">Desconectar</button>
            </div>
          {/if}
        </div>

        {#if isAndroid}
          <div style="display: flex; gap: 0.5rem; margin: -0.5rem 0 1.25rem;">
            <button onclick={testConnection} disabled={isTesting} style="flex: 1; padding: 0.55rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05); color: #94a3b8; cursor: pointer; font-size: 0.85rem;">{isTesting ? 'Probando...' : 'Probar'}</button>
            <button onclick={disconnect} style="flex: 1; padding: 0.55rem; border-radius: 10px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.85rem;">Desconectar</button>
          </div>
        {/if}

        {#if syncStatus.message}
          <div style="margin-bottom: 1rem; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; border-left: 3px solid {syncStatus.status === 'error' ? '#ef4444' : 'var(--primary-color)'}; background: rgba(0,0,0,0.2); color: {syncStatus.status === 'error' ? '#fca5a5' : 'var(--text-secondary)'};">
            {syncStatus.message}
          </div>
        {/if}

        <!-- Push / Pull buttons -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem;">
          <button onclick={async () => { try { await syncService.forcePushAll(); await refreshFiles(); } catch {} }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Subir a Drive</span>
          </button>
          <button onclick={async () => { try { const res = await syncService.pullAllGuarded(); if (res.blocked) { await emit("show-toast", { message: "⚠️ Tienes cambios locales sin sincronizar. Sube primero.", type: "warning" }); } else { await refreshFiles(); } } catch {} }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.12) 0%, rgba(var(--primary-rgb), 0.04) 100%); border: 1px solid rgba(var(--primary-rgb), 0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span style="color: var(--primary-color); font-weight: 600; font-size: 0.85rem;">Bajar de Drive</span>
          </button>
        </div>

        <!-- Periodic sync + status -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.85rem; background: rgba(0,0,0,0.15); border-radius: 10px; margin-bottom: 1.25rem;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: {syncStatus.status === 'syncing' ? '#eab308' : '#22c55e'}; box-shadow: {syncStatus.status === 'syncing' ? '0 0 8px rgba(234,179,8,0.4)' : '0 0 8px rgba(34,197,94,0.4)'};"></div>
            <span style="color: #94a3b8; font-size: 0.8rem;">Sync periódico:</span>
            <input type="number" min={3} max={60} bind:value={syncInterval} oninput={() => { const mins = Math.max(3, Math.min(60, syncInterval)); localStorage.setItem('periodic_sync_interval_seconds', String(mins * 60)); syncService.ensurePeriodicSync(); }} style="width: 52px; padding: 0.2rem 0.35rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
            <span style="color: #64748b; font-size: 0.75rem;">minutos</span>
          </div>
          {#if syncFiles.length > 0}
            <span style="color: #64748b; font-size: 0.7rem;">{syncFiles.length} archivo{syncFiles.length !== 1 ? 's' : ''}</span>
          {/if}
        </div>

        <!-- Sync files -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem;">
            <h5 style="margin: 0; color: #e2e8f0; font-size: 0.85rem;">Historial de Sync</h5>
            <button onclick={refreshFiles} disabled={isFetchingFiles} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.7rem;">{isFetchingFiles ? 'Cargando...' : '↻ Refrescar'}</button>
          </div>
          {#if syncFiles.length === 0}
            <div style="text-align: center; padding: 1.5rem; color: #64748b; font-size: 0.8rem;">No hay archivos de sync en Drive. Presiona "Subir a Drive" para crear el primero.</div>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 4px;">
              {#each syncFiles as file (file.id)}
                <div style="display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.7rem; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                  <div style="flex: 1; min-width: 0;">
                    <div style="color: #e2e8f0; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{file.name}</div>
                    <div style="color: #64748b; font-size: 0.65rem;">{fmtDate(file.createdTime)} · {fmtSize(file.size)}</div>
                  </div>
                  <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button onclick={() => requestRestore(file)} style="padding: 0.3rem 0.55rem; border-radius: 5px; border: 1px solid rgba(var(--primary-rgb),0.3); background: rgba(var(--primary-rgb),0.1); color: var(--primary-color); cursor: pointer; font-size: 0.65rem;">Restaurar</button>
                    <button onclick={() => requestDelete(file)} style="padding: 0.3rem 0.55rem; border-radius: 5px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.65rem;">🗑</button>
                  </div>
                </div>
              {/each}
            </div>
            <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 6px; color: #64748b; font-size: 0.7rem;">
              <span>💾 Se mantienen hasta {4} archivos. Los más antiguos se eliminan automáticamente.</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

{#if showConfirm}
  <div style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);">
    <div style="width: 420px; max-width: 90%; padding: 1.5rem; background: linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.99)); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; box-shadow: 0 25px 60px rgba(0,0,0,0.6);">
      <h3 style="margin-top: 0; color: {confirmVariant === 'danger' ? '#f87171' : '#eab308'};">{confirmTitle}</h3>
      <div style="white-space: pre-wrap; margin: 1.5rem 0; color: #e2e8f0; font-size: 0.9rem; line-height: 1.5;">{confirmMessage}</div>
      <div style="display: flex; justify-content: flex-end; gap: 1rem;">
        <button onclick={() => showConfirm = false} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Cancelar</button>
        <button onclick={async () => { if (confirmAction) await confirmAction(); showConfirm = false; }} style="padding: 0.5rem 1.25rem; border-radius: 8px; border: none; background: {confirmVariant === 'danger' ? '#ef4444' : '#eab308'}; color: white; font-weight: 700; cursor: pointer; font-size: 0.85rem;">Confirmar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cloud-page { max-width: 680px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; }
  .cloud-card { background: var(--card-bg); border-radius: 20px; border: 1px solid var(--card-border); overflow: hidden; }
  .cloud-card-header { padding: 1.25rem 1.5rem 0; }
  .cloud-card-header h3 { margin: 0; color: var(--text-primary); font-size: 1.1rem; font-weight: 700; }
</style>
