-- ========================================================================
-- TABLA PRODUCTOS_BIP - Sistema de Catálogo Inteligente con IA
-- ========================================================================
-- Propósito: Tabla principal de productos con búsqueda semántica,
-- gestión comercial inteligente e historial de clientes
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
    
    -- ====== FLAGS COMERCIALES (CRÍTICOS) ======
    articulo_stock BOOLEAN DEFAULT false, -- Si es producto de reposición periódica
    lista_costos BOOLEAN DEFAULT false, -- Si tiene acuerdo comercial
    
    -- ====== INFORMACIÓN DE INVENTARIO ======
    stock_actual DECIMAL(10,2) DEFAULT 0,
    stock_minimo DECIMAL(10,2) DEFAULT 0,
    stock_maximo DECIMAL(10,2) DEFAULT 0,
    ubicacion_almacen VARCHAR(50),
    
    -- ====== INFORMACIÓN DE COSTOS Y PRECIOS ======
    precio_lista DECIMAL(12,4),
    precio_costo DECIMAL(12,4),
    margen_utilidad DECIMAL(5,2), -- Porcentaje
    moneda VARCHAR(3) DEFAULT 'PEN',
    
    -- ====== VECTOR EMBEDDING PARA IA ======
    embedding vector(1024), -- OpenAI text-embedding-3-large
    embedding_modelo VARCHAR(50) DEFAULT 'text-embedding-3-large',
    embedding_fecha TIMESTAMP,
    
    -- ====== SCORING Y PRIORIZACIÓN COMERCIAL ======
    prioridad_comercial DECIMAL(4,2) DEFAULT 0, -- 0-10 score calculado
    categoria_comercial VARCHAR(50), -- 'stock_acuerdo', 'solo_stock', 'solo_acuerdo', etc.
    color_categoria VARCHAR(7), -- Hex color: #4CAF50 (verde), etc.
    
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
    tags TEXT[], -- Array de etiquetas
    imagenes TEXT[], -- URLs de imágenes del producto
    
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

-- Índices para flags comerciales
CREATE INDEX idx_productos_bip_stock ON productos_bip(articulo_stock) WHERE articulo_stock = true;
CREATE INDEX idx_productos_bip_costos ON productos_bip(lista_costos) WHERE lista_costos = true;
CREATE INDEX idx_productos_bip_comercial ON productos_bip(articulo_stock, lista_costos);

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

-- Trigger para calcular categoría comercial y color
CREATE OR REPLACE FUNCTION update_categoria_comercial()
RETURNS TRIGGER AS $$
BEGIN
    -- Determinar categoría comercial
    IF NEW.articulo_stock = true AND NEW.lista_costos = true THEN
        NEW.categoria_comercial = 'stock_acuerdo';
        NEW.color_categoria = '#4CAF50'; -- Verde
        NEW.prioridad_comercial = GREATEST(NEW.prioridad_comercial, 9.0);
    ELSIF NEW.articulo_stock = true THEN
        NEW.categoria_comercial = 'solo_stock';
        NEW.color_categoria = '#FFEB3B'; -- Amarillo
        NEW.prioridad_comercial = GREATEST(NEW.prioridad_comercial, 7.0);
    ELSIF NEW.lista_costos = true THEN
        NEW.categoria_comercial = 'solo_acuerdo';
        NEW.color_categoria = '#2196F3'; -- Azul
        NEW.prioridad_comercial = GREATEST(NEW.prioridad_comercial, 6.0);
    ELSE
        NEW.categoria_comercial = 'estandar';
        NEW.color_categoria = '#9E9E9E'; -- Gris
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

-- Vista de productos con información comercial completa
CREATE OR REPLACE VIEW v_productos_comercial AS
SELECT 
    p.*,
    CASE 
        WHEN p.stock_actual > 0 THEN 'DISPONIBLE'
        WHEN p.stock_actual = 0 AND p.articulo_stock = true THEN 'POR REPONER'
        ELSE 'BAJO PEDIDO'
    END as estado_stock,
    CASE 
        WHEN p.margen_utilidad >= 30 THEN 'ALTO'
        WHEN p.margen_utilidad >= 15 THEN 'MEDIO'
        ELSE 'BAJO'
    END as nivel_margen
FROM productos_bip p
WHERE p.activo = true;

-- Vista de productos más vendidos por cliente
CREATE OR REPLACE VIEW v_productos_favoritos_cliente AS
SELECT 
    ch.cliente_id,
    ch.codigo_producto,
    p.descripcion,
    p.categoria_comercial,
    p.color_categoria,
    COUNT(*) as veces_comprado,
    SUM(ch.cantidad) as cantidad_total,
    MAX(ch.fecha_compra) as ultima_compra,
    AVG(ch.precio_unitario) as precio_promedio
FROM cliente_historial_bip ch
JOIN productos_bip p ON ch.codigo_producto = p.codigo
WHERE ch.activo = true AND p.activo = true
GROUP BY ch.cliente_id, ch.codigo_producto, p.descripcion, p.categoria_comercial, p.color_categoria
ORDER BY ch.cliente_id, veces_comprado DESC;

