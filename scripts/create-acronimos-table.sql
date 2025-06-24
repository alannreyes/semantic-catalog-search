-- Crear tabla de acrónimos para expansión de descripciones
-- Base de datos: tic
-- Propósito: Expandir acrónimos antes de generar embeddings para mejorar calidad vectorial

-- Crear tabla acronimos
CREATE TABLE IF NOT EXISTS acronimos (
    id SERIAL PRIMARY KEY,
    acronimo VARCHAR(10) NOT NULL UNIQUE,
    descripcion VARCHAR(100) NOT NULL,
    categoria VARCHAR(50) DEFAULT 'GENERAL',
    contexto VARCHAR(200), -- Para casos donde el contexto importa
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para performance
CREATE INDEX IF NOT EXISTS idx_acronimos_activo ON acronimos(activo);
CREATE INDEX IF NOT EXISTS idx_acronimos_categoria ON acronimos(categoria);
CREATE INDEX IF NOT EXISTS idx_acronimos_acronimo ON acronimos(acronimo);

-- Insertar los 16 acrónimos principales identificados
INSERT INTO acronimos (acronimo, descripcion, categoria, contexto) VALUES
('FO.', 'FIERRO', 'MATERIALES', 'Material base fierro o hierro'),
('NO.', 'NEGRO', 'COLORES', 'Color negro, acabado negro'),
('AC.', 'ACERO', 'MATERIALES', 'Material base acero'),
('FIJAC.', 'FIJACION', 'FUNCIONES', 'Elementos o sistemas de fijación'),
('SP', 'SIMPLE PRESION', 'CONEXIONES', 'Conexión por presión simple'),
('CR', 'CON ROSCA', 'CONEXIONES', 'Conexión roscada'),
('UF', 'UNION FLEXIBLE', 'CONEXIONES', 'Unión flexible'),
('UPR', 'UNION PRESION ROSCA', 'CONEXIONES', 'Unión combinada presión y rosca'),
('PTA.', 'PUNTA', 'COMPONENTES', 'Extremo puntiagudo'),
('JGO', 'JUEGO', 'AGRUPACIONES', 'Conjunto de piezas'),
('M/', 'MANGO', 'COMPONENTES', 'Parte para sujetar'),
('S/C', 'SIN CABEZA', 'TORNILLERIA', 'Tornillo sin cabeza visible'),
('C/C', 'CON CABEZA', 'TORNILLERIA', 'Tornillo con cabeza visible'),
('T/', 'TIPO', 'CLASIFICACION', 'Especificación de tipo'),
('C/', 'CON', 'GENERAL', 'Indica presencia de característica'),
('S/', 'SIN', 'GENERAL', 'Indica ausencia de característica')
ON CONFLICT (acronimo) DO UPDATE SET
    descripcion = EXCLUDED.descripcion,
    categoria = EXCLUDED.categoria,
    contexto = EXCLUDED.contexto,
    updated_at = CURRENT_TIMESTAMP;

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_acronimos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER acronimos_update_updated_at
    BEFORE UPDATE ON acronimos
    FOR EACH ROW
    EXECUTE FUNCTION update_acronimos_updated_at();

-- Verificar datos insertados
SELECT 
    id,
    acronimo,
    descripcion,
    categoria,
    activo,
    created_at
FROM acronimos 
ORDER BY categoria, acronimo;

-- Mostrar estadísticas
SELECT 
    categoria,
    COUNT(*) as total_acronimos,
    COUNT(CASE WHEN activo THEN 1 END) as activos
FROM acronimos 
GROUP BY categoria
ORDER BY categoria;

COMMENT ON TABLE acronimos IS 'Tabla de acrónimos para expansión automática en descripciones de productos antes de generar embeddings';
COMMENT ON COLUMN acronimos.acronimo IS 'Acrónimo tal como aparece en las descripciones (ej: S/C, NO., FO.)';
COMMENT ON COLUMN acronimos.descripcion IS 'Expansión completa del acrónimo (ej: SIN CABEZA, NEGRO, FIERRO)';
COMMENT ON COLUMN acronimos.categoria IS 'Categoría del acrónimo para agrupación lógica';
COMMENT ON COLUMN acronimos.contexto IS 'Descripción del contexto donde aplica el acrónimo';
COMMENT ON COLUMN acronimos.activo IS 'Si el acrónimo está activo para uso en expansiones';