import { supabase, saveSupabaseConfig, clearSupabaseConfig, getSupabaseClient, destroyClient } from './supabase';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { syncManager } from './tursoSyncService';
import { getSupabaseErrorMessage, isMissingTableError } from './supabaseSchema';

export type { SyncStatus } from './tursoSyncService';

const withSupabaseSchemaRecovery = async <T,>(
  operation: () => Promise<T>,
  context: string,
  tables: string[] = []
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = getSupabaseErrorMessage(error);
      const isMissing = isMissingTableError(error) || tables.some((table) => message.includes(table));
      if (!isMissing || attempt >= 2) {
        throw error;
      }

      console.warn(`[Supabase] ${context} falló por tabla/schema no disponible; reintentando en ${400 * (attempt + 1)}ms...`, error);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 400 * (attempt + 1)));
      const schemaResult = await syncService.ensureSchema();
      if (!schemaResult.ok) {
        throw new Error(schemaResult.error || 'No se pudo preparar el schema de Supabase.');
      }
    }
  }

  throw lastError;
};

const isTableUnavailableError = (error: unknown) => {
  const message = getSupabaseErrorMessage(error);
  return isMissingTableError(error) || /404|not found|relation .* does not exist/i.test(message);
};

const logPgError = (context: string, error: unknown) => {
  const e = error as Record<string, unknown>;
  console.error(`[Supabase] ${context}:`, {
    code: String(e?.code ?? 'N/A'),
    message: String(e?.message ?? 'N/A'),
    details: String(e?.details ?? 'N/A'),
    hint: String(e?.hint ?? 'N/A'),
  });
};

const getSchemaBootstrapError = (reason?: string) => {
  const detail = reason ? `\n\nDetalle: ${reason}` : '';
  return `No se pudo preparar el schema de Supabase. El proyecto remoto no expone las tablas esperadas o la conexión de Postgres no está disponible.${detail}\n\nAcciones recomendadas:\n1. Verifica que el proyecto de Supabase correcto esté activo.\n2. Crea el schema manualmente en el SQL Editor de Supabase.\n3. Si usas conexión directa, pega un connection string completo de Postgres en Ajustes → Nube.`;
};

/**
 * Construye la LISTA de connection strings de Postgres a probar, en orden:
 *   1. El valor tal cual si el usuario pegó el connection string completo.
 *   2. Conexión directa: postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *   3. Connection pooler por región: postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres
 * Devuelve null si no hay password configurado.
 */
