<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { syncService, setActiveProvider } from "../lib/syncService";
  import { getSupabaseClient, saveSupabaseConfig } from "../lib/supabase";

  let view: 'landing' | 'cloud' | 'wizard' = $state('landing');
  let step = $state(1);
  let loading = $state(false);
  let errorMsg = $state('');
  let seedOptions: any = $state(null);

  let provider: 'supabase' | 'turso' = $state('supabase');
  let cloudUrl = $state('');
  let cloudKey = $state('');

  let sbEmail = $state('');
  let sbPassword = $state('');
  let sbConfirmPassword = $state('');
  let authMode: 'login' | 'register' = $state('login');
  let sbSessionUser: string | null = $state(null);
  let showSbPassword = $state(false);
  let showSbConfirmPassword = $state(false);

  let envLoaded = $state(false);
  let showManualInput = $state(false);

  let rememberedAccounts = $state<{email: string; url: string; lastUsed: string}[]>([]);

  function loadRememberedAccounts() {
    try {
      const raw = localStorage.getItem('sb_remembered_accounts');
      rememberedAccounts = raw ? JSON.parse(raw) : [];
    } catch { rememberedAccounts = []; }
  }
  function saveRememberedAccount(email: string, url: string) {
    let list = [...rememberedAccounts];
    list = list.filter(a => a.email !== email);
    list.unshift({ email, url, lastUsed: new Date().toISOString() });
    if (list.length > 5) list = list.slice(0, 5);
    rememberedAccounts = list;
    localStorage.setItem('sb_remembered_accounts', JSON.stringify(list));
  }
  function selectAccount(acc: {email: string; url: string}) {
    cloudUrl = acc.url;
    sbEmail = acc.email;
    sbPassword = '';
    errorMsg = '';
  }
  function forgetAccount(email: string) {
    let list = rememberedAccounts.filter(a => a.email !== email);
    rememberedAccounts = list;
    localStorage.setItem('sb_remembered_accounts', JSON.stringify(list));
  }

  loadRememberedAccounts();

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

  let envDefaults: { supabase: { url: string; key: string }; turso: { url: string; token: string } } = $state({
    supabase: { url: '', key: '' },
    turso: { url: '', token: '' }
  });

  function loadEnvDefaults() {
    if (typeof import.meta !== 'undefined') {
      const env = (import.meta as any).env;
      envDefaults = {
        supabase: { url: env?.VITE_SUPABASE_URL || '', key: env?.VITE_SUPABASE_ANON_KEY || '' },
        turso: { url: env?.VITE_TURSO_DB_URL || '', token: env?.VITE_TURSO_AUTH_TOKEN || '' }
      };
    }
  }
  loadEnvDefaults();

  function resetToEnvDefaults() {
    const defs = envDefaults;
    if (provider === 'supabase') {
      cloudUrl = defs.supabase.url;
      cloudKey = defs.supabase.key;
    } else {
      cloudUrl = defs.turso.url;
      cloudKey = defs.turso.token;
    }
    showManualInput = false;
    errorMsg = '';
  }

  function goToCloud() {
    const defs = envDefaults;
    const sbHasEnv = !!(defs.supabase.url && defs.supabase.key);
    const tursoHasEnv = !!(defs.turso.url && defs.turso.token);
    envLoaded = sbHasEnv || tursoHasEnv;
    if (provider === 'supabase' && sbHasEnv) {
      cloudUrl = defs.supabase.url;
      cloudKey = defs.supabase.key;
      showManualInput = false;
    } else if (provider === 'turso' && tursoHasEnv) {
      cloudUrl = defs.turso.url;
      cloudKey = defs.turso.token;
      showManualInput = false;
    } else {
      showManualInput = true;
    }
    view = 'cloud';
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

  function toggleAll(items: any[], set: Set<string>, value: boolean) {
    if (value) {
      items.forEach((item: any) => set.add(item.nombre ?? item));
    } else {
      set.clear();
    }
    // Trigger reactivity
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
    if (item.orden) return '';
    return '';
  }

  async function handleSupabaseAuth() {
    if (!cloudUrl || !cloudKey) { errorMsg = 'Completa URL y Anon Key'; return; }
    if (!sbEmail || !sbPassword) { errorMsg = 'Completa email y contraseña'; return; }
    if (authMode === 'register' && sbPassword !== sbConfirmPassword) { errorMsg = 'Las contraseñas no coinciden'; return; }
    loading = true;
    errorMsg = '';
    try {
      saveSupabaseConfig(cloudUrl, cloudKey);
      setActiveProvider('supabase');
      const client = getSupabaseClient();
      if (!client) { errorMsg = 'No se pudo crear el cliente Supabase'; loading = false; return; }
      if (authMode === 'register') {
        const { data, error } = await client.auth.signUp({ email: sbEmail, password: sbPassword });
        if (error) { errorMsg = error.message; loading = false; return; }
        sbSessionUser = data.user?.email || data.user?.id || 'Registrado';
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email: sbEmail, password: sbPassword });
        if (error) { errorMsg = error.message; loading = false; return; }
        sbSessionUser = data.user?.email || data.user?.id || 'Conectado';
      }
      saveRememberedAccount(sbEmail, cloudUrl);
      const sr = await syncService.runSchemaSetup();
      if (!sr.ok) { errorMsg = sr.error || 'Error preparando la base de datos remota'; loading = false; return; }
      await syncService.pullAll();
      const hasData = await invoke('is_app_initialized');
      if (hasData) {
        await invoke('set_app_initialized');
        emit('welcome-complete');
      } else {
        errorMsg = 'La nube está vacía. Se usarán los datos por defecto.';
        setTimeout(() => { loading = false; goToWizard(); }, 1500);
      }
    } catch (e: any) {
      errorMsg = 'Error: ' + (e?.message || e);
    }
    loading = false;
  }

  async function handleCloudSync() {
    if (!cloudUrl || !cloudKey) { errorMsg = 'Completa todos los campos'; return; }
    if (provider === 'supabase') {
      await handleSupabaseAuth();
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      localStorage.setItem('turso_url', cloudUrl);
      localStorage.setItem('turso_auth_token', cloudKey);
      setActiveProvider('turso');
      await syncService.pullAll();
      const hasData = await invoke('is_app_initialized');
      if (hasData) {
        await invoke('set_app_initialized');
        emit('welcome-complete');
      } else {
        errorMsg = 'La nube está vacía. Se usarán los datos por defecto.';
        setTimeout(() => { loading = false; goToWizard(); }, 1500);
        return;
      }
    } catch (e: any) {
      errorMsg = 'Error de conexión: ' + (e?.message || e);
    }
    loading = false;
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
        <button class="welcome-card" onclick={goToCloud}>
          <div class="welcome-card-icon">☁️</div>
          <div class="welcome-card-body">
            <h3>Descargar desde la nube</h3>
            <p>Conecta con Supabase o Turso para descargar tus datos existentes.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
        <button class="welcome-card" onclick={goToWizard}>
          <div class="welcome-card-icon">⚙️</div>
          <div class="welcome-card-body">
            <h3>Configurar manualmente</h3>
            <p>Selecciona exactamente qué años, colegios, grados y asignaturas deseas usar.</p>
          </div>
          <div class="welcome-card-arrow">→</div>
        </button>
      </div>
    </div>

  {:else if view === 'cloud'}
    <div class="welcome-container">
      <button class="welcome-back" onclick={() => { view = 'landing'; errorMsg = ''; }}>← Volver</button>
      <div class="welcome-brand">
        <h2 class="welcome-title" style="font-size:1.5rem">☁️ Conectar con la nube</h2>
        <p class="welcome-subtitle">Ingresa las credenciales de tu proveedor</p>
      </div>
      <div class="welcome-form">
        <div class="provider-tabs">
          <button class="provider-tab" class:active={provider === 'supabase'} onclick={() => { provider = 'supabase'; errorMsg = ''; if (envDefaults.supabase.url && !showManualInput) { cloudUrl = envDefaults.supabase.url; cloudKey = envDefaults.supabase.key; } }}>Supabase</button>
          <button class="provider-tab" class:active={provider === 'turso'} onclick={() => { provider = 'turso'; errorMsg = ''; if (envDefaults.turso.url && !showManualInput) { cloudUrl = envDefaults.turso.url; cloudKey = envDefaults.turso.token; } }}>Turso</button>
        </div>
        {#if provider === 'supabase'}
          {#if envLoaded && !showManualInput}
            <div class="env-badge">
              <span class="env-badge-icon">✅</span>
              <span>Usando configuración predeterminada del entorno</span>
              <button class="env-badge-btn" onclick={() => { showManualInput = true; }}>Usar otros datos →</button>
            </div>
          {:else}
            <div class="field">
              <label>URL del proyecto</label>
              <input bind:value={cloudUrl} placeholder="https://xxxxx.supabase.co" />
            </div>
            <div class="field">
              <label>Anon Key</label>
              <input bind:value={cloudKey} placeholder="eyJhbGciOiJIUzI1NiIs..." />
            </div>
            {#if envLoaded}
              <button class="env-reset-btn" onclick={resetToEnvDefaults}>↩ Volver a configuración predeterminada</button>
            {/if}
          {/if}
          {#if rememberedAccounts.length > 0}
            <div style="margin-top:0.25rem;">
              <div style="font-size:0.65rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.3rem;">Cuentas guardadas</div>
              <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
                {#each rememberedAccounts as acc}
                  <button onclick={() => selectAccount(acc)} style="display:flex;align-items:center;gap:0.3rem;padding:0.3rem 0.6rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;cursor:pointer;font-size:0.75rem;color:#cbd5e1;transition:all 0.2s;font-family:inherit;"
                    title="Click para usar • {acc.email}">
                    <span style="font-size:0.85rem;">👤</span>
                    <span>{acc.email}</span>
                    <span onclick={(e) => { e.stopPropagation(); forgetAccount(acc.email); }} style="margin-left:0.2rem;color:#64748b;font-size:0.7rem;cursor:pointer;padding:0 0.15rem;border-radius:4px;"
                      onmouseover={(e) => e.currentTarget.style.color = '#ef4444'}
                      onmouseout={(e) => e.currentTarget.style.color = '#64748b'}>✕</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          <div style="display:flex;gap:0.4rem;margin-top:0.25rem;background:rgba(255,255,255,0.04);padding:0.25rem;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
            <button onclick={() => { authMode = 'login'; errorMsg = ''; }} style="flex:1;padding:0.4rem 0.5rem;border-radius:7px;border:none;cursor:pointer;font-size:0.8rem;font-weight:600;background:{authMode === 'login' ? 'var(--primary-color)' : 'transparent'};color:{authMode === 'login' ? '#fff' : '#94a3b8'};transition:all 0.2s;">Iniciar Sesión</button>
            <button onclick={() => { authMode = 'register'; errorMsg = ''; }} style="flex:1;padding:0.4rem 0.5rem;border-radius:7px;border:none;cursor:pointer;font-size:0.8rem;font-weight:600;background:{authMode === 'register' ? 'var(--primary-color)' : 'transparent'};color:{authMode === 'register' ? '#fff' : '#94a3b8'};transition:all 0.2s;">Crear Cuenta</button>
          </div>
          <div class="field">
            <label>Correo electrónico</label>
            <input type="email" bind:value={sbEmail} placeholder="correo@ejemplo.com" />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <div class="password-wrapper">
              <input type={showSbPassword ? 'text' : 'password'} bind:value={sbPassword} placeholder="••••••••" />
              <button class="password-toggle" onclick={() => showSbPassword = !showSbPassword} tabindex="-1" type="button">
                {#if showSbPassword}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                {/if}
              </button>
            </div>
          </div>
          {#if authMode === 'register'}
            <div class="field">
              <label>Confirmar contraseña</label>
              <div class="password-wrapper">
                <input type={showSbConfirmPassword ? 'text' : 'password'} bind:value={sbConfirmPassword} placeholder="••••••••" />
                <button class="password-toggle" onclick={() => showSbConfirmPassword = !showSbConfirmPassword} tabindex="-1" type="button">
                  {#if showSbConfirmPassword}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  {:else}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {/if}
                </button>
              </div>
            </div>
          {/if}
        {:else}
          {#if envLoaded && !showManualInput}
            <div class="env-badge">
              <span class="env-badge-icon">✅</span>
              <span>Usando configuración predeterminada del entorno</span>
              <button class="env-badge-btn" onclick={() => { showManualInput = true; }}>Usar otros datos →</button>
            </div>
          {:else}
            <div class="field">
              <label>URL de la base de datos</label>
              <input bind:value={cloudUrl} placeholder="libsql://xxxxx.turso.io" />
            </div>
            <div class="field">
              <label>Auth Token</label>
              <input bind:value={cloudKey} placeholder="tu token de acceso" />
            </div>
            {#if envLoaded}
              <button class="env-reset-btn" onclick={resetToEnvDefaults}>↩ Volver a configuración predeterminada</button>
            {/if}
          {/if}
        {/if}
        {#if errorMsg}
          <div class="welcome-error">{errorMsg}</div>
        {/if}
        <button class="welcome-btn-primary" onclick={handleCloudSync} disabled={loading}>
          {loading ? 'Conectando...' : provider === 'supabase' ? (authMode === 'register' ? 'Crear Cuenta y Sincronizar' : 'Iniciar Sesión y Sincronizar') : 'Conectar y descargar'}
        </button>
      </div>
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
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary, #0f172a);
    z-index: 10000;
    overflow-y: auto;
    padding: 1rem;
  }
  .welcome-container {
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }
  .wizard-container {
    max-width: 580px;
  }
  .welcome-brand {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .welcome-logo {
    font-size: 3rem;
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.05);
    border-radius: 24px;
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(20px);
  }
  .welcome-title {
    margin: 0;
    font-size: 1.8rem;
    font-weight: 700;
    color: #f1f5f9;
    letter-spacing: -0.5px;
  }
  .welcome-subtitle {
    margin: 0;
    color: #64748b;
    font-size: 0.9rem;
  }
  .welcome-cards {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    width: 100%;
  }
  .welcome-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    width: 100%;
    color: inherit;
    font: inherit;
  }
  .welcome-card:hover {
    border-color: var(--primary-color, #3b82f6);
    background: rgba(255,255,255,0.04);
    transform: translateY(-1px);
  }
  .welcome-card-icon {
    font-size: 2rem;
    width: 50px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .welcome-card-body { flex: 1; }
  .welcome-card-body h3 { margin: 0 0 0.25rem; font-size: 1rem; color: #e2e8f0; font-weight: 600; }
  .welcome-card-body p { margin: 0; font-size: 0.8rem; color: #64748b; line-height: 1.4; }
  .welcome-card-arrow { font-size: 1.3rem; color: #475569; flex-shrink: 0; }
  .welcome-back {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 0.5rem 1rem;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s ease;
    align-self: flex-start;
  }
  .welcome-back:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
  .welcome-form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .provider-tabs {
    display: flex;
    gap: 0.4rem;
    background: rgba(255,255,255,0.04);
    padding: 0.3rem;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .provider-tab {
    flex: 1;
    padding: 0.5rem;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: #64748b;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .provider-tab.active {
    background: var(--primary-color, #3b82f6);
    color: white;
  }
  .field { display: flex; flex-direction: column; gap: 0.3rem; }
  .field label {
    font-size: 0.65rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }
  .field input {
    padding: 0.65rem 0.85rem;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 0.85rem;
    outline: none;
    transition: border 0.2s ease;
  }
  .field input:focus { border-color: var(--primary-color, #3b82f6); }
  .field input::placeholder { color: #475569; }
  .password-wrapper {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    transition: border 0.2s ease;
  }
  .password-wrapper:focus-within { border-color: var(--primary-color, #3b82f6); }
  .password-wrapper input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    padding: 0.65rem 0 0.65rem 0.85rem;
    color: #e2e8f0;
    font-size: 0.85rem;
  }
  .password-wrapper input::placeholder { color: #475569; }
  .password-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 0.4rem 0.65rem;
    transition: color 0.2s;
    font-family: inherit;
  }
  .password-toggle:hover { color: #94a3b8; }
  .welcome-btn-primary {
    padding: 0.75rem;
    background: linear-gradient(135deg, var(--primary-color, #3b82f6), var(--primary-hover, #2563eb));
    border: none;
    border-radius: 10px;
    color: white;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 15px rgba(59,130,246,0.3);
  }
  .welcome-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
  .welcome-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .welcome-error {
    color: #ef4444;
    font-size: 0.8rem;
    text-align: center;
    padding: 0.5rem;
    background: rgba(239,68,68,0.1);
    border-radius: 8px;
  }
  .env-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.85rem;
    background: rgba(34,197,94,0.08);
    border: 1px solid rgba(34,197,94,0.2);
    border-radius: 10px;
    font-size: 0.8rem;
    color: #86efac;
    flex-wrap: wrap;
  }
  .env-badge-icon { font-size: 1rem; }
  .env-badge-btn {
    margin-left: auto;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 0.25rem 0.6rem;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.7rem;
    transition: all 0.2s;
    font-family: inherit;
  }
  .env-badge-btn:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .env-reset-btn {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    color: #64748b;
    cursor: pointer;
    font-size: 0.7rem;
    transition: all 0.2s;
    font-family: inherit;
    align-self: flex-start;
  }
  .env-reset-btn:hover { background: rgba(255,255,255,0.08); color: #94a3b8; }

  /* Wizard */
  .wizard-progress {
    display: flex;
    align-items: center;
    gap: 0;
    width: 100%;
    justify-content: center;
    padding: 0.5rem 0;
  }
  .wizard-step-dot {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(255,255,255,0.04);
    border: 2px solid rgba(255,255,255,0.08);
    font-size: 0.9rem;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }
  .wizard-step-dot.active {
    border-color: var(--primary-color, #3b82f6);
    background: rgba(59,130,246,0.15);
    box-shadow: 0 0 12px rgba(59,130,246,0.2);
  }
  .wizard-step-dot.done {
    border-color: #22c55e;
    background: rgba(34,197,94,0.15);
  }
  .wizard-step-line {
    width: 40px;
    height: 2px;
    background: rgba(255,255,255,0.08);
    transition: all 0.2s ease;
  }
  .wizard-step-line.done { background: #22c55e; }
  .wizard-step-label {
    font-size: 1.1rem;
    font-weight: 600;
    color: #e2e8f0;
    text-align: center;
  }
  .wizard-items {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .wizard-select-all {
    display: flex;
    justify-content: center;
  }
  .wizard-toggle-all {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.8rem;
    color: #94a3b8;
    padding: 0.4rem 0.75rem;
    background: rgba(255,255,255,0.03);
    border-radius: 8px;
    transition: background 0.2s;
  }
  .wizard-toggle-all:hover { background: rgba(255,255,255,0.06); }
  .wizard-toggle-all input { accent-color: var(--primary-color, #3b82f6); }
  .wizard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.5rem;
    max-height: 280px;
    overflow-y: auto;
    padding: 0.25rem;
  }
  .wizard-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .wizard-item:hover { border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.04); }
  .wizard-item.selected {
    border-color: var(--primary-color, #3b82f6);
    background: rgba(59,130,246,0.1);
  }
  .wizard-check {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 2px solid rgba(255,255,255,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }
  .wizard-item.selected .wizard-check {
    background: var(--primary-color, #3b82f6);
    border-color: var(--primary-color, #3b82f6);
  }
  .wizard-check svg { color: white; }
  .wizard-item-name { font-size: 0.82rem; color: #cbd5e1; font-weight: 500; }
  .wizard-item-badge {
    font-size: 0.6rem;
    color: #64748b;
    background: rgba(255,255,255,0.04);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    margin-left: auto;
  }
  .wizard-resumen {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .resumen-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
  }
  .resumen-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
  .resumen-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .resumen-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .resumen-value { font-size: 0.85rem; color: #e2e8f0; word-wrap: break-word; }
  .wizard-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 0.5rem;
  }
  .wizard-btn {
    padding: 0.6rem 1.25rem;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    color: #94a3b8;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }
  .wizard-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #e2e8f0; }
  .wizard-btn.primary {
    background: linear-gradient(135deg, var(--primary-color, #3b82f6), var(--primary-hover, #2563eb));
    border: none;
    color: white;
    box-shadow: 0 4px 15px rgba(59,130,246,0.3);
  }
  .wizard-btn.primary:hover:not(:disabled) { transform: translateY(-1px); }
  .wizard-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .wizard-step-counter {
    font-size: 0.8rem;
    color: #64748b;
    font-weight: 500;
  }
</style>
