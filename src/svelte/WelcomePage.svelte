<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
   import { emit, listen } from "@tauri-apps/api/event";
  import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
  import { readTextFile } from "@tauri-apps/plugin-fs";
  import { syncManager, type DownloadProgress } from "../lib/driveSyncService";
  import { setBackAuthInProgress, registerBackHandler } from "../lib/androidBack";
  import { iniciarSesionGoogleConNube } from "../lib/cloudLogin";
  import appIcon from "../assets/app-icon.png";

  let view: 'landing' | 'cloud' | 'wizard' = $state('landing');
  let step = $state(1);
  let loading = $state(false);
  let loadingMessage = $state('');
  let errorMsg = $state('');

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

  let inputAnos = $state<string[]>([]);
  let inputColegios = $state<ColegioItem[]>([]);
  let inputGrados = $state<GradItem[]>([]);
  let inputSecciones = $state<string[]>([]);
  let inputAsignaturas = $state<GradItem[]>([]);
  let currentInput = $state('');
  let nuevoColegioTipo = $state<'Primaria' | 'Secundaria'>('Primaria');

  const steps = [
    { title: 'Años Lectivos', icon: '📅', key: 'anos' },
    { title: 'Asignaturas', icon: '📚', key: 'asignaturas' },
    { title: 'Colegios', icon: '🏫', key: 'colegios' },
    { title: 'Grados', icon: '📊', key: 'grados' },
    { title: 'Secciones', icon: '👥', key: 'secciones' },
    { title: 'Resumen', icon: '✅', key: 'resumen' },
  ];

  function cancelAuth() {
    setBackAuthInProgress(false);
    invoke("gd_cancel_oauth").catch(() => {});
    loading = false;
    loadingMessage = '';
    errorMsg = '';
  }

  function goToWizard() {
    view = 'wizard';
    step = 1;
    errorMsg = '';
    currentInput = '';
  }

  /**
   * Flujo común tras obtener credenciales (por .key o por login Google):
   * guarda la config en d1_config (protección anti-mezcla) y sincroniza.
   */
  async function conectarConCredenciales(workerUrl: string, schoolKey: string) {
    // Si ya existía una conexión con OTRAS credenciales, reemplazar limpio
    const previa = await invoke<any>('d1_get_config');
    if (previa && (previa.workerUrl !== workerUrl || previa.schoolKey !== schoolKey)) {
      const ok = await ask(
        'Ya existe una conexión a la nube con OTRAS credenciales.\n\n¿Reemplazarla? Se generará un nuevo ID de dispositivo y los datos locales se sincronizarán con la nube nueva.',
        { title: 'Reemplazar conexión', kind: 'warning', okLabel: 'Sí, reemplazar', cancelLabel: 'Cancelar' }
      );
      if (!ok) { loading = false; loadingMessage = ''; return; }
      await invoke('d1_clear_config');
    }
    await invoke('d1_save_config', { workerUrl, schoolKey });
    loadingMessage = 'Sincronizando con la nube...';
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<{ message?: string }>('d1-sync-progress', (e) => {
        if (e.payload?.message) loadingMessage = e.payload.message;
      });
    } catch { /* ignorable */ }
    try {
      await invoke('d1_restore_from_cloud');
    } catch (syncErr) {
      console.error('[Cloud] primer sync falló:', syncErr);
      const detail = (typeof syncErr === 'string' && syncErr.trim())
        ? syncErr
        : (syncErr?.message || JSON.stringify(syncErr));
      errorMsg = 'No se pudo sincronizar con el Worker.\n' + detail;
      loading = false; loadingMessage = '';
      return;
    } finally {
      if (unlisten) unlisten();
    }
    loadingMessage = 'Verificando datos...';
    const hasData = await invoke('is_app_initialized');
    if (hasData) {
      await invoke('set_app_initialized');
      emit('welcome-complete');
      setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
    } else {
      loading = false; loadingMessage = '';
      goToWizard();
    }
    loading = false;
    loadingMessage = '';
  }

  /**
   * Importa un archivo .key (exportado desde otro dispositivo en CloudPage)
   * con {workerUrl, schoolKey}. Los valores pasan una sola vez a Rust y quedan
   * guardados SOLO en la BD local (d1_config), nunca en localStorage/bundle.
   */
  async function importarArchivoConexion() {
    try {
      const ruta = await openDialog({
        title: 'Selecciona tu archivo de conexión',
        filters: [{ name: 'Conexión School Tracker', extensions: ['key', 'json'] }],
        multiple: false,
      });
      if (!ruta || typeof ruta !== 'string') return;
      loading = true;
      errorMsg = '';
      loadingMessage = 'Importando conexión...';
      const txt = await readTextFile(ruta);
      let cfg: any;
      try { cfg = JSON.parse(txt); } catch { throw new Error('El archivo no es un .key válido'); }
      if (!cfg.workerUrl || !cfg.schoolKey) throw new Error('El archivo no contiene workerUrl/schoolKey');
      await conectarConCredenciales(cfg.workerUrl, cfg.schoolKey);
    } catch (e: any) {
      errorMsg = 'Error importando conexión: ' + (typeof e === 'string' ? e : e?.message || String(e));
    }
    loading = false;
    loadingMessage = '';
  }

  /**
   * Importa una base de datos local en formato .db (respaldo) y, tras cargarla,
   * salta automáticamente al flujo "Continuar con Google" para vincular esa base
   * a la cuenta elegida. Si la cuenta tiene la nube de Cloudflare VACÍA, el
   * primer sync sube los datos importados (la nube deja de estar vacía).
   */
  async function importarBaseDatos() {
    try {
      const ruta = await openDialog({
        title: 'Selecciona tu base de datos (.db)',
        filters: [{ name: 'Base de datos School Tracker', extensions: ['db'] }],
        multiple: false,
      });
      if (!ruta || typeof ruta !== 'string') return;
      loading = true;
      errorMsg = '';
      loadingMessage = 'Importando base de datos...';
      await invoke('gd_import_db_from_file', { sourcePath: ruta });
      await invoke('gd_reload_database');
      loadingMessage = 'Vinculando con tu cuenta de Google...';
      // Desvincular la nube anterior que pudiera venir dentro del respaldo
      // (d1_config de otro dispositivo) para reconectar LIMPIO con la cuenta
      // de Google elegida en el siguiente paso.
      try { await invoke('d1_clear_config'); } catch {}
      // IMPORTANTE: NO usamos la school_key embebida en el .db (importedKey).
      // El Worker KV (user:email -> schoolKey) es la fuente de verdad; si
      // vinculamos con la clave del archivo, los datos quedarían en un namespace
      // distinto al de la cuenta y cada login/switch los vería vacíos. Al no
      // pasar preferredKey, iniciarSesionGoogleConNube usa result.schoolKey
      // (autoritativo) y sube el .db importado a la nube de la cuenta real.
      await handleCloudLogin();
    } catch (e: any) {
      errorMsg = 'Error importando base de datos: ' + (typeof e === 'string' ? e : e?.message || String(e));
      loading = false;
      loadingMessage = '';
    }
  }

  /**
   * LOGIN/REGISTRO con Google para el sync Cloudflare.
   * Reutiliza el flujo compartido (src/lib/cloudLogin.ts) que además vincula
   * Google Drive con la MISMA cuenta. Tras conectar, verifica si la nube ya
   * tiene datos para saltar el asistente.
   */
  async function handleCloudLogin(preferredKey?: string) {
    loading = true;
    errorMsg = '';
    // Si se invoca como handler de click, el primer argumento es un Event;
    // en ese caso no hay clave prefijada.
    if (preferredKey && typeof preferredKey !== 'string') preferredKey = undefined;
    try {
      const res = await iniciarSesionGoogleConNube({
        onStatus: (m) => { loadingMessage = m; },
        setBackAuth: setBackAuthInProgress,
        preferredKey,
      });
      if (res.status === 'ok') {
        loadingMessage = 'Verificando datos...';
        const hasData = await invoke('is_app_initialized');
        if (hasData) {
          await invoke('set_app_initialized');
          emit('welcome-complete');
          setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
        } else {
          loading = false; loadingMessage = '';
          goToWizard();
          return;
        }
      } else if (res.status === 'cancelled') {
        errorMsg = 'Autenticación cancelada';
      } else {
        errorMsg = res.error;
      }
    } catch (e: any) {
      errorMsg = typeof e === 'string' ? e : (e?.message || String(e));
    }
    loading = false;
    loadingMessage = '';
    setBackAuthInProgress(false);
  }

  /** Pide el permiso POST_NOTIFICATIONS (Android 13+) en la primera ejecución. */
  async function solicitarPermisoNotificaciones() {
    if (!/Android/i.test(navigator.userAgent)) return;
    // Solo pedir una vez por instalación (evita diálogos repetidos raros)
    if (localStorage.getItem('stp_notif_permiso_pedido')) return;
    localStorage.setItem('stp_notif_permiso_pedido', '1');
    try { await invoke('gd_request_notification_permission'); } catch (e) { console.error('Permiso notificaciones:', e); }
  }

  async function handleWizardComplete() {
    if (inputAnos.length === 0 || inputColegios.length === 0 || inputGrados.length === 0 ||
        inputSecciones.length === 0 || inputAsignaturas.length === 0) {
      errorMsg = 'Debes agregar al menos un elemento en cada categoría.';
      return;
    }
    loading = true;
    errorMsg = '';
    try {
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
          colegios: inputColegios.map((c) => ({ nombre: c.nombre.trim(), tipo: c.tipo, dias: c.dias, asignaturas: c.asignaturas })),
          grados,
          secciones: inputSecciones.map((s) => s.trim()),
          asignaturas,
        }
      });
      await invoke('set_app_initialized');
      emit('welcome-complete');
      setTimeout(() => { solicitarPermisoNotificaciones(); }, 1800);
    } catch (e: any) {
      errorMsg = 'Error guardando datos: ' + (e?.message || e);
    }
    loading = false;
  }

  function nextStep() { if (step < steps.length) step++; }
  function prevStep() { if (step > 1) step--; }

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
  const diasKeys: (keyof DiasClase)[] = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
  function defaultDias(): DiasClase {
    return { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: false, domingo: false };
  }
  function diaShort(k: keyof DiasClase): string {
    return { lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D' }[k];
  }
  function currentItems(): (string | GradItem | ColegioItem)[] {
    const k = stepKey();
    if (k === 'anos') return inputAnos;
    if (k === 'colegios') return inputColegios;
    if (k === 'grados') return inputGrados;
    if (k === 'secciones') return inputSecciones;
    return inputAsignaturas;
  }
  function setItems(arr: string[]) {
    const k = stepKey();
    if (k === 'anos') inputAnos = arr;
    else if (k === 'secciones') inputSecciones = arr;
  }
  function chipLabel(item: string | GradItem | ColegioItem): string {
    return typeof item === 'string' ? item : item.nombre;
  }
  function chipCualitativo(item: string | GradItem | ColegioItem): boolean {
    if (typeof item === 'string') return false;
    return (item as GradItem).cualitativo ?? false;
  }
  function addCurrentItem() {
    const v = currentInput.trim();
    if (!v) return;
    const k = stepKey();
    if (k === 'grados') {
      if (!inputGrados.some((g) => g.nombre.toLowerCase() === v.toLowerCase())) {
        inputGrados = [...inputGrados, { nombre: v, cualitativo: false }];
      }
    } else if (k === 'asignaturas') {
      if (!inputAsignaturas.some((a) => a.nombre.toLowerCase() === v.toLowerCase())) {
        inputAsignaturas = [...inputAsignaturas, { nombre: v, cualitativo: false }];
      }
    } else if (k === 'colegios') {
      if (!inputColegios.some((c) => c.nombre.toLowerCase() === v.toLowerCase())) {
        inputColegios = [...inputColegios, { nombre: v, tipo: nuevoColegioTipo, dias: defaultDias(), asignaturas: [] }];
        // Auto-agregar grados correspondientes al tipo del colegio
        const gradosTipo = nuevoColegioTipo === 'Primaria' ? gradosPrimaria : gradosSecundaria;
        const nuevosGrados = gradosTipo.filter(g => !inputGrados.some(eg => eg.nombre.toLowerCase() === g.toLowerCase()));
        if (nuevosGrados.length > 0) {
          inputGrados = [...inputGrados, ...nuevosGrados.map(g => ({ nombre: g, cualitativo: false }))];
        }
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
    if (k === 'grados') inputGrados = inputGrados.filter((_, idx) => idx !== i);
    else if (k === 'asignaturas') inputAsignaturas = inputAsignaturas.filter((_, idx) => idx !== i);
    else if (k === 'colegios') inputColegios = inputColegios.filter((_, idx) => idx !== i);
    else setItems((currentItems() as string[]).filter((_, idx) => idx !== i));
  }
  function toggleCualitativo(i: number) {
    const k = stepKey();
    if (k === 'grados') {
      inputGrados = inputGrados.map((g, idx) => idx === i ? { ...g, cualitativo: !g.cualitativo } : g);
    } else if (k === 'asignaturas') {
      inputAsignaturas = inputAsignaturas.map((a, idx) => idx === i ? { ...a, cualitativo: !a.cualitativo } : a);
    }
  }
  function toggleDia(ci: number, dk: keyof DiasClase) {
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
    const gradosResumen = inputGrados.map((g) => {
      const t = g.nombre.trim();
      return /grado\s*$/i.test(t) ? t : t + ' grado';
    });
    return [
      { label: 'Años Lectivos', items: inputAnos.join(', '), icon: '📅' },
      { label: 'Colegios', items: inputColegios.map((c) => c.nombre).join(', '), icon: '🏫' },
      { label: 'Grados', items: gradosResumen.join(', '), icon: '📊' },
      { label: 'Secciones', items: inputSecciones.join(', '), icon: '👥' },
      { label: 'Asignaturas', items: inputAsignaturas.map((a) => a.nombre).join(', '), icon: '📚' },
    ];
  }

  // Suscripción al progreso de descarga (todas las plataformas)
  onMount(() => syncManager.subscribe((s) => { downloadProgress = s.downloadProgress ?? null; }));
</script>

<div class="welcome-page">
  <div class="orbs" aria-hidden="true">
    <span class="orb orb-a"></span>
    <span class="orb orb-b"></span>
    <span class="orb orb-c"></span>
  </div>
  {#if view === 'landing'}
    <div class="welcome-container">
      <div class="welcome-brand">
        <img class="welcome-logo" src={appIcon} alt="School Tracker Pro" draggable="false" />
        <h1 class="welcome-title">School Tracker Pro</h1>
        <p class="welcome-subtitle">Selecciona cómo quieres iniciar</p>
      </div>
      <div class="welcome-cards">
        <button class="welcome-card card-google" onclick={() => handleCloudLogin()} disabled={loading}>
          <div class="welcome-card-icon">🔐</div>
          <div class="welcome-card-body">
            <h3>Continuar con Google</h3>
            <p>Crea tu cuenta o inicia sesión para sincronizar en la nube con tu propia base de datos privada.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
        <button class="welcome-card card-manual" onclick={goToWizard} disabled={loading}>
          <div class="welcome-card-icon">⚙️</div>
          <div class="welcome-card-body">
            <h3>Configurar manualmente</h3>
            <p>Selecciona exactamente qué años, colegios, grados y asignaturas deseas usar.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
        <button class="welcome-card card-key" onclick={importarArchivoConexion} disabled={loading}>
          <div class="welcome-card-icon">🔑</div>
          <div class="welcome-card-body">
            <h3>Tengo un archivo de conexión</h3>
            <p>Importa tu archivo .key para sincronizar con Cloudflare y recuperar tus datos.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
        <button class="welcome-card card-import" onclick={importarBaseDatos} disabled={loading}>
          <div class="welcome-card-icon">💾</div>
          <div class="welcome-card-body">
            <h3>Importar base de datos (.db)</h3>
            <p>Restaura tu respaldo de la base de datos y vincúlalo automáticamente a tu cuenta de Google.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
      </div>
      {#if errorMsg}
        <div class="welcome-error">{errorMsg}</div>
      {/if}
    </div>

  {:else if view === 'wizard'}
    <div class="welcome-container wizard-container">
      <button class="welcome-back" onclick={() => { view = 'landing'; errorMsg = ''; step = 1; }}>← Volver</button>
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

      {#if step === 6}
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
          <p style="color:#64748b;font-size:0.8rem;text-align:center;margin-top:1rem;">
            Los cortes evaluativos y la configuración de calificaciones se incluirán automáticamente.
          </p>
        </div>
      {:else}
        <div class="wizard-items">
          {#if stepKey() === 'colegios'}
            <div class="wizard-tipo-row">
              <span class="wizard-tipo-label">Tipo:</span>
              <div class="wizard-tipo-segmented">
                <button class="wizard-tipo-btn" class:active={nuevoColegioTipo === 'Primaria'} onclick={() => nuevoColegioTipo = 'Primaria'}>🏫 Primaria</button>
                <button class="wizard-tipo-btn" class:active={nuevoColegioTipo === 'Secundaria'} onclick={() => nuevoColegioTipo = 'Secundaria'}>🏛️ Secundaria</button>
              </div>
            </div>
          {/if}
          <div class="wizard-input-row">
            <input class="wizard-input" type="text" placeholder={stepKey() === 'colegios' ? 'Ej: Colegio Central' : inputPlaceholder()}
              bind:value={currentInput}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCurrentItem(); } }} />
            <button class="wizard-add-btn" onclick={addCurrentItem}>Agregar</button>
          </div>
          {#if currentItems().length === 0}
            <p class="wizard-empty">Aún no has agregado {stepLabel()}. Escribe uno arriba y pulsa “Agregar”.</p>
          {:else if stepKey() === 'colegios'}
            <div class="wizard-colegios">
              {#each inputColegios as col, ci}
                <div class="wizard-colegio-card">
                  <div class="wizard-colegio-head">
                    <span class="wizard-colegio-name">{col.nombre}</span>
                    <span class="wizard-colegio-tipo-badge" class:secundaria={col.tipo === 'Secundaria'}>
                      {col.tipo === 'Primaria' ? '🏫 Primaria' : '🏛️ Secundaria'}
                    </span>
                    <button class="wizard-chip-x" onclick={() => removeItem(ci)} aria-label="Eliminar">×</button>
                  </div>
                  <div class="wizard-colegio-label">Días de clases</div>
                  <div class="wizard-dias">
                    {#each diasKeys as dk}
                      <button class="wizard-dia" class:active={col.dias[dk]} onclick={() => toggleDia(ci, dk)}>{diaShort(dk)}</button>
                    {/each}
                  </div>
                  <div class="wizard-colegio-label">Asignaturas que imparte</div>
                  <div class="wizard-asig">
                    {#each inputAsignaturas as a}
                      <button class="wizard-asig-chip" class:active={col.asignaturas.includes(a.nombre)} onclick={() => toggleAsignaturaColegio(ci, a.nombre)}>{a.nombre}</button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="wizard-chips">
              {#each currentItems() as item, i}
                <div class="wizard-chip">
                  <span>{chipLabel(item)}</span>
                  {#if stepKey() === 'grados' || stepKey() === 'asignaturas'}
                    <button class="wizard-chip-toggle" class:active={chipCualitativo(item)}
                      onclick={() => toggleCualitativo(i)} title="Solo cualitativo">C</button>
                  {/if}
                  <button class="wizard-chip-x" onclick={() => removeItem(i)} aria-label="Eliminar">×</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if errorMsg}
        <div class="welcome-error">{errorMsg}</div>
      {/if}

      <div class="wizard-nav">
        <button class="wizard-btn" onclick={prevStep} disabled={step === 1}>← Anterior</button>
        <div class="wizard-step-counter">{step} / {steps.length}</div>
        {#if step < 6}
          <button class="wizard-btn primary" onclick={nextStep} disabled={currentItems().length === 0}>Siguiente →</button>
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
        <button onclick={cancelAuth}>Cancelar</button>
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
  .welcome-logo {
    width: 128px; height: 128px; display: flex; align-items: center; justify-content: center;
    border-radius: 32px;
    box-shadow: 0 18px 56px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.1);
    animation: floatY 6s ease-in-out infinite;
    user-select: none; -webkit-user-drag: none;
  }
  .welcome-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 32px; -webkit-user-drag: none; }
  @keyframes floatY { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  .welcome-title {
    margin: 0; font-size: 2rem; font-weight: 700; letter-spacing: -0.5px;
    background: linear-gradient(135deg, #f8fafc 20%, #cbd5e1 55%, #93c5fd);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .welcome-subtitle { margin: 0; color: #64748b; font-size: 0.9rem; }
  .welcome-cards { display: flex; flex-direction: column; gap: 0.9rem; width: 100%; }
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
  /* Barra de acento vertical por opción */
  .welcome-card::before {
    content: ''; position: absolute; left: 0; top: 16px; bottom: 16px; width: 3px;
    border-radius: 2px; opacity: 0.9;
    background: linear-gradient(180deg, var(--accent-from, #3b82f6), var(--accent-to, #8b5cf6));
  }
  .card-drive { --accent-from: #38bdf8; --accent-to: #2563eb; }
  .card-google { --accent-from: #34a853; --accent-to: #1a73e8; }
  .card-manual { --accent-from: #a78bfa; --accent-to: #7c3aed; }
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
    width: min(360px, 88vw); padding: 1.75rem 1.5rem 1.4rem;
    display: flex; flex-direction: column; align-items: center; gap: 0.9rem;
    background: rgba(20,24,31,0.88); backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 22px;
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06);
  }
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
  .welcome-loading-text { margin: 0; color: #64748b; font-size: 0.8rem; }
  .dl-progress-wrap { width: 100%; max-width: 320px; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
  .dl-progress-bar { width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); }
  .dl-progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary-color, #3b82f6), #a78bfa); border-radius: 4px; transition: width 0.2s ease; box-shadow: 0 0 12px rgba(59,130,246,0.35); }
  @keyframes loadingBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
  .welcome-error { color: #f87171; font-size: 0.85rem; text-align: center; padding: 0.6rem 1rem; background: rgba(248,113,113,0.08); border-radius: 10px; width: 100%; max-width: 400px; border: 1px solid rgba(248,113,113,0.15); }

  .wizard-progress { display: flex; align-items: center; gap: 0; width: 100%; max-width: 320px; }
  .wizard-step-dot { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
  .wizard-step-dot.active { border-color: var(--primary-color, #3b82f6); box-shadow: 0 0 0 3px rgba(59,130,246,0.2); }
  .wizard-step-dot.done { background: rgba(59,130,246,0.2); border-color: var(--primary-color, #3b82f6); }
  .wizard-step-line { flex: 1; height: 2px; background: rgba(255,255,255,0.08); }
  .wizard-step-line.done { background: var(--primary-color, #3b82f6); }
  .wizard-step-label { font-size: 0.9rem; color: #94a3b8; font-weight: 600; text-align: center; }

  .wizard-items { width: 100%; }
  .wizard-select-all { margin-bottom: 0.75rem; }
  .wizard-toggle-all { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.8rem; color: #94a3b8; padding: 0.4rem; border-radius: 8px; background: rgba(255,255,255,0.02); }
  .wizard-toggle-all input { accent-color: var(--primary-color, #3b82f6); }

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
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 0.85rem 0.95rem;
  }
  .wizard-colegio-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
  .wizard-colegio-name { font-size: 0.95rem; font-weight: 700; color: #e2e8f0; }
  .wizard-colegio-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin: 0.5rem 0 0.35rem; }
  .wizard-dias { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .wizard-dia {
    width: 34px; height: 34px; border-radius: 9px; cursor: pointer; font-size: 0.85rem; font-weight: 700; font-family: inherit;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #64748b; transition: all 0.2s ease;
  }
  .wizard-dia:hover { border-color: var(--primary-color, #3b82f6); }
  .wizard-dia.active { background: linear-gradient(135deg, var(--primary-color, #3b82f6), #a78bfa); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(59,130,246,0.25); }
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
  .wizard-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; max-height: 280px; overflow-y: auto; padding: 0.15rem; }
  .wizard-chip {
    display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem;
    background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25);
    border-radius: 999px; color: #e2e8f0; font-size: 0.8rem;
  }
  .wizard-chip-x {
    width: 18px; height: 18px; border-radius: 50%; border: none; cursor: pointer;
    background: rgba(255,255,255,0.08); color: #cbd5e1; font-size: 0.85rem; line-height: 1;
    display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;
  }
  .wizard-chip-x:hover { background: rgba(239,68,68,0.2); color: #f87171; }
  .wizard-chip-toggle {
    width: 20px; height: 20px; border-radius: 50%; border: 1px solid rgba(168,85,247,0.4); cursor: pointer;
    background: rgba(255,255,255,0.06); color: #a78bfa; font-size: 0.7rem; font-weight: 700; line-height: 1;
    display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;
  }
  .wizard-chip-toggle:hover { background: rgba(168,85,247,0.18); }
  .wizard-chip-toggle.active { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; border-color: transparent; box-shadow: 0 0 10px rgba(168,85,247,0.4); }

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