export const getSupabaseConnStrings = (): string[] | null => {
  const url =
    (typeof localStorage !== 'undefined' &&
      (localStorage.getItem('supabase_url') || localStorage.getItem('sbUrl'))) ||
    import.meta.env.VITE_SUPABASE_URL ||
    '';
  const raw =
    (typeof localStorage !== 'undefined' && localStorage.getItem('sbDbPassword')) ||
    import.meta.env.VITE_SUPABASE_DB_PASSWORD ||
    '';

  if (!raw) return null;

  // Si el usuario pegó el connection string completo, usarlo directamente.
  if (/^postgres(ql)?:\/\//.test(raw.trim())) {
    return [raw.trim()];
  }

  if (!url) return null;
  const match = url.match(/https?:\/\/([^.]+)\.supabase\.(co|in)/);
  if (!match) return null;

  const projectRef = match[1];
  const pw = encodeURIComponent(raw);
  // Pooler regions IPv4 (formato correcto: aws-<region>.pooler.supabase.com)
  const poolerRegions = [
    'aws-0-us-east-1',
    'aws-0-us-west-1',
    'aws-0-eu-west-1',
    'aws-0-us-east-2',
  ];
  const poolers = poolerRegions.map(
    (r) => `postgresql://postgres.${projectRef}:${pw}@${r}.pooler.supabase.com:6543/postgres?sslmode=require`
  );
  // Conexión directa (IPv6-only en algunos hosts; fallback)
  const direct = `postgresql://postgres:${pw}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
  return [...poolers, direct];
};

/**
 * Servicio de sincronización (Local <-> Supabase)
 * Estrategia: "Local-First". Los cambios se hacen en SQLite primero
 * y luego se intentan replicar en la nube (Supabase).
 */

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
    // Primero intentar obtener el usuario autenticado de Supabase Auth
    try {
      const client = getSupabaseClient();
      if (client) {
        const { data: { user } } = await client.auth.getUser();
        if (user?.id) return user.id;
      }
    } catch (e) {
      // Ignorar errores, fallback a device UUID
    }
    // Fallback: device UUID para compatibilidad hacia atrás
    if (typeof localStorage === 'undefined') return 'local-device';
    let id = localStorage.getItem('sb_device_user_id') ?? '';
    if (!id) {
      id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
        ? (crypto as any).randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('sb_device_user_id', id);
    }
    return id;
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
          syncItem.activo = Number(data.activo);
        }
      }
      if (data.cualitativo !== undefined && data.cualitativo !== null) {
        syncItem.cualitativo = Number(data.cualitativo);
      }

      const { error } = await supabase
        .from(table)
        .upsert(syncItem, { onConflict: 'id' });

      if (error) throw error;
    })(), `${syncService.getTableName(table)} ${isNew ? 'nuevo' : 'actualizado'}: ${data.nombre}`);
  },

  deleteGlobal: async (table: string, id: number) => {
    syncManager.wrapSync((async () => {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      // Si el borrado en la nube fue exitoso, eliminamos de pendientes (si existiera)
      await invoke("remove_pending_deletion_by_record", { tabla: table, id: Number(id) }).catch(e => console.error("Error clearing pending deletion:", e));
    })(), `${syncService.getTableName(table)} eliminado`);
  },

  /**
   * Procesa las eliminaciones que quedaron pendientes por falta de conexión
   */
  syncPendingDeletions: async () => {
    try {
      const pending = await invoke<any[]>("get_pending_deletions");
      if (pending.length === 0) return;

      console.log(`[syncService] Procesando ${pending.length} eliminaciones pendientes...`);

      for (const item of pending) {
        try {
          if (item.tabla === 'sync_deletions' || item.tabla === 'sync_batch') {
            await invoke("remove_pending_deletion", { id: item.id });
            continue;
          }

          let query = supabase.from(item.tabla).delete();

          // Tablas sin columna 'id' — usar su clave real
          if (item.tabla === 'colegio_dias_asistencia') {
            query = query.eq('colegio_id', item.registroId);
          } else {
            query = query.eq('id', item.registroId);
          }

          const { error } = await query;

          // Si el error es null (éxito), PGRST116 (ya no existe) o 404 de tabla ausente,
          // limpiamos el pendiente local para no quedar bloqueados.
          if (!error || error.code === 'PGRST116' || isTableUnavailableError(error)) {
            await invoke("remove_pending_deletion", { id: item.id });
          } else {
            console.error(`[syncService] Error sincronizando eliminación pendiente de ${item.tabla}:${item.registroId} ->`, error?.message || error?.code || error);
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
            ...(table === 'ano_lectivo' || table === 'corte_evaluativo' || table === 'indicador' ? { activo: Number(item.activo) } : {}),
            ...(item.cualitativo !== undefined ? { cualitativo: Number(item.cualitativo) } : {})
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
          activo: Number(indicador.activo),
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
          puntaje_maximo: Math.round(criterio.puntajeMaximo),
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
                ...(grado.cualitativo !== undefined ? { cualitativo: Number(grado.cualitativo) } : {})
              }, { onConflict: 'id' });
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
                ...(asignatura.cualitativo !== undefined ? { cualitativo: Number(asignatura.cualitativo) } : {})
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
                activo: Number(corte.activo),
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
            activo: Number(ind.activo),
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
            puntaje_maximo: Math.round(crit.puntajeMaximo),
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
          onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id',
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
          onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id' 
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
        }, { onConflict: 'estudiante_id,fecha' }); // Esta se mantiene por su UNIQUE compuesto

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
        .upsert(batchAsistencia, { onConflict: 'estudiante_id,fecha' });

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
        }, { onConflict: 'id' });

      if (error) throw error;
    })(), 'Configuración de Notas');
  },

  /**
   * Sincronización Inicial Completa
   * Sincroniza todos los datos en el orden correcto para respetar las Foreign Keys
   */
  _schemaEnsured: false,

  diagnoseRemote: async () => {
    const client = getSupabaseClient();
    if (!client) { console.warn('[Diagnóstico] Supabase no configurado'); return; }
    const allTables = [
      'ano_lectivo','corte_evaluativo','colegio','asignatura','grado','seccion',
      'estudiante','configuracion_calificacion','multiplicador_calificacion','grado_asignatura','colegio_asignatura',
      'indicador','criterio','colegio_dias_asistencia','asistencia','nota',
    ];
    console.group('[Diagnóstico Supabase]');
    for (const table of allTables) {
      const { count: exact, error } = await client.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        console.warn(`  ❌ ${table}: NO DISPONIBLE (${error.code || error.message})`);
      } else {
        console.log(`  ✅ ${table}: ${exact ?? '?'} registros`);
      }
    }
    console.groupEnd();
  },

  syncAll: async () => {
    await syncManager.wrapSync((async () => {
      if (!syncService._schemaEnsured) {
        const schemaResult = await syncService.ensureSchema();
        if (!schemaResult.ok) {
          syncService._schemaEnsured = false;
          throw new Error(schemaResult.error || 'No se pudo preparar el schema remoto de Supabase.');
        }
        syncService._schemaEnsured = true;
      }

      const userId = await syncService.getUserId();
      if (!userId) throw new Error("Debes estar conectado para sincronizar");

      // Diagnóstico: mostrar estado del schema remoto antes de sincronizar
      await syncService.diagnoseRemote();

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
              syncItem.activo = Number(item.activo);
            }
          }
          if (item.cualitativo !== undefined && item.cualitativo !== null) {
            syncItem.cualitativo = Number(item.cualitativo);
          }
          return syncItem;
        });

        const { error } = await supabase.from(table).upsert(batchData, { onConflict: 'id' });
        if (error) {
          const pgError = error as unknown as Record<string, unknown>;
          const isDuplicate = String(pgError?.code) === '23505' || String(pgError?.code) === '409';
          if (isDuplicate) {
            console.warn(`[Supabase] Conflicto en ${table} (los datos ya existen). Saltando tabla, pullAll corregirá IDs.`);
            continue;
          }
          logPgError(`Error en tabla base ${table}:`, error);
          throw new Error(`Error en ${syncService.getTableName(table)}: ${getSupabaseErrorMessage(error)}`);
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
          logPgError('Error en estudiantes:', error);
          throw new Error(`Error en Estudiantes: ${getSupabaseErrorMessage(error)}`);
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
            onConflict: 'grado_id,asignatura_id' 
          });
          if (error) logPgError('Error sincronizando grado_asignatura:', error);
        }
      } catch (e) {
        logPgError('No se pudo sincronizar grado_asignatura:', e);
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
            onConflict: 'colegio_id,asignatura_id' 
          });
          if (error) logPgError('Error sincronizando colegio_asignatura:', error);
        }
      } catch (e) {
        logPgError('No se pudo sincronizar colegio_asignatura:', e);
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
          activo: Number(i.activo),
          user_id: userId
        }));

        const { error } = await supabase.from('indicador').upsert(batchIndicadores, { onConflict: 'id' });
        if (error) {
          logPgError('Error en indicadores:', error);
          throw new Error(`Error en Indicadores: ${getSupabaseErrorMessage(error)}`);
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
          puntaje_maximo: Math.round(c.puntajeMaximo),
          user_id: userId
        }));

        const { error } = await supabase.from('criterio').upsert(batchCriterios, { onConflict: 'id' });
        if (error) {
          logPgError('Error en criterios:', error);
          throw new Error(`Error en Criterios: ${getSupabaseErrorMessage(error)}`);
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
          onConflict: 'estudiante_id,criterio_id,corte_evaluativo_id,asignatura_id' 
        });
        if (error) {
          logPgError('Error en notas:', error);
          throw new Error(`Error en Notas: ${getSupabaseErrorMessage(error)}`);
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
          onConflict: 'estudiante_id,fecha' 
        });
        if (error) {
          logPgError('Error en asistencia:', error);
          throw new Error(`Error en Asistencia: ${getSupabaseErrorMessage(error)}`);
        }
      }

      // 7. Configuración de Calificaciones
      const gradeConfigs = await invoke<any[]>("get_grade_configs");
      if (gradeConfigs && gradeConfigs.length > 0) {
        const batchConfigs = gradeConfigs.map(gc => ({
          id: gc.id,
          nombre: gc.nombre,
          color: gc.color,
          minimo: gc.minimo,
        }));

        const { error } = await supabase.from('configuracion_calificacion').upsert(batchConfigs, { 
          onConflict: 'id' 
        });
        if (error) {
          logPgError('Error en configuracion_calificacion:', error);
          throw new Error(`Error en Configuración de Notas: ${getSupabaseErrorMessage(error)}`);
        }
      }

      // 7b. Multiplicadores de Criterios
      const multiplicadores = await invoke<any[]>("get_multiplicadores");
      if (multiplicadores && multiplicadores.length > 0) {
        const batchMultiplicadores = multiplicadores.map(m => ({
          id: m.id,
          multiplicador: m.multiplicador,
        }));

        // Intentar upsert vía PostgREST
        const { error: pgError } = await supabase.from('multiplicador_calificacion').upsert(batchMultiplicadores, { 
          onConflict: 'id' 
        });
        if (!pgError) {
          console.log(`[Multiplicador] Upsert exitoso vía PostgREST`);
        } else {
          logPgError('Error en multiplicador_calificacion (vía PostgREST):', pgError);
          // Fallback: SQL directo (bypass PostgREST schema cache)
          const escapeSql = (s: string) => `'${s.replace(/'/g, "''")}'`;
          const values = batchMultiplicadores.map(m => `(${escapeSql(m.id)}, ${m.multiplicador})`).join(',');
          const sql = `INSERT INTO multiplicador_calificacion (id, multiplicador) VALUES ${values} ON CONFLICT (id) DO UPDATE SET multiplicador = EXCLUDED.multiplicador;`;
          const connStrings = getSupabaseConnStrings();
          let sqlOk = false;
          if (connStrings && connStrings.length > 0) {
            try {
              await invoke('supabase_execute_sql', { connectionStrings: connStrings, sql });
              console.log(`[Multiplicador] Upsert exitoso vía SQL directo`);
              sqlOk = true;
            } catch (_directError) { /* intentar RPC */ }
          }
          if (!sqlOk) {
            // Fallback a RPC exec_sql
            try {
              const { error: rpcError } = await supabase.rpc('exec_sql', { sql });
              if (rpcError) throw rpcError;
              console.log(`[Multiplicador] Upsert exitoso vía RPC exec_sql`);
              sqlOk = true;
            } catch (rpcError) {
              throw new Error(`Error en Multiplicadores: ${getSupabaseErrorMessage(rpcError || pgError)}`);
            }
          }
        }
      }

      // 8. Días de Asistencia por Colegio
      try {
        const colegioDias = await invoke<any[]>("get_colegio_dias_asistencia_all");
        if (colegioDias && colegioDias.length > 0) {
          const batchDias = colegioDias.map(cd => ({
            colegio_id: cd.colegioId,
            lunes: Number(cd.lunes),
            martes: Number(cd.martes),
            miercoles: Number(cd.miercoles),
            jueves: Number(cd.jueves),
            viernes: Number(cd.viernes),
            sabado: Number(cd.sabado),
            domingo: Number(cd.domingo),
            user_id: userId
          }));

          const { error } = await supabase.from('colegio_dias_asistencia').upsert(batchDias, { 
            onConflict: 'colegio_id' 
          });
          if (error) {
            logPgError('Error en colegio_dias_asistencia:', error);
            throw new Error(`Error en Días de Asistencia: ${getSupabaseErrorMessage(error)}`);
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
      if (!syncService._schemaEnsured) {
        const schemaResult = await syncService.ensureSchema();
        if (!schemaResult.ok) {
          syncService._schemaEnsured = false;
          throw new Error(schemaResult.error || 'No se pudo preparar el schema remoto de Supabase.');
        }
        syncService._schemaEnsured = true;
      }
      console.log(`[Sync] Iniciando wrapSync`);
      const userId = await syncService.getUserId();
      console.log(`[Sync] User ID obtenido:`, userId);
      if (!userId) throw new Error("Debes estar conectado para descargar datos");

      // 0. Procesar eliminaciones pendientes antes de descargar datos
      await syncService.syncPendingDeletions();

      console.log(`[Sync] Iniciando descarga de datos desde Supabase (sin filtro user_id)`);

      let pullData: any;

      // Usar Supabase
      const tables = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'estudiante', 'indicador', 'criterio', 'nota', 'asistencia',
        'configuracion_calificacion', 'multiplicador_calificacion',
        'grado_asignatura', 'colegio_asignatura', 'colegio_dias_asistencia'
      ];

      console.log(`[Sync] Consultando tablas (sin filtro user_id)`);

      const results = await withSupabaseSchemaRecovery(async () => {
        const queryResults = await Promise.all(
          tables.map(table => {
            console.log(`[Sync] Consultando ${table}...`);
            return supabase.from(table).select('*', { count: 'exact' }).limit(100000);
          })
        );

        const errors = queryResults.filter(r => r.error).map(r => r.error);
        if (errors.length > 0) {
          const errorDetails = errors.map(e => e?.message).join(', ');
          console.error('[Sync] Errores en consultas:', errors);
          throw new Error(`Error descargando datos: ${errorDetails}`);
        }

        return queryResults;
      }, 'descarga de datos desde Supabase', tables);

      const [
        anos, cortes, colegios, asignaturas, grados, secciones,
        estudiantes, indicadores, criterios, notas, asistencia,
        gradeConfigs, multiplicadores,
        gradoAsignatura, colegioAsignatura, colegioDiasAsistencia
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
        multiplicadores: multiplicadores?.length || 0,
        gradoAsignatura: gradoAsignatura?.length || 0,
        colegioAsignatura: colegioAsignatura?.length || 0,
        colegioDiasAsistencia: colegioDiasAsistencia?.length || 0
      });

      // 2. Mapear datos al formato esperado por Rust
      pullData = {
          anos: (anos || []).map(a => ({ id: a.id, nombre: a.nombre, activo: Boolean(a.activo), cualitativo: Boolean(a.cualitativo) })),
          cortes: (cortes || []).map(c => ({ id: c.id, nombre: c.nombre, activo: Boolean(c.activo), cualitativo: Boolean(c.cualitativo) })),
          colegios: (colegios || []).map(c => ({ id: c.id, nombre: c.nombre, activo: Boolean(c.activo), cualitativo: Boolean(c.cualitativo) })),
          asignaturas: (asignaturas || []).map(a => ({ id: a.id, nombre: a.nombre, cualitativo: Boolean(a.cualitativo) })),
          grados: (grados || []).map(g => ({ id: g.id, nombre: g.nombre, cualitativo: Boolean(g.cualitativo) })),
          secciones: (secciones || []).map(s => ({ id: s.id, nombre: s.nombre, cualitativo: Boolean(s.cualitativo) })),
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
            email: e.email,
            foto: e.foto
          })),
          indicadores: (indicadores || []).map(i => ({
            id: i.id,
            gradoId: i.grado_id,
            asignaturaId: i.asignatura_id,
            corteEvaluativoId: i.corte_evaluativo_id,
            orden: i.orden,
            descripcion: i.descripcion,
          activo: Boolean(i.activo),
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
            nombre: gc.nombre,
            color: gc.color,
            minimo: gc.minimo
          })),
          multiplicadores: (multiplicadores || []).map(m => ({
            id: m.id,
            multiplicador: m.multiplicador,
          })),
          gradoAsignatura: (gradoAsignatura || []).map(ga => [ga.grado_id, ga.asignatura_id]),
          colegioAsignatura: (colegioAsignatura || []).map(ca => [ca.colegio_id, ca.asignatura_id]),
          colegioDiasAsistencia: (colegioDiasAsistencia || []).map(cda => ({
            colegioId: cda.colegio_id,
            lunes: Boolean(cda.lunes),
            martes: Boolean(cda.martes),
            miercoles: Boolean(cda.miercoles),
            jueves: Boolean(cda.jueves),
            viernes: Boolean(cda.viernes),
            sabado: Boolean(cda.sabado),
            domingo: Boolean(cda.domingo)
          }))
        };

      // 3. Enviar a Rust para upsert masivo en SQLite
      console.log(`[Sync] 🚀 Enviando a upsert_pull_data:`, {
        anos: pullData.anos?.length || 0,
        cortes: pullData.cortes?.length || 0,
        colegios: pullData.colegios?.length || 0,
        asignaturas: pullData.asignaturas?.length || 0,
        grados: pullData.grados?.length || 0,
        secciones: pullData.secciones?.length || 0,
        estudiantes: pullData.estudiantes?.length || 0,
        indicadores: pullData.indicadores?.length || 0,
        criterios: pullData.criterios?.length || 0,
        notas: pullData.notas?.length || 0,
        asistencia: pullData.asistencia?.length || 0,
        gradeConfigs: pullData.gradeConfigs?.length || 0,
        multiplicadores: pullData.multiplicadores?.length || 0,
        gradoAsignatura: pullData.gradoAsignatura?.length || 0,
        colegioAsignatura: pullData.colegioAsignatura?.length || 0,
        colegioDiasAsistencia: pullData.colegioDiasAsistencia?.length || 0,
      });
      try {
        await invoke('upsert_pull_data', { data: pullData });
        console.log(`[Sync] ✅ upsert_pull_data completado sin errores`);
      } catch (e) {
        console.error(`[Sync] ❌ upsert_pull_data falló:`, e);
        throw e;
      }
      // Notificar a la UI que los datos cambiaron
      try { await emit("catalog-updated"); } catch {}
      try { await emit("student-updated", { timestamp: Date.now() }); } catch {}
      try { await emit("notas-updated", { timestamp: Date.now() }); } catch {}
      try { await emit("asistencia-updated"); } catch {}
      try { await emit("grade-configs-updated"); } catch {}
      try { await emit("subjects-updated"); } catch {}
      console.log(`[Sync] 📢 Eventos de actualización emitidos`);
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
            onConflict: 'colegio_id,asignatura_id'
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
            onConflict: 'grado_id,asignatura_id'
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
        'configuracion_calificacion',
        'multiplicador_calificacion',
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
  },

  // ========================
  // Interface methods (compat con TursoSyncService)
  // ========================

  _syncLock: false,
  _periodicTimer: null as ReturnType<typeof setInterval> | null,
  _connectivityInitialized: false,

  testConnection: async (url?: string, anonKey?: string): Promise<{ ok: boolean; latency: number; error?: string }> => {
    if (url && anonKey) {
      saveSupabaseConfig(url, anonKey);
    }
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, latency: 0, error: 'No hay configuración de Supabase' };
    }
    try {
      const start = performance.now();
      const { data, error } = await client.auth.getUser();
      const latency = Math.round(performance.now() - start);
      if (error) {
        // Maybe the config is wrong
        return { ok: false, latency, error: error.message };
      }
      return { ok: !!data.user, latency };
    } catch (e: any) {
      return { ok: false, latency: 0, error: e?.message || String(e) };
    }
  },

  connectAndSetup: async (url: string, anonKey: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      saveSupabaseConfig(url, anonKey);
      destroyClient();
      const test = await (syncService as any).testConnection(url, anonKey);
      if (!test.ok) {
        clearSupabaseConfig();
        return { ok: false, error: test.error || 'Error de conexión' };
      }
      return { ok: true };
    } catch (e: any) {
      clearSupabaseConfig();
      return { ok: false, error: e?.message || String(e) };
    }
  },

  disconnect: () => {
    syncService.stopPeriodicSync();
    clearSupabaseConfig();
    destroyClient();
    syncManager.setState({ status: 'idle', lastSync: null, message: null });
  },

  ensurePeriodicSync: () => {
    const client = getSupabaseClient();
    if (client && !(syncService as any)._periodicTimer) {
      syncService.startPeriodicSync();
    }
  },

  startPeriodicSync: () => {
    const intervalStr = localStorage.getItem('periodic_sync_interval_seconds');
    const interval = Math.max(30, Math.min(300, parseInt(intervalStr || '60') || 60)) * 1000;
    const client = getSupabaseClient();
    if (!client) return;
    if ((syncService as any)._periodicTimer) clearInterval((syncService as any)._periodicTimer);
    (syncService as any)._periodicTimer = setInterval(async () => {
      const c = getSupabaseClient();
      if (!c) {
        syncService.stopPeriodicSync();
        return;
      }
      syncManager.setState({ status: 'syncing', message: 'Sync automático...' });
      await syncService.syncAllSilent(false);
      try { await emit("notas-updated", { timestamp: Date.now() }); } catch {}
      try { await emit("asistencia-updated"); } catch {}
      syncManager.setState({ status: 'idle', message: null });
    }, interval);
  },

  stopPeriodicSync: () => {
    if ((syncService as any)._periodicTimer) {
      clearInterval((syncService as any)._periodicTimer);
      (syncService as any)._periodicTimer = null;
    }
  },

  forcePushAll: async (): Promise<void> => {
    await syncService.syncAll();
  },

  syncAllSilent: async (dispatchEvents: boolean = true): Promise<void> => {
    while ((syncService as any)._syncLock) {
      await new Promise(r => setTimeout(r, 500));
    }
    (syncService as any)._syncLock = true;
    try {
      await syncService.syncAll();
      await syncService.pullAll();
      syncManager.setState({
        lastSync: new Date().toISOString(),
        lastSyncDetails: `Sync completo (${new Date().toLocaleTimeString()})`,
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
    } catch (e) {
      console.warn('[Supabase SyncAllSilent] Error:', e);
    } finally {
      (syncService as any)._syncLock = false;
    }
  },

  ensureSchema: async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const client = getSupabaseClient();
      if (!client) return { ok: false, error: 'Supabase no configurado' };

      const allTables = [
        'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
        'estudiante', 'configuracion_calificacion', 'multiplicador_calificacion',
        'grado_asignatura', 'colegio_asignatura',
        'indicador', 'criterio', 'colegio_dias_asistencia', 'asistencia', 'nota',
        'sync_deletions', 'sync_batch',
      ];

      // Probar tablas vía PostgREST (el cliente JS, no SQL directo).
      // El usuario debe haber creado las tablas manualmente en Supabase SQL Editor.
      const probeTablePostgrest = async (tableName: string) => {
        const { error } = await client.from(tableName).select('*', { count: 'estimated', head: false }).limit(1);
        if (!error) return true;
        // Si el error es de tabla faltante, devolver false
        if (/PGRST205|could not find|not found|relation .* does not exist/i.test(String(error.message || error.code))) return false;
        return true; // asumir que existe si el error no es de tabla faltante
      };

      const runSqlStatements = async (sqlStatements: string[], critical: boolean = true) => {
        const connStrings = getSupabaseConnStrings();
        if (!connStrings || connStrings.length === 0) {
          if (!critical) return true;
          throw new Error('No hay conexión de Postgres configurada.');
        }
        for (const sql of sqlStatements) {
          try {
            await invoke('supabase_execute_sql', { connectionStrings: connStrings, sql });
          } catch (error) {
            if (critical) throw new Error(getSupabaseErrorMessage(error));
            console.info('[Supabase] Ajuste SQL omitido:', getSupabaseErrorMessage(error));
            return true;
          }
        }
        return true;
      };

      const DDL_SCRIPT = `CREATE TABLE IF NOT EXISTS ano_lectivo (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS corte_evaluativo (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS colegio (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS asignatura (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS grado (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS seccion (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, cualitativo INTEGER DEFAULT 0, user_id TEXT);
CREATE TABLE IF NOT EXISTS estudiante (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, codigo TEXT NOT NULL, sexo TEXT NOT NULL, ano_lectivo_id INTEGER NOT NULL, grado_id INTEGER NOT NULL, seccion_id INTEGER NOT NULL, colegio_id INTEGER NOT NULL, telefono TEXT, direccion TEXT, email TEXT, foto TEXT, user_id TEXT);
CREATE TABLE IF NOT EXISTS configuracion_calificacion (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, color TEXT NOT NULL, minimo INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS multiplicador_calificacion (id TEXT PRIMARY KEY, multiplicador REAL NOT NULL DEFAULT 1.0);
CREATE TABLE IF NOT EXISTS grado_asignatura (grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, user_id TEXT, PRIMARY KEY (grado_id, asignatura_id));
CREATE TABLE IF NOT EXISTS colegio_asignatura (colegio_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, user_id TEXT, PRIMARY KEY (colegio_id, asignatura_id));
CREATE TABLE IF NOT EXISTS indicador (id SERIAL PRIMARY KEY, grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, corte_evaluativo_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', activo INTEGER DEFAULT 1, user_id TEXT);
CREATE TABLE IF NOT EXISTS criterio (id SERIAL PRIMARY KEY, indicador_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', puntaje_maximo INTEGER NOT NULL, user_id TEXT);
CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (colegio_id INTEGER PRIMARY KEY, lunes INTEGER DEFAULT 1, martes INTEGER DEFAULT 1, miercoles INTEGER DEFAULT 1, jueves INTEGER DEFAULT 1, viernes INTEGER DEFAULT 1, sabado INTEGER DEFAULT 1, domingo INTEGER DEFAULT 1, user_id TEXT);
CREATE TABLE IF NOT EXISTS asistencia (id SERIAL PRIMARY KEY, estudiante_id INTEGER NOT NULL, fecha TEXT NOT NULL, estado TEXT NOT NULL, observacion TEXT, user_id TEXT, UNIQUE(estudiante_id, fecha));
CREATE TABLE IF NOT EXISTS nota (estudiante_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, valor DOUBLE PRECISION NOT NULL, corte_evaluativo_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, user_id TEXT, PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id));
CREATE TABLE IF NOT EXISTS sync_deletions (id SERIAL PRIMARY KEY, table_name TEXT NOT NULL, record_id INTEGER NOT NULL, deleted_at TEXT DEFAULT now()::text, user_id TEXT);
CREATE TABLE IF NOT EXISTS sync_batch (id SERIAL PRIMARY KEY, table_name TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL, user_id TEXT, created_at TEXT DEFAULT now()::text);
ALTER TABLE grado ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE seccion ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE criterio ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE grado_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE colegio_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE colegio_dias_asistencia ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE ano_lectivo DISABLE ROW LEVEL SECURITY;
ALTER TABLE corte_evaluativo DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio DISABLE ROW LEVEL SECURITY;
ALTER TABLE asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE grado DISABLE ROW LEVEL SECURITY;
ALTER TABLE seccion DISABLE ROW LEVEL SECURITY;
ALTER TABLE estudiante DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_calificacion DISABLE ROW LEVEL SECURITY;
ALTER TABLE multiplicador_calificacion DISABLE ROW LEVEL SECURITY;
ALTER TABLE grado_asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio_asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE indicador DISABLE ROW LEVEL SECURITY;
ALTER TABLE criterio DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio_dias_asistencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE asistencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE nota DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_deletions DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_batch DISABLE ROW LEVEL SECURITY;`;

      // 1. Ver si las tablas existen vía PostgREST
      const tablesExist = await probeTablePostgrest('ano_lectivo');

      if (tablesExist) {
        console.log('[Supabase] Tablas existentes visibles en PostgREST. Ejecutando fixes best-effort...');
        // Si la conexión directa está disponible, aplicar idempotent fixes.
        const fixSqls = [
          'ALTER TABLE grado ADD COLUMN IF NOT EXISTS user_id TEXT;',
          'ALTER TABLE seccion ADD COLUMN IF NOT EXISTS user_id TEXT;',
          'ALTER TABLE asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;',
          'ALTER TABLE criterio ADD COLUMN IF NOT EXISTS user_id TEXT;',
          'ALTER TABLE grado_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;',
          'ALTER TABLE colegio_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;',
          'ALTER TABLE colegio_dias_asistencia ADD COLUMN IF NOT EXISTS user_id TEXT;',
          ...allTables.map((t) => `ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`),
        ];
        await runSqlStatements(fixSqls, false);
        // Crear tablas nuevas que aún no existan en el schema (ej. multiplicador_calificacion)
        for (const table of allTables) {
          const exists = await probeTablePostgrest(table);
          if (!exists) {
            console.log(`[Supabase] Tabla '${table}' no existe — creando...`);
            const createSql = DDL_SCRIPT.split(';').filter(s => s.trim() && s.toLowerCase().includes(`create table ${table}`));
            if (createSql.length > 0) {
              // Intentar vía directa (critical=false para no bloquear)
              try { await runSqlStatements(createSql, false); } catch (_e) { /* ignorar */ }
              // Fallback a RPC exec_sql
              try {
                const { error: rpcErr } = await client.rpc('exec_sql', { sql: createSql.join(';') });
                if (rpcErr) console.warn(`[Supabase] RPC exec_sql falló para '${table}':`, rpcErr);
              } catch (_e2) { /* ignorar */ }
            }
          }
        }
        // Refrescar schema cache de PostgREST (inofensivo si no se creó nada)
        try { await runSqlStatements(["NOTIFY pgrst, 'reload schema';"], false); } catch (_e) { /* ignorar */ }
        try { await client.rpc('exec_sql', { sql: "NOTIFY pgrst, 'reload schema';" }); } catch (_e) { /* ignorar */ }
        // Esperar que PostgREST reconozca todas las tablas
        for (let attempt = 0; attempt < 5; attempt++) {
          const allOk = (await Promise.all(allTables.map(t => probeTablePostgrest(t)))).every(Boolean);
          if (allOk) break;
          await new Promise((resolve) => globalThis.setTimeout(resolve, 1500));
        }
        // Verificar que las tablas realmente existen (probe con limit 1, no head)
        const missingTables: string[] = [];
        for (const table of allTables) {
          const { error } = await client.from(table).select('*', { count: 'estimated', head: false }).limit(1);
          if (error && /PGRST205|could not find|not found|relation .* does not exist/i.test(String(error.message || error.code))) {
            missingTables.push(table);
          }
        }
        if (missingTables.length > 0) {
          const ddlParts = missingTables.map(t => {
            const stmt = DDL_SCRIPT.split(';').filter(s => s.trim() && new RegExp(`create table ${t}\\b`, 'i').test(s));
            return stmt.length > 0 ? stmt[0].trim() + ';' : null;
          }).filter(Boolean);
          const alterRls = missingTables.map(t => `ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`).join('\n');
          const manualSql = ddlParts.join('\n') + '\n' + alterRls;
          return {
            ok: false,
            error: `No se pudieron crear las tablas: ${missingTables.join(', ')}. En Android no es posible la conexión directa a Postgres (IPv6) ni el pooler reconoce tu proyecto.\n\nPara solucionarlo, pega esto en Supabase Dashboard → SQL Editor:\n\n${manualSql}\n\nDespués vuelve a sincronizar.`
          };
        }
        return { ok: true };
      }

      // 2. Tablas no existen — intentar crearlas vía SQL directo
      console.log('[Supabase] Tablas no encontradas. Intentando crear vía SQL directo...');
      const createTablesSqls = DDL_SCRIPT.split(';').filter(s => s.trim()).map(s => s.trim() + ';');
      try {
        await runSqlStatements(createTablesSqls);
        console.log('[Supabase] Schema creado vía SQL directo.');
        await runSqlStatements(["NOTIFY pgrst, 'reload schema';"], false);
      } catch (directError) {
        // 3. SQL directo falló — intentar via RPC exec_sql
        console.log('[Supabase] SQL directo falló. Intentando vía RPC exec_sql...');
        try {
          for (const sql of createTablesSqls) {
            const { error: rpcError } = await client.rpc('exec_sql', { sql });
            if (rpcError && !rpcError.message?.includes('already exists')) throw rpcError;
          }
          console.log('[Supabase] Schema creado vía RPC exec_sql.');
          await client.rpc('exec_sql', { sql: "NOTIFY pgrst, 'reload schema';" });
        } catch (rpcError: any) {
          const rpcMsg = getSupabaseErrorMessage(rpcError);
          const isMissingRpc = /function.*exec_sql.*does not exist/i.test(rpcMsg);
          if (isMissingRpc) {
            // 4. RPC no existe — pedir al usuario crear la función una vez
            return {
              ok: false,
              error: `${getSchemaBootstrapError(rpcMsg)}\n\nPara habilitar la creación automática de tablas, pega esto en Supabase Dashboard → SQL Editor UNA SOLA VEZ:\n\nCREATE OR REPLACE FUNCTION exec_sql(sql text)\nRETURNS void AS $$\nBEGIN\n  EXECUTE sql;\nEND;\n$$ LANGUAGE plpgsql SECURITY DEFINER;\n\nDespués vuelve a intentar sincronizar.\n\nSi prefieres crear las tablas manualmente, usa este script:\n\n${DDL_SCRIPT}`,
            };
          }
          // 5. RPC también falló — devolver error con el script
          return {
            ok: false,
            error: `${getSchemaBootstrapError(rpcMsg)}\n\n-----\nCopia y pega este script en Supabase Dashboard → SQL Editor:\n\n${DDL_SCRIPT}`,
          };
        }
      }

      // 4. Esperar que PostgREST reconozca las tablas (creadas vía SQL directo)
      for (let attempt = 0; attempt < 5; attempt++) {
        const ok = await probeTablePostgrest('ano_lectivo');
        if (ok) return { ok: true };
        await new Promise((resolve) => globalThis.setTimeout(resolve, 1500));
      }

      return {
        ok: false,
        error: getSchemaBootstrapError('Las tablas se crearon en Postgres pero PostgREST no las ve. Espera unos segundos y vuelve a intentar, o reinicia tu proyecto de Supabase.'),
      };
    } catch (e: any) {
      console.error('[Supabase] ensureSchema exception:', e);
      return { ok: false, error: e?.message || String(e) };
    }
  },
  runSchemaSetup: async (): Promise<{ ok: boolean; error?: string }> => {
    return await syncService.ensureSchema();
  },

  pushAllSilent: async (force: boolean = false): Promise<void> => {
    try {
      await syncService.syncAll();
    } catch (e) {
      console.warn('[Supabase Push Silent] Error:', e);
    }
  },

  pullAllSilent: async (): Promise<void> => {
    try {
      await syncService.pullAll();
    } catch (e) {
      console.warn('[Supabase Pull Silent] Error:', e);
    }
  },
};

