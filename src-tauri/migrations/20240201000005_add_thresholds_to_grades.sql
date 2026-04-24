-- Agregar columna minimo a configuracion_calificacion
ALTER TABLE configuracion_calificacion ADD COLUMN IF NOT EXISTS minimo INTEGER DEFAULT 0;
