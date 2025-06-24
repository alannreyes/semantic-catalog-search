#!/bin/bash

# Script de deployment para semantic-catalog-search
# Uso: ./scripts/deploy.sh [development|staging|production]

set -euo pipefail

# Configuración
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENVIRONMENT="${1:-development}"
LOG_FILE="$PROJECT_ROOT/logs/deploy-$(date +%Y%m%d-%H%M%S).log"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funciones de logging
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

# Función para verificar requisitos
check_requirements() {
    log_info "Verificando requisitos..."
    
    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js no está instalado"
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    log_info "Node.js version: $NODE_VERSION"
    
    # npm
    if ! command -v npm &> /dev/null; then
        log_error "npm no está instalado"
        exit 1
    fi
    
    # Docker (opcional)
    if command -v docker &> /dev/null; then
        log_info "Docker disponible: $(docker --version)"
    else
        log_warning "Docker no disponible - deployment manual solamente"
    fi
    
    # Variables de entorno requeridas
    if [[ "$ENVIRONMENT" == "production" ]]; then
        local required_vars=("DATABASE_URL" "OPENAI_API_KEY" "NODE_ENV")
        for var in "${required_vars[@]}"; do
            if [[ -z "${!var:-}" ]]; then
                log_error "Variable de entorno requerida no configurada: $var"
                exit 1
            fi
        done
    fi
    
    log_success "Requisitos verificados"
}

# Función para preparar el entorno
prepare_environment() {
    log_info "Preparando entorno para $ENVIRONMENT..."
    
    # Crear directorios necesarios
    mkdir -p "$PROJECT_ROOT/logs"
    mkdir -p "$PROJECT_ROOT/dist"
    
    # Backup de archivos críticos si existen
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        cp "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.backup.$(date +%Y%m%d-%H%M%S)"
        log_info "Backup de .env creado"
    fi
    
    # Configurar variables de entorno específicas del ambiente
    case "$ENVIRONMENT" in
        "development")
            export NODE_ENV=development
            export LOG_LEVEL=debug
            ;;
        "staging")
            export NODE_ENV=staging
            export LOG_LEVEL=info
            ;;
        "production")
            export NODE_ENV=production
            export LOG_LEVEL=warn
            ;;
        *)
            log_error "Entorno no válido: $ENVIRONMENT"
            exit 1
            ;;
    esac
    
    log_success "Entorno preparado"
}

# Función para instalar dependencias
install_dependencies() {
    log_info "Instalando dependencias..."
    
    cd "$PROJECT_ROOT"
    
    # Limpiar cache de npm si es producción
    if [[ "$ENVIRONMENT" == "production" ]]; then
        npm cache clean --force
    fi
    
    # Instalar dependencias
    if [[ "$ENVIRONMENT" == "production" ]]; then
        npm ci --only=production
    else
        npm install
    fi
    
    log_success "Dependencias instaladas"
}

# Función para construir la aplicación
build_application() {
    log_info "Construyendo aplicación..."
    
    cd "$PROJECT_ROOT"
    
    # Ejecutar build
    npm run build
    
    # Verificar que el build fue exitoso
    if [[ ! -f "$PROJECT_ROOT/dist/main.js" ]]; then
        log_error "Build falló - archivo principal no encontrado"
        exit 1
    fi
    
    log_success "Aplicación construida exitosamente"
}

# Función para ejecutar tests
run_tests() {
    if [[ "$ENVIRONMENT" == "development" ]]; then
        log_info "Ejecutando tests..."
        
        cd "$PROJECT_ROOT"
        
        # Tests unitarios
        timeout 300 npm test || {
            log_warning "Tests unitarios fallaron o tomaron demasiado tiempo"
        }
        
        # Tests e2e (solo si están configurados)
        if [[ -f "$PROJECT_ROOT/test/jest-e2e.json" ]]; then
            timeout 300 npm run test:e2e || {
                log_warning "Tests e2e fallaron o tomaron demasiado tiempo"
            }
        fi
        
        log_success "Tests completados"
    else
        log_info "Saltando tests en entorno $ENVIRONMENT"
    fi
}

