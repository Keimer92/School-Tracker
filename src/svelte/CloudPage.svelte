<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService, syncManager, type SyncStatus } from "../lib/syncService";
  import { d1SyncService, d1SyncManager, type D1Config, type D1SyncResult } from "../lib/d1SyncService";
  import { invalidateD1Cache } from "../lib/syncService";
  import type { DriveFile } from "../lib/driveSyncService";
  import { driveSyncService } from "../lib/driveSyncService";
  import { ensureWsSync, stopWsSync } from "../lib/wsSyncService";
  import { registerBackHandler, setBackAuthInProgress } from "../lib/androidBack";
  import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
  import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";

  const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  const STORAGE_KEY = 'schooltracker-google-drive-settings';

  /** Exporta la clave de conexión D1 como archivo .key para configurar otro dispositivo. */
  async function exportarClaveConexion() {
    if (!d1Cfg) return;
    try {
      const ruta = await saveDialog({
        title: 'Exportar clave de conexión',
        defaultPath: 'schooltracker.key',
        filters: [{ name: 'Conexión School Tracker', extensions: ['key'] }],
      });
      if (!ruta) return;
      const contenido = JSON.stringify({ workerUrl: d1Cfg.workerUrl, schoolKey: d1Cfg.schoolKey }, null, 2);
      await writeTextFile(ruta, contenido);
      await emit("show-toast", { message: "✅ Clave exportada: " + ruta, type: "success" });
    } catch (e) {
      console.error('Error exportando clave:', e);
      await emit("show-toast", { message: "❌ Error al exportar la clave: " + e, type: "error" });
    }
  }

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

  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; downloadProgress?: { loaded: number; total: number; pct: number } | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  const storedSyncSeconds = parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '300', 10);
  let syncInterval = $state(Math.round((storedSyncSeconds || 300) / 60));
  const storedAutoBackup = parseInt(localStorage.getItem('drive_auto_backup_minutes') || '', 10);
  let autoBackupHours = $state(Number.isFinite(storedAutoBackup) && storedAutoBackup > 0 ? Math.max(1, Math.round(storedAutoBackup / 60)) : 3);

  function filePlatform(name: string): 'Windows' | 'Android' | null {
    if (/_Windows_/i.test(name)) return 'Windows';
    if (/_Android_/i.test(name)) return 'Android';
    return null;
  }
  let isAuthLoading = $state(false);
  let authHandled = false;
  let isFetchingFiles = $state(false);
  let isTesting = $state(false);
  let syncFiles: DriveFile[] = $state([]);
  let imgError = $state(false);
  let showConfirm = $state(false);
  let confirmTitle = $state("");
  let confirmMessage = $state("");
  let confirmVariant: 'danger' | 'warning' | 'info' = $state('danger');
  let confirmAction: (() => Promise<void>) | null = $state(null);

  // Estado D1
  let d1Cfg = $state<D1Config | null>(null);
  let d1SyncState = $state({ status: 'idle' as string, lastSync: null as string | null, message: null as string | null });
  let isD1Saving = $state(false);
  let isD1Testing = $state(false);
  let isD1Syncing = $state(false);
  let d1LastResult = $state<D1SyncResult | null>(null);
  let showD1Config = $state(false);

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
    if (isAndroid) {
      // Selector nativo de cuentas: la app nunca pierde el primer plano
      // (evita que Android congele el proceso y muera el TCP/deep-link)
      try {
        await invoke("gd_start_native_signin", { serverClientId: settings.clientId });
      } catch (e) {
        console.error('Native Google Auth failed:', e);
        await emit("show-toast", { message: "❌ Error al abrir selector de Google: " + e, type: "error" });
        isAuthLoading = false;
        return;
      }
      // Polling de respaldo: si una recarga del WebView perdió el evento,
      // el resultado sigue disponible en MainActivity
      const deadline = Date.now() + 180000;
      let gotResult = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const res = await invoke<string | null>("gd_take_last_native_result");
          if (res) {
            gotResult = true;
            handleGoogleNativeResult(res);
            break;
          }
        } catch (e) {
          console.error('[NativePoll] invoke falló:', e);
        }
        if (authHandled) break;
      }
      if (!gotResult && !authHandled) {
        isAuthLoading = false;
        await emit("show-toast", { message: "⏱ Tiempo de espera agotado en el selector de Google", type: "error" });
      }
      return;
    }
    setBackAuthInProgress(true);
    try {
      const port = 51733;
      const redirectUri = `${isAndroid ? 'http://127.0.0.1' : 'http://localhost'}:${port}/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=consent`;
      const code = await invoke<string>("gd_open_auth_webview", { url: authUrl });
      if (code && !authHandled) {
        authHandled = true;
        await exchangeCode(code, redirectUri);
      }
    } catch (e) {
      if (!authHandled) {
        console.error('Google Auth failed:', e);
        await emit("show-toast", { message: "❌ Error al autenticar con Google: " + e, type: "error" });
      }
    } finally { isAuthLoading = false; setBackAuthInProgress(false); }
  }

  // Resultado del selector nativo de Google (MainActivity emite CustomEvent en window
  // y, si existe el global, event.emit de Tauri con el mismo nombre).
  function handleGoogleNativeResult(detail: unknown) {
    let res: any = detail;
    if (typeof res === 'string') {
      try { res = JSON.parse(res); } catch { return; }
    }
    if (!res) return;
    if (!res.ok) {
      if (!authHandled && !res.cancelled) {
        emit("show-toast", { message: `❌ Error de Google Sign-In (${res.statusCode ?? "?"}): ${res.error ?? ""}`, type: "error" });
      }
      isAuthLoading = false;
      return;
    }
    if (authHandled) return;
    if (!res.serverAuthCode) {
      isAuthLoading = false;
      emit("show-toast", { message: "❌ Google no devolvió código de autorización", type: "error" });
      return;
    }
    authHandled = true;
    exchangeCode(res.serverAuthCode, "");
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
      try {
        await driveSyncService.pullById(file.id);
        await emit("show-toast", { message: "✅ Respaldo restaurado", type: "success" });
      } catch (e) {
        await emit("show-toast", { message: "❌ Error al restaurar: " + (e?.message || e), type: "error" });
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

  async function loadD1Config() {
    try {
      d1Cfg = await d1SyncService.getConfig();
      if (d1Cfg) showD1Config = false;
    } catch {}
  }

  function toggleD1Config() { showD1Config = !showD1Config; }

  /**
   * Importa credenciales desde un archivo .key. Si ya existía una conexión con
   * OTRAS credenciales, avisa y reemplaza limpio (d1_clear_config antes de
   * guardar → nuevo device_id y cursores en cero), evitando mezclar datos de
   * una nube con otra (p. ej. tras restaurar un respaldo de Drive).
   */
  async function importarClaveD1() {
    try {
      const ruta = await openDialog({
        title: 'Selecciona el archivo de conexión',
        filters: [{ name: 'Conexión School Tracker', extensions: ['key', 'json'] }],
        multiple: false,
      });
      if (!ruta || typeof ruta !== 'string') return;
      let cfg: any;
      try {
        cfg = JSON.parse(await readTextFile(ruta));
      } catch { throw new Error('El archivo no es un .key válido'); }
      if (!cfg.workerUrl || !cfg.schoolKey) throw new Error('El archivo no contiene workerUrl/schoolKey');

      const previa = await d1SyncService.getConfig();
      const distinta = previa && (previa.workerUrl !== cfg.workerUrl || previa.schoolKey !== cfg.schoolKey);
      if (distinta) {
        confirm(
          'Las credenciales del archivo son DIFERENTES a las actuales.\n\nSe reemplazarán por completo: se generará un nuevo ID de dispositivo y se reiniciará la sincronización. Los datos locales actuales se subirán a la nube nueva en el próximo sync.',
          '⚠️ Reemplazar conexión',
          'warning',
          async () => {
            try {
              stopWsSync();
              await d1SyncService.clearConfig();
              d1Cfg = await d1SyncService.saveConfig(cfg.workerUrl, cfg.schoolKey);
              invalidateD1Cache();
              await ensureWsSync();
              syncService.ensurePeriodicSync();
              showD1Config = false;
              await emit("show-toast", { message: "✅ Conexión reemplazada. Sincronizando...", type: "success" });
              syncD1();
            } catch (e) {
              await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
            }
          }
        );
        return;
      }

      isD1Saving = true;
      try {
        d1Cfg = await d1SyncService.saveConfig(cfg.workerUrl, cfg.schoolKey);
        invalidateD1Cache();
        showD1Config = false;
        await ensureWsSync();
        syncService.ensurePeriodicSync();
        await emit("show-toast", { message: "✅ Conexión importada correctamente", type: "success" });
      } finally { isD1Saving = false; }
    } catch (e) {
      await emit("show-toast", { message: "❌ " + (typeof e === 'string' ? e : e?.message || String(e)), type: "error" });
    }
  }

  async function testD1() {
    if (!d1Cfg) return;
    isD1Testing = true;
    try {
      const res = await d1SyncService.testConnection();
      if (res.ok) {
        await emit("show-toast", { message: `✅ Conexión D1 exitosa (${res.latency} ms)`, type: "success" });
      } else {
        await emit("show-toast", { message: "❌ Error de conexión: " + (res.error || 'Desconocido'), type: "error" });
      }
    } catch (e) {
      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
    } finally { isD1Testing = false; }
  }

  async function syncD1() {
    if (!d1Cfg) return;
    isD1Syncing = true;
    try {
      d1LastResult = await d1SyncService.syncAll();
      await emit("show-toast", { message: "✅ Sync D1 completado", type: "success" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error en sync: " + e, type: "error" });
    } finally { isD1Syncing = false; }
  }

  async function disconnectD1() {
    confirm("¿Desconectar la nube D1?\n\nSe detendrá la sincronización automática con Cloudflare.", "Desconectar D1", 'warning', async () => {
      try {
        await d1SyncService.clearConfig();
        stopWsSync();
        d1Cfg = null;
        d1LastResult = null;
        invalidateD1Cache();
        await emit("show-toast", { message: "✅ D1 desconectado", type: "success" });
      } catch (e) {
        await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
      }
    });
  }

  async function regenerateDeviceId() {
    confirm(
      "¿Regenerar el ID de este dispositivo?\n\nÚsalo SOLO si dos dispositivos muestran el mismo ID (suele pasar al restaurar un respaldo de Drive). La sincronización en tiempo real quedará reparada.",
      "Regenerar ID de dispositivo",
      'warning',
      async () => {
        try {
          const nuevo = await invoke<string>('d1_reset_device_id');
          if (d1Cfg) d1Cfg.deviceId = nuevo;
          stopWsSync();
          await ensureWsSync();
          await emit("show-toast", { message: `✅ Nuevo ID: ${nuevo.slice(-8)}`, type: "success" });
        } catch (e) {
          await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
        }
      }
    );
  }

  onMount(async () => {
    const unsub = syncManager.subscribe((state) => { syncStatus = state; });
    loadSettings();
    if (settings.accessToken) await refreshFiles();
    await loadD1Config();
    d1SyncManager.subscribe((s) => { d1SyncState = s; });
    // Auto-detect pending OAuth code (por si la página recargó durante el flujo)
    if (!settings.accessToken && !isAuthLoading) {
      try {
        const hasCode = await invoke<boolean>("gd_has_pending_oauth_code");
        if (hasCode) {
          isAuthLoading = true;
          setBackAuthInProgress(true);
          const code = await invoke<string>("gd_wait_oauth_code", { timeoutSecs: 10 });
          const port = 51733;
          const pendingRedirect = `${isAndroid ? 'http://127.0.0.1' : 'http://localhost'}:${port}/callback`;
          if (code && !authHandled) {
            authHandled = true;
            await exchangeCode(code, pendingRedirect);
          }
          isAuthLoading = false;
          setBackAuthInProgress(false);
        }
      } catch {}
    }
    return unsub;
  });

  // Respaldo: el código llega vía deep link (MainActivity emite 'oauth-callback-android'
  // como CustomEvent en window y, si existe el global, vía event.emit de Tauri)
  // cuando Android captura la URL http://127.0.0.1:51733/callback?code=... mediante intent-filter.
  function handleNativeAuthCode(code: string) {
    if (!code || authHandled) return;
    authHandled = true;
    invoke("gd_cancel_oauth").catch(() => {});
    exchangeCode(code, "http://127.0.0.1:51733/callback");
  }

  onMount(() => {
    if (!isAndroid) return;
    const nativeHandler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      handleNativeAuthCode(detail ?? "");
    };
    const googleResultHandler = (e: Event) => {
      handleGoogleNativeResult((e as CustomEvent<unknown>).detail);
    };
    let unsub: (() => void) | null = null;
    let unsubResult: (() => void) | null = null;
    listen<string>("oauth-callback-android", (event) => {
      handleNativeAuthCode(event.payload);
    }).then((u) => { unsub = u; }).catch(() => {});
    listen<unknown>("google-native-auth-result", (event) => {
      handleGoogleNativeResult(event.payload);
    }).then((u) => { unsubResult = u; }).catch(() => {});
    window.addEventListener("oauth-callback-android", nativeHandler);
    window.addEventListener("google-native-auth-result", googleResultHandler);
    return () => {
      window.removeEventListener("oauth-callback-android", nativeHandler);
      window.removeEventListener("google-native-auth-result", googleResultHandler);
      if (unsub) unsub();
      if (unsubResult) unsubResult();
    };
  });
</script>

<div class="cloud-page">
  <div class="cloud-card" style="margin-bottom: 1.25rem;">
    <div class="cloud-card-header" style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
      <h3>
        <span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F6821F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>
          Cloudflare D1 <span style="font-size: 0.65rem; font-weight: 400; color: #64748b;">(Sync principal)</span>
        </span>
      </h3>
      {#if d1Cfg}
        <button onclick={toggleD1Config} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #94a3b8; cursor: pointer; font-size: 0.7rem; flex-shrink: 0;">{showD1Config ? 'Cerrar' : 'Configurar'}</button>
      {/if}
    </div>
    <div style="padding: 0 1.5rem 1.5rem;">
      {#if showD1Config}
        <div style="display: flex; flex-direction: column; gap: 0.7rem; padding: 1.25rem; background: rgba(0,0,0,0.2); border-radius: 12px; margin-bottom: 1rem; text-align: center;">
          <div style="font-size: 2rem;">🔑</div>
          <p style="color: #94a3b8; font-size: 0.82rem; margin: 0 0 0.25rem;">Selecciona tu archivo <strong style="color:#e2e8f0">schooltracker.key</strong> para conectar este dispositivo con la nube.</p>
          <p style="color: #64748b; font-size: 0.72rem; margin: 0 0 0.75rem;">El archivo lo genera otro dispositivo ya configurado desde "Exportar clave".</p>
          <button onclick={importarClaveD1} disabled={isD1Saving}
            style="padding: 0.8rem 1.5rem; background: linear-gradient(135deg, #F6821F, #F97316); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 0.9rem; cursor: pointer; box-shadow: 0 4px 16px rgba(246,130,31,0.3); opacity: {isD1Saving ? 0.6 : 1};">
            {isD1Saving ? 'Importando...' : '📂 Importar archivo .key'}
          </button>
          <button onclick={toggleD1Config} style="padding: 0.55rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.8rem;">Cancelar</button>
        </div>
      {/if}
      {#if !d1Cfg}
        <div style="text-align: center; padding: 1.5rem 1rem;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⬡</div>
          <h4 style="color: #e2e8f0; margin: 0 0 0.4rem 0;">Sync en la Nube con Cloudflare D1</h4>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.25rem;">Toda tu base de datos se sincroniza a una única base en la nube.</p>
          <button onclick={toggleD1Config} style="padding: 0.8rem 2rem; background: linear-gradient(135deg, #F6821F, #F97316); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 0.95rem; cursor: pointer; box-shadow: 0 4px 16px rgba(246,130,31,0.3);">
            ⚙️ Configurar D1
          </button>
        </div>
      {:else}
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 0.75rem 0.9rem; background: linear-gradient(135deg, rgba(246,130,31,0.08) 0%, rgba(246,130,31,0.03) 100%); border-radius: 12px; border: 1px solid rgba(246,130,31,0.12); margin-bottom: 0.9rem;">
          <div style="color: #f1f5f9; font-size: 0.78rem;">
            <div style="font-weight: 600; color: #fdba74;">Clave: <span style="color:#e2e8f0; font-family: monospace;">••••••••{d1Cfg.schoolKey.slice(-4)}</span></div>
            <div style="font-weight: 600; color: #94a3b8; font-size: 0.72rem;">ID dispositivo: <span style="color:#e2e8f0; font-family: monospace;">…{d1Cfg.deviceId.slice(-10)}</span>
              {#if d1Cfg.lastSync}<span style="color:#64748b;"> · cursor: {d1Cfg.lastSync}</span>{/if}
            </div>
            <div style="color: #64748b; margin-top: 2px;">Dispositivo: <span style="font-family: monospace;">{d1Cfg.deviceId}</span></div>
            <div style="color: #64748b; margin-top: 2px;">Última sync: {d1SyncState.lastSync ? new Date(d1SyncState.lastSync).toLocaleString('es-ES') : '—'}</div>
            <button onclick={exportarClaveConexion} title="Genera un archivo .key para configurar otro dispositivo"
              style="margin-top: 6px; padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid rgba(246,130,31,0.3); background: rgba(246,130,31,0.1); color: #fdba74; cursor: pointer; font-size: 0.7rem; font-weight: 600;">📤 Exportar clave (.key)</button>
          </div>
        </div>
        {#if d1SyncState.message}
          <div style="margin-bottom: 0.75rem; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; border-left: 3px solid {d1SyncState.status === 'error' ? '#ef4444' : '#F6821F'}; background: rgba(0,0,0,0.2); color: {d1SyncState.status === 'error' ? '#fca5a5' : 'var(--text-secondary)'};">
            {d1SyncState.message}
          </div>
        {/if}
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <button onclick={syncD1} disabled={isD1Syncing} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(246,130,31,0.15) 0%, rgba(246,130,31,0.05) 100%); border: 1px solid rgba(246,130,31,0.25); border-radius: 12px; cursor: pointer; opacity: {isD1Syncing ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F6821F" stroke-width="2" stroke-linecap="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            <span style="color: #F6821F; font-weight: 600; font-size: 0.85rem;">Sincronizar ahora</span>
          </button>
          <button onclick={testD1} disabled={isD1Testing} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; cursor: pointer; opacity: {isD1Testing ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <span style="color: #94a3b8; font-weight: 600; font-size: 0.85rem;">{isD1Testing ? 'Probando...' : 'Probar conexión'}</span>
          </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; padding: 0.6rem 0.85rem; background: rgba(0,0,0,0.15); border-radius: 10px; margin-top: 0.85rem;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4);"></div>
            <span style="color: #94a3b8; font-size: 0.8rem;">Sync periódico:</span>
            <input type="number" min={3} max={60} bind:value={syncInterval} style="width: 52px; padding: 0.2rem 0.35rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
            <span style="color: #64748b; font-size: 0.75rem;">minutos</span>
            <button onclick={() => { const mins = Math.max(3, Math.min(60, syncInterval)); syncInterval = mins; localStorage.setItem('periodic_sync_interval_seconds', String(mins * 60)); syncService.ensurePeriodicSync(); emit("show-toast", { message: "✅ Intervalo de sync guardado", type: "success" }); }} style="padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid rgba(246,130,31,0.3); background: rgba(246,130,31,0.1); color: #fdba74; cursor: pointer; font-size: 0.7rem; font-weight: 600;">Guardar</button>
          </div>
          <span style="color: #64748b; font-size: 0.7rem; margin-left: auto;">La D1 sincroniza cambios automáticamente.</span>
        </div>
        {#if d1LastResult}
          <div style="margin-top: 0.75rem; padding: 0.6rem 0.8rem; background: rgba(0,0,0,0.15); border-radius: 8px; font-size: 0.7rem; color: #94a3b8; font-family: monospace; line-height: 1.6;">
            Subidos: {JSON.stringify(d1LastResult.pushed)} · Aplicados: {JSON.stringify(d1LastResult.pulled)} · Borrados: {d1LastResult.deletedApplied}
          </div>
        {/if}
        <div style="margin-top: 0.85rem; display: flex; align-items: center; gap: 6px;">
          <button onclick={regenerateDeviceId} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(245,158,11,0.3); background: rgba(245,158,11,0.1); color: #fbbf24; cursor: pointer; font-size: 0.7rem;">Regenerar ID dispositivo</button>
          <button onclick={disconnectD1} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.7rem;">Desconectar</button>
        </div>
      {/if}
    </div>
  </div>

  <div class="cloud-card">
    <div class="cloud-card-header">
      <h3>
        <span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="var(--primary-color)"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
          Google Drive <span style="font-size: 0.65rem; font-weight: 400; color: #64748b;">(Respaldo automático)</span>
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
          <h4 style="color: #e2e8f0; margin: 0 0 0.5rem 0;">Respaldo en Google Drive</h4>
          <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Vincula tu cuenta de Google Drive para crear respaldos manuales de tu base de datos.</p>
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
                · Último respaldo: {new Date(syncStatus.lastSync).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
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

        {#if syncStatus.downloadProgress && syncStatus.downloadProgress.pct < 100}
          <div style="margin-bottom: 1rem;">
            <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06);">
              <div style="height: 100%; background: linear-gradient(90deg, var(--primary-color, #3b82f6), #a78bfa); border-radius: 4px; transition: width 0.2s ease; box-shadow: 0 0 12px rgba(59,130,246,0.35); width: {syncStatus.downloadProgress.pct}%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.7rem; color: #64748b;">
              <span>Descargando base de datos</span>
              <span>
                {#if syncStatus.downloadProgress.total > 0}
                  {fmtBytes(syncStatus.downloadProgress.loaded)} / {fmtBytes(syncStatus.downloadProgress.total)} · {syncStatus.downloadProgress.pct}%
                {:else}
                  {fmtBytes(syncStatus.downloadProgress.loaded)}
                {/if}
              </span>
            </div>
          </div>
        {/if}

        <!-- Push / Pull buttons -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem;">
          <button onclick={async () => { try { await driveSyncService.pushAll(); await refreshFiles(); } catch (e) { await emit("show-toast", { message: "❌ Error al crear respaldo: " + (e?.message || e), type: "error" }); } }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Crear respaldo</span>
          </button>
          <button onclick={async () => { try { await driveSyncService.pullAll(); await refreshFiles(); } catch (e) { await emit("show-toast", { message: "❌ Error al restaurar: " + (e?.message || e), type: "error" }); } }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.12) 0%, rgba(var(--primary-rgb), 0.04) 100%); border: 1px solid rgba(var(--primary-rgb), 0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span style="color: var(--primary-color); font-weight: 600; font-size: 0.85rem;">Restaurar último</span>
          </button>
        </div>

        <!-- Respaldo automático -->
        <div style="display: flex; flex-direction: column; gap: 6px; padding: 0.65rem 0.85rem; background: rgba(0,0,0,0.15); border-radius: 10px; margin-bottom: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.4);"></div>
            <span style="color: #94a3b8; font-size: 0.8rem;">Respaldo automático cada</span>
            <input type="number" min={1} max={168} bind:value={autoBackupHours} style="width: 52px; padding: 0.2rem 0.35rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
            <span style="color: #64748b; font-size: 0.75rem;">horas</span>
            <button onclick={() => { const h = Math.max(1, Math.min(168, autoBackupHours)); autoBackupHours = h; driveSyncService.setAutoBackupInterval(h * 60); emit("show-toast", { message: `✅ Respaldo automático cada ${h} h`, type: "success" }); }} style="padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid rgba(var(--primary-rgb),0.3); background: rgba(var(--primary-rgb),0.1); color: var(--primary-color); cursor: pointer; font-size: 0.7rem; font-weight: 600; margin-left: auto;">Guardar</button>
          </div>
          <span style="color: #64748b; font-size: 0.7rem;">📁 Keimer Labs/School Tracker MINED · solo sube si hay cambios</span>
        </div>

        <!-- Sync files -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem;">
            <h5 style="margin: 0; color: #e2e8f0; font-size: 0.85rem;">Respaldos en Drive {syncFiles.length > 0 ? `(${syncFiles.length})` : ''}</h5>
            <button onclick={refreshFiles} disabled={isFetchingFiles} style="padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.7rem;">{isFetchingFiles ? 'Cargando...' : '↻ Refrescar'}</button>
          </div>
          {#if syncFiles.length === 0}
            <div style="text-align: center; padding: 1.5rem; color: #64748b; font-size: 0.8rem;">No hay respaldos en Drive. Presiona "Crear respaldo" para subir el primero.</div>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 4px;">
              {#each syncFiles as file (file.id)}
                <div style="display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.7rem; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                  <div style="flex: 1; min-width: 0;">
                    <div style="color: #e2e8f0; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{file.name}</div>
                    <div style="display: flex; align-items: center; gap: 6px; color: #64748b; font-size: 0.65rem;">
                      <span>{fmtDate(file.createdTime)} · {fmtSize(file.size)}</span>
                      {#if filePlatform(file.name) === 'Android'}
                        <span style="padding: 1px 6px; border-radius: 999px; background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.25); color: #7dd3fc;">🤖 Android</span>
                      {:else if filePlatform(file.name) === 'Windows'}
                        <span style="padding: 1px 6px; border-radius: 999px; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.25); color: #c4b5fd;">🪟 Windows</span>
                      {/if}
                    </div>
                  </div>
                  <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button onclick={() => requestRestore(file)} style="padding: 0.3rem 0.55rem; border-radius: 5px; border: 1px solid rgba(var(--primary-rgb),0.3); background: rgba(var(--primary-rgb),0.1); color: var(--primary-color); cursor: pointer; font-size: 0.65rem;">Restaurar</button>
                    <button onclick={() => requestDelete(file)} style="padding: 0.3rem 0.55rem; border-radius: 5px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #f87171; cursor: pointer; font-size: 0.65rem;">🗑</button>
                  </div>
                </div>
              {/each}
            </div>
            <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 6px; color: #64748b; font-size: 0.7rem;">
              <span>💾 Se conservan los últimos 3 respaldos. Los más antiguos se eliminan automáticamente.</span>
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
