-- ============================================
-- SCRIPT DE VERIFICACIÓN DE ESTRUCTURA SUPABASE
-- ============================================

-- 1. Ver todas las tablas del esquema public
SELECT 
    table_name,
    table_schema
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Ver estructura de cada tabla
-- ano_lectivo
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'ano_lectivo' AND table_schema = 'public'
ORDER BY ordinal_position;

-- corte_evaluativo
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'corte_evaluativo' AND table_schema = 'public'
ORDER BY ordinal_position;

-- colegio
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'colegio' AND table_schema = 'public'
ORDER BY ordinal_position;

-- asignatura
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'asignatura' AND table_schema = 'public'
ORDER BY ordinal_position;

-- grado
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'grado' AND table_schema = 'public'
ORDER BY ordinal_position;

-- seccion
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'seccion' AND table_schema = 'public'
ORDER BY ordinal_position;

-- estudiante
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'estudiante' AND table_schema = 'public'
ORDER BY ordinal_position;

-- grado_asignatura
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'grado_asignatura' AND table_schema = 'public'
ORDER BY ordinal_position;

-- colegio_asignatura
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'colegio_asignatura' AND table_schema = 'public'
ORDER BY ordinal_position;

-- indicador
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'indicador' AND table_schema = 'public'
ORDER BY ordinal_position;

-- criterio
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'criterio' AND table_schema = 'public'
ORDER BY ordinal_position;

-- asistencia
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'asistencia' AND table_schema = 'public'
ORDER BY ordinal_position;

-- nota
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'nota' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 3. Ver políticas RLS activas
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 4. Ver si RLS está habilitado en cada tabla
SELECT 
    relname AS table_name,
    relrowsecurity AS rls_enabled
FROM pg_class
WHERE relkind = 'r'
AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY relname;

-- 5. Contar registros por tabla
SELECT 
    'ano_lectivo' AS table_name, COUNT(*) AS count FROM ano_lectivo
UNION ALL
SELECT 'corte_evaluativo', COUNT(*) FROM corte_evaluativo
UNION ALL
SELECT 'colegio', COUNT(*) FROM colegio
UNION ALL
SELECT 'asignatura', COUNT(*) FROM asignatura
UNION ALL
SELECT 'grado', COUNT(*) FROM grado
UNION ALL
SELECT 'seccion', COUNT(*) FROM seccion
UNION ALL
SELECT 'estudiante', COUNT(*) FROM estudiante
UNION ALL
SELECT 'indicador', COUNT(*) FROM indicador
UNION ALL
SELECT 'criterio', COUNT(*) FROM criterio
UNION ALL
SELECT 'nota', COUNT(*) FROM nota
UNION ALL
SELECT 'asistencia', COUNT(*) FROM asistencia
ORDER BY table_name;