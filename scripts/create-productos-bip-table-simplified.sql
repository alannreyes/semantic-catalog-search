-- ========================================================================
-- TABLA PRODUCTOS_BIP - Sistema de Catálogo Inteligente con IA
-- ========================================================================
-- Propósito: Tabla principal de productos con búsqueda semántica
-- e indicadores comerciales para priorización inteligente
-- Base de datos: tic
-- Fecha: Junio 2025
-- ========================================================================

-- Eliminar tabla si existe (CUIDADO en producción)
-- DROP TABLE IF EXISTS productos_bip CASCADE;

-- Crear extensión pgvector si no existe
CREATE EXTENSION IF NOT EXISTS vector;

-- Crear tabla principal de productos
CREATE TABLE productos_bip (
    -- ====== IDENTIFICADORES PRIMARIOS ======
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    codigo_fabrica VARCHAR(100),
    
    -- ====== INFORMACIÓN DESCRIPTIVA ======
    descripcion TEXT NOT NULL,
    descripcion_original TEXT, -- Antes de expansión de acrónimos
    descripcion_expandida TEXT, -- Después de expansión
    marca VARCHAR(100),
    unidad_medida VARCHAR(20) DEFAULT 'UND',
    
    -- ====== CATEGORIZACIÓN Y SEGMENTACIÓN ======
    categoria VARCHAR(100),
    subcategoria VARCHAR(100),
    familia VARCHAR(50),
    segment VARCHAR(20) DEFAULT 'standard' CHECK (segment IN ('premium', 'standard', 'economy')),
    
    -- ====== INDICADORES COMERCIALES ESTRATÉGICOS ======
    articulo_stock BOOLEAN DEFAULT false, -- TRUE = Alta rotación, siempre en reposición
    lista_costos BOOLEAN DEFAULT false,   -- TRUE = Tiene acuerdo comercial (mejor margen)
    
    -- ====== PRECIOS (Solo referencial, no inventario) ======
    precio_lista DECIMAL(12,4),
    precio_costo DECIMAL(12,4),
    margen_utilidad DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE 
            WHEN precio_costo > 0 AND precio_lista > 0 
            THEN ((precio_lista - precio_costo) / precio_costo * 100)
            ELSE 0
        END
    ) STORED,
    moneda VARCHAR(3) DEFAULT 'PEN',
    
    -- ====== VECTOR EMBEDDING PARA IA ======
    embedding vector(1024), -- OpenAI text-embedding-3-large
    embedding_modelo VARCHAR(50) DEFAULT 'text-embedding-3-large',
    embedding_fecha TIMESTAMP,
    
    -- ====== SCORING Y PRIORIZACIÓN COMERCIAL ======
    prioridad_comercial DECIMAL(4,2) DEFAULT 5.0, -- 0-10 score base
    categoria_comercial VARCHAR(50), -- 'alta_rotacion_acuerdo', 'alta_rotacion', 'con_acuerdo', 'estandar'
    color_categoria VARCHAR(7), -- Hex color para UI
    
    -- ====== CONTROL DE EXPANSIÓN DE ACRÓNIMOS ======
    expansion_aplicada BOOLEAN DEFAULT false,
    expansion_bloqueada BOOLEAN DEFAULT false,
    expansion_fecha TIMESTAMP,
    expansion_detalle JSONB,
    
    -- ====== METADATOS Y AUDITORÍA ======
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion VARCHAR(100),
    usuario_actualizacion VARCHAR(100),
    
    -- ====== DATOS ADICIONALES ======
    metadata JSONB, -- Para campos flexibles futuros
    tags TEXT[], -- Array de etiquetas para búsqueda
    
    -- ====== ÍNDICES DE BÚSQUEDA FULLTEXT ======
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', COALESCE(codigo, '')), 'A') ||
        setweight(to_tsvector('spanish', COALESCE(descripcion_expandida, descripcion, '')), 'B') ||
        setweight(to_tsvector('spanish', COALESCE(marca, '')), 'C') ||
        setweight(to_tsvector('spanish', COALESCE(categoria, '')), 'D')
    ) STORED
);

