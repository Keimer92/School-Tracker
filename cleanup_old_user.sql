-- Limpiar datos del user_id anterior: 49988fb4-6ac6-4b59-8f9f-529e47b843ad
-- Esto permitirá eliminar la cuenta asociada a ese user_id

-- Verificar qué datos existen con el user_id anterior
SELECT 'ano_lectivo' as tabla, COUNT(*) as registros FROM ano_lectivo WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'corte_evaluativo', COUNT(*) FROM corte_evaluativo WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'colegio', COUNT(*) FROM colegio WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'asignatura', COUNT(*) FROM asignatura WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'grado', COUNT(*) FROM grado WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'seccion', COUNT(*) FROM seccion WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'estudiante', COUNT(*) FROM estudiante WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'indicador', COUNT(*) FROM indicador WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'criterio', COUNT(*) FROM criterio WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'nota', COUNT(*) FROM nota WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'asistencia', COUNT(*) FROM asistencia WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'configuracion_calificacion', COUNT(*) FROM configuracion_calificacion WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad'
UNION ALL
SELECT 'colegio_dias_asistencia', COUNT(*) FROM colegio_dias_asistencia WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';

-- Si hay datos, ejecuta esto para eliminarlos:
-- DELETE FROM ano_lectivo WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM corte_evaluativo WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM colegio WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM asignatura WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM grado WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM seccion WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM estudiante WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM indicador WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM criterio WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM nota WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM asistencia WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM configuracion_calificacion WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';
-- DELETE FROM colegio_dias_asistencia WHERE user_id = '49988fb4-6ac6-4b59-8f9f-529e47b843ad';