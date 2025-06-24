import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isProduction = process.env.NODE_ENV === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorDetails: any = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      
      if (typeof errorResponse === 'object' && errorResponse !== null) {
        message = (errorResponse as any).message || message;
        errorDetails = errorResponse;
      } else {
        message = errorResponse as string;
      }
    } else if (exception instanceof Error) {
      // Categorizar errores comunes para mejor UX
      if (exception.message.includes('timeout')) {
        status = HttpStatus.REQUEST_TIMEOUT;
        message = 'Request timeout - please try again';
      } else if (exception.message.includes('connection')) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Service temporarily unavailable';
      } else if (exception.message.includes('validation')) {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid request data';
      } else if (exception.message.includes('unauthorized') || exception.message.includes('forbidden')) {
        status = HttpStatus.UNAUTHORIZED;
        message = 'Access denied';
      }

      // Log completo para debugging interno
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        {
          error: exception.name,
          message: exception.message,
          stack: exception.stack,
          url: request.url,
          method: request.method,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        }
      );
    }

    // Respuesta sanitizada para el cliente
    const errorResponse = {
      statusCode: status,
      message: message,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      // Solo incluir detalles en desarrollo
      ...((!isProduction && exception instanceof HttpException) && { 
        details: errorDetails 
      }),
      // Stack trace solo en desarrollo
      ...((!isProduction && exception instanceof Error) && { 
        stack: exception.stack?.split('\n').slice(0, 10) // Limitar stack trace
      })
    };

    // Log de errores HTTP para monitoreo
    if (status >= 500) {
      this.logger.error(`HTTP ${status} - ${message}`, {
        url: request.url,
        method: request.method,
        statusCode: status,
        ip: request.ip,
      });
    } else if (status >= 400) {
      this.logger.warn(`HTTP ${status} - ${message}`, {
        url: request.url,
        method: request.method,
        statusCode: status,
        ip: request.ip,
      });
    }

    response.status(status).json(errorResponse);
  }
}