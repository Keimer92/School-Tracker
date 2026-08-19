-- Migración D1: clave de negocio de asistencia como PK.
--
-- Contexto: la tabla tenía `id INTEGER PRIMARY KEY AUTOINCREMENT` + UNIQUE(estudiante_id, fecha).
-- El Worker upserta con ON CONFLICT(estudiante_id, fecha), así que el `id` local de un
-- dispositivo puede colisionar con el `id` remoto de otro -> "UNIQUE constraint failed: asistencia.id".
--
-- Fix: la PK pasa a ser (estudiante_id, fecha); `id` queda como columna informativa no única.
-- Idempotente: si se ejecuta sobre la tabla ya migrada, GROUP BY(estudiante_id, fecha) no pierde datos.
--
-- Uso: wrangler d1 execute <db-name> --file=scripts/migrate-asistencia.sql --remote --yes

CREATE TABLE IF NOT EXISTS asistencia_new (
    estudiante_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    id INTEGER,
    estado TEXT CHECK(estado IN ('P', 'A', 'J')) NOT NULL,
    observacion TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    device_id TEXT,
    PRIMARY KEY (estudiante_id, fecha)
);

INSERT OR IGNORE INTO asistencia_new (estudiante_id, fecha, id, estado, observacion, updated_at, device_id)
SELECT estudiante_id, fecha, id, estado, observacion, updated_at, device_id
FROM asistencia
GROUP BY estudiante_id, fecha;

DROP TABLE IF EXISTS asistencia;

ALTER TABLE asistencia_new RENAME TO asistencia;

CREATE INDEX IF NOT EXISTS idx_asistencia_updated ON asistencia(updated_at);
