# Lógica del Sistema de Búsqueda Semántica - Protocolo Ultra-Restrictivo

## Resumen Ejecutivo

El sistema implementa un protocolo **ultra-restrictivo** para garantizar precisión absoluta en las recomendaciones de productos. Es preferible no dar recomendación que dar una incorrecta, especialmente cuando el usuario especifica marca y/o modelo.

## Flujo Completo del Sistema

### 1. Búsqueda Inicial
```
Usuario: "AGUA DESTILADA P/BATERIA 1GLN VISTONY N.A."
↓
Sistema: Genera embedding → Búsqueda vectorial → 10 candidatos más similares
```

### 2. Sistema de Boosts
Aplica multiplicadores a la similitud base:
- **Boost de Segmento**: 1.30x (premium), 1.20x (standard/economy)
- **Boost de Stock**: 1.25x (si tiene stock)
- **Boost de Acuerdo**: 1.15x (si tiene acuerdo de costos)
- **Boost de Marca**: 1.20x (si la marca coincide con la query)
- **Boost de Modelo**: 1.15x (si el modelo/código coincide)

### 3. Verificación de Umbral
```
SI similarity_ajustada < 0.5:
    → Normalizar query con GPT
    → Reintentar búsqueda
SI NO:
    → Continuar con candidatos actuales
```

### 4. JUICIO FINAL GPT (SIEMPRE SE EJECUTA)

**Prompt Ultra-Restrictivo:**
```
ULTRA-RESTRICTIVE PROTOCOL:
1. **EXACT MATCH REQUIREMENT**: When brand AND model specified, 
   ONLY recommend if BOTH match exactly (95%+ similarity)
2. **AUTOMATIC REJECTION**:
   - Different brand = DISTINTO (no exceptions)
   - Different model without proven equivalence = DISTINTO
3. **ZERO TOLERANCE**: Better no recommendation than wrong recommendation
```

### 5. Validación Final
Si GPT selecciona un producto, se valida nuevamente:
```
"¿Este producto es EXACTAMENTE lo que pidió el usuario?"
- Marca debe coincidir exactamente
- Modelo debe coincidir o ser equivalente documentado
- Función debe ser 100% idéntica
```

### 6. Búsqueda en Alternativas
Si el producto es rechazado, busca en los otros 9 candidatos:
```
ZERO TOLERANCE: If no alternative meets ultra-restrictive criteria, answer "NONE"
```

## Ejemplos Detallados

### Ejemplo 1: Marca Específica ✅
```
Query: "AGUA DESTILADA P/BATERIA 1GLN VISTONY N.A."

Candidatos encontrados:
1. AGUA DESTILADA VISTONY 1 GALÓN - Similarity: 0.92 ✅
2. AGUA DESTILADA VISTONY 4 LITROS - Similarity: 0.90 ✅
3. AGUA DESTILADA TEXACO 1 GALÓN - Similarity: 0.88 ❌
4. AGUA DESTILADA MOBIL 1 GALÓN - Similarity: 0.87 ❌

JUICIO FINAL GPT:
- Evalúa: "Usuario pidió VISTONY específicamente"
- Rechaza: TEXACO y MOBIL (marca diferente)
- Acepta: VISTONY 1 GALÓN (match exacto)
- Acepta: VISTONY 4 LITROS (misma marca, capacidad equivalente)

RESULTADO: Recomienda VISTONY 1 GALÓN
```

### Ejemplo 2: Marca Incorrecta ❌
```
Query: "MARTILLO STANLEY 16 OZ"

Candidatos encontrados:
1. MARTILLO TRUPER 16 OZ - Similarity: 0.85 ❌
2. MARTILLO BLACK&DECKER 16 OZ - Similarity: 0.83 ❌
3. MARTILLO PRETUL 16 OZ - Similarity: 0.80 ❌

JUICIO FINAL GPT:
- Evalúa: "Usuario pidió STANLEY específicamente"
- Rechaza: TODOS (ninguno es marca STANLEY)

VALIDACIÓN FINAL: NO
BÚSQUEDA ALTERNATIVAS: NONE

RESULTADO: NULL (no hay recomendación)
```

