import { LoggerService, Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as winston from 'winston';
import { Pool } from 'pg'; // Importa el Pool de 'pg' para la conexión a la base de datos
import { ConfigService } from '@nestjs/config'; // Importa ConfigService para leer variables de entorno
import Transport from 'winston-transport';

// --- Custom Winston Transport para PostgreSQL ---
// Esta clase define cómo Winston debe enviar los logs a tu base de datos PostgreSQL.

class PostgresTransport extends Transport {

  private pool: Pool; // Pool de conexiones a la base de datos

  // El constructor recibe el Pool de conexiones para poder interactuar con la DB
constructor(options: Transport.TransportStreamOptions & { pool: Pool }) {
    super(options);
    this.pool = options.pool;
  }

  // El método 'log' es llamado por Winston para cada evento de log
  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info); // Emite un evento para indicar que el log ha sido procesado por el transporte
    });

    // Extrae las propiedades relevantes del objeto 'info' de log de Winston
    // 'meta' capturará cualquier propiedad adicional que pasemos al logger (como 'duration_ms')
    const { level, message, context, timestamp, duration_ms, query_text, ...meta } = info;
    
    // Asegura que el mensaje sea siempre un string para evitar errores en la DB
    const logMessage = typeof message === 'object' ? JSON.stringify(message) : String(message);

    // Consulta SQL para insertar el log en la tabla 'application_logs'
    const query = `
      INSERT INTO application_logs (timestamp, level, context, message, duration_ms, query_text, extra_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;
    
    // Valores a insertar, mapeados a los placeholders ($1, $2, etc.) en la consulta
    const values = [
      timestamp,
      level,
      context || 'Application', // Usa 'Application' como contexto por defecto
      logMessage,
      duration_ms || null, // Si 'duration_ms' no está definido, guarda NULL en la DB
      query_text || null,  // Si 'query_text' no está definido, guarda NULL
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null // Si hay metadatos adicionales, conviértelos a JSON string
    ];

    // Ejecuta la consulta para insertar el log
    this.pool.query(query, values)
      .then(() => {
        // Log insertado correctamente, no es necesario hacer nada aquí (evita loops de log)
      })
      .catch((err) => {
        // Si hay un error al insertar el log, lo registramos en la consola para depuración
        console.error('Error insertando log en PostgreSQL:', err.message, err.stack);
        this.emit('error', err); // Emite un evento de error del transporte
      });

    callback(); // Importante: Llama al callback para indicar a Winston que el transporte ha terminado de procesar el log
  }
}

// --- Servicio WinstonLoggerService de NestJS ---
// Este es el servicio que NestJS inyectará cuando se solicite 'Logger'.
@Injectable()
export class WinstonLoggerService implements LoggerService, OnApplicationShutdown {
  private readonly logger: winston.Logger; // Instancia del logger de Winston
  private pool: Pool; // Pool de conexiones dedicado para los logs

  constructor(private configService: ConfigService) {
    // Inicializa un Pool de conexiones a PostgreSQL específicamente para los logs.
    // Es crucial que esta configuración no interfiera con el pool de tu SearchService
    // si fueran el mismo. Un pool separado para logs es una buena práctica.
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'), // Obtiene la cadena de conexión de tus variables de entorno
      max: 5, // Límite de 5 conexiones para el pool de logs (ajustable según el volumen de logs)
      idleTimeoutMillis: 30000, // 30 segundos de inactividad antes de cerrar una conexión
      connectionTimeoutMillis: 10000, // 10 segundos de timeout para establecer una conexión
    });

    // Crea la instancia del logger de Winston
    this.logger = winston.createLogger({
      level: this.configService.get<string>('LOG_LEVEL') || 'info', // Nivel de log configurable (ej: 'info', 'debug', 'warn', 'error')
      format: winston.format.combine(
        // Formato para el timestamp: Año-Mes-Día Hora:Minuto:Segundo (SIN milisegundos en la salida general)
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        // Formato JSON para los logs que van a la base de datos, útil para el 'extra_data'
        winston.format.json(), 
      ),
      transports: [
        // Consola Transport: Muestra los logs en la terminal
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(), // Colores en la salida de la consola
                winston.format.printf(({ level, message, context, timestamp }) => {
                  // Formato legible para la consola, usando el timestamp sin milisegundos
                  return `${timestamp} [${context || 'Application'}] ${level.toUpperCase()}: ${message}`;
                }),
              ),
            level: 'debug' // Puedes poner un nivel de log más detallado para la consola
        }),
        // PostgreSQL Transport: Envía los logs a la base de datos
        new PostgresTransport({ pool: this.pool, level: 'info' }), // Envía logs de nivel 'info' y superiores a la DB
      ],
      // Manejo de excepciones no capturadas: Envía errores a consola y DB
      exceptionHandlers: [ 
        new winston.transports.Console(),
        new PostgresTransport({ pool: this.pool, level: 'error' }),
      ],
      // Manejo de promesas rechazadas no capturadas: Envía errores a consola y DB
      rejectionHandlers: [ 
        new winston.transports.Console(),
        new PostgresTransport({ pool: this.pool, level: 'error' }),
      ],
    });

    // Manejo de errores del pool de conexiones de la base de datos de logs
    this.pool.on('error', (err) => {
        console.error('Error inesperado en el pool de la DB de logs', err);
    });
  }

  // Métodos que implementan la interfaz LoggerService de NestJS
  // Estos métodos permiten que tu código use this.logger.log(), this.logger.error(), etc.
  // El parámetro '...optionalParams' permite pasar objetos con metadatos como { duration_ms: 123 }
  log(message: any, context?: string, ...optionalParams: any[]) {
    this.logger.info(message, { context, ...optionalParams[0] });
  }

  error(message: any, trace?: string, context?: string, ...optionalParams: any[]) {
    this.logger.error(message, { trace, context, ...optionalParams[0] });
  }

  warn(message: any, context?: string, ...optionalParams: any[]) {
    this.logger.warn(message, { context, ...optionalParams[0] });
  }

  debug(message: any, context?: string, ...optionalParams: any[]) {
    this.logger.debug(message, { context, ...optionalParams[0] });
  }

  verbose(message: any, context?: string, ...optionalParams: any[]) {
    this.logger.verbose(message, { context, ...optionalParams[0] });
  }

  // Método de ciclo de vida de NestJS para asegurar que el pool de logs se cierre limpiamente
  async onApplicationShutdown(signal?: string) {
    this.logger.info(`Cerrando pool de la DB de logs... Señal: ${signal}`, 'WinstonLoggerService');
    await this.pool.end(); // Cierra todas las conexiones en el pool
  }
}