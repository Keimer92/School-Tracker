-- Actualizar valores por defecto para los umbrales de calificación
-- Esto se ejecuta después de asegurar que la columna existe
UPDATE configuracion_calificacion SET minimo = 90 WHERE id = 'AA';
UPDATE configuracion_calificacion SET minimo = 76 WHERE id = 'AS';
UPDATE configuracion_calificacion SET minimo = 60 WHERE id = 'AF';
UPDATE configuracion_calificacion SET minimo = 0 WHERE id = 'AI';