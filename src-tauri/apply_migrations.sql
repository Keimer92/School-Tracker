-- Apply all migrations in order

-- 1. Initial schema
CREATE TABLE IF NOT EXISTS ano_lectivo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS corte_evaluativo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS colegio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT 0,
    orden INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asignatura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS seccion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS estudiante (
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

CREATE TABLE IF NOT EXISTS indicador (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    corte_evaluativo_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT NOT NULL,
    activo BOOLEAN DEFAULT 0,
    FOREIGN KEY(grado_id) REFERENCES grado(id),
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id),
    FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id)
);

CREATE TABLE IF NOT EXISTS criterio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    indicador_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT NOT NULL,
    puntaje_maximo REAL NOT NULL,
    FOREIGN KEY(indicador_id) REFERENCES indicador(id)
);

CREATE TABLE IF NOT EXISTS nota (
    estudiante_id INTEGER NOT NULL,
    criterio_id INTEGER NOT NULL,
    valor REAL NOT NULL,
    corte_evaluativo_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id),
    FOREIGN KEY(estudiante_id) REFERENCES estudiante(id),
    FOREIGN KEY(criterio_id) REFERENCES criterio(id),
    FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id),
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id)
);

CREATE TABLE IF NOT EXISTS asistencia (
    estudiante_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    estado TEXT CHECK(estado IN ('P', 'F', 'J', 'T')) NOT NULL,
    observacion TEXT,
    PRIMARY KEY (estudiante_id, fecha),
    FOREIGN KEY(estudiante_id) REFERENCES estudiante(id)
);

CREATE TABLE IF NOT EXISTS configuracion_calificacion (
    id INTEGER PRIMARY KEY,
    color TEXT NOT NULL,
    minimo REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS grado_asignatura (
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    PRIMARY KEY (grado_id, asignatura_id),
    FOREIGN KEY(grado_id) REFERENCES grado(id),
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id)
);

CREATE TABLE IF NOT EXISTS colegio_asignatura (
    colegio_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    PRIMARY KEY (colegio_id, asignatura_id),
    FOREIGN KEY(colegio_id) REFERENCES colegio(id),
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id)
);

CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (
    colegio_id INTEGER PRIMARY KEY,
    lunes BOOLEAN DEFAULT 0,
    martes BOOLEAN DEFAULT 0,
    miercoles BOOLEAN DEFAULT 0,
    jueves BOOLEAN DEFAULT 0,
    viernes BOOLEAN DEFAULT 0,
    sabado BOOLEAN DEFAULT 0,
    domingo BOOLEAN DEFAULT 0
);

-- Insert default data
INSERT OR IGNORE INTO ano_lectivo (nombre) VALUES ('2026'), ('2027'), ('2028'), ('2029'), ('2030');
INSERT OR IGNORE INTO corte_evaluativo (nombre) VALUES ('1er corte evaluativo'), ('2do corte evaluativo'), ('3er corte evaluativo');
INSERT OR IGNORE INTO configuracion_calificacion (id, color, minimo) VALUES 
    (1, '#ef4444', 0), (2, '#f97316', 30), (3, '#eab308', 60), (4, '#22c55e', 80), (5, '#3b82f6', 90);
