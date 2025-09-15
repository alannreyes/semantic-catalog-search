# Semantic Catalog Search API

API de búsqueda semántica de productos inteligente que utiliza embeddings vectoriales de OpenAI, similitud coseno y PostgreSQL con pgvector para proporcionar búsquedas precisas y contextuales.

## 🚀 Características Principales

- **Búsqueda Semántica Avanzada**: Utiliza embeddings de OpenAI (text-embedding-3-large)
- **Dos Modos de Búsqueda**: Completa con IA y simplificada solo con similitud
- **Sistema de Boost Inteligente**: Mejora resultados basado en segmento, stock, historial
- **Comparación de Productos**: Endpoints para calcular similitud entre textos
- **Logging Automático**: Registra todas las consultas para análisis
- **Expansión de Acrónimos**: Mejora las búsquedas expandiendo términos técnicos

## 📋 Endpoints Disponibles

### POST /search
**Búsqueda semántica completa con IA**

Búsqueda avanzada que combina embeddings vectoriales con GPT-4o para selección inteligente de productos.

**Request Body:**
```json
{
  "query": "bombas centrífugas 5HP",
  "limit": 10,
  "segment": "premium",
  "cliente": "EMPRESA_XYZ",
  "marca": "GRUNDFOS"
}
```

**Campos:**
- `query` *(string, requerido)*: Consulta de búsqueda (máx. 500 caracteres)
- `limit` *(number, opcional)*: Número de resultados (1-50, default: 5)
- `segment` *(string, opcional)*: Segmento del cliente (`premium`, `standard`, `economy`)
- `cliente` *(string, opcional)*: ID del cliente (máx. 100 caracteres)
- `marca` *(string, opcional)*: Filtro por marca (máx. 100 caracteres)

**Funcionalidades:**
- Si similitud < 0.5, normaliza query con GPT-4o y reintenta
- Aplica boost por segmento, stock y historial del cliente
- GPT-4o selecciona el mejor producto de los resultados

### POST /searchv2
**Búsqueda simplificada con similitud coseno**

Versión optimizada que usa solo similitud coseno, más rápida y económica.

**Request Body:**
```json
{
  "query": "válvulas de control automático",
  "limit": 5,
  "segment": "standard",
  "cliente": "CLIENTE_ABC",
  "marca": "DANFOSS",
  "codigo_fabrica": "VLV001"
}
```

**Campos adicionales:**
- `codigo_fabrica` *(string, opcional)*: Código específico del fabricante (máx. 100 caracteres)

**Ventajas:**
- Más rápido al no usar GPT-4o
- Menor costo de API
- Sistema de boost completo incluido

### POST /ismatch
**Comparación de equivalencia entre productos**

Determina si dos productos son equivalentes o similares.

**Request Body:**
```json
{
  "producto1": "Bomba centrífuga GRUNDFOS CM 5-4",
  "producto2": "Bomba centrífuga CM5-4 GRUNDFOS"
}
```

**Response:** `number` (0.0 - 1.0, donde 1.0 es idéntico)

### POST /simil
**Cálculo de similitud entre textos**

Calcula la similitud semántica entre cualquier par de textos.

**Request Body:**
```json
{
  "texto1": "motor eléctrico trifásico",
  "texto2": "motor 3 fases eléctrico"
}
```

**Response:** `number` (0.0 - 1.0)

## 🔧 Configuración

### Variables de Entorno Requeridas

```bash
DATABASE_URL=postgres://user:password@host:port/database
OPENAI_API_KEY=sk-proj-...
```

### Variables Opcionales

```bash
# Configuración del servidor
PORT=4000
HOST=0.0.0.0
NODE_ENV=production

# Configuración de embeddings
OPENAI_MODEL=text-embedding-3-large
VECTOR_DIMENSIONS=1024
PGVECTOR_PROBES=80

# Configuración de boost (valores por defecto)
BOOST_SEGMENT_PREFERRED=1.30      # Boost segmento preferido
BOOST_SEGMENT_COMPATIBLE=1.20     # Boost segmento compatible
BOOST_STOCK=1.25                  # Boost productos en stock
BOOST_COST_AGREEMENT=1.15         # Boost acuerdos de costo
BOOST_BRAND_EXACT=1.20            # Boost marca exacta mencionada
BOOST_MODEL_EXACT=1.15            # Boost modelo/código mencionado
BOOST_SIZE_EXACT=1.10             # Boost dimensiones coincidentes

# Umbrales de similitud
SIMILARITY_EXACTO_THRESHOLD=0.90
SIMILARITY_EQUIVALENTE_THRESHOLD=0.70
SIMILARITY_COMPATIBLE_THRESHOLD=0.88
SIMILARITY_ALTERNATIVO_THRESHOLD=0.82
```

## 🗄️ Base de Datos

### Requisitos
- PostgreSQL con extensión `pgvector`
- Tabla de productos con columna `embedding vector(1024)`
- Tabla de logs para auditoría

### Schema de Logs
```sql
CREATE TABLE logs (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    endpoint VARCHAR(32) NOT NULL,
    body JSONB NOT NULL,
    resultado JSONB NOT NULL
);
```

## 🚀 Instalación y Ejecución

```bash
# Instalar dependencias
npm install

# Desarrollo
npm run start:dev

# Producción
npm run build
npm run start:prod

# Tests
npm run test
```

## 📊 Logging y Monitoreo

Todas las consultas se registran automáticamente incluyendo:
- Timestamp de la consulta
- Endpoint utilizado
- Parámetros de entrada
- Resultados obtenidos

Acceso a logs via endpoint interno o directamente en la base de datos.

## 🏗️ Arquitectura

- **Backend**: NestJS con TypeScript
- **Base de Datos**: PostgreSQL + pgvector
- **IA**: OpenAI API (embeddings + GPT-4o)
- **Búsqueda Vectorial**: Similitud coseno con índices IVFFLAT

## 🔄 Migración de Datos

Incluye módulo de migración desde MS SQL Server para importación de catálogos existentes.

## 📈 Rendimiento

- Búsquedas optimizadas con índices vectoriales
- Rate limiting para APIs externas
- Timeouts configurables (30s default)
- Pool de conexiones de base de datos

## 🆘 Endpoints de Debug

- `GET /debug/config` - Configuración del servicio de búsqueda
- `GET /searchv2/debug/config` - Configuración de SearchV2
