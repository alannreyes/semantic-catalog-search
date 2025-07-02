import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bottleneck from 'bottleneck';
import OpenAI from 'openai';

interface RateLimitMetrics {
  totalRequests: number;
  queuedRequests: number;
  rateLimitHits: number;
  avgWaitTime: number;
  lastReset: Date;
}

@Injectable()
export class OpenAIRateLimiterService {
  private readonly logger = new Logger(OpenAIRateLimiterService.name);
  
  // Rate limiters separados para diferentes tipos de llamadas
  private readonly embeddingLimiter: Bottleneck;
  private readonly chatLimiter: Bottleneck;
  
  // Configuración por ambiente
  private readonly isDevelopment: boolean;
  
  // Control de timing para delay adaptativo (eliminado para máxima velocidad)
  private lastEmbeddingRequestTime = 0;
  private lastChatRequestTime = 0;
  private readonly MIN_TIME_BETWEEN_REQUESTS = 0; // Sin delay entre requests
  private readonly JITTER_RANGE = 0; // Sin jitter para máxima velocidad
  
  // Métricas simples
  private metrics: RateLimitMetrics = {
    totalRequests: 0,
    queuedRequests: 0,
    rateLimitHits: 0,
    avgWaitTime: 0,
    lastReset: new Date()
  };

  constructor(private readonly configService: ConfigService) {
    this.isDevelopment = this.configService.get('NODE_ENV') !== 'production';
    // Configuración para embeddings (text-embedding-3-large)
    // Límites Tier 5: 5,000,000 RPM, 5,000,000,000 TPM
    // Configuración optimizada para máxima velocidad
    const embeddingConfig = this.isDevelopment ? {
      // Desarrollo: conservador para testing
      minTime: 1000, // 1 request/segundo = 60 RPM
      maxConcurrent: 1,
      reservoir: 10, // 10 requests iniciales
      reservoirRefreshAmount: 1, // 1 request cada
      reservoirRefreshInterval: 1000, // 1 segundo (1 RPS = 60 RPM)
      highWater: 5,
    } : {
      // Producción: EXTREMADAMENTE CONSERVADOR para evitar 429
      minTime: 1000, // 1 request/segundo = 60 RPM  
      maxConcurrent: 1,
      reservoir: 5, // 5 requests iniciales
      reservoirRefreshAmount: 1, // 1 request cada
      reservoirRefreshInterval: 1000, // 1 segundo (1 RPS = 60 RPM)
      highWater: 3,
    };

    this.embeddingLimiter = new Bottleneck({
      ...embeddingConfig,
      strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
      timeout: 45000, // 45 segundos timeout
      // Retry configuration para manejar 429 errors
      retryCondition: (error: any) => {
        // Retry on 429 rate limit errors
        return error?.status === 429 || error?.response?.status === 429;
      },
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s
      retryCounts: 6,
    });

    // Configuración para chat completions (GPT-4o)
    // Límites Tier 5: 10,000 RPM, 30,000,000 TPM
    // Configuración ULTRA CONSERVADORA para evitar rate limits
    const chatConfig = this.isDevelopment ? {
      // Desarrollo: conservador
      minTime: 2000, // 0.5 requests/segundo = 30 RPM
      maxConcurrent: 1,
      reservoir: 5,
      reservoirRefreshAmount: 1,
      reservoirRefreshInterval: 2000, // 0.5 requests por segundo
      highWater: 3,
    } : {
      // Producción: EXTREMADAMENTE CONSERVADOR para evitar 429
      minTime: 2000, // 0.5 requests/segundo = 30 RPM
      maxConcurrent: 1,
      reservoir: 3,
      reservoirRefreshAmount: 1,
      reservoirRefreshInterval: 2000, // 1 request cada 2 segundos  
      highWater: 2,
    };

    this.chatLimiter = new Bottleneck({
      ...chatConfig,
      strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
      timeout: 60000, // 60 segundos timeout
      // Retry configuration para manejar 429 errors
      retryCondition: (error: any) => {
        return error?.status === 429 || error?.response?.status === 429;
      },
      retryCounts: 6,
    });

    this.setupEventListeners();
    this.startMetricsLogging();
  }

