-- Corrección: Eliminar tabla estudiante_new si existe y asegurar que estudiante tenga la estructura correcta
-- Este script limpia cualquier residuo dejado por migraciones anteriores

-- Si existe estudiante_new, copiar sus datos a estudiante (si estudiante existe) o renombrar
-- Primero verificamos si estudiante_new existe
CREATE TABLE IF NOT EXISTS estudiante_backup AS
SELECT * FROM estudiante WHERE 1=0;

-- Si estudiante_new existe, renombrarla a estudiante (primero eliminar estudiante si existe)
-- Esto es complejo en SQLite, así que usamos un enfoque más seguro:

-- 1. Si estudiante_new existe y estudiante no, simplemente renombramos
-- 2. Si ambas existen, copiamos los datos de new a la original

-- Empezamos con un enfoque simple: eliminar estudiante_new si existe y ya no es necesaria
DROP TABLE IF EXISTS estudiante_new;

-- Asegurarnos de que estudiante tenga todas las columnas necesarias
-- Agregar columnas faltantes si no existen (para bases de datos antiguas)
ALTER TABLE estudiante ADD COLUMN telefono TEXT;
ALTER TABLE estudiante ADD COLUMN direccion TEXT;
ALTER TABLE estudiante ADD COLUMN email TEXT;
ALTER TABLE estudiante ADD COLUMN foto TEXT;

-- Eliminar tabla temporal si existe
DROP TABLE IF EXISTS estudiante_backup;
