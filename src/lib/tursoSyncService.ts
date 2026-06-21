import { getTursoClient, connectTurso, restoreTursoClient } from './tursoClient';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface SyncState {
  status: SyncStatus;
  lastSync: string | null;
  lastSyncDetails: string | null;
  message: string | null;
  lastUpload: string | null;
  lastDownload: string | null;
}

type SyncListener = (state: SyncState) => void;

class SyncManager {
  private state: SyncState = {
    status: 'idle',
    lastSync: localStorage.getItem('turso_last_sync_time'),
    lastSyncDetails: localStorage.getItem('turso_last_sync_details'),
    message: null,
    lastUpload: localStorage.getItem('turso_last_upload'),
    lastDownload: localStorage.getItem('turso_last_download'),
  };
  private listeners: SyncListener[] = [];

  subscribe(listener: SyncListener) {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  setState(newState: Partial<SyncState>) {
    this.state = { ...this.state, ...newState };
    if (newState.lastSync) localStorage.setItem('turso_last_sync_time', newState.lastSync);
    if (newState.lastSyncDetails) localStorage.setItem('turso_last_sync_details', newState.lastSyncDetails);
    if (newState.lastUpload) localStorage.setItem('turso_last_upload', newState.lastUpload);
    if (newState.lastDownload) localStorage.setItem('turso_last_download', newState.lastDownload);
    this.listeners.forEach(l => l(this.state));
  }

  getState() {
    return this.state;
  }

  async wrapSync(promise: Promise<any>, description: string) {
    this.setState({ status: 'syncing', message: `Sincronizando ${description}...` });
    try {
      await promise;
      this.setState({
        status: 'success',
        lastSync: new Date().toISOString(),
        lastSyncDetails: description,
        message: null,
      });
    } catch (e: any) {
      this.setState({
        status: 'error',
        message: `Error en ${description}: ${e?.message || e}`,
      });
    }
  }
}

export const syncManager = new SyncManager();

function getClient() {
  const c = getTursoClient();
  if (!c) throw new Error('Turso no está conectado. Configura URL y token en Ajustes.');
  return c;
}

function now() {
  return new Date().toISOString();
}

function fmtTime() {
  return new Date().toLocaleTimeString();
}

export const tursoSyncService = {
  testConnection: async (url?: string, token?: string): Promise<{ ok: boolean; latency: number; error?: string }> => {
    let client = getTursoClient();
    let needsRestore = false;
    if (!client && url && token) {
      client = connectTurso(url, token);
      needsRestore = true;
    } else if (!client) {
      client = restoreTursoClient();
    }
    if (!client) return { ok: false, latency: 0, error: 'No hay credenciales configuradas' };
    try {
      const start = performance.now();
      const rs = await client.execute('SELECT 1');
      const latency = Math.round(performance.now() - start);
      return { ok: true, latency };
    } catch (e: any) {
      if (needsRestore) connectTurso('', '');
      return { ok: false, latency: 0, error: e?.message || String(e) };
    }
  },

  connectAndSetup: async (url: string, token: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      connectTurso(url, token);
      const test = await tursoSyncService.testConnection();
      if (!test.ok) {
        connectTurso('', '');
        return { ok: false, error: test.error || 'Conexión fallida' };
      }
      return { ok: true };
    } catch (e: any) {
      connectTurso('', '');
      return { ok: false, error: e?.message || String(e) };
    }
  },

  runSchemaSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    const client = getClient();
    try {
      const schemaSql = await invoke<string>('get_schema_sql');
      const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && s.toUpperCase().startsWith('CREATE TABLE'))
        .map(s => s + ';')
        .map(s => s.replace(/CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS '));
      for (const stmt of statements) {
        try {
          await client.execute(stmt);
        } catch (e: any) {
          console.warn('[Turso Schema] Error en statement:', stmt, e);
        }
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },

  pushAll: async (): Promise<void> => {
    const client = getClient();
    try {
      const allData = await invoke<string>('get_all_local_data_json');
      const tables: Record<string, any[]> = JSON.parse(allData);
      const tableOrder = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'grado_asignatura', 'colegio_asignatura', 'indicador', 'criterio',
        'estudiante', 'configuracion_calificacion', 'colegio_dias_asistencia', 'asistencia', 'nota'
      ];
      for (const tableName of tableOrder) {
        const records = tables[tableName];
        if (!records || records.length === 0) continue;
        const placeholders = records.map(() => {
          const keys = Object.keys(records[0]);
          const cols = keys.join(', ');
          const vals = keys.map(() => '?').join(', ');
          return { cols, vals };
        });
        if (records.length > 0) {
          const keys = Object.keys(records[0]);
          const cols = keys.join(', ');
          const rowsArgs = records.map(r => keys.map(k => r[k]));
          const batchSql = `INSERT OR REPLACE INTO ${tableName} (${cols}) VALUES ${rowsArgs.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ')}`;
          const flatArgs: any[] = [];
          for (const row of records) {
            for (const k of keys) flatArgs.push(row[k] ?? null);
          }
          try {
            await client.execute(batchSql, flatArgs);
          } catch (e: any) {
            console.warn(`[Turso Push] Error en ${tableName}, intentando individual:`, e);
            for (const record of records) {
              const indivVals = keys.map(k => record[k] ?? null);
              try {
                await client.execute(`INSERT OR REPLACE INTO ${tableName} (${cols}) VALUES (${keys.map(() => '?').join(', ')})`, indivVals);
              } catch (e2: any) {
                console.warn(`[Turso Push] Error individual en ${tableName}:`, e2);
              }
            }
          }
        }
      }
      syncManager.setState({ lastUpload: now() });
    } catch (e: any) {
      throw new Error(`Error subiendo datos: ${e?.message || e}`);
    }
  },

  pushAllSilent: async (): Promise<void> => {
    try {
      await tursoSyncService.pushAll();
    } catch (e) {
      console.warn('[Turso Push Silent] Error:', e);
    }
  },

  pullAll: async (): Promise<void> => {
    const client = getClient();
    try {
      const tables = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'grado_asignatura', 'colegio_asignatura', 'indicador', 'criterio',
        'estudiante', 'configuracion_calificacion', 'colegio_dias_asistencia',
      ];
      const pullData: Record<string, any[]> = {};
      for (const table of tables) {
        try {
          const rs = await client.execute(`SELECT * FROM ${table}`);
          pullData[table] = rs.rows;
        } catch (e) {
          console.warn(`[Turso Pull] Tabla ${table} no existe aún:`, e);
          pullData[table] = [];
        }
      }
      const asistenciaRs = await client.execute('SELECT * FROM asistencia');
      pullData['asistencia'] = asistenciaRs.rows;
      const notaRs = await client.execute('SELECT * FROM nota');
      pullData['nota'] = notaRs.rows;
      const deleteTables = Object.keys(pullData);
      await invoke('upsert_pull_data', {
        data: JSON.stringify({
          tables: pullData,
          deleted_tables: deleteTables.map(t => ({ table: t, records: [] })),
        })
      });
      syncManager.setState({ lastDownload: now() });
    } catch (e: any) {
      throw new Error(`Error descargando datos: ${e?.message || e}`);
    }
  },

  pullAllSilent: async (): Promise<void> => {
    try {
      await tursoSyncService.pullAll();
    } catch (e) {
      console.warn('[Turso Pull Silent] Error:', e);
    }
  },

  syncAllSilent: async (): Promise<void> => {
    await tursoSyncService.pushAllSilent();
    await tursoSyncService.pullAllSilent();
    syncManager.setState({
      lastSync: now(),
      lastSyncDetails: `Sync completo (${fmtTime()})`,
    });
  },

