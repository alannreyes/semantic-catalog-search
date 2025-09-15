# Plan para implementar log de consultas

## Objetivo
Registrar en una tabla de base de datos todas las consultas realizadas a los endpoints:
- `/search/search` (POST)
- `/search/ismatch` (POST)
- `/search/simil` (POST)
- `/searchv2/searchv2` (POST)

## Datos a registrar
- **id**: serial/autoincremental (clave primaria)
- **fecha**: timestamp (formato dd/mm/aa hh:mm, pero se almacena como timestamp)
- **endpoint**: string (ejemplo: 'search', 'ismatch', 'simil', 'searchv2')
- **body**: json/texto (cuerpo de la consulta)
- **resultado**: json/texto (respuesta enviada al usuario)

## Tabla sugerida (PostgreSQL)
```sql
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  fecha TIMESTAMP NOT NULL,
  endpoint VARCHAR(32) NOT NULL,
  body JSONB NOT NULL,
  resultado JSONB NOT NULL
);
```

## Implementación
1. Crear un servicio LoggerService para insertar registros en la tabla `logs`.
2. Modificar los controladores de los endpoints mencionados para llamar al logger después de cada consulta.
3. Crear un endpoint GET `/logs`:
   - Recibe en el body:
     - `fechaInicio` (obligatorio, formato ISO o dd/mm/aa hh:mm)
     - `fechaFin` (opcional, por defecto es ahora)
     - `endpoint` (opcional, string: si se especifica, filtra solo por ese endpoint; si no, devuelve logs de todos)
   - Devuelve los logs en orden ascendente por fecha.

## Ejemplo de body para GET /logs
```json
{
  "fechaInicio": "2025-09-01 00:00",
  "fechaFin": "2025-09-15 23:59",
  "endpoint": "search" // opcional
}
```

## Notas
- Si no se envía `fechaFin`, se asume la fecha y hora actual.
- Si no se envía `endpoint`, se devuelven logs de todos los endpoints.
- El resultado se devuelve ordenado de más antiguo a más reciente.
- El logger solo aplica a los endpoints mencionados.

---

¿Listo para que te guíe con el código y la integración?