// Force pull - traer datos de Supabase y actualizar SQLite local
export const forcePullAsistencia = async (
  fecha: string,
  gradoId: number,
  seccionId: number
): Promise<void> => {
  console.log('[ForcePull] Obteniendo asistencia desde Supabase...');
  
  try {
    const { data: supabaseData, error } = await supabase
      .from('asistencia')
      .select('*')
      .eq('fecha', fecha);

    if (error) {
      console.error('[ForcePull] Error trayendo asistencia:', error);
      return;
    }

    if (supabaseData && supabaseData.length > 0) {
      console.log(`[ForcePull] ${supabaseData.length} registros de asistencia encontrados en Supabase`);
      
      // Convertir al formato esperado por SQLite
      const localData = supabaseData.map(record => ({
        id: record.id,
        estudiante_id: record.estudiante_id,
        fecha: record.fecha,
        estado: record.estado,
        observacion: record.observacion || '',
        user_id: record.user_id
      }));
      
      // Guardar en SQLite usando invoke
      try {
        await invoke('upsert_asistencia_from_cloud', { records: localData });
        console.log('[ForcePull] Asistencia actualizada en SQLite local');
      } catch (e) {
        console.error('[ForcePull] Error guardando en SQLite:', e);
      }
    } else {
      console.log('[ForcePull] No hay asistencia en Supabase para esta fecha');
    }
  } catch (e) {
    console.error('[ForcePull] Error general:', e);
  }
};

