# 🚀 DEPLOY PRODUCTOS_BIP - GUÍA DE IMPLEMENTACIÓN COMPLETA

## FASE 1: PREPARACIÓN (5 min)

### 1.1 Actualizar variables de entorno en Easypanel
```bash
# Cambiar esta variable:
PRODUCT_TABLE=productos_bip  # Era: productos_1024

# Verificar que estén todas:
NODE_ENV=production
DATABASE_URL=postgres://postgres:5965838aa16d2dab76fe@tic_postgres-vector:5432/tic
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=text-embedding-3-large 
PGVECTOR_PROBES=80
VECTOR_DIMENSIONS=1024
HOST=0.0.0.0
PORT=4000
ALLOWED_ORIGINS=http://bip.efc.com.pe:3000,http://bip.efc.com.pe:4000,http://axioma.efc.com.pe:4000,http://localhost:3000
```

### 1.2 Hacer commit y push de cambios finales
```bash
git add .
git commit -m "Finalize productos_bip implementation with commercial scoring"
git push origin main
```

## FASE 2: CREAR TABLA EN BASE DE DATOS (10 min)

### 2.1 Ejecutar script de creación
```bash
# Conectar a la base de datos y ejecutar
psql $DATABASE_URL -f scripts/create-productos-bip-table-simplified.sql
```

### 2.2 Crear sistema de scoring comercial
```bash
psql $DATABASE_URL -f scripts/unified-scoring-system.sql
```

### 2.3 Verificar tablas creadas
```sql
-- Verificar que todo esté OK
\dt productos_bip
\df boost_producto_comercial

SELECT COUNT(*) FROM productos_bip; -- Debería estar vacía
```

## FASE 3: ACTUALIZAR APLICACIÓN (15 min)

### 3.1 Redeploy en Easypanel
- Ir a tu proyecto en Easypanel
- Hacer redeploy con la nueva variable PRODUCT_TABLE
- Esperar que termine el build

### 3.2 Verificar que funciona
```bash
# Test básico
curl http://tu-app:4000/health

# Test de tablas
curl http://tu-app:4000/migration/test-connection
```

## FASE 4: MIGRACIÓN INICIAL (30-60 min)

### 4.1 Crear job de migración con flags comerciales
```bash
curl -X POST http://tu-app:4000/migration/bulk-load \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "type": "mssql",
      "table": "Ar0000",
      "fields": {
        "codigo": "ART_CODART",
        "descripcion": "ART_DESART",
        "marca": "ART_PARAM3", 
        "codigo_fabrica": "ART_CODFABRICA",
        "articulo_stock": "ART_FLGSTKDIST",
        "lista_costos": "ART_FLGLSTPRE",
        "categoria": "ART_CODFAM",
        "precio_lista": "ART_PRECLISTA",
        "precio_costo": "ART_PRECCOSTO"
      },
      "where_clause": "ART_CODFAM <= '\''47'\'' AND ART_ESTREG = '\''A'\''"
    },
    "destination": {
      "table": "productos_bip",
      "clean_before": true,
      "create_indexes": true
    },
    "processing": {
      "batch_size": 500,
      "embedding_batch_size": 50,
      "delay_between_batches_ms": 1000,
      "text_cleaning": {
        "enabled": true
      }
    }
  }'
```

### 4.2 Capturar job_id y monitorear
```bash
# Resultado del comando anterior te dará algo como:
# {"job_id": "abc-123", "status": "pending", ...}

JOB_ID="abc-123"  # Reemplazar con tu job_id real

# Iniciar migración
curl -X POST http://tu-app:4000/migration/jobs/$JOB_ID/start

# Monitorear progreso cada 30 segundos
watch -n 30 "curl -s http://tu-app:4000/migration/jobs/$JOB_ID/status | jq '.progress'"
```

## FASE 5: VERIFICACIÓN Y PRUEBAS (15 min)

