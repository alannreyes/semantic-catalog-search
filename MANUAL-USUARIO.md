# Manual de Usuario - Sistema de Búsqueda Semántica de Productos

## 📋 Tabla de Contenidos
1. [Descripción General](#descripción-general)
2. [Características Principales](#características-principales)
3. [API Endpoints](#api-endpoints)
4. [Sistema de Boost](#sistema-de-boost)
5. [Configuración](#configuración)
6. [Ejemplos de Uso](#ejemplos-de-uso)
7. [Solución de Problemas](#solución-de-problemas)

## 📝 Descripción General

El Sistema de Búsqueda Semántica de Productos es una API avanzada que utiliza inteligencia artificial para encontrar productos de manera inteligente. A diferencia de las búsquedas tradicionales por palabras clave, este sistema entiende el **contexto y significado** de las consultas.

### ¿Cómo funciona?

1. **Embeddings con OpenAI**: Convierte las búsquedas en vectores matemáticos que capturan el significado
2. **Búsqueda Vectorial**: Usa PostgreSQL con pgvector para encontrar productos similares semánticamente
3. **Sistema de Boost**: Prioriza productos según inventario, acuerdos comerciales y marcas
4. **Clasificación Inteligente**: Categoriza resultados como EXACTO, EQUIVALENTE, COMPATIBLE o ALTERNATIVO

## 🚀 Características Principales

### 1. **Búsqueda Semántica Inteligente**
- Entiende sinónimos y variaciones ("lapicero" = "bolígrafo" = "pluma")
- Corrige errores ortográficos automáticamente
- Expande abreviaciones ("pila AAA" → encuentra "batería AAA alcalina")

### 2. **Sistema de Boost Multinivel**
- **Boost por Stock**: Prioriza productos disponibles (+15%)
- **Boost por Marca**: Favorece marcas mencionadas específicamente (+10%)
- **Boost por Segmento**: Ajusta según calidad (premium/standard/economy)
- **Boost por Acuerdos**: Prioriza proveedores con convenios (+8%)

### 3. **Clasificación de Similitud**
- **EXACTO**: Coincidencia perfecta (>90% similitud)
- **EQUIVALENTE**: Mismo propósito, diferente presentación (>70%)
- **COMPATIBLE**: Puede servir para el mismo uso (>60%)
- **ALTERNATIVO**: Opción relacionada (>50%)

### 4. **Normalización Inteligente**
- Si no encuentra resultados buenos, reformula la búsqueda con GPT-4
- Maneja términos técnicos y coloquiales
- Expande búsquedas muy específicas

## 🔌 API Endpoints

### 1. **POST /search** - Búsqueda Principal

Endpoint principal para búsqueda de productos con IA.

**URL**: `POST http://api.example.com/search`

**Headers**:
```json
{
  "Content-Type": "application/json"
}
```

**Body**:
```json
{
  "query": "texto de búsqueda",
  "limit": 10,
  "segment": "premium"
}
```

**Parámetros**:
- `query` (string, requerido): Texto de búsqueda
- `limit` (number, opcional): Cantidad de resultados (default: 5, max: 20)
- `segment` (string, opcional): Filtro por segmento ("premium", "standard", "economy")

**Respuesta Exitosa (200 OK)**:
```json
{
  "query_info": {
    "similitud": "EXACTO",
    "total_candidates": 10,
    "search_time_ms": 156
  },
  "selected_product": {
    "codigo": "02010085",
    "descripcion": "BROCHA NYLON 4\" TRUPER 14486",
    "marca": "TRUPER",
    "segment": "economy",
    "has_stock": true,
    "has_cost_agreement": true,
    "boost_total_percent": 46,
    "boost_reasons": ["segment", "stock", "cost", "brand"]
  },
  "alternatives": [
    {
      "codigo": "02010085",
      "descripcion": "BROCHA NYLON 4\" TRUPER 14486",
      "marca": "TRUPER",
      "rank": 1,
      "has_stock": true,
      "has_cost_agreement": true,
      "segment": "economy",
      "boost_percent": 46,
      "boost_tags": ["segment", "stock", "cost", "brand"]
    },
    // ... más alternativas
  ],
  "boost_summary": {
    "products_with_stock": ["02010085", "02010032"],
    "products_with_pricing": ["02010085", "02010032", "02010086"],
    "segment_matches": ["02010085", "02010086"],
    "boost_weights_used": {
      "segmentPreferred": 1.05,
      "segmentCompatible": 1.03,
      "stock": 1.15,
      "costAgreement": 1.08,
      "brandExact": 1.10
    }
  },
  "selection_method": "boost_ranking",
  "timings": {
    "embedding_time_ms": 245.5,
    "vector_search_time_ms": 156.3,
    "gpt_selection_time_ms": 0,
    "total_time_ms": 412.8
  },
  "normalizado": null
}
```

### 2. **GET /debug/config** - Verificar Configuración

Endpoint para verificar la configuración actual del servicio.

**URL**: `GET http://api.example.com/debug/config`

**Respuesta**:
```json
{
  "productTable": "productos_bip",
  "embeddingModel": "text-embedding-3-large",
  "vectorDimensions": 1024,
  "probes": 80,
  "databaseUrl": "postgres://postgres:***@localhost:5432/tic",
  "nodeEnv": "production",
  "openaiKeyPrefix": "sk-proj-zq..."
}
```

### 3. **POST /vision/analyze** - Análisis de Imágenes (Si está habilitado)

Analiza imágenes de productos usando GPT-4 Vision.

**URL**: `POST http://api.example.com/vision/analyze`

**Body**:
```json
{
  "imageUrl": "https://example.com/product.jpg",
  "prompt": "Describe este producto"
}
```

## ⚡ Sistema de Boost

### Cómo Funciona el Boost

Los boosts son multiplicadores que se aplican a la similitud base:

```
Similitud Final = Similitud Base × Boost Segmento × Boost Stock × Boost Costo × Boost Marca
```

### Tipos de Boost

1. **Boost por Segmento**
   - Segmento preferido exacto: +5% (configurable)
   - Segmento compatible: +3% (configurable)
   
2. **Boost por Stock**
   - Producto en inventario: +15% (configurable)
   
3. **Boost por Acuerdo de Costos**
   - Proveedor con convenio: +8% (configurable)
   
4. **Boost por Marca Específica**
   - Marca mencionada en búsqueda: +10% (configurable)
   
5. **Boost por Modelo** (Implementado, pendiente activar)
   - Código de fábrica mencionado: +8% (configurable)

### Ejemplo de Cálculo

Búsqueda: "brocha TRUPER 4 pulgadas"

Producto TRUPER sin stock:
- Base: 0.85 similitud
- Boost segmento economy: ×1.03 = 0.8755
- Boost acuerdo costos: ×1.08 = 0.9456
- Boost marca TRUPER: ×1.10 = 1.0401
- **Final**: 1.00 (máximo 1.0)

## ⚙️ Configuración

### Variables de Entorno Principales

```bash
# Base de datos PostgreSQL con pgvector
DATABASE_URL=postgres://user:pass@host:5432/dbname

# OpenAI API
OPENAI_API_KEY=sk-proj-xxxxx

# Puerto del servidor
PORT=4000

# Configuración de vectores
VECTOR_DIMENSIONS=1024
PGVECTOR_PROBES=80

# Sistema de Boost
BOOST_SEGMENT_PREFERRED=1.05    # +5% segmento preferido
BOOST_SEGMENT_COMPATIBLE=1.03   # +3% segmento compatible
BOOST_STOCK=1.15                # +15% productos en stock
BOOST_COST_AGREEMENT=1.08       # +8% acuerdos comerciales
BOOST_BRAND_EXACT=1.10          # +10% marca específica
BOOST_MODEL_EXACT=1.08          # +8% modelo específico

# Umbrales de Clasificación
SIMILARITY_EXACTO_THRESHOLD=0.90        # >90% = EXACTO
SIMILARITY_EQUIVALENTE_THRESHOLD=0.70   # >70% = EQUIVALENTE
SIMILARITY_COMPATIBLE_THRESHOLD=0.60    # >60% = COMPATIBLE
SIMILARITY_ALTERNATIVO_THRESHOLD=0.50   # >50% = ALTERNATIVO
```

### Desactivar Boosts

Para desactivar cualquier boost, establece su valor en `1.0`:

```bash
BOOST_BRAND_EXACT=1.0  # Desactiva boost por marca
```

## 📚 Ejemplos de Uso

### Ejemplo 1: Búsqueda Simple

```bash
curl -X POST http://localhost:4000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "lapicero azul"
  }'
```

**Resultado**: Encuentra bolígrafos, plumas y lapiceros de color azul, priorizando los que tienen stock.

### Ejemplo 2: Búsqueda con Segmento

```bash
curl -X POST http://localhost:4000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "taladro percutor",
    "segment": "premium",
    "limit": 10
  }'
```

**Resultado**: Busca taladros percutores priorizando marcas premium como DeWalt o Bosch.

### Ejemplo 3: Búsqueda con Marca Específica

```bash
curl -X POST http://localhost:4000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "brocha TRUPER 4 pulgadas"
  }'
```

**Resultado**: 
- Encuentra brochas de 4 pulgadas
- Aplica boost adicional a productos TRUPER (+10%)
- Si hay TRUPER en stock, lo selecciona primero

### Ejemplo 4: Búsqueda con Errores Ortográficos

```bash
curl -X POST http://localhost:4000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "martilo"
  }'
```

**Resultado**: Automáticamente entiende "martillo" y encuentra martillos disponibles.

## 🛠️ Solución de Problemas

### Error: "Request timeout"

**Causa**: La búsqueda está tardando más de 30 segundos.

**Solución**:
1. Verificar conexión a base de datos
2. Reducir el límite de resultados
3. Verificar que los índices pgvector estén creados

### Error: "No se encontraron productos"

**Causa**: La similitud es menor al umbral mínimo (50%).

**Solución**:
1. Ser más específico en la búsqueda
2. Usar términos más comunes
3. Verificar que existan productos relacionados

### Resultados Inesperados

**Problema**: El producto seleccionado no parece el mejor match.

**Verificar**:
1. Revisar los boost_tags del producto ganador
2. Ajustar variables de boost si es necesario
3. Verificar que las descripciones no tengan caracteres problemáticos

### Productos sin Stock Ganando

**Problema**: Productos sin stock aparecen primero.

**Solución**:
1. Aumentar `BOOST_STOCK` (ej: de 1.15 a 1.25)
2. Verificar que el campo `articulo_stock` esté actualizado

## 📊 Métricas de Performance

- **Tiempo promedio de respuesta**: 500-2000ms
- **Embeddings**: ~500ms con OpenAI
- **Búsqueda vectorial**: ~200-1000ms según cantidad
- **Clasificación GPT**: ~1000-2000ms (solo si es necesario)

## 🔒 Consideraciones de Seguridad

1. **API Keys**: Nunca exponer en código cliente
2. **Rate Limiting**: Implementar límites por IP/usuario
3. **Validación**: Sanitizar queries antes de procesar
4. **CORS**: Configurar orígenes permitidos

## 📞 Soporte

Para reportar problemas o solicitar mejoras:
- GitHub Issues: https://github.com/alannreyes/semantic-catalog-search/issues
- Documentación técnica: Ver CLAUDE.md en el repositorio