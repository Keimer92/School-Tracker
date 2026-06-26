import PocketBase from 'pocketbase';
import { pb, getPocketBaseUrl, savePocketBaseUrl, authenticateAdmin, restoreAdminAuth, logoutAdmin, isAdminAuthenticated } from './pocketbaseClient';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { syncManager } from './tursoSyncService';

function now() {
  return new Date().toISOString();
}

function fmtTime() {
  return new Date().toLocaleTimeString();
}

async function safeInvoke<T>(fn: string): Promise<T[]> {
  try { return await invoke<T[]>(fn); } catch (e) { console.warn(`[PB] safeInvoke ${fn} falló:`, e); return []; }
}

async function ensureCollectionsExist() {
  const requiredCollections = [
    { name: 'ano_lectivo', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'activo', type: 'bool' }, { name: 'cualitativo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
    { name: 'corte_evaluativo', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'activo', type: 'bool' }, { name: 'cualitativo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
    { name: 'colegio', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'activo', type: 'bool' }, { name: 'cualitativo', type: 'bool' }, { name: 'orden', type: 'number' }, { name: 'user_id', type: 'text' }] },
    { name: 'asignatura', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'cualitativo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
    { name: 'grado', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'cualitativo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
    { name: 'seccion', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'cualitativo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
    { name: 'estudiante', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'codigo', type: 'text', required: true }, { name: 'sexo', type: 'text' }, { name: 'ano_lectivo_id', type: 'number' }, { name: 'grado_id', type: 'number' }, { name: 'seccion_id', type: 'number' }, { name: 'colegio_id', type: 'number' }, { name: 'telefono', type: 'text' }, { name: 'direccion', type: 'text' }, { name: 'email', type: 'text' }, { name: 'foto', type: 'text' }, { name: 'user_id', type: 'text' }] },
    { name: 'grado_asignatura', schema: [{ name: 'grado_id', type: 'number', required: true }, { name: 'asignatura_id', type: 'number', required: true }, { name: 'user_id', type: 'text' }] },
    { name: 'colegio_asignatura', schema: [{ name: 'colegio_id', type: 'number', required: true }, { name: 'asignatura_id', type: 'number', required: true }, { name: 'user_id', type: 'text' }] },
    { name: 'indicador', schema: [{ name: 'grado_id', type: 'number', required: true }, { name: 'asignatura_id', type: 'number', required: true }, { name: 'corte_evaluativo_id', type: 'number', required: true }, { name: 'orden', type: 'number', required: true }, { name: 'descripcion', type: 'text' }, { name: 'activo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
    { name: 'criterio', schema: [{ name: 'indicador_id', type: 'number', required: true }, { name: 'orden', type: 'number', required: true }, { name: 'descripcion', type: 'text' }, { name: 'puntaje_maximo', type: 'number', required: true }, { name: 'user_id', type: 'text' }] },
    { name: 'nota', schema: [{ name: 'estudiante_id', type: 'number', required: true }, { name: 'criterio_id', type: 'number', required: true }, { name: 'valor', type: 'number', required: true }, { name: 'corte_evaluativo_id', type: 'number', required: true }, { name: 'asignatura_id', type: 'number', required: true }, { name: 'user_id', type: 'text' }] },
    { name: 'asistencia', schema: [{ name: 'estudiante_id', type: 'number', required: true }, { name: 'fecha', type: 'text', required: true }, { name: 'estado', type: 'text', required: true }, { name: 'observacion', type: 'text' }, { name: 'user_id', type: 'text' }] },
    { name: 'configuracion_calificacion', schema: [{ name: 'nombre', type: 'text', required: true }, { name: 'color', type: 'text', required: true }, { name: 'minimo', type: 'number', required: true }, { name: 'user_id', type: 'text' }] },
    { name: 'colegio_dias_asistencia', schema: [{ name: 'colegio_id', type: 'number', required: true }, { name: 'lunes', type: 'bool' }, { name: 'martes', type: 'bool' }, { name: 'miercoles', type: 'bool' }, { name: 'jueves', type: 'bool' }, { name: 'viernes', type: 'bool' }, { name: 'sabado', type: 'bool' }, { name: 'domingo', type: 'bool' }, { name: 'user_id', type: 'text' }] },
  ];

  try {
    const existing = await pb.collections.getFullList();
    const existingNames = new Set(existing.map(c => c.name));

    for (const col of requiredCollections) {
      if (!existingNames.has(col.name)) {
        await pb.collections.create({
          name: col.name,
          type: 'base',
          schema: col.schema,
        });
        console.log(`[PB] Colección "${col.name}" creada`);
      }
    }
  } catch (e: any) {
    console.warn('[PB] Error verificando/creando colecciones:', e?.message || e);
  }
}

async function upsertRecord(collection: string, data: any) {
  try {
    if (data.id) {
      await pb.collection(collection).update(String(data.id), data);
    } else {
      await pb.collection(collection).create(data);
    }
  } catch (e: any) {
    if (e?.status === 404) {
      await pb.collection(collection).create(data);
    } else {
      throw e;
    }
  }
}

async function deleteRecord(collection: string, id: any) {
  try {
    await pb.collection(collection).delete(String(id));
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }
}

function getTableName(table: string): string {
  const names: Record<string, string> = {
    'colegio': 'Colegio',
    'grado': 'Grado',
    'seccion': 'Sección',
    'asignatura': 'Asignatura',
    'ano_lectivo': 'Año Lectivo',
    'corte_evaluativo': 'Corte',
    'estudiante': 'Estudiante',
    'indicador': 'Indicador',
    'criterio': 'Criterio',
    'nota': 'Nota',
    'asistencia': 'Asistencia',
    'configuracion_calificacion': 'Configuración de Notas',
  };
  return names[table] || table;
}

let _periodicTimer: any = null;
let _connectivityInitialized = false;

export const pocketbaseSyncService = {
  testConnection: async (url?: string): Promise<{ ok: boolean; latency: number; error?: string }> => {
    const baseUrl = url || getPocketBaseUrl();
    try {
      const start = performance.now();
      const testPb = url ? new PocketBase(url) : pb;
      const health = await testPb.health.check();
      const latency = Math.round(performance.now() - start);
      return { ok: health.code === 200, latency };
    } catch (e: any) {
      return { ok: false, latency: 0, error: e?.message || String(e) };
    }
  },

  connectAndSetup: async (url: string, _token?: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      savePocketBaseUrl(url);
      restoreAdminAuth();
      const health = await pb.health.check();
      if (health.code !== 200) {
        return { ok: false, error: 'No se pudo conectar al servidor PocketBase' };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },

  authenticateAdmin: async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await authenticateAdmin(email, password);
      await ensureCollectionsExist();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },

  runSchemaSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    return { ok: true };
  },

  pushAll: async (): Promise<void> => {
    if (!navigator.onLine) {
      syncManager.setState({ status: 'offline', message: 'Sin conexión' });
      return;
    }
    const userId = await pocketbaseSyncService.getUserId();
    if (!userId) {
      throw new Error('Debes estar autenticado en PocketBase como admin');
    }

    const errors: string[] = [];

    async function upsertWithLog(collection: string, data: any) {
      try {
        await upsertRecord(collection, data);
      } catch (e: any) {
        const msg = `${collection}: ${e?.message || e}`.slice(0, 200);
        errors.push(msg);
        console.warn(`[PB Push] Error en ${msg}`);
      }
    }

    try {
      await ensureCollectionsExist();

      const catMap = (r: any) => ({ id: String(r.id), nombre: r.nombre, activo: r.activo ?? false, cualitativo: r.cualitativo ?? false, user_id: userId });
      const baseCollections = [
        { name: 'ano_lectivo', cmd: 'get_anos', map: catMap },
        { name: 'corte_evaluativo', cmd: 'get_cortes', map: catMap },
        { name: 'colegio', cmd: 'get_colegios', map: (r: any) => ({ id: String(r.id), nombre: r.nombre, activo: r.activo ?? false, cualitativo: r.cualitativo ?? false, orden: r.orden ?? 0, user_id: userId }) },
        { name: 'asignatura', cmd: 'get_asignaturas', map: (r: any) => ({ id: String(r.id), nombre: r.nombre, cualitativo: r.cualitativo ?? false, user_id: userId }) },
        { name: 'grado', cmd: 'get_grados', map: (r: any) => ({ id: String(r.id), nombre: r.nombre, cualitativo: r.cualitativo ?? false, user_id: userId }) },
        { name: 'seccion', cmd: 'get_secciones', map: (r: any) => ({ id: String(r.id), nombre: r.nombre, cualitativo: r.cualitativo ?? false, user_id: userId }) },
      ];

      for (const col of baseCollections) {
        const data = await safeInvoke<any>(col.cmd);
        for (const item of data) {
          await upsertWithLog(col.name, col.map(item));
        }
      }

      const estudiantes = await safeInvoke<any>('get_students');
      for (const e of estudiantes) {
        await upsertWithLog('estudiante', {
          id: String(e.id), nombre: e.nombre, codigo: e.codigo, sexo: e.sexo,
          ano_lectivo_id: e.anoLectivoId ?? null, grado_id: e.gradoId ?? null,
          seccion_id: e.seccionId ?? null, colegio_id: e.colegioId ?? null,
          telefono: e.telefono ?? null, direccion: e.direccion ?? null,
          email: e.email ?? null, foto: e.foto ?? null, user_id: userId,
        });
      }

      const indicadores = await safeInvoke<any>('get_indicadores_all');
      for (const i of indicadores) {
        await upsertWithLog('indicador', {
          id: String(i.id), grado_id: i.gradoId, asignatura_id: i.asignaturaId,
          corte_evaluativo_id: i.corteEvaluativoId, orden: i.orden,
          descripcion: i.descripcion ?? '', activo: i.activo ?? true, user_id: userId,
        });
      }

      const criterios = await safeInvoke<any>('get_criterios_all');
      for (const c of criterios) {
        await upsertWithLog('criterio', {
          id: String(c.id), indicador_id: c.indicadorId, orden: c.orden,
          descripcion: c.descripcion ?? '', puntaje_maximo: Math.round(c.puntajeMaximo), user_id: userId,
        });
      }

      const notas = await safeInvoke<any>('get_notas_all');
      for (const n of notas) {
        await upsertWithLog('nota', {
          estudiante_id: n.estudianteId, criterio_id: n.criterioId,
          valor: n.valor, corte_evaluativo_id: n.corteEvaluativoId ?? 0,
          asignatura_id: n.asignaturaId ?? 0, user_id: userId,
        });
      }

      const asistencia = await safeInvoke<any>('get_asistencia_all');
      for (const a of asistencia) {
        await upsertWithLog('asistencia', {
          estudiante_id: a.estudianteId, fecha: a.fecha,
          estado: a.estado, observacion: a.observacion ?? null, user_id: userId,
        });
      }

      const gradeConfigs = await safeInvoke<any>('get_grade_configs');
      for (const gc of gradeConfigs) {
        await upsertWithLog('configuracion_calificacion', {
          id: String(gc.id), nombre: gc.nombre, color: gc.color, minimo: gc.minimo, user_id: userId,
        });
      }

      for (const ga of await safeInvoke<any>('get_grado_asignatura')) {
        await upsertWithLog('grado_asignatura', { grado_id: ga.grado_id, asignatura_id: ga.asignatura_id, user_id: userId });
      }

      for (const ca of await safeInvoke<any>('get_colegio_asignatura')) {
        await upsertWithLog('colegio_asignatura', { colegio_id: ca.colegio_id, asignatura_id: ca.asignatura_id, user_id: userId });
      }

      for (const d of await safeInvoke<any>('get_colegio_dias_asistencia_all')) {
        await upsertWithLog('colegio_dias_asistencia', {
          colegio_id: d.colegioId, lunes: !!d.lunes, martes: !!d.martes,
          miercoles: !!d.miercoles, jueves: !!d.jueves, viernes: !!d.viernes,
          sabado: !!d.sabado, domingo: !!d.domingo, user_id: userId,
        });
      }

      syncManager.setState({ lastUpload: now() });
      if (errors.length > 0) {
        syncManager.setState({ status: 'error', message: `Sincronización con errores (${errors.length}): ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? `... (+${errors.length - 3})` : ''}` });
      }
    } catch (e: any) {
      throw new Error(`Error subiendo datos a PocketBase: ${e?.message || e}`);
    }
  },

  pushAllSilent: async (): Promise<void> => {
    try {
      await pocketbaseSyncService.pushAll();
    } catch (e) {
      console.warn('[PB Push Silent] Error:', e);
    }
  },

  pullAll: async (): Promise<void> => {
    if (!navigator.onLine) {
      syncManager.setState({ status: 'offline', message: 'Sin conexión' });
      return;
    }
    const userId = await pocketbaseSyncService.getUserId();
    if (!userId) {
      throw new Error('Debes estar autenticado en PocketBase como admin');
    }

    try {
      const collections = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'estudiante', 'indicador', 'criterio', 'nota', 'asistencia',
        'configuracion_calificacion', 'grado_asignatura', 'colegio_asignatura', 'colegio_dias_asistencia',
      ];

      const allData: any = {};
      for (const col of collections) {
        try {
          allData[col] = await pb.collection(col).getFullList({ filter: `user_id="${userId}"` });
        } catch {
          allData[col] = [];
        }
      }

      const pullData: any = {
        anos: (allData['ano_lectivo'] || []).map((a: any) => ({ id: Number(a.id), nombre: a.nombre, activo: a.activo, cualitativo: a.cualitativo })),
        cortes: (allData['corte_evaluativo'] || []).map((c: any) => ({ id: Number(c.id), nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
        colegios: (allData['colegio'] || []).map((c: any) => ({ id: Number(c.id), nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo, orden: c.orden ?? 0 })),
        asignaturas: (allData['asignatura'] || []).map((a: any) => ({ id: Number(a.id), nombre: a.nombre, cualitativo: a.cualitativo })),
        grados: (allData['grado'] || []).map((g: any) => ({ id: Number(g.id), nombre: g.nombre, cualitativo: g.cualitativo })),
        secciones: (allData['seccion'] || []).map((s: any) => ({ id: Number(s.id), nombre: s.nombre, cualitativo: s.cualitativo })),
        estudiantes: (allData['estudiante'] || []).map((e: any) => ({
          id: Number(e.id), nombre: e.nombre, codigo: e.codigo, sexo: e.sexo,
          anoLectivoId: e.ano_lectivo_id, gradoId: e.grado_id, seccionId: e.seccion_id,
          colegioId: e.colegio_id, telefono: e.telefono, direccion: e.direccion, email: e.email, foto: e.foto ?? null,
        })),
        indicadores: (allData['indicador'] || []).map((i: any) => ({
          id: Number(i.id), gradoId: i.grado_id, asignaturaId: i.asignatura_id,
          corteEvaluativoId: i.corte_evaluativo_id, orden: i.orden,
          descripcion: i.descripcion, activo: i.activo, criterios: [],
        })),
        criterios: (allData['criterio'] || []).map((c: any) => ({
          id: Number(c.id), indicadorId: c.indicador_id, orden: c.orden,
          descripcion: c.descripcion, puntajeMaximo: c.puntaje_maximo,
        })),
        notas: (allData['nota'] || []).map((n: any) => ({
          estudianteId: Number(n.estudiante_id), criterioId: Number(n.criterio_id),
          valor: n.valor, corteEvaluativoId: Number(n.corte_evaluativo_id),
          asignaturaId: Number(n.asignatura_id),
        })),
        asistencia: (allData['asistencia'] || []).map((a: any) => ({
          id: Number(a.id), estudianteId: Number(a.estudiante_id), fecha: a.fecha,
          estado: a.estado, observacion: a.observacion ?? null,
        })),
        gradeConfigs: (allData['configuracion_calificacion'] || []).map((gc: any) => ({
          id: gc.id, nombre: gc.nombre, color: gc.color, minimo: gc.minimo,
        })),
        gradoAsignatura: (allData['grado_asignatura'] || []).map((ga: any) => [Number(ga.grado_id), Number(ga.asignatura_id)]),
        colegioAsignatura: (allData['colegio_asignatura'] || []).map((ca: any) => [Number(ca.colegio_id), Number(ca.asignatura_id)]),
        colegioDiasAsistencia: (allData['colegio_dias_asistencia'] || []).map((cda: any) => ({
          colegioId: Number(cda.colegio_id), lunes: cda.lunes, martes: cda.martes,
          miercoles: cda.miercoles, jueves: cda.jueves, viernes: cda.viernes,
          sabado: cda.sabado, domingo: cda.domingo,
        })),
        isPartial: false,
      };

      await invoke('upsert_pull_data', { data: pullData });
      syncManager.setState({ lastDownload: now() });
    } catch (e: any) {
      throw new Error(`Error descargando datos de PocketBase: ${e?.message || e}`);
    }
  },

  pullAllSilent: async (): Promise<void> => {
    try {
      await pocketbaseSyncService.pullAll();
    } catch (e) {
      console.warn('[PB Pull Silent] Error:', e);
    }
  },

  _syncLock: false,

  syncAllSilent: async (dispatchEvents: boolean = true): Promise<void> => {
    while ((pocketbaseSyncService as any)._syncLock) {
      await new Promise(r => setTimeout(r, 500));
    }
    (pocketbaseSyncService as any)._syncLock = true;
    try {
      try {
        await pocketbaseSyncService.pushAll();
      } catch (e) {
        console.warn('[PB Sync All Silent] Push falló, saltando pull:', e);
        return;
      }
      await pocketbaseSyncService.pullAllSilent();
      syncManager.setState({
        lastSync: now(),
        lastSyncDetails: `PB Sync completo (${fmtTime()})`,
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
      (pocketbaseSyncService as any)._syncLock = false;
    }
  },

  startPeriodicSync: () => {
    const intervalStr = localStorage.getItem('periodic_sync_interval_seconds');
    const interval = Math.max(3, Math.min(300, parseInt(intervalStr || '10') || 10)) * 1000;
    if (!isAdminAuthenticated()) return;
    if (_periodicTimer) clearInterval(_periodicTimer);
    _periodicTimer = setInterval(async () => {
      if (!isAdminAuthenticated()) {
        pocketbaseSyncService.stopPeriodicSync();
        return;
      }
      syncManager.setState({ status: 'syncing', message: 'Sync automático PB...' });
      await pocketbaseSyncService.syncAllSilent(false);
      try { await emit("notas-updated", { timestamp: Date.now() }); } catch {}
      try { await emit("asistencia-updated"); } catch {}
      syncManager.setState({ status: 'idle', message: null });
    }, interval);
  },

  stopPeriodicSync: () => {
    if (_periodicTimer) {
      clearInterval(_periodicTimer);
      _periodicTimer = null;
    }
  },

  ensurePeriodicSync: () => {
    if (isAdminAuthenticated() && !_periodicTimer) {
      pocketbaseSyncService.startPeriodicSync();
    }
    pocketbaseSyncService.initConnectivityListeners();
  },

  initConnectivityListeners: () => {
    if (_connectivityInitialized) return;
    _connectivityInitialized = true;

    window.addEventListener('online', () => {
      pocketbaseSyncService.syncAllSilent().catch(() => {});
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        pocketbaseSyncService.syncAllSilent().catch(() => {});
      }
    });

    try {
      listen('tauri://focus', () => {
        if (navigator.onLine) {
          pocketbaseSyncService.syncAllSilent().catch(() => {});
        }
      }).catch(() => {});
    } catch {}

    window.addEventListener('connectivity-android', ((e: CustomEvent) => {
      if (e.detail?.online) {
        pocketbaseSyncService.syncAllSilent().catch(() => {});
      }
    }) as EventListener);
  },

  isPeriodicSyncRunning: () => {
    return !!_periodicTimer;
  },

  getUserId: async (): Promise<string | null> => {
    const model = pb.authStore.model;
    if (model?.id) return model.id;
    return null;
  },

  syncGradeConfig: async (config: any): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      await upsertRecord('configuracion_calificacion', {
        id: String(config.id), nombre: config.nombre,
        color: config.color, minimo: config.minimo, user_id: userId,
      });
    })(), 'config grade');
  },

  syncGlobal: async (table: string, data: any, isNew?: boolean): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      const syncItem: any = { ...data, user_id: userId };
      if (data.id) syncItem.id = String(data.id);
      await upsertRecord(table, syncItem);
    })(), `${getTableName(table)} ${isNew ? 'nuevo' : 'actualizado'}: ${data.nombre}`);
  },

  deleteGlobal: async (table: string, id: number): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      await deleteRecord(table, id);
    })(), `${getTableName(table)} eliminado`);
  },

  syncStudent: async (student: any, isNew?: boolean): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      await pocketbaseSyncService.ensureStudentsDependencies([student], userId);
      await upsertRecord('estudiante', {
        id: String(student.id), nombre: student.nombre, codigo: student.codigo,
        sexo: student.sexo, ano_lectivo_id: student.anoLectivoId || null,
        grado_id: student.gradoId || null, seccion_id: student.seccionId || null,
        colegio_id: student.colegioId || null, telefono: student.telefono || null,
        direccion: student.direccion || null, email: student.email || null,
        foto: student.foto || null, user_id: userId,
      });
    })(), `Estudiante ${isNew ? 'nuevo' : 'actualizado'}: ${student.nombre}`);
  },

  syncStudentsBatch: async (students: any[]): Promise<void> => {
    if (students.length === 0) return;
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      await pocketbaseSyncService.ensureStudentsDependencies(students, userId);
      for (const student of students) {
        await upsertRecord('estudiante', {
          id: String(student.id), nombre: student.nombre, codigo: student.codigo,
          sexo: student.sexo, ano_lectivo_id: student.anoLectivoId || null,
          grado_id: student.gradoId || null, seccion_id: student.seccionId || null,
          colegio_id: student.colegioId || null, telefono: student.telefono || null,
          direccion: student.direccion || null, email: student.email || null,
          foto: student.foto || null, user_id: userId,
        });
      }
    })(), `${students.length} Estudiantes`);
  },

  deleteStudent: async (id: number): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      await deleteRecord('estudiante', id);
    })(), 'Estudiante eliminado');
  },

  ensureStudentsDependencies: async (students: any[], userId: string) => {
    const anoIds = [...new Set(students.map(s => s.anoLectivoId).filter(Boolean))];
    const colegioIds = [...new Set(students.map(s => s.colegioId).filter(Boolean))];
    const gradoIds = [...new Set(students.map(s => s.gradoId).filter(Boolean))];
    const seccionIds = [...new Set(students.map(s => s.seccionId).filter(Boolean))];

    const checkAndSync = async (collection: string, ids: number[], localCmd: string) => {
      if (ids.length === 0) return;
      try {
        const existing = await pb.collection(collection).getFullList({
          filter: ids.map(id => `id="${id}"`).join('||'),
        });
        const existingIds = new Set(existing.map(r => r.id));
        const missingIds = ids.filter(id => !existingIds.has(String(id)));
        if (missingIds.length === 0) return;
        const allLocal = await safeInvoke<any>(localCmd);
        for (const item of allLocal) {
          if (missingIds.includes(Number(item.id))) {
            const syncItem: any = { id: String(item.id), nombre: item.nombre, user_id: userId };
            if (item.activo !== undefined && ['ano_lectivo', 'corte_evaluativo'].includes(collection)) syncItem.activo = item.activo;
            if (item.cualitativo !== undefined) syncItem.cualitativo = item.cualitativo;
            await upsertRecord(collection, syncItem);
          }
        }
      } catch {}
    };

    await checkAndSync('ano_lectivo', anoIds, 'get_anos');
    await checkAndSync('colegio', colegioIds, 'get_colegios');
    await checkAndSync('grado', gradoIds, 'get_grados');
    await checkAndSync('seccion', seccionIds, 'get_secciones');
  },

  syncColegioSubjects: async (colegioId: number, subjectIds: number[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      if (subjectIds.length > 0) {
        for (const sid of subjectIds) {
          await upsertRecord('colegio_asignatura', { colegio_id: colegioId, asignatura_id: sid, user_id: userId });
        }
      } else {
        const records = await pb.collection('colegio_asignatura').getFullList({
          filter: `colegio_id=${colegioId} && user_id="${userId}"`,
        }).catch(() => []);
        for (const r of records) await deleteRecord('colegio_asignatura', r.id);
      }
    })(), 'Asignaturas del colegio actualizadas');
  },

  syncColegioDias: async (config: any): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      await upsertRecord('colegio_dias_asistencia', {
        colegio_id: config.colegioId, lunes: !!config.lunes, martes: !!config.martes,
        miercoles: !!config.miercoles, jueves: !!config.jueves, viernes: !!config.viernes,
        sabado: !!config.sabado, domingo: !!config.domingo, user_id: userId,
      });
    })(), 'Días de asistencia actualizados');
  },

  syncGradeSubjects: async (gradoId: number): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      let subjects: any[] = [];
