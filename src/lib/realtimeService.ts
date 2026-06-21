import { getTursoClient } from './tursoClient';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const realtimeService = {
  init: async (_userId: string) => {
    realtimeService.stop();
    pollTimer = setInterval(async () => {
      const client = getTursoClient();
      if (!client) return;
      try {
        const rs = await client.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
        if (rs.rows.length > 0) {
          console.log('[Turso Realtime] Poll: base conectada');
        }
      } catch {
        console.warn('[Turso Realtime] Poll: sin conexión');
      }
    }, 30000);
  },

  stop: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
};
