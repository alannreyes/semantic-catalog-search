-- Actualizar tabla acronimos para soportar expansión contextual
-- Eliminar restricción UNIQUE del acronimo para permitir múltiples contextos

-- 1. Eliminar el constraint UNIQUE actual
ALTER TABLE acronimos DROP CONSTRAINT IF EXISTS acronimos_acronimo_key;

-- 2. Agregar columna para palabras clave de contexto
ALTER TABLE acronimos ADD COLUMN IF NOT EXISTS palabras_clave TEXT[];

-- 3. Crear índice compuesto para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_acronimos_acronimo_categoria ON acronimos(acronimo, categoria);

-- 4. Actualizar registros existentes y agregar contextos múltiples

-- Actualizar S/C existente para tornillería
UPDATE acronimos 
SET palabras_clave = ARRAY['TORNILLO', 'CLAVO', 'PERNO', 'TIRAFONDO', 'AUTORROSCANTE']
WHERE acronimo = 'S/C' AND categoria = 'TORNILLERIA';

-- Agregar S/C para tubos
INSERT INTO acronimos (acronimo, descripcion, categoria, contexto, palabras_clave) VALUES
('S/C', 'SIN COSTURA', 'TUBOS', 'Tubos y tuberías sin costura', 
 ARRAY['TUBO', 'TUBERIA', 'CAÑO', 'DUCTO', 'CAÑERIA'])
ON CONFLICT DO NOTHING;

-- Actualizar C/C existente para tornillería
UPDATE acronimos 
SET palabras_clave = ARRAY['TORNILLO', 'CLAVO', 'PERNO', 'TIRAFONDO', 'AUTORROSCANTE']
WHERE acronimo = 'C/C' AND categoria = 'TORNILLERIA';

-- Agregar C/C para tubos
INSERT INTO acronimos (acronimo, descripcion, categoria, contexto, palabras_clave) VALUES
('C/C', 'CON COSTURA', 'TUBOS', 'Tubos y tuberías con costura', 
 ARRAY['TUBO', 'TUBERIA', 'CAÑO', 'DUCTO', 'CAÑERIA'])
ON CONFLICT DO NOTHING;

-- Actualizar NO. para considerar contextos donde significa NUMERO
INSERT INTO acronimos (acronimo, descripcion, categoria, contexto, palabras_clave) VALUES
('NO', 'NUMERO', 'MEDIDAS', 'Número de referencia o medida', 
 ARRAY['VALVULA', 'LLAVE', 'BROCA', 'MODELO', 'SERIE', 'REF'])
ON CONFLICT DO NOTHING;

-- Actualizar NO. existente con palabras clave para color negro
UPDATE acronimos 
SET palabras_clave = ARRAY['TORNILLO', 'CLAVO', 'PINTURA', 'SPRAY', 'ACABADO', 'COLOR']
WHERE acronimo = 'NO.' AND descripcion = 'NEGRO';

-- C/ puede ser CON o COLOR según contexto
UPDATE acronimos 
SET palabras_clave = ARRAY['ACABADO', 'PINTURA', 'ESMALTE', 'SPRAY']
WHERE acronimo = 'C/' AND descripcion = 'CON';

INSERT INTO acronimos (acronimo, descripcion, categoria, contexto, palabras_clave) VALUES
('C/', 'COLOR', 'COLORES', 'Indicador de color en productos', 
 ARRAY['PINTURA', 'ESMALTE', 'SPRAY', 'AEROSOL', 'ACABADO'])
ON CONFLICT DO NOTHING;

-- Verificar contextos múltiples
SELECT 
    acronimo,
    descripcion,
    categoria,
    array_to_string(palabras_clave, ', ') as palabras_contexto
FROM acronimos 
WHERE acronimo IN ('S/C', 'C/C', 'NO.', 'NO', 'C/')
ORDER BY acronimo, categoria;

-- Crear función para expandir texto con contexto
CREATE OR REPLACE FUNCTION expand_acronimos_contextual(
    texto_original TEXT
) RETURNS TEXT AS $$
DECLARE
    texto_expandido TEXT := texto_original;
    registro RECORD;
BEGIN
    -- Convertir a mayúsculas para comparación
    texto_expandido := UPPER(texto_expandido);
    
    -- Procesar cada acrónimo según contexto
    FOR registro IN 
        SELECT acronimo, descripcion, palabras_clave 
        FROM acronimos 
        WHERE activo = true 
        ORDER BY LENGTH(acronimo) DESC -- Procesar acrónimos más largos primero
    LOOP
        -- Si hay palabras clave, verificar contexto
        IF registro.palabras_clave IS NOT NULL AND array_length(registro.palabras_clave, 1) > 0 THEN
            -- Verificar si alguna palabra clave está presente
            IF EXISTS (
                SELECT 1 
                FROM unnest(registro.palabras_clave) AS palabra
                WHERE texto_expandido ILIKE '%' || palabra || '%'
            ) THEN
                -- Reemplazar solo si el contexto coincide
                texto_expandido := regexp_replace(
                    texto_expandido, 
                    '\m' || regexp_escape(registro.acronimo) || '\M',
                    registro.descripcion,
                    'gi'
                );
            END IF;
        ELSE
            -- Si no hay palabras clave, reemplazar siempre
            texto_expandido := regexp_replace(
                texto_expandido, 
                '\m' || regexp_escape(registro.acronimo) || '\M',
                registro.descripcion,
                'gi'
            );
        END IF;
    END LOOP;
    
    RETURN texto_expandido;
END;
$$ LANGUAGE plpgsql;

-- Función helper para escapar caracteres especiales en regex
CREATE OR REPLACE FUNCTION regexp_escape(text) RETURNS text AS $$
    SELECT regexp_replace($1, '([.\\+*?[^$(){}=!<>|:-])', '\\\1', 'g');
$$ LANGUAGE sql IMMUTABLE STRICT;

-- Probar la función con ejemplos
SELECT 
    'TORNILLO S/C NO. M6' as original,
    expand_acronimos_contextual('TORNILLO S/C NO. M6') as expandido
UNION ALL
SELECT 
    'TUBO S/C 1/2"',
    expand_acronimos_contextual('TUBO S/C 1/2"')
UNION ALL
SELECT 
    'VALVULA NO 4',
    expand_acronimos_contextual('VALVULA NO 4')
UNION ALL
SELECT 
    'CLAVO S/C 2"',
    expand_acronimos_contextual('CLAVO S/C 2"');