-- ====== ÍNDICES PARA PERFORMANCE ======

-- Índice vectorial para búsqueda semántica (IVFFlat)
CREATE INDEX idx_productos_bip_embedding ON productos_bip 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100); -- Ajustar según cantidad de productos

-- Índices para búsquedas frecuentes
CREATE INDEX idx_productos_bip_codigo ON productos_bip(codigo);
CREATE INDEX idx_productos_bip_marca ON productos_bip(marca);
CREATE INDEX idx_productos_bip_categoria ON productos_bip(categoria);
CREATE INDEX idx_productos_bip_segment ON productos_bip(segment);
CREATE INDEX idx_productos_bip_activo ON productos_bip(activo);

-- Índices para indicadores comerciales
CREATE INDEX idx_productos_bip_alta_rotacion ON productos_bip(articulo_stock) WHERE articulo_stock = true;
CREATE INDEX idx_productos_bip_con_acuerdo ON productos_bip(lista_costos) WHERE lista_costos = true;
CREATE INDEX idx_productos_bip_indicadores ON productos_bip(articulo_stock, lista_costos);

-- Índice para búsqueda fulltext
CREATE INDEX idx_productos_bip_search ON productos_bip USING GIN(search_vector);

-- Índice para prioridad comercial
CREATE INDEX idx_productos_bip_prioridad ON productos_bip(prioridad_comercial DESC);

-- ====== TRIGGERS ======

-- Trigger para actualizar fecha de modificación
CREATE OR REPLACE FUNCTION update_productos_bip_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_actualizacion = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productos_bip_update_timestamp
    BEFORE UPDATE ON productos_bip
    FOR EACH ROW
    EXECUTE FUNCTION update_productos_bip_timestamp();

-- Trigger para calcular categoría comercial y color basado en indicadores
CREATE OR REPLACE FUNCTION update_categoria_comercial()
RETURNS TRIGGER AS $$
BEGIN
    -- Categorización basada en indicadores de alta rotación y acuerdos
    IF NEW.articulo_stock = true AND NEW.lista_costos = true THEN
        NEW.categoria_comercial = 'alta_rotacion_acuerdo';
        NEW.color_categoria = '#4CAF50'; -- Verde - ÓPTIMO (alta rotación + mejor margen)
        NEW.prioridad_comercial = GREATEST(NEW.prioridad_comercial, 9.0);
    ELSIF NEW.articulo_stock = true THEN
        NEW.categoria_comercial = 'alta_rotacion';
        NEW.color_categoria = '#FFEB3B'; -- Amarillo - MUY BUENO (alta rotación)
        NEW.prioridad_comercial = GREATEST(NEW.prioridad_comercial, 7.5);
    ELSIF NEW.lista_costos = true THEN
        NEW.categoria_comercial = 'con_acuerdo';
        NEW.color_categoria = '#2196F3'; -- Azul - BUENO (mejor margen)
        NEW.prioridad_comercial = GREATEST(NEW.prioridad_comercial, 6.5);
    ELSE
        NEW.categoria_comercial = 'estandar';
        NEW.color_categoria = '#9E9E9E'; -- Gris - ESTÁNDAR
        -- Prioridad se mantiene en el valor base
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productos_bip_categoria_comercial
    BEFORE INSERT OR UPDATE ON productos_bip
    FOR EACH ROW
    EXECUTE FUNCTION update_categoria_comercial();

-- ====== TABLA DE HISTORIAL DE CLIENTES ======

CREATE TABLE IF NOT EXISTS cliente_historial_bip (
    id SERIAL PRIMARY KEY,
    cliente_id VARCHAR(50) NOT NULL,
    cliente_nombre VARCHAR(200),
    codigo_producto VARCHAR(50) NOT NULL,
    fecha_compra DATE NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    precio_unitario DECIMAL(12,4),
    total DECIMAL(12,2),
    moneda VARCHAR(3) DEFAULT 'PEN',
    numero_documento VARCHAR(50), -- Factura/Boleta
    vendedor VARCHAR(100),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (codigo_producto) REFERENCES productos_bip(codigo)
);

