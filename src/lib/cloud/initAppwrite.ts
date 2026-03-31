/**
 * Script de inicialización de Appwrite
 * Crea automáticamente todas las colecciones y atributos necesarios
 * Nota: Este script usa la API REST de Appwrite porque el SDK de cliente
 * no tiene permisos para crear colecciones (solo el SDK de servidor puede)
 * 
 * Para usar esto, el usuario debe:
 * 1. Ir a la consola de Appwrite
 * 2. Crear las colecciones manualmente O usar las API Keys de servidor
 */

import { Client, Databases, Query } from 'appwrite';

// ID de la base de datos principal
export const APPWRITE_DATABASE_ID = 'senku_db';

// Lista de colecciones que deben existir
export const APPWRITE_COLLECTIONS = [
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
  'grado_asignatura',
  'colegio_asignatura',
  'colegio_dias_asistencia',
];

/**
 * Verifica si todas las colecciones existen en Appwrite
 */
export const checkAppwriteInitialized = async (
  endpoint: string,
  projectId: string
): Promise<{ initialized: boolean; collections: string[]; missing: string[] }> => {
  const client = new Client();
  client.setEndpoint(endpoint).setProject(projectId);

  const databases = new Databases(client);
  const collections: string[] = [];
  const missing: string[] = [];

  try {
    for (const collectionId of APPWRITE_COLLECTIONS) {
      try {
        await databases.listDocuments(APPWRITE_DATABASE_ID, collectionId, [Query.limit(1)]);
        collections.push(collectionId);
      } catch (error: any) {
        if (error.code === 404) {
          missing.push(collectionId);
        } else {
          // Otro error, asumir que no existe
          missing.push(collectionId);
        }
      }
    }

    const initialized = missing.length === 0;
    return { initialized, collections, missing };
  } catch {
    return { initialized: false, collections: [], missing: [...APPWRITE_COLLECTIONS] };
  }
};

/**
 * Guía de inicialización para el usuario
 */
export const getInitializationGuide = (): string => {
  return `
# Guía de Inicialización de Appwrite

Para usar Appwrite como tu proveedor de nube, necesitas crear las colecciones manualmente:

## Paso 1: Ir a la consola de Appwrite Toronto
1. Ve a https://tor.cloud.appwrite.io
2. Inicia sesión
3. Selecciona tu proyecto: 69bcc5c3000d4847de99

## Paso 2: Crear Base de Datos
1. Ve a "Database" en el menú lateral
2. Click en "Create Database"
3. Database ID: senku_db
4. Database Name: Senku Database
5. Click en "Create"

## Paso 3: Crear Colecciones
Para cada colección en esta lista:
${APPWRITE_COLLECTIONS.map(c => `- ${c}`).join('\n')}

Sigue estos pasos:
1. Click en "Create Collection"
2. Collection ID: [nombre-coleccion]
3. Collection Name: [Nombre Colección]
4. En "Permissions", agrega:
   - Create: Any User
   - Read: Any User  
   - Update: Any User
   - Delete: Any User
5. Click en "Create"

## Paso 4: Agregar Atributos
Para cada colección, agrega los atributos correspondientes.
Los atributos comunes son:
- id (automático)
- user_id (string, 255, requerido)
- nombre (string, 255)
- activo (boolean)
- Y los específicos de cada colección...

## Nota Importante
La creación automática de colecciones requiere API Keys de servidor.
Para mayor seguridad, recomendamos crear las colecciones manualmente siguiendo esta guía.
`;
};
