-- Update existing subjects to be qualitative and ensure correct names
UPDATE asignatura SET cualitativo = 1, nombre = 'TAC' WHERE nombre LIKE 'TAC%';
UPDATE asignatura SET cualitativo = 1, nombre = 'AEP' WHERE nombre LIKE 'AEP%';
UPDATE asignatura SET cualitativo = 1, nombre = 'Convivencia & Civismo' WHERE nombre LIKE 'Convivencia%' OR nombre LIKE 'Civismo%';
UPDATE asignatura SET cualitativo = 1, nombre = 'Creciendo en Valores' WHERE nombre LIKE 'Creciendo en Valores%';
UPDATE asignatura SET cualitativo = 1, nombre = 'Derecho & Dignidad de la Mujer' WHERE nombre LIKE 'Derecho%Dignidad%Mujer%';
UPDATE asignatura SET cualitativo = 1, nombre = 'Educación Física' WHERE nombre LIKE 'Educación Física%';
UPDATE asignatura SET nombre = 'Ciencias Naturales' WHERE nombre LIKE 'Ciencias naturales%';
UPDATE asignatura SET nombre = 'Ciencias Sociales' WHERE nombre LIKE 'Ciencias sociales%';

-- Insert new subjects if they don't exist
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('TAC', 1);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('AEP', 1);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('Convivencia & Civismo', 1);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('Creciendo en Valores', 1);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('Derecho & Dignidad de la Mujer', 1);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('Educación Física', 1);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('Ciencias Naturales', 0);
INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES ('Ciencias Sociales', 0);

-- Assign new subjects to all grades to ensure they appear in the curriculum
INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id)
SELECT g.id, a.id 
FROM grado g 
CROSS JOIN asignatura a 
WHERE a.nombre IN ('AEP', 'Convivencia & Civismo', 'Educación Física', 'Ciencias Naturales', 'Ciencias Sociales');
