-- Corrección: Asegurar que estudiante tenga la estructura correcta para sincronización
-- Este script limpia cualquier residuo dejado por migraciones anteriores

-- 1. Eliminar tabla estudiante_new si existe (residuo de migraciones fallidas)
DROP TABLE IF EXISTS estudiante_new;

-- 2. Verificar si estudiante tiene columnas 'nombres' y 'apellidos' (esquema antiguo)
-- y si NO tiene la columna 'nombre' (esquema nuevo)
-- Si es así, necesitamos migrar los datos

-- Primero, agregar columnas faltantes si no existen
ALTER TABLE estudiante ADD COLUMN telefono TEXT;
ALTER TABLE estudiante ADD COLUMN direccion TEXT;
ALTER TABLE estudiante ADD COLUMN email TEXT;
ALTER TABLE estudiante ADD COLUMN foto TEXT;

-- Verificar si existe la columna 'nombres' (esquema antiguo)
SELECT name FROM sqlite_master WHERE type='table' AND name='estudiante' AND sql LIKE '%nombres%';

-- Si existe 'nombres' y NO existe 'nombre', migrar
-- Crear tabla temporal con el esquema correcto
CREATE TABLE IF NOT EXISTS estudiante_tmp (
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

-- Copiar datos de la tabla original, fusionando nombres y apellidos en nombre
INSERT INTO estudiante_tmp (id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id, telefono, direccion, email, foto)
SELECT 
    id, 
    TRIM(nombres || ' ' || apellidos) as nombre, 
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
ALTER TABLE estudiante_tmp RENAME TO estudiante;
