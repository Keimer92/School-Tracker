-- Schema D1 para School Tracker Pro
-- Réplica exacta de src-tauri/src/db.rs -> init_database (16 tablas sincronizables)
-- + tabla sync_metadata (contadores para bloques de IDs) + sync_tombstone (borrados LWW)
-- Nota: se añade device_id para resolver empates de LWW en el Worker.

CREATE TABLE IF NOT EXISTS ano_lectivo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo INTEGER DEFAULT 0,
    cualitativo INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS corte_evaluativo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo INTEGER DEFAULT 0,
    cualitativo INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS colegio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activo INTEGER DEFAULT 0,
    cualitativo INTEGER DEFAULT 0,
    orden INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS asignatura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS grado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS seccion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    cualitativo INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
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
    foto TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS grado_asignatura (
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT,
    PRIMARY KEY (grado_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS colegio_asignatura (
    colegio_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT,
    PRIMARY KEY (colegio_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS indicador (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    corte_evaluativo_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT DEFAULT '',
    activo INTEGER DEFAULT 1,
    instrumento TEXT NOT NULL DEFAULT 'general',
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS criterio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    indicador_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT DEFAULT '',
    puntaje_maximo INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT,
    UNIQUE(indicador_id, orden)
);

CREATE TABLE IF NOT EXISTS asistencia (
    estudiante_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    id INTEGER,
    estado TEXT CHECK(estado IN ('P', 'A', 'J')) NOT NULL,
    observacion TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT,
    PRIMARY KEY (estudiante_id, fecha)
);

CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (
    colegio_id INTEGER PRIMARY KEY,
    lunes INTEGER DEFAULT 1,
    martes INTEGER DEFAULT 1,
    miercoles INTEGER DEFAULT 1,
    jueves INTEGER DEFAULT 1,
    viernes INTEGER DEFAULT 1,
    sabado INTEGER DEFAULT 1,
    domingo INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS nota (
    estudiante_id INTEGER NOT NULL,
    criterio_id INTEGER NOT NULL,
    valor REAL NOT NULL,
    corte_evaluativo_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT,
    PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS configuracion_calificacion (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    color TEXT NOT NULL,
    minimo INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

CREATE TABLE IF NOT EXISTS multiplicador_calificacion (
    id TEXT PRIMARY KEY,
    multiplicador REAL NOT NULL DEFAULT 1.0,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT
);

-- Contadores para reserva de bloques de IDs por tabla
CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

-- Tombstones para propagar borrados entre dispositivos
CREATE TABLE IF NOT EXISTS sync_tombstone (
    tabla TEXT NOT NULL,
    pk TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    device_id TEXT,
    PRIMARY KEY (tabla, pk)
);

-- Índices para el pull incremental (updated_at > since)
CREATE INDEX IF NOT EXISTS idx_ano_lectivo_updated ON ano_lectivo(updated_at);
CREATE INDEX IF NOT EXISTS idx_corte_updated ON corte_evaluativo(updated_at);
CREATE INDEX IF NOT EXISTS idx_colegio_updated ON colegio(updated_at);
CREATE INDEX IF NOT EXISTS idx_asignatura_updated ON asignatura(updated_at);
CREATE INDEX IF NOT EXISTS idx_grado_updated ON grado(updated_at);
CREATE INDEX IF NOT EXISTS idx_seccion_updated ON seccion(updated_at);
CREATE INDEX IF NOT EXISTS idx_estudiante_updated ON estudiante(updated_at);
CREATE INDEX IF NOT EXISTS idx_grado_asignatura_updated ON grado_asignatura(updated_at);
CREATE INDEX IF NOT EXISTS idx_colegio_asignatura_updated ON colegio_asignatura(updated_at);
CREATE INDEX IF NOT EXISTS idx_indicador_updated ON indicador(updated_at);
CREATE INDEX IF NOT EXISTS idx_criterio_updated ON criterio(updated_at);
CREATE INDEX IF NOT EXISTS idx_asistencia_updated ON asistencia(updated_at);
CREATE INDEX IF NOT EXISTS idx_colegio_dias_updated ON colegio_dias_asistencia(updated_at);
CREATE INDEX IF NOT EXISTS idx_nota_updated ON nota(updated_at);
CREATE INDEX IF NOT EXISTS idx_config_calif_updated ON configuracion_calificacion(updated_at);
CREATE INDEX IF NOT EXISTS idx_mult_calif_updated ON multiplicador_calificacion(updated_at);
CREATE INDEX IF NOT EXISTS idx_tombstone_updated ON sync_tombstone(updated_at);
