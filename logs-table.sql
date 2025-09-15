-- Crear tabla de logs para el sistema de semantic catalog search
-- Ejecutar este SQL en la base de datos PostgreSQL antes del despliegue

CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    endpoint VARCHAR(32) NOT NULL,
    body JSONB NOT NULL,
    resultado JSONB NOT NULL
);

-- Crear índices para mejorar rendimiento de consultas
CREATE INDEX IF NOT EXISTS idx_logs_fecha ON logs(fecha);
CREATE INDEX IF NOT EXISTS idx_logs_endpoint ON logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_logs_fecha_endpoint ON logs(fecha, endpoint);

-- Comentarios para documentación
COMMENT ON TABLE logs IS 'Tabla para almacenar logs de consultas del API de búsqueda semántica';
COMMENT ON COLUMN logs.endpoint IS 'Nombre del endpoint que generó el log (search, ismatch, simil, searchv2)';
COMMENT ON COLUMN logs.body IS 'Parámetros de entrada de la consulta en formato JSON';
COMMENT ON COLUMN logs.resultado IS 'Resultado de la consulta en formato JSON';