-- ========================================================================
-- SISTEMA UNIFICADO DE SCORING COMERCIAL
-- ========================================================================
-- Prioridad absoluta: 1)ClientHistory, 2)Stock, 3)Acuerdo, 4)Segment
-- "Client History mata todo lo demás - reduce riesgo de devolución"
-- ========================================================================

CREATE OR REPLACE FUNCTION calcular_score_comercial_unificado(
    p_codigo_producto VARCHAR,
    p_cliente_id VARCHAR DEFAULT NULL,
    p_similaridad_base DECIMAL DEFAULT 1.0,
    p_segment_solicitado VARCHAR DEFAULT NULL,
    p_product_segment VARCHAR DEFAULT 'standard'
) RETURNS TABLE(
    score_final DECIMAL,
    factores_aplicados JSONB,
    explicacion TEXT
) AS $$
DECLARE
    v_score DECIMAL;
    v_factores JSONB := '{}';
    v_explicacion TEXT := '';
    v_tiene_historial BOOLEAN := false;
    v_tiene_stock BOOLEAN := false;
    v_tiene_acuerdo BOOLEAN := false;
    v_boost_historial DECIMAL := 1.0;
    v_boost_stock DECIMAL := 1.0;
    v_boost_acuerdo DECIMAL := 1.0;
    v_boost_segment DECIMAL := 1.0;
    v_producto RECORD;
BEGIN
    -- Obtener datos del producto
    SELECT articulo_stock, lista_costos 
    INTO v_producto 
    FROM productos_bip 
    WHERE codigo = p_codigo_producto;
    
    -- Inicializar score con similaridad base
    v_score := p_similaridad_base;
    
    -- ================================
    -- 1. HISTORIAL CLIENTE (PRIORITARIO ABSOLUTO)
    -- "Ya se lo vendí antes - reduce riesgo de devolución"
    -- ================================
    IF p_cliente_id IS NOT NULL THEN
        SELECT COUNT(*) > 0 INTO v_tiene_historial
        FROM cliente_historial_bip
        WHERE cliente_id = p_cliente_id 
        AND codigo_producto = p_codigo_producto
        AND activo = true;
        
        IF v_tiene_historial THEN
            v_boost_historial := 1.50; -- +50% BOOST FUERTE
            v_factores := v_factores || jsonb_build_object('historial_cliente', '+50%');
            v_explicacion := v_explicacion || 'HISTORIAL: Cliente ya compró este producto (+50%). ';
        END IF;
    END IF;
    
    -- ================================
    -- 2. PRODUCTO EN STOCK (Alta rotación)
    -- "Muy probable que esté disponible"
    -- ================================
    v_tiene_stock := COALESCE(v_producto.articulo_stock, false);
    IF v_tiene_stock THEN
        v_boost_stock := 1.25; -- +25% boost
        v_factores := v_factores || jsonb_build_object('alta_rotacion', '+25%');
        v_explicacion := v_explicacion || 'STOCK: Producto de alta rotación (+25%). ';
    END IF;
    
    -- ================================
    -- 3. ACUERDO COMERCIAL (Mejor margen)
    -- "Mejor rentabilidad para la empresa"
    -- ================================
    v_tiene_acuerdo := COALESCE(v_producto.lista_costos, false);
    IF v_tiene_acuerdo THEN
        v_boost_acuerdo := 1.15; -- +15% boost
        v_factores := v_factores || jsonb_build_object('acuerdo_comercial', '+15%');
        v_explicacion := v_explicacion || 'ACUERDO: Mejor margen comercial (+15%). ';
    END IF;
    
    -- ================================
    -- 4. SEGMENTO (Estrategia de precios)
    -- "Alineado con estrategia comercial"
    -- ================================
    IF p_segment_solicitado IS NOT NULL AND p_product_segment IS NOT NULL THEN
        IF p_product_segment = p_segment_solicitado THEN
            v_boost_segment := 1.12; -- +12% boost
            v_factores := v_factores || jsonb_build_object('segmento_exacto', '+12%');
            v_explicacion := v_explicacion || FORMAT('SEGMENTO: Coincide con %s solicitado (+12%). ', p_segment_solicitado);
        ELSIF (
            (p_segment_solicitado = 'premium' AND p_product_segment = 'standard') OR
            (p_segment_solicitado = 'economy' AND p_product_segment = 'standard') OR
            (p_segment_solicitado = 'standard' AND p_product_segment IN ('premium', 'economy'))
        ) THEN
            v_boost_segment := 1.08; -- +8% boost compatible
            v_factores := v_factores || jsonb_build_object('segmento_compatible', '+8%');
            v_explicacion := v_explicacion || FORMAT('SEGMENTO: Compatible %s->%s (+8%). ', p_product_segment, p_segment_solicitado);
        END IF;
    END IF;
    
    -- ================================
    -- CÁLCULO FINAL CON LÍMITE
    -- ================================
    v_score := v_score * v_boost_historial * v_boost_stock * v_boost_acuerdo * v_boost_segment;
    
    -- Aplicar límite máximo de 1.0 para evitar saturación
    v_score := LEAST(v_score, 1.0);
    
    -- Agregar información adicional a factores
    v_factores := v_factores || jsonb_build_object(
        'score_base', p_similaridad_base,
        'score_final', v_score,
        'boost_total', ROUND((v_score / p_similaridad_base - 1.0) * 100, 1) || '%'
    );
    
    RETURN QUERY SELECT v_score, v_factores, TRIM(v_explicacion);