  private setupEventListeners(): void {
    // Event listeners para embeddings
    this.embeddingLimiter.on('failed', (error, jobInfo) => {
      this.metrics.rateLimitHits++;
      const rateLimitInfo = this.extractRateLimitInfo(error);
      this.logger.warn(
        `Embedding request failed: ${error.message}`,
        {
          jobId: jobInfo.options.id,
          retryCount: jobInfo.retryCount,
          error: error.name,
          status: error?.status || error?.response?.status,
          ...rateLimitInfo
        }
      );
    });

    this.embeddingLimiter.on('retry', (error, jobInfo) => {
      this.logger.log(
        `Retrying embedding request (attempt ${jobInfo.retryCount + 1})`,
        { jobId: jobInfo.options.id }
      );
    });

    // Event listeners para chat
    this.chatLimiter.on('failed', (error, jobInfo) => {
      this.metrics.rateLimitHits++;
      this.logger.warn(
        `Chat completion request failed: ${error.message}`,
        {
          jobId: jobInfo.options.id,
          retryCount: jobInfo.retryCount,
          error: error.name
        }
      );
    });

    this.chatLimiter.on('retry', (error, jobInfo) => {
      this.logger.log(
        `Retrying chat completion request (attempt ${jobInfo.retryCount + 1})`,
        { jobId: jobInfo.options.id }
      );
    });

    // Event listeners generales
    [this.embeddingLimiter, this.chatLimiter].forEach((limiter, index) => {
      const type = index === 0 ? 'embedding' : 'chat';
      
      limiter.on('depleted', (empty) => {
        this.logger.warn(`${type} limiter depleted - requests will be queued`);
      });

      limiter.on('empty', () => {
        this.logger.debug(`${type} limiter queue is empty`);
      });
    });
  }

  private startMetricsLogging(): void {
    // Log métricas cada 5 minutos
    setInterval(() => {
      this.logMetrics();
    }, 5 * 60 * 1000);
  }

  private extractRateLimitInfo(error: any): Record<string, any> {
    const headers = error?.response?.headers || error?.headers || {};
    return {
      rateLimitRemaining: headers['x-ratelimit-remaining-requests'],
      rateLimitReset: headers['x-ratelimit-reset-requests'],
      rateLimitTotal: headers['x-ratelimit-limit-requests'],
      tokensRemaining: headers['x-ratelimit-remaining-tokens'],
      tokensReset: headers['x-ratelimit-reset-tokens'],
      tokensTotal: headers['x-ratelimit-limit-tokens']
    };
  }

  private logMetrics(): void {
    const embeddingCounts = this.embeddingLimiter.counts();
    const chatCounts = this.chatLimiter.counts();
    
    const now = Date.now();
    const timeSinceLastEmbedding = this.lastEmbeddingRequestTime > 0 
      ? now - this.lastEmbeddingRequestTime 
      : null;
    const timeSinceLastChat = this.lastChatRequestTime > 0 
      ? now - this.lastChatRequestTime 
      : null;
    
    this.logger.log(
      'Rate Limiter Metrics',
      {
        period: '5min',
        embedding: {
          queued: embeddingCounts.QUEUED,
          running: embeddingCounts.RUNNING,
          done: embeddingCounts.DONE,
          timeSinceLastRequest: timeSinceLastEmbedding
        },
        chat: {
          queued: chatCounts.QUEUED,
          running: chatCounts.RUNNING,
          done: chatCounts.DONE,
          timeSinceLastRequest: timeSinceLastChat
        },
        total: {
          requests: this.metrics.totalRequests,
          rateLimitHits: this.metrics.rateLimitHits,
          queuedRequests: embeddingCounts.QUEUED + chatCounts.QUEUED,
          avgWaitTime: this.metrics.avgWaitTime.toFixed(0)
        },
        config: {
          minTimeBetweenRequests: this.MIN_TIME_BETWEEN_REQUESTS,
          effectiveRPM: Math.floor(60000 / this.MIN_TIME_BETWEEN_REQUESTS)
        }
      }
    );

    // Reset metrics parcialmente
    this.metrics.rateLimitHits = 0;
    this.metrics.lastReset = new Date();
  }

