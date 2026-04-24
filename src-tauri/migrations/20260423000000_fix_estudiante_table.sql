-- Corrección: Asegurar que estudiante tenga la estructura correcta para sincronización
-- Agregar columnas faltantes y migrar datos si es necesario

-- Agregar columnas faltantes (ignorar si ya existen)
ALTER TABLE estudiante ADD COLUMN telefono TEXT;
ALTER TABLE estudiante ADD COLUMN direccion TEXT;
ALTER TABLE estudiante ADD COLUMN email TEXT;
ALTER TABLE estudiante ADD COLUMN foto TEXT;
ALTER TABLE estudiante ADD COLUMN nombre TEXT;

-- Migrar datos de nombres+apellidos a nombre si existe el esquema antiguo
UPDATE estudiante SET nombre = TRIM(COALESCE(nombres, '') || ' ' || COALESCE(apellidos, ''))
WHERE (nombre IS NULL OR nombre = '' OR nombre = 'null')
AND (nombres IS NOT NULL OR apellidos IS NOT NULL);

-- Poblar relaciones colegio_asignatura para bases de datos importadas
INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id)
SELECT c.id, a.id
FROM colegio c
CROSS JOIN asignatura a;

-- Poblar relaciones grado_asignatura para bases de datos importadas
INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id)
SELECT g.id, a.id
FROM grado g
CROSS JOIN asignatura a;
