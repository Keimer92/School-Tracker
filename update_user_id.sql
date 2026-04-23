-- Actualizar user_id de todos los datos en Supabase
-- Viejo user_id: 7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6 (Google)
-- Nuevo user_id: f4100785-8cd0-45d8-aace-2d320e2aad81 (Email/Password)

-- Actualizar todas las tablas con el nuevo user_id
UPDATE ano_lectivo
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE corte_evaluativo
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE colegio
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE asignatura
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE grado
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE seccion
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE estudiante
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE indicador
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE criterio
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE nota
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE asistencia
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE configuracion_calificacion
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

UPDATE colegio_dias_asistencia
SET user_id = 'f4100785-8cd0-45d8-aace-2d320e2aad81'
WHERE user_id = '7336d4dc-d2b1-4828-a07e-f5d4ad8a1db6';

-- Nota: Las tablas grado_asignatura y colegio_asignatura no tienen user_id directo,
-- pero deberían actualizarse automáticamente si los grados y colegios se actualizan primero.