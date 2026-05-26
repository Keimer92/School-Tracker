import { supabase, subscribeToTable } from './supabase';
import { syncService } from './syncService';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

/**
 * Servicio para manejar la sincronización en tiempo real desde Supabase hacia SQLite.
 */

let unsubscribers: (() => void)[] = [];

export const realtimeService = {
  /**
   * Inicia las suscripciones a todas las tablas relevantes para el usuario actual.
   */
  init: async (userId: string) => {
    console.log('[Realtime] Inicializando suscripciones para el usuario:', userId);
    
    // Limpiar suscripciones previas si existen
    realtimeService.stop();

    const tables = [
      'ano_lectivo', 
      'corte_evaluativo', 
      'colegio', 
      'asignatura', 
      'grado', 
      'seccion',
      'estudiante', 
      'indicador', 
      'criterio', 
      'nota', 
      'asistencia',
      'configuracion_calificacion',
      'colegio_dias_asistencia'
    ];

    const promises = tables.map(async (table) => {
      console.log(`[Realtime] Intentando suscripción para tabla: ${table}`);
      const unsub = await subscribeToTable(table, async (payload) => {
        console.log(`[Realtime] Cambio detectado en ${table}:`, payload.eventType, payload);
        
        try {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            await applyChangeToLocal(table, payload.new);
          } else if (payload.eventType === 'DELETE') {
            await applyDeletionToLocal(table, payload.old);
          }
          
          // Notificar a la UI que algo cambió
          console.log(`[Realtime] Notificando cambios para tabla: ${table}`);
          if (table === 'asistencia') {
            await emit('asistencia-updated');
          } else if (table === 'nota') {
            await emit('notas-updated');
          } else if (table === 'estudiante') {
            await emit('student-updated');
          } else {
            await emit('catalog-updated');
          }
          
        } catch (error) {
          console.error(`[Realtime] Error aplicando cambio de ${table}:`, error);
        }
      }); // Eliminamos el filtro user_id para depurar y porque RLS ya debería encargarse
      
      return unsub;
    });

    unsubscribers = await Promise.all(promises);
    console.log(`[Realtime] ${unsubscribers.length} tablas suscritas.`);
  },

  /**
   * Detiene todas las suscripciones activas.
   */
  stop: () => {
    if (unsubscribers.length > 0) {
      console.log(`[Realtime] Deteniendo ${unsubscribers.length} suscripciones...`);
      unsubscribers.forEach(unsub => unsub());
      unsubscribers = [];
    }
  }
};

/**
 * Aplica un cambio (INSERT/UPDATE) recibido desde Supabase a la base de datos local SQLite.
 */
