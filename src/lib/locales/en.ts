import type { Clave } from './es';

/**
 * Diccionario en inglés.
 *
 * El tipo `Record<Clave, string>` es la pieza clave de la infraestructura: si
 * se agrega una clave en `es.ts` y se olvida traducirla acá, el `tsc` del build
 * falla con "Property 'x' is missing". No hace falta ningún script de chequeo.
 *
 * ⚠️ No dejar valores en español "por ahora": es preferible un `[EN] ...`
 * visible a un texto en español que rompa el idioma en producción.
 */
export const en: Record<Clave, string> = {
  // ── Common ───────────────────────────────────────────────────────────────
  'comun.volver': 'Back',
  'comun.cancelar': 'Cancel',
  'comun.cerrar': 'Close',
  'comun.continuar': 'Continue',
  'comun.siguiente': 'Next',
  'comun.anterior': 'Previous',
  'comun.si': 'Yes',
  'comun.no': 'No',
  'comun.activo': 'Active',
  'comun.buscando': 'Searching…',
  'comun.cargando': 'Loading…',
  'comun.guardando': 'Saving…',

  // ── Language picker ──────────────────────────────────────────────────────
  'idioma.titulo': 'Language',
  'idioma.descripcion': 'Application language.',
  'idioma.es': 'Español',
  'idioma.en': 'English',

  // ── WelcomePage ──────────────────────────────────────────────────────────
  'welcome.appTitle': 'School Tracker',
  'welcome.subtitle': 'Choose how you want to start',
  'welcome.cardGoogle.title': 'Continue with Google',
  'welcome.cardGoogle.desc': 'Sign in with your account and recover the latest backup saved in Google Drive.',
  'welcome.cardGoogle.tag1': 'Google Drive',
  'welcome.cardGoogle.tag2': 'No code needed',
  'welcome.cardWizard.title': 'Start from scratch',
  'welcome.cardWizard.desc': 'Create a clean database and pick the grades and sections you will use.',
  'welcome.cardWizard.tag1': 'Preloaded catalog',
  'welcome.cardWizard.tag2': 'No cloud',
  'welcome.google.nueva': 'Looking for your latest Google Drive backup…',
  'welcome.google.entrando': 'Signing in to the cloud…',
  'welcome.google.verificando': 'Verifying your identity…',
  'welcome.google.navegador': 'Your browser opened: sign in with Google there…',
  'welcome.drive.buscando': 'Looking for Drive backups…',
  'welcome.drive.descargando': 'Downloading backup…',
  'welcome.drive.restaurando': 'Restoring backup…',
  'welcome.drive.restaurado': 'Backup restored',
  'welcome.drive.vacio': 'No backups in Google Drive',
  'welcome.drive.sinRespaldo':
    'This account has no Drive backups. Trying to recover your data from the cloud…',
  'welcome.drive.todosVacios': 'The Drive backups downloaded, but they all had an empty database.',
  'welcome.drive.error': 'Could not restore from Drive: {msg}',
  'welcome.drive.nuevaCuenta':
    'This Google account is new: it has no Drive backups and no data in the cloud. Let us set up your database from scratch.',
  'welcome.drive.antiguoTitulo': 'Restore an old backup',
  'welcome.drive.antiguoAviso':
    'The Drive backup is from {fecha}, older than the last cloud sync ({fechaNube}).\n\nIf you restore it, you may lose attendance or grades changed on the desktop after that date.',
  'welcome.drive.antiguoSi': 'Yes, restore it anyway',
  'welcome.drive.antiguoNo': 'Cancel',
  'welcome.drive.cancelado': 'Restore cancelled.',
  'welcome.drive.descartados': 'Discarded: {lista}',
  'welcome.nube.sincronizando': 'Syncing the backup with the cloud…',
  'welcome.nube.sinNube':
    'Your account has no access to this developer’s cloud. We will continue with your Google Drive.',
  'welcome.nube.error': 'Could not connect to the cloud: {msg}',
  'welcome.nube.reintentando': 'Retrying the download…',
  'welcome.nube.vaciaRespuesta':
    'Your cloud answered correctly but it is empty: no data is stored for this account. Let us set up your database from scratch.',
  'welcome.nube.quotaTitulo': '☁️⚠️ Cloudflare daily limit reached',
  'welcome.nube.quotaBody':
    'The free Cloudflare Workers plan has a daily cap of about 100,000 requests. If you hit the limit, the quota resets at 00:00 UTC (around {reinicio}). You can wait and retry, or configure it manually and sync tomorrow once the quota has reset.',
  'welcome.nube.sinDatosTitulo': '☁️ No data in the cloud for this account',
  'welcome.nube.sinDatosBody':
    'The server answered correctly but there is no synced data for your Google account in the cloud.\n\nThis can happen if this is the first time you connect this account, or if the data was previously deleted from the cloud.\n\nYou can retry the download, restore from Google Drive if you have a backup, or create a local database from scratch.',
  'welcome.nube.incompletosTitulo': '☁️ Incomplete data in the cloud',
  'welcome.nube.incompletosBody':
    'Some data was downloaded but the information is incomplete (base tables such as school year or schools are missing). This usually happens when the Cloudflare quota ran out halfway through the download.\n\nYou can retry to fetch the missing data, or create the local database from scratch.',
  'welcome.nube.noConectadoTitulo': 'Could not connect to the cloud',
  'welcome.nube.noConectadoBody': 'Check your internet connection and try again in a few minutes.',
  'welcome.nube.noConfigTitulo': 'Connection not configured',
  'welcome.nube.noConfigBody':
    'The cloud connection is not configured. Configure it manually or import a connection file (.key).',
  'welcome.nube.errorServidorTitulo': 'Server error',
  'welcome.nube.errorServidorBody':
    'The sync server returned an error. It may be a temporary problem: try again or configure the cloud manually.',
  'welcome.nube.errorTitulo': 'Could not connect to the cloud',
  'welcome.nube.errorBody':
    'An error occurred while talking to the server. Try again or configure it manually.',
  'welcome.inicializandoParcial': 'Starting the app with partial data…',
  'welcome.errorGenerico': 'Error: {msg}',
  'welcome.wizard.preparando': 'Preparing the initial setup…',
  'welcome.wizard.volver': '← Back to the options',
  'welcome.wizard.sinDatos': 'No previous data found. Let us set up your database from scratch.',
  'welcome.wizard.stepAnios': 'School years',
  'welcome.wizard.stepAsignaturas': 'Subjects',
  'welcome.wizard.stepGrados': 'Grades',
  'welcome.wizard.stepSecciones': 'Sections',
  'welcome.wizard.stepColegios': 'Schools',
  'welcome.wizard.stepResumen': 'Summary',
  'welcome.wizard.minimoElementos': 'You must add at least one item in each category.',
  'welcome.wizard.errorGuardando': 'Error saving data: {msg}',
  'welcome.wizard.volverBoton': '← Back',

  // ── Settings ─────────────────────────────────────────────────────────────
  'ajustes.titulo': 'Settings',
  'ajustes.tab.configuracion': 'General',
  'ajustes.tab.notificaciones': 'Attendance notif.',
  'ajustes.tab.debug': 'Debug',
  'ajustes.tab.info': 'About',
  'ajustes.tab.temaClaro': 'Light theme',
  'ajustes.tab.temaOscuro': 'Dark theme',
  'ajustes.tab.temaSistema': 'Follow system',
  'ajustes.config.titulo': 'Settings',
  'ajustes.config.personalizacion': 'Grade table customization',
  'ajustes.config.colorResaltado': 'Highlight color',
  'ajustes.config.colorResaltadoDesc': 'Color used to highlight the student in the grades table.',
  'ajustes.config.colorResaltadoLargo':
    'This color highlights the student and their row while you are editing grades.',
  'ajustes.config.vistaPrevia': 'Preview',
  'ajustes.config.vistaPreviaEjemplo': '← Example',
  'ajustes.config.vistaPreviaEjemploLargo': '← Highlighted student example',
  'ajustes.config.error': 'Error updating the settings: {msg}',
  'ajustes.notif.titulo': 'System notifications',
  'ajustes.notif.desc':
    'Lets the app show attendance reminders and sync notices. If the prompt on first launch did not appear, or you denied it, enable it here.',
  'ajustes.notif.activar': 'Enable notifications',
  'ajustes.notif.aviso':
    'If you did not see the prompt, enable it in Settings → Apps → School Tracker → Notifications',
  'ajustes.notif.error': 'Error requesting permission: {msg}',

  // ── Login browser ────────────────────────────────────────────────────────
  'nav.titulo': 'Browser for Google sign-in',
  'nav.desc':
    'Only affects Google sign-in (Welcome and Cloud). If your default browser is still Edge, pick yours here and it will open that one.',
  'nav.compacto': 'Browser: {nombre}',
  'nav.default': 'System default',
  'nav.firefox': 'Firefox',
  'nav.chrome': 'Google Chrome',
  'nav.edge': 'Microsoft Edge',
  'nav.brave': 'Brave',
  'nav.seAbrira': 'It will open: {ruta}',
  'nav.noEncontrado': 'That browser was not found installed; the system default will be used.',
  'nav.usaraSistema': 'The browser configured in your system will be used.',
  'nav.notaWindows':
    'To change the system default: Windows 11 → Settings → Apps → Default apps. Note: {http} and {https} are separate associations, and as long as {https} still points to Edge the sign-in opens in Edge, even if you set a different default browser.',
};
