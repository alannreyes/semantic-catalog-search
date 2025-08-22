-- ========================================================================
-- QUERY PARA INSPECCIONAR ESTRUCTURA DE TABLA productos_bip
-- ========================================================================
-- Ejecutar estos queries en PostgreSQL para ver la estructura completa
-- Base de datos: tic
-- ========================================================================

-- 1. ESTRUCTURA BÁSICA DE LA TABLA (Columnas, tipos, nullables)
-- ------------------------------------------------------------------------
SELECT 
    ordinal_position as "#",
    column_name as "Columna",
    data_type as "Tipo",
    CASE 
        WHEN data_type = 'character varying' THEN 
            data_type || '(' || character_maximum_length || ')'
        WHEN data_type = 'numeric' THEN 
            data_type || '(' || numeric_precision || ',' || numeric_scale || ')'
        WHEN data_type = 'USER-DEFINED' AND udt_name = 'vector' THEN
            'vector(1024)'
        ELSE data_type
    END as "Tipo Completo",
    CASE 
        WHEN is_nullable = 'YES' THEN '✓'
        ELSE '✗'
    END as "Nullable",
    column_default as "Valor Default"
FROM information_schema.columns
WHERE table_name = 'productos_bip'
ORDER BY ordinal_position;

-- 2. CONSTRAINTS Y LLAVES
-- ------------------------------------------------------------------------
SELECT 
    tc.constraint_name as "Constraint",
    tc.constraint_type as "Tipo",
    kcu.column_name as "Columna",
    CASE 
        WHEN tc.constraint_type = 'FOREIGN KEY' THEN ccu.table_name || '.' || ccu.column_name
        ELSE NULL
    END as "Referencia"
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'productos_bip'
ORDER BY tc.constraint_type, tc.constraint_name;

-- 3. ÍNDICES DE LA TABLA
-- ------------------------------------------------------------------------
SELECT 
    schemaname as "Schema",
    tablename as "Tabla",
    indexname as "Índice",
    indexdef as "Definición"
FROM pg_indexes
WHERE tablename = 'productos_bip'
ORDER BY indexname;

-- 4. TRIGGERS ASOCIADOS
-- ------------------------------------------------------------------------
SELECT 
    trigger_name as "Trigger",
    event_manipulation as "Evento",
    event_object_table as "Tabla",
    action_timing as "Momento",
    action_statement as "Función"
FROM information_schema.triggers
WHERE event_object_table = 'productos_bip'
ORDER BY trigger_name;

-- 5. ESTADÍSTICAS DE LA TABLA
-- ------------------------------------------------------------------------
SELECT 
    schemaname as "Schema",
    tablename as "Tabla",
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as "Tamaño Total",
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as "Tamaño Datos",
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as "Tamaño Índices",
    n_tup_ins as "Inserciones",
    n_tup_upd as "Actualizaciones",
    n_tup_del as "Eliminaciones",
    n_live_tup as "Filas Activas",
    n_dead_tup as "Filas Muertas",
    last_vacuum as "Último Vacuum",
    last_analyze as "Último Analyze"
FROM pg_stat_user_tables
WHERE tablename = 'productos_bip';

-- 6. COMENTARIOS DE DOCUMENTACIÓN
-- ------------------------------------------------------------------------
SELECT 
    c.column_name as "Columna",
    pgd.description as "Comentario"
FROM pg_catalog.pg_description pgd
JOIN pg_catalog.pg_class pgc ON pgd.objoid = pgc.oid
JOIN information_schema.columns c ON 
    pgc.relname = c.table_name AND 
    pgd.objsubid = c.ordinal_position
WHERE c.table_name = 'productos_bip'
    AND pgd.description IS NOT NULL
ORDER BY c.ordinal_position;

-- 7. RESUMEN DE CATEGORÍAS Y FLAGS COMERCIALES
-- ------------------------------------------------------------------------
SELECT 
    '📊 RESUMEN DE CAMPOS CLAVE' as "Categoría",
    '' as "Información"
UNION ALL
SELECT 
    'Campos de Identificación:',
    'id, codigo, codigo_fabrica'
UNION ALL
SELECT 
    'Campos Comerciales Críticos:',
    'articulo_stock (boolean), lista_costos (boolean)'
UNION ALL
SELECT 
    'Campos de IA/Búsqueda:',
    'embedding (vector 1024D), search_vector (tsvector)'
UNION ALL
SELECT 
    'Campos de Categorización:',
    'categoria_comercial, color_categoria, prioridad_comercial'
UNION ALL
SELECT 
    'Campos de Expansión:',
    'descripcion_original, descripcion_expandida, expansion_aplicada';

-- 8. QUERY PARA VER DISTRIBUCIÓN DE DATOS (si hay datos)
-- ------------------------------------------------------------------------
SELECT 
    'Distribución de Categorías Comerciales' as "Análisis",
    categoria_comercial,
    color_categoria,
    COUNT(*) as cantidad,
    ROUND(AVG(prioridad_comercial)::numeric, 2) as prioridad_promedio
FROM productos_bip
GROUP BY categoria_comercial, color_categoria
ORDER BY cantidad DESC;

-- 9. VERIFICAR SI PGVECTOR ESTÁ INSTALADO
-- ------------------------------------------------------------------------
SELECT 
    extname as "Extensión",
    extversion as "Versión",
    extnamespace::regnamespace as "Schema"
FROM pg_extension
WHERE extname = 'vector';

-- 10. EJEMPLO DE USO DE BÚSQUEDA VECTORIAL
-- ------------------------------------------------------------------------
/*
-- Ejemplo de búsqueda por similitud (requiere embedding de query)
SELECT 
    codigo,
    descripcion,
    marca,
    categoria_comercial,
    1 - (embedding <=> '[vector_de_query_aqui]'::vector) as similitud
FROM productos_bip
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '[vector_de_query_aqui]'::vector
LIMIT 10;
*/

-- ========================================================================
-- NOTAS DE USO:
-- 1. Ejecutar cada sección según lo que necesites inspeccionar
-- 2. La sección 8 solo funciona si hay datos en la tabla
-- 3. Para usar búsqueda vectorial, necesitas generar embeddings primero
-- ========================================================================