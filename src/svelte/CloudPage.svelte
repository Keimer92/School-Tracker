<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { syncService, syncManager, type SyncStatus } from "../lib/syncService";
  import { getTursoUrl, getTursoToken, saveTursoCredentials, clearTursoCredentials } from "../lib/tursoClient";
  import GoogleDriveBackup from "./GoogleDriveBackup.svelte";

  let isSynced = $state(!!getTursoUrl());
  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  let showServerConfig = $state(false);
  let tursoUrl = $state(getTursoUrl());
  let tursoToken = $state(getTursoToken());
  let tursoTesting = $state(false);
  let tursoStatus: 'idle' | 'online' | 'offline' = $state('idle');
  let tursoLatency: number | null = $state(null);
  let tursoError: string | null = $state(null);
  let syncInterval = $state(parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '10', 10));

  let activeCloudTab: 'sync' | 'drive' = $state('sync');

  onMount(() => {
    const unsub = syncManager.subscribe((state) => { syncStatus = state; });
    return () => unsub();
  });

  async function handleConnectTurso() {
    tursoTesting = true; tursoError = null;
    try {
      const result = await syncService.connectAndSetup(tursoUrl, tursoToken);
      if (result.ok) { isSynced = true; tursoStatus = 'online'; syncService.ensurePeriodicSync(); syncService.syncAllSilent(); }
      else tursoError = result.error || 'Error de conexión';
    } catch (e: any) { tursoError = e?.message || String(e); }
    tursoTesting = false;
  }
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
        <span>☁️</span>
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

      {#if isSynced}
        <div style="padding: 0 1.5rem 1.5rem;">
          <div style="background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%); border-radius: 14px; border: 1px solid rgba(var(--primary-rgb), 0.12); padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: {syncStatus.status === 'syncing' ? '#eab308' : isSynced ? '#22c55e' : '#64748b'}; box-shadow: {isSynced ? '0 0 8px rgba(34,197,94,0.4)' : 'none'}; flex-shrink: 0;"></div>
              <div>
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.85rem;">{isSynced ? 'Conectado' : syncStatus.status === 'syncing' ? 'Sincronizando...' : 'Desconectado'}</div>
                <div style="color: #64748b; font-size: 0.7rem; margin-top: 1px;">{syncStatus.lastSync ? `Última sync: ${new Date(syncStatus.lastSync).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Sin sincronizar'}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8;"><span>⚡</span><span>{syncInterval}s</span></div>
              <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8; cursor: pointer;" onclick={() => showServerConfig = !showServerConfig}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              </div>
            </div>
          </div>

          {#if syncStatus.message}
            <div style="margin-top: 8px; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; border-left: 3px solid {syncStatus.status === 'error' ? '#ef4444' : 'var(--primary-color)'}; background: rgba(0,0,0,0.2); color: {syncStatus.status === 'error' ? '#fca5a5' : 'var(--text-secondary)'};">
              {syncStatus.message}
            </div>
          {/if}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 1rem;">
            <button onclick={async () => { try { await syncService.pushAll(); } catch (e) {} }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Subir datos</span>
            </button>
            <button onclick={() => syncService.pullAll()} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.12) 0%, rgba(var(--primary-rgb), 0.04) 100%); border: 1px solid rgba(var(--primary-rgb), 0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span style="color: var(--primary-color); font-weight: 600; font-size: 0.85rem;">Bajar datos</span>
            </button>
          </div>

          {#if showServerConfig}
            <div style="margin-top: 1rem; padding: 1rem 1.25rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                <span style="color: #cbd5e1; font-size: 0.85rem; font-weight: 600;">Configuración Turso</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem;">
                <input type="text" bind:value={tursoUrl} placeholder="libsql://mydb.turso.io" style="width: 100%; padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; outline: none; box-sizing: border-box;" />
                <input type="password" bind:value={tursoToken} placeholder="Token de autenticación" style="width: 100%; padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; outline: none; box-sizing: border-box;" />
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button onclick={handleConnectTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: none; background: {tursoTesting ? '#64748b' : 'var(--primary-color)'}; color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? 'Conectando...' : 'Conectar'}</button>
                <button onclick={async () => { tursoTesting = true; tursoStatus = 'idle'; tursoLatency = null; tursoError = null; try { const result = await syncService.testConnection(tursoUrl, tursoToken); tursoLatency = result.latency; tursoStatus = result.ok ? 'online' : 'offline'; if (!result.ok) tursoError = result.error || 'Conexión fallida'; } catch (e: any) { tursoStatus = 'offline'; tursoError = e?.message || String(e); } tursoTesting = false; }} disabled={tursoTesting || !tursoUrl || !tursoToken} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? '...' : 'Probar'}</button>
              </div>
              {#if tursoStatus !== 'idle'}
                <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; margin-top: 0.5rem; background: {tursoStatus === 'online' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color: {tursoStatus === 'online' ? '#4ade80' : '#f87171'};">
                  {tursoStatus === 'online' ? `✅ Conectado (${tursoLatency}ms)` : `❌ ${tursoError || `Sin conexión`}`}
                </div>
              {/if}
              <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                <button onclick={async () => { try { const result = await syncService.testConnection(tursoUrl, tursoToken); if (!result.ok) { tursoError = result.error || 'Conexión fallida'; tursoStatus = 'offline'; return; } const sr = await syncService.runSchemaSetup(); if (!sr.ok) tursoError = sr.error || 'Error creando schema'; else tursoStatus = 'online'; } catch (e: any) { tursoError = e?.message || String(e); } }} disabled={!tursoUrl || !tursoToken} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Ejecutar Schema</button>
                <button onclick={() => { clearTursoCredentials(); tursoUrl = ''; tursoToken = ''; tursoStatus = 'idle'; isSynced = false; syncService.disconnect(); }} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Desconectar</button>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; padding-top: 0.75rem; margin-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
                <span style="color: #94a3b8; font-size: 0.8rem;">Sync periódico:</span>
                <input type="number" min={3} max={300} bind:value={syncInterval} oninput={() => { localStorage.setItem('periodic_sync_interval_seconds', String(syncInterval)); syncService.ensurePeriodicSync(); }} style="width: 56px; padding: 0.25rem 0.4rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
                <span style="color: #64748b; font-size: 0.8rem;">segundos</span>
              </div>
            </div>
          {/if}

          <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
            {#each [{ icon: '💻', title: 'Local-First', desc: 'Datos seguros en tu PC' }, { icon: '☁️', title: 'Turso Cloud', desc: 'Siempre disponible' }, { icon: '📴', title: 'Offline', desc: 'Trabaja sin internet' }, { icon: '🔄', title: 'Periódico', desc: `Cada ${syncInterval}s` }] as item}
              <div style="padding: 0.75rem; background: rgba(0,0,0,0.15); border-radius: 10px; text-align: center;">
                <div style="font-size: 1.1rem; margin-bottom: 2px;">{item.icon}</div>
                <div style="font-size: 0.75rem; color: #f1f5f9; font-weight: 600;">{item.title}</div>
                <div style="font-size: 0.65rem; color: #64748b; margin-top: 1px;">{item.desc}</div>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div style="padding: 1.5rem 1.5rem 2.5rem; text-align: center;">
          <div style="color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem;">Conectá tu base de datos Turso para sincronizar datos entre dispositivos.</div>
          <div style="max-width: 400px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.5rem;">
            <input type="text" bind:value={tursoUrl} placeholder="libsql://mydb.turso.io" style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.85rem; font-family: monospace; outline: none; box-sizing: border-box;" />
            <input type="password" bind:value={tursoToken} placeholder="Token de autenticación" style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.85rem; font-family: monospace; outline: none; box-sizing: border-box;" />
            <button onclick={handleConnectTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="padding: 0.6rem 1rem; border-radius: 8px; border: none; background: {tursoTesting ? '#64748b' : 'var(--primary-color)'}; color: #fff; font-weight: 600; font-size: 0.85rem; cursor: pointer;">{tursoTesting ? 'Conectando...' : 'Conectar a Turso'}</button>
            {#if tursoError}<div style="color: #f87171; font-size: 0.75rem; margin-top: 0.5rem;">❌ {tursoError}</div>{/if}
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

<style>
  .cloud-page { max-width: 900px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; }
  .cloud-tabs-wrapper { display: flex; justify-content: center; margin-bottom: 1.5rem; }
  .cloud-tabs { display: inline-flex; padding: 0.4rem; gap: 0.3rem; background: var(--bg-elevated); border-radius: 14px; border: 1px solid var(--border); }
  .cloud-tab { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; border-radius: 10px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: 600; transition: all 0.2s ease; white-space: nowrap; }
  .cloud-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .cloud-tab.active { background: var(--bg-active); color: var(--text-bright); box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.08); }
  .cloud-tab-dot { width: 6px; height: 6px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 5px #4ade80; }
  .cloud-panels { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
  .cloud-card { background: var(--card-bg); backdrop-filter: blur(12px); border-radius: 20px; border: 1px solid var(--card-border); overflow: hidden; }
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
