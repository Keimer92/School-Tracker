-- Corrección: Asegurar que estudiante tenga la estructura correcta para sincronización
-- Este script limpia cualquier residuo dejado por migraciones anteriores

-- 1. Eliminar tabla estudiante_new si existe (residuo de migraciones fallidas)
DROP TABLE IF EXISTS estudiante_new;

-- 2. Verificar y fusionar nombres+apellidos en nombre (esquema antiguo → nuevo)
-- Si las columnas 'nombres' y 'apellidos' existen pero 'nombre' no, fusionarlas
PRAGMA table_info(estudiante);
-- Crear tabla temporal con el esquema correcto
CREATE TABLE IF NOT EXISTS estudiante_new_schema (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    codigo TEXT NOT NULL UNIQUE,
    sexo TEXT CHECK(sexo IN ('M', 'F')) NOT NULL,
    ano_lectivo_id INTEGER NOT NULL,
    grado_id INTEGER NOT NULL,
    seccion_id INTEGER NOT NULL,
    colegio_id INTEGER NOT NULL,
    telefono TEXT,
    direccion TEXT,
    email TEXT,
    foto TEXT,
    FOREIGN KEY(ano_lectivo_id) REFERENCES ano_lectivo(id),
    FOREIGN KEY(grado_id) REFERENCES grado(id),
    FOREIGN KEY(seccion_id) REFERENCES seccion(id),
    FOREIGN KEY(colegio_id) REFERENCES colegio(id)
);

-- Verificar si estudiante tiene la columna 'nombres' (esquema antiguo)
SELECT name FROM sqlite_master WHERE type='table' AND name='estudiante' AND sql LIKE '%nombres%';

-- Si existe estudiante_new, renombrarla y copiar datos
-- Si no, verificar si hay columnas separadas y migrar

-- En cualquier caso, asegurar que tenemos las columnas necesarias
-- Agregar columnas faltantes si no existen (para bases de datos antiguas)
ALTER TABLE estudiante ADD COLUMN telefono TEXT;
ALTER TABLE estudiante ADD COLUMN direccion TEXT;
ALTER TABLE estudiante ADD COLUMN email TEXT;
ALTER TABLE estudiante ADD COLUMN foto TEXT;
ALTER TABLE estudiante ADD COLUMN nombre TEXT;

-- Si 'nombre' está vacía pero 'nombres' existe, fusionar
UPDATE estudiante SET nombre = nombre WHERE nombre IS NOT NULL AND nombre != '';
UPDATE estudiante SET nombre = nombres || ' ' || apellidos WHERE (nombre IS NULL OR nombre = '') AND nombres IS NOT NULL;

-- Limpiar tabla temporal
DROP TABLE IF EXISTS estudiante_new_schema;
