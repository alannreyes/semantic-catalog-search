#!/bin/bash

# Script de verificación de salud para semantic-catalog-search
# Uso: ./scripts/health-check.sh [--host HOST] [--port PORT] [--timeout TIMEOUT]

set -euo pipefail

# Configuración por defecto
HOST="localhost"
PORT="4000"
TIMEOUT="30"
VERBOSE=false

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Funciones de logging
log_info() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${BLUE}[INFO]${NC} $1"
    fi
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Procesar argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            HOST="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Uso: $0 [--host HOST] [--port PORT] [--timeout TIMEOUT] [--verbose]"
            echo ""
            echo "Opciones:"
            echo "  --host HOST       Host de la aplicación (default: localhost)"
            echo "  --port PORT       Puerto de la aplicación (default: 4000)"
            echo "  --timeout TIMEOUT Timeout en segundos (default: 30)"
            echo "  --verbose, -v     Output verbose"
            echo "  --help, -h        Mostrar esta ayuda"
            exit 0
            ;;
        *)
            log_error "Opción desconocida: $1"
            exit 1
            ;;
    esac
done

BASE_URL="http://$HOST:$PORT"

# Función para hacer request HTTP con timeout
http_request() {
    local url="$1"
    local expected_status="${2:-200}"
    
    log_info "Verificando: $url"
    
    local response
    local status_code
    
    response=$(curl -s -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null || echo "000")
    status_code="${response: -3}"
    response="${response%???}"
    
    if [[ "$status_code" == "$expected_status" ]]; then
        return 0
    else
        log_error "HTTP $status_code para $url (esperado: $expected_status)"
        return 1
    fi
}