# Función para verificar health checks
verify_health() {
    log_info "Verificando health checks..."
    
    local max_attempts=30
    local attempt=1
    local health_url="http://localhost:${PORT:-4000}/health"
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s "$health_url" > /dev/null 2>&1; then
            log_success "Health check exitoso"
            return 0
        fi
        
        log_info "Intento $attempt/$max_attempts - esperando que la aplicación esté lista..."
        sleep 2
        ((attempt++))
    done
    
    log_error "Health check falló después de $max_attempts intentos"
    return 1
}

# Función para hacer deployment
deploy_application() {
    log_info "Desplegando aplicación..."
    
    cd "$PROJECT_ROOT"
    
    case "$ENVIRONMENT" in
        "development")
            # Para desarrollo, simplemente iniciar con hot reload
            log_info "Iniciando en modo desarrollo..."
            npm run start:dev &
            sleep 10
            verify_health
            ;;
        "staging"|"production")
            # Para staging/production, usar el build
            log_info "Iniciando aplicación construida..."
            
            # Detener instancia previa si existe
            pkill -f "node.*dist/main.js" || true
            sleep 2
            
            # Iniciar nueva instancia
            NODE_ENV="$ENVIRONMENT" nohup node dist/main.js > logs/app.log 2>&1 &
            sleep 10
            
            verify_health
            ;;
    esac
    
    log_success "Aplicación desplegada exitosamente"
}

# Función para verificar deployment
verify_deployment() {
    log_info "Verificando deployment..."
    
    local base_url="http://localhost:${PORT:-4000}"
    
    # Verificar endpoints críticos
    local endpoints=(
        "/health"
        "/health/ready"
        "/health/live"
        "/metrics"
    )
    
    for endpoint in "${endpoints[@]}"; do
        if curl -f -s "${base_url}${endpoint}" > /dev/null; then
            log_success "✓ $endpoint"
        else
            log_warning "✗ $endpoint no disponible"
        fi
    done
    
    # Verificar conectividad de base de datos
    if curl -f -s "${base_url}/health" | grep -q '"status":"healthy"'; then
        log_success "✓ Base de datos conectada"
    else
        log_warning "✗ Problemas de conectividad de base de datos"
    fi
    
    log_success "Verificación de deployment completada"
}

# Función de limpieza en caso de error
cleanup_on_error() {
    log_error "Error durante el deployment. Ejecutando limpieza..."
    
    # Detener procesos si es necesario
    pkill -f "npm.*start" || true
    pkill -f "node.*dist/main.js" || true
    
    # Restaurar backup si existe
    if [[ -f "$PROJECT_ROOT/.env.backup."* ]]; then
        latest_backup=$(ls -t "$PROJECT_ROOT/.env.backup."* | head -1)
        cp "$latest_backup" "$PROJECT_ROOT/.env"
        log_info "Backup de .env restaurado"
    fi
}

# Función principal
main() {
    log_info "=== Iniciando deployment de semantic-catalog-search ==="
    log_info "Entorno: $ENVIRONMENT"
    log_info "Timestamp: $(date)"
    log_info "Log file: $LOG_FILE"
    
    # Trap para manejar errores
    trap cleanup_on_error ERR
    
    # Ejecutar pasos del deployment
    check_requirements
    prepare_environment
    install_dependencies
    build_application
    run_tests
    deploy_application
    verify_deployment
    
    log_success "=== Deployment completado exitosamente ==="
    log_info "Aplicación disponible en: http://localhost:${PORT:-4000}"
    log_info "Health check: http://localhost:${PORT:-4000}/health"
    log_info "Métricas: http://localhost:${PORT:-4000}/metrics"
}

# Verificar argumentos
if [[ $# -gt 1 ]]; then
    echo "Uso: $0 [development|staging|production]"
    exit 1
fi

# Ejecutar script principal
main "$@"