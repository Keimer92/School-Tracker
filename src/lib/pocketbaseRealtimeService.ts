import { pb } from './pocketbase';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

let unsubscribers: (() => void)[] = [];

export const pocketbaseRealtimeService = {
  init: async (userId: string) => {
    console.log('[PB Realtime] Inicializando suscripciones para el usuario:', userId);
    pocketbaseRealtimeService.stop();

    const collections = [
      'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado', 'seccion',
      'estudiante', 'indicador', 'criterio', 'nota', 'asistencia',
      'configuracion_calificacion', 'colegio_dias_asistencia'
    ];

    for (const collection of collections) {
      try {
        const unsubscribe = await pb.collection(collection).subscribe('*', async (e) => {
          console.log(`[PB Realtime] Cambio detectado en ${collection}:`, e.action, e.record);

          try {
            if (e.action === 'create' || e.action === 'update') {
              await applyChangeToLocal(collection, e.record);
            } else if (e.action === 'delete') {
              await applyDeletionToLocal(collection, e.record);
            }

            if (collection === 'asistencia') {
              await emit('asistencia-updated');
            } else if (collection === 'nota') {
              await emit('notas-updated');
            } else if (collection === 'estudiante') {
              await emit('student-updated');
            } else {
              await emit('catalog-updated');
            }
          } catch (error) {
            console.error(`[PB Realtime] Error aplicando cambio de ${collection}:`, error);
          }
        });
        unsubscribers.push(unsubscribe);
      } catch (e) {
        console.warn(`[PB Realtime] No se pudo suscribir a ${collection}:`, e);
      }
    }

    console.log(`[PB Realtime] ${unsubscribers.length} colecciones suscritas.`);
  },

  stop: () => {
    if (unsubscribers.length > 0) {
      console.log(`[PB Realtime] Deteniendo ${unsubscribers.length} suscripciones...`);
      unsubscribers.forEach(unsub => unsub());
      unsubscribers = [];
    }
  },

  restart: async (userId: string) => {
    pocketbaseRealtimeService.stop();
    await pocketbaseRealtimeService.init(userId);
  }
};

async function applyChangeToLocal(collection: string, record: any) {
  if (collection === 'asistencia') {
    try {
      await invoke('upsert_asistencia_from_cloud', { records: [record] });
      return;
    } catch (e) {
      console.error('[PB Realtime] Error en upsert_asistencia_from_cloud:', e);
    }
  } else if (collection === 'nota') {
    try {
      const notaRecord = {
        ...record,
        estudiante_id: Number(record.estudiante_id),
        criterio_id: Number(record.criterio_id),
        asignatura_id: Number(record.asignatura_id),
        puntaje: Number(record.valor),
        corte_id: Number(record.corte_evaluativo_id),
      };
      await invoke('upsert_notas_from_cloud', { notas: [notaRecord] });
      return;
    } catch (e) {
      console.error('[PB Realtime] Error en upsert_notas_from_cloud:', e);
    }
  }

  const pullData: any = {
    anos: [], cortes: [], colegios: [], asignaturas: [], grados: [], secciones: [],
    estudiantes: [], indicadores: [], criterios: [], notas: [], asistencia: [],
    gradeConfigs: [], gradoAsignatura: [], colegioAsignatura: [], colegioDiasAsistencia: [],
    isPartial: true
  };

  if (collection === 'ano_lectivo') pullData.anos.push({ id: Number(record.id), nombre: record.nombre, activo: record.activo, cualitativo: record.cualitativo });
  else if (collection === 'corte_evaluativo') pullData.cortes.push({ id: Number(record.id), nombre: record.nombre, activo: record.activo, cualitativo: record.cualitativo });
  else if (collection === 'colegio') pullData.colegios.push({ id: Number(record.id), nombre: record.nombre, activo: record.activo, cualitativo: record.cualitativo });
  else if (collection === 'asignatura') pullData.asignaturas.push({ id: Number(record.id), nombre: record.nombre, cualitativo: record.cualitativo });
  else if (collection === 'grado') pullData.grados.push({ id: Number(record.id), nombre: record.nombre, cualitativo: record.cualitativo });
  else if (collection === 'seccion') pullData.secciones.push({ id: Number(record.id), nombre: record.nombre, cualitativo: record.cualitativo });
  else if (collection === 'estudiante') pullData.estudiantes.push({
    id: Number(record.id), nombre: record.nombre, codigo: record.codigo,
    sexo: record.sexo, anoLectivoId: Number(record.ano_lectivo_id),
    gradoId: Number(record.grado_id), seccionId: Number(record.seccion_id),
    colegioId: Number(record.colegio_id), telefono: record.telefono,
    direccion: record.direccion, email: record.email
  });
  else if (collection === 'indicador') pullData.indicadores.push({
    id: Number(record.id), gradoId: Number(record.grado_id),
    asignaturaId: Number(record.asignatura_id),
    corteEvaluativoId: Number(record.corte_evaluativo_id),
    orden: record.orden, descripcion: record.descripcion,
    activo: record.activo, criterios: []
  });
  else if (collection === 'criterio') pullData.criterios.push({
    id: Number(record.id), indicadorId: Number(record.indicador_id),
    orden: record.orden, descripcion: record.descripcion,
    puntajeMaximo: record.puntaje_maximo
  });
  else if (collection === 'configuracion_calificacion') pullData.gradeConfigs.push({
    id: record.id, color: record.color, minimo: record.minimo
  });
  else if (collection === 'colegio_dias_asistencia') pullData.colegioDiasAsistencia.push({
    colegioId: Number(record.colegio_id), lunes: record.lunes,
    martes: record.martes, miercoles: record.miercoles,
    jueves: record.jueves, viernes: record.viernes,
    sabado: record.sabado, domingo: record.domingo
  });

  await invoke('upsert_pull_data', { data: pullData });
}

async function applyDeletionToLocal(collection: string, oldRecord: any) {
  let id: any = oldRecord.id;

  if (collection === 'asistencia') {
    id = { estudianteId: Number(oldRecord.estudiante_id), fecha: oldRecord.fecha };
  } else if (collection === 'nota') {
    id = {
      estudianteId: Number(oldRecord.estudiante_id),
      criterioId: Number(oldRecord.criterio_id),
      corteId: Number(oldRecord.corte_evaluativo_id),
      asignaturaId: Number(oldRecord.asignatura_id)
    };
  }

  await invoke('delete_record_local', { table: collection, id });
}
