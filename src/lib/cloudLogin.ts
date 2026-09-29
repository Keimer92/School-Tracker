import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  authWithGoogleIdToken,
  guardarTokenSesion,
  getRefreshToken,
  DEFAULT_WORKER_URL,
  type AuthResult,
} from "./cloudAuth";
import { d1SyncService } from "./d1SyncService";
import { invalidateD1Cache, syncService } from "./syncService";
import { ensureWsSync, stopWsSync } from "./wsSyncService";
import { getProfile, saveProfile, setCurrentEmail } from "./accountProfiles";

export interface CloudLoginTokens {
  idToken: string;
  accessToken: string | null;
  refreshToken: string | null;
}

export type CloudLoginResult =
  | { status: 'ok'; result: AuthResult; schoolKey: string; tokens?: CloudLoginTokens }
  | { status: 'cancelled' }
  /** La cuenta se vinculó a Drive pero NO tiene acceso a esta nube D1 (403). */
  | { status: 'sin-nube'; motivo: string; email?: string; tokens?: CloudLoginTokens }
  | { status: 'error'; error: string };

/** Decode exp (ms) de un id_token sin verificar firma (solo para refresh). */
function idTokenExpMs(idToken: string): number {
  try {
    const p = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (p.exp || 0) * 1000;
  } catch { return 0; }
}

/** Guarda la sesión de Google Drive en localStorage (misma cuenta que la nube). */
async function guardarSesionDrive(clientId: string, tokenData: any): Promise<void> {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo: any = resp.ok ? await resp.json() : {};
    localStorage.setItem('schooltracker-google-drive-settings', JSON.stringify({
      clientId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry: Date.now() + ((tokenData.expires_in || 3600) * 1000),
      googleUserEmail: userInfo.email || null,
      googleUserName: userInfo.name || null,
      googleUserProfilePic: userInfo.picture || null,
    }));
  } catch (e) {
    console.error('[Drive] userinfo:', e);
    // Guardar tokens de todos modos aunque falle userinfo
    localStorage.setItem('schooltracker-google-drive-settings', JSON.stringify({
      clientId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry: Date.now() + ((tokenData.expires_in || 3600) * 1000),
    }));
  }
}

/** Intercambia un serverAuthCode (Android) por tokens completos (incluye refresh). */
async function exchangeServerAuthCode(code: string): Promise<any> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

/**
 * Flujo común tras obtener credenciales (por .key o por login Google):
 * guarda la config en d1_config (protección anti-mezcla) y sincroniza.
 */
async function conectarConCredenciales(workerUrl: string, schoolKey: string, opts?: { onStatus?: (msg: string) => void; skipSync?: boolean; preferredKey?: string }) {
  // Reflejar el progreso granular que emite el Rust (d1-sync-progress) en el
  // modal de carga, para que no parezca congelado durante el sync.
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<{ message?: string }>('d1-sync-progress', (e) => {
      if (e.payload?.message) opts?.onStatus?.(e.payload.message);
    });
  } catch { /* ignorable */ }
  const previa = await d1SyncService.getConfig();
  if (previa && (previa.workerUrl !== workerUrl || previa.schoolKey !== schoolKey)) {
    const ok = await ask(
      'Ya existe una conexión a la nube con OTRAS credenciales.\n\n¿Reemplazarla? Se generará un nuevo ID de dispositivo y los datos locales se sincronizarán con la nube nueva.',
      { title: 'Reemplazar conexión', kind: 'warning', okLabel: 'Sí, reemplazar', cancelLabel: 'Cancelar' }
    );
    if (!ok) { if (unlisten) unlisten(); return; }
    await d1SyncService.clearConfig();
  }
  await d1SyncService.saveConfig(workerUrl, schoolKey);
  invalidateD1Cache();
  stopWsSync();
  await ensureWsSync();
  syncService.ensurePeriodicSync();
  try { if (!opts?.skipSync) await invoke('d1_sync_all'); } catch (e) { console.error('[Cloud] primer sync falló:', e); }
  if (unlisten) unlisten();
}

/**
 * Email de la sesión de Drive ya guardada. Si `userinfo` falló al vincular
 * (típico en WebView Android), se decodifica el claim del id_token: solo sirve
 * para nombrar el archivo local de la cuenta, porque el acceso a Drive lo sigue
 * dando el token que emitió Google, no este string.
 */
