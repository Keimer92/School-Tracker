import { useState, useEffect, useRef } from "react";
import { syncManager } from "../lib/tursoSyncService";
import { getTursoUrl } from "../lib/tursoClient";

export function SyncStatus() {
  const [state, setState] = useState(syncManager.getState());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsub = syncManager.subscribe((s) => {
      if (mounted.current) setState(s);
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, []);

  const url = getTursoUrl();
  const isConnected = !!url;

  const statusDot = isConnected
    ? { color: '#4ade80', label: 'Conectado' }
    : { color: '#ef4444', label: 'Desconectado' };

  const fmt = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString();
  };

  return (
    <div style={{
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '8px 12px',
      fontSize: '0.7rem',
      color: '#94a3b8',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot.color, flexShrink: 0 }} />
        <span style={{ flex: 1, fontWeight: 500, color: '#e2e8f0' }}>Sync</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 14 }}>
        {state.lastUpload && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.6rem' }}>↑</span>
            <span>Subida: {fmt(state.lastUpload)}</span>
          </div>
        )}
        {state.lastDownload && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.6rem' }}>↓</span>
            <span>Bajada: {fmt(state.lastDownload)}</span>
          </div>
        )}
        {state.lastSync && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.6rem' }}>↻</span>
            <span>Última: {fmt(state.lastSync)}</span>
          </div>
        )}
        {state.status === 'syncing' && (
          <div style={{ color: '#fbbf24', fontSize: '0.65rem' }}>
            ⏳ {state.message || 'Sincronizando...'}
          </div>
        )}
        {state.status === 'error' && (
          <div style={{ color: '#ef4444', fontSize: '0.65rem', wordBreak: 'break-word' }}>
            ⚠️ {state.message}
          </div>
        )}
        {!state.lastUpload && !state.lastDownload && (
          <div style={{ color: '#64748b', fontStyle: 'italic' }}>Sin actividad</div>
        )}
      </div>
    </div>
  );
}
