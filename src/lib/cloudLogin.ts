import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  authWithGoogleIdToken,
  guardarTokenSesion,
  DEFAULT_WORKER_URL,
  type AuthResult,
} from "./cloudAuth";
import { d1SyncService } from "./d1SyncService";
import { invalidateD1Cache, syncService } from "./syncService";
import { ensureWsSync, stopWsSync } from "./wsSyncService";

export type CloudLoginResult =
  | { status: 'ok'; result: AuthResult; schoolKey: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

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

async function vincularDriveAndroid(serverAuthCode: string) {
  try {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: serverAuthCode, grant_type: 'authorization_code' }),
    });
    if (!res.ok) throw new Error(await res.text());
    guardarSesionDrive(clientId, await res.json());
    await emit("show-toast", { message: "☁️ Google Drive vinculado con la misma cuenta", type: "success" });
  } catch (e) {
    console.error('[Drive] vinculación android falló:', e);
  }
}

/**
 * Flujo común tras obtener credenciales (por .key o por login Google):
 * guarda la config en d1_config (protección anti-mezcla) y sincroniza.
 */
async function conectarConCredenciales(workerUrl: string, schoolKey: string) {
  const previa = await d1SyncService.getConfig();
  if (previa && (previa.workerUrl !== workerUrl || previa.schoolKey !== schoolKey)) {
    const ok = await ask(
      'Ya existe una conexión a la nube con OTRAS credenciales.\n\n¿Reemplazarla? Se generará un nuevo ID de dispositivo y los datos locales se sincronizarán con la nube nueva.',
      { title: 'Reemplazar conexión', kind: 'warning', okLabel: 'Sí, reemplazar', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    await d1SyncService.clearConfig();
  }
  await d1SyncService.saveConfig(workerUrl, schoolKey);
  invalidateD1Cache();
  stopWsSync();
  await ensureWsSync();
  syncService.ensurePeriodicSync();
  try { await invoke('d1_sync_all'); } catch (e) { console.error('[Cloud] primer sync falló:', e); }
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
}): Promise<CloudLoginResult> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    if (!clientId) return { status: 'error', error: 'Falta VITE_GOOGLE_CLIENT_ID en .env' };
  let driveAuthCode = '';
  try {
    let idToken = '';
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
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid email profile https://www.googleapis.com/auth/drive.file')}&access_type=offline&prompt=consent`;
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
      if (!idToken) return { status: 'error', error: 'Google no devolvió id_token' };
      guardarSesionDrive(clientId, tokenData);
    }

    opts?.onStatus?.('Ingresando a la nube...');
    const result = await authWithGoogleIdToken(idToken);
    guardarTokenSesion(idToken);
    opts?.onStatus?.(result.creado ? 'Cuenta creada. Preparando tu nube...' : 'Bienvenido de nuevo...');
    await conectarConCredenciales(DEFAULT_WORKER_URL, result.schoolKey);

    if (/Android/i.test(navigator.userAgent)) {
      if (driveAuthCode) { opts?.onStatus?.('Vinculando Google Drive...'); await vincularDriveAndroid(driveAuthCode); }
    } else {
      await emit("show-toast", { message: "☁️ Google Drive vinculado con la misma cuenta", type: "success" });
    }
    return { status: 'ok', result, schoolKey: result.schoolKey };
  } catch (e: any) {
    const errStr = typeof e === 'string' ? e : (e?.message || String(e));
    if (errStr.toLowerCase().includes('cancel')) return { status: 'cancelled' };
    return { status: 'error', error: errStr };
  } finally {
    opts?.setBackAuth?.(false);
  }
}
