-- Agregar columna minimo a configuracion_calificacion
ALTER TABLE configuracion_calificacion ADD COLUMN minimo INTEGER DEFAULT 0;
