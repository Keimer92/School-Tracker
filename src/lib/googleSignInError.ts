import { t } from "./i18n.svelte";

/**
 * Traduce el `statusCode` de Google Sign-In nativo a algo accionable.
 *
 * Existe en su propio módulo porque el mismo `statusCode` llega por DOS caminos:
 * el login del WelcomePage (`cloudLogin.iniciarSesionGoogleConNube`) y el del
 * modal de Drive (`ModalNubeDrive.handleGoogleNativeResult`). Antes estaba dentro
 * de `cloudLogin.ts` y el modal no lo usaba, así que ahí el error salía crudo.
 *
 * Antes devolvía `t('cl.error.signIn', {code, error})`, que para el caso que más
 * _importa_ —el 10— llegaba al usuario como un número suelto sin explicación
 * ("Google Sign-In (10):"). El 10 es `DEVELOPER_ERROR`: NO es un problema de red
 * ni de sesión, es que el cliente OAuth de Android no está registrado en Google
 * Cloud con el paquete + SHA-1 de esta app, y es justamente lo que documenta
 * AGENTS.md. Decirlo explícito evita que se persiga una red intermitente.
 *
 * El detalle técnico crudo se conserva igual en `errorMsgTecnico` del Welcome,
 * así que nada de información se pierde.
 */
export function explicarSignInNativo(statusCode: number | undefined, error: string | undefined): string {
  const codigo = statusCode ?? '?';
  const extra = error ? ` (${error})` : '';
  switch (codigo) {
    case 10:
      return t('cl.error.signIn.dev') + extra;
    case 12501:
      // Cancelación: llega por otra rama, pero se cubre por si cambia el mapeo.
      return t('cl.error.signIn.cancelado') + extra;
    case 4:
    case 16:
      return t('cl.error.signIn.playServices') + extra;
    default:
      return t('cl.error.signIn', { code: codigo, error: error ?? '' });
  }
}