function leerEmailSesionDrive(idToken: string): string {
  try {
    const s = JSON.parse(localStorage.getItem('schooltracker-google-drive-settings') || '{}');
    const guardado = (s?.googleUserEmail || '').toLowerCase();
    if (guardado) return guardado;
  } catch { /* ignorable */ }
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload?.email || '').toLowerCase();
  } catch { return ''; }
}

/**
 * Cierre del login cuando la cuenta NO tiene acceso a esta nube D1 (403 de
 * `/auth`). Deja lo mismo que un login exitoso salvo la config de nube:
 *  - remembers la cuenta con sus tokens, para no volver a loguearse;
 *  - abre el archivo de BD propio de esa cuenta;
 *  - NO guarda `schoolKey` ni `workerUrl`: sin ellos el sync D1 y el WebSocket
 *    quedan apagados solos (`ensureWsSync` sale temprano si falta la config).
 */
async function finalizarSoloDrive(
  clientId: string,
  idToken: string,
  accessToken: string | null,
  refreshToken: string | null,
  motivo: string,
) {
  const email = leerEmailSesionDrive(idToken);
  if (!email) {
    console.warn('[CloudLogin] sin email disponible; se omite el archivo por cuenta');
    return;
  }
  saveProfile({
    email,
    googleIdToken: idToken,
    googleAccessToken: accessToken,
    googleRefreshToken: refreshToken,
    googleIdExpiresAt: idTokenExpMs(idToken),
    googleDriveExpiresAt: Date.now() + (accessToken ? 3600 * 1000 : 0),
    googleClientId: clientId,
  });
  setCurrentEmail(email);
  try {
    const { driveAutoBackup } = await import('./driveAutoBackup');
    await driveAutoBackup.flushBeforeAccountSwap();
  } catch (e) { /* el cambio de cuenta no debe bloquearse por la nube */ }
  try {
    await invoke('open_account_db', { email, migrateFromDefault: true });
  } catch (e) {
    console.error('[CloudLogin] no se pudo abrir la BD de la cuenta:', e);
  }
  console.info('[CloudLogin] acceso a la nube denegado, usuario solo con Drive:', motivo);
}

/**
 * LOGIN/REGISTRO con Google para el sync Cloudflare + vinculación de Drive
 * con la MISMA cuenta. Reutilizable desde WelcomePage y CloudPage.
 *  - Android: selector nativo (idToken + serverAuthCode con scope drive.file).
 *  - Desktop: OAuth navegador con openid + drive.file (una sola consentición).
 */
