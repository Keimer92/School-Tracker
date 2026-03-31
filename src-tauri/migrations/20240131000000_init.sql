-- Create tables for global categories
CREATE TABLE IF NOT EXISTS ano_lectivo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS corte_evaluativo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS colegio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS asignatura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS grado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS seccion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT FALSE
);

-- Table for Students
CREATE TABLE IF NOT EXISTS estudiante (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombres TEXT NOT NULL,
    apellidos TEXT NOT NULL,
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

-- Grade-Subject Relationship (Many-to-Many)
CREATE TABLE IF NOT EXISTS grado_asignatura (
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    PRIMARY KEY (grado_id, asignatura_id),
    FOREIGN KEY(grado_id) REFERENCES grado(id) ON DELETE CASCADE,
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id) ON DELETE CASCADE
);

-- Seed Default Data
INSERT OR IGNORE INTO ano_lectivo (nombre) VALUES 
('2026'), ('2027'), ('2028'), ('2029'), ('2030');

INSERT OR IGNORE INTO corte_evaluativo (nombre) VALUES 
('1er corte evaluativo'), 
('2do corte evaluativo'), 
('3er corte evaluativo'), 
('4to corte evaluativo');

INSERT OR IGNORE INTO colegio (nombre) VALUES 
('ELA Malpaisillo'),
('Candelario Sotelo'), 
('Manuel Ignacio Pereira Quintana');

INSERT OR IGNORE INTO asignatura (nombre, cualitativo) VALUES 
('Ingles', 0), 
('Matematicas', 0), 
('Fisica', 0), 
('Biologia', 0), 
('Ciencias Naturales', 0), 
('Ciencias Sociales', 0), 
('TAC', 1), 
('AEP', 1),
('Convivencia & Civismo', 1),
('Creciendo en Valores', 1), 
('Derecho & Dignidad de la Mujer', 1),
('Educación Física', 1);

INSERT OR IGNORE INTO grado (nombre) VALUES 
('1er grado'), ('2do grado'), ('3er grado'), ('4to grado'), ('5to grado'), 
('6to grado'), ('7mo grado'), ('8vo grado'), ('9no grado'), ('10mo grado'), ('11mo grado');

INSERT OR IGNORE INTO seccion (nombre) VALUES 
('A'), ('B'), ('C'), ('D');

-- Default Assignments: Assign all subjects to all grades
INSERT OR IGNORE INTO grado_asignatura (grado_id, asignatura_id)
SELECT g.id, a.id FROM grado g CROSS JOIN asignatura a;