// Force pull para notas
export const forcePullNotas = async (
  anoLectivoId: number,
  corteId: number,
  colegioId: number,
  gradoId: number,
  seccionId: number,
  asignaturaId: number
): Promise<void> => {
  console.log('[ForcePull Notas] Obteniendo notas desde Supabase...');
  
  try {
    const { data: supabaseData, error } = await supabase
      .from('nota')
      .select('*')
      .eq('ano_lectivo_id', anoLectivoId)
      .eq('corte_id', corteId)
      .eq('colegio_id', colegioId)
      .eq('grado_id', gradoId)
      .eq('seccion_id', seccionId)
      .eq('asignatura_id', asignaturaId);

    if (error) {
      console.error('[ForcePull Notas] Error:', error);
      return;
    }

    if (supabaseData && supabaseData.length > 0) {
      console.log(`[ForcePull Notas] ${supabaseData.length} registros encontrados`);
      
      try {
        await invoke('upsert_notas_from_cloud', { 
          notas: supabaseData.map(r => ({
            id: r.id,
            estudiante_id: r.estudiante_id,
            indicador_id: r.indicador_id,
            criterio_id: r.criterio_id,
            ano_lectivo_id: r.ano_lectivo_id,
            corte_id: r.corte_id,
            colegio_id: r.colegio_id,
            grado_id: r.grado_id,
            seccion_id: r.seccion_id,
            asignatura_id: r.asignatura_id,
            puntaje: r.puntaje,
            estado: r.estado || 'active'
          }))
        });
        console.log('[ForcePull Notas] Notas actualizadas en SQLite');
      } catch (e) {
        console.error('[ForcePull Notas] Error guardando:', e);
      }
    }
  } catch (e) {
    console.error('[ForcePull Notas] Error general:', e);
  }
};
