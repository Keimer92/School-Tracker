<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  
  const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  const DEFAULT_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "";
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
  
  let settings: GoogleDriveSettings = $state({
    clientId: DEFAULT_CLIENT_ID,
    backupEnabled: false,
    backupInterval: 12,
    lastBackupTime: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiry: null,
    deviceName: 'PC Principal',
    googleUserEmail: null,
    googleUserName: null,
    googleUserProfilePic: null,
  });
  
  let isLoading = $state(false);
  let isRefreshing = $state(false);
  let isTesting = $state(false);
  let imgError = $state(false);
  let showConfirm = $state(false);
  let confirmTitle = $state("");
  let confirmMessage = $state("");
  let confirmVariant: 'danger' | 'warning' | 'info' = $state('danger');
  let confirmAction: (() => void) | null = $state(null);
  
  $effect(() => { 
    if (settings.googleUserProfilePic) imgError = false; 
  });
  
  onMount(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        settings = { 
          ...settings, 
          ...parsed, 
          clientId: parsed.clientId || DEFAULT_CLIENT_ID, 
          backupInterval: parsed.backupInterval || 12, 
          deviceName: parsed.deviceName || 'PC Principal' 
        };
      } catch (e) { 
        console.error('Failed to parse Google Drive settings:', e); 
      }
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
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ 
          client_id: settings.clientId, 
          client_secret: DEFAULT_CLIENT_SECRET, 
          refresh_token: settings.refreshToken, 
          grant_type: 'refresh_token' 
        }),
      });
      if (!response.ok) throw new Error(`Refresh token failed: ${response.statusText}`);
      const data = await response.json();
      const updated = { 
        ...settings, 
        accessToken: data.access_token, 
        tokenExpiry: Date.now() + (data.expires_in * 1000) 
      };
      if (data.refresh_token) updated.refreshToken = data.refresh_token;
      saveSettings(updated);
      return data.access_token;
    } catch (e) {
      console.error('GD_BACKUP: Failed to refresh access token:', e);
      emit("show-toast", { message: "Sesión de Google Drive expirada. Vuelve a vincular tu cuenta.", type: "error" });
      return null;
    } finally { 
      isRefreshing = false; 
    }
  }
  
  async function fetchGoogleUserInfo(token: string) {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      if (response.ok) {
        const data = await response.json();
        saveSettings({ 
          ...settings, 
          googleUserEmail: data.email || null, 
          googleUserName: data.name || null, 
          googleUserProfilePic: data.picture || null 
        });
      }
    } catch (e) { 
      console.error('GD_BACKUP: Failed to fetch user info:', e); 
    }
  }
  
  async function initGoogleAuth() {
    if (!settings.clientId) { 
      emit("show-toast", { message: "❌ No hay Client ID configurado", type: "error" }); 
      return; 
    }
    const isAndroid = /Android/i.test(navigator.userAgent);
    const redirectUri = isAndroid ? 'http://127.0.0.1:51733/callback' : 'http://localhost:51733/callback';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=consent`;
    try { 
      await openUrl(authUrl); 
    } catch (e) { 
      console.error('GD_BACKUP: Failed to open auth URL:', e); 
    }
  }
  
  async function exchangeCode(code: string) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const redirectUri = isAndroid ? 'http://127.0.0.1:51733/callback' : 'http://localhost:51733/callback';
    isLoading = true;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ 
          code, 
          client_id: settings.clientId, 
          client_secret: DEFAULT_CLIENT_SECRET, 
          redirect_uri: redirectUri, 
          grant_type: 'authorization_code' 
        }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${response.statusText}`);
      const data = await response.json();
      const newSettings = { 
        ...settings, 
        accessToken: data.access_token, 
        refreshToken: data.refresh_token || settings.refreshToken, 
        tokenExpiry: Date.now() + (data.expires_in * 1000) 
      };
      saveSettings(newSettings);
      await fetchGoogleUserInfo(data.access_token);
      emit("show-toast", { message: "✅ Google Drive vinculado exitosamente", type: "success" });
    } catch (e) {
      console.error('GD_BACKUP: Token exchange failed:', e);
      emit("show-toast", { message: "❌ Error al vincular Google Drive", type: "error" });
    } finally { 
      isLoading = false; 
    }
  }
  
  async function testConnection() {
    isTesting = true;
    try {
      const token = await refreshAccessToken();
      if (!token) { 
        emit("show-toast", { message: "❌ No hay sesión activa", type: "error" }); 
        return; 
      }
      const response = await fetch('https://www.googleapis.com/drive/v3/files?pageSize=1', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      if (response.ok) {
        emit("show-toast", { message: "✅ Conexión con Google Drive exitosa", type: "success" });
        await fetchGoogleUserInfo(token);
      } else { 
        emit("show-toast", { message: "❌ Error de conexión: " + response.statusText, type: "error" }); 
      }
    } catch (e) { 
      emit("show-toast", { message: "❌ Error: " + e, type: "error" }); 
    } finally { 
      isTesting = false; 
    }
  }
  
  async function disconnect() {
    saveSettings({ 
      ...settings, 
      accessToken: null, 
      refreshToken: null, 
      tokenExpiry: null, 
      googleUserEmail: null, 
      googleUserName: null, 
      googleUserProfilePic: null 
    });
    emit("show-toast", { message: "✅ Google Drive desconectado", type: "success" });
  }
  
  const isConnected = $derived(!!settings.accessToken);
</script>

<div style="padding: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
  {#if !isConnected}
    <div style="text-align: center; margin-bottom: 12px;">
      <div style="font-size: 2rem; margin-bottom: 8px;">☁️</div>
      <div style="color: #e2e8f0; font-weight: 600; margin-bottom: 4px;">Google Drive</div>
      <div style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 8px;">Vincula tu cuenta para respaldar.</div>
      {#if settings.clientId}
        <button 
          onclick={initGoogleAuth} 
          disabled={isLoading}
          style="padding: 8px 16px; background: linear-gradient(135deg, #4285F4, #34A853); border: none; color: white; border-radius: 8px; font-weight: 600; font-size: 0.9rem; cursor: pointer;"
        >
          {isLoading ? 'Conectando...' : '🔗 Vincular Google Drive'}
        </button>
      {:else}
        <div style="background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.2); border-radius: 6px; padding: 8px; font-size: 0.7rem; color: #eab308; margin-top: 8px;">
          ⚠️ No hay Client ID configurado. Define VITE_GOOGLE_CLIENT_ID en tu archivo .env
        </div>
      {/if}
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <!-- User Info -->
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 8px;">
        {#if settings.googleUserProfilePic && !imgError}
          <img src={settings.googleUserProfilePic} alt="Profile" style="width: 32px; height: 32px; border-radius: 50%;" onerror={() => imgError = true} />
        {:else}
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: white;">{settings.googleUserName?.charAt(0) || 'G'}</div>
        {/if}
        <div style="flex: 1;">
          <div style="color: #e2e8f0; font-weight: 600; font-size: 0.9rem;">{settings.googleUserName || 'Usuario de Google'}</div>
          <div style="color: #94a3b8; font-size: 0.7rem;">{settings.googleUserEmail || ''}</div>
        </div>
        <button 
          onclick={disconnect} 
          style="padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.7rem;"
        >
          Desconectar
        </button>
      </div>
      
      <!-- Backup Button -->
      <button 
        onclick={testConnection} 
        disabled={isTesting}
        style="padding: 8px 16px; background: linear-gradient(135deg, #10b981, #059669); border: none; color: white; border-radius: 8px; font-weight: 600; font-size: 0.9rem; cursor: pointer;"
      >
        {isTesting ? 'Probando...' : 'Probar conexión'}
      </button>
      
      <!-- Settings -->
      <div style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
          <span style="color: #e2e8f0; font-size: 0.85rem;">Nombre del dispositivo</span>
          <input 
            type="text" 
            bind:value={settings.deviceName} 
            oninput={() => { saveSettings(settings); }} 
            style="padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; width: 120px; text-align: right;"
          />
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="color: #e2e8f0; font-size: 0.85rem;">Intervalo de respaldo</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input 
              type="number" 
              bind:value={settings.backupInterval} 
              min={1} 
              max={168} 
              oninput={() => { saveSettings(settings); }} 
              style="padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; width: 50px; text-align: center;"
            />
            <span style="color: #64748b; font-size: 0.75rem;">horas</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>