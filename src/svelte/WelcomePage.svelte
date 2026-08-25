<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
  import { readTextFile } from "@tauri-apps/plugin-fs";
  import { driveSyncService, syncManager, type DownloadProgress } from "../lib/driveSyncService";
  import { setBackAuthInProgress } from "../lib/androidBack";

  let view: 'landing' | 'cloud' | 'wizard' = $state('landing');
  let step = $state(1);
  let loading = $state(false);
  let loadingMessage = $state('');
  let errorMsg = $state('');

  // Progreso de descarga de la BD desde Drive (reportado por driveSyncService)
  let downloadProgress = $state<DownloadProgress | null>(null);
  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  let seedOptions: any = $state(null);
  let selectedAnos = $state<Set<string>>(new Set());
  let selectedColegios = $state<Set<string>>(new Set());
  let selectedGrados = $state<Set<string>>(new Set());
  let selectedSecciones = $state<Set<string>>(new Set());
  let selectedAsignaturas = $state<Set<string>>(new Set());

  const steps = [
    { title: 'Años Lectivos', icon: '📅', key: 'anos' },
    { title: 'Colegios', icon: '🏫', key: 'colegios' },
    { title: 'Grados', icon: '📊', key: 'grados' },
    { title: 'Secciones', icon: '👥', key: 'secciones' },
    { title: 'Asignaturas', icon: '📚', key: 'asignaturas' },
    { title: 'Resumen', icon: '✅', key: 'resumen' },
  ];

  function cancelAuth() {
    setBackAuthInProgress(false);
    invoke("gd_cancel_oauth").catch(() => {});
    loading = false;
    loadingMessage = '';
    errorMsg = '';
  }

  async function goToDrive() {
    await handleDriveConnect();
  }

  async function goToWizard() {
    try {
      seedOptions = await invoke('get_seed_options');
      selectedAnos = new Set(seedOptions.anos.map((a: any) => a.nombre));
      selectedColegios = new Set(seedOptions.colegios.map((c: any) => c.nombre));
      selectedGrados = new Set(seedOptions.grados.map((g: any) => g.nombre));
      selectedSecciones = new Set(seedOptions.secciones.map((s: any) => s.nombre));
      selectedAsignaturas = new Set(seedOptions.asignaturas.map((a: any) => a.nombre));
      view = 'wizard';
    } catch (e) {
      errorMsg = 'Error cargando opciones: ' + e;
    }
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
      // Si ya existía una conexión con OTRAS credenciales (p. ej. BD restaurada
      // desde Drive que trae su propia d1_config), reemplazar limpio para no
      // mezclar datos de una nube con otra: nuevo device_id + cursores en cero.
      const previa = await invoke<any>('d1_get_config');
      if (previa && (previa.workerUrl !== cfg.workerUrl || previa.schoolKey !== cfg.schoolKey)) {
        const ok = await ask(
          'Ya existe una conexión a la nube con OTRAS credenciales.\n\n¿Reemplazarla? Se generará un nuevo ID de dispositivo y los datos locales se sincronizarán con la nube nueva.',
          { title: 'Reemplazar conexión', kind: 'warning', okLabel: 'Sí, reemplazar', cancelLabel: 'Cancelar' }
        );
        if (!ok) { loading = false; loadingMessage = ''; return; }
        await invoke('d1_clear_config');
      }
      // Guardar solo en SQLite (d1_config) — el frontend no retiene los valores
      await invoke('d1_save_config', { workerUrl: cfg.workerUrl, schoolKey: cfg.schoolKey });
      loadingMessage = 'Sincronizando con la nube...';
      try {
        await invoke('d1_sync_all');
      } catch (syncErr) {
        console.error('[Import] primer sync falló:', syncErr);
        errorMsg = 'No se pudo sincronizar con el Worker. Verifica tu conexión.';
        loading = false; loadingMessage = '';
        return;
      }
      loadingMessage = 'Verificando datos...';
      const hasData = await invoke('is_app_initialized');
      if (hasData) {
        await invoke('set_app_initialized');
        await solicitarPermisoNotificaciones();
        emit('welcome-complete');
      } else {
        // Nube vacía: continuar con el asistente de datos iniciales
        loading = false; loadingMessage = '';
        goToWizard();
        return;
      }
    } catch (e: any) {
      errorMsg = 'Error importando conexión: ' + (typeof e === 'string' ? e : e?.message || String(e));
    }
    loading = false;
    loadingMessage = '';
  }

  /** Pide el permiso POST_NOTIFICATIONS (Android 13+) en la primera ejecución. */
  async function solicitarPermisoNotificaciones() {
    if (!/Android/i.test(navigator.userAgent)) return;
    try { await invoke('gd_request_notification_permission'); } catch (e) { console.error('Permiso notificaciones:', e); }
  }

  let authHandled = false;

  async function handleDriveConnect() {
    loading = true;
    loadingMessage = 'Conectando con Google Drive...';
    errorMsg = '';
    setBackAuthInProgress(true);
    try {
      const port = 51733;
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
      const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
      if (!clientId || !clientSecret) {
        errorMsg = 'VITE_GOOGLE_CLIENT_ID y VITE_GOOGLE_CLIENT_SECRET deben estar configurados en .env';
        loading = false;
        return;
      }
      if (/Android/i.test(navigator.userAgent)) {
        // Selector nativo de cuentas: la app nunca pierde el primer plano
        // (evita que Android congele el proceso y muera el TCP/deep-link)
        setBackAuthInProgress(false);
        try {
          await invoke("gd_start_native_signin", { serverClientId: clientId });
        } catch (e: any) {
          errorMsg = 'Error: ' + (typeof e === 'string' ? e : e?.message || String(e));
          loading = false;
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
          loading = false;
          loadingMessage = '';
          errorMsg = 'Tiempo de espera agotado en el selector de Google';
        }
        return;
      }
      const redirectUri = `${/Android/i.test(navigator.userAgent) ? 'http://127.0.0.1' : 'http://localhost'}:${port}/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=consent`;
      const code = await invoke<string>("gd_open_auth_webview", { url: authUrl });
      await finishDriveAuth(code, redirectUri);
    } catch (e: any) {
      if (!authHandled) {
        const errStr = typeof e === 'string' ? e : (e?.message || String(e));
        if (errStr.toLowerCase().includes('cancel')) {
          errorMsg = 'Autenticación cancelada';
        } else {
          errorMsg = 'Error: ' + errStr;
        }
      }
    }
    loading = false;
    loadingMessage = '';
    setBackAuthInProgress(false);
  }

  async function finishDriveAuth(code: string, redirectUri: string) {
    if (authHandled) return;
    authHandled = true;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
    try {
      const tokenController = new AbortController();
      const tokenTimeout = setTimeout(() => tokenController.abort(), 30000);
      let tokenResponse: Response;
      try {
        const params: Record<string, string> = {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
        };
        if (redirectUri) params.redirect_uri = redirectUri;
        tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params),
          signal: tokenController.signal,
        });
      } finally {
        clearTimeout(tokenTimeout);
      }
      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        console.error('[NativeAuth] /token falló:', tokenResponse.status, errText);
        errorMsg = 'Error intercambiando código: ' + errText;
        loading = false;
        return;
      }
      const tokenData = await tokenResponse.json();

      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userResponse.json();

      const settings = {
        clientId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        tokenExpiry: Date.now() + (tokenData.expires_in * 1000),
        googleUserEmail: userInfo.email || null,
        googleUserName: userInfo.name || null,
        googleUserProfilePic: userInfo.picture || null,
      };
      localStorage.setItem('schooltracker-google-drive-settings', JSON.stringify(settings));

      loadingMessage = 'Descargando datos desde Google Drive...';
      await driveSyncService.pullAll();
      loadingMessage = 'Verificando datos...';
      const hasData = await invoke('is_app_initialized');
      if (hasData) {
        await invoke('set_app_initialized');
        await solicitarPermisoNotificaciones();
        emit('welcome-complete');
      } else {
        errorMsg = 'Drive está vacío. Se usarán los datos por defecto.';
        setBackAuthInProgress(false);
        setTimeout(() => { loading = false; loadingMessage = ''; goToWizard(); }, 1500);
        return;
      }
    } catch (e: any) {
      const errStr = typeof e === 'string' ? e : (e?.message || String(e));
      if (errStr.toLowerCase().includes('cancel')) {
        errorMsg = 'Autenticación cancelada';
      } else {
        errorMsg = 'Error: ' + errStr;
      }
    }
    loading = false;
    loadingMessage = '';
    setBackAuthInProgress(false);
  }

  async function handleWizardComplete() {
    if (selectedAnos.size === 0 || selectedColegios.size === 0 || selectedGrados.size === 0 ||
        selectedSecciones.size === 0 || selectedAsignaturas.size === 0) {
      errorMsg = 'Debes seleccionar al menos un elemento de cada categoría.';
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      await invoke('seed_selected_data', {
        selections: {
          anos: Array.from(selectedAnos),
          colegios: Array.from(selectedColegios),
          grados: Array.from(selectedGrados),
          secciones: Array.from(selectedSecciones),
          asignaturas: Array.from(selectedAsignaturas),
        }
      });
      await invoke('set_app_initialized');
      await solicitarPermisoNotificaciones();
      emit('welcome-complete');
    } catch (e: any) {
      errorMsg = 'Error guardando datos: ' + (e?.message || e);
    }
    loading = false;
  }

  function toggleAll(items: any[], set: Set<string>, value: boolean) {
    if (value) { items.forEach((item: any) => set.add(item.nombre ?? item)); }
    else { set.clear(); }
    const copy = new Set(set);
    if (set === selectedAnos) selectedAnos = copy;
    else if (set === selectedColegios) selectedColegios = copy;
    else if (set === selectedGrados) selectedGrados = copy;
    else if (set === selectedSecciones) selectedSecciones = copy;
    else if (set === selectedAsignaturas) selectedAsignaturas = copy;
  }

  function toggleItem(set: Set<string>, item: string) {
    const copy = new Set(set);
    if (copy.has(item)) copy.delete(item); else copy.add(item);
    if (set === selectedAnos) selectedAnos = copy;
    else if (set === selectedColegios) selectedColegios = copy;
    else if (set === selectedGrados) selectedGrados = copy;
    else if (set === selectedSecciones) selectedSecciones = copy;
    else if (set === selectedAsignaturas) selectedAsignaturas = copy;
  }

  function allSelected(items: any[], set: Set<string>): boolean {
    return items.length > 0 && items.every((item: any) => set.has(item.nombre ?? item));
  }

  function nextStep() { if (step < steps.length) step++; }
  function prevStep() { if (step > 1) step--; }

  function getStepItems(): any[] {
    switch (step) {
      case 1: return seedOptions?.anos || [];
      case 2: return seedOptions?.colegios || [];
      case 3: return seedOptions?.grados || [];
      case 4: return seedOptions?.secciones || [];
      case 5: return seedOptions?.asignaturas || [];
      default: return [];
    }
  }

  function getStepSet(): Set<string> {
    switch (step) {
      case 1: return selectedAnos;
      case 2: return selectedColegios;
      case 3: return selectedGrados;
      case 4: return selectedSecciones;
      case 5: return selectedAsignaturas;
      default: return new Set();
    }
  }

  function formatItem(item: any): string {
    if (typeof item === 'string') return item;
    return item.nombre || '';
  }

  function itemSubtitle(item: any): string {
    if (item.cualitativo) return 'Cualitativo';
    return '';
  }

  function getResumenItems() {
    return [
      { label: 'Años Lectivos', items: Array.from(selectedAnos).join(', '), icon: '📅' },
      { label: 'Colegios', items: Array.from(selectedColegios).join(', '), icon: '🏫' },
      { label: 'Grados', items: Array.from(selectedGrados).join(', '), icon: '📊' },
      { label: 'Secciones', items: Array.from(selectedSecciones).join(', '), icon: '👥' },
      { label: 'Asignaturas', items: Array.from(selectedAsignaturas).join(', '), icon: '📚' },
    ];
  }

  // Respaldo: el código llega vía deep link (MainActivity emite 'oauth-callback-android'
  // como CustomEvent en window y, si existe el global, vía event.emit de Tauri)
  // cuando Android captura http://127.0.0.1:51733/callback?code=... mediante intent-filter.
  async function handleNativeAuthCode(code: string) {
    if (!code || authHandled) return;
    authHandled = true;
    invoke("gd_cancel_oauth").catch(() => {});
    try {
      await finishDriveAuth(code, "http://127.0.0.1:51733/callback");
    } finally {
      loading = false;
      loadingMessage = "";
      setBackAuthInProgress(false);
    }
  }

  // Resultado del selector nativo de Google (MainActivity emite CustomEvent en window
  // y, si existe el global, event.emit de Tauri con el mismo nombre).
  function handleGoogleNativeResult(detail: unknown) {
    let res: any = detail;
    if (typeof res === 'string') {
      try { res = JSON.parse(res); } catch (e) { console.error('[NativeResult] JSON inválido:', e); return; }
    }
    if (!res) return;
    if (!res.ok) {
      loading = false;
      loadingMessage = '';
      if (!res.cancelled) {
        errorMsg = `Error de Google Sign-In (${res.statusCode ?? "?"}): ${res.error ?? ""}`;
      }
      return;
    }
    if (authHandled) return;
    if (!res.serverAuthCode) {
      loading = false;
      errorMsg = 'Google no devolvió código de autorización';
      return;
    }
    // NO marcar authHandled aquí: finishDriveAuth tiene su propio guard
    // síncrono que deduplica contra el evento/polling duplicados.
    finishDriveAuth(res.serverAuthCode, "");
  }

  // Suscripción al progreso de descarga (todas las plataformas)
  onMount(() => syncManager.subscribe((s) => { downloadProgress = s.downloadProgress ?? null; }));

  onMount(() => {
    if (!/Android/i.test(navigator.userAgent)) return;
    const nativeHandler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      handleNativeAuthCode(detail ?? "");
    };
    let unsub: (() => void) | null = null;
    listen<string>("oauth-callback-android", (event) => {
      handleNativeAuthCode(event.payload);
    }).then((u) => { unsub = u; }).catch(() => {});
    window.addEventListener("oauth-callback-android", nativeHandler);
    const googleResultHandler = (e: Event) => {
      handleGoogleNativeResult((e as CustomEvent<unknown>).detail);
    };
    let unsubResult: (() => void) | null = null;
    listen<unknown>("google-native-auth-result", (event) => {
      handleGoogleNativeResult(event.payload);
    }).then((u) => { unsubResult = u; }).catch(() => {});
    window.addEventListener("google-native-auth-result", googleResultHandler);
    return () => {
      window.removeEventListener("oauth-callback-android", nativeHandler);
      if (unsub) unsub();
      window.removeEventListener("google-native-auth-result", googleResultHandler);
      if (unsubResult) unsubResult();
    };
  });
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
        <div class="welcome-logo">📚</div>
        <h1 class="welcome-title">School Tracker Pro</h1>
        <p class="welcome-subtitle">Selecciona cómo quieres iniciar</p>
      </div>
      <div class="welcome-cards">
        <button class="welcome-card card-drive" onclick={goToDrive} disabled={loading}>
          <div class="welcome-card-icon">☁️</div>
          <div class="welcome-card-body">
            <h3>Conectar con Google Drive</h3>
            <p>Sincroniza tus datos entre dispositivos usando Google Drive.</p>
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
      </div>
      {#if loading}
        <div class="welcome-loading">
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
            <div class="welcome-loading-bar">
              <div class="welcome-loading-bar-inner"></div>
            </div>
          {/if}
          <p class="welcome-loading-text">{loadingMessage}</p>
          <button onclick={cancelAuth} style="margin-top:0.5rem;background:transparent;border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:0.45rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600;transition:all 0.2s">
            Cancelar
          </button>
        </div>
      {/if}
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
          <div class="wizard-select-all">
            <label class="wizard-toggle-all">
              <input type="checkbox"
                checked={allSelected(getStepItems(), getStepSet())}
                onchange={(e) => toggleAll(getStepItems(), getStepSet(), (e.target as HTMLInputElement).checked)} />
              <span>Seleccionar / Deseleccionar todos</span>
            </label>
          </div>
          <div class="wizard-grid">
            {#each getStepItems() as item}
              {@const nombre = formatItem(item)}
              {@const selected = getStepSet().has(nombre)}
              <button class="wizard-item" class:selected onpointerdown={(e) => { e.preventDefault(); toggleItem(getStepSet(), nombre); }}>
                <div class="wizard-check">
                  {#if selected}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  {/if}
                </div>
                <span class="wizard-item-name">{nombre}</span>
                {#if itemSubtitle(item)}
                  <span class="wizard-item-badge">{itemSubtitle(item)}</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if errorMsg}
        <div class="welcome-error">{errorMsg}</div>
      {/if}

      <div class="wizard-nav">
        <button class="wizard-btn" onclick={prevStep} disabled={step === 1}>← Anterior</button>
        <div class="wizard-step-counter">{step} / {steps.length}</div>
        {#if step < 6}
          <button class="wizard-btn primary" onclick={nextStep} disabled={getStepSet().size === 0}>Siguiente →</button>
        {:else}
          <button class="wizard-btn primary" onclick={handleWizardComplete} disabled={loading}>
            {loading ? 'Guardando...' : 'Comenzar'}
          </button>
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
  .welcome-logo {
    font-size: 3rem; width: 84px; height: 84px; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(59,130,246,0.18), rgba(139,92,246,0.12));
    border-radius: 26px; border: 1px solid rgba(255,255,255,0.12);
    backdrop-filter: blur(20px);
    box-shadow: 0 12px 40px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,0.1);
    animation: floatY 6s ease-in-out infinite;
  }
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
