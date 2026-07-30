<script lang="ts">
  import { onMount } from "svelte";
  import { syncService, syncManager, type SyncStatus } from "../lib/syncService";
  import GoogleDriveBackup from "./GoogleDriveBackup.svelte";

  let { activeTab = "cloud" } = $props();

  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  let syncInterval = $state(parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '60', 10));
  let activeCloudTab: 'sync' | 'drive' = $state('sync');

  let driveSettings = $state<any>(null);

  function loadDriveSettings() {
    try {
      const stored = localStorage.getItem('schooltracker-google-drive-settings');
      driveSettings = stored ? JSON.parse(stored) : null;
    } catch { driveSettings = null; }
  }

  onMount(async () => {
    const unsubSync = syncManager.subscribe((state) => { syncStatus = state; });
    loadDriveSettings();
    return () => { unsubSync(); };
  });
</script>

<div class="cloud-page">
  <div class="cloud-tabs-wrapper">
    <div class="cloud-tabs">
      <button class="cloud-tab" class:active={activeCloudTab === 'sync'} onclick={() => activeCloudTab = 'sync'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z"/></svg>
        <span>Sync</span>
        {#if driveSettings}<span class="cloud-tab-dot"></span>{/if}
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
        <h3>
          <span style="display: inline-flex; align-items: center; gap: 10px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="var(--primary-color)"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
            Sincronización
          </span>
        </h3>
      </div>

      {#if syncStatus.status === 'error' && syncStatus.message}
        <div style="margin: 1rem 1.5rem 0; padding: 0.9rem 1rem; border-radius: 12px; border: 1px solid rgba(248,113,113,0.25); background: rgba(239,68,68,0.12); color: #fecaca; font-size: 0.8rem; line-height: 1.45;">
          <div style="font-weight: 700; margin-bottom: 0.25rem;">⚠️ Error de sincronización</div>
          <div>{syncStatus.message}</div>
        </div>
      {/if}

      {#if driveSettings}
        <div style="padding: 0 1.5rem 1.5rem;">
          <div style="background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%); border-radius: 14px; border: 1px solid rgba(var(--primary-rgb), 0.12); padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: {syncStatus.status === 'syncing' ? '#eab308' : '#22c55e'}; box-shadow: {syncStatus.status === 'syncing' ? '0 0 8px rgba(234,179,8,0.4)' : '0 0 8px rgba(34,197,94,0.4)'}; flex-shrink: 0;"></div>
              <div>
                <div style="color: #f1f5f9; font-weight: 600; font-size: 0.85rem;">
                  {#if driveSettings.googleUserEmail}
                    {driveSettings.googleUserEmail}
                  {:else}
                    Google Drive Conectado
                  {/if}
                </div>
                <div style="color: #64748b; font-size: 0.7rem; margin-top: 1px;">
                  {syncStatus.lastSync ? `Última sync: ${new Date(syncStatus.lastSync).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Sin sincronizar'}
                </div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8;">
                <span>⚡</span><span>{syncInterval}s</span>
              </div>
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
              <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Subir a Drive</span>
            </button>
            <button onclick={() => syncService.pullAll()} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.12) 0%, rgba(var(--primary-rgb), 0.04) 100%); border: 1px solid rgba(var(--primary-rgb), 0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span style="color: var(--primary-color); font-weight: 600; font-size: 0.85rem;">Bajar de Drive</span>
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem; padding-top: 0.75rem; margin-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
            <span style="color: #94a3b8; font-size: 0.8rem;">Sync periódico:</span>
            <input type="number" min={3} max={300} bind:value={syncInterval} oninput={() => { localStorage.setItem('periodic_sync_interval_seconds', String(syncInterval)); syncService.ensurePeriodicSync(); }} style="width: 56px; padding: 0.25rem 0.4rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
            <span style="color: #64748b; font-size: 0.8rem;">segundos</span>
          </div>

          <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
            {#each [{ icon: '💻', title: 'Local-First', desc: 'Datos seguros en tu PC' }, { icon: '☁️', title: 'Google Drive', desc: 'Siempre disponible' }, { icon: '📴', title: 'Offline', desc: 'Trabaja sin internet' }, { icon: '🔄', title: 'Periódico', desc: `Cada ${syncInterval}s` }] as item}
              <div style="padding: 0.75rem; background: rgba(0,0,0,0.15); border-radius: 10px; text-align: center;">
                <div style="font-size: 1.1rem; margin-bottom: 2px;">{item.icon}</div>
                <div style="font-size: 0.75rem; color: #f1f5f9; font-weight: 600;">{item.title}</div>
                <div style="font-size: 0.65rem; color: #64748b; margin-top: 1px;">{item.desc}</div>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div style="padding: 2rem; text-align: center;">
          <div style="color: #64748b; font-size: 0.9rem;">
            Conecta tu cuenta de Google Drive en la sección <strong style="color: #94a3b8;">Drive</strong> para comenzar a sincronizar.
          </div>
        </div>
      {/if}
    </div>

    <div class="cloud-card" class:visible={activeCloudTab === 'drive'}>
      <div class="cloud-card-header">
        <h3>☁️ Google Drive</h3>
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
