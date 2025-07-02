import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);
  
  // Variables estáticas para mantener el estado entre requests
  private static requestCount = 0;
  private static windowStart = Date.now();
  private static readonly WINDOW_SIZE = 60000; // 1 minuto en milisegundos
  private static readonly MAX_REQUESTS = 90; // Límite seguro por debajo de 100
  private static readonly WAIT_TIME = 500; // 500ms entre requests cuando se excede

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const now = Date.now();
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    
    // Reset ventana cada minuto
    if (now - RateLimitInterceptor.windowStart > RateLimitInterceptor.WINDOW_SIZE) {
      const previousCount = RateLimitInterceptor.requestCount;
      RateLimitInterceptor.requestCount = 0;
      RateLimitInterceptor.windowStart = now;
      
      if (previousCount > 0) {
        this.logger.log(
          `Rate limit window reset. Previous window: ${previousCount} requests`,
          {
            previousCount,
            windowDuration: RateLimitInterceptor.WINDOW_SIZE,
            maxAllowed: RateLimitInterceptor.MAX_REQUESTS
          }
        );
      }
    }
    
    // Calcular tiempo restante en la ventana actual
    const timeInCurrentWindow = now - RateLimitInterceptor.windowStart;
    const timeRemainingInWindow = RateLimitInterceptor.WINDOW_SIZE - timeInCurrentWindow;
    
    // Si excede límite, aplicar delay
    if (RateLimitInterceptor.requestCount >= RateLimitInterceptor.MAX_REQUESTS) {
      this.logger.warn(
        `Rate limit reached (${RateLimitInterceptor.requestCount}/${RateLimitInterceptor.MAX_REQUESTS}). Applying ${RateLimitInterceptor.WAIT_TIME}ms delay`,
        {
          currentCount: RateLimitInterceptor.requestCount,
          maxRequests: RateLimitInterceptor.MAX_REQUESTS,
          timeRemainingInWindow: Math.round(timeRemainingInWindow / 1000),
          method,
          url: url.substring(0, 50)
        }
      );
      
      // Esperar antes de continuar
      await new Promise(resolve => setTimeout(resolve, RateLimitInterceptor.WAIT_TIME));
    }
    
    // Incrementar contador
    RateLimitInterceptor.requestCount++;
    
    // Log cada 10 requests para monitoreo
    if (RateLimitInterceptor.requestCount % 10 === 0) {
      this.logger.log(
        `Rate limit status: ${RateLimitInterceptor.requestCount}/${RateLimitInterceptor.MAX_REQUESTS} requests in current window`,
        {
          currentCount: RateLimitInterceptor.requestCount,
          maxRequests: RateLimitInterceptor.MAX_REQUESTS,
          timeRemainingInWindow: Math.round(timeRemainingInWindow / 1000),
          effectiveRPM: Math.round((RateLimitInterceptor.requestCount / timeInCurrentWindow) * 60000)
        }
      );
    }
    
    // Continuar con la request normal
    return next.handle();
  }
}