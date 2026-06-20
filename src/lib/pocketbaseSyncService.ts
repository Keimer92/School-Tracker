import { pb } from './pocketbase';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

function pbId(id: number | string): string {
  return String(id).padStart(15, '0');
}

interface SyncState {
  status: SyncStatus;
  lastSync: string | null;
  lastSyncDetails: string | null;
  message: string | null;
}

type SyncListener = (state: SyncState) => void;

class SyncManager {
  private state: SyncState = {
    status: 'idle',
    lastSync: localStorage.getItem('last_sync_time'),
    lastSyncDetails: localStorage.getItem('last_sync_details'),
    message: null
  };
  private listeners: SyncListener[] = [];

  subscribe(listener: SyncListener) {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private setState(newState: Partial<SyncState>) {
    this.state = { ...this.state, ...newState };
    if (newState.lastSync) {
      localStorage.setItem('last_sync_time', newState.lastSync);
    }
    if (newState.lastSyncDetails) {
      localStorage.setItem('last_sync_details', newState.lastSyncDetails);
    }
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
        message: `Sincronización de ${description} exitosa`
      });
      await emit("catalog-updated");
      setTimeout(() => {
        if (this.state.status === 'success') {
          this.setState({ status: 'idle', message: null });
        }
      }, 3000);
    } catch (error: any) {
      let errorMessage = 'Error desconocido';
      if (error && typeof error === 'object') {
        errorMessage = error.message || error.data?.message || JSON.stringify(error);
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      this.setState({
        status: 'error',
        message: `Error sincronizando ${description}: ${errorMessage}`
      });
      throw error;
    }
  }
}

export const syncManager = new SyncManager();

async function upsertRecord(collection: string, data: any) {
  try {
    if (data.id) {
      await pb.collection(collection).update(pbId(data.id), { ...data, id: pbId(data.id) });
    } else {
      await pb.collection(collection).create(data);
    }
  } catch (e: any) {
    if (e?.status === 404) {
      await pb.collection(collection).create({ ...data, id: data.id ? pbId(data.id) : undefined });
    } else {
      console.error(`[upsertRecord] Error en ${collection}:`, e?.data?.data ? JSON.stringify(e.data.data) : e.message, 'data:', JSON.stringify(data));
      throw e;
    }
  }
}

async function deleteRecord(collection: string, id: any) {
  try {
    await pb.collection(collection).delete(pbId(id));
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }
}