  startPeriodicSync: () => {
    const intervalStr = localStorage.getItem('periodic_sync_interval_seconds');
    const interval = Math.max(3, Math.min(300, parseInt(intervalStr || '10') || 10)) * 1000;
    const client = getTursoClient();
    if (!client) return;
    if ((tursoSyncService as any)._periodicTimer) clearInterval((tursoSyncService as any)._periodicTimer);
    (tursoSyncService as any)._periodicTimer = setInterval(async () => {
      const c = getTursoClient();
      if (!c) {
        tursoSyncService.stopPeriodicSync();
        return;
      }
      syncManager.setState({ status: 'syncing', message: 'Sync automático...' });
      await tursoSyncService.syncAllSilent();
      syncManager.setState({ status: 'idle', message: null });
    }, interval);
  },

  stopPeriodicSync: () => {
    if ((tursoSyncService as any)._periodicTimer) {
      clearInterval((tursoSyncService as any)._periodicTimer);
      (tursoSyncService as any)._periodicTimer = null;
    }
  },

  ensurePeriodicSync: () => {
    const c = getTursoClient();
    if (c && !(tursoSyncService as any)._periodicTimer) {
      tursoSyncService.startPeriodicSync();
    }
  },

  isPeriodicSyncRunning: () => {
    return !!(tursoSyncService as any)._periodicTimer;
  },

  getUserId: async (): Promise<string | null> => {
    const client = getTursoClient();
    if (!client) return null;
    try {
      const rs = await client.execute("SELECT value FROM _config WHERE key = 'user_id'");
      if (rs.rows.length > 0) return rs.rows[0].value;
    } catch {}
    return null;
  },

