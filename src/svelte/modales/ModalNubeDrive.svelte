<script lang="ts">
  /**
   * ModalNubeDrive — Google Drive panel (backup).
   *
   * Replaces the Drive card that lived inside CloudPage and opens with
   * `openCloudPanel('drive')`. It is mounted once in App.svelte, so the sidebar,
   * the Android header or any future page can open it without duplicating the
   * Drive session state.
   *
   * What changed vs the card: "ver details" was a popover because the page had
   * no room; here the latest-backup summary is always visible (moment, size and
   * file), which is what users actually look at.
   */
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { emit, listen } from '@tauri-apps/api/event';
  import { ask } from '@tauri-apps/plugin-dialog';
  import {
    driveSyncService,
    type DriveFile,
    getDriveAccessToken,
    isDriveSettingsLive,
    notifyDriveSessionChanged,
    subscribeDriveSession,
  } from '../../lib/driveSyncService';
  import { isInstantBackupEnabled, setInstantBackupEnabled } from '../../lib/driveInstantBackup';
  import { syncManager, type SyncStatus } from '../../lib/syncService';
  import { navegadorLoginArg } from '../../lib/oauthBrowser';
  import { setBackAuthInProgress } from '../../lib/androidBack';
  import { isCloudPanelOpen, closeCloudPanel } from '../../lib/cloudPanels.svelte';
  import { t, tagLocale } from '../../lib/i18n.svelte';
  import ModalBase from './ModalBase.svelte';

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

  let syncStatus = $state({
    status: 'idle' as SyncStatus,
    lastSync: null as string | null,
    lastSyncDetails: null as string | null,
    message: null as string | null,
    downloadProgress: null as { loaded: number; total: number; pct: number } | null,
    uploadProgress: null as { loaded: number; total: number; pct: number } | null,
    lastUpload: null as string | null,
    lastUploadBytes: null as number | null,
    lastUploadFile: null as { when: string | null; bytes: number | null; name: string | null } | null,
  });

  let isFetchingFiles = $state(false);
  let isAuthLoading = $state(false);
  let isTesting = $state(false);
  let syncFiles: DriveFile[] = $state([]);
  let instantBackupOn = $state(isInstantBackupEnabled());
  let imgError = $state(false);
  let authHandled = false;

  /**
 * ¿La sesión está REALMENTE viva?
 *
 * Dos cosas se corrigieron acá:
 *
 * 1. Antes era `!!settings.accessToken`, que solo miraba que el string no
 *    estuviera vacío. Ese string sobrevive una hora después de expirar, así que
 *    el modal decía "conectado" mientras la API devolvía 401 en cada llamada.
 * 2. Después pasó a `isDriveSessionLive()`, que lee `localStorage` de forma
 *    imperativa. Un `$derived` así NO se recalcula nunca (el storage no es
 *    dependencia reactiva): quedaba clavado en el valor inicial y el modal nunca
 *    cambiaba del formulario al panel de "ya conectado", aunque el login
 *    hubiera funcionado.
 *
 * Por eso usa la versión PURA y le pasa el `$state` de `settings`: con eso la
 * dependencia es reactiva y el derivado se recalcula al guardar la sesión.
 */