  /**
   * Ejecuta una llamada a OpenAI embeddings con rate limiting
   */
  async executeEmbedding<T>(
    operation: () => Promise<T>,
    operationId?: string
  ): Promise<T> {
    this.metrics.totalRequests++;
    
    const startTime = Date.now();
    
    try {
      const result = await this.embeddingLimiter.schedule(
        { 
          id: operationId || `embedding-${Date.now()}`,
          expiration: 60000, // Expirar después de 1 minuto si no se ejecuta
          priority: 5
        },
        async () => {
          this.logger.debug(`Executing embedding operation: ${operationId || 'unnamed'}`);
          
          // Delay adaptativo eliminado para máxima velocidad
          
          // Implementar pausa de 10 segundos en caso de 429
          let lastError;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              return await operation();
            } catch (error) {
              if (error?.status === 429 || error?.response?.status === 429) {
                lastError = error;
                const rateLimitInfo = this.extractRateLimitInfo(error);
                
                // CAMBIO: Esperar 30 segundos fijos cuando hay 429
                const waitTime = 30000; // 30 segundos
                this.logger.warn(
                  `⚠️ Rate limit 429 detectado. Pausando ${waitTime/1000} segundos antes de reintentar...`,
                  { 
                    operationId, 
                    attempt: attempt + 1,
                    maxAttempts: 5,
                    ...rateLimitInfo 
                  }
                );
                
                // Esperar 30 segundos
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Continuar con el siguiente intento
                this.logger.log(`Reintentando después de pausa de 30 segundos...`);
                continue;
              }
              // Si no es 429, lanzar el error inmediatamente
              throw error;
            }
          }
          throw lastError;
        }
      );
      
      const duration = Date.now() - startTime;
      this.updateAvgWaitTime(duration);
      
