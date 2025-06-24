-- Agregar campos de auditoría para rastrear expansiones de acrónimos
-- y permitir control sobre expansiones individuales

-- 1. Agregar campos a la tabla de productos
ALTER TABLE productos_1024 
ADD COLUMN IF NOT EXISTS descripcion_original TEXT,
ADD COLUMN IF NOT EXISTS descripcion_expandida TEXT,
ADD COLUMN IF NOT EXISTS expansion_aplicada BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS expansion_bloqueada BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS expansion_fecha TIMESTAMP,
ADD COLUMN IF NOT EXISTS expansion_detalle JSONB;

-- 2. Crear índices para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_productos_expansion_aplicada ON productos_1024(expansion_aplicada);
CREATE INDEX IF NOT EXISTS idx_productos_expansion_bloqueada ON productos_1024(expansion_bloqueada);

-- 3. Crear vista para identificar productos con expansiones
CREATE OR REPLACE VIEW v_productos_expandidos AS
SELECT 
    codigo,
    descripcion,
    descripcion_original,
    descripcion_expandida,
    marca,
    expansion_aplicada,
    expansion_bloqueada,
    expansion_fecha,
    expansion_detalle
FROM productos_1024
WHERE expansion_aplicada = true
ORDER BY expansion_fecha DESC;

-- 4. Función para identificar diferencias entre original y expandido
CREATE OR REPLACE FUNCTION identificar_cambios_expansion(
    texto_original TEXT,
    texto_expandido TEXT
) RETURNS JSONB AS $$
DECLARE
    cambios JSONB := '[]'::jsonb;
    palabra_original TEXT;
    palabra_expandida TEXT;
    arr_original TEXT[];
    arr_expandido TEXT[];
    i INTEGER;
BEGIN
    -- Dividir textos en palabras
    arr_original := string_to_array(UPPER(texto_original), ' ');
    arr_expandido := string_to_array(UPPER(texto_expandido), ' ');
    
    -- Comparar palabra por palabra
    FOR i IN 1..LEAST(array_length(arr_original, 1), array_length(arr_expandido, 1)) LOOP
        IF arr_original[i] != arr_expandido[i] THEN
            cambios := cambios || jsonb_build_object(
                'posicion', i,
                'original', arr_original[i],
                'expandido', arr_expandido[i]
            );
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object(
        'cambios', cambios,
        'total_cambios', jsonb_array_length(cambios)
    );
END;
$$ LANGUAGE plpgsql;

-- 5. Función mejorada para expansión con control y auditoría
CREATE OR REPLACE FUNCTION expand_acronimos_con_auditoria(
    p_codigo VARCHAR,
    p_descripcion TEXT,
    p_force BOOLEAN DEFAULT false
) RETURNS TABLE(
    descripcion_final TEXT,
    fue_expandida BOOLEAN,
    detalle_expansion JSONB
) AS $$
DECLARE
    v_expansion_bloqueada BOOLEAN;
    v_descripcion_expandida TEXT;
    v_cambios JSONB;
BEGIN
    -- Verificar si la expansión está bloqueada para este producto
    SELECT expansion_bloqueada INTO v_expansion_bloqueada
    FROM productos_1024
    WHERE codigo = p_codigo;
    
    -- Si está bloqueada y no se fuerza, retornar original
    IF v_expansion_bloqueada = true AND p_force = false THEN
        RETURN QUERY SELECT 
            p_descripcion,
            false,
            jsonb_build_object('razon', 'expansion_bloqueada');
        RETURN;
    END IF;
    
    -- Realizar expansión
    v_descripcion_expandida := expand_acronimos_contextual(p_descripcion);
    
    -- Si no hubo cambios
    IF v_descripcion_expandida = UPPER(p_descripcion) THEN
        RETURN QUERY SELECT 
            p_descripcion,
            false,
            jsonb_build_object('razon', 'sin_cambios');
        RETURN;
    END IF;
    
    -- Identificar cambios específicos
    v_cambios := identificar_cambios_expansion(p_descripcion, v_descripcion_expandida);
    
    -- Actualizar registro con auditoría
    UPDATE productos_1024 
    SET 
        descripcion_original = COALESCE(descripcion_original, descripcion),
        descripcion_expandida = v_descripcion_expandida,
        expansion_aplicada = true,
        expansion_fecha = CURRENT_TIMESTAMP,
        expansion_detalle = v_cambios
    WHERE codigo = p_codigo;
    
    RETURN QUERY SELECT 
        v_descripcion_expandida,
        true,
        v_cambios;
END;
$$ LANGUAGE plpgsql;

-- 6. Procedimiento para revertir expansiones
CREATE OR REPLACE FUNCTION revertir_expansion(
    p_codigo VARCHAR,
    p_bloquear_futuras BOOLEAN DEFAULT true
) RETURNS BOOLEAN AS $$
DECLARE
    v_descripcion_original TEXT;
BEGIN
    -- Obtener descripción original
    SELECT descripcion_original INTO v_descripcion_original
    FROM productos_1024
    WHERE codigo = p_codigo AND expansion_aplicada = true;
    
    IF v_descripcion_original IS NULL THEN
        RAISE NOTICE 'Producto % no tiene expansión aplicada', p_codigo;
        RETURN false;
    END IF;
    
    -- Revertir a descripción original
    UPDATE productos_1024
    SET 
        descripcion = v_descripcion_original,
        expansion_aplicada = false,
        expansion_bloqueada = p_bloquear_futuras,
        expansion_detalle = expansion_detalle || 
            jsonb_build_object('revertido', CURRENT_TIMESTAMP)
    WHERE codigo = p_codigo;
    
    -- TODO: Regenerar embedding con descripción original
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 7. Queries útiles para administración

-- Ver todos los productos con expansiones aplicadas
-- SELECT * FROM v_productos_expandidos;

-- Ver productos con expansiones bloqueadas
-- SELECT codigo, descripcion, expansion_detalle 
-- FROM productos_1024 
-- WHERE expansion_bloqueada = true;

-- Identificar productos con más cambios por expansión
-- SELECT 
--     codigo,
--     descripcion,
--     descripcion_expandida,
--     (expansion_detalle->>'total_cambios')::int as num_cambios
-- FROM productos_1024
-- WHERE expansion_aplicada = true
-- ORDER BY (expansion_detalle->>'total_cambios')::int DESC;

-- Revertir una expansión específica
-- SELECT revertir_expansion('ABC123', true);

-- Revertir todas las expansiones de una categoría
-- DO $$
-- DECLARE
--     r RECORD;
-- BEGIN
--     FOR r IN SELECT codigo FROM productos_1024 
--              WHERE expansion_aplicada = true 
--              AND descripcion LIKE '%VALVULA%'
--     LOOP
--         PERFORM revertir_expansion(r.codigo, true);
--     END LOOP;
-- END $$;

COMMENT ON COLUMN productos_1024.descripcion_original IS 'Descripción antes de aplicar expansión de acrónimos';
COMMENT ON COLUMN productos_1024.descripcion_expandida IS 'Descripción después de expandir acrónimos';
COMMENT ON COLUMN productos_1024.expansion_aplicada IS 'Indica si se aplicó expansión de acrónimos';
COMMENT ON COLUMN productos_1024.expansion_bloqueada IS 'Si true, no se aplicarán expansiones automáticas';
COMMENT ON COLUMN productos_1024.expansion_detalle IS 'JSON con detalles de qué se expandió';