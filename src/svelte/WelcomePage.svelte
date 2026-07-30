<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";

  let view: 'landing' | 'cloud' | 'wizard' = $state('landing');
  let step = $state(1);
  let loading = $state(false);
  let loadingMessage = $state('');
  let errorMsg = $state('');

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

  async function handleDriveConnect() {
    loading = true;
    loadingMessage = 'Conectando con Google Drive...';
    errorMsg = '';
    try {
      const port = 51733;
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
      const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
      if (!clientId || !clientSecret) {
        errorMsg = 'VITE_GOOGLE_CLIENT_ID y VITE_GOOGLE_CLIENT_SECRET deben estar configurados en .env';
        loading = false;
        return;
      }
      const redirectUri = `http://localhost:${port}/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')}&access_type=offline&prompt=consent`;
      const code = await invoke<string>("gd_open_auth_webview", { url: authUrl });

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
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
      await syncService.pullAllSilent();
      loadingMessage = 'Verificando datos...';
      const hasData = await invoke('is_app_initialized');
      if (hasData) {
        await invoke('set_app_initialized');
        emit('welcome-complete');
      } else {
        errorMsg = 'Drive está vacío. Se usarán los datos por defecto.';
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
</script>

<div class="welcome-page">
  {#if view === 'landing'}
    <div class="welcome-container">
      <div class="welcome-brand">
        <div class="welcome-logo">📚</div>
        <h1 class="welcome-title">School Tracker Pro</h1>
        <p class="welcome-subtitle">Selecciona cómo quieres iniciar</p>
      </div>
      <div class="welcome-cards">
        <button class="welcome-card" onclick={goToDrive} disabled={loading}>
          <div class="welcome-card-icon">☁️</div>
          <div class="welcome-card-body">
            <h3>Conectar con Google Drive</h3>
            <p>Sincroniza tus datos entre dispositivos usando Google Drive.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
        <button class="welcome-card" onclick={goToWizard} disabled={loading}>
          <div class="welcome-card-icon">⚙️</div>
          <div class="welcome-card-body">
            <h3>Configurar manualmente</h3>
            <p>Selecciona exactamente qué años, colegios, grados y asignaturas deseas usar.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
      </div>
      {#if loading}
        <div class="welcome-loading">
          <div class="welcome-loading-bar">
            <div class="welcome-loading-bar-inner"></div>
          </div>
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
  .welcome-page {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: var(--bg-primary, #0f172a); z-index: 10000; overflow-y: auto; padding: 1rem;
  }
  .welcome-container {
    width: 100%; max-width: 520px; display: flex; flex-direction: column; align-items: center; gap: 1.5rem;
  }
  .wizard-container { max-width: 580px; }
  .welcome-brand { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
  .welcome-logo {
    font-size: 3rem; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.05); border-radius: 24px; border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(20px);
  }
  .welcome-title { margin: 0; font-size: 1.8rem; font-weight: 700; color: #f1f5f9; letter-spacing: -0.5px; }
  .welcome-subtitle { margin: 0; color: #64748b; font-size: 0.9rem; }
  .welcome-cards { display: flex; flex-direction: column; gap: 0.85rem; width: 100%; }
  .welcome-card {
    display: flex; align-items: center; gap: 1rem; padding: 1.25rem;
    background: rgba(255,255,255,0.02); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px; cursor: pointer; transition: all 0.2s ease; text-align: left; width: 100%;
    color: inherit; font: inherit;
  }
  .welcome-card:hover:not(:disabled) {
    border-color: var(--primary-color, #3b82f6); background: rgba(255,255,255,0.04); transform: translateY(-1px);
  }
  .welcome-card:disabled { opacity: 0.5; cursor: not-allowed; }
  .welcome-card-icon { font-size: 2rem; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .welcome-card-body { flex: 1; }
  .welcome-card-body h3 { margin: 0 0 0.25rem; font-size: 1rem; color: #e2e8f0; font-weight: 600; }
  .welcome-card-body p { margin: 0; font-size: 0.8rem; color: #64748b; line-height: 1.4; }
  .welcome-card-arrow { font-size: 1.3rem; color: #475569; flex-shrink: 0; }
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