const isConnected = $derived(isDriveSettingsLive(settings));
  const isAndroid = /Android/i.test(navigator.userAgent);

  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function fmtSize(bytes: number): string {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  function fmtDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(tagLocale());
  }
  function fmtMomento(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    const hora = d.toLocaleTimeString(tagLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return mismoDia ? `${t('cloud.hoy')} ${hora}` : d.toLocaleString(tagLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function mensajeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Latest backup moment: the one confirmed in the cloud if present, else the local one. */
  let driveUltimoRespaldo = $derived.by(() => {
    const f = syncStatus.lastUploadFile;
    if (f?.when) return { when: f.when, bytes: f.bytes, name: f.name };
    return { when: syncStatus.lastUpload ?? null, bytes: syncStatus.lastUploadBytes ?? null, name: null };
  });

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
    // Avisa al resto de la app (card del sidebar, chips, barra superior) de que
    // la sesión cambió. `driveSyncService` dispara el mismo evento en SUS
    // escrituras, pero este modal escribe por su cuenta al iniciar sesión: sin
    // esto, el login desde acá no se reflejaba en ningún otro lugar hasta que
    // el servicio tocara el storage.
    notifyDriveSessionChanged();
  }

  /**
   * Token de acceso para las llamadas de ESTE modal.
   *
   * Antes este archivo tenía su propia copia de `refreshAccessToken` y
   * `getValidToken`, y la política era la OPUESTA a la de `driveSyncService`:
   *
   *   · ante CUALQUIER respuesta no-OK (incluidas 429/5xx) vaciaba el token, así
   *     que un error pasajero de Google cerraba la sesión y obligaba a un
   *     re-login sin motivo;
   *   · ante un fallo de red (el caso típico en Android cuando la app queda en
   *     segundo plano y el WebView se suspende) NO vaciaba nada, dejando un
   *     `accessToken` vencido y lleno: la UI seguía diciendo "conectado" y cada
   *     llamada a la API devolvía 401. De ahí el "se desconectó solo pero marca
   *     conectado y el modal no responde".
   *
   * Ahora no hay lógica duplicada: se delega en `driveSyncService`, que ya
   * distingue transitorio de definitivo, y se guarda el `motivo` para poder
   * explicarle al usuario qué pasó en vez de dejar el modal mudo.
   */
  async function getValidToken(): Promise<string | null> {
    const r = await getDriveAccessToken();
    if (r.token) {
      sesionFallida = '';
    } else {
      // `motivo` es `'ok'` cuando hay token, así que acá ya se sabe que no:
      // el narrowing explícito evita tener que correr un `''` de más.
      sesionFallida = r.motivo === 'ok' ? 'transitorio' : r.motivo;
      reloadSettings();
    }
    return r.token;
  }

  /**
   * Motivo del último fallo de sesión, para el aviso. Vacío = todo bien.
   * `transitorio` NO es "desconectado": la sesión sigue viva y conviene reintentar.
   */
  let sesionFallida = $state<'' | 'transitorio' | 'revocada' | 'sin-refresh'>('');

  /** Vuelve a leer `localStorage`: el estado local pudo quedar viejo. */
  function reloadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) settings = { ...settings, ...JSON.parse(raw) };
    } catch {}
  }

  async function initGoogleAuth(forceSelectAccount: boolean = false) {
    if (!settings.clientId) { await emit('show-toast', { message: t('cloud.noClientId'), type: 'error' }); return; }
    /**
     * `authHandled` se resetea al EMPEZAR cada intento.
     *
     * Antes quedaba en `true` para siempre después del primer login exitoso
     * (se ponía en las líneas del intercambio de código y no lo bajaba nadie).
     * Como el modal está montado una sola vez en `App.svelte`, el SEGUNDO intento
     * moría en el acto:
     *
     *   1. `gd_take_last_native_result` devuelve el resultado
     *   2. `handleGoogleNativeResult` → línea `if (authHandled) return;`
     *   3. sale SIN limpiar `isAuthLoading` y SIN avisar nada
     *   4. el polling ve `authHandled` y sale por el `break`
     *   5. el aviso de timeout no se dispara, porque dice `&& !authHandled`
     *
     * Resultado: el botón queda en "Conectando" para siempre, sin error. Es el
     * mismo auto-bloqueo que ya se había corregido una vez en este archivo
     * (ver AGENTS.md → GOTCHAS del sign-in nativo), regresó por la misma causa:
     * la flag se sube antes de terminar y nunca se baja.
     */
    authHandled = false;
    isAuthLoading = true;
    if (isAndroid) {
      // Native account picker: the app never loses the foreground, which avoids
      // Android freezing the process and killing the TCP server / deep link.
      try {
        await invoke('gd_start_native_signin', { serverClientId: settings.clientId });
      } catch (e) {
        console.error('Native Google Auth failed:', e);
        await emit('show-toast', { message: t('cloud.error.selectorGoogle', { e: String(e) }), type: 'error' });
        isAuthLoading = false;
        return;
      }
      // Fallback polling: if a WebView reload dropped the event, the result is still
      // sitting in MainActivity.
      const deadline = Date.now() + 180000;
      let gotResult = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const res = await invoke<string | null>('gd_take_last_native_result');
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
        await emit('show-toast', { message: t('cloud.error.timeoutSelector'), type: 'error' });
      }
      return;
    }
    setBackAuthInProgress(true);
    try {
      const port = 51733;
      const redirectUri = `${isAndroid ? 'http://127.0.0.1' : 'http://localhost'}:${port}/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=${forceSelectAccount ? 'select_account' : 'consent'}`;
      const code = await invoke<string>('gd_open_auth_webview', { url: authUrl, browser: navegadorLoginArg() });
      if (code && !authHandled) {
        authHandled = true;
        await exchangeCode(code, redirectUri);
      }
    } catch (e) {
      if (!authHandled) {
        console.error('Google Auth failed:', e);
        await emit('show-toast', { message: t('cloud.error.autenticar', { e: String(e) }), type: 'error' });
      }
    } finally { isAuthLoading = false; setBackAuthInProgress(false); }
  }

  // Result of the native Google picker: MainActivity emits a CustomEvent on
  // window and, when the global exists, a Tauri event with the same name.
  function handleGoogleNativeResult(detail: unknown) {
    let res: any = detail;
    if (typeof res === 'string') {
      try { res = JSON.parse(res); } catch { return; }
    }
    if (!res) return;
    if (!res.ok) {
      if (!authHandled && !res.cancelled) {
        emit('show-toast', { message: `❌ Error de Google Sign-In (${res.statusCode ?? '?'}): ${res.error ?? ''}`, type: 'error' });
      }
      isAuthLoading = false;
      return;
    }
    if (authHandled) return;
    if (!res.serverAuthCode) {
      isAuthLoading = false;
      emit('show-toast', { message: '❌ Google no devolvió código de autorización', type: 'error' });
      return;
    }
    authHandled = true;
    exchangeCode(res.serverAuthCode, '');
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
      await emit('show-toast', { message: t('cloud.toast.vinculado'), type: 'success' });
      await refreshFiles();
    } catch (e) {
      console.error('Token exchange failed:', e);
      await emit('show-toast', { message: t('cloud.error.vincular'), type: 'error' });
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
        await emit('show-toast', { message: t('cloud.toast.conexionOk'), type: 'success' });
        const token = await getValidToken();
        if (token) await fetchUserInfo(token);
      } else {
        await emit('show-toast', { message: t('cloud.error.conexion', { e: result.error || t('cloud.desconocido') }), type: 'error' });
      }
    } catch (e) {
      await emit('show-toast', { message: t('cloud.error.generico', { e: String(e) }), type: 'error' });
    } finally { isTesting = false; }
  }

  async function cancelAuth() {
    setBackAuthInProgress(false);
    try { await invoke('gd_cancel_oauth'); } catch {}
    isAuthLoading = false;
    await emit('show-toast', { message: t('cloud.toast.cancelada'), type: 'info' });
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
    await emit('show-toast', { message: t('cloud.toast.desconectado'), type: 'success' });
  }

  async function refreshFiles() {
    isFetchingFiles = true;
    try {
      const token = await getValidToken();
      if (token) {
        syncFiles = await driveSyncService.listSyncFiles(token);
        // The list comes sorted by most recent (modifiedTime): the first entry is the
        // real last backup in the cloud. It is mirrored into the global state so
        // the sidebar card and chips can show moment + size.
        driveSyncService.setLastUploadFromDrive(syncFiles[0] ?? null);
      } else {
        /**
         * Antes no había `else`: sin token la lista quedaba vacía y el modal
         * parecía muerto, sin error ni spinner. Ahora se distingue el motivo,
         * porque no es lo mismo perder la sesión que no tener red:
         *
         *  · `transitorio` → la sesión sigue viva, solo faltó red. Decir
         *    "desconectado" haría rehacer un login que no hace falta.
         *  · `revocada` / `sin-refresh` → hay que volver a iniciar sesión.
         */
        syncFiles = [];
        sesionFallida = sesionFallida || 'transitorio';
      }
    } catch (e) {
      await emit('show-toast', { message: t('cloud.error.refrescar', { e: mensajeError(e) }), type: 'error' });
    } finally { isFetchingFiles = false; }
  }

  /** Toggles the instant Drive backup after every save. */
  async function toggleInstantBackup() {
    const next = !instantBackupOn;
    instantBackupOn = next;
    setInstantBackupEnabled(next);
    await emit('show-toast', {
      message: next ? t('cloud.toast.instantOn') : t('cloud.toast.instantOff'),
      type: next ? 'success' : 'info',
    });
  }

  /** Native system confirmation (Tauri ask). Runs `action` only when accepted. */
  async function confirm(msg: string, title: string, action: () => Promise<void>) {
    const ok = await ask(msg, { title, kind: 'warning', okLabel: t('comun.confirmar'), cancelLabel: t('comun.cancelar') });
    if (ok) await action();
  }

  async function requestRestore(file: DriveFile) {
    confirm(t('cloud.ask.restaurarMensaje', { name: file.name }), t('cloud.ask.restaurarTitulo'), async () => {
      try {
        await driveSyncService.pullById(file.id);
        await emit('show-toast', { message: t('cloud.toast.restaurado'), type: 'success' });
      } catch (e) {
        await emit('show-toast', { message: t('cloud.error.restaurar', { e: mensajeError(e) }), type: 'error' });
      }
    });
  }

  async function requestDelete(file: DriveFile) {
    confirm(t('cloud.ask.eliminarMensaje', { name: file.name }), t('cloud.ask.eliminarTitulo'), async () => {
      const token = await getValidToken();
      if (!token) return;
      await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      syncFiles = syncFiles.filter(f => f.id !== file.id);
      await emit('show-toast', { message: t('cloud.toast.eliminado'), type: 'success' });
    });
  }

  async function crearRespaldo() {
    try {
      await driveSyncService.pushAll();
      await refreshFiles();
    } catch (e) {
      await emit('show-toast', { message: t('cloud.error.crearRespaldo', { e: mensajeError(e) }), type: 'error' });
    }
  }

  /**
   * The Drive list is re-read when the modal opens: it can sit on screen for
   * minutes and the listing goes stale (and the local "last upload" time may not
   * match the real last backup in the cloud).
   */
  let cargoAlAbrir = false;
  $effect(() => {
    if (!abierto) { cargoAlAbrir = false; return; }
    if (cargoAlAbrir || !isConnected) return;
    cargoAlAbrir = true;
    void refreshFiles();
  });

  /**
   * El token se renueva SOLO desde `driveSyncService` (respaldos, sync, refresh
   * del propio modal). Como esas escrituras ocurren en otro módulo, este `$state`
   * se quedaba viejo: había que volver a leer `localStorage` para enterarse.
   * Sin esto, el modal seguía mostrando "conectado" con un token vencido mucho
   * después de que el servicio lo hubiera renovado.
   */
  $effect(() => subscribeDriveSession(() => {
    reloadSettings();
    // `settings` se acaba de reasignar en `reloadSettings`, así que `isConnected`
    // ya es `true` si hay sesión viva y la lista se puede recargar sola.
    if (abierto && isConnected) { cargoAlAbrir = false; }
  }));

  onMount(() => {
    const unsub = syncManager.subscribe((state) => { syncStatus = state; });
    loadSettings();
    // Recovers a half-finished login: if the WebView reloaded during the OAuth
    // flow the code is still stored in Rust, so it can be resumed as-is.
    void (async () => {
      if (!settings.accessToken && !isAuthLoading) {
        try {
          const hasCode = await invoke<boolean>('gd_has_pending_oauth_code');
          if (hasCode) {
            isAuthLoading = true;
            setBackAuthInProgress(true);
            const code = await invoke<string>('gd_wait_oauth_code', { timeoutSecs: 10 });
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

    if (!isAndroid) return unsub;
    // Android deep link: MainActivity emits 'oauth-callback-android' as a
    // CustomEvent on window and, when the global exists, via Tauri event.emit.
    const handleNativeAuthCode = (code: string) => {
      if (!code || authHandled) return;
      authHandled = true;
      invoke('gd_cancel_oauth').catch(() => {});
      exchangeCode(code, 'http://127.0.0.1:51733/callback');
    };
    const nativeHandler = (e: Event) => handleNativeAuthCode((e as CustomEvent<string>).detail ?? '');
    const googleResultHandler = (e: Event) => handleGoogleNativeResult((e as CustomEvent<unknown>).detail);
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    listen<string>('oauth-callback-android', (event) => handleNativeAuthCode(event.payload)).then((u) => { unsub1 = u; }).catch(() => {});
    listen<unknown>('google-native-auth-result', (event) => handleGoogleNativeResult(event.payload)).then((u) => { unsub2 = u; }).catch(() => {});
    window.addEventListener('oauth-callback-android', nativeHandler);
    window.addEventListener('google-native-auth-result', googleResultHandler);
    return () => {
      unsub();
      window.removeEventListener('oauth-callback-android', nativeHandler);
      window.removeEventListener('google-native-auth-result', googleResultHandler);
      unsub1?.();
      unsub2?.();
    };
  });

  const abierto = $derived(isCloudPanelOpen('drive'));
</script>

<ModalBase
  {abierto}
  titulo={t('cloud.driveTitulo')}
  subtitulo={t('cloud.driveSubtitulo')}
  ancho="100%"
  anchoMaximo="1100px"
  ajustarAltura
  onCerrar={closeCloudPanel}
>
  {#if syncStatus.status === 'error' && syncStatus.message}
    <div class="alerta">
      <div class="alerta-titulo">⚠️ {t('cloud.errorSync.titulo')}</div>
      <div>{syncStatus.message}</div>
    </div>
  {/if}

  <!--
    Aviso de sesión caída o temporalmente inalcanzable.

    Sin esto el modal quedaba mudo: la lista salía vacía sin explicación, con
    el mismo aspecto que "no tenés respaldos". Y el caso de red, que en Android
    pasa cada vez que la app vuelve del segundo plano, NO es una sesión perdida:
    decirlo como tal empujaba a un re-login innecesario.
  -->
  {#if sesionFallida === 'transitorio'}
    <div class="alerta alerta-info">
      <div class="alerta-titulo">📡 {t('cloud.sesion.transitoria')}</div>
    </div>
  {:else if sesionFallida === 'revocada' || sesionFallida === 'sin-refresh'}
    <div class="alerta">
      <div class="alerta-titulo">⚠️ {t('cloud.sesion.revocada')}</div>
    </div>
  {/if}

  {#if !isConnected}
    <div class="vacio">
      <div class="vacio-ico">☁️</div>
      <p class="vacio-txt">{t('cloud.driveDesc')}</p>
      {#if settings.clientId}
        {#if isAuthLoading}
          <div class="conectando">
            <div class="btn-google cargando">{t('cloud.conectando')}</div>
            {#if !isAndroid}
              <!-- On desktop the login happens in the SYSTEM BROWSER, not in an app window:
                   the embedded WebView is unreliable with Google and does not
                   share its session. Here we only wait for the code returned by
                   the local TCP server. Without this notice users think the app
                   froze. -->
              <p class="espera-navegador">{t('cloud.esperaNavegador')}</p>
            {/if}
            <button class="btn-cancelar" onclick={cancelAuth} type="button">{t('comun.cancelar')}</button>
          </div>
        {:else}
          <button class="btn-google" onclick={() => initGoogleAuth()} type="button">{t('cloud.vincular')}</button>
        {/if}
      {:else}
        <div class="sin-clientid">{t('cloud.noClientId')}</div>
      {/if}
    </div>
  {:else}
    <!-- Signed-in user -->
    <div class="usuario">
      {#if settings.googleUserProfilePic && !imgError}
        <img src={settings.googleUserProfilePic} alt="" class="usuario-foto" referrerpolicy="no-referrer" onerror={() => imgError = true} />
      {:else}
        <div class="usuario-foto fallback">{settings.googleUserName?.charAt(0) || 'G'}</div>
      {/if}
      <div class="usuario-datos">
        <div class="usuario-nombre">{settings.googleUserName || t('cloud.userDefault')}</div>
        <div class="usuario-email">{settings.googleUserEmail || ''}</div>
      </div>
      <div class="usuario-acciones">
        <button class="btn-chico" onclick={testConnection} disabled={isTesting} type="button">{isTesting ? '...' : t('cloud.probar')}</button>
        <button class="btn-chico peligro" onclick={disconnect} type="button">{t('cloud.desconectar')}</button>
      </div>
    </div>

    {#if syncStatus.message}
      <div class="aviso" style={syncStatus.status === 'error' ? 'border-left-color:#ef4444;color:#fca5a5;' : ''}>
        {syncStatus.message}
      </div>
    {/if}

    {#if syncStatus.downloadProgress && syncStatus.downloadProgress.pct < 100}
      <div class="descarga">
        <div class="barra"><div class="barra-fill" style="width:{syncStatus.downloadProgress.pct}%;"></div></div>
        <div class="descarga-txt">
          <span>{t('cloud.descargando')}</span>
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

    <!-- Latest backup summary: it used to be a popover because the page had no
         room; inside the modal it is always visible. -->
    <div class="resumen">
      <div class="resumen-head">
        <span class="resumen-titulo">{t('cloud.ultimoRespaldo')}</span>
        <button class="btn-refrescar" onclick={refreshFiles} disabled={isFetchingFiles} type="button">
          {isFetchingFiles ? t('cloud.cargando') : t('cloud.btn.refrescar')}
        </button>
      </div>
      <div class="resumen-grid">
        <div class="resumen-celda">
          <div class="resumen-label">{t('cloud.momento')}</div>
          <div class="resumen-valor">{fmtMomento(driveUltimoRespaldo.when)}</div>
        </div>
        <div class="resumen-celda">
          <div class="resumen-label">{t('cloud.enviado')}</div>
          <div class="resumen-valor">{driveUltimoRespaldo.bytes ? fmtBytes(driveUltimoRespaldo.bytes) : '—'}</div>
        </div>
        <div class="resumen-celda ancho">
          <div class="resumen-label">{t('cloud.archivo')}</div>
          <div class="resumen-valor nombre" title={driveUltimoRespaldo.name || ''}>{driveUltimoRespaldo.name || '—'}</div>
        </div>
      </div>
      {#if syncStatus.uploadProgress}
        {@const up = syncStatus.uploadProgress}
        <div class="subida">
          <div class="subida-txt">
            <span>{t('cloud.subiendo')}</span>
            <span class="mono">{fmtBytes(up.loaded)} / {fmtBytes(up.total)} · {up.pct}%</span>
          </div>
          <div class="barra"><div class="barra-fill drive" style="width:{up.pct}%;"></div></div>
        </div>
      {/if}
      <p class="resumen-nota">{t('cloud.latestInfo')}</p>
    </div>

    <!-- Create backup -->
    <button
      class="btn-respaldo"
      onclick={crearRespaldo}
      disabled={syncStatus.status === 'syncing'}
      title={t('cloud.btn.crearTitle')}
      type="button"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span>{t('cloud.btn.crear')}</span>
    </button>

    <!-- Instant backup after every save.
     It stays a <label>, NOT a <button>: nesting a checkbox inside a button is
     invalid HTML and the input stops responding, so the toggle would look fine
     and do nothing. The label is what forwards the tap to the checkbox. -->
    <label class="instant" title={t('cloud.instantTitle')}>
      <span class="switch" style="margin:0;flex-shrink:0;">
        <input type="checkbox" checked={instantBackupOn} onchange={toggleInstantBackup} />
        <span class="slider round" style={instantBackupOn ? 'background: linear-gradient(135deg, #22c55e, #16a34a); border-color: transparent;' : 'background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.18);'}></span>
      </span>
      <span class="instant-txt">
        <span class="instant-label">{t('cloud.instantLabel')}</span>
        <span class="instant-desc" style={instantBackupOn ? 'color:#22c55e;' : ''}>
          {instantBackupOn ? t('cloud.instantOnDesc') : t('cloud.instantOffDesc')}
        </span>
      </span>
    </label>

    <!-- Backup list -->
    <div class="lista">
      <div class="lista-head">
        <h5>{t('cloud.respaldosTitulo')} {syncFiles.length > 0 ? `(${syncFiles.length})` : ''}</h5>
      </div>
      {#if syncFiles.length === 0}
        <div class="lista-vacia">{t('cloud.sinRespaldos')}</div>
      {:else}
        {#each syncFiles as file (file.id)}
          <div class="fila-archivo">
            <div class="fila-datos">
              <div class="fila-nombre">{file.name}</div>
              <div class="fila-meta">
                <span>{fmtDate(file.modifiedTime || file.createdTime)} · {fmtSize(file.size)}</span>
                {#if file.name.endsWith('_latest.db')}
                  <!--
                    Indicador INLINE, no un badge. Antes era una píldora con
                    "se actualiza al guardar" al lado de la fecha: en un teléfono
                    el texto no entraba, saltaba de línea y empujaba los botones
                    "Restaurar" fuera de la fila.

                    Ahora es el rayo + una palabra, y a 380px solo queda el rayo
                    (el significado ya está en la nota de abajo de la lista, y el
                    `title` lo dice al pasar/tocar). El texto largo sigue en
                    escritorio, donde hay ancho de sobra.
                  -->
                  <span class="chip-latest" title={t('cloud.chipLatest')}>
                    <span class="cl-rayo">⚡</span><span class="cl-txt">{t('cloud.chipLatestShort')}</span>
                  </span>
                {/if}
              </div>
            </div>
            <div class="fila-acciones">
              <button class="btn-chico" onclick={() => requestRestore(file)} type="button">{t('cloud.btn.restaurar')}</button>
              <button class="btn-chico peligro" onclick={() => requestDelete(file)} title={t('cloud.ask.eliminarTitulo')} type="button">🗑</button>
            </div>
          </div>
        {/each}
        <div class="lista-nota">{t('cloud.notaRespaldos')}</div>
      {/if}
    </div>
  {/if}
</ModalBase>

<style>
  .mono { font-family: monospace; }

  /* Aviso de sesión temporalmente inalcanzable: ámbar, no rojo. Rojo significa
     "tu sesión se perdió, hay que entrar de nuevo", y un hueco de red no es eso. */
  .alerta-info {
    border-color: rgba(251, 191, 36, 0.3);
    background: rgba(245, 158, 11, 0.12);
    color: #fde68a;
  }

  .alerta {
    margin-bottom: 1rem;
    padding: 0.9rem 1rem;
    border-radius: 12px;
    border: 1px solid rgba(248, 113, 113, 0.25);
    background: rgba(239, 68, 68, 0.12);
    color: #fecaca;
    font-size: 0.8rem;
    line-height: 1.45;
  }
  .alerta-titulo { font-weight: 700; margin-bottom: 0.25rem; }

  .aviso {
    margin-bottom: 1rem;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.75rem;
    border-left: 3px solid var(--primary-color);
    background: rgba(0, 0, 0, 0.2);
    color: var(--text-secondary);
  }

  .vacio { text-align: center; padding: 1rem 0.25rem 0.5rem; }
  .vacio-ico { font-size: 2.6rem; margin-bottom: 0.6rem; }
  .vacio-txt { color: #94a3b8; font-size: 0.85rem; margin: 0 0 1.25rem; line-height: 1.5; }

  .conectando {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .btn-google {
    padding: 0.8rem 2rem;
    background: linear-gradient(135deg, #4285F4, #34A853);
    border: none;
    color: white;
    border-radius: 12px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(66, 133, 244, 0.3);
  }
  .btn-google.cargando { opacity: 0.7; cursor: default; box-shadow: none; }
  .espera-navegador {
    color: #94a3b8;
    font-size: 0.8rem;
    max-width: 340px;
    margin: 0;
    text-align: center;
  }
  .btn-cancelar {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #f87171;
    padding: 0.45rem 1.25rem;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    transition: all 0.2s;
  }
  .sin-clientid {
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.2);
    border-radius: 8px;
    padding: 0.8rem;
    font-size: 0.8rem;
    color: #eab308;
    max-width: 400px;
    margin: 0 auto;
  }

  .usuario {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 0.9rem;
    background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%);
    border-radius: 14px;
    border: 1px solid rgba(var(--primary-rgb), 0.12);
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .usuario-foto {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .usuario-foto.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    color: white;
    background: var(--primary-color);
  }
  .usuario-datos { flex: 1; min-width: 140px; }
  .usuario-nombre { color: #f1f5f9; font-weight: 600; font-size: 0.85rem; }
  .usuario-email { color: #64748b; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; }
  .usuario-acciones { display: flex; gap: 6px; flex-shrink: 0; }

  .btn-chico {
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.68rem;
    font-weight: 600;
  }
  .btn-chico:disabled { opacity: 0.5; cursor: default; }
  .btn-chico.peligro {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }

  .descarga { margin-bottom: 1rem; }
  .descarga-txt {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 0.7rem;
    color: #64748b;
  }
  .barra {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .barra-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--primary-color, #3b82f6), #a78bfa);
    border-radius: 4px;
    transition: width 0.2s ease;
  }
  .barra-fill.drive { background: linear-gradient(90deg, #38bdf8, #818cf8); }

  .resumen {
    padding: 0.85rem 0.95rem;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.7), rgba(30, 41, 59, 0.6));
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    margin-bottom: 0.85rem;
  }
  .resumen-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.6rem;
  }
  .resumen-titulo {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
    color: #94a3b8;
  }
  .btn-refrescar {
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.68rem;
  }
  .btn-refrescar:disabled { opacity: 0.5; cursor: default; }

  .resumen-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.6rem;
  }
  .resumen-celda {
    padding: 0.5rem 0.6rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    min-width: 0;
  }
  .resumen-celda.ancho { grid-column: 1 / -1; }
  .resumen-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b; }
  .resumen-valor {
    font-size: 0.9rem;
    font-weight: 700;
    color: #e2e8f0;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .resumen-valor.nombre { font-size: 0.72rem; font-weight: 500; color: #94a3b8; }
  .resumen-nota { margin: 0.7rem 0 0; font-size: 0.66rem; color: #64748b; line-height: 1.45; }

  .subida { margin-top: 0.7rem; }
  .subida-txt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.68rem;
    color: #7dd3fc;
    margin-bottom: 0.3rem;
  }

  .btn-respaldo {
    width: 100%;
    padding: 0.85rem 1rem;
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.04) 100%);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 12px;
    cursor: pointer;
    opacity: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .btn-respaldo:disabled { opacity: 0.5; cursor: default; }
  .btn-respaldo span { color: #22c55e; font-weight: 600; font-size: 0.85rem; }

  .instant {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    padding: 0.6rem 0.75rem;
    margin: 0.75rem 0;
    background: rgba(34, 197, 94, 0.05);
    border: 1px solid rgba(34, 197, 94, 0.15);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .instant-txt { line-height: 1.25; min-width: 0; }
  .instant-label { display: block; font-size: 0.8rem; color: #e2e8f0; font-weight: 600; }
  .instant-desc { display: block; font-size: 0.68rem; color: #94a3b8; }

  .lista-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; }
  .lista-head h5 { margin: 0; color: #e2e8f0; font-size: 0.85rem; }
  .lista-vacia { text-align: center; padding: 1.25rem; color: #64748b; font-size: 0.8rem; }
  .fila-archivo {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    margin-bottom: 4px;
  }
  .fila-datos { flex: 1; min-width: 0; }
  .fila-nombre {
    color: #e2e8f0;
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fila-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #64748b;
    font-size: 0.65rem;
    /* `min-width: 0` + wrap: la fecha y el indicador pueden ocupar dos renglones
       sin desbordar la fila. Sin esto, en un teléfono el contenido se salía del
       `div` y los botones de la derecha quedaban desalineados. */
    flex-wrap: wrap;
    min-width: 0;
  }
  /* Indicador inline en vez de píldora: sin fondo ni borde se lee como una
     etiqueta más de la línea, no como un botón, y no compite con "Restaurar". */
  .chip-latest {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: #4ade80;
    font-size: 0.6rem;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .cl-rayo { font-size: 0.68rem; line-height: 1; }

  /* En pantallas angostas queda solo el rayo: es un símbolo, no un texto que
     haya que leer, y el `title` sigue dando la explicación completa. */
  @media (max-width: 380px) {
    .cl-txt { display: none; }
  }
  .fila-acciones { display: flex; gap: 4px; flex-shrink: 0; }
  .lista-nota {
    margin-top: 0.5rem;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #64748b;
    font-size: 0.7rem;
  }
</style>