### Ejemplo 3: Modelo Específico ✅
```
Query: "PINTURA SHERWIN WILLIAMS SUPERPAINT BLANCO 5 GAL"

Candidatos encontrados:
1. PINTURA SHERWIN WILLIAMS SUPERPAINT BLANCO 5 GAL - Similarity: 0.95 ✅
2. PINTURA SHERWIN WILLIAMS PROMAR 200 BLANCO 5 GAL - Similarity: 0.88 ❌
3. PINTURA SHERWIN WILLIAMS SUPERPAINT BLANCO 1 GAL - Similarity: 0.87 ❌

JUICIO FINAL GPT:
- Evalúa: "Marca SHERWIN WILLIAMS + Modelo SUPERPAINT"
- Acepta: Solo el primero (marca Y modelo exactos)
- Rechaza: PROMAR 200 (modelo diferente)
- Rechaza: 1 GAL (capacidad diferente a la solicitada)

RESULTADO: SUPERPAINT BLANCO 5 GAL
```

### Ejemplo 4: Sin Marca Específica ✅
```
Query: "LLAVE AJUSTABLE 10 PULGADAS"

Candidatos encontrados:
1. LLAVE AJUSTABLE STANLEY 10" - Similarity: 0.90 ✅
2. LLAVE AJUSTABLE TRUPER 10" - Similarity: 0.89 ✅
3. LLAVE AJUSTABLE URREA 10" - Similarity: 0.88 ✅

JUICIO FINAL GPT:
- Evalúa: "No especificó marca"
- Acepta: Cualquiera que cumpla función
- Prioriza: Por score ajustado (boosts)

RESULTADO: El de mayor score (probablemente STANLEY si tiene stock)
```

## Reglas de Decisión

### ACEPTA ✅
1. **Marca exacta** cuando se especifica
2. **Modelo exacto** o equivalente documentado
3. **Función idéntica** al 100%
4. **Sin marca especificada** → acepta cualquier marca

### RECHAZA ❌
1. **Marca diferente** cuando se especifica una
2. **Modelo diferente** sin equivalencia probada
3. **Función diferente** aunque sea similar
4. **Cualquier duda** → mejor rechazar

## Mensajes de Log

### Juicio Final Exitoso
```
"Ejecutando JUICIO FINAL con GPT-4o (ULTRA-RESTRICTIVE PROTOCOL)"
"GPT JUICIO FINAL confirmó selección: 03020535"
```

### Juicio Final con Cambio
```
"GPT JUICIO FINAL cambió selección de 12345 a 03020535"
"reason: GPT override based on ultra-restrictive protocol"
```

### Rechazo Total
```
"GPT JUICIO FINAL: Ningún producto cumple criterios ultra-restrictivos"
"RESULTADO: NULL (no recommendation)"
```

## Configuración de Umbrales

```javascript
// Umbrales de similitud para clasificación
SIMILARITY_EXACTO_THRESHOLD = 0.90        // ≥90% = EXACTO
SIMILARITY_EQUIVALENTE_THRESHOLD = 0.70   // ≥70% = EQUIVALENTE
SIMILARITY_COMPATIBLE_THRESHOLD = 0.88    // ≥88% = COMPATIBLE
SIMILARITY_ALTERNATIVO_THRESHOLD = 0.82   // ≥82% = ALTERNATIVO
// <82% = DISTINTO

// Umbral mínimo para considerar un producto
MINIMUM_SIMILARITY_THRESHOLD = 0.50       // <50% = reintentar con normalización
```

## Principio Fundamental

> **"Es mejor no dar recomendación que dar una recomendación incorrecta"**

Este principio guía todas las decisiones del sistema. Cuando hay duda, el sistema prefiere devolver NULL antes que recomendar un producto que podría no ser exactamente lo que el usuario busca.