import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, context, trace, ...meta }) => {
    const logEntry: any = {
      timestamp,
      level,
      context,
      message,
    };

    // Solo incluir stack trace en desarrollo
    if (trace && process.env.NODE_ENV !== 'production') {
      logEntry.trace = trace;
    }

    // Sanitizar información sensible
    Object.keys(meta).forEach(key => {
      if (key.toLowerCase().includes('password') || 
          key.toLowerCase().includes('secret') || 
          key.toLowerCase().includes('token') ||
          key.toLowerCase().includes('key')) {
        logEntry[key] = '[REDACTED]';
      } else {
        logEntry[key] = meta[key];
      }
    });

    return JSON.stringify(logEntry);
  })
);

export const winstonConfig = WinstonModule.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: logFormat,
  defaultMeta: {
    service: 'semantic-catalog-search',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '0.0.1'
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' 
        ? logFormat 
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ timestamp, level, context, message }) => {
              return `${timestamp} [${context}] ${level}: ${message}`;
            })
          )
    }),

    // File transports para producción
    ...(process.env.NODE_ENV === 'production' ? [
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 50 * 1024 * 1024, // 50MB
        maxFiles: 5,
        tailable: true
      }),
      new winston.transports.File({
        filename: 'logs/app.log',
        maxsize: 100 * 1024 * 1024, // 100MB
        maxFiles: 3,
        tailable: true
      })
    ] : [])
  ],

  // Exception handlers
  exceptionHandlers: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production' ? [
      new winston.transports.File({ 
        filename: 'logs/exceptions.log',
        maxsize: 50 * 1024 * 1024,
        maxFiles: 3
      })
    ] : [])
  ],

  // Rejection handlers
  rejectionHandlers: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production' ? [
      new winston.transports.File({ 
        filename: 'logs/rejections.log',
        maxsize: 50 * 1024 * 1024,
        maxFiles: 3
      })
    ] : [])
  ],

  exitOnError: false
});