      this.logger.debug(
        `Embedding operation completed`,
        { 
          operationId: operationId || 'unnamed',
          duration: `${duration}ms`,
          queueSize: this.embeddingLimiter.counts().QUEUED
        }
      );
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const rateLimitInfo = this.extractRateLimitInfo(error);
      this.logger.error(
        `Embedding operation failed`,
        error.stack,
        {
          operationId: operationId || 'unnamed',
          duration: `${duration}ms`,
          error: error.message,
          status: error?.status,
          ...rateLimitInfo
        }
      );
      throw error;
    }
  }

  /**
   * Ejecuta una llamada a OpenAI chat completions con rate limiting
   */
  async executeChat<T>(
    operation: () => Promise<T>,
    operationId?: string
  ): Promise<T> {
    this.metrics.totalRequests++;
    
    const startTime = Date.now();
    
    try {
      const result = await this.chatLimiter.schedule(
        { 
          id: operationId || `chat-${Date.now()}`,
          expiration: 60000,
          priority: 5
        },
        async () => {
          this.logger.debug(`Executing chat operation: ${operationId || 'unnamed'}`);
          
          // Delay adaptativo eliminado para máxima velocidad
          
          // Implementar pausa de 10 segundos en caso de 429
          let lastError;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              return await operation();
            } catch (error) {
              if (error?.status === 429 || error?.response?.status === 429) {
                lastError = error;
                const rateLimitInfo = this.extractRateLimitInfo(error);
                
                // CAMBIO: Esperar 30 segundos fijos cuando hay 429
                const waitTime = 30000; // 30 segundos
                this.logger.warn(
                  `⚠️ Chat rate limit 429 detectado. Pausando ${waitTime/1000} segundos antes de reintentar...`,
                  { 
                    operationId, 
                    attempt: attempt + 1,
                    maxAttempts: 5,
                    ...rateLimitInfo 
                  }
                );
                
                // Esperar 10 segundos
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Continuar con el siguiente intento
                this.logger.log(`Reintentando chat después de pausa de 30 segundos...`);
                continue;
              }
              // Si no es 429, lanzar el error inmediatamente
              throw error;
            }
          }
          throw lastError;
        }
      );
      
      const duration = Date.now() - startTime;
      this.updateAvgWaitTime(duration);
      
      this.logger.debug(
        `Chat operation completed`,
        { 
          operationId: operationId || 'unnamed',
          duration: `${duration}ms`
        }
      );
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Chat operation failed`,
        error.stack,
        {
          operationId: operationId || 'unnamed',
          duration: `${duration}ms`,
          error: error.message
        }
      );
      throw error;
    }
  }

  private updateAvgWaitTime(duration: number): void {
    this.metrics.avgWaitTime = 
      (this.metrics.avgWaitTime + duration) / 2;
  }

  /**
   * Implementa un delay adaptativo con jitter para evitar el límite de 100 requests
   */
  private async enforceAdaptiveDelay(isEmbedding: boolean): Promise<number> {
    const now = Date.now();
    const lastRequestTime = isEmbedding ? this.lastEmbeddingRequestTime : this.lastChatRequestTime;
    const timeSinceLastRequest = now - lastRequestTime;
    
    // Calcular delay necesario
    let delayMs = 0;
    if (lastRequestTime > 0 && timeSinceLastRequest < this.MIN_TIME_BETWEEN_REQUESTS) {
      // Necesitamos esperar
      delayMs = this.MIN_TIME_BETWEEN_REQUESTS - timeSinceLastRequest;
      
      // Agregar jitter para evitar patrones
      const jitter = (Math.random() - 0.5) * this.JITTER_RANGE;
      delayMs = Math.max(0, delayMs + jitter);
      
      this.logger.debug(
        `Applying adaptive delay: ${delayMs.toFixed(0)}ms for ${isEmbedding ? 'embedding' : 'chat'}`,
        {
          timeSinceLastRequest,
          minTimeBetweenRequests: this.MIN_TIME_BETWEEN_REQUESTS,
          jitter: jitter.toFixed(0)
        }
      );
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    // Actualizar último tiempo de request
    if (isEmbedding) {
      this.lastEmbeddingRequestTime = Date.now();
    } else {
      this.lastChatRequestTime = Date.now();
    }
    
    return delayMs;
  }

  /**
   * Obtiene métricas actuales del rate limiter
   */
  getMetrics(): RateLimitMetrics & {
    embedding: Bottleneck.Counts;
    chat: Bottleneck.Counts;
  } {
    return {
      ...this.metrics,
      embedding: this.embeddingLimiter.counts(),
      chat: this.chatLimiter.counts()
    };
  }

  /**
   * Comprueba si hay capacidad disponible sin hacer cola
   */
  hasCapacity(): {
    embedding: boolean;
    chat: boolean;
  } {
    const embeddingCounts = this.embeddingLimiter.counts();
    const chatCounts = this.chatLimiter.counts();
    
    return {
      embedding: embeddingCounts.QUEUED === 0 && embeddingCounts.RUNNING < 10,
      chat: chatCounts.QUEUED === 0 && chatCounts.RUNNING < 5
    };
  }

  /**
   * Para uso en shutdown de la aplicación
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutting down rate limiters...');
    
    try {
      await Promise.all([
        this.embeddingLimiter.stop({ dropWaitingJobs: false }),
        this.chatLimiter.stop({ dropWaitingJobs: false })
      ]);
      
      this.logger.log('Rate limiters shutdown completed');
    } catch (error) {
      this.logger.error('Error during rate limiter shutdown', error.stack);
    }
  }
}