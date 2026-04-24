-- Corrección: Asegurar que estudiante tenga la estructura correcta para sincronización
-- Este script limpia cualquier residuo dejado por migraciones anteriores

-- Desactivar foreign keys para poder modificar la estructura de las tablas
PRAGMA foreign_keys = OFF;

-- 1. Eliminar tabla estudiante_new si existe (residuo de migraciones fallidas)
DROP TABLE IF EXISTS estudiante_new;
DROP TABLE IF EXISTS estudiante_tmp;

-- 2. Primero, verificar la estructura actual de la tabla estudiante
-- Agregar columnas faltantes (si no existen) - esto no falla si ya existen
ALTER TABLE estudiante ADD COLUMN telefono TEXT;
ALTER TABLE estudiante ADD COLUMN direccion TEXT;
ALTER TABLE estudiante ADD COLUMN email TEXT;
ALTER TABLE estudiante ADD COLUMN foto TEXT;
ALTER TABLE estudiante ADD COLUMN nombre TEXT;

-- 3. Verificar si existe la columna 'nombres' (esquema antiguo)
-- Si existe, necesitamos migrar los datos de nombres+apellidos a nombre
-- Si no existe, la tabla ya tiene el esquema nuevo

-- Verificar si la tabla tiene columnas 'nombres' y 'apellidos'
-- (Esto es solo para confirmar, no podemos hacer IF en SQL puro)

-- Si la columna nombre está vacía pero existen nombres y apellidos, fusionarlos
UPDATE estudiante SET nombre = TRIM(COALESCE(nombres, '') || ' ' || COALESCE(apellidos, '')) 
WHERE (nombre IS NULL OR nombre = '' OR nombre = 'null') 
AND (nombres IS NOT NULL OR apellidos IS NOT NULL);

-- Si la tabla tiene muchas columnas (esquema antiguo con nombres+apellidos),
--我们需要删除旧列。但SQLite不支持DROP COLUMN，所以我们要重建表。
-- Primero, verificar si necesitamos reconstruir la tabla
-- Si estudiante tiene las columnas nombres y apellidos, necesitamos reconstruir

-- Crear tabla temporal con el esquema correcto
CREATE TABLE IF NOT EXISTS estudiante_new (
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
    foto TEXT
);

-- Copiar datos de la tabla original
INSERT INTO estudiante_new (id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, telefono, direccion, email, foto)
SELECT 
    id, 
    COALESCE(NULLIF(nombre, ''), TRIM(COALESCE(nombres, '') || ' ' || COALESCE(apellidos, ''))) as nombre, 
    codigo, 
    sexo, 
    ano_lectivo_id, 
    grado_id, 
    seccion_id, 
    colegio_id,
    telefono,
    direccion,
    email,
    foto
FROM estudiante;

-- Eliminar la tabla original
DROP TABLE estudiante;

-- Renombrar la tabla temporal al nombre original
ALTER TABLE estudiante_new RENAME TO estudiante;

-- Reactivar foreign keys
PRAGMA foreign_keys = ON;
