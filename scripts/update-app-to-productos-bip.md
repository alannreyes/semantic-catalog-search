# 📋 Guía de Actualización: Migrar a productos_bip

## 1. Ejecutar Script SQL

```bash
psql $DATABASE_URL -f scripts/create-productos-bip-table.sql
```

## 2. Actualizar Variables de Entorno

```bash
# En .env o configuración de Easypanel
PRODUCT_TABLE=productos_bip  # Cambiar de productos_1024 a productos_bip
```

## 3. Campos de Migración Actualizados

Al crear un job de migración, usar estos campos:

```json
POST /migration/bulk-load
{
  "source": {
    "fields": {
      "codigo_efc": "ART_CODART",
      "descripcion": "ART_DESART",
      "marca": "ART_PARAM3",
      "codfabrica": "ART_CODFABRICA",
      "articulo_stock": "ART_FLGSTKDIST",    // Flag stock
      "lista_costos": "ART_FLGLSTPRE",       // Flag acuerdo
      "precio_lista": "ART_PRECLISTA",       // Nuevo
      "precio_costo": "ART_PRECCOSTO",       // Nuevo
      "stock_actual": "ART_STOCK",           // Nuevo
      "categoria": "ART_CODFAM",             // Nuevo
      "unidad_medida": "ART_UNIMED"          // Nuevo
    }
  },
  "destination": {
    "table": "productos_bip"
  }
}
```

## 4. Consultas SQL de Verificación

```sql
-- Ver categorías comerciales
SELECT categoria_comercial, color_categoria, COUNT(*) 
FROM productos_bip 
GROUP BY categoria_comercial, color_categoria;

-- Ver productos con mejor prioridad comercial
SELECT codigo, descripcion, prioridad_comercial, categoria_comercial
FROM productos_bip
ORDER BY prioridad_comercial DESC
LIMIT 20;

-- Ver historial de un cliente
SELECT * FROM v_productos_favoritos_cliente
WHERE cliente_id = 'CLI001';
```

## 5. Endpoints de Búsqueda Mejorados

La búsqueda ahora considerará automáticamente:
- ✅ Productos en stock (boost x1.4)
- ✅ Productos con acuerdos comerciales (boost x1.3)
- ✅ Stock + Acuerdo (boost x1.8)
- ✅ Historial del cliente (boost x1.5)

## 6. Colores en UI

```javascript
const COLORES_CATEGORIA = {
  'stock_acuerdo': '#4CAF50',    // Verde - Óptimo
  'solo_stock': '#FFEB3B',        // Amarillo - Stock disponible
  'solo_acuerdo': '#2196F3',      // Azul - Mejor precio
  'con_historial': '#F44336',     // Rojo - Cliente lo compró antes
  'historial_stock': '#9C27B0',   // Morado - Historial + ventaja
  'estandar': '#9E9E9E'           // Gris - Sin ventajas
};
```

## 7. Funciones Nuevas Disponibles

```sql
-- Calcular prioridad con contexto de cliente
SELECT calcular_prioridad_cliente('TORN001', 'CLI001', 0.95);

-- Ver productos comercialmente óptimos
SELECT * FROM v_productos_comercial
WHERE categoria_comercial IN ('stock_acuerdo', 'solo_stock')
ORDER BY prioridad_comercial DESC;
```

## 8. Migración de Datos Existentes

Si ya tienes datos en productos_1024:

```sql
-- Copiar datos básicos
INSERT INTO productos_bip (codigo, descripcion, marca, embedding)
SELECT codigo, descripcion, marca, embedding
FROM productos_1024
WHERE activo = true;

-- Luego ejecutar migración para actualizar flags comerciales
```

## 9. Beneficios de la Nueva Estructura

1. **Búsquedas más inteligentes**: Prioriza lo comercialmente conveniente
2. **Historial integrado**: Sugiere lo que el cliente ya conoce
3. **Gestión de inventario**: Sabe qué está disponible
4. **Márgenes optimizados**: Prioriza productos con mejores márgenes
5. **UI intuitiva**: Colores indican la conveniencia comercial

## 10. Próximos Pasos

1. Ejecutar script SQL ✅
2. Cambiar PRODUCT_TABLE en variables ✅
3. Hacer nueva migración con campos completos ✅
4. Probar búsquedas con filtros comerciales ✅
5. Implementar UI con colores ⏳