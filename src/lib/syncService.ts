import { supabase } from './supabase';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

/**
 * Servicio de sincronización (Local <-> Supabase)
 * Estrategia: "Local-First". Los cambios se hacen en SQLite primero
 * y luego se intentan replicar en la nube (Supabase).
 */

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

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

      // Notificar a la UI que hubo cambios importantes
      await emit("catalog-updated");

      // Volver a idle después de 3 segundos
      setTimeout(() => {
        if (this.state.status === 'success') {
          this.setState({ status: 'idle', message: null });
        }
      }, 3000);
    } catch (error: any) {
      // Mejorar la extracción del mensaje de error de Supabase u otros objetos
      let errorMessage = 'Error desconocido';
      
      console.error(`DETALLE DE ERROR en sincronización (${description}):`, error);
      
      // Intentar extraer información más detallada si es un error de Supabase/PostgREST
      if (error && typeof error === 'object') {
        console.error("Error Object keys:", Object.keys(error));
        console.error("Error Message:", error.message);
        console.error("Error Details:", error.details);
        console.error("Error Hint:", error.hint);
        console.error("Error Code:", error.code);
      }

      if (error && typeof error === 'object') {
        // Manejar errores de Supabase que a veces vienen anidados o como objetos de error estándar
        const supabaseError = error as any;
        errorMessage = supabaseError.message || supabaseError.details || supabaseError.hint || (error.toString && error.toString() !== '[object Object]' ? error.toString() : JSON.stringify(error));
        
        // Si hay información de respuesta HTTP (ej: 400), incluirla
        if (supabaseError.status) {
          errorMessage = `(HTTP ${supabaseError.status}) ${errorMessage}`;
        }

        // Si sigue siendo vacío o [object Object], forzar una representación legible
        if (errorMessage === '{}' || errorMessage === '[object Object]') {
          try {
            errorMessage = JSON.stringify(error, Object.getOwnPropertyNames(error));
          } catch (e) {
            errorMessage = 'Error estructural no serializable';
          }
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      this.setState({ 
        status: 'error', 
        message: `Error sincronizando ${description}: ${errorMessage}` 
      });

      // Re-lanzar el error para que los componentes UI puedan capturarlo y mostrar feedback
      throw error;
    }
  }
}

export const syncManager = new SyncManager();

