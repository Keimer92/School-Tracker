/**
 * Qué navegador usar para el login de Google.
 *
 * POR QUO EXISTE ESTO: Windows decide qué navegador abrir leyendo la
 * asociación `http`/`https` del usuario, que se guarda en
 * `HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice`.
 * Edge se auto-registra al instalarse y en Windows 11 es el predeterminado de
 * fábrica, así que esa asociación muchas veces sigue apuntando a `MSEdgeHTM`
 * aunque la persona use Firefox todos los días. La app abre el navegador con
 * `ShellExecuteExW` (plugin `opener`), que hace bien su trabajo: lo que pide
 * Edge es Windows, no la app.
 *
 * Por eso además de "el del sistema" se puede elegir uno a mano: en ese caso la
 * app arranca el ejecutable del navegador directamente y no depende de esa
 * asociación. Si el elegido no está instalado, se cae al del sistema — elegir
 * un navegador nunca puede dejar al usuario sin poder iniciar sesión.
 */

const CLAVE = 'stp_navegador_login';

export type NavegadorLogin = 'default' | 'firefox' | 'chrome' | 'edge' | 'brave';

export interface OpcionNavegador {
  id: NavegadorLogin;
  label: string;
}

/** Opciones para el selector de Ajustes. El orden es el más usado primero. */
export const OPCIONES_NAVEGADOR: OpcionNavegador[] = [
  { id: 'default', label: 'Predeterminado del sistema' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'chrome', label: 'Google Chrome' },
  { id: 'edge', label: 'Microsoft Edge' },
  { id: 'brave', label: 'Brave' },
];

function esValido(v: string | null): v is NavegadorLogin {
  return !!v && OPCIONES_NAVEGADOR.some((o) => o.id === v);
}

/** Navegador configurado, o `'default'` si nunca se tocó la opción. */
export function getNavegadorLogin(): NavegadorLogin {
  try {
    const v = localStorage.getItem(CLAVE);
    return esValido(v) ? v : 'default';
  } catch {
    return 'default';
  }
}

export function setNavegadorLogin(v: NavegadorLogin) {
  try {
    localStorage.setItem(CLAVE, v);
  } catch (e) {
    console.warn('[OAuthBrowser] no se pudo guardar la preferencia:', e);
  }
}

/**
 * Argumento extra para `invoke('gd_open_auth_webview', …)`.
 *
 * Se devuelve `undefined` para el predeterminado del sistema: el comando Rust
 * trata `undefined`, `null`, `''` y `'default'` igual, así que el call site no
 * necesita cambios.
 */
export function navegadorLoginArg(): string | undefined {
  const v = getNavegadorLogin();
  return v === 'default' ? undefined : v;
}