### 5.1 Verificar datos migrados
```sql
-- Verificar cantidad total
SELECT COUNT(*) as total_productos FROM productos_bip;

-- Verificar flags comerciales
SELECT 
    categoria_comercial,
    color_categoria,
    COUNT(*) as cantidad
FROM productos_bip 
GROUP BY categoria_comercial, color_categoria
ORDER BY cantidad DESC;

-- Ver ejemplos de cada categoría
SELECT codigo, descripcion, marca, categoria_comercial, prioridad_comercial
FROM productos_bip 
WHERE categoria_comercial = 'alta_rotacion_acuerdo'
LIMIT 5;
```

### 5.2 Probar búsqueda con scoring comercial
```bash
# Búsqueda básica
curl -X POST http://tu-app:4000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "tornillo",
    "limit": 5
  }'

# Búsqueda con segmento
curl -X POST http://tu-app:4000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "valvula",
    "segment": "premium",
    "limit": 5
  }'
```

### 5.3 Verificar que scoring funciona
```sql
-- Test manual de scoring
SELECT 
    codigo,
    descripcion,
    articulo_stock,
    lista_costos,
    boost_producto_comercial(0.95, codigo, NULL, 'premium') as score_comercial
FROM productos_bip
WHERE descripcion ILIKE '%tornillo%'
ORDER BY score_comercial DESC
LIMIT 10;
```

## FASE 6: OPTIMIZACIÓN POST-MIGRACIÓN (10 min)

### 6.1 Crear índices adicionales si es necesario
```sql
-- Solo si la migración fue exitosa
ANALYZE productos_bip;

-- Verificar performance de índices
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM productos_bip 
WHERE articulo_stock = true 
ORDER BY prioridad_comercial DESC 
LIMIT 10;
```

### 6.2 Configurar mantenimiento automático
```sql
-- Auto-vacuum más agresivo para tabla principal
ALTER TABLE productos_bip SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);
```

## FASE 7: DOCUMENTACIÓN Y MONITOREO (5 min)

### 7.1 Crear alertas básicas
```bash
# Verificar que health checks funcionen
curl http://tu-app:4000/health/ready

# Verificar métricas
curl http://tu-app:4000/metrics | jq '.counters'
```

### 7.2 Documentar URLs importantes
```bash
echo "=== URLS DE PRODUCCIÓN ==="
echo "Health: http://tu-app:4000/health"
echo "Métricas: http://tu-app:4000/metrics" 
echo "Jobs: http://tu-app:4000/migration/jobs"
echo "Búsqueda: POST http://tu-app:4000/search"
echo "Acrónimos: http://tu-app:4000/acronimos"
```

## ✅ CHECKLIST FINAL

- [ ] Variables de entorno actualizadas en Easypanel
- [ ] Tabla productos_bip creada
- [ ] Sistema de scoring implementado
- [ ] Aplicación redeployada
- [ ] Job de migración creado y ejecutado
- [ ] Datos verificados (categorías comerciales funcionando)
- [ ] Búsquedas probadas y funcionando
- [ ] Scoring comercial validado
- [ ] Health checks OK
- [ ] Índices optimizados

## 🎯 RESULTADO ESPERADO

Al finalizar tendrás:

1. **Nueva tabla productos_bip** con campos comerciales
2. **Sistema de scoring inteligente** que prioriza:
   - Stock + Acuerdo (Verde, score ~1.8x)
   - Solo Stock (Amarillo, score ~1.25x) 
   - Solo Acuerdo (Azul, score ~1.15x)
   - Estándar (Gris, score 1x)
3. **Búsquedas más inteligentes** comercialmente
4. **Migración completa** desde MSSQL
5. **Sistema listo para historial** de clientes (próxima fase)

## 🚨 SI ALGO FALLA

### Rollback rápido:
```bash
# Cambiar variable de vuelta
PRODUCT_TABLE=productos_1024

# Redeploy
# La aplicación volverá a usar la tabla anterior
```

### Debugging:
```bash
# Ver logs de migración
curl http://tu-app:4000/migration/jobs/$JOB_ID/status

# Ver logs de aplicación  
docker logs tu-container

# Test de conectividad
curl http://tu-app:4000/migration/test-connection
```

¡LISTO PARA IMPLEMENTAR! 🚀