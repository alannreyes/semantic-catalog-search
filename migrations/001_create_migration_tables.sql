-- Migración 001: Crear tablas para sistema de migración masiva
-- Fecha: 2024-01-15
-- Descripción: Infraestructura para migración desde MS SQL

-- Tabla de control de jobs de migración
CREATE TABLE IF NOT EXISTS migration_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', 
  -- Status: pending, running, paused, completed, failed, cancelled
  source_config JSONB NOT NULL,
  destination_config JSONB NOT NULL,
  processing_config JSONB NOT NULL,
  progress JSONB DEFAULT '{"total": 0, "processed": 0, "errors": 0, "percentage": 0}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_log TEXT[],
  created_by VARCHAR(100) DEFAULT 'system'
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_migration_jobs_status ON migration_jobs(status);
CREATE INDEX IF NOT EXISTS idx_migration_jobs_created_at ON migration_jobs(created_at);

-- Tabla de acrónimos EFC
CREATE TABLE IF NOT EXISTS acronimos (
  id SERIAL PRIMARY KEY,
  acronimo VARCHAR(10) NOT NULL UNIQUE,
  descripcion VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índice para búsqueda rápida de acrónimos
CREATE INDEX IF NOT EXISTS idx_acronimos_acronimo ON acronimos(acronimo) WHERE activo = true;

-- Datos iniciales de acrónimos
INSERT INTO acronimos (acronimo, descripcion) VALUES 
('FENO', 'Fierro Negro'),
('FEGA', 'Fierro Galvanizado')
ON CONFLICT (acronimo) DO NOTHING;

-- Trigger para actualizar updated_at en acronimos
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_acronimos_updated_at 
  BEFORE UPDATE ON acronimos 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Comentarios para documentación
COMMENT ON TABLE migration_jobs IS 'Control de jobs de migración masiva desde MS SQL';
COMMENT ON TABLE acronimos IS 'Mapeo de acrónimos EFC a descripciones completas para embeddings';
COMMENT ON COLUMN acronimos.acronimo IS 'Acrónimo usado en MS SQL (ej: FEGA, FENO)';
COMMENT ON COLUMN acronimos.descripcion IS 'Descripción completa para embedding (ej: Fierro Galvanizado)'; 