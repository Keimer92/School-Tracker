<script lang="ts">
  import { onMount } from "svelte";
  import { syncService, syncManager, type SyncStatus, type SyncProviderType, getActiveProvider, onProviderChange } from "../lib/syncService";
  import { getTursoUrl, getTursoToken, saveTursoCredentials, clearTursoCredentials } from "../lib/tursoClient";
  import { getSupabaseClient, hasSupabaseConfig, saveSupabaseConfig, clearSupabaseConfig } from "../lib/supabase";
  import GoogleDriveBackup from "./GoogleDriveBackup.svelte";

  let { activeTab = "cloud" } = $props();

  let syncProvider = $state<SyncProviderType>(getActiveProvider());
  let isSynced = $state(false);
  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  let syncInterval = $state(parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '60', 10));
  let sbSessionUser: string | null = $state(null);

  let tursoUrl = $state(getTursoUrl());
  let tursoToken = $state(getTursoToken());
  let tursoTesting = $state(false);
  let tursoStatus: 'idle' | 'online' | 'offline' = $state('idle');
  let tursoLatency: number | null = $state(null);
  let tursoError: string | null = $state(null);

  let sbUrl = $state(localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || '');
  let sbAnonKey = $state(localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '');
  let sbTesting = $state(false);
  let sbStatus: 'idle' | 'online' | 'offline' = $state('idle');
  let sbLatency: number | null = $state(null);
  let sbError: string | null = $state(null);
  let sbEmail = $state('');
  let sbPassword = $state('');
  let sbConfirmPassword = $state('');
  let authMode: 'register' | 'login' = $state('register');
  let showForgotModal = $state(false);
  let sbResetEmail = $state('');
  let resetSent = $state(false);
  let showResetPassword = $state(false);
  let newPassword = $state('');
  let newPasswordConfirm = $state('');

  $effect(() => {
    if (activeTab === 'cloud') {
      tursoUrl = getTursoUrl();
      tursoToken = getTursoToken();
      sbUrl = localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || '';
      sbAnonKey = localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    }
  });

  function providerBadgeLabel(): string {
    return syncProvider === 'turso' ? 'Turso' : 'Supabase';
  }
  function providerBadgeIcon(): string {
    return syncProvider === 'turso' ? '🗄️' : '🔲';
  }

  let activeCloudTab: 'sync' | 'drive' = $state('sync');

  async function refreshFromProvider() {
    syncProvider = getActiveProvider();
    tursoUrl = getTursoUrl();
    tursoToken = getTursoToken();
    sbUrl = localStorage.getItem('supabase_url') || '';
    sbAnonKey = localStorage.getItem('supabase_anon_key') || '';
    if (syncProvider === 'supabase') {
      const client = getSupabaseClient();
      if (client) {
        const { data: { session } } = await client.auth.getSession();
        if (session?.user) {
          sbSessionUser = session.user.email || session.user.id;
          sbStatus = 'online';
          isSynced = true;
          syncService.ensurePeriodicSync();
          return;
        }
      }
      sbSessionUser = null;
      sbStatus = 'idle';
      isSynced = false;
    } else {
      sbSessionUser = null;
      sbStatus = 'idle';
      isSynced = !!tursoUrl;
    }
  }

  async function handleConnectTurso() {
    tursoTesting = true; tursoError = null;
    try {
      saveTursoCredentials(tursoUrl, tursoToken);
      const result = await syncService.connectAndSetup(tursoUrl, tursoToken);
      if (result.ok) { tursoStatus = 'online'; isSynced = true; syncService.ensurePeriodicSync(); syncService.syncAllSilent(); }
      else tursoError = result.error || 'Error de conexión';
    } catch (e: any) { tursoError = e?.message || String(e); }
    tursoTesting = false;
  }

  async function handleTestTurso() {
    tursoTesting = true; tursoStatus = 'idle'; tursoLatency = null; tursoError = null;
    try {
      const result = await syncService.testConnection(tursoUrl, tursoToken);
      tursoLatency = result.latency; tursoStatus = result.ok ? 'online' : 'offline';
      if (!result.ok) tursoError = result.error || 'Conexión fallida';
    } catch (e: any) { tursoStatus = 'offline'; tursoError = e?.message || String(e); }
    tursoTesting = false;
  }

  function handleDisconnectTurso() {
    clearTursoCredentials(); tursoUrl = ''; tursoToken = ''; tursoStatus = 'idle'; isSynced = false;
    try { syncService.disconnect(); } catch {}
  }

  async function handleTestSupabase() {
    sbTesting = true; sbStatus = 'idle'; sbLatency = null; sbError = null;
    try {
      saveSupabaseConfig(sbUrl, sbAnonKey);
      const result = await syncService.testConnection(sbUrl, sbAnonKey);
      sbLatency = result.latency; sbStatus = result.ok ? 'online' : 'offline';
      if (!result.ok) sbError = result.error || 'Conexión fallida';
      else {
        const client = getSupabaseClient();
        if (client) {
          const { data: { session } } = await client.auth.getSession();
          sbSessionUser = session?.user?.email || null;
        }
      }
    } catch (e: any) { sbStatus = 'offline'; sbError = e?.message || String(e); }
    sbTesting = false;
  }

  async function handleConnectSupabase() {
    sbTesting = true; sbError = null;
    try {
      if (sbUrl && sbAnonKey) saveSupabaseConfig(sbUrl, sbAnonKey);
      const client = getSupabaseClient();
      if (!client) { sbError = 'No se pudo crear el cliente Supabase'; sbTesting = false; return; }
      const { data, error } = await client.auth.signInWithPassword({ email: sbEmail, password: sbPassword });
      if (error) {
        if (error.message?.toLowerCase().includes('invalid login credentials')) {
          sbError = '❌ Correo o contraseña incorrectos';
        } else {
          sbError = error.message;
        }
        sbTesting = false; return;
      }
      sbSessionUser = data.user?.email || data.user?.id || 'Conectado';
      sbStatus = 'online';
      isSynced = true;
      syncService.ensurePeriodicSync();
      const sr = await syncService.runSchemaSetup();
      if (!sr.ok) {
        sbError = sr.error || 'No se pudo preparar la base de datos remota en Supabase.';
      }
      await syncService.syncAllSilent();
    } catch (e: any) { sbError = e?.message || String(e); }
    sbTesting = false;
  }

  async function handleSignUp() {
    if (sbPassword !== sbConfirmPassword) { sbError = '❌ Las contraseñas no coinciden'; return; }
    sbTesting = true; sbError = null;
    try {
      if (sbUrl && sbAnonKey) saveSupabaseConfig(sbUrl, sbAnonKey);
      const client = getSupabaseClient();
      if (!client) { sbError = 'No se pudo crear el cliente Supabase'; sbTesting = false; return; }
      const { data, error } = await client.auth.signUp({ email: sbEmail, password: sbPassword });
      if (error) {
        if (error.message?.toLowerCase().includes('already registered') || error.message?.toLowerCase().includes('duplicate')) {
          sbError = '❌ Ya existe una cuenta con este correo';
        } else { sbError = error.message; }
        sbTesting = false; return;
      }
      sbSessionUser = data.user?.email || data.user?.id || 'Registrado';
      sbStatus = 'online';
      isSynced = true;
      syncService.ensurePeriodicSync();
      const sr = await syncService.runSchemaSetup();
      if (!sr.ok) sbError = sr.error || 'No se pudo preparar la base de datos remota.';
      await syncService.syncAllSilent();
    } catch (e: any) { sbError = e?.message || String(e); }
    sbTesting = false;
  }

  async function handleResetPassword() {
    sbTesting = true; resetSent = false;
    try {
      const client = getSupabaseClient();
      if (!client) { sbTesting = false; return; }
      const { error } = await client.auth.resetPasswordForEmail(sbResetEmail, { redirectTo: 'schooltrackerpro://reset-password' });
      if (error) { sbTesting = false; return; }
      resetSent = true;
    } catch {}
    sbTesting = false;
  }

  async function handleSetNewPassword() {
    if (newPassword !== newPasswordConfirm) { sbError = '❌ Las contraseñas no coinciden'; return; }
    if (newPassword.length < 6) { sbError = '❌ La contraseña debe tener al menos 6 caracteres'; return; }
    sbTesting = true; sbError = null;
    try {
      const client = getSupabaseClient();
      if (!client) { sbError = 'No se pudo conectar'; sbTesting = false; return; }
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) { sbError = error.message; sbTesting = false; return; }
      showResetPassword = false;
      newPassword = ''; newPasswordConfirm = '';
      await emit("show-toast", { message: "✅ Contraseña actualizada correctamente", type: "success" });
    } catch (e: any) { sbError = e?.message || String(e); }
    sbTesting = false;
  }

  function handleDisconnectSupabase() {
    clearSupabaseConfig();
    sbUrl = ''; sbAnonKey = ''; sbEmail = ''; sbPassword = '';
    sbStatus = 'idle'; sbSessionUser = null; isSynced = false;
    try { syncService.disconnect(); } catch {}
  }

  async function handleSupabaseLogout() {
    try { const client = getSupabaseClient(); if (client) await client.auth.signOut(); } catch {}
    handleDisconnectSupabase();
  }

  function handleDisconnectProvider() {
    if (syncProvider === 'turso') handleDisconnectTurso();
    else handleDisconnectSupabase();
  }

  onMount(async () => {
    const unsubSync = syncManager.subscribe((state) => { syncStatus = state; });
    const unsubProvider = onProviderChange(refreshFromProvider);
    await refreshFromProvider();
    try {
      const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      onOpenUrl((urls: string[]) => {
        for (const url of urls) {
          if (url.includes('reset-password') || url.includes('type=recovery')) {
            const hash = url.split('#')[1] || '';
            const params = new URLSearchParams(hash.replace(/&/g, '&').split('&').filter(p => p.includes('=')).join('&'));
            const accessToken = params.get('access_token') || hash.split('&').find(p => p.startsWith('access_token='))?.split('=')[1];
            const refreshToken = params.get('refresh_token') || '';
            if (accessToken) {
              const client = getSupabaseClient();
              if (client) {
                client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(() => {
                  showResetPassword = true;
                });
              }
            }
          }
        }
      });
    } catch (e) { console.log('Deep link plugin not available on this platform'); }
    return () => { unsubSync(); unsubProvider(); };
  });


