import { LoggerService, Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as winston from 'winston';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import Transport from 'winston-transport';

// --- Custom Winston Transport para PostgreSQL ---
class PostgresTransport extends Transport {
  private pool: Pool;

  constructor(options: any & { pool: Pool }) {
    super(options);
    this.pool = options.pool;
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const { level, message, context, timestamp, duration_ms, query_text, ...meta } = info;
    
    const logMessage = typeof message === 'object' ? JSON.stringify(message) : String(message);

    const query = `
      INSERT INTO application_logs (timestamp, level, context, message, duration_ms, query_text, extra_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;
    
    const values = [
      timestamp,
      level,
      context || 'Application',
      logMessage,
      duration_ms || null,
      query_text || null,
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
    ];

    this.pool.query(query, values)
      .then(() => {
        // Log insertado correctamente
      })
      .catch((err) => {
        console.error('Error insertando log en PostgreSQL:', err.message, err.stack);
        this.emit('error', err);
      });

    callback();
  }
}

@Injectable()
export class WinstonLoggerService implements LoggerService, OnApplicationShutdown {
  private readonly logger: winston.Logger;
  private pool: Pool;

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.logger = winston.createLogger({
      level: this.configService.get<string>('LOG_LEVEL') || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json(), 
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, context, timestamp }) => {
              return `${timestamp} [${context || 'Application'}] ${level.toUpperCase()}: ${message}`;
            }),
          ),
          level: 'debug'
        }),
        new PostgresTransport({ pool: this.pool, level: 'info' })
      ],
      exceptionHandlers: [ 
        new winston.transports.Console(),
        new PostgresTransport({ pool: this.pool, level: 'info' })
      ],
      rejectionHandlers: [ 
        new winston.transports.Console(),
        new PostgresTransport({ pool: this.pool, level: 'info' })
      ],
    });

    this.pool.on('error', (err) => {
      console.error('Error inesperado en el pool de la DB de logs', err);
    });
  }

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

  async onApplicationShutdown(signal?: string) {
    this.logger.info(`Cerrando pool de la DB de logs... Señal: ${signal}`, 'WinstonLoggerService');
    await this.pool.end();
  }
}