# 🚀 Guía de Operaciones - Semantic Catalog Search

Esta guía cubre todos los procedimientos operativos para el mantenimiento y monitoreo de la aplicación en producción.

## 📋 Tabla de Contenidos

- [Deployment](#deployment)
- [Monitoreo y Health Checks](#monitoreo-y-health-checks)
- [Mantenimiento de Base de Datos](#mantenimiento-de-base-de-datos)
- [Optimización de Performance](#optimización-de-performance)
- [Troubleshooting](#troubleshooting)
- [Backup y Recovery](#backup-y-recovery)
- [Seguridad](#seguridad)

## 🚀 Deployment

### Deployment Inicial

```bash
# 1. Configurar entorno de producción
./scripts/setup-production.sh

# 2. Editar variables de entorno
vi .env.production

# 3. Ejecutar deployment
./scripts/deploy.sh production
```

### Deployment de Actualizaciones

```bash
# 1. Verificar estado actual
./scripts/health-check.sh

# 2. Hacer backup
./scripts/backup.sh

# 3. Desplegar nueva versión
./scripts/deploy.sh production

# 4. Verificar deployment
./scripts/health-check.sh --verbose
```

### Rollback

```bash
# 1. Detener aplicación actual
pm2 stop semantic-catalog-search

# 2. Restaurar versión anterior
git checkout <previous-commit>
npm run build

# 3. Reiniciar aplicación
pm2 start ecosystem.config.js --env production
```

## 🔍 Monitoreo y Health Checks

### Endpoints de Monitoreo

- **Health Check**: `GET /health` - Estado general de la aplicación
- **Readiness**: `GET /health/ready` - Listo para recibir tráfico
- **Liveness**: `GET /health/live` - Aplicación está viva
- **Métricas**: `GET /metrics` - Métricas de aplicación
- **Métricas Prometheus**: `GET /metrics/prometheus` - Formato Prometheus

### Verificación Manual

```bash
# Health check completo
./scripts/health-check.sh --verbose

# Health check específico
curl -s http://localhost:4000/health | jq

# Verificar métricas
curl -s http://localhost:4000/metrics | jq '.counters'
```

### Monitoreo Automatizado

```bash
# Configurar crontab para monitoreo continuo
crontab -e

# Agregar líneas:
*/5 * * * * /path/to/project/scripts/health-check.sh
0 */4 * * * /path/to/project/scripts/monitor.sh
```

### Alertas Críticas

**Condiciones que requieren atención inmediata:**

- Health check falla por más de 2 minutos
- Error rate > 5% en los últimos 10 minutos
- Uso de memoria > 85%
- Tiempo de respuesta > 30 segundos
- Base de datos desconectada

## 🗄️ Mantenimiento de Base de Datos

### Mantenimiento Regular

```bash
# Análisis diario de estadísticas
curl -X POST http://localhost:4000/optimization/database/maintenance \
  -H "Content-Type: application/json" \
  -d '{"tasks": ["analyze"], "dryRun": false}'

# Vacuum semanal
curl -X POST http://localhost:4000/optimization/database/maintenance \
  -H "Content-Type: application/json" \
  -d '{"tasks": ["vacuum"], "dryRun": false}'
```

### Optimización de pgvector

```bash
# Analizar configuración actual
curl http://localhost:4000/optimization/pgvector/analyze

# Aplicar optimizaciones (dry run primero)
curl -X POST http://localhost:4000/optimization/pgvector/apply \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Aplicar optimizaciones reales
curl -X POST http://localhost:4000/optimization/pgvector/apply \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "force": true}'
```

### Reindexación

```bash
# Verificar necesidad de reindexación
curl http://localhost:4000/optimization/database/stats

# Ejecutar reindexación (durante mantenimiento)
curl -X POST http://localhost:4000/optimization/database/maintenance \
  -H "Content-Type: application/json" \
  -d '{"tasks": ["reindex"], "dryRun": false}'
```

## ⚡ Optimización de Performance

### Configuración de pgvector por Tamaño de Dataset

| Tamaño Dataset | Probes Recomendados | Lists Recomendados |
|----------------|--------------------|--------------------|
| < 1K           | 1                  | 10                 |
| 1K - 10K       | 3-5                | 20-50              |
| 10K - 100K     | 10-15              | 50-200             |
| > 100K         | 15-30              | 200-500            |

### Monitoreo de Performance

```bash
# Métricas de performance
curl http://localhost:4000/metrics/performance

# Estadísticas de base de datos
curl http://localhost:4000/optimization/database/stats
```

### Ajustes de Configuración

**Variables de entorno críticas para performance:**

```bash
# Configuración de pgvector
PGVECTOR_PROBES=15  # Ajustar según dataset
VECTOR_DIMENSIONS=1024

# Pool de conexiones
DB_POOL_MAX=20
DB_POOL_MIN=5

# Timeouts
REQUEST_TIMEOUT=30000
DB_QUERY_TIMEOUT=30000
```

## 🔧 Troubleshooting

### Problemas Comunes

#### 1. Alta Latencia en Búsquedas

**Síntomas:**
- Tiempo de respuesta > 10 segundos
- Timeouts frecuentes

**Diagnóstico:**
```bash
# Verificar configuración de pgvector
curl http://localhost:4000/optimization/pgvector/analyze

# Verificar estadísticas de DB
curl http://localhost:4000/optimization/database/stats
```

**Soluciones:**
- Reducir `PGVECTOR_PROBES` para mayor velocidad
- Ejecutar `ANALYZE` en la tabla
- Verificar índices vectoriales

#### 2. Errores de Conexión a Base de Datos

**Síntomas:**
- Health check falla
- Errores 500 en API

**Diagnóstico:**
```bash
# Verificar conectividad
psql $DATABASE_URL -c "SELECT 1"

# Check pool connections
curl http://localhost:4000/metrics | jq '.database'
```

**Soluciones:**
- Reiniciar pool de conexiones: `pm2 restart semantic-catalog-search`
- Verificar certificados SSL
- Aumentar límites de conexión

#### 3. Uso Excesivo de Memoria

**Síntomas:**
- Aplicación reinicia frecuentemente
- Performance degradada

**Diagnóstico:**
```bash
# Verificar uso de memoria
curl http://localhost:4000/metrics | jq '.process.memory'
pm2 monit
```

**Soluciones:**
- Ajustar `max_memory_restart` en PM2
- Optimizar batch size en migraciones
- Verificar memory leaks

#### 4. Errores de OpenAI API

**Síntomas:**
- Búsquedas fallan con errores 500
- Rate limiting errors

**Diagnóstico:**
```bash
# Verificar health de OpenAI
curl http://localhost:4000/health | jq '.services.openai'

# Verificar logs
pm2 logs semantic-catalog-search | grep -i openai
```

**Soluciones:**
- Verificar API key válida
- Implementar retry logic
- Verificar rate limits

### Logs y Debugging

```bash
# Ver logs en tiempo real
pm2 logs semantic-catalog-search

# Logs de errores específicos
tail -f logs/error.log | grep ERROR

# Logs con filtro por request ID
grep "request-id-123" logs/app.log
```

## 💾 Backup y Recovery

### Backup Automático

```bash
# Configurar backup automático
crontab -e

# Backup diario a las 2 AM
0 2 * * * /path/to/project/scripts/backup.sh
```

### Backup Manual

```bash
# Backup completo
./scripts/backup.sh

# Backup solo de base de datos
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Recovery

```bash
# Restaurar desde backup
gunzip -c backup_YYYYMMDD.sql.gz | psql $DATABASE_URL

# Verificar integridad después del restore
./scripts/health-check.sh --verbose
```

### Disaster Recovery

1. **Detener aplicación**
   ```bash
   pm2 stop semantic-catalog-search
   ```

2. **Restaurar base de datos**
   ```bash
   dropdb $DB_NAME
   createdb $DB_NAME
   psql $DATABASE_URL < latest_backup.sql
   ```

3. **Verificar y reiniciar**
   ```bash
   ./scripts/health-check.sh
   pm2 start semantic-catalog-search
   ```

## 🔒 Seguridad

### Auditoría de Seguridad

```bash
# Verificar configuración SSL
curl -I https://yourdomain.com/health

# Verificar headers de seguridad
curl -I http://localhost:4000/health

# Audit de npm
npm audit
```

### Actualización de Dependencias

```bash
# Verificar vulnerabilidades
npm audit

# Actualizar dependencias
npm update

# Verificar que todo funciona
npm test
./scripts/health-check.sh
```

### Rotación de Secrets

1. **API Keys de OpenAI**
   - Generar nueva key en OpenAI dashboard
   - Actualizar `.env.production`
   - Reiniciar aplicación: `pm2 restart semantic-catalog-search`

2. **Certificados SSL**
   - Actualizar certificados en nginx
   - Reload nginx: `nginx -s reload`

3. **Credenciales de Base de Datos**
   - Actualizar en base de datos
   - Actualizar `.env.production`
   - Reiniciar aplicación

## 📞 Contactos de Emergencia

- **Desarrollador Principal**: [email]
- **DevOps**: [email]
- **Database Admin**: [email]

## 📚 Referencias Adicionales

- [CLAUDE.md](./CLAUDE.md) - Documentación para desarrolladores
- [README.md](./README.md) - Documentación general
- [Logs de deployment](./logs/) - Historial de deployments
- [Scripts de operación](./scripts/) - Scripts automatizados