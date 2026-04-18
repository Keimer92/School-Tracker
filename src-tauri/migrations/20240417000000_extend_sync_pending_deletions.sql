-- Extender sync_pending_deletions para manejar claves compuestas
-- Agregar campos adicionales para IDs compuestos y tipo de operación

ALTER TABLE sync_pending_deletions ADD COLUMN registro_id_2 INTEGER;
ALTER TABLE sync_pending_deletions ADD COLUMN registro_id_3 INTEGER;
ALTER TABLE sync_pending_deletions ADD COLUMN registro_id_4 INTEGER;
ALTER TABLE sync_pending_deletions ADD COLUMN tipo_operacion TEXT DEFAULT 'DELETE';

-- Tabla para registrar eliminaciones de asistencia (clave compuesta: estudiante_id + fecha)
CREATE TABLE IF NOT EXISTS sync_pending_deletions_asistencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para registrar eliminaciones de notas (clave compuesta: multiple campos)
CREATE TABLE IF NOT EXISTS sync_pending_deletions_nota (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER NOT NULL,
    criterio_id INTEGER NOT NULL,
    corte_evaluativo_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para registrar eliminaciones de grado_asignatura (clave compuesta: grado_id + asignatura_id)
CREATE TABLE IF NOT EXISTS sync_pending_deletions_grado_asignatura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para registrar eliminaciones de colegio_asignatura (clave compuesta: colegio_id + asignatura_id)
CREATE TABLE IF NOT EXISTS sync_pending_deletions_colegio_asignatura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colegio_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_sync_pending_asistencia ON sync_pending_deletions_asistencia(estudiante_id, fecha);
CREATE INDEX IF NOT EXISTS idx_sync_pending_nota ON sync_pending_deletions_nota(estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id);
CREATE INDEX IF NOT EXISTS idx_sync_pending_grado_asig ON sync_pending_deletions_grado_asignatura(grado_id, asignatura_id);
CREATE INDEX IF NOT EXISTS idx_sync_pending_colegio_asig ON sync_pending_deletions_colegio_asignatura(colegio_id, asignatura_id);
