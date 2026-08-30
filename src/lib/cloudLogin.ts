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
  | { status: 'error'; error: string };

/** Decode exp (ms) de un id_token sin verificar firma (solo para refresh). */
function idTokenExpMs(idToken: string): number {
  try {
    const p = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (p.exp || 0) * 1000;
  } catch { return 0; }
}

/** Guarda la sesión de Google Drive en localStorage (misma cuenta que la nube). */
function guardarSesionDrive(clientId: string, tokenData: any): void {
  fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  }).then((r) => (r.ok ? r.json() : {})).then((userInfo: any) => {
    localStorage.setItem('schooltracker-google-drive-settings', JSON.stringify({
      clientId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry: Date.now() + ((tokenData.expires_in || 3600) * 1000),
      googleUserEmail: userInfo.email || null,
      googleUserName: userInfo.name || null,
      googleUserProfilePic: userInfo.picture || null,
    }));
  }).catch((e) => console.error('[Drive] userinfo:', e));
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
      guardarSesionDrive(clientId, tokenData);
      // El refresh_token NO expira: permite renovar el id_token sin re-login.
      guardarTokenSesion(idToken, tokenData.refresh_token);
    }

    opts?.onStatus?.('Ingresando a la nube...');
    const result = await authWithGoogleIdToken(idToken);
    guardarTokenSesion(idToken, getRefreshToken());
    opts?.onStatus?.(result.creado ? 'Cuenta creada. Preparando tu nube...' : 'Bienvenido de nuevo...');

    const email = (result.perfil?.email || '').toLowerCase();
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
          guardarSesionDrive(clientId, tokens);
          guardarTokenSesion(idToken, tokens.refresh_token);
          accessToken = tokens.access_token || null;
          refreshToken = tokens.refresh_token || null;
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