  syncGradeConfig: async (config: any): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      const { id, color, minimo } = config;
      await client.execute('INSERT OR REPLACE INTO configuracion_calificacion (id, color, minimo) VALUES (?, ?, ?)', [id, color ?? null, minimo ?? null]);
    })(), 'config grade');
  },

  syncGlobal: async (table: string, data: any, isNew?: boolean): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      const keys = Object.keys(data);
      const cols = keys.join(', ');
      const vals = keys.map(() => '?').join(', ');
      await client.execute(`INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${vals})`, keys.map(k => data[k] ?? null));
      syncManager.setState({ lastUpload: now() });
    })(), `sync ${table}`);
  },

  deleteGlobal: async (table: string, id: number): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      await client.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    })(), `delete ${table}`);
  },

  syncStudent: async (student: any, isNew?: boolean): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      const keys = Object.keys(student);
      const cols = keys.join(', ');
      const vals = keys.map(() => '?').join(', ');
      await client.execute(`INSERT OR REPLACE INTO estudiante (${cols}) VALUES (${vals})`, keys.map(k => student[k] ?? null));
      syncManager.setState({ lastUpload: now() });
    })(), 'sync estudiante');
  },

  syncStudentsBatch: async (students: any[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      if (students.length === 0) return;
      const client = getClient();
      const keys = Object.keys(students[0]);
      const cols = keys.join(', ');
      for (const student of students) {
        await client.execute(`INSERT OR REPLACE INTO estudiante (${cols}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => student[k] ?? null));
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'sync estudiantes batch');
  },

  deleteStudent: async (id: number): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      await client.execute('DELETE FROM estudiante WHERE id = ?', [id]);
    })(), 'delete estudiante');
  },

  syncColegioSubjects: async (colegioId: number, subjectIds: number[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      await client.execute('DELETE FROM colegio_asignatura WHERE colegio_id = ?', [colegioId]);
      for (const asignaturaId of subjectIds) {
        await client.execute('INSERT INTO colegio_asignatura (colegio_id, asignatura_id) VALUES (?, ?)', [colegioId, asignaturaId]);
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'sync colegio-asignatura');
  },

  syncColegioDias: async (config: any): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      const { colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo } = config;
      await client.execute('INSERT OR REPLACE INTO colegio_dias_asistencia (colegio_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [colegio_id, lunes ? 1 : 0, martes ? 1 : 0, miercoles ? 1 : 0, jueves ? 1 : 0, viernes ? 1 : 0, sabado ? 1 : 0, domingo ? 1 : 0]);
      syncManager.setState({ lastUpload: now() });
    })(), 'sync colegio-dias');
  },

  syncGradeSubjects: async (gradoId: number): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      const rs = await invoke<string>('get_all_local_data_json');
      const allData = JSON.parse(rs);
      const items = (allData['grado_asignatura'] || []).filter((g: any) => g.grado_id === gradoId);
      await client.execute('DELETE FROM grado_asignatura WHERE grado_id = ?', [gradoId]);
      for (const item of items) {
        await client.execute('INSERT INTO grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)', [item.grado_id, item.asignatura_id]);
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'sync grado-asignatura');
  },

  syncEvaluacionConfig: async (indicadores: any[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      for (const ind of indicadores) {
        const { id, grado_id, asignatura_id, corte_evaluativo_id, nombre, orden, criterios } = ind;
        await client.execute('INSERT OR REPLACE INTO indicador (id, grado_id, asignatura_id, corte_evaluativo_id, nombre, orden) VALUES (?, ?, ?, ?, ?, ?)',
          [id, grado_id, asignatura_id, corte_evaluativo_id, nombre, orden ?? null]);
        if (criterios && Array.isArray(criterios)) {
          for (const crit of criterios) {
            await client.execute('INSERT OR REPLACE INTO criterio (id, indicador_id, orden, descripcion, puntaje_maximo) VALUES (?, ?, ?, ?, ?)',
              [crit.id, id, crit.orden ?? null, crit.descripcion ?? null, crit.puntaje_maximo ?? null]);
          }
        }
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'sync evaluacion config');
  },

  syncNotasBatch: async (notas: any[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      if (notas.length === 0) return;
      const client = getClient();
      const keys = Object.keys(notas[0]);
      const cols = keys.join(', ');
      for (const nota of notas) {
        await client.execute(`INSERT OR REPLACE INTO nota (${cols}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => nota[k] ?? null));
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'sync notas batch');
  },

  syncAsistenciaBatch: async (records: any[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      if (records.length === 0) return;
      const client = getClient();
      const keys = Object.keys(records[0]);
      const cols = keys.join(', ');
      for (const record of records) {
        await client.execute(`INSERT OR REPLACE INTO asistencia (${cols}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => record[k] ?? null));
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'sync asistencia batch');
  },

  syncPendingDeletions: async (): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      try {
        const rs = await invoke<string>('get_all_local_data_json');
        const data = JSON.parse(rs);
        const pending = data['pending_deletions'] || [];
        for (const item of pending) {
          try {
            await client.execute(`DELETE FROM ${item.table_name} WHERE id = ?`, [item.record_id]);
          } catch {}
        }
      } catch {}
    })(), 'sync pending deletions');
  },

  wipeRemoteData: async (): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const client = getClient();
      const tables = [
        'asistencia', 'nota', 'criterio', 'indicador', 'grado_asignatura',
        'colegio_asignatura', 'estudiante', 'seccion', 'grado', 'asignatura',
        'colegio_dias_asistencia', 'colegio', 'corte_evaluativo', 'ano_lectivo',
        'configuracion_calificacion',
      ];
      for (const table of tables) {
        try { await client.execute(`DELETE FROM ${table}`); } catch {}
      }
      syncManager.setState({ lastUpload: now() });
    })(), 'wipe remote data');
  },

  disconnect: () => {
    tursoSyncService.stopPeriodicSync();
    const { disconnectTurso } = require('./tursoClient');
    disconnectTurso();
    syncManager.setState({
      status: 'idle',
      lastSync: null,
      lastUpload: null,
      lastDownload: null,
      message: null,
    });
  },
};
