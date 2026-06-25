<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { syncManager } from "../lib/tursoSyncService";
  import { getTursoUrl } from "../lib/tursoClient";
  
  let state = $state(syncManager.getState());
  let mounted = true;
  
  onMount(() => {
    const unsub = syncManager.subscribe((s) => {
      if (mounted) state = s;
    });
    return () => {
      mounted = false;
      unsub();
    };
  });
  
  const url = getTursoUrl();
  const isConnected = !!url;
  
  const statusDot = $derived(
    isConnected
    ? { color: '#4ade80', label: 'Conectado' }
    : { color: '#ef4444', label: 'Desconectado' }
  );
  
  const fmt = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString();
  };
</script>

<div style="padding: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
    <span
      style="width: 8px; height: 8px; border-radius: 50%; background: {statusDot.color}; flex-shrink: 0;"
    ></span>
    <span style="flex: 1; font-weight: 500; color: #e2e8f0;">Sync</span>
  </div>
  
  <div style="display: flex; flex-direction: column; gap: 3px; padding-left: 14px;">
    {#if state.lastUpload}
      <div style="display: flex; gap: 6px; align-items: center;">
        <span style="font-size: 0.6rem;">↑</span>
        <span>Subida: {fmt(state.lastUpload)}</span>
      </div>
    {/if}
    {#if state.lastDownload}
      <div style="display: flex; gap: 6px; align-items: center;">
        <span style="font-size: 0.6rem;">↓</span>
        <span>Bajada: {fmt(state.lastDownload)}</span>
      </div>
    {/if}
    {#if state.lastSync}
      <div style="display: flex; gap: 6px; align-items: center;">
        <span style="font-size: 0.6rem;">↻</span>
        <span>Última: {fmt(state.lastSync)}</span>
      </div>
    {/if}
    {#if state.status === 'syncing'}
      <div style="color: #fbbf24; font-size: 0.65rem;">
        ⏳ {state.message || 'Sincronizando...'}
      </div>
    {/if}
    {#if state.status === 'error'}
      <div style="color: #ef4444; font-size: 0.65rem; word-break: break-word;">
        ⚠️ {state.message}
      </div>
    {/if}
    {#if !state.lastUpload && !state.lastDownload}
      <div style="color: #64748b; font-style: italic;">Sin actividad</div>
    {/if}
  </div>
</div>