async function applyChangeToLocal(table: string, record: any) {
  // Caso especial: Asistencia y Notas tienen comandos dedicados más eficientes
  if (table === 'asistencia') {
    try {
      await invoke('upsert_asistencia_from_cloud', { records: [record] });
      await emit('asistencia-updated');
      return;
    } catch (e) {
      console.error("[Realtime] Error en upsert_asistencia_from_cloud:", e);
    }
  } else if (table === 'nota') {
    try {
      console.log(`[Realtime] Procesando actualización de nota para estudiante ${record.estudiante_id}`);
      // Forzar conversión a números para evitar problemas con JSON de Supabase
      const notaRecord = {
        ...record,
        estudiante_id: Number(record.estudiante_id),
        criterio_id: Number(record.criterio_id),
        asignatura_id: Number(record.asignatura_id),
        puntaje: Number(record.puntaje ?? record.valor),
        corte_id: Number(record.corte_id ?? record.corte_evaluativo_id),
        indicador_id: record.indicador_id ? Number(record.indicador_id) : undefined,
        ano_lectivo_id: record.ano_lectivo_id ? Number(record.ano_lectivo_id) : undefined,
        colegio_id: record.colegio_id ? Number(record.colegio_id) : undefined,
        grado_id: record.grado_id ? Number(record.grado_id) : undefined,
        seccion_id: record.seccion_id ? Number(record.seccion_id) : undefined,
      };

      console.log(`[Realtime] Nota mapeada para Rust:`, notaRecord);
      
      // Asegurar que tenemos los campos mínimos para NotaCloudRecord (Rust)
      if (isNaN(notaRecord.puntaje) || isNaN(notaRecord.corte_id) || !notaRecord.estudiante_id || !notaRecord.criterio_id || !notaRecord.asignatura_id) {
        console.warn("[Realtime] Datos de nota incompletos o inválidos, ignorando:", notaRecord);
        return;
      }

      await invoke('upsert_notas_from_cloud', { notas: [notaRecord] });
      console.log("[Realtime] Nota guardada en SQLite local con éxito");
      await emit('notas-updated');
      return;
    } catch (e) {
      console.error("[Realtime] Error en upsert_notas_from_cloud:", e);
    }
  }

  const pullData: any = {
    anos: [], cortes: [], colegios: [], asignaturas: [], grados: [], secciones: [],
    estudiantes: [], indicadores: [], criterios: [], notas: [], asistencia: [],
    gradeConfigs: [], gradoAsignatura: [], colegioAsignatura: [], colegioDiasAsistencia: [],
    isPartial: true
  };

  // Mapeo de campos según lo que espera Rust en PullData
  if (table === 'ano_lectivo') pullData.anos.push({ id: record.id, nombre: record.nombre, activo: record.activo, cualitativo: record.cualitativo });
  else if (table === 'corte_evaluativo') pullData.cortes.push({ id: record.id, nombre: record.nombre, activo: record.activo, cualitativo: record.cualitativo });
  else if (table === 'colegio') pullData.colegios.push({ id: record.id, nombre: record.nombre, activo: record.activo, cualitativo: record.cualitativo });
  else if (table === 'asignatura') pullData.asignaturas.push({ id: record.id, nombre: record.nombre, cualitativo: record.cualitativo });
  else if (table === 'grado') pullData.grados.push({ id: record.id, nombre: record.nombre, cualitativo: record.cualitativo });
  else if (table === 'seccion') pullData.secciones.push({ id: record.id, nombre: record.nombre, cualitativo: record.cualitativo });
  else if (table === 'estudiante') pullData.estudiantes.push({
    id: record.id,
    nombre: record.nombre,
    codigo: record.codigo,
    sexo: record.sexo,
    anoLectivoId: record.ano_lectivo_id,
    gradoId: record.grado_id,
    seccionId: record.seccion_id,
    colegioId: record.colegio_id,
    telefono: record.telefono,
    direccion: record.direccion,
    email: record.email
  });
  else if (table === 'indicador') pullData.indicadores.push({
    id: record.id,
    gradoId: record.grado_id,
    asignaturaId: record.asignatura_id,
    corteEvaluativoId: record.corte_evaluativo_id,
    orden: record.orden,
    descripcion: record.descripcion,
    activo: record.activo,
    criterios: []
  });
  else if (table === 'criterio') pullData.criterios.push({
    id: record.id,
    indicadorId: record.indicador_id,
    orden: record.orden,
    descripcion: record.descripcion,
    puntajeMaximo: record.puntaje_maximo
  });
  else if (table === 'configuracion_calificacion') pullData.gradeConfigs.push({
    id: record.id,
    color: record.color,
    minimo: record.minimo
  });
  else if (table === 'colegio_dias_asistencia') pullData.colegioDiasAsistencia.push({
    colegioId: record.colegio_id,
    lunes: record.lunes,
    martes: record.martes,
    miercoles: record.miercoles,
    jueves: record.jueves,
    viernes: record.viernes,
    sabado: record.sabado,
    domingo: record.domingo
  });

  // Usar el comando existente de Rust para upsert
  await invoke('upsert_pull_data', { data: pullData });
}

/**
 * Aplica una eliminación recibida desde Supabase a la base de datos local SQLite.
 */
async function applyDeletionToLocal(table: string, oldRecord: any) {
  // Para tablas con claves simples
  let id: any = oldRecord.id;
  
  // Para tablas con claves compuestas
  if (table === 'asistencia') {
    id = { estudianteId: oldRecord.estudiante_id, fecha: oldRecord.fecha };
  } else if (table === 'nota') {
    id = { 
      estudianteId: oldRecord.estudiante_id, 
      criterioId: oldRecord.criterio_id,
      corteId: oldRecord.corte_id ?? oldRecord.corte_evaluativo_id,
      asignaturaId: oldRecord.asignatura_id
    };
  }

  await invoke('delete_record_local', { table, id });
}