try { subjects = await invoke<any[]>('get_subjects_by_grade', { gradoId }); } catch {}
      if (subjects && subjects.length > 0) {
        for (const s of subjects) {
          await upsertRecord('grado_asignatura', { grado_id: gradoId, asignatura_id: s.id, user_id: userId });
        }
      } else {
        const records = await pb.collection('grado_asignatura').getFullList({
          filter: `grado_id=${gradoId} && user_id="${userId}"`,
        }).catch(() => []);
        for (const r of records) await deleteRecord('grado_asignatura', r.id);
      }
    })(), `Asignaturas del grado ${gradoId} actualizadas`);
  },

  syncEvaluacionConfig: async (indicadores: any[]): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      for (const ind of indicadores) {
        await upsertRecord('indicador', {
          id: String(ind.id), grado_id: ind.gradoId, asignatura_id: ind.asignaturaId,
          corte_evaluativo_id: ind.corteEvaluativoId, orden: ind.orden,
          descripcion: ind.descripcion, activo: ind.activo, user_id: userId,
        });
        if (ind.criterios && ind.criterios.length > 0) {
          for (const crit of ind.criterios) {
            await upsertRecord('criterio', {
              id: String(crit.id), indicador_id: crit.indicadorId, orden: crit.orden,
              descripcion: crit.descripcion, puntaje_maximo: Math.round(crit.puntajeMaximo), user_id: userId,
            });
          }
        }
      }
    })(), `Configuración de evaluación (${indicadores.length} indicadores)`);
  },

  syncNotasBatch: async (notas: any[]): Promise<void> => {
    if (notas.length === 0) return;
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      for (const nota of notas) {
        await upsertRecord('nota', {
          estudiante_id: nota.estudianteId, criterio_id: nota.criterioId,
          valor: nota.valor, corte_evaluativo_id: nota.corteEvaluativoId ?? 0,
          asignatura_id: nota.asignaturaId ?? 0, user_id: userId,
        });
      }
    })(), `${notas.length} Notas`);
  },

  syncAsistenciaBatch: async (records: any[]): Promise<void> => {
    if (records.length === 0) return;
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;
      for (const a of records) {
        await upsertRecord('asistencia', {
          estudiante_id: a.estudianteId, fecha: a.fecha,
          estado: a.estado, observacion: a.observacion ?? null, user_id: userId,
        });
      }
    })(), `${records.length} Registros de asistencia`);
  },

  syncPendingDeletions: async (): Promise<void> => {
    try {
      const tables = ['colegio', 'grado', 'seccion', 'asignatura', 'ano_lectivo', 'corte_evaluativo', 'estudiante'];
      for (const table of tables) {
        const deletions = await safeInvoke<any>('get_pending_deletions');
        for (const item of deletions) {
          try {
            if (item.tabla === table) {
              await deleteRecord(table, item.registroId);
              await invoke('remove_pending_deletion', { id: item.id }).catch(() => {});
            }
          } catch {}
        }
      }
    } catch {}
  },

  wipeRemoteData: async (): Promise<void> => {
    await syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) throw new Error('Debes estar autenticado para borrar datos remotos');
      const collections = [
        'asistencia', 'nota', 'criterio', 'indicador', 'grado_asignatura',
        'colegio_asignatura', 'estudiante', 'seccion', 'grado', 'asignatura',
        'colegio_dias_asistencia', 'colegio', 'corte_evaluativo', 'ano_lectivo',
        'configuracion_calificacion',
      ];
      for (const col of collections) {
        try {
          const records = await pb.collection(col).getFullList({ filter: `user_id="${userId}"` });
          for (const r of records) await deleteRecord(col, r.id);
        } catch {}
      }
    })(), 'limpieza de la nube');
  },

  disconnect: () => {
    pocketbaseSyncService.stopPeriodicSync();
    logoutAdmin();
  },
};