# Función para verificar health básico
check_basic_health() {
    log_info "=== Verificación de Health Básico ==="
    
    local url="$BASE_URL/health"
    local success=true
    
    if response=$(curl -s --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        # Verificar que la respuesta contiene los campos esperados
        if echo "$response" | grep -q '"status"'; then
            local status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            
            if [[ "$status" == "healthy" ]]; then
                log_success "Application status: healthy"
            else
                log_warning "Application status: $status"
                success=false
            fi
        else
            log_error "Respuesta de health inválida"
            success=false
        fi
        
        # Mostrar información adicional si está en modo verbose
        if [[ "$VERBOSE" == true ]]; then
            echo "$response" | jq '.' 2>/dev/null || echo "$response"
        fi
    else
        log_error "No se pudo conectar al endpoint de health"
        success=false
    fi
    
    return $([[ "$success" == true ]] && echo 0 || echo 1)
}

# Función para verificar readiness
check_readiness() {
    log_info "=== Verificación de Readiness ==="
    
    local url="$BASE_URL/health/ready"
    local success=true
    
    if response=$(curl -s --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        if echo "$response" | grep -q '"ready":true'; then
            log_success "Application ready for traffic"
        else
            log_warning "Application not ready for traffic"
            if [[ "$VERBOSE" == true ]]; then
                echo "$response" | jq '.checks' 2>/dev/null || echo "$response"
            fi
            success=false
        fi
    else
        log_error "No se pudo verificar readiness"
        success=false
    fi
    
    return $([[ "$success" == true ]] && echo 0 || echo 1)
}

# Función para verificar liveness
check_liveness() {
    log_info "=== Verificación de Liveness ==="
    
    local url="$BASE_URL/health/live"
    
    if http_request "$url" 200; then
        log_success "Application is alive"
        return 0
    else
        log_error "Liveness check failed"
        return 1
    fi
}

# Función para verificar métricas
check_metrics() {
    log_info "=== Verificación de Métricas ==="
    
    local url="$BASE_URL/metrics"
    local success=true
    
    if response=$(curl -s --max-time "$TIMEOUT" "$url" 2>/dev/null); then
        if echo "$response" | grep -q '"uptime"'; then
            local uptime=$(echo "$response" | grep -o '"uptime":[0-9]*' | cut -d':' -f2)
            log_success "Application uptime: ${uptime}s"
            
            if [[ "$VERBOSE" == true ]]; then
                # Mostrar métricas clave
                echo "$response" | jq '.counters' 2>/dev/null || true
            fi
        else
            log_warning "Respuesta de métricas inválida"
            success=false
        fi
    else
        log_warning "No se pudieron obtener métricas"
        success=false
    fi
    
    return $([[ "$success" == true ]] && echo 0 || echo 1)
}

# Función para verificar endpoints funcionales
check_functional_endpoints() {
    log_info "=== Verificación de Endpoints Funcionales ==="
    
    local success=true
    
    # Verificar que los endpoints principales respondan (sin hacer requests reales)
    local endpoints=(
        "/search"
        "/webhook/test"
        "/migration/jobs"
        "/health"
        "/metrics"
    )
    
    for endpoint in "${endpoints[@]}"; do
        local url="$BASE_URL$endpoint"
        
        # Para endpoints POST, solo verificamos que respondan con error apropiado
        if [[ "$endpoint" == "/search" ]]; then
            if status_code=$(curl -s -w "%{http_code}" -o /dev/null --max-time 5 -X POST "$url" 2>/dev/null); then
                if [[ "$status_code" =~ ^[45][0-9][0-9]$ ]]; then
                    log_success "$endpoint responde (HTTP $status_code)"
                else
                    log_warning "$endpoint respuesta inesperada (HTTP $status_code)"
                fi
            else
                log_error "$endpoint no responde"
                success=false
            fi
        else
            # Para endpoints GET
            if status_code=$(curl -s -w "%{http_code}" -o /dev/null --max-time 5 "$url" 2>/dev/null); then
                if [[ "$status_code" =~ ^[2345][0-9][0-9]$ ]]; then
                    log_success "$endpoint responde (HTTP $status_code)"
                else
                    log_error "$endpoint error (HTTP $status_code)"
                    success=false
                fi
            else
                log_error "$endpoint no responde"
                success=false
            fi
        fi
    done
    
    return $([[ "$success" == true ]] && echo 0 || echo 1)
}

# Función para generar reporte de salud
generate_health_report() {
    log_info "=== Reporte de Salud ==="
    
    local overall_status="HEALTHY"
    local issues=0
    
    # Verificar conectividad básica
    if ! curl -s --max-time 5 "$BASE_URL/health" > /dev/null 2>&1; then
        log_error "Aplicación no accesible en $BASE_URL"
        overall_status="CRITICAL"
        ((issues++))
        return 1
    fi
    
    # Ejecutar verificaciones
    check_basic_health || { overall_status="UNHEALTHY"; ((issues++)); }
    check_readiness || { overall_status="UNHEALTHY"; ((issues++)); }
    check_liveness || { overall_status="CRITICAL"; ((issues++)); }
    check_metrics || { ((issues++)); }
    check_functional_endpoints || { overall_status="UNHEALTHY"; ((issues++)); }
    
    # Resumen final
    echo ""
    echo "=== RESUMEN ==="
    echo -e "Estado general: $(
        case $overall_status in
            "HEALTHY") echo -e "${GREEN}HEALTHY${NC}" ;;
            "UNHEALTHY") echo -e "${YELLOW}UNHEALTHY${NC}" ;;
            "CRITICAL") echo -e "${RED}CRITICAL${NC}" ;;
        esac
    )"
    echo "Issues encontrados: $issues"
    echo "URL base: $BASE_URL"
    echo "Timestamp: $(date)"
    
    # Exit code basado en el estado
    case $overall_status in
        "HEALTHY") return 0 ;;
        "UNHEALTHY") return 1 ;;
        "CRITICAL") return 2 ;;
    esac
}

# Función principal
main() {
    echo "=== Health Check - Semantic Catalog Search ==="
    echo "Target: $BASE_URL"
    echo "Timeout: ${TIMEOUT}s"
    echo ""
    
    # Verificar que curl está disponible
    if ! command -v curl &> /dev/null; then
        log_error "curl no está instalado"
        exit 1
    fi
    
    # Verificar que jq está disponible (opcional)
    if [[ "$VERBOSE" == true ]] && ! command -v jq &> /dev/null; then
        log_warning "jq no está instalado - output JSON sin formatear"
    fi
    
    # Ejecutar verificaciones
    generate_health_report
}

# Ejecutar script principal
main "$@"