export async function iniciarSesionGoogleConNube(opts?: {
  onStatus?: (msg: string) => void;
  setBackAuth?: (b: boolean) => void;
  forceSelectAccount?: boolean;
  skipSync?: boolean;
  preferredKey?: string;
}): Promise<CloudLoginResult> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    if (!clientId) return { status: 'error', error: 'Falta VITE_GOOGLE_CLIENT_ID en .env' };
  let driveAuthCode = '';
  try {
    let idToken = '';
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    if (/Android/i.test(navigator.userAgent)) {
      opts?.onStatus?.('Abriendo Google Sign-In...');
      await invoke('gd_start_native_signin', { serverClientId: clientId });
      const deadline = Date.now() + 180000;
      let done = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const res = await invoke<string | null>('gd_take_last_native_result');
          if (res) {
            const parsed: any = typeof res === 'string' ? JSON.parse(res) : res;
            if (!parsed.ok) {
              if (parsed.cancelled) return { status: 'cancelled' };
              return { status: 'error', error: `Google Sign-In (${parsed.statusCode ?? '?' }): ${parsed.error ?? ''}` };
            }
            idToken = parsed.idToken || '';
            driveAuthCode = parsed.serverAuthCode || '';
            done = true;
            break;
          }
        } catch (e: any) {
          if (e?.message?.includes('Sign-In')) return { status: 'error', error: e.message };
        }
      }
      if (!done || !idToken) return { status: 'error', error: 'No se obtuvo el token de Google' };
    } else {
      opts?.setBackAuth?.(true);
      const redirectUri = 'http://localhost:51733/callback';
      // forceSelectAccount: al cambiar de cuenta queremos el selector de cuenta
      // (select_account) PERO también forzar el consentimiento (consent) para que
      // Google muestre la pantalla de confirmación y emita un refresh_token nuevo
      // (necesario para Drive), en lugar de devolver el código "de golpe" y cerrar
      // el modal sin confirmación.
      const prompt = opts?.forceSelectAccount ? 'select_account consent' : 'consent';
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid email profile https://www.googleapis.com/auth/drive.file')}&access_type=offline&prompt=${encodeURIComponent(prompt)}`;
      opts?.onStatus?.('Esperando autenticación de Google...');
      const code = await invoke<string>('gd_open_auth_webview', { url: authUrl });
      opts?.setBackAuth?.(false);
      opts?.onStatus?.('Verificando identidad...');
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '', code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
      });
      if (!tokenRes.ok) return { status: 'error', error: 'Error intercambiando código: ' + (await tokenRes.text()) };
      const tokenData = await tokenRes.json();
      idToken = tokenData.id_token || '';
      accessToken = tokenData.access_token || null;
      refreshToken = tokenData.refresh_token || null;
      if (!idToken) return { status: 'error', error: 'Google no devolvió id_token' };
      await guardarSesionDrive(clientId, tokenData);
      // El refresh_token NO expira: permite renovar el id_token sin re-login.
      guardarTokenSesion(idToken, tokenData.refresh_token);
    }

    opts?.onStatus?.('Ingresando a la nube...');
    /**
     * El login de Drive ya quedó guardado ANTES de este punto (guardarSesionDrive
     * en ambas ramas). Por eso un 403 de `/auth` —la lista ALLOWED_EMAILS del
     * Worker no incluye a esta cuenta— no debe frenar el flujo: el usuario puede
     * seguir usando su propio Drive con normalidad, solo que sin nube D1. Es el
     * caso de los profesores que reciben la app y restauran desde Drive.
     *
     * Cualquier OTRO error (Worker caído, sin red) sí se propaga: ahí no sabemos
     * nada del estado y conviene no entrar a ciegas.
     */
    let result: AuthResult;
    try {
      result = await authWithGoogleIdToken(idToken);
    } catch (e: any) {
      const status = e?.status;
      const msg = String(e?.message || e || '');
      const noAutorizado = status === 403 || /no est[áa] autorizada/i.test(msg);
      if (!noAutorizado) throw e;
      console.warn('[CloudLogin] sin acceso a la nube; se continúa solo con Drive:', msg);
      guardarTokenSesion(idToken, getRefreshToken());
      await finalizarSoloDrive(clientId, idToken, accessToken, refreshToken, msg);
      return {
        status: 'sin-nube',
        motivo: msg,
        email: leerEmailSesionDrive(idToken),
        tokens: { idToken, accessToken, refreshToken },
      };
    }
    guardarTokenSesion(idToken, getRefreshToken());
    opts?.onStatus?.(result.creado ? 'Cuenta creada. Preparando tu nube...' : 'Bienvenido de nuevo...');

    const email = (result.perfil?.email || '').toLowerCase();
    /**
     * `guardarSesionDrive` deja el email fuera si falla el fetch a
     * `oauth2/v2/userinfo` (típico en WebView Android, donde esa llamada suele
     * morir por red). Sin `googleUserEmail`, `accountTag()` cae a 'default' y
     * `listSyncFiles` busca respaldos con el prefijo equivocado: el usuario
     * tiene su backup en Drive pero la app dice que no encuentra nada.
     *
     * El email ya está disponible acá (viene en el perfil que devolvió `/auth`),
     * así que se completa el registro sin depender de otra llamada de red.
     */
    if (email) {
      try {
        const key = 'schooltracker-google-drive-settings';
        const prev = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({
          ...prev,
          googleUserEmail: prev.googleUserEmail || email,
          // El Worker devuelve `perfil: { nombre, foto, email, rol }`.
          googleUserName: prev.googleUserName || result.perfil?.nombre || null,
          googleUserProfilePic: prev.googleUserProfilePic || result.perfil?.foto || null,
        }));
      } catch (e) {
        console.warn('[CloudLogin] no se pudo completar el perfil de Drive:', e);
      }
    }
    // Abrir el archivo de BD propio de esta cuenta ANTES de guardar la
    // configuración de nube, para no escribir la config de la cuenta nueva
    // en el archivo de la cuenta anterior (que sigue activo hasta este momento).
    if (email) {
      try {
        // Antes de cambiar el archivo de BD activo (que invalida la cuenta
        // saliente en local), subir cualquier cambio pendiente a Drive. Si
        // falla, logueamos y seguimos — el cambio de cuenta no debe bloquearse
        // por la nube.
        try {
          const { driveAutoBackup } = await import('./driveAutoBackup');
          await driveAutoBackup.flushBeforeAccountSwap();
        } catch (e) {
          console.warn('[CloudLogin] flush Drive antes del swap falló:', e);
        }
        await invoke('open_account_db', { email, migrateFromDefault: true });
        setCurrentEmail(email);
      } catch (e) {
        console.error('[CloudLogin] no se pudo abrir la BD de la cuenta:', e);
      }
    }
    const preferredKey = opts?.preferredKey;
    let effectiveKey = result.schoolKey;
    let effectiveWorker = DEFAULT_WORKER_URL;
    let known: any = null;
    let localCfg: any = null;
    if (email) {
      known = getProfile(email);
      localCfg = await d1SyncService.getConfig().catch(() => null);
      if (preferredKey) {
        // Importación explícita de .key/.db: esa clave es la fuente de verdad
        // (p. ej. restauración desde otro dispositivo). Se antepone a /auth.
        effectiveKey = preferredKey;
        if (localCfg?.workerUrl) effectiveWorker = localCfg.workerUrl;
      } else {
        // Login normal: el Worker KV (user:email -> schoolKey) es la ÚNICA
        // fuente de verdad. /auth persiste esa relación, así que usar
        // result.schoolKey garantiza la MISMA llave en cada reinicio y evita
        // caer en un namespace vacío por divergencia con el registro local o
        // d1_config. Luego se sobrescribe registro + d1_config con esta clave.
        effectiveKey = result.schoolKey;
        effectiveWorker = DEFAULT_WORKER_URL;
        // Si la config local diverge de la llave autoritativa del Worker,
        // limpiarla para adoptar la correcta sin disparar el prompt
        // "Reemplazar conexión" ni quedar en un namespace vacío.
        if (localCfg?.schoolKey && localCfg.schoolKey !== result.schoolKey) {
          try { await d1SyncService.clearConfig(); } catch {}
        }
      }
    }
    console.log(
      `[CloudLogin] effectiveKey=${effectiveKey} fromPreferred=${!!preferredKey} fromLocalCfg=${!!localCfg?.schoolKey} fromKnown=${!!known?.schoolKey} fromAuth=${!!result.schoolKey} creado=${result.creado} email=${email} skipSync=${!!opts?.skipSync}`
    );
    await conectarConCredenciales(effectiveWorker, effectiveKey, opts);
    // Registrar SIEMPRE el perfil (email → schoolKey) tras conectarse: así un
    // futuro "cambiar de usuario" reutiliza el schoolKey correcto aunque /auth
    // devuelva una escuela nueva y vacía (cuentas conectadas vía .key/.db).
    if (email) {
      saveProfile({
        email,
        schoolKey: effectiveKey,
        workerUrl: effectiveWorker,
        nombre: result.perfil?.nombre,
        foto: result.perfil?.foto,
        googleIdToken: idToken,
        googleAccessToken: accessToken,
        googleRefreshToken: refreshToken,
        googleIdExpiresAt: idTokenExpMs(idToken),
        googleDriveExpiresAt: Date.now() + (accessToken ? 3600 * 1000 : 0),
        googleClientId: clientId,
      });
      setCurrentEmail(email);
    }

    if (/Android/i.test(navigator.userAgent)) {
      if (driveAuthCode) {
        opts?.onStatus?.('Vinculando Google Drive...');
        try {
          const tokens = await exchangeServerAuthCode(driveAuthCode);
          await guardarSesionDrive(clientId, tokens);
          guardarTokenSesion(idToken, tokens.refresh_token);
          accessToken = tokens.access_token || null;
          refreshToken = tokens.refresh_token || null;
          // Re-guardar el perfil con los tokens de Drive actualizados
          if (email) {
            saveProfile({
              email,
              schoolKey: effectiveKey,
              workerUrl: effectiveWorker,
              nombre: result.perfil?.nombre,
              foto: result.perfil?.foto,
              googleIdToken: idToken,
              googleAccessToken: accessToken,
              googleRefreshToken: refreshToken,
              googleIdExpiresAt: idTokenExpMs(idToken),
              googleDriveExpiresAt: Date.now() + (accessToken ? 3600 * 1000 : 0),
              googleClientId: clientId,
            });
          }
        } catch (e) {
          console.error('[Drive] vinculación android falló:', e);
        }
      }
    } else {
      await emit("show-toast", { message: "☁️ Google Drive vinculado con la misma cuenta", type: "success" });
    }
    return { status: 'ok', result, schoolKey: result.schoolKey, tokens: { idToken, accessToken, refreshToken } };
  } catch (e: any) {
    const errStr = typeof e === 'string' ? e : (e?.message || String(e));
    if (errStr.toLowerCase().includes('cancel')) return { status: 'cancelled' };
    return { status: 'error', error: errStr };
  } finally {
    opts?.setBackAuth?.(false);
  }
}