export const pocketbaseSyncService = {
  getTableName: (table: string) => {
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
      'configuracion_calificacion': 'Configuración de Notas'
    };
    return names[table] || table;
  },

  getUserId: async () => {
    return pb.authStore.model?.id || null;
  },

  syncGlobal: async (table: string, data: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      const syncItem: any = { ...data, user_id: userId };
      await upsertRecord(table, syncItem);
    })(), `${pocketbaseSyncService.getTableName(table)} ${isNew ? 'nuevo' : 'actualizado'}: ${data.nombre}`);
  },

  deleteGlobal: async (table: string, id: number) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await deleteRecord(table, id);
      await invoke("remove_pending_deletion_by_record", { tabla: table, id: Number(id) }).catch(() => {});
    })(), `${pocketbaseSyncService.getTableName(table)} eliminado`);
  },

  syncPendingDeletions: async () => {
    try {
      const tables = ['colegio', 'grado', 'seccion', 'asignatura', 'ano_lectivo', 'corte_evaluativo', 'estudiante'];
      for (const table of tables) {
        const deletions = await invoke<any[]>("get_pending_deletions", { tabla: table }).catch(() => []);
        for (const item of deletions) {
          try {
            await deleteRecord(table, item.registroId);
            await invoke("remove_pending_deletion", { id: item.id }).catch(() => {});
          } catch (err) {
            console.error(`Error syncing pending deletion ${table}:${item.registroId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("Error getting pending deletions:", err);
    }
  },

  ensureStudentsDependencies: async (students: any[], userId: string) => {
    const anoIds = [...new Set(students.map(s => s.anoLectivoId).filter(id => id))];
    const colegioIds = [...new Set(students.map(s => s.colegioId).filter(id => id))];
    const gradoIds = [...new Set(students.map(s => s.gradoId).filter(id => id))];
    const seccionIds = [...new Set(students.map(s => s.seccionId).filter(id => id))];

    const checkAndSync = async (collection: string, ids: any[], localCmd: string) => {
      if (ids.length === 0) return;

      const existingRecords = await pb.collection(collection).getFullList({
        filter: ids.map(id => `id="${id}"`).join('||')
      }).catch(() => []);
      const existingIds = new Set(existingRecords.map(r => r.id));
      const missingIds = ids.filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        const allLocal = await invoke<any[]>(localCmd);
        const toSync = allLocal.filter(item => missingIds.includes(Number(item.id)));

        for (const item of toSync) {
          await upsertRecord(collection, {
            id: pbId(item.id),
            nombre: item.nombre,
            user_id: userId,
            ...(item.cualitativo !== undefined ? { cualitativo: item.cualitativo } : {}),
            ...((collection === 'ano_lectivo' || collection === 'corte_evaluativo') && item.activo !== undefined ? { activo: item.activo } : {})
          });
        }
      }
    };

    await checkAndSync('ano_lectivo', anoIds, 'get_anos');
    await checkAndSync('colegio', colegioIds, 'get_colegios');
    await checkAndSync('grado', gradoIds, 'get_grados');
    await checkAndSync('seccion', seccionIds, 'get_secciones');
  },

  syncColegioDias: async (config: any) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await upsertRecord('colegio_dias_asistencia', {
        colegio_id: config.colegioId,
        lunes: config.lunes,
        martes: config.martes,
        miercoles: config.miercoles,
        jueves: config.jueves,
        viernes: config.viernes,
        sabado: config.sabado,
        domingo: config.domingo,
        user_id: userId
      });
    })(), 'Días de asistencia actualizados');
  },

  syncStudent: async (student: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await pocketbaseSyncService.ensureStudentsDependencies([student], userId);

      await upsertRecord('estudiante', {
        id: pbId(student.id),
        nombre: student.nombre,
        codigo: student.codigo,
        sexo: student.sexo,
        ano_lectivo_id: student.anoLectivoId || null,
        grado_id: student.gradoId || null,
        seccion_id: student.seccionId || null,
        colegio_id: student.colegioId || null,
        telefono: student.telefono,
        direccion: student.direccion,
        email: student.email,
        user_id: userId
      });
    })(), `Estudiante ${isNew ? 'nuevo' : 'actualizado'}: ${student.nombre}`);
  },

  syncStudentsBatch: async (students: any[]) => {
    if (students.length === 0) return;

    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await pocketbaseSyncService.ensureStudentsDependencies(students, userId);

      for (const student of students) {
        await upsertRecord('estudiante', {
          id: pbId(student.id),
          nombre: student.nombre,
          codigo: student.codigo,
          sexo: student.sexo,
          ano_lectivo_id: student.anoLectivoId || null,
          grado_id: student.gradoId || null,
          seccion_id: student.seccionId || null,
          colegio_id: student.colegioId || null,
          telefono: student.telefono,
          direccion: student.direccion,
          email: student.email,
          user_id: userId
        });
      }
    })(), `${students.length} Estudiantes`);
  },

  deleteStudent: async (id: number) => {
    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await deleteRecord('estudiante', id);
      await invoke("remove_pending_deletion_by_record", { tabla: 'estudiante', id: Number(id) }).catch(() => {});
    })(), 'Estudiante eliminado');
  },

  syncIndicador: async (indicador: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await upsertRecord('indicador', {
        id: pbId(indicador.id),
        grado_id: indicador.gradoId,
        asignatura_id: indicador.asignaturaId,
        corte_evaluativo_id: indicador.corteEvaluativoId,
        orden: indicador.orden,
        descripcion: indicador.descripcion,
        activo: indicador.activo,
        user_id: userId
      });
    })(), `Indicador ${isNew ? 'nuevo' : 'actualizado'}: ${indicador.descripcion}`);
  },

  syncCriterio: async (criterio: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await upsertRecord('criterio', {
        id: pbId(criterio.id),
        indicador_id: criterio.indicadorId,
        orden: criterio.orden,
        descripcion: criterio.descripcion,
        puntaje_maximo: Math.round(criterio.puntajeMaximo),
        user_id: userId
      });
    })(), `Criterio ${isNew ? 'nuevo' : 'actualizado'}: ${criterio.descripcion}`);
  },

  syncEvaluacionConfig: async (indicadores: any[]) => {
    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      const gradoIds = [...new Set(indicadores.map(i => i.gradoId).filter(Boolean))];
      const asignaturaIds = [...new Set(indicadores.map(i => i.asignaturaId).filter(Boolean))];
      const corteIds = [...new Set(indicadores.map(i => i.corteEvaluativoId).filter(Boolean))];

      for (const id of gradoIds) {
        try {
          await pb.collection('grado').getOne(String(id));
        } catch {
          const grados = await invoke<any[]>("get_grados");
          const grado = grados.find(g => Number(g.id) === Number(id));
          if (grado) {
            await upsertRecord('grado', {
              id: pbId(grado.id), nombre: grado.nombre, user_id: userId,
              ...(grado.cualitativo !== undefined ? { cualitativo: grado.cualitativo } : {})
            });
          }
        }
      }

      for (const id of asignaturaIds) {
        try {
          await pb.collection('asignatura').getOne(String(id));
        } catch {
          const asignaturas = await invoke<any[]>("get_asignaturas");
          const asignatura = asignaturas.find(a => Number(a.id) === Number(id));
          if (asignatura) {
            await upsertRecord('asignatura', {
              id: pbId(asignatura.id), nombre: asignatura.nombre, user_id: userId,
              ...(asignatura.cualitativo !== undefined ? { cualitativo: asignatura.cualitativo } : {})
            });
          }
        }
      }

      for (const id of corteIds) {
        try {
          await pb.collection('corte_evaluativo').getOne(String(id));
        } catch {
          const cortes = await invoke<any[]>("get_cortes");
          const corte = cortes.find(c => Number(c.id) === Number(id));
          if (corte) {
            await upsertRecord('corte_evaluativo', {
              id: pbId(corte.id), nombre: corte.nombre, user_id: userId,
              activo: corte.activo
            });
          }
        }
      }

      for (const ind of indicadores) {
        await upsertRecord('indicador', {
          id: pbId(ind.id),
          grado_id: ind.gradoId,
          asignatura_id: ind.asignaturaId,
          corte_evaluativo_id: ind.corteEvaluativoId,
          orden: ind.orden,
          descripcion: ind.descripcion,
          activo: ind.activo,
          user_id: userId
        });

        if (ind.criterios && ind.criterios.length > 0) {
          for (const crit of ind.criterios) {
            await upsertRecord('criterio', {
              id: pbId(crit.id),
              indicador_id: crit.indicadorId,
              orden: crit.orden,
              descripcion: crit.descripcion,
              puntaje_maximo: Math.round(crit.puntajeMaximo),
              user_id: userId
            });
          }
        }
      }
    })(), `Configuración de evaluación actualizada (${indicadores.length} indicadores)`);
  },

  syncNota: async (nota: any) => {
    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await upsertRecord('nota', {
        estudiante_id: nota.estudianteId,
        criterio_id: nota.criterioId,
        valor: nota.valor,
        corte_evaluativo_id: nota.corteEvaluativoId,
        asignatura_id: nota.asignaturaId,
        user_id: userId
      });
    })(), 'Nota actualizada');
  },

  syncNotasBatch: async (notas: any[]) => {
    if (notas.length === 0) return;

    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      for (const nota of notas) {
        await upsertRecord('nota', {
          estudiante_id: nota.estudianteId,
          criterio_id: nota.criterioId,
          valor: nota.valor,
          corte_evaluativo_id: nota.corteEvaluativoId,
          asignatura_id: nota.asignaturaId,
          user_id: userId
        });
      }
    })(), `${notas.length} Notas`);
  },

  syncAsistencia: async (asistencia: any, details?: string) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await upsertRecord('asistencia', {
        estudiante_id: asistencia.estudianteId,
        fecha: asistencia.fecha,
        estado: asistencia.estado,
        observacion: asistencia.observacion,
        user_id: userId
      });
    })(), details || 'Asistencia actualizada');
  },

  syncAsistenciaBatch: async (records: any[]) => {
    if (records.length === 0) return;

    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      for (const a of records) {
        await upsertRecord('asistencia', {
          estudiante_id: a.estudianteId,
          fecha: a.fecha,
          estado: a.estado,
          observacion: a.observacion,
          user_id: userId
        });
      }
    })(), `${records.length} Registros de asistencia`);
  },

  syncGradeConfig: async (config: any) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      await upsertRecord('configuracion_calificacion', {
        id: pbId(config.id),
        nombre: config.nombre,
        color: config.color,
        minimo: config.minimo,
        user_id: userId
      });
    })(), 'Configuración de Notas');
  },

  syncAll: async () => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) throw new Error("Debes estar conectado para sincronizar");

      await pocketbaseSyncService.syncPendingDeletions();

      const baseCollections = [
        { collection: 'ano_lectivo', cmd: 'get_anos' },
        { collection: 'corte_evaluativo', cmd: 'get_cortes' },
        { collection: 'colegio', cmd: 'get_colegios' },
        { collection: 'asignatura', cmd: 'get_asignaturas' },
        { collection: 'grado', cmd: 'get_grados' },
        { collection: 'seccion', cmd: 'get_secciones' }
      ];

      for (const { collection, cmd } of baseCollections) {
        const data = await invoke<any[]>(cmd);
        if (!data || data.length === 0) continue;

        for (const item of data) {
          const syncItem: any = {
            id: pbId(item.id),
            nombre: item.nombre,
            user_id: userId
          };
          if (item.activo !== undefined && ['ano_lectivo', 'corte_evaluativo'].includes(collection)) {
            syncItem.activo = item.activo;
          }
          if (item.cualitativo !== undefined) {
            syncItem.cualitativo = item.cualitativo;
          }
          await upsertRecord(collection, syncItem);
        }
      }

      const estudiantes = await invoke<any[]>("get_students");
      if (estudiantes && estudiantes.length > 0) {
        for (const e of estudiantes) {
          await upsertRecord('estudiante', {
            id: pbId(e.id), nombre: e.nombre, codigo: e.codigo,
            sexo: e.sexo, ano_lectivo_id: e.anoLectivoId || null,
            grado_id: e.gradoId || null, seccion_id: e.seccionId || null,
            colegio_id: e.colegioId || null, telefono: e.telefono,
            direccion: e.direccion, email: e.email, user_id: userId
          });
        }
      }

      try {
        const grados = await invoke<any[]>("get_grados");
        for (const g of grados) {
          const subjects = await invoke<any[]>("get_subjects_by_grade", { gradoId: g.id });
          if (subjects) {
            for (const s of subjects) {
              await upsertRecord('grado_asignatura', {
                grado_id: g.id, asignatura_id: s.id, user_id: userId
              });
            }
          }
        }
      } catch (e) {
        console.warn("No se pudo sincronizar grado_asignatura:", e);
      }

      try {
        const colegios = await invoke<any[]>("get_colegios");
        for (const c of colegios) {
          const subjects = await invoke<any[]>("get_subjects_by_colegio", { colegioId: c.id });
          if (subjects) {
            for (const s of subjects) {
              await upsertRecord('colegio_asignatura', {
                colegio_id: c.id, asignatura_id: s.id, user_id: userId
              });
            }
          }
        }
      } catch (e) {
        console.warn("No se pudo sincronizar colegio_asignatura:", e);
      }

      const indicadores = await invoke<any[]>("get_indicadores_all");
      if (indicadores && indicadores.length > 0) {
        for (const i of indicadores) {
          await upsertRecord('indicador', {
            id: pbId(i.id), grado_id: i.gradoId,
            asignatura_id: i.asignaturaId, corte_evaluativo_id: i.corteEvaluativoId,
            orden: i.orden, descripcion: i.descripcion, activo: i.activo, user_id: userId
          });
        }
      }

      const criterios = await invoke<any[]>("get_criterios_all");
      if (criterios && criterios.length > 0) {
        for (const c of criterios) {
          await upsertRecord('criterio', {
            id: pbId(c.id), indicador_id: c.indicadorId,
            orden: c.orden, descripcion: c.descripcion,
            puntaje_maximo: Math.round(c.puntajeMaximo), user_id: userId
          });
        }
      }

      const notas = await invoke<any[]>("get_notas_all");
      if (notas && notas.length > 0) {
        for (const n of notas) {
          await upsertRecord('nota', {
            estudiante_id: n.estudianteId, criterio_id: n.criterioId,
            valor: n.valor, corte_evaluativo_id: n.corteEvaluativoId,
            asignatura_id: n.asignaturaId, user_id: userId
          });
        }
      }

      const asistencia = await invoke<any[]>("get_asistencia_all");
      if (asistencia && asistencia.length > 0) {
        for (const a of asistencia) {
          await upsertRecord('asistencia', {
            estudiante_id: a.estudianteId, fecha: a.fecha,
            estado: a.estado, observacion: a.observacion, user_id: userId
          });
        }
      }

      const gradeConfigs = await invoke<any[]>("get_grade_configs");
      if (gradeConfigs && gradeConfigs.length > 0) {
        for (const gc of gradeConfigs) {
          await upsertRecord('configuracion_calificacion', {
            id: pbId(gc.id), nombre: gc.nombre, color: gc.color,
            minimo: gc.minimo, user_id: userId
          });
        }
      }

      try {
        const colegioDias = await invoke<any[]>("get_colegio_dias_asistencia_all");
        if (colegioDias && colegioDias.length > 0) {
          for (const cd of colegioDias) {
            await upsertRecord('colegio_dias_asistencia', {
              colegio_id: cd.colegioId, lunes: cd.lunes, martes: cd.martes,
              miercoles: cd.miercoles, jueves: cd.jueves, viernes: cd.viernes,
              sabado: cd.sabado, domingo: cd.domingo, user_id: userId
            });
          }
        }
      } catch (e: any) {
        if (!e?.message?.includes('not allowed')) throw e;
      }
    })(), 'todos los datos (Sincronización Completa)');
  },

  pullAll: async () => {
    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) throw new Error("Debes estar conectado para descargar datos");

      await pocketbaseSyncService.syncPendingDeletions();

      const collections = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'estudiante', 'indicador', 'criterio', 'nota', 'asistencia',
        'configuracion_calificacion', 'grado_asignatura', 'colegio_asignatura', 'colegio_dias_asistencia'
      ];

      const allData: any = {};
      for (const col of collections) {
        try {
          allData[col] = await pb.collection(col).getFullList({
            filter: `user_id="${userId}"`
          });
        } catch {
          allData[col] = [];
        }
      }

      const pullData: any = {
        anos: (allData['ano_lectivo'] || []).map((a: any) => ({ id: Number(a.id), nombre: a.nombre, activo: a.activo, cualitativo: a.cualitativo })),
        cortes: (allData['corte_evaluativo'] || []).map((c: any) => ({ id: Number(c.id), nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
        colegios: (allData['colegio'] || []).map((c: any) => ({ id: Number(c.id), nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
        asignaturas: (allData['asignatura'] || []).map((a: any) => ({ id: Number(a.id), nombre: a.nombre, cualitativo: a.cualitativo })),
        grados: (allData['grado'] || []).map((g: any) => ({ id: Number(g.id), nombre: g.nombre, cualitativo: g.cualitativo })),
        secciones: (allData['seccion'] || []).map((s: any) => ({ id: Number(s.id), nombre: s.nombre, cualitativo: s.cualitativo })),
        estudiantes: (allData['estudiante'] || []).map((e: any) => ({
          id: Number(e.id), nombre: e.nombre, codigo: e.codigo, sexo: e.sexo,
          anoLectivoId: e.ano_lectivo_id, gradoId: e.grado_id, seccionId: e.seccion_id,
          colegioId: e.colegio_id, telefono: e.telefono, direccion: e.direccion, email: e.email
        })),
        indicadores: (allData['indicador'] || []).map((i: any) => ({
          id: Number(i.id), gradoId: i.grado_id, asignaturaId: i.asignatura_id,
          corteEvaluativoId: i.corte_evaluativo_id, orden: i.orden,
          descripcion: i.descripcion, activo: i.activo, criterios: []
        })),
        criterios: (allData['criterio'] || []).map((c: any) => ({
          id: Number(c.id), indicadorId: c.indicador_id, orden: c.orden,
          descripcion: c.descripcion, puntajeMaximo: c.puntaje_maximo
        })),
        notas: (allData['nota'] || []).map((n: any) => ({
          estudianteId: Number(n.estudiante_id), criterioId: Number(n.criterio_id),
          valor: n.valor, corteEvaluativoId: Number(n.corte_evaluativo_id),
          asignaturaId: Number(n.asignatura_id)
        })),
        asistencia: (allData['asistencia'] || []).map((a: any) => ({
          estudianteId: Number(a.estudiante_id), fecha: a.fecha,
          estado: a.estado, observacion: a.observacion
        })),
        gradeConfigs: (allData['configuracion_calificacion'] || []).map((gc: any) => ({
          id: gc.id, color: gc.color, minimo: gc.minimo
        })),
        gradoAsignatura: (allData['grado_asignatura'] || []).map((ga: any) => [Number(ga.grado_id), Number(ga.asignatura_id)]),
        colegioAsignatura: (allData['colegio_asignatura'] || []).map((ca: any) => [Number(ca.colegio_id), Number(ca.asignatura_id)]),
        colegioDiasAsistencia: (allData['colegio_dias_asistencia'] || []).map((cda: any) => ({
          colegioId: Number(cda.colegio_id), lunes: cda.lunes, martes: cda.martes,
          miercoles: cda.miercoles, jueves: cda.jueves, viernes: cda.viernes,
          sabado: cda.sabado, domingo: cda.domingo
        }))
      };

      await invoke('upsert_pull_data', { data: pullData });
      return pullData;
    })(), 'datos desde la nube');
  },

  syncColegioSubjects: async (colegioId: number, subjectIds: number[]) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      if (subjectIds.length > 0) {
        for (const sid of subjectIds) {
          await upsertRecord('colegio_asignatura', {
            colegio_id: colegioId, asignatura_id: sid, user_id: userId
          });
        }
      } else {
        const records = await pb.collection('colegio_asignatura').getFullList({
          filter: `colegio_id=${colegioId} && user_id="${userId}"`
        }).catch(() => []);
        for (const r of records) {
          await deleteRecord('colegio_asignatura', r.id);
        }
      }
    })(), 'Asignaturas del colegio actualizadas');
  },

  syncGradeSubjects: async (gradoId: number) => {
    syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) return;

      const subjects = await invoke<any[]>("get_subjects_by_grade", { gradoId });

      if (subjects && subjects.length > 0) {
        for (const s of subjects) {
          await upsertRecord('grado_asignatura', {
            grado_id: gradoId, asignatura_id: s.id, user_id: userId
          });
        }
      } else {
        const records = await pb.collection('grado_asignatura').getFullList({
          filter: `grado_id=${gradoId} && user_id="${userId}"`
        }).catch(() => []);
        for (const r of records) {
          await deleteRecord('grado_asignatura', r.id);
        }
      }
    })(), `Asignaturas del grado ${gradoId} actualizadas`);
  },

  wipeRemoteData: async () => {
    return syncManager.wrapSync((async () => {
      const userId = await pocketbaseSyncService.getUserId();
      if (!userId) throw new Error("Debes estar conectado para borrar datos remotos");

      const collections = [
        'asistencia', 'nota', 'criterio', 'indicador', 'grado_asignatura',
        'colegio_asignatura', 'estudiante', 'seccion', 'grado', 'asignatura',
        'colegio_dias_asistencia', 'colegio', 'corte_evaluativo', 'ano_lectivo',
        'configuracion_calificacion'
      ];

      for (const col of collections) {
        try {
          const records = await pb.collection(col).getFullList({
            filter: `user_id="${userId}"`
          });
          for (const r of records) {
            await deleteRecord(col, r.id);
          }
        } catch (e: any) {
          if (!e?.message?.includes('not found')) {
            console.error(`Error wiping ${col}:`, e);
          }
        }
      }
    })(), 'limpieza de la nube');
  }
};