END;
$$ LANGUAGE plpgsql;

-- ========================================================================
-- TABLA DE EJEMPLOS Y CASOS DE USO
-- ========================================================================

/*
EJEMPLOS DE SCORING:

1. CLIENTE CON HISTORIAL (GANA SIEMPRE):
   Base: 0.70, Historial: SÍ, Stock: SÍ, Acuerdo: SÍ, Segment: Exacto
   Score: 0.70 × 1.50 × 1.25 × 1.15 × 1.12 = 1.69 → 1.0
   
2. PRODUCTO ÓPTIMO SIN HISTORIAL:
   Base: 0.95, Historial: NO, Stock: SÍ, Acuerdo: SÍ, Segment: Exacto
   Score: 0.95 × 1.0 × 1.25 × 1.15 × 1.12 = 1.53 → 1.0
   
3. PRODUCTO ESTÁNDAR CON HISTORIAL:
   Base: 0.80, Historial: SÍ, Stock: NO, Acuerdo: NO, Segment: NO
   Score: 0.80 × 1.50 × 1.0 × 1.0 × 1.0 = 1.20 → 1.0
   
4. PRODUCTO ESTÁNDAR SIN VENTAJAS:
   Base: 0.95, Historial: NO, Stock: NO, Acuerdo: NO, Segment: NO
   Score: 0.95 × 1.0 × 1.0 × 1.0 × 1.0 = 0.95

CONCLUSIÓN: El historial del cliente siempre gana, incluso con menor similaridad
*/

-- ========================================================================
-- FUNCIÓN SIMPLIFICADA PARA INTEGRACIÓN CON SEARCH SERVICE
-- ========================================================================

CREATE OR REPLACE FUNCTION boost_producto_comercial(
    p_similaridad DECIMAL,
    p_codigo_producto VARCHAR,
    p_cliente_id VARCHAR DEFAULT NULL,
    p_segment_solicitado VARCHAR DEFAULT NULL
) RETURNS DECIMAL AS $$
DECLARE
    v_result RECORD;
BEGIN
    SELECT score_final INTO v_result
    FROM calcular_score_comercial_unificado(
        p_codigo_producto, 
        p_cliente_id, 
        p_similaridad, 
        p_segment_solicitado,
        (SELECT segment FROM productos_bip WHERE codigo = p_codigo_producto)
    );
    
    RETURN COALESCE(v_result.score_final, p_similaridad);
END;
$$ LANGUAGE plpgsql;

-- ========================================================================
-- VISTA PARA ANÁLISIS DE SCORING
-- ========================================================================

CREATE OR REPLACE VIEW v_analisis_scoring AS
SELECT 
    p.codigo,
    p.descripcion,
    p.marca,
    p.segment,
    p.articulo_stock,
    p.lista_costos,
    p.categoria_comercial,
    p.color_categoria,
    -- Calcular scores para diferentes escenarios
    boost_producto_comercial(0.95, p.codigo, NULL, NULL) as score_sin_ventajas,
    boost_producto_comercial(0.95, p.codigo, 'CLI001', NULL) as score_con_historial,
    boost_producto_comercial(0.95, p.codigo, NULL, p.segment) as score_con_segment,
    boost_producto_comercial(0.95, p.codigo, 'CLI001', p.segment) as score_completo
FROM productos_bip p
WHERE p.activo = true
ORDER BY score_completo DESC;

-- ========================================================================
-- EJEMPLOS DE USO EN QUERIES
-- ========================================================================

/*
-- Búsqueda con scoring comercial
WITH productos_candidatos AS (
    SELECT 
        codigo,
        descripcion,
        marca,
        segment,
        articulo_stock,
        lista_costos,
        1 - (embedding <=> $1::vector) as similaridad_base
    FROM productos_bip
    WHERE activo = true
    ORDER BY embedding <=> $1::vector
    LIMIT 20
)
SELECT 
    *,
    boost_producto_comercial(
        similaridad_base, 
        codigo, 
        'CLI001',  -- ID del cliente
        'premium'  -- Segmento solicitado
    ) as score_comercial
FROM productos_candidatos
ORDER BY score_comercial DESC
LIMIT 5;

-- Análisis detallado de factores
SELECT 
    codigo,
    descripcion,
    (calcular_score_comercial_unificado(codigo, 'CLI001', 0.95, 'premium')).*
FROM productos_bip
WHERE codigo IN ('PROD001', 'PROD002', 'PROD003')
ORDER BY score_final DESC;
*/