export const syncService = {
  /**
   * Mapeo de nombres de tablas a nombres legibles
   */
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

  /**
   * Obtener el ID del usuario actual
   */
  getUserId: async () => {
    const { data: userData } = await supabase.auth.getUser();
    return userData.user?.id || null;
  },

  /**
   * Sincroniza Entidades Globales (Colegios, Grados, Secciones, Asignaturas, Años, Cortes)
   */
  syncGlobal: async (table: string, data: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // Limpiar objeto para Supabase
      const syncItem: any = {
        id: data.id,
        nombre: data.nombre,
        user_id: userId
      };

      if (data.activo !== undefined && data.activo !== null) {
        if (['ano_lectivo', 'corte_evaluativo', 'indicador'].includes(table)) {
          syncItem.activo = data.activo;
        }
      }
      if (data.cualitativo !== undefined && data.cualitativo !== null) {
        syncItem.cualitativo = data.cualitativo;
      }

      const { error } = await supabase
        .from(table)
        .upsert(syncItem, { onConflict: 'id' });

      if (error) throw error;
    })(), `${syncService.getTableName(table)} ${isNew ? 'nuevo' : 'actualizado'}: ${data.nombre}`);
  },

  deleteGlobal: async (table: string, id: number) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      
      // Si el borrado en la nube fue exitoso, eliminamos de pendientes (si existiera)
      await invoke("remove_pending_deletion_by_record", { tabla: table, id: Number(id) }).catch(e => console.error("Error clearing pending deletion:", e));
    })(), `${syncService.getTableName(table)} eliminado`);
  },

  /**
   * Procesa las eliminaciones que quedaron pendientes por falta de conexión
   */
  syncPendingDeletions: async () => {
    const userId = await syncService.getUserId();
    if (!userId) return;

    try {
      const pending = await invoke<any[]>("get_pending_deletions");
      if (pending.length === 0) return;

      console.log(`[syncService] Procesando ${pending.length} eliminaciones pendientes...`);

      for (const item of pending) {
        try {
          const { error } = await supabase
            .from(item.tabla)
            .delete()
            .eq('id', item.registroId)
            .eq('user_id', userId);

          // Si el error es null (éxito) o PGRST116 (ya no existe), limpiamos el pendiente local
          if (!error || error.code === 'PGRST116') {
            await invoke("remove_pending_deletion", { id: item.id });
          } else {
            console.error(`[syncService] Error sincronizando eliminación pendiente de ${item.tabla}:${item.registroId}`, error);
          }
        } catch (err) {
          console.error(`[syncService] Fallo crítico en eliminación pendiente de ${item.tabla}:${item.registroId}:`, err);
        }
      }
    } catch (err) {
      console.error("[syncService] Error obteniendo eliminaciones pendientes de SQLite:", err);
    }
  },

  /**
   * Asegura que todas las dependencias (Año Lectivo, Colegio, Grado, Sección)
   * existan en Supabase antes de sincronizar estudiantes.
   */
  ensureStudentsDependencies: async (students: any[], userId: string) => {
    // 1. Recolectar todos los IDs únicos de dependencias
    const anoIds = [...new Set(students.map(s => s.anoLectivoId).filter(id => id))];
    const colegioIds = [...new Set(students.map(s => s.colegioId).filter(id => id))];
    const gradoIds = [...new Set(students.map(s => s.gradoId).filter(id => id))];
    const seccionIds = [...new Set(students.map(s => s.seccionId).filter(id => id))];

    const checkAndSync = async (table: string, ids: any[], localCmd: string) => {
      if (ids.length === 0) return;

      // Consultar qué IDs ya existen en Supabase
      const { data: existing, error: checkError } = await supabase
        .from(table)
        .select('id')
        .in('id', ids)
        .eq('user_id', userId);

      if (checkError) throw new Error(`Error verificando ${table} en Supabase: ${checkError.message}`);

      const existingIds = new Set(existing?.map(item => item.id) || []);
      const missingIds = ids.filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        console.log(`[syncService] Sincronizando ${missingIds.length} dependencias faltantes en ${table}:`, missingIds);
        const allLocal = await invoke<any[]>(localCmd);
        const toSync = allLocal.filter(item => missingIds.includes(Number(item.id)));
        
        if (toSync.length > 0) {
          const batchData = toSync.map(item => ({
            id: item.id,
            nombre: item.nombre,
            user_id: userId,
            ...(table === 'ano_lectivo' || table === 'corte_evaluativo' || table === 'indicador' ? { activo: item.activo } : {}),
            ...(item.cualitativo !== undefined ? { cualitativo: item.cualitativo } : {})
          }));
          
          const { error: upsertError } = await supabase.from(table).upsert(batchData, { onConflict: 'id' });
          if (upsertError) throw new Error(`Error al subir dependencias faltantes de ${table}: ${upsertError.message}`);
        }
        
        // Verificar si después de intentar sincronizar aún faltan IDs
        // (Esto pasaría si el ID existe en el estudiante pero no en la tabla local correspondiente)
        const syncedIds = new Set(toSync.map(item => Number(item.id)));
        const stillMissing = missingIds.filter(id => !syncedIds.has(id));
        if (stillMissing.length > 0) {
          console.warn(`[syncService] Advertencia: Los siguientes IDs de ${table} no se encontraron localmente:`, stillMissing);
        }
      }
    };

    // Sincronizar en serie o paralelo. Usamos serie para evitar saturar o por si hay dependencias entre ellas
    await checkAndSync('ano_lectivo', anoIds, 'get_anos');
    await checkAndSync('colegio', colegioIds, 'get_colegios');
    await checkAndSync('grado', gradoIds, 'get_grados');
    await checkAndSync('seccion', seccionIds, 'get_secciones');
  },

  /**
   * Sincroniza la configuración de días de asistencia de un colegio
   */
  syncColegioDias: async (config: any) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // 1. Asegurar que el colegio exista en Supabase
      const { data: colegioExists } = await supabase
        .from('colegio')
        .select('id')
        .eq('id', config.colegioId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!colegioExists) {
         try {
            const colegios = await invoke<any[]>("get_colegios");
            const colegioLocal = colegios.find(c => Number(c.id) === Number(config.colegioId));
            if (colegioLocal) {
                // Llamamos a syncGlobal para el colegio padre
                // Nota: syncGlobal ya usa wrapSync, pero aquí estamos dentro de otro wrapSync.
                // Idealmente deberíamos llamar a la lógica interna, pero syncGlobal es seguro de llamar.
                // Sin embargo, para evitar doble notificación en UI, podríamos hacerlo directo aquí,
                // pero syncGlobal es más robusto. Lo dejaremos así, el usuario verá dos notificaciones o una combinada.
                // Para ser más limpios, hacemos el upsert directo del colegio aquí si falta.
                const { error: colError } = await supabase
                  .from('colegio')
                  .upsert({
                    id: colegioLocal.id,
                    nombre: colegioLocal.nombre,
                    user_id: userId
                  }, { onConflict: 'id' });
                
                if (colError) throw colError;
            }
         } catch (e) {
             console.error("Error sincronizando colegio padre para días de asistencia:", e);
             throw e;
         }
      }

      // 2. Sincronizar los días
      const { error } = await supabase
        .from('colegio_dias_asistencia')
        .upsert({
          colegio_id: config.colegioId,
          lunes: config.lunes,
          martes: config.martes,
          miercoles: config.miercoles,
          jueves: config.jueves,
          viernes: config.viernes,
          sabado: config.sabado,
          domingo: config.domingo,
          user_id: userId
        }, { onConflict: 'colegio_id' });

      if (error) throw error;
    })(), `Días de asistencia actualizados`);
  },

  /**
   * Estudiantes
   */
  syncStudent: async (student: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // Asegurar dependencias antes de subir al estudiante
      await syncService.ensureStudentsDependencies([student], userId);

      const { error } = await supabase
        .from('estudiante')
        .upsert({
          id: student.id,
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
        }, { onConflict: 'id' }); // Usamos solo id para el conflicto

      if (error) throw error;
    })(), `Estudiante ${isNew ? 'nuevo' : 'actualizado'}: ${student.nombre}`);
  },

  /**
   * Sincroniza múltiples Estudiantes en un solo lote (Batch Upsert)
   */
  syncStudentsBatch: async (students: any[]) => {
    if (students.length === 0) return;
    
    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // Asegurar que todos los años, colegios, etc. existan en Supabase primero
      await syncService.ensureStudentsDependencies(students, userId);

      const batchData = students.map(student => ({
        id: student.id,
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
      }));

      const { error } = await supabase
        .from('estudiante')
        .upsert(batchData, { onConflict: 'id' });

      if (error) throw error;
    })(), `${students.length} Estudiantes`);
  },

  deleteStudent: async (id: number) => {
    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from('estudiante')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      // Si el borrado en la nube fue exitoso, eliminamos de pendientes (si existiera)
      await invoke("remove_pending_deletion_by_record", { tabla: 'estudiante', id: Number(id) }).catch(e => console.error("Error clearing pending deletion:", e));
    })(), 'Estudiante eliminado');
  },

  /**
   * Indicadores y Criterios
   */
  syncIndicador: async (indicador: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from('indicador')
        .upsert({
          id: indicador.id,
          grado_id: indicador.gradoId,
          asignatura_id: indicador.asignaturaId,
          corte_evaluativo_id: indicador.corteEvaluativoId,
          orden: indicador.orden,
          descripcion: indicador.descripcion,
          activo: indicador.activo,
          user_id: userId
        }, { onConflict: 'id' });

      if (error) throw error;
    })(), `Indicador ${isNew ? 'nuevo' : 'actualizado'}: ${indicador.descripcion}`);
  },

  syncCriterio: async (criterio: any, isNew: boolean = false) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from('criterio')
        .upsert({
          id: criterio.id,
          indicador_id: criterio.indicadorId,
          orden: criterio.orden,
          descripcion: criterio.descripcion,
          puntaje_maximo: criterio.puntajeMaximo,
          user_id: userId
        }, { onConflict: 'id' });

      if (error) throw error;
    })(), `Criterio ${isNew ? 'nuevo' : 'actualizado'}: ${criterio.descripcion}`);
  },

  /**
   * Sincroniza una configuración completa de evaluación (Indicadores + Criterios)
   */
  syncEvaluacionConfig: async (indicadores: any[]) => {
    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // Recopilar todas las dependencias únicas necesarias
      const gradoIds = [...new Set(indicadores.map(i => i.gradoId).filter(Boolean))];
      const asignaturaIds = [...new Set(indicadores.map(i => i.asignaturaId).filter(Boolean))];
      const corteIds = [...new Set(indicadores.map(i => i.corteEvaluativoId).filter(Boolean))];

      // 0. Asegurar que los grados, asignaturas y cortes existan en Supabase
      for (const gradoId of gradoIds) {
        const { data: exists } = await supabase.from('grado').select('id').eq('id', gradoId).eq('user_id', userId).maybeSingle();
        if (!exists) {
          try {
            const grados = await invoke<any[]>("get_grados");
            const grado = grados.find(g => Number(g.id) === Number(gradoId));
            if (grado) {
              await supabase.from('grado').upsert({
                id: grado.id,
                nombre: grado.nombre,
                user_id: userId,
                ...(grado.cualitativo !== undefined ? { cualitativo: grado.cualitativo } : {})
              }, { onConflict: 'nombre,user_id' });
            }
          } catch (e) {
            console.warn(`No se pudo sincronizar el grado ${gradoId}:`, e);
          }
        }
      }

      for (const asignaturaId of asignaturaIds) {
        const { data: exists } = await supabase.from('asignatura').select('id').eq('id', asignaturaId).eq('user_id', userId).maybeSingle();
        if (!exists) {
          try {
            const asignaturas = await invoke<any[]>("get_asignaturas");
            const asignatura = asignaturas.find(a => Number(a.id) === Number(asignaturaId));
            if (asignatura) {
              await supabase.from('asignatura').upsert({
                id: asignatura.id,
                nombre: asignatura.nombre,
                user_id: userId,
                ...(asignatura.cualitativo !== undefined ? { cualitativo: asignatura.cualitativo } : {})
              }, { onConflict: 'id' });
            }
          } catch (e) {
            console.warn(`No se pudo sincronizar la asignatura ${asignaturaId}:`, e);
          }
        }
      }

      for (const corteId of corteIds) {
        const { data: exists } = await supabase.from('corte_evaluativo').select('id').eq('id', corteId).eq('user_id', userId).maybeSingle();
        if (!exists) {
          try {
            const cortes = await invoke<any[]>("get_cortes");
            const corte = cortes.find(c => Number(c.id) === Number(corteId));
            if (corte) {
              await supabase.from('corte_evaluativo').upsert({
                id: corte.id,
                nombre: corte.nombre,
                activo: corte.activo,
                user_id: userId
              }, { onConflict: 'id' });
            }
          } catch (e) {
            console.warn(`No se pudo sincronizar el corte ${corteId}:`, e);
          }
        }
      }

      for (const ind of indicadores) {
        // 1. Sincronizar Indicador
        const { error: indError } = await supabase
          .from('indicador')
          .upsert({
            id: ind.id,
            grado_id: ind.gradoId,
            asignatura_id: ind.asignaturaId,
            corte_evaluativo_id: ind.corteEvaluativoId,
            orden: ind.orden,
            descripcion: ind.descripcion,
            activo: ind.activo,
            user_id: userId
          }, { onConflict: 'id' });

        if (indError) throw indError;

        // 2. Sincronizar Criterios del indicador
        if (ind.criterios && ind.criterios.length > 0) {
          const criteriosData = ind.criterios.map((crit: any) => ({
            id: crit.id,
            indicador_id: crit.indicadorId,
            orden: crit.orden,
            descripcion: crit.descripcion,
            puntaje_maximo: crit.puntajeMaximo,
            user_id: userId
          }));

          const { error: critError } = await supabase
            .from('criterio')
            .upsert(criteriosData, { onConflict: 'id' });

          if (critError) throw critError;
        }
      }
    })(), `Configuración de evaluación actualizada (${indicadores.length} indicadores)`);
  },

  /**
   * Notas
   */
  syncNota: async (nota: any) => {
    // console.log("LOG [syncService]: syncNota recibida:", nota);
    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) {
        console.warn("[syncService] No hay userId, saltando sync de nota");
        return;
      }

      // 1. Verificar si el estudiante existe en Supabase antes de intentar sincronizar la nota
      const { data: studentExists, error: studentError } = await supabase
        .from('estudiante')
        .select('id')
        .eq('id', nota.estudianteId)
        .eq('user_id', userId)
        .maybeSingle();

      if (studentError) {
        console.error(`[syncService] Error verificando estudiante ${nota.estudianteId} en Supabase:`, studentError);
      }

      if (!studentExists) {
        console.warn(`[syncService] Estudiante ${nota.estudianteId} no encontrado en Supabase. Intentando sincronizar estudiante primero...`);
        try {
          const students = await invoke<any[]>("get_students");
          const studentData = students.find(s => Number(s.id) === Number(nota.estudianteId));
          if (studentData) {
            // Asegurar dependencias del estudiante individual
            await syncService.ensureStudentsDependencies([studentData], userId);
            
            // Sincronizar el estudiante
            const { error: studentSyncError } = await supabase
              .from('estudiante')
              .upsert({
                id: studentData.id,
                nombre: studentData.nombre,
                codigo: studentData.codigo,
                sexo: studentData.sexo,
                ano_lectivo_id: studentData.anoLectivoId || null,
                grado_id: studentData.gradoId || null,
                seccion_id: studentData.seccionId || null,
                colegio_id: studentData.colegioId || null,
                user_id: userId
              }, { onConflict: 'id' });
            
            if (studentSyncError) throw studentSyncError;
          } else {
            throw new Error(`Estudiante ${nota.estudianteId} no encontrado localmente`);
          }
        } catch (e) {
          console.error(`[syncService] Falló la sincronización previa del estudiante ${nota.estudianteId} para nota:`, e);
          throw e;
        }
      }

      const syncData = {
        estudiante_id: nota.estudianteId,
        criterio_id: nota.criterioId,
        valor: nota.valor,
        corte_evaluativo_id: nota.corteEvaluativoId,
        asignatura_id: nota.asignaturaId,
        user_id: userId
      };

      const { error } = await supabase
        .from('nota')
        .upsert(syncData, { 
          onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id,user_id',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error("[syncService] Error en upsert de nota:", error);
        throw error;
      }
    })(), 'Nota actualizada');
  },

  /**
   * Sincroniza múltiples Notas en un solo lote (Batch Upsert)
   */
  syncNotasBatch: async (notas: any[]) => {
    if (notas.length === 0) return;
    
    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // 1. Verificar qué estudiantes de este lote faltan en Supabase
      const uniqueStudentIds = [...new Set(notas.map(n => n.estudianteId))];
      
      const { data: existingStudents, error: checkError } = await supabase
        .from('estudiante')
        .select('id, ano_lectivo_id, grado_id, seccion_id, colegio_id')
        .in('id', uniqueStudentIds)
        .eq('user_id', userId);

      if (checkError) {
        console.error("[syncService] Error verificando estudiantes en lote:", checkError);
      }

      const existingIds = new Set(existingStudents?.map(s => s.id) || []);
      const missingIds = uniqueStudentIds.filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        console.log(`[syncService] Sincronizando ${missingIds.length} estudiantes faltantes antes de subir notas...`);
        try {
          const allLocalStudents = await invoke<any[]>("get_students");
          const studentsToSync = allLocalStudents.filter(s => missingIds.includes(Number(s.id)));
          
          if (studentsToSync.length > 0) {
            // Asegurar dependencias para estos estudiantes faltantes
            await syncService.ensureStudentsDependencies(studentsToSync, userId);

            const batchData = studentsToSync.map(student => ({
              id: student.id,
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
            }));
            
            const { error: studentUpsertError } = await supabase.from('estudiante').upsert(batchData, { onConflict: 'id' });
            if (studentUpsertError) throw studentUpsertError;
          }
        } catch (e) {
          console.error("[syncService] Error crítico sincronizando estudiantes faltantes para notas:", e);
          throw e; // Propagar para que wrapSync lo capture
        }
      }

      const batchData = notas.map(nota => ({
        estudiante_id: nota.estudianteId,
        criterio_id: nota.criterioId,
        valor: nota.valor,
        corte_evaluativo_id: nota.corteEvaluativoId,
        asignatura_id: nota.asignaturaId,
        user_id: userId
      }));

      const { error } = await supabase
        .from('nota')
        .upsert(batchData, { 
          onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id,user_id' 
        });

      if (error) throw error;
    })(), `${notas.length} Notas`);
  },

  /**
   * Asistencia
   */
  syncAsistencia: async (asistencia: any, details?: string) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // 1. Verificar si el estudiante existe en Supabase antes de intentar sincronizar la asistencia
      const { data: studentExists, error: studentError } = await supabase
        .from('estudiante')
        .select('id')
        .eq('id', asistencia.estudianteId)
        .eq('user_id', userId)
        .maybeSingle(); // Usar maybeSingle para evitar error PGRST116 si no existe

      if (studentError) {
        console.error(`LOG [syncService]: Error verificando estudiante ${asistencia.estudianteId} en Supabase:`, studentError);
        // No lanzamos error aquí, intentamos seguir o sincronizar
      }

      if (!studentExists) {
        console.warn(`LOG [syncService]: Estudiante ${asistencia.estudianteId} no encontrado en Supabase. Intentando sincronizar estudiante primero...`);
        
        // Obtener datos completos del estudiante desde SQLite para sincronizarlo
        try {
          const students = await invoke<any[]>("get_students");
          const studentData = students.find(s => s.id === asistencia.estudianteId);
          
          if (studentData) {
            await syncService.syncStudent(studentData);
            console.log(`LOG [syncService]: Estudiante ${asistencia.estudianteId} sincronizado con éxito.`);
          } else {
            throw new Error(`Estudiante ${asistencia.estudianteId} no encontrado en la base de datos local.`);
          }
        } catch (e) {
          console.error(`LOG [syncService]: Falló la sincronización previa del estudiante ${asistencia.estudianteId}:`, e);
          throw new Error(`No se puede sincronizar la asistencia: el estudiante no existe en Supabase y no se pudo sincronizar localmente.`);
        }
      }

      const { error } = await supabase
        .from('asistencia')
        .upsert({
          estudiante_id: asistencia.estudianteId,
          fecha: asistencia.fecha,
          estado: asistencia.estado,
          observacion: asistencia.observacion,
          user_id: userId
        }, { onConflict: 'estudiante_id,fecha,user_id' }); // Esta se mantiene por su UNIQUE compuesto

      if (error) throw error;
    })(), details || 'Asistencia actualizada');
  },

  syncAsistenciaBatch: async (records: any[]) => {
    if (records.length === 0) return;

    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // 1. Verificar qué estudiantes de este lote faltan en Supabase
      const uniqueStudentIds = [...new Set(records.map(r => r.estudianteId))];
      
      const { data: existingStudents, error: checkError } = await supabase
        .from('estudiante')
        .select('id')
        .in('id', uniqueStudentIds)
        .eq('user_id', userId);

      if (checkError) {
        console.error("Error verificando estudiantes en lote de asistencia:", checkError);
      }

      const existingIds = new Set(existingStudents?.map(s => s.id) || []);
      const missingIds = uniqueStudentIds.filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        console.log(`Sincronizando ${missingIds.length} estudiantes faltantes antes de subir asistencia...`);
        try {
          const allLocalStudents = await invoke<any[]>("get_students");
          const studentsToSync = allLocalStudents.filter(s => missingIds.includes(Number(s.id)));
          
          if (studentsToSync.length > 0) {
            // Asegurar dependencias para estos estudiantes faltantes
            await syncService.ensureStudentsDependencies(studentsToSync, userId);

            const batchData = studentsToSync.map(student => ({
              id: student.id,
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
            }));
            
            const { error: studentUpsertError } = await supabase.from('estudiante').upsert(batchData, { onConflict: 'id' });
            if (studentUpsertError) throw studentUpsertError;
          }
        } catch (e) {
          console.error("Error sincronizando estudiantes faltantes para asistencia:", e);
          throw e; // Propagar para que wrapSync lo capture
        }
      }

      const batchAsistencia = records.map(a => ({
        estudiante_id: a.estudianteId,
        fecha: a.fecha,
        estado: a.estado,
        observacion: a.observacion,
        user_id: userId
      }));

      const { error } = await supabase
        .from('asistencia')
        .upsert(batchAsistencia, { onConflict: 'estudiante_id,fecha,user_id' });

      if (error) throw error;
    })(), `${records.length} Registros de asistencia`);
  },

  /**
   * Configuración de Calificaciones
   */
  syncGradeConfig: async (config: any) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from('configuracion_calificacion')
        .upsert({
          id: config.id,
          color: config.color,
          minimo: config.minimo,
          user_id: userId
        }, { onConflict: 'id' });

      if (error) throw error;
    })(), 'Configuración de Notas');
  },

  /**
   * Sincronización Inicial Completa
   * Sincroniza todos los datos en el orden correcto para respetar las Foreign Keys
   */
  syncAll: async () => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) throw new Error("Debes estar conectado para sincronizar");

      // 0. Procesar eliminaciones pendientes antes de sincronizar subidas
      await syncService.syncPendingDeletions();

      // 1. Sincronizar Tablas Base (Sin dependencias)
      const baseTables = [
        { table: 'ano_lectivo', cmd: 'get_anos' },
        { table: 'corte_evaluativo', cmd: 'get_cortes' },
        { table: 'colegio', cmd: 'get_colegios' },
        { table: 'asignatura', cmd: 'get_asignaturas' },
        { table: 'grado', cmd: 'get_grados' },
        { table: 'seccion', cmd: 'get_secciones' }
      ];

      for (const { table, cmd } of baseTables) {
        const data = await invoke<any[]>(cmd);
        if (!data || data.length === 0) continue;

        const batchData = data.map(item => {
          const syncItem: any = {
            id: item.id,
            nombre: item.nombre,
            user_id: userId
          };

          if (item.activo !== undefined && item.activo !== null) {
            if (['ano_lectivo', 'corte_evaluativo', 'indicador'].includes(table)) {
              syncItem.activo = item.activo;
            }
          }
          if (item.cualitativo !== undefined && item.cualitativo !== null) {
            syncItem.cualitativo = item.cualitativo;
          }
          return syncItem;
        });

        const { error } = await supabase.from(table).upsert(batchData, { onConflict: 'id' });
        if (error) {
          console.error(`Error en tabla base ${table}:`, error);
          throw new Error(`Error en ${syncService.getTableName(table)}: ${error.message}`);
        }
      }

      // 2. Sincronizar Estudiantes (Dependen de las tablas base)
      const estudiantes = await invoke<any[]>("get_students");
      if (estudiantes && estudiantes.length > 0) {
        const batchEstudiantes = estudiantes.map(e => ({
          id: e.id,
          nombre: e.nombre,
          codigo: e.codigo,
          sexo: e.sexo,
          ano_lectivo_id: e.anoLectivoId || null,
          grado_id: e.gradoId || null,
          seccion_id: e.seccionId || null,
          colegio_id: e.colegioId || null,
          telefono: e.telefono,
          direccion: e.direccion,
          email: e.email,
          user_id: userId
        }));

        const { error } = await supabase.from('estudiante').upsert(batchEstudiantes, { onConflict: 'id' });
        if (error) {
          console.error("Error en estudiantes:", error);
          throw new Error(`Error en Estudiantes: ${error.message}`);
        }
      }

      // 2.5 Sincronizar Relación Grado-Asignatura
      try {
        const grados = await invoke<any[]>("get_grados");
        let allRelations: any[] = [];
        for (const g of grados) {
          const subjects = await invoke<any[]>("get_subjects_by_grade", { gradoId: g.id });
          if (subjects) {
            allRelations.push(...subjects.map(s => ({
              grado_id: g.id,
              asignatura_id: s.id,
              user_id: userId
            })));
          }
        }
        
        if (allRelations.length > 0) {
          const { error } = await supabase.from('grado_asignatura').upsert(allRelations, { 
            onConflict: 'grado_id,asignatura_id,user_id' 
          });
          if (error) console.warn("Error sincronizando grado_asignatura:", error);
        }
      } catch (e) {
        console.warn("No se pudo sincronizar grado_asignatura:", e);
      }

      // 2.6 Sincronizar Relación Colegio-Asignatura
      try {
        const colegios = await invoke<any[]>("get_colegios");
        let allRelations: any[] = [];
        for (const c of colegios) {
          const subjects = await invoke<any[]>("get_subjects_by_colegio", { colegioId: c.id });
          if (subjects) {
            allRelations.push(...subjects.map(s => ({
              colegio_id: c.id,
              asignatura_id: s.id,
              user_id: userId
            })));
          }
        }
        
        if (allRelations.length > 0) {
          const { error } = await supabase.from('colegio_asignatura').upsert(allRelations, { 
            onConflict: 'colegio_id,asignatura_id,user_id' 
          });
          if (error) console.warn("Error sincronizando colegio_asignatura:", error);
        }
      } catch (e) {
        console.warn("No se pudo sincronizar colegio_asignatura:", e);
      }

      // 3. Sincronizar Indicadores (Dependen de grado, asignatura, corte)
      const indicadores = await invoke<any[]>("get_indicadores_all");
      if (indicadores && indicadores.length > 0) {
        const batchIndicadores = indicadores.map(i => ({
          id: i.id,
          grado_id: i.gradoId,
          asignatura_id: i.asignaturaId,
          corte_evaluativo_id: i.corteEvaluativoId,
          orden: i.orden,
          descripcion: i.descripcion,
          activo: i.activo,
          user_id: userId
        }));

        const { error } = await supabase.from('indicador').upsert(batchIndicadores, { onConflict: 'id' });
        if (error) {
          console.error("Error en indicadores:", error);
          throw new Error(`Error en Indicadores: ${error.message}`);
        }
      }

      // 4. Sincronizar Criterios (Dependen de indicadores)
      const criterios = await invoke<any[]>("get_criterios_all");
      if (criterios && criterios.length > 0) {
        const batchCriterios = criterios.map(c => ({
          id: c.id,
          indicador_id: c.indicadorId,
          orden: c.orden,
          descripcion: c.descripcion,
          puntaje_maximo: c.puntajeMaximo,
          user_id: userId
        }));

        const { error } = await supabase.from('criterio').upsert(batchCriterios, { onConflict: 'id' });
        if (error) {
          console.error("Error en criterios:", error);
          throw new Error(`Error en Criterios: ${error.message}`);
        }
      }

      // 5. Sincronizar Notas
      const notas = await invoke<any[]>("get_notas_all");
      if (notas && notas.length > 0) {
        const batchNotas = notas.map(n => ({
          estudiante_id: n.estudianteId,
          criterio_id: n.criterioId,
          valor: n.valor,
          corte_evaluativo_id: n.corteEvaluativoId,
          asignatura_id: n.asignaturaId,
          user_id: userId
        }));

        const { error } = await supabase.from('nota').upsert(batchNotas, { 
          onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id,user_id' 
        });
        if (error) {
          console.error("Error en notas:", error);
          throw new Error(`Error en Notas: ${error.message}`);
        }
      }

      // 6. Sincronizar Asistencia
      const asistencia = await invoke<any[]>("get_asistencia_all");
      if (asistencia && asistencia.length > 0) {
        const batchAsistencia = asistencia.map(a => ({
          estudiante_id: a.estudianteId,
          fecha: a.fecha,
          estado: a.estado,
          observacion: a.observacion,
          user_id: userId
        }));

        const { error } = await supabase.from('asistencia').upsert(batchAsistencia, { 
          onConflict: 'estudiante_id,fecha,user_id' 
        });
        if (error) {
          console.error("Error en asistencia:", error);
          throw new Error(`Error en Asistencia: ${error.message}`);
        }
      }

      // 7. Configuración de Calificaciones
      const gradeConfigs = await invoke<any[]>("get_grade_configs");
      if (gradeConfigs && gradeConfigs.length > 0) {
        const batchConfigs = gradeConfigs.map(gc => ({
          id: gc.id,
          color: gc.color,
          minimo: gc.minimo,
          user_id: userId
        }));

        const { error } = await supabase.from('configuracion_calificacion').upsert(batchConfigs, { 
          onConflict: 'id' 
        });
        if (error) {
          console.error("Error en configuracion_calificacion:", error);
          throw new Error(`Error en Configuración de Notas: ${error.message}`);
        }
      }

      // 8. Días de Asistencia por Colegio
      try {
        const colegioDias = await invoke<any[]>("get_colegio_dias_asistencia_all");
        if (colegioDias && colegioDias.length > 0) {
          const batchDias = colegioDias.map(cd => ({
            colegio_id: cd.colegioId,
            lunes: cd.lunes,
            martes: cd.martes,
            miercoles: cd.miercoles,
            jueves: cd.jueves,
            viernes: cd.viernes,
            sabado: cd.sabado,
            domingo: cd.domingo,
            user_id: userId
          }));

          const { error } = await supabase.from('colegio_dias_asistencia').upsert(batchDias, { 
            onConflict: 'colegio_id,user_id' 
          });
          if (error) {
            console.error("Error en colegio_dias_asistencia:", error);
            throw new Error(`Error en Días de Asistencia: ${error.message}`);
          }
        }
      } catch (e: any) {
        if (e?.message?.includes('not allowed') || e?.includes?.('not found')) {
          console.warn("Comando get_colegio_dias_asistencia_all no disponible aún. Recompila la app.");
        } else {
          throw e;
        }
      }
    })(), 'todos los datos (Sincronización Completa)');
  },

  /**
   * Sincronización Descendente (Nube -> Local)
   * Útil tras iniciar sesión para recuperar datos previos.
   * Usa Supabase como proveedor.
   */
  pullAll: async () => {
    console.log(`[Sync] pullAll llamado desde frontend`);
    return syncManager.wrapSync((async () => {
      console.log(`[Sync] Iniciando wrapSync`);
      const userId = await syncService.getUserId();
      console.log(`[Sync] User ID obtenido:`, userId);
      if (!userId) throw new Error("Debes estar conectado para descargar datos");

      // 0. Procesar eliminaciones pendientes antes de descargar datos
      await syncService.syncPendingDeletions();

      console.log(`[Sync] Iniciando descarga de datos desde Supabase para user: ${userId}`);

      let pullData: any;

      // Usar Supabase
      const tables = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'estudiante', 'indicador', 'criterio', 'nota', 'asistencia',
        'configuracion_calificacion', 'grado_asignatura', 'colegio_asignatura', 'colegio_dias_asistencia'
      ];

      console.log(`[Sync] Consultando tablas con user_id: ${userId}`);

      const results = await Promise.all(
        tables.map(table => {
          console.log(`[Sync] Consultando ${table}...`);
          return supabase.from(table).select('*').eq('user_id', userId);
        })
      );

      // Verificar errores en cada consulta
      const errors = results.filter(r => r.error).map(r => r.error);
      if (errors.length > 0) {
        const errorDetails = errors.map(e => e?.message).join(', ');
        console.error('[Sync] Errores en consultas:', errors);
        throw new Error(`Error descargando datos: ${errorDetails}`);
      }

      const [
        anos, cortes, colegios, asignaturas, grados, secciones,
        estudiantes, indicadores, criterios, notas, asistencia,
        gradeConfigs, gradoAsignatura, colegioAsignatura, colegioDiasAsistencia
      ] = results.map(r => r.data);

      console.log('[Sync] Datos obtenidos de Supabase:', {
        anos: anos?.length || 0,
        cortes: cortes?.length || 0,
        colegios: colegios?.length || 0,
        asignaturas: asignaturas?.length || 0,
        grados: grados?.length || 0,
        secciones: secciones?.length || 0,
        estudiantes: estudiantes?.length || 0,
        indicadores: indicadores?.length || 0,
        criterios: criterios?.length || 0,
        notas: notas?.length || 0,
        asistencia: asistencia?.length || 0,
        gradeConfigs: gradeConfigs?.length || 0,
        gradoAsignatura: gradoAsignatura?.length || 0,
        colegioAsignatura: colegioAsignatura?.length || 0,
        colegioDiasAsistencia: colegioDiasAsistencia?.length || 0
      });

      // 2. Mapear datos al formato esperado por Rust
      pullData = {
          anos: (anos || []).map(a => ({ id: a.id, nombre: a.nombre, activo: a.activo, cualitativo: a.cualitativo })),
          cortes: (cortes || []).map(c => ({ id: c.id, nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
          colegios: (colegios || []).map(c => ({ id: c.id, nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
          asignaturas: (asignaturas || []).map(a => ({ id: a.id, nombre: a.nombre, cualitativo: a.cualitativo })),
          grados: (grados || []).map(g => ({ id: g.id, nombre: g.nombre, cualitativo: g.cualitativo })),
          secciones: (secciones || []).map(s => ({ id: s.id, nombre: s.nombre, cualitativo: s.cualitativo })),
          estudiantes: (estudiantes || []).map(e => ({
            id: e.id,
            nombre: e.nombre,
            codigo: e.codigo,
            sexo: e.sexo,
            anoLectivoId: e.ano_lectivo_id,
            gradoId: e.grado_id,
            seccionId: e.seccion_id,
            colegioId: e.colegio_id,
            telefono: e.telefono,
            direccion: e.direccion,
            email: e.email
          })),
          indicadores: (indicadores || []).map(i => ({
            id: i.id,
            gradoId: i.grado_id,
            asignaturaId: i.asignatura_id,
            corteEvaluativoId: i.corte_evaluativo_id,
            orden: i.orden,
            descripcion: i.descripcion,
            activo: i.activo,
            criterios: []
          })),
          criterios: (criterios || []).map(c => ({
            id: c.id,
            indicadorId: c.indicador_id,
            orden: c.orden,
            descripcion: c.descripcion,
            puntajeMaximo: c.puntaje_maximo
          })),
          notas: (notas || []).map(n => ({
            estudianteId: n.estudiante_id,
            criterioId: n.criterio_id,
            valor: n.valor,
            corteEvaluativoId: n.corte_evaluativo_id,
            asignaturaId: n.asignatura_id
          })),
          asistencia: (asistencia || []).map(a => ({
            estudianteId: a.estudiante_id,
            fecha: a.fecha,
            estado: a.estado,
            observacion: a.observacion
          })),
          gradeConfigs: (gradeConfigs || []).map(gc => ({
            id: gc.id,
            color: gc.color,
            minimo: gc.minimo
          })),
          gradoAsignatura: (gradoAsignatura || []).map(ga => [ga.grado_id, ga.asignatura_id]),
          colegioAsignatura: (colegioAsignatura || []).map(ca => [ca.colegio_id, ca.asignatura_id]),
          colegioDiasAsistencia: (colegioDiasAsistencia || []).map(cda => ({
            colegioId: cda.colegio_id,
            lunes: cda.lunes,
            martes: cda.martes,
            miercoles: cda.miercoles,
            jueves: cda.jueves,
            viernes: cda.viernes,
            sabado: cda.sabado,
            domingo: cda.domingo
          }))
        };

      // 3. Enviar a Rust para upsert masivo en SQLite
      console.log(`[Sync] Enviando datos a upsert_pull_data...`);
      await invoke('upsert_pull_data', { data: pullData });
      console.log(`[Sync] upsert_pull_data completado`);
      return pullData;
    })(), 'datos desde la nube');
  },

  /**
   * Sincroniza las asignaturas de un colegio
   */
  syncColegioSubjects: async (colegioId: number, subjectIds: number[]) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // 1. Upsert current assignments (this handles both insert and update)
      if (subjectIds.length > 0) {
        const insertData = subjectIds.map(sid => ({
          colegio_id: colegioId,
          asignatura_id: sid,
          user_id: userId
        }));

        // Use upsert with onConflict to handle duplicate keys
        // The conflict constraint includes user_id for row-level security
        const { error } = await supabase
          .from('colegio_asignatura')
          .upsert(insertData, {
            onConflict: 'colegio_id,asignatura_id,user_id'
          });

        if (error) throw error;
      } else {
        // If no subjects, delete all assignments for this colegio
        const { error } = await supabase
          .from('colegio_asignatura')
          .delete()
          .eq('colegio_id', colegioId)
          .eq('user_id', userId);

        if (error) throw error;
      }
    })(), `Asignaturas del colegio actualizadas`);
  },

  /**
   * Sincroniza las asignaturas de un grado con Supabase
   */
  syncGradeSubjects: async (gradoId: number) => {
    syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) return;

      // 1. Get current assignments from local DB
      const subjects = await invoke<any[]>("get_subjects_by_grade", { gradoId });
      
      // 2. Upsert current assignments (this handles both insert and update)
      if (subjects && subjects.length > 0) {
        const insertData = subjects.map(s => ({
          grado_id: gradoId,
          asignatura_id: s.id,
          user_id: userId
        }));

        // Use upsert with onConflict to handle duplicate keys
        // The conflict constraint includes user_id for row-level security
        const { error } = await supabase
          .from('grado_asignatura')
          .upsert(insertData, {
            onConflict: 'grado_id,asignatura_id,user_id'
          });

        if (error) throw error;
      } else {
        // If no subjects, delete all assignments for this grade
        const { error } = await supabase
          .from('grado_asignatura')
          .delete()
          .eq('grado_id', gradoId)
          .eq('user_id', userId);

        if (error) throw error;
      }
    })(), `Asignaturas del grado ${gradoId} actualizadas`);
  },

  /**
   * Borra todos los datos del usuario actual en Supabase.
   * ¡CUIDADO! Esta acción es irreversible.
   */
  wipeRemoteData: async () => {
    return syncManager.wrapSync((async () => {
      const userId = await syncService.getUserId();
      if (!userId) throw new Error("Debes estar conectado para borrar datos remotos");

      const tables = [
        'asistencia',
        'nota',
        'criterio',
        'indicador',
        'grado_asignatura',
        'colegio_asignatura',
        'estudiante',
        'seccion',
        'grado',
        'asignatura',
        'colegio_dias_asistencia',
        'colegio',
        'corte_evaluativo',
        'ano_lectivo',
        'configuracion_calificacion'
      ];

      // Borrar datos de cada tabla para el usuario actual
      for (const table of tables) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('user_id', userId);
        
        if (error) {
          // Si la tabla no existe en la caché de Supabase, la ignoramos ya que no hay nada que limpiar
          if (error.message?.includes('Could not find the table') || error.code === 'PGRST116') {
            console.warn(`Tabla ${table} no encontrada en Supabase, omitiendo limpieza.`);
            continue;
          }
          console.error(`Error borrando tabla ${table}:`, error);
          throw new Error(`Fallo al limpiar la nube: ${error.message}`);
        }
      }
    })(), 'limpieza de la nube');
  }
};
