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
      const createTables = [
        `CREATE TABLE IF NOT EXISTS ano_lectivo (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS corte_evaluativo (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS colegio (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS asignatura (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS grado (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS seccion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS grado_asignatura (grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, PRIMARY KEY (grado_id, asignatura_id))`,
        `CREATE TABLE IF NOT EXISTS colegio_asignatura (colegio_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, PRIMARY KEY (colegio_id, asignatura_id))`,
        `CREATE TABLE IF NOT EXISTS indicador (id INTEGER PRIMARY KEY AUTOINCREMENT, grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, corte_evaluativo_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', activo INTEGER DEFAULT 1)`,
        `CREATE TABLE IF NOT EXISTS criterio (id INTEGER PRIMARY KEY AUTOINCREMENT, indicador_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', puntaje_maximo INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS estudiante (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, codigo TEXT NOT NULL UNIQUE, sexo TEXT NOT NULL, ano_lectivo_id INTEGER NOT NULL, grado_id INTEGER NOT NULL, seccion_id INTEGER NOT NULL, colegio_id INTEGER NOT NULL, telefono TEXT, direccion TEXT, email TEXT, foto TEXT)`,
        `CREATE TABLE IF NOT EXISTS configuracion_calificacion (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, color TEXT NOT NULL, minimo INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (colegio_id INTEGER PRIMARY KEY, lunes INTEGER DEFAULT 1, martes INTEGER DEFAULT 1, miercoles INTEGER DEFAULT 1, jueves INTEGER DEFAULT 1, viernes INTEGER DEFAULT 1, sabado INTEGER DEFAULT 1, domingo INTEGER DEFAULT 1)`,
        `CREATE TABLE IF NOT EXISTS asistencia (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiante_id INTEGER NOT NULL, fecha TEXT NOT NULL, estado TEXT NOT NULL, observacion TEXT, UNIQUE(estudiante_id, fecha))`,
        `CREATE TABLE IF NOT EXISTS nota (estudiante_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, valor REAL NOT NULL, corte_evaluativo_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id))`,
      ];
      for (const stmt of createTables) {
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
      async function safeGet<T>(fn: string): Promise<T[]> {
        try { return await invoke<T[]>(fn); } catch { return []; }
      }
      interface TableDef { cols: string; data: any[]; map: (r: any) => any[] }
      const catMap = (r: any) => [r.id, r.nombre, r.activo ? 1 : 0, r.cualitativo ? 1 : 0];
      const tables: Record<string, TableDef> = {
        ano_lectivo: { cols: 'id,nombre,activo,cualitativo', data: await safeGet('get_anos'), map: catMap },
        corte_evaluativo: { cols: 'id,nombre,activo,cualitativo', data: await safeGet('get_cortes'), map: catMap },
        colegio: { cols: 'id,nombre,activo,cualitativo,orden', data: await safeGet('get_colegios'), map: (r) => [r.id, r.nombre, r.activo ? 1 : 0, r.cualitativo ? 1 : 0, r.orden ?? 0] },
        asignatura: { cols: 'id,nombre,cualitativo', data: await safeGet('get_asignaturas'), map: (r) => [r.id, r.nombre, r.cualitativo ? 1 : 0] },
        grado: { cols: 'id,nombre,cualitativo', data: await safeGet('get_grados'), map: (r) => [r.id, r.nombre, r.cualitativo ? 1 : 0] },
        seccion: { cols: 'id,nombre,cualitativo', data: await safeGet('get_secciones'), map: (r) => [r.id, r.nombre, r.cualitativo ? 1 : 0] },
        estudiante: { cols: 'id,nombre,codigo,sexo,ano_lectivo_id,grado_id,seccion_id,colegio_id,telefono,direccion,email,foto', data: await safeGet('get_students'), map: (r) => [r.id, r.nombre, r.codigo, r.sexo, r.anoLectivoId, r.gradoId, r.seccionId, r.colegioId, r.telefono ?? null, r.direccion ?? null, r.email ?? null, r.foto ?? null] },
        configuracion_calificacion: { cols: 'id,nombre,color,minimo', data: await safeGet('get_grade_configs'), map: (r) => [r.id, r.nombre, r.color, r.minimo] },
        indicador: { cols: 'id,grado_id,asignatura_id,corte_evaluativo_id,orden,descripcion,activo', data: await safeGet('get_indicadores_all'), map: (r) => [r.id, r.gradoId, r.asignaturaId, r.corteEvaluativoId, r.orden, r.descripcion ?? '', r.activo ? 1 : 0] },
        criterio: { cols: 'id,indicador_id,orden,descripcion,puntaje_maximo', data: await safeGet('get_criterios_all'), map: (r) => [r.id, r.indicadorId, r.orden, r.descripcion ?? '', r.puntajeMaximo] },
        nota: { cols: 'estudiante_id,criterio_id,valor,corte_evaluativo_id,asignatura_id', data: await safeGet('get_notas_all'), map: (r) => [r.estudianteId, r.criterioId, r.valor, r.corteEvaluativoId ?? 0, r.asignaturaId ?? 0] },
        asistencia: { cols: 'id,estudiante_id,fecha,estado,observacion', data: await safeGet('get_asistencia_all'), map: (r) => [r.id, r.estudianteId, r.fecha, r.estado, r.observacion ?? null] },
        colegio_dias_asistencia: { cols: 'colegio_id,lunes,martes,miercoles,jueves,viernes,sabado,domingo', data: await safeGet('get_colegio_dias_asistencia_all'), map: (r) => [r.colegioId, r.lunes ? 1 : 0, r.martes ? 1 : 0, r.miercoles ? 1 : 0, r.jueves ? 1 : 0, r.viernes ? 1 : 0, r.sabado ? 1 : 0, r.domingo ? 1 : 0] },
        grado_asignatura: { cols: 'grado_id,asignatura_id', data: await safeGet('get_grado_asignatura'), map: (r) => [r.grado_id, r.asignatura_id] },
        colegio_asignatura: { cols: 'colegio_id,asignatura_id', data: await safeGet('get_colegio_asignatura'), map: (r) => [r.colegio_id, r.asignatura_id] },
      };
      const tableOrder = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'indicador', 'criterio', 'estudiante', 'configuracion_calificacion',
        'colegio_dias_asistencia', 'asistencia', 'nota',
        'grado_asignatura', 'colegio_asignatura',
      ];
      for (const tableName of tableOrder) {
        const td = tables[tableName];
        if (!td || !td.data || td.data.length === 0) {
          if (tableName === 'colegio_asignatura') console.log(`[Turso Push] colegio_asignatura: sin datos para push (tabla vacía localmente)`);
          continue;
        }
        const { cols, data, map } = td;
        if (tableName === 'colegio_asignatura') {
          console.log(`[Turso Push] colegio_asignatura: enviando ${data.length} registros:`, data.map((r: any) => `(${r.colegio_id},${r.asignatura_id})`));
        }
        const flatArgs: any[] = [];
        for (const row of data) {
          const vals = map(row);
          for (const v of vals) flatArgs.push(v);
        }
        const rowPlaces = data.map(() => `(${cols.split(',').map(() => '?').join(',')})`).join(',');
        try {
          await client.execute(`INSERT OR REPLACE INTO ${tableName} (${cols}) VALUES ${rowPlaces}`, flatArgs);
        } catch (e: any) {
          console.warn(`[Turso Push] Error en ${tableName}, intentando individual:`, e);
          for (const record of data) {
            try {
              await client.execute(`INSERT OR REPLACE INTO ${tableName} (${cols}) VALUES (${cols.split(',').map(() => '?').join(',')})`, map(record));
            } catch (e2: any) {
              console.warn(`[Turso Push] Error individual en ${tableName}:`, e2);
            }
          }
        }
      }

      // Process pending deletions to propagate removals to Turso
      // NOTA: NO limpiamos las pending deletions localmente aquí. Eso lo hace upsert_pull_data
      // durante pullAll, para evitar race conditions con sync periódico concurrente.
      console.log('[Turso Push] Procesando pending deletions (DELETE from Turso, sin limpiar local)...');
      try {
        const genericPending = await safeGet<any[]>('get_pending_deletions');
        console.log(`[Turso Push] Pending deletions genéricas: ${genericPending.length}`, genericPending);
        for (const item of genericPending) {
          try {
            console.log(`[Turso Push] Eliminando de Turso: ${item.tabla} WHERE id=${item.registroId}`);
            await client.execute(`DELETE FROM ${item.tabla} WHERE id = ?`, [item.registroId]);
          } catch (e) {
            console.warn(`[Turso Push] Error procesando pending deletion genérica #${item.id}:`, e);
          }
        }
      } catch {}

      try {
        const caPending = await safeGet<any[]>('get_pending_deletions_colegio_asignatura');
        console.log(`[Turso Push] Pending deletions colegio_asignatura: ${caPending.length}`, caPending);
        for (const item of caPending) {
          try {
            console.log(`[Turso Push] Eliminando de Turso colegio_asignatura: colegio_id=${item.colegioId}, asignatura_id=${item.asignaturaId}`);
            await client.execute('DELETE FROM colegio_asignatura WHERE colegio_id = ? AND asignatura_id = ?', [item.colegioId, item.asignaturaId]);
          } catch (e) {
            console.warn(`[Turso Push] Error procesando pending deletion colegio_asignatura #${item.id}:`, e);
          }
        }
      } catch {}

      try {
        const gaPending = await safeGet<any[]>('get_pending_deletions_grado_asignatura');
        console.log(`[Turso Push] Pending deletions grado_asignatura: ${gaPending.length}`, gaPending);
        for (const item of gaPending) {
          try {
            await client.execute('DELETE FROM grado_asignatura WHERE grado_id = ? AND asignatura_id = ?', [item.gradoId, item.asignaturaId]);
          } catch {}
        }
      } catch {}

      try {
        const asisPending = await safeGet<any[]>('get_pending_deletions_asistencia');
        console.log(`[Turso Push] Pending deletions asistencia: ${asisPending.length}`, asisPending);
        for (const item of asisPending) {
          try {
            await client.execute('DELETE FROM asistencia WHERE estudiante_id = ? AND fecha = ?', [item.estudianteId, item.fecha]);
          } catch {}
        }
      } catch {}

      try {
        const notaPending = await safeGet<any[]>('get_pending_deletions_nota');
        console.log(`[Turso Push] Pending deletions nota: ${notaPending.length}`, notaPending);
        for (const item of notaPending) {
          try {
            await client.execute('DELETE FROM nota WHERE estudiante_id = ? AND criterio_id = ? AND corte_evaluativo_id = ? AND asignatura_id = ?',
              [item.estudianteId, item.criterioId, item.corteEvaluativoId, item.asignaturaId]);
          } catch {}
        }
      } catch {}

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
      const q = async (sql: string) => { try { const r = await client.execute(sql); return r.rows; } catch { return []; } };
      const [anoRows, corteRows, coleRows, asiRows, graRows, secRows] = await Promise.all([
        q('SELECT id,nombre,activo,cualitativo FROM ano_lectivo'),
        q('SELECT id,nombre,activo,cualitativo FROM corte_evaluativo'),
        q('SELECT id,nombre,activo,cualitativo FROM colegio'),
        q('SELECT id,nombre,cualitativo FROM asignatura'),
        q('SELECT id,nombre,cualitativo FROM grado'),
        q('SELECT id,nombre,cualitativo FROM seccion'),
      ]);
      const toCat = (r: any) => ({ id: r.id, nombre: r.nombre, activo: !!r.activo, cualitativo: !!r.cualitativo });
      const pullData: Record<string, any> = {
        anos: anoRows.map(toCat),
        cortes: corteRows.map(toCat),
        colegios: coleRows.map(toCat),
        asignaturas: asiRows.map((r: any) => ({ id: r.id, nombre: r.nombre, cualitativo: !!r.cualitativo })),
        grados: graRows.map((r: any) => ({ id: r.id, nombre: r.nombre, cualitativo: !!r.cualitativo })),
        secciones: secRows.map((r: any) => ({ id: r.id, nombre: r.nombre, cualitativo: !!r.cualitativo })),
        estudiantes: (await q('SELECT id,nombre,codigo,sexo,ano_lectivo_id,grado_id,seccion_id,colegio_id,telefono,direccion,email,foto FROM estudiante')).map((r: any) => ({
          id: r.id, nombre: r.nombre, codigo: r.codigo, sexo: r.sexo,
          anoLectivoId: r.ano_lectivo_id, gradoId: r.grado_id, seccionId: r.seccion_id, colegioId: r.colegio_id,
          telefono: r.telefono ?? null, direccion: r.direccion ?? null, email: r.email ?? null, foto: r.foto ?? null,
        })),
        indicadores: (await q('SELECT id,grado_id,asignatura_id,corte_evaluativo_id,orden,descripcion,activo FROM indicador')).map((r: any) => ({
          id: r.id, gradoId: r.grado_id, asignaturaId: r.asignatura_id, corteEvaluativoId: r.corte_evaluativo_id,
          orden: r.orden, descripcion: r.descripcion ?? '', activo: !!r.activo, criterios: [],
        })),
        criterios: (await q('SELECT id,indicador_id,orden,descripcion,puntaje_maximo FROM criterio')).map((r: any) => ({
          id: r.id, indicadorId: r.indicador_id, orden: r.orden, descripcion: r.descripcion ?? '', puntajeMaximo: r.puntaje_maximo,
        })),
        notas: (await q('SELECT estudiante_id,criterio_id,valor,corte_evaluativo_id,asignatura_id FROM nota')).map((r: any) => ({
          estudianteId: r.estudiante_id, criterioId: r.criterio_id, valor: r.valor,
          corteEvaluativoId: r.corte_evaluativo_id, asignaturaId: r.asignatura_id,
        })),
        asistencia: (await q('SELECT id,estudiante_id,fecha,estado,observacion FROM asistencia')).map((r: any) => ({
          id: r.id, estudianteId: r.estudiante_id, fecha: r.fecha, estado: r.estado, observacion: r.observacion ?? null,
        })),
        gradeConfigs: (await q('SELECT id,nombre,color,minimo FROM configuracion_calificacion')).map((r: any) => ({
          id: r.id, nombre: r.nombre, color: r.color, minimo: r.minimo,
        })),
        gradoAsignatura: (await q('SELECT grado_id,asignatura_id FROM grado_asignatura')).map((r: any) => [r.grado_id, r.asignatura_id]),
        colegioAsignatura: (await q('SELECT colegio_id,asignatura_id FROM colegio_asignatura')).map((r: any) => [r.colegio_id, r.asignatura_id]),
        colegioDiasAsistencia: (await q('SELECT colegio_id,lunes,martes,miercoles,jueves,viernes,sabado,domingo FROM colegio_dias_asistencia')).map((r: any) => ({
          colegioId: r.colegio_id, lunes: !!r.lunes, martes: !!r.martes, miercoles: !!r.miercoles,
          jueves: !!r.jueves, viernes: !!r.viernes, sabado: !!r.sabado, domingo: !!r.domingo,
        })),
        isPartial: false,
      };
      await invoke('upsert_pull_data', { data: pullData });
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

  _syncLock: false,

  syncAllSilent: async (dispatchEvents: boolean = true): Promise<void> => {
    // Evitar concurrencia entre sync manual y periódico
    if ((tursoSyncService as any)._syncLock) {
      console.warn('[Turso Sync] Sync ya en progreso, saltando...');
      return;
    }
    (tursoSyncService as any)._syncLock = true;
    try {
      await tursoSyncService.pushAllSilent();
      await tursoSyncService.pullAllSilent();
      syncManager.setState({
        lastSync: now(),
        lastSyncDetails: `Sync completo (${fmtTime()})`,
      });
      if (dispatchEvents) {
        try {
          await emit("catalog-updated");
          await emit("student-updated", { timestamp: Date.now() });
          await emit("notas-updated", { timestamp: Date.now() });
          await emit("asistencia-updated");
          await emit("grade-configs-updated");
          await emit("subjects-updated");
        } catch (e) {
          console.warn("Error emitiendo eventos Tauri:", e);
        }
        window.dispatchEvent(new CustomEvent('schooltracker-sync', { detail: { timestamp: Date.now() } }));
      }
    } finally {
      (tursoSyncService as any)._syncLock = false;
    }
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
      await tursoSyncService.syncAllSilent(false);
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
      const subjects = await invoke<any[]>('get_subjects_by_grade', { gradoId });
      await client.execute('DELETE FROM grado_asignatura WHERE grado_id = ?', [gradoId]);
      for (const sub of subjects) {
        await client.execute('INSERT INTO grado_asignatura (grado_id, asignatura_id) VALUES (?, ?)', [gradoId, sub.id]);
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
        const pending = await invoke<any[]>('get_pending_deletions');
        for (const item of pending) {
          try {
            await client.execute(`DELETE FROM ${item.tabla} WHERE id = ?`, [item.registro_id]);
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
