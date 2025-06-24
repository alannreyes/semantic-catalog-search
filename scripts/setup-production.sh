#!/bin/bash

# Script de configuración para entorno de producción
# Uso: ./scripts/setup-production.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Función para verificar y crear directorios
setup_directories() {
    log_info "Configurando estructura de directorios..."
    
    local dirs=(
        "logs"
        "backups"
        "certs"
        "tmp"
    )
    
    for dir in "${dirs[@]}"; do
        mkdir -p "$PROJECT_ROOT/$dir"
        chmod 755 "$PROJECT_ROOT/$dir"
        log_success "Directorio creado: $dir"
    done
}

# Función para configurar variables de entorno de producción
setup_environment() {
    log_info "Configurando variables de entorno de producción..."
    
    local env_file="$PROJECT_ROOT/.env.production"
    
    if [[ -f "$env_file" ]]; then
        log_warning "Archivo .env.production ya existe. Creando backup..."
        cp "$env_file" "$env_file.backup.$(date +%Y%m%d-%H%M%S)"
    fi
    
    cat > "$env_file" << 'EOF'
# Configuración de Producción - Semantic Catalog Search
# IMPORTANTE: Reemplazar todos los valores placeholder con valores reales

# Entorno
NODE_ENV=production
LOG_LEVEL=info

# Servidor
HOST=0.0.0.0
PORT=4000
PORTF=4001

# Base de Datos PostgreSQL
DATABASE_URL=postgresql://username:password@host:5432/database
DB_USER=username
DB_HOST=host
DB_NAME=database
DB_PASSWORD=password
DB_PORT=5432

# Certificados SSL para PostgreSQL (Base64 encoded)
DB_CA_CERT=-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----
DB_CLIENT_CERT=-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----
DB_CLIENT_KEY=-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----

# OpenAI
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=text-embedding-3-large
VECTOR_DIMENSIONS=1024

# Configuración de Búsqueda
PRODUCT_TABLE=productos_1024
PGVECTOR_PROBES=15

# MS SQL Server (para migración)
MSSQL_HOST=host
MSSQL_PORT=1433
MSSQL_DATABASE=database
MSSQL_USER=username
MSSQL_PASSWORD=password
MSSQL_SOURCE_TABLE=Ar0000
MSSQL_WHERE_CLAUSE=ART_CODFAM <= '47' AND ART_ESTREG = 'A'
POSTGRES_MIGRATION_TABLE=productos_1024

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Frontend
FRONTEND_URL=https://yourdomain.com
EOF

    chmod 600 "$env_file"
    log_success "Archivo .env.production creado"
    log_warning "IMPORTANTE: Edita $env_file y reemplaza todos los valores placeholder"
}

# Función para configurar PM2
setup_pm2() {
    log_info "Configurando PM2 para gestión de procesos..."
    
    # Verificar si PM2 está instalado
    if ! command -v pm2 &> /dev/null; then
        log_info "Instalando PM2..."
        npm install -g pm2
    fi
    
    # Crear archivo de configuración PM2
    cat > "$PROJECT_ROOT/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [
    {
      name: 'semantic-catalog-search',
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        LOG_LEVEL: 'info'
      },
      // Configuración de logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      
      // Configuración de reinicio
      max_memory_restart: '500M',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Watch y ignore
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'tmp'],
      
      // Configuración de health check
      health_check_http: {
        path: '/health',
        port: 4000,
        interval: 30000,
        timeout: 5000
      }
    }
  ]
};
EOF

    log_success "Archivo PM2 ecosystem.config.js creado"
}

