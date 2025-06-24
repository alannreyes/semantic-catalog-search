import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { MetricsService } from '../../health/metrics.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(
    @Optional() @Inject(MetricsService) private readonly metricsService?: MetricsService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, url, headers, body, query } = request;
    
    // Generar request ID único
    const requestId = headers['x-request-id'] || uuidv4();
    
    // Añadir request ID al response header
    response.setHeader('x-request-id', requestId);
    
    // Añadir request ID al objeto request para uso posterior
    request.requestId = requestId;

    const startTime = Date.now();
    const userAgent = headers['user-agent'] || '';
    const ip = request.ip || request.connection.remoteAddress;

    // Incrementar contador de requests
    if (this.metricsService) {
      this.metricsService.incrementRequestCount();
      
      // Incrementar contadores específicos
      if (url.includes('/search')) {
        this.metricsService.incrementSearchCount();
      } else if (url.includes('/migration')) {
        this.metricsService.incrementMigrationCount();
      }
    }

    // Log de entrada
    this.logger.log({
      message: `Incoming ${method} ${url}`,
      requestId,
      method,
      url,
      ip,
      userAgent,
      query: this.sanitizeQuery(query),
      bodySize: body ? JSON.stringify(body).length : 0,
    });

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          // Log de salida exitosa
          this.logger.log({
            message: `Outgoing ${method} ${url} - ${statusCode}`,
            requestId,
            method,
            url,
            statusCode,
            duration,
            responseSize: data ? JSON.stringify(data).length : 0,
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode || 500;

          // Incrementar contador de errores
          if (this.metricsService) {
            this.metricsService.incrementErrorCount();
          }

          // Log de error
          this.logger.error({
            message: `Error ${method} ${url} - ${statusCode}`,
            requestId,
            method,
            url,
            statusCode,
            duration,
            error: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
          });
        },
      }),
    );
  }

  private sanitizeQuery(query: any): any {
    if (!query) return {};
    
    const sanitized = { ...query };
    
    // Sanitizar campos sensibles
    Object.keys(sanitized).forEach(key => {
      if (key.toLowerCase().includes('password') || 
          key.toLowerCase().includes('secret') || 
          key.toLowerCase().includes('token') ||
          key.toLowerCase().includes('key')) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
}