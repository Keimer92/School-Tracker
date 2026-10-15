<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
   import { emit, listen } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { syncManager, type DownloadProgress } from "../lib/driveSyncService";
  import { setBackAuthInProgress, registerBackHandler } from "../lib/androidBack";
  import { iniciarSesionGoogleConNube } from "../lib/cloudLogin";
  import { getProfile, getCurrentEmail } from "../lib/accountProfiles";
  import { importarKeyDesdeArchivo, conectarConKeyManual } from "../lib/d1KeyImport";
  import appIcon from "../assets/app-icon.png";
  import BrowserPicker from "./BrowserPicker.svelte";
  import LanguagePicker from "./LanguagePicker.svelte";
  import { t } from "../lib/i18n.svelte";

  /** Misma fuente que usa cloudLogin.ts para no divergir. */
  const DEFAULT_WORKER = import.meta.env.VITE_D1_WORKER_URL
    || 'https://schooltracker-d1-sync.pedroluisnfc.workers.dev';

  let view: 'landing' | 'cloud' | 'wizard' = $state('landing');
  let step = $state(1);
  let loading = $state(false);
  let loadingMessage = $state('');
  let errorMsg = $state('');
  /**
   * Detalle técnico del fallo de conexión, cuando lo hubo.
   *
   * `errorMsg` es el texto amable para el usuario; este es el mensaje crudo que
   * devuelve el Worker o la capa de red. Se muestran los dos porque el amable
   * es el mismo para causas muy distintas (timeout, econn, 403, DNS mal) y sin
   * esto no hay forma de saber cuál falló.
   *
   * Es estado aparte, no un anexo de `errorMsg`, para poder limpiarlo sin tocar
   * el texto principal y para que el `{#if}` del template no dependa de parsear
   * el mensaje traducido.
   */
  let errorMsgTecnico = $state('');

  // ── Vista de Cloudflare, SEPARADA de Drive ──
  //
  // Antes la nube no tenía tarjeta propia: solo existía como *fallback* dentro
  // del flujo de Drive (`retryCloudRestore` cuando el Drive venía vacío). Eso
  // mezclaba dos servicios que no dependen uno del otro y hacía que un problema
  // en Drive pareciera un problema de la nube.
  //
  // Ahora son dos entradas independientes:
  //   · Cloudflare → D1, con la `schoolKey` (guardada, `.key` o escrita a mano)
  //   · Drive      → respaldo de archivo, con Google
  //
  // Y en ninguno de los dos hace falta Google para recuperar: la `schoolKey` es
  // la credencial, y Google solo interviene en el alta inicial de Drive.
  let viewNube = $state(false);
  /** Datos para conectar a mano cuando no hay credencial guardada ni archivo .key. */
  let keyManual = $state('');
  let workerManual = $state('');

  async function conectarDesdeViewNube() {
    const sk = keyManual.trim();
    if (!sk) {
      errorMsg = t('welcome.nube.faltaClave');
      return;
    }
    const wu = workerManual.trim() || DEFAULT_WORKER;
    const ok = await conectarConKeyManual(wu, sk);
    if (!ok) return;
    viewNube = false;
    // La credencial recién guardada habilita la restauración directa.
    await detectarCredencialNube();
    await continuarConNubeGuardada();
  }


  /**
   * La base local ya tiene datos de OTRO maestro.
   *
   * Desde que la BD se llama `school.db` (sin el correo en el nombre), un equipo
   * que se traspasa conserva los datos del dueño anterior. En la nube cada uno
   * queda separado por su `sk`, pero localmente el maestro nuevo arrancaría
   * viendo el colegio del otro, y el primer push subiría esos datos a SU
   * namespace. Se avisa ANTES de entrar y se ofrece limpiar: es la diferencia
   * entre "el maestro ve datos ajenos" y "empezó en cero".
   */
  let baseConDatosAjenos = $state(false);
  let estudiantesEnBase = $state(0);
  let limpiando = $state(false);

  async function detectarBaseConDatos() {
    try {
      const e = await invoke<{ tieneEstudiantes: boolean; estudiantes: number; tieneEscuela: boolean }>("estado_base_local");
      // Solo interesa si hay datos SIN nube configurada: si ya hay `schoolKey`,
      // esta base pertenece a alguien y el login la va a reasignar sola.
      baseConDatosAjenos = e.tieneEstudiantes && !e.tieneEscuela;
      estudiantesEnBase = e.estudiantes;
    } catch (err) {
      console.warn('[Welcome] no se pudo inspeccionar la base local:', err);
    }
  }

  /** Deja la base en cero. Borra datos y sesión de nube: el maestro entra limpio. */
  async function limpiarParaNuevoMaestro() {
    const ok = await ask(
      t('welcome.limpiar.nuevo'),
      { title: t('welcome.limpiar.titulo'), kind: 'warning', okLabel: t('welcome.limpiar.btn'), cancelLabel: t('comun.cancelar') }
    );
    if (!ok) return;
    limpiando = true;
    try {
      await invoke("reset_profile_account");
      baseConDatosAjenos = false;
      estudiantesEnBase = 0;
      await emit("show-toast", { message: t('welcome.limpiar.ok'), type: 'success' });
    } catch (err) {
      console.error('[Welcome] no se pudo limpiar la base:', err);
      await emit("show-toast", { message: t('welcome.limpiar.error'), type: 'error' });
    } finally { limpiando = false; }
  }


  // Detección de plataforma (mismo patrón que AsistenciaPage)
  let isAndroid = $state(/Android/i.test(navigator.userAgent));
  let isMobile = $state(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
  let isAndroidMobile = $derived(isAndroid || (isMobile && !/Windows/i.test(navigator.userAgent)));

  // Progreso de descarga de la BD desde Drive (reportado por driveSyncService)
  let downloadProgress = $state<DownloadProgress | null>(null);
  $effect(() => {
    if (loading) {
      return registerBackHandler(() => { cancelAuth(); return true; });
    }
  });
  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  interface GradItem { nombre: string; cualitativo: boolean; }
  interface DiasClase { lunes: boolean; martes: boolean; miercoles: boolean; jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean; }
  interface ColegioItem { nombre: string; tipo: 'Primaria' | 'Secundaria'; dias: DiasClase; asignaturas: string[]; }

  const gradosPrimaria = ['1er grado', '2do grado', '3er grado', '4to grado', '5to grado', '6to grado'];
  const gradosSecundaria = ['7mo grado', '8vo grado', '9no grado', '10mo grado', '11mo grado'];
  /** Catálogo completo de grados para los toggles del wizard. */
  const GRADOS_CATALOGO: { nombre: string; n: number; nivel: 'Primaria' | 'Secundaria' }[] = [
    ...gradosPrimaria.map((nombre, i) => ({ nombre, n: i + 1, nivel: 'Primaria' as const })),
    ...gradosSecundaria.map((nombre, i) => ({ nombre, n: i + 7, nivel: 'Secundaria' as const })),
  ];
  /** Secciones precargadas para marcar (decisión 2026-09: solo A-D). */
  const SECCIONES_CATALOGO = ['A', 'B', 'C', 'D'];

  /**
   * Asignaturas precargadas, en los mismos dos grupos que usa el backend
   * (`seed_default_data`): las cuantitativas con nota numérica y las
   * cualitativas con etiqueta. Se muestran como toggles, pero el campo de texto
   * sigue disponible para agregar materias propias del colegio.
   */
  const ASIGNATURAS_CATALOGO: { nombre: string; cualitativo: boolean }[] = [
    { nombre: 'Ingles', cualitativo: false },
    { nombre: 'Matematicas', cualitativo: false },
    { nombre: 'Fisica', cualitativo: false },
    { nombre: 'Biologia', cualitativo: false },
    { nombre: 'Ciencias Naturales', cualitativo: false },
    { nombre: 'Ciencias Sociales', cualitativo: false },
    { nombre: 'TAC', cualitativo: true },
    { nombre: 'AEP', cualitativo: true },
    { nombre: 'Convivencia & Civismo', cualitativo: true },
    { nombre: 'Creciendo en Valores', cualitativo: true },
    { nombre: 'Derecho & Dignidad de la Mujer', cualitativo: true },
    { nombre: 'Educación Física', cualitativo: true },
  ];

  let inputAnos = $state<string[]>([]);
  let inputColegios = $state<ColegioItem[]>([]);
  let inputGrados = $state<GradItem[]>([]);
  let inputSecciones = $state<string[]>([]);
  let inputAsignaturas = $state<GradItem[]>([]);
  let currentInput = $state('');

  /**
   * Toggles de grados y secciones. El estado vive en arrays (NO en atributos
   * del DOM) para que Svelte 5 lo rastree al re-renderizar.
   */
  let gradosMarcados = $state<string[]>([]);
  let seccionesMarcadas = $state<string[]>([]);
  /** Asignatura del catálogo precargado elegida como activa. */
  let asignaturasCatalogo = $state<string[]>([]);
  /** Materias escritas a mano que se agregan al final de la lista. */
  let asignaturasPropias = $state<GradItem[]>([]);

  function toggleGrado(nombre: string) {
    gradosMarcados = gradosMarcados.includes(nombre)
      ? gradosMarcados.filter(g => g !== nombre)
      : [...gradosMarcados, nombre];
  }
  function toggleSeccion(nombre: string) {
    seccionesMarcadas = seccionesMarcadas.includes(nombre)
      ? seccionesMarcadas.filter(s => s !== nombre)
      : [...seccionesMarcadas, nombre];
  }
  function toggleTodosGrados(nivel: 'Primaria' | 'Secundaria') {
    const delNivel = GRADOS_CATALOGO.filter(g => g.nivel === nivel).map(g => g.nombre);
    const todosPuestos = delNivel.every(g => gradosMarcados.includes(g));
    gradosMarcados = todosPuestos
      ? gradosMarcados.filter(g => !delNivel.includes(g))
      : Array.from(new Set([...gradosMarcados, ...delNivel]));
  }
  function toggleTodasSecciones() {
    seccionesMarcadas = seccionesMarcadas.length === SECCIONES_CATALOGO.length
      ? []
      : [...SECCIONES_CATALOGO];
  }
  function toggleAsignaturaCatalogo(nombre: string) {
    asignaturasCatalogo = asignaturasCatalogo.includes(nombre)
      ? asignaturasCatalogo.filter(a => a !== nombre)
      : [...asignaturasCatalogo, nombre];
  }
  function toggleTodasAsignaturas(cualitativo: boolean) {
    const delGrupo = ASIGNATURAS_CATALOGO.filter(a => a.cualitativo === cualitativo).map(a => a.nombre);
    const todasPuestas = delGrupo.every(a => asignaturasCatalogo.includes(a));
    asignaturasCatalogo = todasPuestas
      ? asignaturasCatalogo.filter(a => !delGrupo.includes(a))
      : Array.from(new Set([...asignaturasCatalogo, ...delGrupo]));
  }
  /** Todas las asignaturas finales: catálogo marcado + las escritas a mano. */
  function asignaturasElegidas(): GradItem[] {
    const delCatalogo = ASIGNATURAS_CATALOGO
      .filter(a => asignaturasCatalogo.includes(a.nombre))
      .map(a => ({ nombre: a.nombre, cualitativo: a.cualitativo }));
    return [...delCatalogo, ...asignaturasPropias];
  }

  /**
   * Tipo del colegio deducido de los grados marcados: si hay algún grado de
   * Secundaria (7mo-11mo) el colegio es Secundaria, aunque también ofrezca
   * primaria. Es la misma convención que usa `seed_colegio_grados` en Rust
   * (Primaria 1-6, Secundaria 7-11).
   */
  const tipoDesdeGrados = $derived<'Primaria' | 'Secundaria'>(
    gradosMarcados.some(g => gradosSecundaria.includes(g)) ? 'Secundaria' : 'Primaria'
  );
  const cantidadPrimaria = $derived(gradosMarcados.filter(g => gradosPrimaria.includes(g)).length);
  const cantidadSecundaria = $derived(gradosMarcados.filter(g => gradosSecundaria.includes(g)).length);

  /** Aplica los toggles a los arrays que consume el backend. */
  function sincronizarToggles() {
    inputGrados = gradosMarcados.map(n => ({
      nombre: n,
      // 1er y 2do grado son cualitativos por defecto en el modelo.
      cualitativo: n === '1er grado' || n === '2do grado',
    }));
    inputSecciones = [...seccionesMarcadas];
    inputAsignaturas = asignaturasElegidas();
  }

  // `steps` y `resumen` usan `t()`, así que van en `$derived`: con un `const`
  // se calcularían al importar el módulo y no cambiarían con el idioma.
  const steps = $derived([
    { title: t('welcome.wizard.stepAnios'), icon: '📅', key: 'anos' },
    { title: t('welcome.wizard.stepAsignaturas'), icon: '📚', key: 'asignaturas' },
    { title: t('welcome.wizard.stepGrados'), icon: '📊', key: 'grados' },
    { title: t('welcome.wizard.stepSecciones'), icon: '👥', key: 'secciones' },
    { title: t('welcome.wizard.stepColegios'), icon: '🏫', key: 'colegios' },
    { title: t('welcome.wizard.stepResumen'), icon: '✅', key: 'resumen' },
  ] as const);

  function cancelAuth() {
    setBackAuthInProgress(false);
    invoke("gd_cancel_oauth").catch(() => {});
    loading = false;
    loadingMessage = '';
    errorMsg = '';
  }

  /**
   * Opción 1: login con Google y restauración del último respaldo de Drive.
   *
   * El `schoolKey` NO se lo pide al usuario: lo devuelve el propio Worker en
   * `/auth` tras verificar el ID token, igual que hace la opción 2. La única
   * diferencia entre ambas es de dónde vienen los datos (Drive vs D1), no cómo
   * se obtiene la conexión.
   *
   * `skipSync: true` porque no queremos un sync con D1 todavía: si la nube
   * estuviera vacía, el pull no traería nada y sólo alimentaría el `last_sync`.
   * Lo que se restaura es el archivo de Drive.
   */
  async function handleDriveLogin() {
    loading = true;
    errorMsg = '';
    errorMsgTecnico = '';
    try {
      const res = await iniciarSesionGoogleConNube({
        onStatus: (m) => { loadingMessage = m; },
        setBackAuth: setBackAuthInProgress,
        skipSync: true,
      });
      if (res.status === 'sin-nube') {
        // La cuenta no está en la lista ALLOWED_EMAILS del Worker, pero Drive
        // ya quedó vinculado. Se sigue igual: esta opción restaura desde Drive,
        // que es un servicio aparte. Solo se pierde el sync con D1.
        tieneNube = false;
        await emit("show-toast", { message: "ℹ️ " + t('welcome.nube.sinNube'), type: "info" });
        loadingMessage = t('welcome.google.nueva');
        await restoreFromDrive();
        return;
      }
      if (res.status !== 'ok') {
        // `CloudLoginResult` marca la cancelación con `status`, no con una
        // propiedad `cancelled`: preguntar por `res.cancelled` daba siempre
        // undefined y el usuario veía "error desconocido" al cancelar.
        if (res.status === 'cancelled') {
          errorMsg = 'Iniciá sesión con Google para continuar.';
          errorMsgTecnico = '';
          return;
        }
        /**
         * El mensaje amable NO reemplaza al técnico: se muestran los dos.
         *
         * Antes se guardaba solo `friendlyCloudError(...).body`, que para
         * timeout/econn/HTTP ya viene redactado y sin detalle. El resultado era
         * un "No se pudo conectar con la nube" idéntico para un proxy caído, un
         * 403 del Worker y un DNS mal escrito, sin ninguna pista de cuál era.
         *
         * `errorMsgTecnico` se muestra aparte (como hace `cloudRetryError` en el
         * reintento) y se limpia apenas arranca un login nuevo, así no queda de
         * un intento anterior.
         */
        errorMsg = friendlyCloudError(res.error || 'error desconocido').body;
        errorMsgTecnico = res.error || '';
        console.warn('[Welcome] login sin conexión:', res.status, res.error);
        return;
      }
      // La nube queda configurada con la key autoritativa del Worker antes de
      // restaurar: si el resync posterior corriera con la config vacía crearía
      // un namespace nuevo y el vínculo con los datos se perdería.
      tieneNube = true;
      loadingMessage = t('welcome.google.nueva');
      await restoreFromDrive();
    } catch (e: any) {
      // El técnico va en su propio campo, no substituted en `errorMsg`: si el
      // mensaje es largo o viene en JSON, pisar el texto principal dejaba la
      // pantalla con un muro de caracteres y sin explicación.
      errorMsg = e?.message || String(e);
      errorMsgTecnico = e?.stack || String(e);
      console.warn('[Welcome] handleDriveLogin lanzó:', e);
    } finally {
      loading = false;
      loadingMessage = '';
    }
  }

  function goToWizard() {
    view = 'wizard';
    step = 1;
    errorMsg = '';
    errorMsgTecnico = '';
    currentInput = '';
  }

  /**
   * Avisa al usuario y lo conduce al wizard.
   *
   * El aviso NO puede quedar en `errorMsg`, porque `goToWizard()` lo limpia en
   * el mismo paso: si se mostrara ahí, desaparecería antes de poder leerse y el
   * usuario aparecería en el wizard sin entender por qué. Por eso se emite como
   * toast, se espera un instante y recién entonces se cambia de vista.
   */
  async function irAlWizardTrasAviso() {
    const aviso = errorMsg || 'No encontramos datos previos. Vamos a configurar tu base de datos desde cero.';
    errorMsg = '';
    errorMsgTecnico = '';
    driveSinRespaldo = false;
    await emit("show-toast", { message: aviso, type: "info" });
    loadingMessage = t('welcome.wizard.preparando');
    // Pausa deliberada: da tiempo a leer el motivo antes de que el wizard
    // cubra la portada.
    await new Promise((r) => setTimeout(r, 2200));
    loading = false;
    loadingMessage = '';
    goToWizard();
  }

  /** Detecta errores transitorios del Worker (cuota free agotada, red, rate limit). */
  function isTransientCloudError(msg: string): boolean {
    const m = msg.toLowerCase();
    return /1106|10000|429|503|502|504|timeout|timed out|exceeded|quota|limit|rate|overloaded|econn|network|fetch failed|cors|invalid request|typeerror|failed to fetch|aborterror|nserror|ssl|tls|handshake|certificate/i.test(m);
  }

  /** Health check rápido al Worker: ¿está vivo y responde? */
  async function pingWorker(): Promise<{ ok: boolean; ms: number; error?: string }> {
    const url = (import.meta.env.VITE_D1_WORKER_URL || 'https://schooltracker-d1-sync.pedroluisnfc.workers.dev') + '/ping';
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      clearTimeout(t);
      return { ok: res.ok, ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, ms: Date.now() - t0, error: typeof e === 'string' ? e : (e?.message || String(e)) };
    }
  }

  /** Horas/minutos hasta el reinicio de cuota diaria de Cloudflare (00:00 UTC). */
  function cloudflareResetInfo(): string {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    const ms = next.getTime() - now.getTime();
    const h = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${min}min`;
    return `${min} min`;
  }

  /** Mensaje amable para errores transitorios (cuota free agotada, etc.). */
  function friendlyCloudError(msg: string): { title: string; body: string } {
    const m = msg.toLowerCase();
    if (/1106|10000|429|quota|exceeded|rate|limit/.test(m)) {
      return {
        title: t('welcome.nube.quotaTitulo'),
        body: t('welcome.nube.quotaBody', { reinicio: cloudflareResetInfo() }),
      };
    }
    if (/0 filas aplicadas|no devolvió datos/.test(m)) {
      return { title: t('welcome.nube.sinDatosTitulo'), body: t('welcome.nube.sinDatosBody') };
    }
    if (/faltan catálogos base/.test(m)) {
      return { title: t('welcome.nube.incompletosTitulo'), body: t('welcome.nube.incompletosBody') };
    }
    if (/timeout|econn|network|fetch failed|overloaded/.test(m)) {
      return { title: t('welcome.nube.noConectadoTitulo'), body: t('welcome.nube.noConectadoBody') };
    }
    if (/d1 no está configurado/.test(m)) {
      return { title: t('welcome.nube.noConfigTitulo'), body: t('welcome.nube.noConfigBody') };
    }
    if (/worker error|http \d{3}/.test(m)) {
      return { title: t('welcome.nube.errorServidorTitulo'), body: t('welcome.nube.errorServidorBody') };
    }
    return { title: t('welcome.nube.errorTitulo'), body: t('welcome.nube.errorBody') };
  }

  let showCloudRetry = $state(false);
  let cloudRetryError = $state('');
  /** Si el restore aplicó datos parciales (algunas tablas, faltan catálogos base). */
  let partialRestoreApplied = $state(false);
  /**
   * La opción 1 (Drive) puede quedarse sin nada que restaurar: la cuenta no
   * tiene respaldos, o el respaldo veio vacío. Antes eso dejaba al usuario
   * atrapado en el Welcome sin salida, así que acá se ofrecen las dos
   * alternativas reales: probar la nube o arrancar de cero.
   */
  let driveSinRespaldo = $state(false);
  /** Diagnóstico visible del fallo: cuenta y cuántos respaldos encontró. */
  let driveAccount = $state('');
  let driveFilesCount = $state<number | null>(null);
  /** ¿El login con Google devolvió una key de nube válida? Si es false
   *  (cuenta nueva, fuera de ALLOWED_EMAILS) NO hay nada que buscar en
   *  Cloudflare, así que ante un Drive vacío se va directo al wizard en vez de
   *  gastar un intento de descarga. */
  let tieneNube = $state(false);
  /** Archivo de Drive que terminó restaurándose con datos. */
  let driveBackupInfo = $state<DriveFileInfo | null>(null);
  /** Respaldos descartados por venir con la base vacía o fallar la descarga. */
  let driveDescartados = $state<string[]>([]);
  /** Archivo que se está probando/descargando, para mostrarlo en el modal. */
  let loadingMessageFile = $state('');
  type DriveFileInfo = { name: string; size: number; modified: string };



  /** Reintenta el restore sin volver a pedir login (ya autenticado). */
  async function retryCloudRestore() {
    loading = true;
    showCloudRetry = false;
    cloudRetryError = '';
    loadingMessage = t('welcome.nube.reintentando');
    try {
      await invoke('d1_restore_from_cloud');
      const hasData = await invoke('is_app_initialized');
      if (hasData) {
        await entrarALaApp();
        setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
        loading = false; loadingMessage = '';
        return;
      }
      // El Worker respondió bien pero sin datos: es una respuesta CONCLUYENTE de
      // que no hay nada que recuperar (cuenta nueva o datos borrados), no un
      // fallo transitorio. En ese caso se encamina al wizard, que es donde
      // el usuario va a terminar de todos modos. El bloque de opciones
      // `showCloudRetry` queda reservado para errores reales (red, cuota,
      // rate limit), donde saltar al wizard a ciegas podría hacer perder datos
      // que sí están en la nube.
      errorMsg = t('welcome.nube.vaciaRespuesta');
      loading = false; loadingMessage = '';
      await irAlWizardTrasAviso();
    } catch (e: any) {
      const m = typeof e === 'string' ? e : (e?.message || String(e));
      // Cualquier fallo del reintento ofrece opciones (Drive incluido),
      // nunca wizard automático ni descarga silenciosa.
      cloudRetryError = m;
      showCloudRetry = true;
    }
    loading = false;
    loadingMessage = '';
  }

  /** El usuario confirma que quiere crear datos locales aunque la nube no respondió. */
  function forceManualSetup() {
    showCloudRetry = false;
    cloudRetryError = '';
    goToWizard();
  }

  /** El usuario quiere continuar al Dashboard con los datos parciales
   *  que SÍ se descargaron (catálogos base incompletos por cuota). */
  async function continueWithPartialData() {
    loading = true;
    showCloudRetry = false;
    cloudRetryError = '';
    loadingMessage = t('welcome.inicializandoParcial');
    try {
      await entrarALaApp();
      setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
    } catch (e: any) {
      errorMsg = t('welcome.errorGenerico', { msg: typeof e === 'string' ? e : (e?.message || String(e)) });
    }
    loading = false; loadingMessage = '';
  }

  /** ¿Hay tokens de Google Drive guardados en localStorage? */
  function isDriveLinked(): boolean {
    try {
      const raw = localStorage.getItem('schooltracker-google-drive-settings');
      if (!raw) return false;
      const j = JSON.parse(raw);
      return !!(j?.accessToken);
    } catch { return false; }
  }

  /**
   * Reconcilia la nube D1 con la base recien restaurada desde Drive.
   *
   * ANTES hacia siempre `d1_reset_remote` + `d1_sync_all {full:true}`, es decir
   * BORRABA toda la nube y volvia a subir la base entera. Con ~8.000 filas
   * sincronizables eso son ~16.000 operaciones de escritura de D1 (7.960 de ellas
   * en el push) y el plan gratis permite 100.000 filas escritas por dia: unas
   * pocas restauraciones bastaban para agotar la cuota, y como el push fallido
   * dejaba `last_push_sync` en NULL, cada trigger reintentaba el push completo
   * hasta vaciar el dia. Todo eso sin que el usuario tocara un solo dato.
   *
   * AHORA consulta cuantas filas hay en la nube (`d1_remote_stats`) y decide:
   *
   * - La nube TIENE datos -> merge incremental: push de lo realmente mas nuevo
   *   (el cursor de push se conservó) + pull completo que fusiona. Cuesta una
   *   peticion y unas pocas escrituras, y no pisa nada de lo que ya esta ahi.
   * - La nube esta VACIA o muy atrasada -> ahi si el push completo es lo
   *   correcto, porque si no los datos del respaldo nunca llegarian a la nube
   *   (el cursor incremental los daria por ya subidos). Si ademas quedaran
   *   tombstones de una purga vieja, se borran antes con `d1_reset_remote` para
   *   que no se coman las filas recien subidas.
   */
  async function sincronizarNubeTrasRestore(): Promise<boolean> {
    // Cuantas filas sincronizables hay ahora mismo en la base local.
    let filasLocales = 0;
    try {
      filasLocales = await invoke<number>('contar_filas_sincronizables');
    } catch (e) {
      console.warn('[Cloud] no se pudo contar las filas locales:', e);
    }

    let stats: any = null;
    try {
      stats = await invoke<any>('d1_remote_stats');
    } catch (e) {
      // Sin estadisticas no se puede decidir con seguridad. El merge incremental
      // es la opcion conservative: no borra nada de la nube y no la pisa.
      console.warn('[Cloud] d1_remote_stats falló; se hace merge incremental:', e);
    }

    const enNube = Number(stats?.total ?? -1);
    const tombstones = Number(stats?.tombstones ?? 0);

    // Umbral: la nube se considera "atrasada" si tiene menos de la mitad de las
    // filas locales. Con la base poblada (~8.000) son miles de filas de diferencia
    // real, no ruido por una sincronizacion parcial.
    const nubeVacia = enNube >= 0 && enNube < Math.max(1, Math.floor(filasLocales * 0.5));

    if (nubeVacia && tombstones > 0) {
      console.log(`[Cloud] nube casi vacía (${enNube} filas) con ${tombstones} tombstones: se purga antes de subir`);
      await invoke('d1_reset_remote');
      await invoke('d1_sync_all', { full: true, force: true, source: 'drive-restore' });
    } else if (nubeVacia) {
      console.log(`[Cloud] nube casi vacía (${enNube} de ${filasLocales} filas locales): push completo`);
      await invoke('d1_sync_all', { full: true, force: true, source: 'drive-restore' });
    } else {
      console.log(
        `[Cloud] nube con ${enNube} filas vs ${filasLocales} locales: merge incremental (push de lo nuevo + pull de fusión)`
      );
      await invoke('d1_sync_all', { source: 'drive-restore-merge' });
    }
    return true;
  }

  /** Restaura el último respaldo de Google Drive (workaround para cuota D1).
   *  Antes de restaurar: compara la fecha del respaldo con `last_sync` de D1.
   *  Si Drive es más viejo, advierte porque podría pisar cambios recientes
   *  sincronizados a D1 (asistencias/notas del desktop). El usuario decide. */
  async function restoreFromDrive() {
    loading = true;
    showCloudRetry = false;
    cloudRetryError = '';
    driveSinRespaldo = false;
    loadingMessage = t('welcome.drive.buscando');
    try {
      const { driveSyncService } = await import('../lib/driveSyncService');
      // Diagnóstico: los respaldos se filtran por el email de la cuenta, así que
      // saber QUÉ cuenta se conectó y cuántos archivos hay es lo primero para
      // entender un "no encontró respaldos".
      try {
        const s = JSON.parse(localStorage.getItem('schooltracker-google-drive-settings') || '{}');
        driveAccount = s?.googleUserEmail || '(sin email en ajustes)';
      } catch {}
      const backups = await driveSyncService.listBackups();
      driveFilesCount = backups.length;
      // `listSyncFiles` ya devuelve el "_latest" primero (ver `priorizarLatest`),
      // así que este bucle arranca por el último estado conocido y solo cae al
      // snapshot con timestamp si el "_latest" falla o viene con la base vacía.
      console.debug(
        '[Drive] orden de restauracion:',
        backups.map((b: any) => b.name)
      );
      if (backups.length === 0) {
        driveSinRespaldo = true;
        if (!tieneNube) {
          // Caso "cuenta nueva": ni Drive tiene respaldos ni existe namespace
          // en la nube (el Worker respondió sin-nube). No hay nada que buscar en
          // ninguna parte, así que se informa y se pasa al wizard en vez de
          // dejar al usuario en un callejón sin salida.
          loading = false; loadingMessage = '';
          errorMsg = t('welcome.drive.nuevaCuenta');
          await irAlWizardTrasAviso();
          return;
        }
        // Con nube configurada, Drive vacío puede ser un teléfono perdido: se
        // intenta recuperar desde Cloudflare. Si tampoco trae datos,
        // `retryCloudRestore` encamina al wizard.
        errorMsg = t('welcome.drive.sinRespaldo');
        loading = false; loadingMessage = '';
        await retryCloudRestore();
        return;
      }
      // Se recorren del más nuevo al más viejo y se corta en el primero que
      // traiga datos: el "_latest" puede estar vacío si un respaldo automático
      // corrió con la base ya purgada y lo sobrescribió con una copia en cero.
      const descartados: string[] = [];
      let restaurado: DriveFileInfo | null = null;
      for (const b of backups) {
        const tam = ((b.size || 0) / 1024).toFixed(1);
        // El nombre va aparte (`loadingMessageFile`): metido en el mensaje se
        // partía en varias líneas y empujaba el modal.
        loadingMessage = t('welcome.drive.descargando');
        loadingMessageFile = `${b.name} · ${tam} KB`;
        try {
          await driveSyncService.pullById(b.id);
        } catch (e) {
          console.warn(`[Drive] no se pudo restaurar ${b.name}:`, e);
          descartados.push(`${b.name} (falló la descarga)`);
          continue;
        }
        const ok = await invoke<boolean>('is_app_initialized');
        if (ok) { restaurado = { name: b.name, size: b.size || 0, modified: b.modifiedTime || b.createdTime || '' }; break; }
        descartados.push(`${b.name} (base vacía)`);
        console.warn(`[Drive] ${b.name} restauró una base vacía; pruebo el siguiente`);
      }
      driveBackupInfo = restaurado;
      driveDescartados = descartados;
      loadingMessageFile = '';
      if (!restaurado) {
        // Todos los respaldos restauraron una base vacía.
        driveSinRespaldo = true;
        errorMsg = t('welcome.drive.todosVacios');
        loading = false; loadingMessage = '';
        return;
      }
      console.log('[Drive] restaurado desde', restaurado.name);
      // Aviso si el respaldo quedó más viejo que la última sincronización D1.
      const cfg = await invoke<any>('d1_get_config').catch(() => null);
      const d1LastSync = cfg?.lastSync || null;
      if (d1LastSync && restaurado.modified) {
        const driveTime = Date.parse(restaurado.modified);
        const d1Time = Date.parse(d1LastSync.replace(' ', 'T') + 'Z');
        if (!isNaN(d1Time) && !isNaN(driveTime) && driveTime < d1Time - 60_000) {
          const fmt = (iso: string) => new Date(iso).toLocaleString();
          const ok = await ask(
            '⚠️ ' + t('welcome.drive.antiguoAviso', {
              fecha: fmt(restaurado.modified),
              fechaNube: fmt(d1LastSync.replace(' ', 'T') + 'Z'),
            }),
            {
              title: t('welcome.drive.antiguoTitulo'),
              kind: 'warning',
              okLabel: t('welcome.drive.antiguoSi'),
              cancelLabel: t('welcome.drive.antiguoNo'),
            }
          );
          if (!ok) { loading = false; loadingMessage = ''; driveSinRespaldo = true; errorMsg = t('welcome.drive.cancelado'); return; }
        }
      }
      try { await invoke('gd_reload_database'); } catch {}
      // ── Watchdog: el respaldo YA está en disco ──
      //
      // Todo lo que viene de acá para adelante es *nube*: reconfigurar D1, el
      // resync y el intercambio de tokens. Nada de eso es motivo para dejar al
      // usuario clavado en el WelcomePage con el spinner, y una sola llamada
      // colgada (cuota de Cloudflare, worker caído, /stats sin desplegar) lo
      // dejaba exactamente así. Se corre la cadena con un tope de tiempo y, si
      // no termina, se entra igual a la app: los datos están restaurados.
      const RESTAURADO_EN = Date.now();
      const paso = (m: string) => console.warn(`[Welcome] +${((Date.now() - RESTAURADO_EN) / 1000).toFixed(1)}s ${m}`);
      paso('respaldo en disco; reconfigurando nube…');
      await conTope(
        async () => {
          // ⚠️ ORDEN CRÍTICO: restaurar Drive SOBRESCRIBE el archivo .db completo,
          // y con él la tabla `d1_config` que se guardó en el login. Si no se
          // vuelve a guardar después, el resync falla con "D1 no está
          // configurado" y la cuenta queda sin nube. La key se lee del perfil de
          // la cuenta activa (guardado en localStorage), no se pasa por parámetro.
          const perfil = getProfile(getCurrentEmail());
          if (perfil?.schoolKey) {
            try {
              await invoke('d1_save_config', { workerUrl: perfil.workerUrl || DEFAULT_WORKER, schoolKey: perfil.schoolKey });
              paso('config de nube re-aplicada tras restaurar');
            } catch (e) {
              paso('no se pudo re-aplicar d1_config: ' + e);
            }
          } else {
            paso('sin perfil de cuenta: d1_config puede quedar vacía');
          }

          loadingMessage = t('welcome.nube.sincronizando');
          try {
            await sincronizarNubeTrasRestore();
            nubeSincronizada = true;
          } catch (resyncErr) {
            // console.warn (NO debug): DevTools oculta console.debug salvo nivel
            // "Verbose", y esto es justamente el punto que hay que ver sin
            // configurar nada. Una nube caida NO debe impedir entrar a la app.
            paso('resync con la nube fallo (se entra igual): ' + resyncErr);
            try {
              const { syncService } = await import('../lib/syncService');
              await syncService.stopPeriodicSync();
            } catch {}
          }
          paso('entrando a la app...');
          await entrarALaApp();
          paso('listo');
        },
        40_000,
        'la sincronización con la nube no respondió'
      );
      // Si el tope venció, `entrarALaApp` puede no haberse corrido: se asegura.
      if (!appIniciada) {
        paso('el tope venció; se entra a la app de todos modos');
        await entrarALaApp().catch((e) => console.warn('[Welcome] entrarALaApp de emergencia fallo:', e));
      }
      // El permiso de notificaciones solo tiene sentido si la nube quedó
      // funcionando; si el resync falló (cuota, worker caído) se omite para no
      // pedir un permiso que la app no va a poder usar.
      if (nubeSincronizada) {
        setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
      }
      return;
    } catch (e: any) {
      const m = typeof e === 'string' ? e : (e?.message || String(e));
      errorMsg = t('welcome.drive.error', { msg: m });
      driveSinRespaldo = true;
    }
    loading = false; loadingMessage = '';
  }

  /** Pide el permiso POST_NOTIFICATIONS (Android 13+) en la primera ejecución. */
  /**
   * Entra a la app tras una restauración o el asistente.
   *
   * Además de `welcome-complete` emite `catalog-updated` / `data-updated`:
   * las páginas están MONTADAS desde el arranque (con `display:none`), así que
   * ya consultaron los catálogos y los tienen cacheados con el valor vacío que
   * había antes del seed. Sin este aviso el Dashboard seguía mostrando
   * "0 grados / 0 secciones" aunque los datos estuvieran escritos.
   */
  /**
   * Corre `tarea` con un tope de tiempo. Si el tope vence, NO lanza: solo avisa
   * y deja seguir el flujo, porque el llamador tiene un camino de recuperación
   * (entrar a la app con los datos que ya están en disco).
   *
   * Existe por un motivo concreto: la fase de nube del restore depende de
   * llamadas que pueden colgarse sin resolver (cuota de Cloudflare, worker
   * caído, un endpoint sin desplegar) y cualquiera de ellas dejaba al usuario
   * clavado en el WelcomePage con el spinner girando, sin error y sin salida.
   * `Promise.race` no cancela la tarea perdedora: si termina después, su
   * `catch` propio ya no hace daño, y por eso `tarea` debe manejar sus errores.
   */
  async function conTope(tarea: () => Promise<void>, ms: number, motivo: string) {
    let ticked = false;
    const reloj = setTimeout(() => {
      ticked = true;
      console.warn(`[Welcome] ${motivo}: se sigue adelante a los ${ms / 1000}s (los datos ya están en disco)`);
    }, ms);
    try {
      await Promise.race([
        tarea(),
        new Promise<void>((resolve) => setTimeout(() => { if (ticked) resolve(); }, ms)),
      ]);
    } finally {
      clearTimeout(reloj);
    }
  }

  /** `true` una vez que la app quedó marcada como inicializada. */
  let appIniciada = $state(false);
  /** `true` si el resync con la nube terminó bien. */
  let nubeSincronizada = $state(false);

  // ── Acceso a la nube SIN Google ──
  //
  // El `schoolKey` es todo lo que hace falta para hablar con Cloudflare: es un
  // string que viaja en el header `X-School-Key` y el Worker lo rutea por KV. Es
  // decir, Cloudflare NO depende de Google para nada que no sea el alta inicial.
  //
  // Ese key se guarda en DOS lugares, y la diferencia importa acá:
  //
  //   · `d1_config` (dentro del .db)      → se pierde si borraste la base
  //   · perfil de cuenta (localStorage)    → SOBREVIVE perder el .db
  //
  // Por eso se busca en el perfil primero: si perdiste la base por un Formatear o
  // un "limpiar datos" de Android, seguís pudiendo volver a entrar con la nube
  // sin pasar por Google.
  let credencialNube = $state<{ schoolKey: string; workerUrl: string; email: string } | null>(null);

  async function detectarCredencialNube() {
    // 1) Perfil en localStorage (sobrevive a la pérdida del .db).
    try {
      const p = getProfile(getCurrentEmail());
      if (p?.schoolKey) {
        credencialNube = { schoolKey: p.schoolKey, workerUrl: p.workerUrl || DEFAULT_WORKER, email: getCurrentEmail() || '' };
        return;
      }
    } catch { /* ignorable */ }
    // 2) `d1_config` dentro del .db, por si el perfil no está.
    try {
      const cfg = await invoke<{ workerUrl?: string; schoolKey?: string } | null>('d1_get_config');
      if (cfg?.schoolKey) {
        credencialNube = { schoolKey: cfg.schoolKey, workerUrl: cfg.workerUrl || DEFAULT_WORKER, email: '' };
      }
    } catch { /* ignorable */ }
  }

  /**
   * Restaura desde Cloudflare con la credencial YA GUARDADA, sin pasar por
   * Google.
   *
   * Esta es la ruta que hace que Cloudflare no dependa de Google: si el
   * dispositivo ya tuvo un alta, volver a entrar es un `d1_restore_from_cloud` y
   * nada más. Antes, la única forma de recuperar la base era iniciar sesión con
   * Google, lo que ataba la copia de seguridad de tu trabajo a que Google
   * estuviera disponible y tu cuenta estuviera bien.
   */
  async function continuarConNubeGuardada() {
    const cred = credencialNube;
    if (!cred) return;
    loading = true;
    errorMsg = '';
    errorMsgTecnico = '';
    showCloudRetry = false;
    loadingMessage = t('welcome.nube.restaurando');
    try {
      // Re-aplicar la config: si la base se perdió, `d1_config` también, y sin
      // esto el restorecorrería contra un namespace vacío.
      await invoke('d1_save_config', { workerUrl: cred.workerUrl, schoolKey: cred.schoolKey });
      loadingMessage = t('welcome.nube.descargando');

      await conTope(
        async () => {
          await invoke('d1_restore_from_cloud');
          const hasData = await invoke<boolean>('is_app_initialized');
          if (hasData) { await entrarALaApp(); return; }
          // El Worker respondió bien pero la base llegó vacía. Es una respuesta
          // CONCLUYENTE de que no hay nada que recuperar, no un fallo transitorio.
          await irAlWizardTrasAviso();
        },
        40_000,
        'la restauración desde la nube no respondió'
      );
      if (!appIniciada) await entrarALaApp().catch((e) => console.warn('[Welcome] entrarALaApp de emergencia fallo:', e));
    } catch (e: any) {
      const m = typeof e === 'string' ? e : (e?.message || String(e));
      // Se ofrecen alternativas reales (reintentar, Google, Drive, wizard) en
      // vez de dejar al usuario clavado en el spinner.
      cloudRetryError = m;
      showCloudRetry = true;
    }
    loading = false;
    loadingMessage = '';
  }

  async function entrarALaApp() {
    console.warn('[Welcome] set_app_initialized...');
    await invoke('set_app_initialized');
    appIniciada = true;
    console.warn('[Welcome] set_app_initialized OK; emitiendo welcome-complete');
    emit('catalog-updated', { timestamp: Date.now() });
    emit('data-updated', { timestamp: Date.now() });
    emit('welcome-complete');
  }

  async function solicitarPermisoNotificaciones() {
    if (!/Android/i.test(navigator.userAgent)) return;
    // Solo pedir una vez por instalación (evita diálogos repetidos raros)
    if (localStorage.getItem('stp_notif_permiso_pedido')) return;
    localStorage.setItem('stp_notif_permiso_pedido', '1');
    try { await invoke('gd_request_notification_permission'); } catch (e) { console.error('Permiso notificaciones:', e); }
  }

  /**
   * "Empezar de cero" implica empezar SIN nube. Si el usuario pasó antes por
   * Drive o Cloudflare, quedó con la cuenta de Google enlazada y su archivo .db
   * como activo: sin esto, la base nueva se seguía subiendo al namespace de la
   * cuenta anterior.
   */
  async function desvincularSiHaceFalta() {
    const tieneSesion = !!localStorage.getItem('schooltracker-google-drive-settings');
    const tieneCuenta = !!getCurrentEmail();
    let tieneConfig = false;
    try { tieneConfig = !!(await invoke<any>('d1_get_config'))?.schoolKey; } catch {}
    if (!tieneSesion && !tieneCuenta && !tieneConfig) return;

    // Parar todo lo que pudiera seguir subiendo datos a la nube vieja.
    try { const { syncService } = await import('../lib/syncService'); await syncService.stopPeriodicSync(); } catch {}
    try { const { stopWsSync } = await import('../lib/wsSyncService'); stopWsSync(); } catch {}
    try { const { driveSyncService } = await import('../lib/driveSyncService'); driveSyncService.stopPeriodicSync(); } catch {}

    // Quitar tokens de Drive y el marcador de cuenta actual del localStorage.
    localStorage.removeItem('schooltracker-google-drive-settings');
    localStorage.removeItem('stp_current_account');

    // Quitar el marcador de cuenta activa en disco, limpiar d1_config y volver
    // a abrir `school.db` (el archivo por cuenta queda intacto, no se borra).
    try { await invoke('desvincular_cuenta'); } catch (e) { console.warn('[Wizard] desvinculación falló:', e); }
    console.log('[Wizard] cuenta desvinculada: base limpia, sin nube');
  }

  async function handleWizardComplete() {
    sincronizarToggles();
    if (inputAnos.length === 0 || inputColegios.length === 0 || inputGrados.length === 0 ||
        inputSecciones.length === 0 || inputAsignaturas.length === 0) {
      errorMsg = t('welcome.wizard.minimoElementos');
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      await desvincularSiHaceFalta();
      // El sistema anexa " grado" a lo que el usuario escriba en Grados
      // (p. ej. "1er" -> "1er grado"), salvo que ya lo incluya.
      const grados = inputGrados.map((g) => {
        const t = g.nombre.trim();
        return { nombre: /grado\s*$/i.test(t) ? t : t + ' grado', cualitativo: g.cualitativo };
      });
      const asignaturas = inputAsignaturas.map((a) => ({ nombre: a.nombre.trim(), cualitativo: a.cualitativo }));
      await invoke('seed_selected_data', {
        selections: {
          anos: inputAnos.map((a) => a.trim()),
          // El tipo del colegio lo decide la lógica de los toggles: si hay
          // algún grado de Secundaria marcado, el colegio es Secundaria.
          colegios: inputColegios.map((c) => ({ ...c, tipo: tipoDesdeGrados })),
          grados,
          secciones: inputSecciones.map((s) => s.trim()),
          asignaturas,
        }
      });
      await entrarALaApp();
      setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
    } catch (e: any) {
      errorMsg = t('welcome.wizard.errorGuardando', { msg: e?.message || String(e) });
    }
    loading = false;
  }

  function nextStep() { if (step < steps.length) step++; }
  function prevStep() { if (step > 1) step--; }

  /** Valida el paso actual. `currentItems()` ya refleja los toggles de grados
   *  y secciones, así que no hace falta un caso especial por paso. */
  function puedeAvanzar(): boolean {
    return currentItems().length > 0;
  }

  type StepKey = 'anos' | 'colegios' | 'grados' | 'secciones' | 'asignaturas';
  function stepKey(): StepKey {
    return steps[step - 1].key as StepKey;
  }
  function stepLabel(): string {
    const map: Record<StepKey, string> = {
      anos: 'años lectivos', colegios: 'colegios', grados: 'grados',
      secciones: 'secciones', asignaturas: 'asignaturas',
    };
    return map[stepKey()];
  }
  function inputPlaceholder(): string {
    const map: Record<StepKey, string> = {
      anos: 'Ej: 2026', colegios: 'Ej: Colegio Central',
      grados: 'Ej: 1er (se agrega "grado")', secciones: 'Ej: A',
      asignaturas: 'Ej: Matemáticas',
    };
    return map[stepKey()];
  }
  /**
   * Días que se ofrecen en el asistente: LUNES a VIERNES.
   * Sábado y domingo se quitaron del catálogo (decisión del usuario: el colegio
   * es de entre semana). El tipo `DiasClase` los mantiene porque así está la
   * tabla en la base, pero quedan siempre en false.
   */
  const diasKeys: (keyof DiasClase)[] = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
  function defaultDias(): DiasClase {
    return { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: false, domingo: false };
  }
  function diaShort(k: keyof DiasClase): string {
    // El asistente solo ofrece L-V, pero `DiasClase` conserva sábado y domingo
    // porque así vienen en la BD; el mapa los cubre para no dejar el índice sin tipo.
    const CORTO: Partial<Record<keyof DiasClase, string>> = {
      lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D',
    };
    return CORTO[k] || '';
  }
  /** Forzar finde en false: el asistente ya no los ofrece. */
  function soloEntreSemana(d: DiasClase): DiasClase {
    return { ...d, sabado: false, domingo: false };
  }
  function currentItems(): (string | GradItem | ColegioItem)[] {
    const k = stepKey();
    if (k === 'anos') return inputAnos;
    if (k === 'colegios') return inputColegios;
    if (k === 'asignaturas') return asignaturasElegidas();
    // Grados y secciones salen de los toggles. Se derivan SIN mutar estado:
    // `sincronizarToggles()` solo se invoca al finalizar, para no tener efectos
    // secundarios dentro de una función que el markup llama en cada render.
    if (k === 'grados') return gradosMarcados.map(nombre => ({
      nombre, cualitativo: nombre === '1er grado' || nombre === '2do grado',
    }));
    return [...seccionesMarcadas];
  }
  function setItems(arr: string[]) {
    const k = stepKey();
    if (k === 'anos') inputAnos = arr;
    else if (k === 'secciones') inputSecciones = arr;
  }
  function chipLabel(item: string | GradItem | ColegioItem): string {
    return typeof item === 'string' ? item : item.nombre;
  }
  function addCurrentItem() {
    const v = currentInput.trim();
    if (!v) return;
    const k = stepKey();
    // Grados y secciones son catálogos con toggles: no se escriben a mano.
    if (k === 'asignaturas') {
      // Si el texto coincide con una del catálogo, se marca ese toggle en
      // lugar de crear una materia nueva duplicada.
      const delCatalogo = ASIGNATURAS_CATALOGO.find(
        a => a.nombre.toLowerCase() === v.toLowerCase()
      );
      if (delCatalogo) {
        if (!asignaturasCatalogo.includes(delCatalogo.nombre)) {
          asignaturasCatalogo = [...asignaturasCatalogo, delCatalogo.nombre];
        }
      } else if (!asignaturasPropias.some((a) => a.nombre.toLowerCase() === v.toLowerCase())) {
        asignaturasPropias = [...asignaturasPropias, { nombre: v, cualitativo: false }];
      }
    } else if (k === 'colegios') {
      if (!inputColegios.some((c) => c.nombre.toLowerCase() === v.toLowerCase())) {
        // El tipo lo deducen los toggles de grados (ver `tipoDesdeGrados`), así
        // que aquí no se fuerza nada. Tampoco se auto-agrean grados: si se
        // hicieran aquí pisarían lo que el usuario marcó a mano.
        inputColegios = [...inputColegios, { nombre: v, tipo: 'Primaria', dias: soloEntreSemana(defaultDias()), asignaturas: [] }];
      }
    } else {
      const items = [...(currentItems() as string[])];
      if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) items.push(v);
      setItems(items);
    }
    currentInput = '';
  }
  function removeItem(i: number) {
    const k = stepKey();
    // Asignaturas: el índice corresponde al catálogo marcado + las propias.
    if (k === 'asignaturas') {
      const delCatalogo = ASIGNATURAS_CATALOGO
        .filter(a => asignaturasCatalogo.includes(a.nombre))
        .map(a => a.nombre);
      if (i < delCatalogo.length) {
        asignaturasCatalogo = asignaturasCatalogo.filter(a => a !== delCatalogo[i]);
      } else {
        asignaturasPropias = asignaturasPropias.filter((_, idx) => idx !== i - delCatalogo.length);
      }
      return;
    }
    if (k === 'colegios') { inputColegios = inputColegios.filter((_, idx) => idx !== i); return; }
    if (k === 'grados' || k === 'secciones') return;  // solo toggles
    setItems((currentItems() as string[]).filter((_, idx) => idx !== i));
  }
  function toggleDia(ci: number, dk: keyof DiasClase) {
    if (dk === 'sabado' || dk === 'domingo') return;  // fuera del catálogo
    inputColegios = inputColegios.map((c, idx) => {
      if (idx !== ci) return c;
      const dias = { ...c.dias, [dk]: !c.dias[dk] };
      return { ...c, dias };
    });
  }
  function toggleAsignaturaColegio(ci: number, nombre: string) {
    inputColegios = inputColegios.map((c, idx) => {
      if (idx !== ci) return c;
      const has = c.asignaturas.includes(nombre);
      const asignaturas = has ? c.asignaturas.filter((n) => n !== nombre) : [...c.asignaturas, nombre];
      return { ...c, asignaturas };
    });
  }

  function getResumenItems() {
    // Grados y secciones salen de los TOGGLES, no del array de entrada: ese
    // array solo se llena en `sincronizarToggles()` al finalizar.
    const gradosResumen = gradosMarcados.map((g) => {
      const t = g.trim();
      return /grado\s*$/i.test(t) ? t : t + ' grado';
    });
    return [
      { label: t('welcome.wizard.stepAnios'), items: inputAnos.join(', '), icon: '📅' },
      { label: t('welcome.wizard.stepGrados'), items: gradosResumen.join(', '), icon: '📊' },
      { label: t('welcome.wizard.stepSecciones'), items: seccionesMarcadas.join(', '), icon: '👥' },
      { label: t('welcome.wizard.stepColegios'), items: inputColegios.map((c) => c.nombre).join(', '), icon: '🏫' },
      { label: t('welcome.wizard.stepAsignaturas'), items: asignaturasElegidas().map((a) => a.nombre).join(', '), icon: '📚' },
    ];
  }

  // Suscripción al progreso de descarga (todas las plataformas)
  onMount(() => {
    syncManager.subscribe((s) => { downloadProgress = s.downloadProgress ?? null; });
    void detectarBaseConDatos();
    // ¿Hay credencial de nube ya guardada? Si la hay, aparece la vía de entrada
    // SIN Google. Es una llamada a un comando local y otra a localStorage: no
    // toca la red, así que no retrasa el primer render.
    void detectarCredencialNube();
  });
</script>

<div class="welcome-page">
  <div class="orbs" aria-hidden="true">
    <span class="orb orb-a"></span>
    <span class="orb orb-b"></span>
    <span class="orb orb-c"></span>
  </div>
  <!-- Selector de idioma flotante. Va ACÁ (hijo directo de `.welcome-page`)
       y no dentro de cada vista: así está en la portada, en el asistente y en
       la pantalla de nube, y también en Android (antes el
       `{#if !isAndroidMobile}` lo escondía justo en el primer arranque).
       `position: fixed` lo mantiene anclado aunque la vista haga scroll; el
       popover se cierra al tocar afuera o con Escape. -->
  <LanguagePicker flotante />
  {#if view === 'landing'}
    <div class="welcome-container" class:android={isAndroidMobile}>
      <div class="welcome-brand">
        {#if isAndroidMobile}
          <div class="welcome-brand-row">
            <img class="welcome-logo welcome-logo-sm" src={appIcon} alt="School Tracker" draggable="false" />
            <div class="welcome-brand-text">
              <h1 class="welcome-title welcome-title-sm">{t("welcome.appTitle")}</h1>
              <p class="welcome-subtitle">{t("welcome.subtitle")}</p>
            </div>
          </div>
        {:else}
          <img class="welcome-logo" src={appIcon} alt="School Tracker" draggable="false" />
          <h1 class="welcome-title">{t("welcome.appTitle")}</h1>
          <p class="welcome-subtitle">{t("welcome.subtitle")}</p>
        {/if}
      </div>
      <div class="welcome-cards" class:android={isAndroidMobile}>
        <!--
          1. CLOUDFLARE — servicio propio, sin Google.

          Antes la nube no tenía entrada propia: solo era un fallback dentro del
          flujo de Drive. Eso mezclaba dos servicios independientes y hacía que
          un problema de uno pareciera del otro. Ahora la tarjeta abre una vista
          con las tres vías para llegar al namespace:

            · credencial ya guardada → restaurar directo (un toque)
            · archivo .key          → equipo nuevo, sin Google
            · pegar la clave a mano → si no tenés el archivo

          En las tres, la `schoolKey` es la credencial. Google no aparece.
        -->
        <button class="welcome-card card-google" class:android={isAndroidMobile} onclick={() => { viewNube = true; errorMsg = ''; }} disabled={loading}>
          <div class="welcome-card-icon">☁️</div>
          <div class="welcome-card-body">
            <h3>{t('welcome.cardNube.title')}</h3>
            <p>{t('welcome.cardNube.desc')}</p>
            <span class="welcome-card-tags">
              {#if credencialNube}
                <span class="welcome-tag">{t('welcome.cardNube.tagGuardada')}</span>
              {/if}
              <span class="welcome-tag">{t('welcome.cardNube.tagSinGoogle')}</span>
            </span>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>

        <!-- 2. Google Drive: respaldo de archivo. Servicio aparte de la nube. -->

        <button class="welcome-card card-google" class:android={isAndroidMobile} onclick={() => handleDriveLogin()} disabled={loading}>
          <div class="welcome-card-icon">📥</div>
          <div class="welcome-card-body">
            <h3>{t("welcome.cardGoogle.title")}</h3>
            <p>{t("welcome.cardGoogle.desc")}</p>
            <span class="welcome-card-tags"><span class="welcome-tag">{t("welcome.cardGoogle.tag1")}</span><span class="welcome-tag">{t("welcome.cardGoogle.tag2")}</span></span>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>

        <!-- 3. Base limpia con asistente de instalación -->
        <button class="welcome-card card-manual" class:android={isAndroidMobile} onclick={goToWizard} disabled={loading}>
          <div class="welcome-card-icon">✨</div>
          <div class="welcome-card-body">
            <h3>{t("welcome.cardWizard.title")}</h3>
            <p>{t("welcome.cardWizard.desc")}</p>
            <span class="welcome-card-tags"><span class="welcome-tag">{t("welcome.cardWizard.tag1")}</span><span class="welcome-tag">{t("welcome.cardWizard.tag2")}</span></span>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>

      </div>
      {#if errorMsg}
        <div class="welcome-error">{errorMsg}</div>
      {/if}
      {#if errorMsgTecnico}
        <details class="welcome-error-detalle">
          <summary>Detalle técnico</summary>
          <pre>{errorMsgTecnico}</pre>
        </details>
      {/if}
      <!-- Aviso de base traspasada: hay datos de otro maestro en esta máquina. -->
      {#if baseConDatosAjenos}
        <div class="welcome-card" style="border-left: 3px solid #f59e0b; cursor: default;">
          <div class="welcome-card-icon">⚠️</div>
          <div class="welcome-card-body">
            <h3>{t('welcome.limpiar.titulo')}</h3>
            <p>{t('welcome.limpiar.aviso', { n: estudiantesEnBase })}</p>
            <div style="display:flex;gap:0.4rem;margin-top:0.5rem;flex-wrap:wrap;">
              <button onclick={limpiarParaNuevoMaestro} disabled={limpiando} class="welcome-card" style="padding:0.4rem 0.7rem;font-size:0.78rem;">
                {limpiando ? '⏳' : '🧹'} {t('welcome.limpiar.btn')}
              </button>
            </div>
          </div>
        </div>
      {/if}
      <!-- Selector de navegador del login. Tiene que estar AQUÍ y no solo en
           Ajustes: el login arranca en esta pantalla, así que un usuario a quien
           Windows le abre Edge no tiene forma de cambiarlo si la única entrada
           está más adentro. Se compacta en una línea para no competir con las
           tarjetas de entrada. -->
      {#if !isAndroidMobile}
        <BrowserPicker compacto />
      {/if}
      {#if driveSinRespaldo}
        <!-- El respaldo de Drive no sirvió. Las otras dos opciones siguen
             accesibles desde la portada, así que solo alcanza con volver. -->
        <button class="welcome-link" onclick={() => { driveSinRespaldo = false; errorMsg = ''; }}>{t("welcome.wizard.volver")}</button>
      {/if}
    </div>

  {:else if viewNube}
    <!--
      Vista de CLOUDFLARE. Deliberadamente aparte de la de Drive: son dos
      servicios sin relación, con credenciales distintas y modos de falla
      distintos. Mezclarlos hacía que un Drive vacío pareciera "la nube no
      funciona" y empujara a un login con Google innecesario.
    -->
    <div class="welcome-container wizard-container">
      <button class="welcome-back" onclick={() => { viewNube = false; errorMsg = ''; }}>{t("welcome.wizard.volverBoton")}</button>

      <div style="text-align:center;margin:1rem 0 1.5rem;">
        <div style="font-size:2.5rem;">☁️</div>
        <h1 class="welcome-title">{t('welcome.nube.vistaTitulo')}</h1>
        <p class="welcome-subtitle">{t('welcome.nube.vistaSubtitulo')}</p>
      </div>

      {#if errorMsg}<div class="welcome-error">{errorMsg}</div>{/if}
      {#if errorMsgTecnico}
        <details class="welcome-error-detalle">
          <summary>Detalle técnico</summary>
          <pre>{errorMsgTecnico}</pre>
        </details>
      {/if}

      <!-- Vía 1: credencial ya guardada. Es la del uso normal. -->
      {#if credencialNube}
        <div class="welcome-card" style="border-left:3px solid #22c55e;margin-bottom:1rem;cursor:default;">
          <div class="welcome-card-body">
            <h3>{t('welcome.nube.tieneClave')}</h3>
            <p>{credencialNube.email || t('welcome.nube.sinEmailGuardado')}</p>
          </div>
        </div>
        <button class="welcome-card card-google" class:android={isAndroidMobile} onclick={() => continuarConNubeGuardada()} disabled={loading}>
          <div class="welcome-card-icon">⤓</div>
          <div class="welcome-card-body">
            <h3>{t('welcome.nube.restaurar')}</h3>
            <p>{t('welcome.nube.restaurarDesc')}</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
      {/if}

      <!-- Vía 2: archivo .key. Para un equipo nuevo, sin pasar por Google. -->
      <button class="welcome-card card-manual" class:android={isAndroidMobile}
        onclick={async () => {
          const actual = await invoke<any>('d1_get_config').catch(() => null);
          const ok = await importarKeyDesdeArchivo({ actual: actual?.schoolKey ? { workerUrl: actual.workerUrl, schoolKey: actual.schoolKey } : null });
          if (!ok) return;
          await detectarCredencialNube();
          viewNube = false;
          await continuarConNubeGuardada();
        }}
        disabled={loading}>
        <div class="welcome-card-icon">🔑</div>
        <div class="welcome-card-body">
          <h3>{t('welcome.nube.importarKey')}</h3>
          <p>{t('welcome.nube.importarKeyDesc')}</p>
        </div>
        <div class="welcome-card-arrow">→</div>
      </button>

      <!-- Vía 3: pegar la clave a mano, para cuando no hay archivo. -->
      <div class="category-card" style="margin-top:1rem;padding:1.1rem;">
        <h3 style="margin:0 0 0.35rem;font-size:0.95rem;color:#e2e8f0;">{t('welcome.nube.manualTitulo')}</h3>
        <p style="margin:0 0 0.85rem;font-size:0.8rem;color:#94a3b8;">{t('welcome.nube.manualDesc')}</p>
        <input
          class="obs-inline"
          placeholder={t('welcome.nube.manualPhClave')}
          bind:value={keyManual}
          style="margin-bottom:0.5rem;" />
        <input
          class="obs-inline"
          placeholder={t('welcome.nube.manualPhWorker')}
          bind:value={workerManual}
          style="margin-bottom:0.85rem;" />
        <button class="primary" onclick={conectarDesdeViewNube} disabled={loading} style="width:100%;">
          {t('welcome.nube.manualBoton')}
        </button>
      </div>
    </div>

  {:else if view === 'wizard'}
    <div class="welcome-container wizard-container">
      <button class="welcome-back" onclick={() => { view = 'landing'; errorMsg = ''; step = 1; }}>{t("welcome.wizard.volverBoton")}</button>
      <div class="wizard-progress">
        {#each steps as s, i}
          <div class="wizard-step-dot" class:active={i + 1 === step} class:done={i + 1 < step}>
            <span>{s.icon}</span>
          </div>
          {#if i < steps.length - 1}
            <div class="wizard-step-line" class:done={i + 1 < step}></div>
          {/if}
        {/each}
      </div>
      <div class="wizard-step-label">{steps[step - 1].icon} {steps[step - 1].title}</div>

      {#if step === steps.length}
        <div class="wizard-resumen">
          {#each getResumenItems() as item}
            <div class="resumen-row">
              <span class="resumen-icon">{item.icon}</span>
              <div class="resumen-body">
                <span class="resumen-label">{item.label}</span>
                <span class="resumen-value">{item.items || 'Ninguno'}</span>
              </div>
            </div>
          {/each}
          <div class="resumen-row" style="border-top:1px solid rgba(255,255,255,0.08);margin-top:0.5rem;padding-top:0.75rem;">
            <span class="resumen-icon">{tipoDesdeGrados === 'Primaria' ? '🏫' : '🏛️'}</span>
            <div class="resumen-body">
              <span class="resumen-label">{t("welcome.wizard.tipo")}</span>
              <span class="resumen-value">{tipoDesdeGrados} · {cantidadPrimaria} primaria / {cantidadSecundaria} secundaria</span>
            </div>
          </div>
          <p style="color:#64748b;font-size:0.8rem;text-align:center;margin-top:1rem;">
            Los cortes evaluativos y la configuración de calificaciones se incluirán automáticamente.
          </p>
        </div>
      {:else}
        <div class="wizard-items">
          {#if stepKey() === 'grados'}
            <!-- GRADOS: catálogo precargado con toggles (sin checkboxes) -->
            <div class="wizard-tipo-row">
              <span class="wizard-tipo-label">Tipo:</span>
              <div class="wizard-tipo-segmented">
                <button class="wizard-tipo-btn" class:active={tipoDesdeGrados === 'Primaria'} onclick={() => { gradosMarcados = gradosPrimaria; }}>🏫 {t("welcome.wizard.primaria")}</button>
                <button class="wizard-tipo-btn" class:active={tipoDesdeGrados === 'Secundaria'} onclick={() => { gradosMarcados = gradosSecundaria; }}>🏛️ {t("welcome.wizard.secundaria")}</button>
              </div>
            </div>
            <p class="wizard-hint">
              {t("welcome.wizard.hintGrados")}
            </p>

            {#each ['Primaria', 'Secundaria'] as nivel}
              {@const lista = GRADOS_CATALOGO.filter(g => g.nivel === nivel)}
              {@const marcadosDelNivel = lista.filter(g => gradosMarcados.includes(g.nombre)).length}
              <div class="wizard-grupo-head">
                <span class="wizard-grupo-titulo" class:secundaria={nivel === 'Secundaria'}>
                  {nivel === 'Primaria' ? '🏫 ' + t('welcome.wizard.primaria') : '🏛️ ' + t('welcome.wizard.secundaria')}
                </span>
                <span class="wizard-grupo-cont">{marcadosDelNivel}/{lista.length}</span>
                <button class="wizard-grupo-all" class:active={marcadosDelNivel === lista.length} onclick={() => toggleTodosGrados(nivel as 'Primaria' | 'Secundaria')}>
                  {marcadosDelNivel === lista.length ? 'Quitar todos' : 'Todos'}
                </button>
              </div>
              <div class="wizard-toggle-grid">
                {#each lista as g (g.nombre)}
                  <button class="wizard-toggle-card" class:active={gradosMarcados.includes(g.nombre)} onclick={() => toggleGrado(g.nombre)}>
                    <span class="wizard-toggle-check">{#if gradosMarcados.includes(g.nombre)}✓{/if}</span>
                    <span class="wizard-toggle-name">{g.nombre}</span>
                  </button>
                {/each}
              </div>
            {/each}
          {:else if stepKey() === 'secciones'}
            <!-- SECCIONES: catálogo precargado con toggles -->
            <div class="wizard-grupo-head">
              <span class="wizard-grupo-titulo">👥 Secciones</span>
              <span class="wizard-grupo-cont">{seccionesMarcadas.length}/{SECCIONES_CATALOGO.length}</span>
              <button class="wizard-grupo-all" class:active={seccionesMarcadas.length === SECCIONES_CATALOGO.length} onclick={toggleTodasSecciones}>
                {seccionesMarcadas.length === SECCIONES_CATALOGO.length ? 'Quitar todas' : 'Todas'}
              </button>
            </div>
            <p class="wizard-hint">{t("welcome.wizard.hintSecciones")}</p>
            <div class="wizard-toggle-grid secciones">
            {#each SECCIONES_CATALOGO as s (s)}
              <button class="wizard-toggle-card seccion" class:active={seccionesMarcadas.includes(s)} onclick={() => toggleSeccion(s)} title={t("welcome.wizard.seccionTitle", { s })}>
                <span class="wizard-toggle-check">{#if seccionesMarcadas.includes(s)}✓{/if}</span>
                <span class="wizard-toggle-name">{s}</span>
              </button>
            {/each}
            </div>

          {:else if stepKey() === 'colegios'}
            <div class="wizard-hint">
              {#if tipoDesdeGrados === 'Secundaria'}
                {t("welcome.wizard.tipoAplicara1")} 🏛️ <strong>{t("welcome.wizard.secundaria")}</strong> {t("welcome.wizard.tipoAplicara2")}
              {:else}
                {t("welcome.wizard.tipoAplicara1")} 🏫 <strong>{t("welcome.wizard.primaria")}</strong> {t("welcome.wizard.tipoAplicara2")}
              {/if}
            </div>
            <div class="wizard-input-row">
              <input class="wizard-input" type="text" placeholder={t("welcome.wizard.phColegio")}
                bind:value={currentInput}
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCurrentItem(); } }} />
              <button class="wizard-add-btn" onclick={addCurrentItem}>{t("welcome.wizard.agregar")}</button>
            </div>
            {#if inputColegios.length === 0}
              <p class="wizard-empty">{t("welcome.wizard.sinColegios")}</p>
            {:else}
              <div class="wizard-colegios">
                {#each inputColegios as col, ci}
                  <div class="wizard-colegio-card">
                    <div class="wizard-colegio-head">
                      <span class="wizard-colegio-name">{col.nombre}</span>
                      <span class="wizard-colegio-tipo-badge" class:secundaria={tipoDesdeGrados === 'Secundaria'}>
                        {tipoDesdeGrados === 'Primaria' ? '🏫 Primaria' : '🏛️ Secundaria'}
                      </span>
                      <button class="wizard-chip-x" onclick={() => removeItem(ci)} aria-label="Eliminar">×</button>
                    </div>
                    <div class="wizard-colegio-label">{t("welcome.wizard.diasClases")}</div>
                    <div class="wizard-dias">
                      {#each diasKeys as dk}
                        <button class="wizard-dia" class:active={col.dias[dk]} onclick={() => toggleDia(ci, dk)}>{diaShort(dk)}</button>
                      {/each}
                    </div>
                    <div class="wizard-colegio-label">{t("welcome.wizard.asignaturasImparte")}</div>
                    <div class="wizard-asig">
                      {#each asignaturasElegidas() as a}
                        <button class="wizard-asig-chip" class:active={col.asignaturas.includes(a.nombre)} onclick={() => toggleAsignaturaColegio(ci, a.nombre)}>{a.nombre}</button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {:else if stepKey() === 'asignaturas'}
            <!-- ASIGNATURAS: catálogo precargado con toggles (sin checkboxes) -->
            <p class="wizard-hint">
              {t("welcome.wizard.hintAsignaturas")}
            </p>

            {#each [{ clave: false, titulo: t("welcome.wizard.grupoCuantitativas") }, { clave: true, titulo: t("welcome.wizard.grupoCualitativas") }] as grupo (grupo.titulo)}
              {@const lista = ASIGNATURAS_CATALOGO.filter(a => a.cualitativo === grupo.clave)}
              {@const marcadas = lista.filter(a => asignaturasCatalogo.includes(a.nombre)).length}
              <div class="wizard-grupo-head">
                <span class="wizard-grupo-titulo">{grupo.titulo}</span>
                <span class="wizard-grupo-cont">{marcadas}/{lista.length}</span>
                <button class="wizard-grupo-all" class:active={marcadas === lista.length} onclick={() => toggleTodasAsignaturas(grupo.clave)}>
                  {marcadas === lista.length ? 'Quitar todas' : 'Todas'}
                </button>
              </div>
              <div class="wizard-toggle-grid asignaturas">
                {#each lista as a (a.nombre)}
                  <button class="wizard-toggle-card" class:cual={a.cualitativo} class:active={asignaturasCatalogo.includes(a.nombre)}
                    onclick={() => toggleAsignaturaCatalogo(a.nombre)} title={a.nombre}>
                    <span class="wizard-toggle-check">{#if asignaturasCatalogo.includes(a.nombre)}✓{/if}</span>
                    <span class="wizard-toggle-name">{a.nombre}</span>
                  </button>
                {/each}
              </div>
            {/each}

            {#if asignaturasPropias.length > 0}
              <div class="wizard-grupo-head">
                <span class="wizard-grupo-titulo">✏️ Agregadas por vos</span>
                <span class="wizard-grupo-cont">{asignaturasPropias.length}</span>
              </div>
              <div class="wizard-toggle-grid asignaturas">
                {#each asignaturasPropias as a, i (a.nombre)}
                  <button class="wizard-toggle-card activeown" onclick={() => asignaturasPropias = asignaturasPropias.filter((_, j) => j !== i)}>
                    <span class="wizard-toggle-check">✓</span>
                    <span class="wizard-toggle-name">{a.nombre}</span>
                    {#if a.cualitativo}<span class="wizard-asig-flag">C</span>{/if}
                  </button>
                {/each}
              </div>
            {/if}

            <div class="wizard-input-row" style="margin-top:0.9rem;">
              <input class="wizard-input" type="text" placeholder={t("welcome.wizard.phAsignatura")}
                bind:value={currentInput}
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCurrentItem(); } }} />
              <button class="wizard-add-btn" onclick={addCurrentItem}>{t("welcome.wizard.agregar")}</button>
            </div>
          {:else}
            <div class="wizard-input-row">
              <input class="wizard-input" type="text" placeholder={inputPlaceholder()}
                bind:value={currentInput}
                onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCurrentItem(); } }} />
              <button class="wizard-add-btn" onclick={addCurrentItem}>{t("welcome.wizard.agregar")}</button>
            </div>
            {#if currentItems().length === 0}
              <p class="wizard-empty">{t("welcome.wizard.sinItems", { item: stepLabel() })}</p>
            {:else}
              <div class="wizard-chips">
              {#each currentItems() as item, i}
                <div class="wizard-chip">
                  <span>{chipLabel(item)}</span>
                  <button class="wizard-chip-x" onclick={() => removeItem(i)} aria-label="Eliminar">×</button>
                </div>
              {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      {#if errorMsg}
        <div class="welcome-error">{errorMsg}</div>
        {#if errorMsgTecnico}
          <details class="welcome-error-detalle">
            <summary>Detalle técnico</summary>
            <pre>{errorMsgTecnico}</pre>
          </details>
        {/if}
        <p class="welcome-diag">
          Diagnóstico: cuenta <code>{driveAccount || '—'}</code> ·
          respaldos en Drive: <code>{driveFilesCount === null ? '?' : driveFilesCount}</code>
          {#if driveBackupInfo}
            <br />restaurado: <code>{driveBackupInfo.name}</code> ·
            tamaño: <code>{(driveBackupInfo.size / 1024).toFixed(1)} KB</code>
          {/if}
          {#if driveDescartados.length > 0}
            <br />descartados: {#each driveDescartados as d, i}<code>{d}</code>{i < driveDescartados.length - 1 ? ' · ' : ''}{/each}
          {/if}
        </p>
      {/if}

      <div class="wizard-nav">
        <button class="wizard-btn" onclick={prevStep} disabled={step === 1}>← Anterior</button>
        <div class="wizard-step-counter">{step} / {steps.length}</div>
        {#if step < steps.length}
          <button class="wizard-btn primary" onclick={nextStep} disabled={!puedeAvanzar()}>{t("welcome.wizard.siguiente")}</button>
        {:else}
          <button class="wizard-btn primary" onclick={handleWizardComplete} disabled={loading}>
            {loading ? 'Guardando...' : 'Comenzar'}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Modal emergente de progreso (login / sync / descarga) -->
  {#if loading}
    <div class="loading-overlay">
      <div class="loading-modal">
        {#if downloadProgress}
          <div class="dl-progress-wrap">
            <div class="dl-progress-bar">
              <div class="dl-progress-fill" style="width: {downloadProgress.pct}%;"></div>
            </div>
            <p class="welcome-loading-text">
              Descargando base de datos · {downloadProgress.pct}%
              {#if downloadProgress.total > 0}
                · {fmtBytes(downloadProgress.loaded)} / {fmtBytes(downloadProgress.total)}
              {:else}
                · {fmtBytes(downloadProgress.loaded)}
              {/if}
            </p>
          </div>
        {:else}
          <div class="welcome-logo loading-spin">
            <img src={appIcon} alt="" draggable="false" />
          </div>
          <div class="welcome-loading-bar">
            <div class="welcome-loading-bar-inner"></div>
          </div>
        {/if}
        <p class="welcome-loading-text">{loadingMessage}</p>
        {#if loadingMessageFile}
          <p class="dl-file-name" title={loadingMessageFile}>{loadingMessageFile}</p>
        {/if}
        <button onclick={cancelAuth}>{t("comun.cancelar")}</button>
      </div>
    </div>
  {/if}

  <!-- Modal: error transitorio de la nube (cuota agotada / red / pull vacío). Permite reintentar. -->
  {#if showCloudRetry}
    {@const info = friendlyCloudError(cloudRetryError)}
    <div class="loading-overlay">
      <div class="loading-modal" style="gap:0.6rem;">
        <div style="font-size:2rem;">☁️⚠️</div>
        <h3 style="margin:0;color:#f1f5f9;font-size:1.05rem;font-weight:700;text-align:center;">{info.title}</h3>
        <p style="margin:0;color:#94a3b8;font-size:0.82rem;text-align:center;line-height:1.4;">
          {info.body}
        </p>
        {#if cloudRetryError}
          <details style="width:100%;max-width:320px;">
            <summary style="cursor:pointer;color:#64748b;font-size:0.72rem;">{t("welcome.wizard.verDetalle")}</summary>
            <pre style="margin:0.4rem 0 0;color:#94a3b8;font-size:0.7rem;white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.25);padding:0.5rem;border-radius:8px;max-height:120px;overflow:auto;">{cloudRetryError}</pre>
          </details>
        {/if}
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:center;width:100%;">
          <button onclick={retryCloudRestore} style="background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;border:none;">
            🔄 Reintentar descarga
          </button>
          {#if isDriveLinked()}
            <button onclick={restoreFromDrive} style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;">
              📥 Restaurar desde Drive
            </button>
          {/if}
          <button onclick={forceManualSetup} style="border-color:rgba(148,163,184,0.35);color:#cbd5e1;">
            ⚙️ Configurar manualmente
          </button>
        </div>
        {#if isDriveLinked()}
          <p style="margin:0;color:#64748b;font-size:0.7rem;text-align:center;line-height:1.35;">
            Google Drive está vinculado con tu cuenta. Si tienes respaldos recientes ahí, puedes restaurar sin esperar a que se libere la cuota de Cloudflare.
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Anti-resaltado táctil (WebView Android deja las tarjetas "enfocadas" en azul) */
  button {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }
  .welcome-card:focus, .welcome-back:focus, .wizard-item:focus,
  .wizard-btn:focus, .wizard-back:focus { outline: none; }

  .welcome-page {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: var(--bg-primary, #0f172a); z-index: 10000; overflow-y: auto; overflow-x: hidden; padding: 1rem;
  }
  /* Orbes ambientales de vidrio */
  .orbs { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .orb { position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.45; will-change: transform; animation: orbDrift 16s ease-in-out infinite alternate; }
  .orb-a { width: 300px; height: 300px; background: #2563eb; top: -80px; left: -90px; }
  .orb-b { width: 260px; height: 260px; background: #7c3aed; bottom: -60px; right: -80px; animation-delay: -8s; }
  .orb-c { width: 200px; height: 200px; background: #0891b2; top: 38%; left: 58%; opacity: 0.22; animation-delay: -4s; }
  @keyframes orbDrift {
    from { transform: translate3d(0, 0, 0) scale(1); }
    to { transform: translate3d(26px, -20px, 0) scale(1.1); }
  }
  .welcome-container {
    width: 100%; max-width: 520px; display: flex; flex-direction: column; align-items: center; gap: 1.5rem;
  }
  .wizard-container { max-width: 580px; }
  .welcome-brand { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
  /* Compactación Android: header en fila horizontal (logo pequeño + textos)
     para que las cards quepan sin hacer scroll en pantallas chicas. */
  .welcome-brand-row { display: flex; align-items: center; gap: 0.85rem; align-self: stretch; }
  .welcome-brand-text { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; text-align: left; flex: 1; min-width: 0; }
  .welcome-logo {
    width: 128px; height: 128px; display: flex; align-items: center; justify-content: center;
    border-radius: 32px;
    box-shadow: 0 18px 56px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.1);
    animation: floatY 6s ease-in-out infinite;
    user-select: none; -webkit-user-drag: none; flex-shrink: 0;
  }
  .welcome-logo-sm { width: 56px; height: 56px; border-radius: 14px; box-shadow: 0 8px 24px rgba(59,130,246,0.22), inset 0 1px 0 rgba(255,255,255,0.08); animation: none; }
  .welcome-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 32px; -webkit-user-drag: none; }
  @keyframes floatY { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  .welcome-title {
    margin: 0; font-size: 2rem; font-weight: 700; letter-spacing: -0.5px;
    background: linear-gradient(135deg, #f8fafc 20%, #cbd5e1 55%, #93c5fd);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .welcome-title-sm { font-size: 1.25rem; }
  .welcome-subtitle { margin: 0; color: #64748b; font-size: 0.9rem; }
  /* Compactación Android: menos gap entre secciones y cards más delgados */
  .welcome-container.android { gap: 0.85rem; }
  .welcome-cards { display: flex; flex-direction: column; gap: 0.9rem; width: 100%; }
  .welcome-cards.android { gap: 0.55rem; }
  .welcome-card {
    position: relative; overflow: hidden;
    display: flex; align-items: center; gap: 0.95rem; padding: 1.15rem 1.2rem;
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
    backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px; cursor: pointer; text-align: left; width: 100%;
    color: inherit; font: inherit; user-select: none; -webkit-user-select: none;
    touch-action: manipulation;
    box-shadow: 0 12px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.06);
    transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }
  /* Cards compactos en Android: padding y gaps menores, fuente reducida */
  .welcome-card.android { padding: 0.7rem 0.85rem; gap: 0.7rem; border-radius: 14px; box-shadow: 0 6px 18px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05); }
  .welcome-card.android .welcome-card-icon { width: 38px; height: 38px; font-size: 1.2rem; border-radius: 11px; }
  .welcome-card.android .welcome-card-body h3 { font-size: 0.92rem; }
  .welcome-card.android .welcome-card-body p { font-size: 0.72rem; line-height: 1.3; -webkit-line-clamp: 1; line-clamp: 1; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
  .welcome-card.android .welcome-card-arrow { width: 26px; height: 26px; font-size: 0.85rem; }
  .welcome-card.android::before { top: 10px; bottom: 10px; width: 2.5px; }
  /* Barra de acento vertical por opción */
  .welcome-card::before {
    content: ''; position: absolute; left: 0; top: 16px; bottom: 16px; width: 3px;
    border-radius: 2px; opacity: 0.9;
    background: linear-gradient(180deg, var(--accent-from, #3b82f6), var(--accent-to, #8b5cf6));
  }
  .card-drive { --accent-from: #38bdf8; --accent-to: #2563eb; }
  .card-google { --accent-from: #34a853; --accent-to: #1a73e8; }
  .welcome-card:hover:not(:disabled) {
    border-color: rgba(255,255,255,0.16);
    background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03));
    transform: translateY(-2px);
    box-shadow: 0 18px 44px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.09);
  }
  /* Presión táctil en lugar del resaltado azul nativo */
  .welcome-card:active:not(:disabled) {
    transform: translateY(1px) scale(0.995);
    box-shadow: 0 6px 18px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .welcome-card:focus-visible {
    border-color: rgba(148,163,184,0.35);
    box-shadow: 0 0 0 3px rgba(148,163,184,0.16), 0 12px 32px rgba(0,0,0,0.28);
  }
  .welcome-card:disabled { opacity: 0.5; cursor: not-allowed; }
  .card-drive .welcome-card-icon {
    background: rgba(56,189,248,0.12); border-color: rgba(56,189,248,0.25);
    box-shadow: 0 4px 16px rgba(56,189,248,0.12), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .card-manual .welcome-card-icon {
    background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.25);
    box-shadow: 0 4px 16px rgba(167,139,250,0.12), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .card-key { --accent-from: #fbbf24; --accent-to: #f59e0b; }
  .card-key .welcome-card-icon {
    background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.25);
    box-shadow: 0 4px 16px rgba(251,191,36,0.12), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .card-import { --accent-from: #22d3ee; --accent-to: #0ea5e9; }
  .card-import .welcome-card-icon {
    background: rgba(34,211,238,0.12); border-color: rgba(34,211,238,0.25);
    box-shadow: 0 4px 16px rgba(34,211,238,0.12), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .welcome-card-icon {
    font-size: 1.55rem; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    border-radius: 14px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px);
  }
  .welcome-card-body { flex: 1; }
  .welcome-card-body h3 { margin: 0 0 0.25rem; font-size: 1rem; color: #e2e8f0; font-weight: 600; letter-spacing: -0.2px; }
  .welcome-card-body p { margin: 0; font-size: 0.8rem; color: #64748b; line-height: 1.45; }
  .welcome-card-arrow {
    width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.95rem; color: #94a3b8;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    transition: all 0.2s ease;
  }
  .welcome-card:hover:not(:disabled) .welcome-card-arrow {
    transform: translateX(3px); color: #e2e8f0; border-color: rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.09);
  }
  .welcome-back {
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    padding: 0.5rem 1rem; color: #94a3b8; cursor: pointer; font-size: 0.85rem; transition: all 0.2s ease;
    align-self: flex-start; font-family: inherit;
  }
  .welcome-back:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
  .welcome-loading { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
  /* Modal emergente de progreso */
  .loading-overlay {
    position: fixed; inset: 0; z-index: 100000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    animation: overlayIn 0.2s ease;
  }
  @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
  .loading-modal {
    /* `min()` solo acota el ancho, pero sin `box-sizing` el padding suma y el
       modal queda más ancho que su contenedor: por eso el texto se salía. */
    box-sizing: border-box;
    width: min(420px, 92vw); max-width: 92vw;
    padding: 1.75rem 1.5rem 1.4rem;
    display: flex; flex-direction: column; align-items: center; gap: 0.9rem;
    background: rgba(20,24,31,0.88); backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 22px;
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06);
    /* Nada puede desbordar el modal: los nombres de archivo son larguísimos. */
    overflow: hidden;
    max-height: 90vh;
  }
  /* Hijos que pueden ocupar todo el ancho útil sin empujar al modal. */
  .loading-modal > * { max-width: 100%; box-sizing: border-box; }
  .loading-spin { animation: floatY 2.6s ease-in-out infinite; width: 72px !important; height: 72px !important; border-radius: 18px !important; }
  .loading-spin img { border-radius: 18px !important; }
  .loading-modal button {
    margin-top: 0.35rem; background: transparent;
    border: 1px solid rgba(239,68,68,0.35); color: #f87171;
    padding: 0.45rem 1.25rem; border-radius: 8px; cursor: pointer;
    font-size: 0.8rem; font-weight: 600; transition: all 0.2s ease;
  }
  .loading-modal button:hover { background: rgba(239,68,68,0.08); }
  .welcome-loading-bar { width: 100%; max-width: 320px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
  .welcome-loading-bar-inner { width: 100%; height: 100%; background: linear-gradient(90deg, var(--primary-color, #3b82f6), #a78bfa); border-radius: 2px; animation: loadingBar 1.5s ease-in-out infinite; }
  .welcome-loading-text {
    margin: 0; color: #64748b; font-size: 0.8rem;
    /* El mensaje puede traer un nombre de archivo largo: se parte por palabras
       y se recorta en vez de desbordar el modal. */
    max-width: 100%; text-align: center;
    line-height: 1.45;
    overflow-wrap: anywhere; word-break: break-word;
  }
  /* Nombre del archivo: se muestra entero en su propia línea, con wrap. */
  .dl-file-name {
    max-width: 100%; margin: 0;
    font-family: ui-monospace, monospace; font-size: 0.68rem; line-height: 1.4;
    color: #94a3b8; text-align: center;
    overflow-wrap: anywhere; word-break: break-all;
  }
  .dl-progress-wrap { width: 100%; max-width: 320px; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
  .dl-progress-bar { width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); }
  .dl-progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary-color, #3b82f6), #a78bfa); border-radius: 4px; transition: width 0.2s ease; box-shadow: 0 0 12px rgba(59,130,246,0.35); }
  @keyframes loadingBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
  .welcome-error { color: #f87171; font-size: 0.85rem; text-align: center; padding: 0.6rem 1rem; background: rgba(248,113,113,0.08); border-radius: 10px; width: 100%; max-width: 400px; border: 1px solid rgba(248,113,113,0.15); }
  /* Detalle técnico del fallo de conexión: plegado por default para no competir
     con el mensaje principal, pero a un clic de distancia. Mismo patrón que el
     bloque de diagnóstico de Drive, que ya existía para el mismo propósito. */
  .welcome-error-detalle {
    width: 100%; max-width: 400px; margin-top: 0.35rem;
    background: rgba(0,0,0,0.25); border: 1px solid rgba(148,163,184,0.2);
    border-radius: 8px; padding: 0.35rem 0.5rem; text-align: left;
  }
  .welcome-error-detalle summary {
    cursor: pointer; color: #94a3b8; font-size: 0.7rem; font-weight: 600;
    list-style: none; user-select: none;
  }
  .welcome-error-detalle summary::-webkit-details-marker { display: none; }
  .welcome-error-detalle summary::before { content: '▸ '; }
  .welcome-error-detalle[open] summary::before { content: '▾ '; }
  .welcome-error-detalle pre {
    margin: 0.4rem 0 0.2rem; color: #94a3b8; font-size: 0.68rem;
    white-space: pre-wrap; word-break: break-word; max-height: 140px; overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .wizard-progress { display: flex; align-items: center; gap: 0; width: 100%; max-width: 320px; }
  .wizard-step-dot { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
  .wizard-step-dot.active { border-color: var(--primary-color, #3b82f6); box-shadow: 0 0 0 3px rgba(59,130,246,0.2); }
  .wizard-step-dot.done { background: rgba(59,130,246,0.2); border-color: var(--primary-color, #3b82f6); }
  .wizard-step-line { flex: 1; height: 2px; background: rgba(255,255,255,0.08); }
  .wizard-step-line.done { background: var(--primary-color, #3b82f6); }
  .wizard-step-label { font-size: 0.9rem; color: #94a3b8; font-weight: 600; text-align: center; }

  .wizard-items { width: 100%; }
  .wizard-select-all { margin-bottom: 0.75rem; }
  /* ── Portada: 3 opciones + accesos secundarios ── */
  .welcome-card-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.5rem; }
  .welcome-tag {
    font-size: 0.6rem; font-weight: 700; letter-spacing: 0.3px;
    padding: 0.14rem 0.45rem; border-radius: 6px;
    background: rgba(255,255,255,0.06); color: #94a3b8;
    border: 1px solid rgba(255,255,255,0.08);
  }
  .card-cloud { --accent-from: #38bdf8; --accent-to: #6366f1; }
  .card-manual { --accent-from: #f472b6; --accent-to: #a78bfa; }

  .welcome-link {
    display: inline-flex; align-items: center; gap: 0.35rem;
    padding: 0.5rem 0.85rem; border-radius: 9px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    color: #64748b; font-size: 0.75rem; font-weight: 600;
    cursor: pointer; transition: all 0.18s ease;
  }
  .welcome-link:hover:not(:disabled) {
    background: rgba(255,255,255,0.05); color: #94a3b8; border-color: rgba(255,255,255,0.12);
  }
  .welcome-link:disabled { opacity: 0.4; cursor: not-allowed; }
  .welcome-diag {
    font-size: 0.68rem; color: #64748b; text-align: center;
    margin: 0.4rem 0 0; line-height: 1.5;
  }
  .welcome-diag code {
    font-family: ui-monospace, monospace;
    background: rgba(255,255,255,0.06); padding: 0.05rem 0.3rem;
    border-radius: 4px; color: #94a3b8;
  }

  /* ── Toggles de catálogo (grados / secciones) ──
     Reemplazan a los checkboxes: tarjetas clicables con estado visible.
     Ver "Regla de Toggles" en AGENTS.md. */
  .wizard-hint {
    color: #94a3b8; font-size: 0.78rem; line-height: 1.5;
    margin: 0 0 0.9rem; text-align: center;
  }
  .wizard-grupo-head { display: flex; align-items: center; gap: 0.6rem; margin: 1rem 0 0.6rem; }
  .wizard-grupo-titulo {
    font-size: 0.8rem; font-weight: 700; color: #e2e8f0;
    display: flex; align-items: center; gap: 0.35rem;
  }
  .wizard-grupo-titulo.secundaria { color: #c4b5fd; }
  .wizard-grupo-cont {
    font-size: 0.68rem; font-weight: 700; color: #64748b;
    background: rgba(255,255,255,0.05); padding: 0.1rem 0.4rem; border-radius: 10px;
  }
  .wizard-grupo-all {
    margin-left: auto; padding: 0.28rem 0.7rem; font-size: 0.7rem; font-weight: 700;
    border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04); color: #94a3b8;
    cursor: pointer; transition: all 0.18s ease;
  }
  .wizard-grupo-all:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
  .wizard-grupo-all.active {
    background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.35); color: #fca5a5;
  }
  .wizard-toggle-card {
    display: flex; align-items: center; gap: 0.45rem; padding: 0.6rem 0.55rem;
    border-radius: 11px; border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04); color: #94a3b8;
    cursor: pointer; font-size: 0.76rem; font-weight: 600; text-align: left;
    transition: all 0.18s ease;
  }
  .wizard-toggle-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.14); }
  .wizard-toggle-card.active {
    background: rgba(59,130,246,0.18); border-color: var(--primary-color, #3b82f6); color: #dbeafe;
  }
  .wizard-toggle-check {
    width: 18px; height: 18px; flex-shrink: 0; border-radius: 6px;
    border: 1.5px solid rgba(255,255,255,0.22);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.65rem; color: transparent; transition: all 0.18s ease;
  }
  .wizard-toggle-card.active .wizard-toggle-check {
    background: var(--primary-color, #3b82f6);
    border-color: var(--primary-color, #3b82f6); color: #fff;
  }
  /* `nowrap`: con `break-word` una etiqueta que no entra en la celda partía la
     última letra a la línea de abajo y la tarjeta crecía de alto. Si no cabe,
     que se recorte con puntos suspensivos. */
  .wizard-toggle-name { min-width: 0; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Secciones: solo la letra, así que la celda puede ser compacta. */
  .wizard-toggle-grid { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); }
  /* Secciones: solo la letra, celda compacta. */
  .wizard-toggle-grid.secciones { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }
  /* Asignaturas: nombres largos ("Convivencia & Civismo"), celda ancha para que
     el nombre entre entero en vez de recortarse. */
  .wizard-toggle-grid.asignaturas { grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); }
  .wizard-toggle-card.seccion { justify-content: center; gap: 0.5rem; padding: 0.7rem 0.6rem; }
  .wizard-toggle-card.seccion .wizard-toggle-name {
    font-size: 1.05rem; font-weight: 800; letter-spacing: 0.5px; color: inherit;
  }
  /* Asignatura cualitativa: violeta para que se distinga al primer vistazo. */
  .wizard-toggle-card.cual.active {
    background: rgba(168,85,247,0.18); border-color: #a78bfa; color: #e9d5ff;
  }
  .wizard-toggle-card.cual.active .wizard-toggle-check { background: #a78bfa; border-color: #a78bfa; color: #fff; }
  /* Materia escrita a mano: se quita con un clic (no tiene toggle de catálogo). */
  .wizard-toggle-card.activeown {
    background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.4); color: #bbf7d0;
  }
  .wizard-toggle-card.activeown .wizard-toggle-check { background: #22c55e; border-color: #22c55e; color: #fff; }
  .wizard-asig-flag {
    margin-left: auto; font-size: 0.55rem; font-weight: 800;
    padding: 0.05rem 0.25rem; border-radius: 4px;
    background: rgba(168,85,247,0.25); color: #e9d5ff;
  }

  /* Inputs libres del asistente manual */
  .wizard-input-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .wizard-input {
    flex: 1; padding: 0.6rem 0.75rem; border-radius: 10px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #e2e8f0; font-size: 0.85rem; font-family: inherit; outline: none;
    transition: all 0.2s ease;
  }
  .wizard-input:focus { border-color: var(--primary-color, #3b82f6); box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
  .wizard-add-btn {
    padding: 0.6rem 1rem; border-radius: 10px; cursor: pointer; font-size: 0.8rem; font-weight: 600; font-family: inherit;
    background: linear-gradient(135deg, var(--primary-color, #3b82f6), #a78bfa); color: #fff; border: none;
    transition: all 0.2s ease;
  }
  .wizard-add-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(59,130,246,0.25); }
  .wizard-add-btn:active { transform: translateY(1px); }
  .wizard-empty { color: #64748b; font-size: 0.8rem; text-align: center; padding: 1rem; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; }
  .wizard-colegios { display: flex; flex-direction: column; gap: 0.75rem; max-height: 320px; overflow-y: auto; padding: 0.15rem; }
  .wizard-colegio-card {
    background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
    border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 0.9rem 1rem;
    box-shadow: 0 3px 14px rgba(15,23,42,0.4), inset 0 1px 0 rgba(255,255,255,0.06);
    transition: border-color 0.2s ease;
  }
  .wizard-colegio-card:hover { border-color: rgba(255,255,255,0.16); }
  .wizard-colegio-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
  .wizard-colegio-name { font-size: 0.95rem; font-weight: 700; color: #e2e8f0; }
  .wizard-colegio-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin: 0.5rem 0 0.35rem; }
  .wizard-dias { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .wizard-dia {
    width: 36px; height: 36px; border-radius: 10px; cursor: pointer;
    font-size: 0.85rem; font-weight: 700; font-family: inherit;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    color: #64748b; transition: all 0.2s ease;
  }
  .wizard-dia:hover { border-color: rgba(129,140,248,0.5); color: #c7d2fe; transform: translateY(-1px); }
  .wizard-dia.active {
    background: linear-gradient(135deg, #3b82f6, #a78bfa); color: #fff;
    border-color: transparent; box-shadow: 0 4px 14px rgba(59,130,246,0.4);
  }
  .wizard-asig { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .wizard-asig-chip {
    padding: 0.4rem 0.7rem; border-radius: 9px; cursor: pointer; font-size: 0.78rem; font-family: inherit;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; transition: all 0.2s ease;
  }
  .wizard-asig-chip:hover { border-color: #a78bfa; color: #e2e8f0; }
  .wizard-asig-chip.active { background: rgba(168,85,247,0.16); border-color: rgba(168,85,247,0.5); color: #d8b4fe; }
  .wizard-tipo-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .wizard-tipo-label { font-size: 0.75rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .wizard-tipo-segmented { display: flex; gap: 0.35rem; }
  .wizard-tipo-btn {
    padding: 0.35rem 0.7rem; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-family: inherit; font-weight: 600;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; transition: all 0.2s ease;
  }
  .wizard-tipo-btn:hover { border-color: rgba(255,255,255,0.2); color: #e2e8f0; }
  .wizard-tipo-btn.active { background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; border-color: transparent; box-shadow: 0 2px 8px rgba(59,130,246,0.25); }
  .wizard-colegio-tipo-badge {
    font-size: 0.65rem; padding: 0.15rem 0.45rem; border-radius: 4px; font-weight: 600;
    background: rgba(59,130,246,0.15); color: #60a5fa;
  }
  .wizard-colegio-tipo-badge.secundaria { background: rgba(168,85,247,0.15); color: #a78bfa; }
  .wizard-chips {
    display: flex; flex-wrap: wrap; gap: 0.55rem;
    max-height: 280px; overflow-y: auto; padding: 0.2rem;
  }
  /* Chip moderno: tarjeta glass con borde de acento, brillo al hover y barra
     lateral de color. Nada de la "píldora plana" azul de antes. */
  .wizard-chip {
    position: relative; display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 0.55rem 0.7rem 0.55rem 0.85rem;
    background: linear-gradient(135deg, rgba(59,130,246,0.16), rgba(99,102,241,0.10));
    border: 1px solid rgba(129,140,248,0.32);
    border-radius: 12px;
    color: #e0e7ff; font-size: 0.82rem; font-weight: 600;
    box-shadow: 0 2px 10px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.07);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    overflow: hidden;
  }
  /* Barra de acento a la izquierda (mismo lenguaje que las tarjetas de la portada). */
  .wizard-chip::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: linear-gradient(180deg, #60a5fa, #a78bfa);
    border-radius: 12px 0 0 12px;
  }
  .wizard-chip:hover {
    transform: translateY(-2px);
    border-color: rgba(165,180,252,0.6);
    box-shadow: 0 8px 20px rgba(59,130,246,0.28), inset 0 1px 0 rgba(255,255,255,0.12);
  }
  .wizard-chip:active { transform: translateY(0); }
  .wizard-chip-x {
    width: 19px; height: 19px; border-radius: 6px; border: none; cursor: pointer;
    background: rgba(255,255,255,0.1); color: #c7d2fe; font-size: 0.9rem; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.18s ease; flex-shrink: 0;
  }
  .wizard-chip-x:hover { background: rgba(239,68,68,0.28); color: #fecaca; transform: rotate(90deg); }

  .wizard-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; max-height: 280px; overflow-y: auto; padding: 0.15rem; }
  .wizard-item {
    display: flex; flex-direction: column; align-items: center; gap: 0.3rem; padding: 0.75rem 0.5rem;
    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;
    cursor: pointer; transition: all 0.2s ease; color: #cbd5e1; font: inherit; font-size: 0.75rem;
  }
  .wizard-item.selected { border-color: var(--primary-color, #3b82f6); background: rgba(59,130,246,0.08); color: #e2e8f0; }
  .wizard-item:hover { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
  .wizard-check { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; }
  .wizard-item.selected .wizard-check { border-color: var(--primary-color, #3b82f6); background: var(--primary-color, #3b82f6); }
  .wizard-item-name { text-align: center; word-break: break-word; line-height: 1.3; }
  .wizard-item-badge { font-size: 0.6rem; padding: 0.15rem 0.4rem; border-radius: 4px; background: rgba(168,85,247,0.15); color: #a78bfa; font-weight: 600; }

  .wizard-nav { display: flex; align-items: center; gap: 0.75rem; width: 100%; justify-content: space-between; }
  .wizard-btn { padding: 0.5rem 1rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: #cbd5e1; cursor: pointer; font-size: 0.8rem; transition: all 0.2s ease; font-family: inherit; }
  .wizard-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
  .wizard-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .wizard-btn.primary { background: var(--primary-color, #3b82f6); color: #fff; border-color: var(--primary-color, #3b82f6); }
  .wizard-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .wizard-step-counter { font-size: 0.8rem; color: #64748b; font-weight: 600; }

  .wizard-resumen { width: 100%; display: flex; flex-direction: column; gap: 0.5rem; }
  .resumen-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); }
  .resumen-icon { font-size: 1.2rem; width: 32px; text-align: center; }
  .resumen-body { flex: 1; }
  .resumen-label { display: block; font-size: 0.7rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .resumen-value { display: block; font-size: 0.85rem; color: #e2e8f0; margin-top: 0.15rem; word-break: break-word; }
</style>