# Función para configurar nginx
setup_nginx() {
    log_info "Generando configuración de nginx..."
    
    cat > "$PROJECT_ROOT/nginx.conf" << 'EOF'
# Configuración de nginx para semantic-catalog-search

upstream semantic_catalog_backend {
    server 127.0.0.1:4000;
    keepalive 32;
}

upstream semantic_catalog_frontend {
    server 127.0.0.1:4001;
    keepalive 32;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=search:10m rate=5r/s;

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # API routes
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://semantic_catalog_backend/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
    
    # Search endpoint with stricter rate limiting
    location /api/search {
        limit_req zone=search burst=10 nodelay;
        
        proxy_pass http://semantic_catalog_backend/search;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Longer timeout for AI processing
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health checks (no rate limiting)
    location /health {
        proxy_pass http://semantic_catalog_backend/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }
    
    # Static files and frontend
    location / {
        proxy_pass http://semantic_catalog_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
    
    # Logs
    access_log /var/log/nginx/semantic-catalog-access.log;
    error_log /var/log/nginx/semantic-catalog-error.log;
}
EOF

    log_success "Configuración de nginx generada: nginx.conf"
    log_warning "IMPORTANTE: Edita nginx.conf y configura tu dominio y certificados SSL"
}

# Función para configurar systemd
setup_systemd() {
    log_info "Generando configuración de systemd..."
    
    cat > "$PROJECT_ROOT/semantic-catalog-search.service" << EOF
[Unit]
Description=Semantic Catalog Search API
Documentation=https://github.com/yourusername/semantic-catalog-search
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=$PROJECT_ROOT
Environment=NODE_ENV=production
EnvironmentFile=$PROJECT_ROOT/.env.production
ExecStart=/usr/bin/node dist/main.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=semantic-catalog-search

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$PROJECT_ROOT/logs $PROJECT_ROOT/tmp

# Resource limits
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

    log_success "Archivo systemd generado: semantic-catalog-search.service"
    log_info "Para instalar: sudo cp semantic-catalog-search.service /etc/systemd/system/"
}

# Función para configurar backup
setup_backup() {
    log_info "Configurando scripts de backup..."
    
    cat > "$PROJECT_ROOT/scripts/backup.sh" << 'EOF'
#!/bin/bash

# Script de backup para semantic-catalog-search
set -euo pipefail

BACKUP_DIR="/path/to/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROJECT_ROOT="$(dirname "$(dirname "$(readlink -f "$0")")")"

# Crear directorio de backup
mkdir -p "$BACKUP_DIR"

# Backup de base de datos
echo "Creando backup de base de datos..."
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/database_$TIMESTAMP.sql.gz"

# Backup de archivos de configuración
echo "Creando backup de configuración..."
tar -czf "$BACKUP_DIR/config_$TIMESTAMP.tar.gz" -C "$PROJECT_ROOT" .env* *.config.js

# Cleanup de backups antiguos (mantener últimos 7 días)
find "$BACKUP_DIR" -name "*.gz" -mtime +7 -delete

echo "Backup completado: $TIMESTAMP"
EOF

    chmod +x "$PROJECT_ROOT/scripts/backup.sh"
    log_success "Script de backup creado"
}

# Función para configurar monitoreo
setup_monitoring() {
    log_info "Configurando monitoreo básico..."
    
    cat > "$PROJECT_ROOT/scripts/monitor.sh" << 'EOF'
#!/bin/bash

# Script de monitoreo básico
set -euo pipefail

LOG_FILE="/var/log/semantic-catalog-monitor.log"
API_URL="http://localhost:4000"

log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Health check
if curl -f -s "$API_URL/health" > /dev/null; then
    log_with_timestamp "Health check: OK"
else
    log_with_timestamp "Health check: FAILED"
    # Aquí podrías agregar notificaciones (email, Slack, etc.)
fi

# Verificar uso de memoria
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
if (( $(echo "$MEMORY_USAGE > 80" | bc -l) )); then
    log_with_timestamp "HIGH MEMORY USAGE: ${MEMORY_USAGE}%"
fi

# Verificar espacio en disco
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [[ $DISK_USAGE -gt 80 ]]; then
    log_with_timestamp "HIGH DISK USAGE: ${DISK_USAGE}%"
fi
EOF

    chmod +x "$PROJECT_ROOT/scripts/monitor.sh"
    
    # Crear entrada de crontab sugerida
    cat > "$PROJECT_ROOT/crontab.txt" << 'EOF'
# Crontab entries for semantic-catalog-search monitoring and maintenance

# Health check every 5 minutes
*/5 * * * * /path/to/project/scripts/monitor.sh

# Daily backup at 2 AM
0 2 * * * /path/to/project/scripts/backup.sh

# Weekly database maintenance on Sundays at 3 AM
0 3 * * 0 /path/to/project/scripts/health-check.sh --host localhost --port 4000
EOF

    log_success "Scripts de monitoreo creados"
    log_info "Configurar crontab con: crontab crontab.txt"
}

# Función principal
main() {
    echo "=== Configuración de Producción - Semantic Catalog Search ==="
    echo ""
    
    setup_directories
    setup_environment
    setup_pm2
    setup_nginx
    setup_systemd
    setup_backup
    setup_monitoring
    
    echo ""
    log_success "=== Configuración de producción completada ==="
    echo ""
    echo "Próximos pasos:"
    echo "1. Editar .env.production con valores reales"
    echo "2. Configurar certificados SSL"
    echo "3. Instalar y configurar nginx"
    echo "4. Configurar PM2 o systemd para gestión de procesos"
    echo "5. Configurar crontab para monitoreo y backups"
    echo "6. Ejecutar deployment: ./scripts/deploy.sh production"
    echo ""
    log_warning "IMPORTANTE: Revisar todos los archivos de configuración antes del deployment"
}

main "$@"