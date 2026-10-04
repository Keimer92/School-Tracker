<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { d1SyncService, d1SyncManager, SYNC_PERIODICO_MIN, type D1Config } from "../lib/d1SyncService";
  import { syncService, syncManager, type SyncStatus, invalidateD1Cache } from "../lib/syncService";
  import type { DriveFile } from "../lib/driveSyncService";
  import { driveSyncService } from "../lib/driveSyncService";
  import { isInstantBackupEnabled, setInstantBackupEnabled } from "../lib/driveInstantBackup";
  import { ensureWsSync } from "../lib/wsSyncService";
  import { registerBackHandler, setBackAuthInProgress } from "../lib/androidBack";
  import { ask } from "@tauri-apps/plugin-dialog";
  import {
    getPerfilLocal, getValidAuthToken,
    DEFAULT_WORKER_URL,
  } from "../lib/cloudAuth";

  let { onNavigate, pageActive = false }: { onNavigate?: (tab: string) => void; pageActive?: boolean } = $props();

  // ── Iniciar sesión con Google (solo para Drive) ──
  const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

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

  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; downloadProgress?: { loaded: number; total: number; pct: number } | null; uploadProgress?: { loaded: number; total: number; pct: number } | null; lastUpload?: string | null; lastUploadBytes?: number | null; lastUploadFile?: { when: string | null; bytes: number | null; name: string | null } | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  let showDrivePopover = $state(false);
  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  /** Momento del último respaldo: el confirmado en la nube si existe, si no el local. */
  let driveUltimoRespaldo = $derived.by(() => {
    const f = syncStatus.lastUploadFile;
    if (f?.when) return { when: f.when, bytes: f.bytes, name: f.name };
    return { when: syncStatus.lastUpload ?? null, bytes: syncStatus.lastUploadBytes ?? null, name: null };
  });
  function fmtMomento(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return mismoDia ? `Hoy ${hora}` : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const storedSyncSeconds = parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '300', 10);
  let syncInterval = $state(Math.round((storedSyncSeconds || 300) / 60));

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
  // Respaldo instantáneo: se actualiza en Drive el archivo "_latest" tras cada guardado.
  let instantBackupOn = $state(isInstantBackupEnabled());
  let imgError = $state(false);

  // Estado D1
  let d1Cfg = $state<D1Config | null>(null);
  let d1SyncState = $state({ status: 'idle' as string, lastSync: null as string | null, message: null as string | null });

  // ── Diagnóstico de errores de sync (window.__d1LastError lo llena d1SyncService) ──
  let d1ErrorDetalle = $state('');
  let showD1ErrorDetalle = $state(false);
  function refreshD1ErrorDetalle() {
    const d = (window as any).__d1LastError;
    if (!d) { d1ErrorDetalle = ''; return; }
    d1ErrorDetalle = `[${d.ts}] online=${d.online}\nMENSAJE:\n${d.mensaje}\n\nERROR COMPLETO (JSON):\n${d.completo || '(sin detalle)'}`;
  }
  async function copiarD1Error() {
    try {
      await navigator.clipboard.writeText(d1ErrorDetalle || (window as any).__d1LastError?.mensaje || '');
      await emit("show-toast", { message: "📋 Diagnóstico del error copiado al portapapeles", type: "success" });
    } catch (e) {
      await emit("show-toast", { message: "❌ No se pudo copiar: " + e, type: "error" });
    }
  }
  let isD1Syncing = $state(false);

  const isConnected = $derived(!!settings.accessToken);
  const isAndroid = /Android/i.test(navigator.userAgent);

  // ── Layout CloudPage: columnas en desktop, swipe en móvil ──
  let activeCloudTab = $state(0); // 0 = Cloudflare D1, 1 = Google Drive
  let cloudTouchX = 0;
  function onCloudTouchStart(e: TouchEvent) { cloudTouchX = e.changedTouches[0].clientX; }
  function onCloudTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - cloudTouchX;
    // Deslizar a la izquierda (dx < 0) -> Drive; a la derecha (dx > 0) -> D1
    if (dx > 50) activeCloudTab = 0;
    else if (dx < -50) activeCloudTab = 1;
  }

  /** Suma los conteos de un resultado de sync (puede ser número o mapa por tabla). */
  function sumarConteos(o: any): number {
    if (typeof o === 'number') return o;
    if (!o) return 0;
    return Object.values(o as Record<string, unknown>).reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  }

  function mensajeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  $effect(() => { if (settings.googleUserProfilePic) imgError = false; });

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
      if (!resp.ok) {
        // Limpiar token expirado para que la UI muestre "desconectado"
        settings.accessToken = '';
        settings.tokenExpiry = 0;
        saveSettings();
        return null;
      }
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

  async function initGoogleAuth(forceSelectAccount: boolean = false) {
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
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=${forceSelectAccount ? 'select_account' : 'consent'}`;
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
      if (token) {
        syncFiles = await driveSyncService.listSyncFiles(token);
        // La lista viene ordenada por más reciente (modifiedTime): el primero es
        // el último respaldo real en la nube. Se refleja en el estado global para
        // que la card y el chip del sidebar muestren momento + tamaño.
        driveSyncService.setLastUploadFromDrive(syncFiles[0] ?? null);
      }
    } catch (e) {
      await emit("show-toast", { message: "❌ No se pudo refrescar la lista de respaldos: " + mensajeError(e), type: "error" });
    } finally { isFetchingFiles = false; }
  }

  // La página queda montada (display:none) al cambiar de pestaña: refrescar la
  // lista cada vez que la pestaña Nube se hace visible, para no mostrar datos viejos.
  $effect(() => {
    if (pageActive && settings.accessToken) void refreshFiles();
  });

  function fmtSize(bytes: number): string {
    return (bytes / 1024).toFixed(1) + ' KB';
  }

  /** Activa/desactiva el respaldo instantáneo a Drive tras cada guardado. */
  async function toggleInstantBackup() {
    const next = !instantBackupOn;
    instantBackupOn = next;
    setInstantBackupEnabled(next);
    await emit("show-toast", {
      message: next
        ? "✅ Respaldo instantáneo activado: se sube a Drive tras cada guardado"
        : "ℹ️ Respaldo instantáneo desactivado (siguen los manuales y programados)",
      type: next ? "success" : "info",
    });
  }

  function fmtDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES');
  }

  /** Confirmación nativa del sistema (Tauri ask). Ejecuta action solo si el usuario acepta. */
  async function confirm(msg: string, title: string, variant: 'danger' | 'warning' | 'info', action: () => Promise<void>) {
    const kind = variant === 'danger' ? 'warning' : variant === 'info' ? 'info' : 'warning';
    const ok = await ask(msg, { title, kind, okLabel: 'Confirmar', cancelLabel: 'Cancelar' });
    if (ok) await action();
  }

  async function requestRestore(file: DriveFile) {
    confirm(`¿Restaurar "${file.name}"?\n\nSe sobrescribirá la base de datos actual.\nEsta acción no se puede deshacer.`, "⚠️ Restaurar Respaldo", 'danger', async () => {
      try {
        await driveSyncService.pullById(file.id);
        await emit("show-toast", { message: "✅ Respaldo restaurado", type: "success" });
      } catch (e) {
        await emit("show-toast", { message: "❌ Error al restaurar: " + mensajeError(e), type: "error" });
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
    } catch {}
  }

  /** Sincronización manual: push + pull. */
  async function syncD1() {
    isD1Syncing = true;
    try {
      await d1SyncService.syncAll();
      await emit("show-toast", { message: "✅ Sincronización completa", type: "success" });
    } catch (e) {
      console.error('[D1] sync manual falló:', e);
      await emit("show-toast", { message: "❌ Error al sincronizar: " + mensajeError(e), type: "error" });
    } finally { isD1Syncing = false; }
  }

  onMount(() => {
    const unsub = syncManager.subscribe((state) => { syncStatus = state; });
    loadSettings();
    d1SyncManager.subscribe((s) => { d1SyncState = s; if (s.status === 'error') refreshD1ErrorDetalle(); });
    void (async () => {
      if (settings.accessToken) await refreshFiles();
      await loadD1Config();
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
    })();
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
  <!-- Tabs de selección (solo móvil/swipe) -->
  {#if isAndroid}
    <div class="cloud-tabs">
      <button class:active={activeCloudTab === 0} onclick={() => activeCloudTab = 0}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>
        Cloudflare D1
      </button>
      <button class:active={activeCloudTab === 1} onclick={() => activeCloudTab = 1}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Google Drive
      </button>
    </div>
  {/if}

  <div class="cloud-cols" class:mobile={isAndroid} role="region" aria-label="Paneles de sincronización"
    ontouchstart={isAndroid ? onCloudTouchStart : undefined}
    ontouchend={isAndroid ? onCloudTouchEnd : undefined}>
  <div class="cloud-card" style={isAndroid && activeCloudTab !== 0 ? 'display:none;' : ''}>
    <div class="cloud-card-header" style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
      <h3>
        <span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F6821F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>
          Cloudflare D1 <span style="font-size: 0.65rem; font-weight: 400; color: #64748b;">(Sync principal)</span>
        </span>
      </h3>
    </div>
    <div style="padding: 0 1.5rem 1.5rem;">
      {#if d1Cfg}
        {#if d1SyncState.message && d1SyncState.status !== 'error'}
          <div style="margin-bottom: 0.75rem; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; border-left: 3px solid #F6821F; background: rgba(0,0,0,0.2); color: var(--text-secondary);">
            {d1SyncState.message}
          </div>
        {/if}
        <!--
          Card minimizada a propósito: el sync es vital y no se gestiona desde acá.
          Queda la última sincronización, el botón de sincronizar y el aviso de
          error con su diagnóstico, que es lo único que hace falta cuando algo se
          rompe. Se quitaron Configurar, Exportar .key, Clave, ID/dispositivo, Sync
          completo, Probar, Regenerar ID, Desconectar y el ajuste del intervalo.
        -->
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button onclick={syncD1} disabled={isD1Syncing} title="Sincronizar ahora"
            style="display: inline-flex; align-items: center; gap: 6px; padding: 0 0.85rem; height: 36px; border-radius: 9px; border: 1px solid rgba(246,130,31,0.25); background: rgba(246,130,31,0.08); color: #fdba74; cursor: pointer; opacity: {isD1Syncing ? 0.5 : 1}; transition: all 0.2s ease; font-size: 0.75rem; font-weight: 700;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F6821F" stroke-width="2" stroke-linecap="round" style="{isD1Syncing ? 'animation: spin 1s linear infinite;' : ''}"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            <span>{isD1Syncing ? 'Sincronizando' : 'Sincronizar'}</span>
          </button>
          <div style="display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1;">
            <span style="color: #94a3b8; font-size: 0.72rem;">
              Última sync: <strong style="color: #e2e8f0;">{d1SyncState.lastSync ? new Date(d1SyncState.lastSync).toLocaleString('es-ES') : '—'}</strong>
            </span>
            <span style="color: #64748b; font-size: 0.68rem;">Automática en tiempo real y cada {SYNC_PERIODICO_MIN} min</span>
          </div>
        </div>
        {#if d1SyncState.status === 'error' && d1SyncState.message}
          <div style="margin-top: 0.85rem; padding: 0.9rem 1rem; background: rgba(15,23,42,0.55); border: 1px solid rgba(239,68,68,0.3); border-radius: 14px;">
            <div style="display: flex; align-items: center; gap: 7px; margin-bottom: 0.75rem; color: #fca5a5; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Error de sincronización
            </div>
            <p style="margin: 0; padding: 0.6rem 0.7rem; border-radius: 10px; background: rgba(239,68,68,0.1); color: #fecaca; font-size: 0.74rem; line-height: 1.5; border-left: 3px solid #ef4444; word-break: break-word;">{d1SyncState.message}</p>
            <div style="display: flex; gap: 6px; margin-top: 0.5rem;">
              <button onclick={copiarD1Error} style="padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid rgba(59,130,246,0.3); background: rgba(59,130,246,0.1); color: #93c5fd; cursor: pointer; font-size: 0.68rem; font-weight: 600;">📋 Copiar diagnóstico</button>
            </div>
          </div>
        {/if}
      {:else}
        <p style="margin: 0; color: #64748b; font-size: 0.78rem; text-align: center; line-height: 1.5;">
          La nube se configura sola al iniciar sesión con tu cuenta de Google.
        </p>
      {/if}
    </div>
  </div>

  <div class="cloud-card" style={isAndroid && activeCloudTab !== 1 ? 'display:none;' : ''}>
    <div class="cloud-card-header">
      <h3>
        <span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="var(--primary-color)"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
          Google Drive <span style="font-size: 0.65rem; font-weight: 400; color: #64748b;">(Respaldo automático)</span>
        </span>
      </h3>
      {#if isConnected}
        <button onclick={() => showDrivePopover = !showDrivePopover} title="Ver details del último respaldo"
          style="display: inline-flex; align-items: center; gap: 5px; padding: 0.35rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #94a3b8; cursor: pointer; font-size: 0.7rem; flex-shrink: 0;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: {syncStatus.uploadProgress ? '#38bdf8' : driveUltimoRespaldo.when ? '#22c55e' : '#64748b'}; box-shadow: 0 0 6px {syncStatus.uploadProgress ? 'rgba(56,189,248,0.6)' : 'rgba(34,197,94,0.5)'};"></span>
          {syncStatus.uploadProgress ? `${syncStatus.uploadProgress.pct}%` : fmtMomento(driveUltimoRespaldo.when).replace('Hoy ', '')}
        </button>
      {/if}
    </div>

    <!-- Popover: momento del respaldo + tamaño enviado + progreso -->
    {#if showDrivePopover && isConnected}
      <div style="margin: 0 1.5rem 1rem; padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(15,23,42,0.7), rgba(30,41,59,0.6)); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.6rem;">
          <span style="font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; color: #94a3b8;">☁️ Último respaldo en Drive</span>
          <button onclick={refreshFiles} disabled={isFetchingFiles} style="padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.68rem;">{isFetchingFiles ? 'Actualizando…' : '↻ Refrescar'}</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.6rem;">
          <div style="padding: 0.5rem 0.6rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;">
            <div style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b;">Momento</div>
            <div style="font-size: 0.9rem; font-weight: 700; color: #e2e8f0; margin-top: 2px;">{fmtMomento(driveUltimoRespaldo.when)}</div>
          </div>
          <div style="padding: 0.5rem 0.6rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;">
            <div style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b;">Enviado a la nube</div>
            <div style="font-size: 0.9rem; font-weight: 700; color: #e2e8f0; margin-top: 2px;">{driveUltimoRespaldo.bytes ? fmtBytes(driveUltimoRespaldo.bytes) : '—'}</div>
          </div>
          <div style="padding: 0.5rem 0.6rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; grid-column: 1 / -1;">
            <div style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b;">Archivo</div>
            <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{driveUltimoRespaldo.name || '—'}</div>
          </div>
        </div>
        {#if syncStatus.uploadProgress}
          {@const up = syncStatus.uploadProgress}
          <div style="margin-top: 0.7rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.68rem; color: #7dd3fc; margin-bottom: 0.3rem;">
              <span>⇪ Subiendo a Drive…</span>
              <span style="font-family: monospace;">{fmtBytes(up.loaded)} / {fmtBytes(up.total)} · {up.pct}%</span>
            </div>
            <div style="height: 6px; border-radius: 3px; background: rgba(255,255,255,0.06); overflow: hidden;">
              <div style="width: {up.pct}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #818cf8); border-radius: 3px; transition: width 0.2s ease;"></div>
            </div>
          </div>
        {/if}
        <p style="margin: 0.7rem 0 0; font-size: 0.66rem; color: #64748b; line-height: 1.45;">
          El archivo <span style="color:#94a3b8;">_latest.db</span> se sobrescribe tras cada guardado (no crea copias nuevas); los demás son snapshots programados. Pulsa <span style="color:#94a3b8;">↻ Refrescar</span> para leer de Drive el momento y el tamaño reales.
        </p>
      </div>
    {/if}

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
                {#if !isAndroid}
                  <!-- En escritorio el login ocurre en el NAVEGADOR DEL SISTEMA, no
                       en una ventana de la app: la WebView embebida no es fiable con
                       Google y no comparte su sesión. Acá solo se espera el código
                       que devuelve el servidor TCP local. Sin este aviso el usuario
                       cree que la app se colgó. -->
                  <p style="color: #94a3b8; font-size: 0.8rem; max-width: 340px; margin: 0; text-align: center;">
                    🌐 Se abrió una ventana del navegador. Inicia sesión con Google
                    ahí y esta pantalla continuará sola.
                  </p>
                {/if}
                <button onclick={cancelAuth} style="background: transparent; border: 1px solid rgba(239,68,68,0.35); color: #f87171; padding: 0.45rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.2s;">
                  Cancelar
                </button>
              </div>
            {:else}
              <button onclick={() => initGoogleAuth()} style="padding: 0.8rem 2rem; background: linear-gradient(135deg, #4285F4, #34A853); border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem; cursor: pointer; box-shadow: 0 4px 16px rgba(66,133,244,0.3);">
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
              {#if driveUltimoRespaldo.when}
                · Último respaldo: {fmtMomento(driveUltimoRespaldo.when)}{driveUltimoRespaldo.bytes ? ` · ${fmtBytes(driveUltimoRespaldo.bytes)}` : ''}
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

        <!-- Push button -->
        <div style="margin-bottom: 0.75rem;">
          <button onclick={async () => { try { await driveSyncService.pushAll(); await refreshFiles(); } catch (e) { await emit("show-toast", { message: "❌ Error al crear respaldo: " + mensajeError(e), type: "error" }); } }} disabled={syncStatus.status === 'syncing'} title="Crea un respaldo con fecha y hora en Google Drive" style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Crear respaldo</span>
          </button>
        </div>

        <!-- Respaldo instantáneo tras cada guardado -->
        <label style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.75rem; margin-bottom: 0.75rem; background: rgba(34,197,94,0.05); border: 1px solid rgba(34,197,94,0.15); border-radius: 12px; cursor: pointer; transition: all 0.2s ease;" title="Actualiza en Drive el archivo de respaldo cada vez que guardes notas, asistencia, estudiantes o cualquier catálogo. Los borrados van a la papelera de Drive, por eso se actualiza el mismo archivo en vez de crear uno nuevo.">
          <span class="switch" style="margin: 0; flex-shrink: 0;">
            <input type="checkbox" checked={instantBackupOn} onchange={() => toggleInstantBackup()} />
            <span class="slider round" style="background: {instantBackupOn ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.12)'}; border-color: {instantBackupOn ? 'transparent' : 'rgba(255,255,255,0.18)'};"></span>
          </span>
          <span style="line-height: 1.25; min-width: 0;">
            <span style="display: block; font-size: 0.8rem; color: #e2e8f0; font-weight: 600;">Respaldar con cada guardado</span>
            <span style="display: block; font-size: 0.68rem; color: {instantBackupOn ? '#22c55e' : '#94a3b8'};">
              {instantBackupOn ? 'Se sube a Drive ~5 s después de guardar' : 'Desactivado: solo respaldos manuales'}
            </span>
          </span>
        </label>

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
                      <span>{fmtDate(file.modifiedTime || file.createdTime)} · {fmtSize(file.size)}</span>
                      {#if file.name.endsWith('_latest.db')}
                        <span style="padding: 1px 6px; border-radius: 999px; background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.25); color: #4ade80; font-size: 0.6rem; font-weight: 600;">⚡ se actualiza al guardar</span>
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
              <span>💾 Se conservan 2 respaldos: el que se actualiza al guardar y el snapshot más reciente.</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  </div>
</div>

<style>
  .cloud-page { max-width: 1000px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; }

  /* Layout de nube: UNA columna en desktop (2026-09). Con dos columnas las
     cards quedaban apretadas y había que hacer scroll horizontal dentro de
     cada panel; apiladas usan todo el ancho y respiran.
     En Android sigue siendo bloque con pestañas. */
  .cloud-cols {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
    align-items: start;
  }
  .cloud-cols.mobile {
    display: block;
    width: 100%;
  }
  .cloud-tabs {
    display: none;
  }
  .cloud-page > .cloud-tabs {
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .cloud-tabs button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0.6rem 1rem;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 600;
    transition: all 0.2s ease;
  }
  .cloud-tabs button.active {
    color: #f1f5f9;
    background: rgba(246,130,31,0.12);
    border-color: rgba(246,130,31,0.35);
  }
  .cloud-card { background: var(--card-bg); border-radius: 20px; border: 1px solid var(--card-border); overflow: hidden; }
  .cloud-card-header { padding: 1.25rem 1.5rem 0; }
  .cloud-card-header h3 { margin: 0; color: var(--text-primary); font-size: 1.1rem; font-weight: 700; }
</style>
