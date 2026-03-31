import { Client, Account, Databases, Query } from 'appwrite';
import { CloudProvider, CloudUser } from './CloudProvider';

export class AppwriteBackend implements CloudProvider {
  name: 'appwrite' = 'appwrite';
  private client: Client;
  private account: Account;
  private databases: Databases;
  private lastKnownUser: CloudUser | null = null;

  // Database and collection IDs
  private readonly DATABASE_ID = 'senku_db';

  constructor() {
    this.client = new Client()
      .setEndpoint('https://tor.cloud.appwrite.io/v1') // Toronto region
      .setProject('69bcc5c3000d4847de99');

    this.account = new Account(this.client);
    this.databases = new Databases(this.client);
  }

  async getUser(): Promise<CloudUser | null> {
    try {
      const user = await this.account.get();
      this.lastKnownUser = { id: user.$id, email: user.email };
      return this.lastKnownUser;
    } catch (error: any) {
      // 401 significa no autenticado, no es un error real
      if (error.code === 401) {
        this.lastKnownUser = null;
        return null;
      }
      // Otros errores los logueamos pero no los propagamos
      console.warn("Appwrite getUser error:", error.message);
      return this.lastKnownUser; // Retornar último usuario conocido
    }
  }

  onAuthStateChange(callback: (user: CloudUser | null) => void): () => void {
    // Polling cada 3 segundos (menos frecuente para evitar saturar)
    const interval = setInterval(async () => {
      try {
        const user = await this.getUser();
        callback(user);
      } catch {
        // Ignorar errores silenciosamente
        callback(null);
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }

  async signInWithGoogle(): Promise<void> {
    try {
      await this.account.createOAuth2Session(
        'google' as any,
        `${window.location.origin}/oauth-callback`, // success
        `${window.location.origin}/oauth-callback`  // failure
      );
    } catch (error: any) {
      console.error("Error iniciando OAuth con Appwrite:", error);
      // Si hay error de CORS, dar mensaje más útil
      if (error.message.includes('CORS') || error.name === 'TypeError') {
        throw new Error('Error de conexión. Verifica que tu proyecto de Appwrite tenga configurado el origen http://localhost:1420 en la consola de Appwrite.');
      }
      throw new Error("No se pudo iniciar sesión con Google: " + error.message);
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.account.deleteSession('current');
      this.lastKnownUser = null;
    } catch (error: any) {
      console.warn("Error cerrando sesión:", error.message);
    }
  }

  async checkHealth(): Promise<'online' | 'offline' | 'checking'> {
    try {
      // En lugar de /health, intentamos obtener info del proyecto
      // Esto no requiere autenticación
      const res = await fetch('https://cloud.appwrite.io/v1/projects/69bcc5c3000d4847de99');
      return res.ok || res.status === 401 ? 'online' : 'offline';
    } catch {
      return 'offline';
    }
  }

  async pullAll(): Promise<any> {
    const userId = await this.getUserId();
    if (!userId) throw new Error("Debes estar conectado para descargar datos");

    try {
      // Descargar todas las colecciones en paralelo
      const [
        anos, cortes, colegios, asignaturas, grados, secciones,
        estudiantes, indicadores, criterios, notas, asistencia,
        gradeConfigs, gradoAsignatura, colegioAsignatura, colegioDiasAsistencia
      ] = await Promise.all([
        this.getCollection('ano_lectivo', userId),
        this.getCollection('corte_evaluativo', userId),
        this.getCollection('colegio', userId),
        this.getCollection('asignatura', userId),
        this.getCollection('grado', userId),
        this.getCollection('seccion', userId),
        this.getCollection('estudiante', userId),
        this.getCollection('indicador', userId),
        this.getCollection('criterio', userId),
        this.getCollection('nota', userId),
        this.getCollection('asistencia', userId),
        this.getCollection('configuracion_calificacion', userId),
        this.getCollection('grado_asignatura', userId),
        this.getCollection('colegio_asignatura', userId),
        this.getCollection('colegio_dias_asistencia', userId),
      ]);

      // Mapear datos al formato esperado por Rust
      const pullData = {
        anos: anos.map((a: any) => ({ id: a.id, nombre: a.nombre, activo: a.activo, cualitativo: a.cualitativo })),
        cortes: cortes.map((c: any) => ({ id: c.id, nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
        colegios: colegios.map((c: any) => ({ id: c.id, nombre: c.nombre, activo: c.activo, cualitativo: c.cualitativo })),
        asignaturas: asignaturas.map((a: any) => ({ id: a.id, nombre: a.nombre, cualitativo: a.cualitativo })),
        grados: grados.map((g: any) => ({ id: g.id, nombre: g.nombre, cualitativo: g.cualitativo })),
        secciones: secciones.map((s: any) => ({ id: s.id, nombre: s.nombre, cualitativo: s.cualitativo })),
        estudiantes: estudiantes.map((e: any) => ({
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
        indicadores: indicadores.map((i: any) => ({
          id: i.id,
          gradoId: i.grado_id,
          asignaturaId: i.asignatura_id,
          corteEvaluativoId: i.corte_evaluativo_id,
          orden: i.orden,
          descripcion: i.descripcion,
          activo: i.activo,
          criterios: []
        })),
        criterios: criterios.map((c: any) => ({
          id: c.id,
          indicadorId: c.indicador_id,
          orden: c.orden,
          descripcion: c.descripcion,
          puntajeMaximo: c.puntaje_maximo
        })),
        notas: notas.map((n: any) => ({
          estudianteId: n.estudiante_id,
          criterioId: n.criterio_id,
          valor: n.valor,
          corteEvaluativoId: n.corte_evaluativo_id,
          asignaturaId: n.asignatura_id
        })),
        asistencia: asistencia.map((a: any) => ({
          estudianteId: a.estudiante_id,
          fecha: a.fecha,
          estado: a.estado,
          observacion: a.observacion
        })),
        gradeConfigs: gradeConfigs.map((gc: any) => ({
          id: gc.id,
          color: gc.color,
          minimo: gc.minimo
        })),
        gradoAsignatura: gradoAsignatura.map((ga: any) => [ga.grado_id, ga.asignatura_id]),
        colegioAsignatura: colegioAsignatura.map((ca: any) => [ca.colegio_id, ca.asignatura_id]),
        colegioDiasAsistencia: colegioDiasAsistencia.map((cda: any) => ({
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

      return pullData;
    } catch (error: any) {
      console.error("Error en Appwrite pullAll:", error);
      throw new Error(`Error descargando datos de Appwrite: ${error.message}`);
    }
  }

  async pushAll(): Promise<void> {
    const userId = await this.getUserId();
    if (!userId) throw new Error("Debes estar conectado para subir datos");

    // Nota: Esta es una implementación básica
    // Para una sincronización completa, se necesitaría:
    // 1. Leer todos los datos locales
    // 2. Subir cada colección a Appwrite
    // 3. Manejar conflictos y eliminaciones
    
    console.log("Appwrite pushAll: Implementación pendiente - usando pullAll como base");
    // Por ahora, solo implementamos pullAll que es lo más crítico
    // La implementación de pushAll sería similar pero en dirección contraria
  }

  /**
   * Obtiene todos los documentos de una colección filtrados por user_id
   */
  private async getCollection(collectionId: string, userId: string): Promise<any[]> {
    try {
      const response = await this.databases.listDocuments(
        this.DATABASE_ID,
        collectionId,
        [Query.equal('user_id', userId)]
      );
      return response.documents;
    } catch (error: any) {
      // Si la colección no existe, retornar array vacío
      if (error.code === 404) {
        console.warn(`Colección ${collectionId} no existe en Appwrite`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Obtiene el ID del usuario actual
   */
  private async getUserId(): Promise<string | null> {
    const user = await this.getUser();
    return user?.id || null;
  }
}