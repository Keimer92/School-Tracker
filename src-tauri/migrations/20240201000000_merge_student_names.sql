-- Migration to merge nombres and apellidos into a single nombre column
-- First, add the new column (or just rename and update)
-- We'll use a safer approach for SQLite

-- 1. Create a temporary table with the new schema
CREATE TABLE IF NOT EXISTS estudiante_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    codigo TEXT NOT NULL UNIQUE,
    sexo TEXT CHECK(sexo IN ('M', 'F')) NOT NULL,
    ano_lectivo_id INTEGER NOT NULL,
    grado_id INTEGER NOT NULL,
    seccion_id INTEGER NOT NULL,
    colegio_id INTEGER NOT NULL,
    FOREIGN KEY(ano_lectivo_id) REFERENCES ano_lectivo(id),
    FOREIGN KEY(grado_id) REFERENCES grado(id),
    FOREIGN KEY(seccion_id) REFERENCES seccion(id),
    FOREIGN KEY(colegio_id) REFERENCES colegio(id)
);

-- 2. Copy data from the old table, merging names
INSERT INTO estudiante_new (id, nombre, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id)
SELECT id, nombres || ' ' || apellidos, codigo, sexo, ano_lectivo_id, grado_id, seccion_id, colegio_id
FROM estudiante;

-- 3. Drop the old table
DROP TABLE estudiante;

-- 4. Rename the new table to the original name
ALTER TABLE estudiante_new RENAME TO estudiante;