-- Índices para historial
CREATE INDEX idx_cliente_hist_cliente ON cliente_historial_bip(cliente_id);
CREATE INDEX idx_cliente_hist_producto ON cliente_historial_bip(codigo_producto);
CREATE INDEX idx_cliente_hist_fecha ON cliente_historial_bip(fecha_compra DESC);
CREATE INDEX idx_cliente_hist_combo ON cliente_historial_bip(cliente_id, codigo_producto);

-- ====== VISTAS ÚTILES ======

-- Vista de productos con indicadores comerciales
CREATE OR REPLACE VIEW v_productos_comercial AS
SELECT 
    p.*,
    CASE 
        WHEN p.articulo_stock = true THEN 'ALTA ROTACIÓN'
        ELSE 'BAJO PEDIDO'
    END as tipo_disponibilidad,
    CASE 
        WHEN p.lista_costos = true THEN 'CON ACUERDO'
        ELSE 'PRECIO ESTÁNDAR'
    END as tipo_precio,
    CASE 
        WHEN p.articulo_stock = true AND p.lista_costos = true THEN 'ÓPTIMO'
        WHEN p.articulo_stock = true THEN 'RECOMENDADO'
        WHEN p.lista_costos = true THEN 'BUEN PRECIO'
        ELSE 'ESTÁNDAR'
    END as recomendacion
FROM productos_bip p
WHERE p.activo = true;

-- Vista de productos más vendidos por cliente
CREATE OR REPLACE VIEW v_productos_favoritos_cliente AS
SELECT 
    ch.cliente_id,
    ch.codigo_producto,
    p.descripcion,
    p.marca,
    p.categoria_comercial,
    p.color_categoria,
    p.articulo_stock,
    p.lista_costos,
    COUNT(*) as veces_comprado,
    SUM(ch.cantidad) as cantidad_total,
    MAX(ch.fecha_compra) as ultima_compra,
    AVG(ch.precio_unitario) as precio_promedio
FROM cliente_historial_bip ch
JOIN productos_bip p ON ch.codigo_producto = p.codigo
WHERE ch.activo = true AND p.activo = true
GROUP BY ch.cliente_id, ch.codigo_producto, p.descripcion, p.marca, 
         p.categoria_comercial, p.color_categoria, p.articulo_stock, p.lista_costos
ORDER BY ch.cliente_id, veces_comprado DESC;

-- ====== FUNCIÓN PARA SCORING INTELIGENTE ======

-- Función mejorada para calcular prioridad con contexto
CREATE OR REPLACE FUNCTION calcular_score_busqueda(
    p_codigo_producto VARCHAR,
    p_cliente_id VARCHAR DEFAULT NULL,
    p_similaridad_coseno DECIMAL DEFAULT 1.0
) RETURNS DECIMAL AS $$
DECLARE
    v_producto RECORD;
    v_historial_count INTEGER;
    v_score DECIMAL;
BEGIN
    -- Obtener datos del producto
    SELECT * INTO v_producto FROM productos_bip WHERE codigo = p_codigo_producto;
    
    -- Score base: similaridad del embedding (0-1) convertida a escala 0-10
    v_score := p_similaridad_coseno * 10;
    
    -- BOOST PRINCIPAL: Productos de alta rotación (siempre en stock o en reposición)
    IF v_producto.articulo_stock = true THEN
        -- Si es alta rotación Y tiene acuerdo = ÓPTIMO
        IF v_producto.lista_costos = true THEN
            v_score := v_score * 1.8; -- +80% boost (alta probabilidad de tener + mejor margen)
        ELSE
            v_score := v_score * 1.5; -- +50% boost (alta probabilidad de tener)
        END IF;
    ELSIF v_producto.lista_costos = true THEN
        v_score := v_score * 1.3; -- +30% boost (mejor margen pero no necesariamente en stock)
    END IF;
    
    -- BOOST ADICIONAL: Historial del cliente (lo ha comprado antes)
    IF p_cliente_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_historial_count
        FROM cliente_historial_bip
        WHERE cliente_id = p_cliente_id 
        AND codigo_producto = p_codigo_producto
        AND activo = true;
        
        IF v_historial_count > 0 THEN
            v_score := v_score * 1.4; -- +40% boost (cliente ya conoce el producto)
        END IF;
    END IF;
    
    -- Limitar score máximo a 10
    RETURN LEAST(v_score, 10.0);