</script>

<div class="cloud-page">
  <div class="cloud-tabs-wrapper">
    <div class="cloud-tabs">
      <button class="cloud-tab" class:active={activeCloudTab === 'sync'} onclick={() => activeCloudTab = 'sync'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z"/></svg>
        <span>Sync</span>
        {#if isSynced}<span class="cloud-tab-dot"></span>{/if}
      </button>
      <button class="cloud-tab" class:active={activeCloudTab === 'drive'} onclick={() => activeCloudTab = 'drive'}>
        <span style="font-size: 1rem;">☁️</span>
        <span>Drive</span>
      </button>
    </div>
  </div>

  <div class="cloud-panels">
    <div class="cloud-card" class:visible={activeCloudTab === 'sync'}>
      <div class="cloud-card-header">
        <h3><span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="var(--primary-color)"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
          Sincronización en la Nube</span></h3>
      </div>

      <!-- Provider Badge -->
      <div style="padding: 0 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 1rem; background: rgba(0,0,0,0.15); border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">
          <span style="font-size: 1rem;">{providerBadgeIcon()}</span>
          <span style="color: #94a3b8; font-size: 0.8rem;">Proveedor activo:</span>
          <span style="color: #f1f5f9; font-weight: 700; font-size: 0.85rem;">{providerBadgeLabel()}</span>
          <span style="margin-left: auto; font-size: 0.7rem; color: #64748b;">Config en Ajustes → Nube</span>
        </div>
      </div>

      {#if (syncProvider === 'supabase' && (sbError || (syncStatus.status === 'error' && syncStatus.message))) || (syncProvider === 'turso' && (tursoError || (syncStatus.status === 'error' && syncStatus.message)))}
        <div style="margin: 1rem 1.5rem 0; padding: 0.9rem 1rem; border-radius: 12px; border: 1px solid rgba(248,113,113,0.25); background: rgba(239,68,68,0.12); color: #fecaca; font-size: 0.8rem; line-height: 1.45;">
          <div style="font-weight: 700; margin-bottom: 0.25rem;">⚠️ Error de sincronización</div>
          <div>{syncProvider === 'supabase' ? (sbError || syncStatus.message) : (tursoError || syncStatus.message)}</div>
        </div>
      {/if}

      {#if isSynced}
        <div style="padding: 0 1.5rem 1.5rem;">
          <div style="background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%); border-radius: 14px; border: 1px solid rgba(var(--primary-rgb), 0.12); padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: {syncStatus.status === 'syncing' ? '#eab308' : isSynced ? '#22c55e' : '#64748b'}; box-shadow: {isSynced ? '0 0 8px rgba(34,197,94,0.4)' : 'none'}; flex-shrink: 0;"></div>
              <div>
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.85rem;">
                  {#if syncProvider === 'supabase'}
                    {sbSessionUser ? `Conectado como ${sbSessionUser}` : 'Conectado'}
                  {:else}
                    {isSynced ? 'Conectado' : syncStatus.status === 'syncing' ? 'Sincronizando...' : 'Desconectado'}
                  {/if}
                </div>
                <div style="color: #64748b; font-size: 0.7rem; margin-top: 1px;">{syncStatus.lastSync ? `Última sync: ${new Date(syncStatus.lastSync).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Sin sincronizar'}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              {#if syncProvider === 'supabase' && sbSessionUser}
                <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8;"><span>👤</span><span style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{sbSessionUser}</span></div>
              {/if}
              <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8;"><span>⚡</span><span>{syncInterval}s</span></div>
            </div>
          </div>

          {#if syncStatus.message}
            <div style="margin-top: 8px; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; border-left: 3px solid {syncStatus.status === 'error' ? '#ef4444' : 'var(--primary-color)'}; background: rgba(0,0,0,0.2); color: {syncStatus.status === 'error' ? '#fca5a5' : 'var(--text-secondary)'};">
              {syncStatus.message}
            </div>
          {/if}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 1rem;">
            <button onclick={async () => { try { await syncService.forcePushAll(); } catch (e) {} }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Subir todo</span>
            </button>
            <button onclick={() => syncService.pullAll()} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.12) 0%, rgba(var(--primary-rgb), 0.04) 100%); border: 1px solid rgba(var(--primary-rgb), 0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span style="color: var(--primary-color); font-weight: 600; font-size: 0.85rem;">Bajar datos</span>
            </button>
          </div>

          {#if syncProvider === 'turso'}
            <div style="margin-top: 1rem; padding: 1rem 1.25rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                <span style="color: #cbd5e1; font-size: 0.85rem; font-weight: 600;">Acciones Turso</span>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button onclick={handleConnectTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: none; background: {tursoTesting ? '#64748b' : 'var(--primary-color)'}; color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? 'Conectando...' : 'Conectar'}</button>
                <button onclick={handleTestTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? '...' : 'Probar'}</button>
              </div>
              {#if tursoStatus !== 'idle'}
                <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; margin-top: 0.5rem; background: {tursoStatus === 'online' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color: {tursoStatus === 'online' ? '#4ade80' : '#f87171'};">
                  {tursoStatus === 'online' ? `✅ Conectado (${tursoLatency}ms)` : `❌ ${tursoError || 'Sin conexión'}`}
                </div>
              {/if}
              <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                <button onclick={handleDisconnectTurso} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Desconectar</button>
              </div>
            </div>
          {:else}
            <div style="margin-top: 1rem; padding: 1rem 1.25rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                <span style="color: #cbd5e1; font-size: 0.85rem; font-weight: 600;">Acciones Supabase</span>
              </div>

              {#if !sbSessionUser}
                <div style="margin-top: 0.25rem; padding: 0.75rem; background: rgba(0,0,0,0.15); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                  <div style="display:flex;gap:0.4rem;margin-bottom:0.6rem;background:rgba(0,0,0,0.2);border-radius:8px;padding:0.2rem;border:1px solid rgba(255,255,255,0.06);">
                    <button onclick={() => authMode = 'register'} style="flex:1;padding:0.35rem 0.5rem;border-radius:6px;border:none;cursor:pointer;font-size:0.75rem;font-weight:600;transition:all 0.2s;background:{authMode === 'register' ? 'var(--primary-color)' : 'transparent'};color:{authMode === 'register' ? '#fff' : '#94a3b8'};">📝 Crear Cuenta</button>
                    <button onclick={() => authMode = 'login'} style="flex:1;padding:0.35rem 0.5rem;border-radius:6px;border:none;cursor:pointer;font-size:0.75rem;font-weight:600;transition:all 0.2s;background:{authMode === 'login' ? 'var(--primary-color)' : 'transparent'};color:{authMode === 'login' ? '#fff' : '#94a3b8'};">🔑 Iniciar Sesión</button>
                  </div>
                  {#if authMode === 'register'}
                    <input type="email" bind:value={sbEmail} placeholder="correo@ejemplo.com" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;" />
                    <input type="password" bind:value={sbPassword} placeholder="Contraseña" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;" />
                    <input type="password" bind:value={sbConfirmPassword} placeholder="Confirmar contraseña" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;" />
                  {:else}
                    <input type="email" bind:value={sbEmail} placeholder="correo@ejemplo.com" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;" />
                    <input type="password" bind:value={sbPassword} placeholder="Contraseña" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;" />
                    <button onclick={() => showForgotModal = true} style="background:none;border:none;color:#64748b;font-size:0.7rem;cursor:pointer;padding:0.3rem 0 0;text-decoration:underline;display:block;width:100%;text-align:right;">¿Olvidaste tu contraseña?</button>
                  {/if}
                </div>
              {/if}

              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
                {#if !sbSessionUser}
                  {#if authMode === 'register'}
                    <button onclick={handleSignUp} disabled={sbTesting || !sbUrl || !sbAnonKey || !sbEmail || !sbPassword || !sbConfirmPassword} style="flex:1;padding:0.5rem 1rem;border-radius:8px;border:none;background:{sbTesting ? '#64748b' : 'var(--primary-color)'};color:#fff;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;min-width:120px;">{sbTesting ? 'Conectando...' : '📝 Crear Cuenta'}</button>
                  {:else}
                    <button onclick={handleConnectSupabase} disabled={sbTesting || !sbUrl || !sbAnonKey || !sbEmail || !sbPassword} style="flex:1;padding:0.5rem 1rem;border-radius:8px;border:none;background:{sbTesting ? '#64748b' : 'var(--primary-color)'};color:#fff;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;min-width:120px;">{sbTesting ? 'Conectando...' : '🔑 Iniciar Sesión'}</button>
                  {/if}
                {:else}
                  <button onclick={async () => { await syncService.syncAllSilent(); }} disabled={syncStatus.status === 'syncing'} style="flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: none; background: var(--primary-color); color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">Sincronizar ahora</button>
                {/if}
                <button onclick={handleTestSupabase} disabled={sbTesting || !sbUrl || !sbAnonKey} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{sbTesting ? '...' : 'Probar'}</button>
              </div>

              {#if sbStatus !== 'idle'}
                <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; margin-top: 0.5rem; background: {sbStatus === 'online' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color: {sbStatus === 'online' ? '#4ade80' : '#f87171'};">
                  {sbStatus === 'online' ? `✅ Conectado (${sbLatency}ms)` : `❌ ${sbError || 'Sin conexión'}`}
                </div>
              {/if}

              <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap;">
                {#if sbSessionUser}
                  <button onclick={handleSupabaseLogout} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Cerrar Sesión</button>
                {/if}
                <button onclick={handleDisconnectProvider} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Desconectar</button>
              </div>
            </div>
          {/if}

          <div style="display: flex; align-items: center; gap: 0.5rem; padding-top: 0.75rem; margin-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
            <span style="color: #94a3b8; font-size: 0.8rem;">Sync periódico:</span>
            <input type="number" min={3} max={300} bind:value={syncInterval} oninput={() => { localStorage.setItem('periodic_sync_interval_seconds', String(syncInterval)); syncService.ensurePeriodicSync(); }} style="width: 56px; padding: 0.25rem 0.4rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
            <span style="color: #64748b; font-size: 0.8rem;">segundos</span>
          </div>

          <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
            {#each [{ icon: '💻', title: 'Local-First', desc: 'Datos seguros en tu PC' }, { icon: '☁️', title: syncProvider === 'supabase' ? 'Supabase' : 'Turso', desc: 'Siempre disponible' }, { icon: '📴', title: 'Offline', desc: 'Trabaja sin internet' }, { icon: '🔄', title: 'Periódico', desc: `Cada ${syncInterval}s` }] as item}
              <div style="padding: 0.75rem; background: rgba(0,0,0,0.15); border-radius: 10px; text-align: center;">
                <div style="font-size: 1.1rem; margin-bottom: 2px;">{item.icon}</div>
                <div style="font-size: 0.75rem; color: #f1f5f9; font-weight: 600;">{item.title}</div>
                <div style="font-size: 0.65rem; color: #64748b; margin-top: 1px;">{item.desc}</div>
              </div>
            {/each}
          </div>
        </div>
      {:else if tursoUrl || sbUrl}
        <div style="padding: 1.5rem;">
          <div style="padding: 1.25rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
            {#if syncProvider === 'turso'}
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                <span style="color: #cbd5e1; font-size: 0.85rem; font-weight: 600;">Turso configurado</span>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button onclick={handleConnectTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: none; background: {tursoTesting ? '#64748b' : 'var(--primary-color)'}; color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? 'Conectando...' : 'Conectar a Turso'}</button>
                <button onclick={handleTestTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? '...' : 'Probar'}</button>
                <button onclick={handleDisconnectTurso} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Olvidar</button>
              </div>
              {#if tursoError}<div style="color: #f87171; font-size: 0.75rem; margin-top: 0.5rem;">❌ {tursoError}</div>{/if}
            {:else}
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                <span style="color: #cbd5e1; font-size: 0.85rem; font-weight: 600;">Supabase configurado</span>
              </div>
              {#if !sbSessionUser}
                <div style="padding: 0.75rem; background: rgba(0,0,0,0.15); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 0.75rem;">
                  <div style="display:flex;gap:0.4rem;margin-bottom:0.6rem;background:rgba(0,0,0,0.2);border-radius:8px;padding:0.2rem;border:1px solid rgba(255,255,255,0.06);">
                    <button onclick={() => authMode = 'register'} style="flex:1;padding:0.35rem 0.5rem;border-radius:6px;border:none;cursor:pointer;font-size:0.75rem;font-weight:600;transition:all 0.2s;background:{authMode === 'register' ? 'var(--primary-color)' : 'transparent'};color:{authMode === 'register' ? '#fff' : '#94a3b8'};">📝 Crear Cuenta</button>
                    <button onclick={() => authMode = 'login'} style="flex:1;padding:0.35rem 0.5rem;border-radius:6px;border:none;cursor:pointer;font-size:0.75rem;font-weight:600;transition:all 0.2s;background:{authMode === 'login' ? 'var(--primary-color)' : 'transparent'};color:{authMode === 'login' ? '#fff' : '#94a3b8'};">🔑 Iniciar Sesión</button>
                  </div>
                  {#if authMode === 'register'}
                    <input type="email" bind:value={sbEmail} placeholder="correo@ejemplo.com" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;" />
                    <input type="password" bind:value={sbPassword} placeholder="Contraseña" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;" />
                    <input type="password" bind:value={sbConfirmPassword} placeholder="Confirmar contraseña" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;" />
                  {:else}
                    <input type="email" bind:value={sbEmail} placeholder="correo@ejemplo.com" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;" />
                    <input type="password" bind:value={sbPassword} placeholder="Contraseña" style="width:100%;padding:0.5rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#e2e8f0;font-size:0.8rem;outline:none;box-sizing:border-box;" />
                    <button onclick={() => showForgotModal = true} style="background:none;border:none;color:#64748b;font-size:0.7rem;cursor:pointer;padding:0.3rem 0 0;text-decoration:underline;display:block;width:100%;text-align:right;">¿Olvidaste tu contraseña?</button>
                  {/if}
                </div>
              {/if}
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                {#if !sbSessionUser}
                  {#if authMode === 'register'}
                    <button onclick={handleSignUp} disabled={sbTesting || !sbUrl || !sbAnonKey || !sbEmail || !sbPassword || !sbConfirmPassword} style="flex:1;padding:0.5rem 1rem;border-radius:8px;border:none;background:{sbTesting ? '#64748b' : 'var(--primary-color)'};color:#fff;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;">{sbTesting ? 'Conectando...' : '📝 Crear Cuenta'}</button>
                  {:else}
                    <button onclick={handleConnectSupabase} disabled={sbTesting || !sbUrl || !sbAnonKey || !sbEmail || !sbPassword} style="flex:1;padding:0.5rem 1rem;border-radius:8px;border:none;background:{sbTesting ? '#64748b' : 'var(--primary-color)'};color:#fff;font-weight:600;font-size:0.8rem;cursor:pointer;white-space:nowrap;">{sbTesting ? 'Conectando...' : '🔑 Iniciar Sesión'}</button>
                  {/if}
                {/if}
                <button onclick={handleTestSupabase} disabled={sbTesting || !sbUrl || !sbAnonKey} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{sbTesting ? '...' : 'Probar'}</button>
                <button onclick={handleDisconnectSupabase} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Olvidar</button>
              </div>
              {#if sbError}<div style="color: #f87171; font-size: 0.75rem; margin-top: 0.5rem;">❌ {sbError}</div>{/if}
            {/if}
          </div>
        </div>
      {:else}
        <div style="padding: 2rem; text-align: center;">
          <div style="color: #64748b; font-size: 0.9rem;">
            Ve a <strong style="color: #94a3b8;">Ajustes → Nube</strong> para configurar URL y token, luego conectate aquí.
          </div>
        </div>
      {/if}
    </div>

    <div class="cloud-card" class:visible={activeCloudTab === 'drive'}>
      <div class="cloud-card-header">
        <h3>☁️ Respaldo en Google Drive</h3>
      </div>
      <div style="padding: 2rem;">
        <GoogleDriveBackup />
      </div>
    </div>
  </div>
</div>

<!-- Forgot Password Modal -->
{#if showForgotModal}
  <div style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);"
    onclick={() => { showForgotModal = false; resetSent = false; sbResetEmail = ''; }}>
    <div style="width:380px;max-width:90%;padding:1.5rem;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);"
      onclick={(e) => e.stopPropagation()}>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(var(--primary-rgb),0.15);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🔐</div>
        <h3 style="margin:0;color:#f1f5f9;font-size:1.05rem;font-weight:700;">Recuperar Contraseña</h3>
      </div>
      {#if resetSent}
        <div style="padding:1rem;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:10px;color:#4ade80;font-size:0.85rem;margin-bottom:1rem;">✅ Revisa tu correo para restablecer la contraseña</div>
      {:else}
        <p style="color:#94a3b8;font-size:0.8rem;margin:0 0 1rem;">Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.</p>
        <input type="email" bind:value={sbResetEmail} placeholder="correo@ejemplo.com"
          style="width:100%;padding:0.55rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(15,23,42,0.5);color:#e2e8f0;font-size:0.85rem;outline:none;box-sizing:border-box;transition:border 0.2s;margin-bottom:1rem;"
          onfocus={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
          onblur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
          onkeydown={(e) => { if (e.key === 'Enter') handleResetPassword(); }} />
      {/if}
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        {#if resetSent}
          <button onclick={() => { showForgotModal = false; resetSent = false; sbResetEmail = ''; }}
            style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:none;background:var(--primary-color);color:#fff;font-weight:600;cursor:pointer;">Cerrar</button>
        {:else}
          <button onclick={() => { showForgotModal = false; resetSent = false; sbResetEmail = ''; }}
            style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-weight:600;">Cancelar</button>
          <button onclick={handleResetPassword} disabled={!sbResetEmail || sbTesting}
            style="padding:0.5rem 1.25rem;font-size:0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,var(--primary-hover),var(--primary-color));color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(var(--primary-rgb),0.3);">{sbTesting ? 'Enviando...' : 'Enviar enlace'}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Reset Password Form (after deep link) -->
{#if showResetPassword}
  <div style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
    <div style="width:380px;max-width:90%;padding:1.5rem;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(var(--primary-rgb),0.15);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🔑</div>
        <h3 style="margin:0;color:#f1f5f9;font-size:1.05rem;font-weight:700;">Restablecer Contraseña</h3>
      </div>
      <p style="color:#94a3b8;font-size:0.8rem;margin:0 0 1rem;">Ingresa tu nueva contraseña.</p>
      <input type="password" bind:value={newPassword} placeholder="Nueva contraseña"
        style="width:100%;padding:0.55rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(15,23,42,0.5);color:#e2e8f0;font-size:0.85rem;outline:none;box-sizing:border-box;margin-bottom:0.4rem;transition:border 0.2s;"
        onfocus={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
        onblur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'} />
      <input type="password" bind:value={newPasswordConfirm} placeholder="Confirmar nueva contraseña"
        style="width:100%;padding:0.55rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(15,23,42,0.5);color:#e2e8f0;font-size:0.85rem;outline:none;box-sizing:border-box;margin-bottom:1rem;transition:border 0.2s;"
        onfocus={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
        onblur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
        onkeydown={(e) => { if (e.key === 'Enter') handleSetNewPassword(); }} />
      {#if sbError}
        <div style="padding:0.5rem 0.75rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;color:#fca5a5;font-size:0.8rem;margin-bottom:1rem;">{sbError}</div>
      {/if}
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button onclick={() => { showResetPassword = false; newPassword = ''; newPasswordConfirm = ''; sbError = null; }}
          style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-weight:600;">Cancelar</button>
        <button onclick={handleSetNewPassword} disabled={!newPassword || !newPasswordConfirm || sbTesting}
          style="padding:0.5rem 1.25rem;font-size:0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,var(--primary-hover),var(--primary-color));color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(var(--primary-rgb),0.3);">{sbTesting ? 'Guardando...' : 'Guardar nueva contraseña'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cloud-page { max-width: 900px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; }
  .cloud-tabs-wrapper { display: flex; justify-content: center; margin-bottom: 1.5rem; }
  .cloud-tabs { display: inline-flex; padding: 0.4rem; gap: 0.3rem; background: var(--bg-elevated); border-radius: 14px; border: 1px solid var(--border); }
  .cloud-tab { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; border-radius: 10px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: 600; transition: all 0.2s ease; white-space: nowrap; }
  .cloud-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .cloud-tab.active { background: var(--bg-active); color: var(--text-bright); box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.08); }
  .cloud-tab-dot { width: 6px; height: 6px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 5px #4ade80; }
  .cloud-panels { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
  .cloud-card { background: var(--card-bg); border-radius: 20px; border: 1px solid var(--card-border); overflow: hidden; }
  .cloud-card-header { padding: 1.25rem 1.5rem 0; }
  .cloud-card-header h3 { margin: 0; color: var(--text-primary); font-size: 1.1rem; font-weight: 700; }
  @media (min-width: 1024px) {
    .cloud-page { max-width: none; height: 100%; }
    .cloud-tabs-wrapper { display: none; }
    .cloud-panels { grid-template-columns: 1fr 1fr; flex: 1; align-content: stretch; }
    .cloud-card { height: 100%; display: flex; flex-direction: column; }
    .cloud-card > *:last-child { flex: 1; }
  }
  @media (max-width: 1023px) {
    .cloud-card:not(.visible) { display: none; }
  }
</style>