-- ====== FUNCIONES ÚTILES ======

-- Función para calcular prioridad comercial con contexto de cliente
CREATE OR REPLACE FUNCTION calcular_prioridad_cliente(
    p_codigo_producto VARCHAR,
    p_cliente_id VARCHAR,
    p_similaridad DECIMAL DEFAULT 1.0
) RETURNS DECIMAL AS $$
DECLARE
    v_producto RECORD;
    v_historial_count INTEGER;
    v_prioridad DECIMAL;
BEGIN
    -- Obtener datos del producto
    SELECT * INTO v_producto FROM productos_bip WHERE codigo = p_codigo_producto;
    
    -- Base: similaridad
    v_prioridad := p_similaridad * 10; -- Escala 0-10
    
    -- Boost por características comerciales
    IF v_producto.articulo_stock AND v_producto.lista_costos THEN
        v_prioridad := v_prioridad * 1.8; -- Stock + Acuerdo
    ELSIF v_producto.articulo_stock THEN
        v_prioridad := v_prioridad * 1.4; -- Solo stock
    ELSIF v_producto.lista_costos THEN
        v_prioridad := v_prioridad * 1.3; -- Solo acuerdo
    END IF;
    
    -- Boost por historial del cliente
    IF p_cliente_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_historial_count
        FROM cliente_historial_bip
        WHERE cliente_id = p_cliente_id 
        AND codigo_producto = p_codigo_producto
        AND activo = true;
        
        IF v_historial_count > 0 THEN
            v_prioridad := v_prioridad * 1.5; -- Ya compró antes
        END IF;
    END IF;
    
    -- Boost por margen
    IF v_producto.margen_utilidad > 30 THEN
        v_prioridad := v_prioridad * 1.1;
    END IF;
    
    RETURN LEAST(v_prioridad, 10.0); -- Cap en 10
END;
$$ LANGUAGE plpgsql;

-- ====== COMENTARIOS DE DOCUMENTACIÓN ======

COMMENT ON TABLE productos_bip IS 'Tabla principal de productos con búsqueda semántica y gestión comercial inteligente';
COMMENT ON COLUMN productos_bip.articulo_stock IS 'TRUE si es producto de reposición periódica (stock)';
COMMENT ON COLUMN productos_bip.lista_costos IS 'TRUE si tiene acuerdo comercial con proveedor';
COMMENT ON COLUMN productos_bip.prioridad_comercial IS 'Score 0-10 calculado según estrategia comercial';
COMMENT ON COLUMN productos_bip.categoria_comercial IS 'Categorización: stock_acuerdo, solo_stock, solo_acuerdo, estandar';
COMMENT ON COLUMN productos_bip.color_categoria IS 'Color hex para UI: verde=#4CAF50, amarillo=#FFEB3B, azul=#2196F3';
COMMENT ON COLUMN productos_bip.embedding IS 'Vector de 1024 dimensiones generado por OpenAI para búsqueda semántica';

-- ====== DATOS DE EJEMPLO ======

/*
-- Insertar productos de ejemplo
INSERT INTO productos_bip (
    codigo, descripcion, marca, categoria, 
    articulo_stock, lista_costos, 
    precio_lista, precio_costo, margen_utilidad,
    stock_actual, segment
) VALUES 
    ('TORN001', 'TORNILLO HEXAGONAL 1/4 x 2 GALVANIZADO', 'FIXFAST', 'TORNILLERIA', 
     true, true, 0.50, 0.30, 40.00, 1000, 'standard'),
    
    ('VALV002', 'VALVULA ESFERICA 1/2 BRONCE', 'VALTEC', 'VALVULAS', 
     true, false, 25.00, 18.00, 28.00, 50, 'premium'),
    
    ('TUBO003', 'TUBO PVC 1/2 PRESION', 'PAVCO', 'TUBERIA', 
     false, true, 15.00, 11.00, 26.67, 0, 'economy');

-- Insertar historial de ejemplo
INSERT INTO cliente_historial_bip (
    cliente_id, cliente_nombre, codigo_producto, 
    fecha_compra, cantidad, precio_unitario
) VALUES 
    ('CLI001', 'CONSTRUCTORA ABC', 'TORN001', '2024-01-15', 500, 0.48),
    ('CLI001', 'CONSTRUCTORA ABC', 'TORN001', '2024-02-20', 300, 0.49),
    ('CLI002', 'FERRETERIA XYZ', 'VALV002', '2024-03-10', 10, 24.50);
*/

-- ====== PERMISOS ======
-- GRANT SELECT, INSERT, UPDATE ON productos_bip TO tu_usuario_app;
-- GRANT SELECT ON v_productos_comercial TO tu_usuario_app;
-- GRANT EXECUTE ON FUNCTION calcular_prioridad_cliente TO tu_usuario_app;