END;
$$ LANGUAGE plpgsql;

-- ====== COMENTARIOS DE DOCUMENTACIÓN ======

COMMENT ON TABLE productos_bip IS 'Tabla principal de productos con búsqueda semántica e indicadores comerciales';
COMMENT ON COLUMN productos_bip.articulo_stock IS 'TRUE = Producto de ALTA ROTACIÓN, siempre en proceso de reposición. Aumenta probabilidad de disponibilidad';
COMMENT ON COLUMN productos_bip.lista_costos IS 'TRUE = Tiene ACUERDO COMERCIAL con proveedor. Mejor margen de utilidad';
COMMENT ON COLUMN productos_bip.prioridad_comercial IS 'Score 0-10 para ordenamiento. Se calcula automáticamente según indicadores';
COMMENT ON COLUMN productos_bip.categoria_comercial IS 'Categorización automática: alta_rotacion_acuerdo (óptimo), alta_rotacion, con_acuerdo, estandar';
COMMENT ON COLUMN productos_bip.color_categoria IS 'Color para UI: Verde=Óptimo (stock+acuerdo), Amarillo=Alta rotación, Azul=Con acuerdo, Gris=Estándar';

-- ====== DATOS DE EJEMPLO ======

/*
-- Ejemplo de cómo los indicadores afectan la búsqueda:

-- Caso: Búsqueda "pilas alcalinas duracell"
-- Resultados con similaridad coseno similar (~0.95):

INSERT INTO productos_bip (codigo, descripcion, marca, articulo_stock, lista_costos, precio_lista) VALUES 
    -- Este saldría PRIMERO (verde - score ~17.1)
    ('PIL001', 'PILAS ALCALINAS DURACELL AA BLISTER X4', 'DURACELL', true, true, 12.50),
    
    -- Este saldría SEGUNDO (amarillo - score ~14.25)  
    ('PIL002', 'PILAS ALCALINAS DURACELL AA BLISTER X2', 'DURACELL', true, false, 6.90),
    
    -- Este saldría TERCERO (azul - score ~12.35)
    ('PIL003', 'PILAS ALCALINAS DURACELL AAA BLISTER X4', 'DURACELL', false, true, 11.90),
    
    -- Este saldría ÚLTIMO (gris - score ~9.5)
    ('PIL004', 'PILAS ALCALINAS DURACELL 9V BLISTER X1', 'DURACELL', false, false, 18.50);

-- La IA priorizará PIL001 porque:
-- 1. Alta rotación = muy probable que esté disponible
-- 2. Con acuerdo = mejor margen para la empresa
-- 3. Es el producto comercialmente más conveniente
*/

-- ====== QUERY DE EJEMPLO PARA BÚSQUEDA ======

/*
-- Búsqueda inteligente con scoring comercial
WITH busqueda AS (
    SELECT 
        p.codigo,
        p.descripcion,
        p.marca,
        p.categoria_comercial,
        p.color_categoria,
        p.articulo_stock,
        p.lista_costos,
        1 - (p.embedding <=> '[vector_del_query]'::vector) as similaridad
    FROM productos_bip p
    WHERE p.activo = true
    ORDER BY p.embedding <=> '[vector_del_query]'::vector
    LIMIT 20
)
SELECT 
    *,
    calcular_score_busqueda(codigo, 'CLI001', similaridad) as score_final
FROM busqueda
ORDER BY score_final DESC
LIMIT 5;
*/