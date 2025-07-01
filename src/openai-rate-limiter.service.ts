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
    // Límites: 10,000 RPM, 10,000,000 TPM
    // IMPORTANTE: OpenAI evalúa rate limits en ventanas de 1-10 segundos
    // Si enviamos 100 requests en 10 segundos = 600 RPM proyectado = rate limit!
    const embeddingConfig = this.isDevelopment ? {
      // Desarrollo: distribuir uniformemente
      minTime: 120, // 8.33 requests/segundo = 500 RPM máximo
      maxConcurrent: 5,
      reservoir: 80, // 80 requests iniciales
      reservoirRefreshAmount: 8, // 8 requests cada
      reservoirRefreshInterval: 1000, // 1 segundo (8 RPS = 480 RPM)
      highWater: 40,
    } : {
      // Producción: aún más conservador
      minTime: 150, // 6.67 requests/segundo = 400 RPM máximo  
      maxConcurrent: 3,
      reservoir: 60, // 60 requests iniciales
      reservoirRefreshAmount: 6, // 6 requests cada
      reservoirRefreshInterval: 1000, // 1 segundo (6 RPS = 360 RPM)
      highWater: 30,
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
    // Límites: 10,000 RPM, 30,000 TPM
    // Aplicar la misma lógica de distribución uniforme
    const chatConfig = this.isDevelopment ? {
      // Desarrollo: 3 RPS = 180 RPM
      minTime: 350, // ~2.86 requests/segundo
      maxConcurrent: 3,
      reservoir: 30,
      reservoirRefreshAmount: 3,
      reservoirRefreshInterval: 1000, // 3 requests por segundo
      highWater: 20,
    } : {
      // Producción: 2 RPS = 120 RPM
      minTime: 500, // 2 requests/segundo
      maxConcurrent: 2,
      reservoir: 20,
      reservoirRefreshAmount: 2,
      reservoirRefreshInterval: 1000, // 2 requests por segundo
      highWater: 10,
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
    
    this.logger.log(
      'Rate Limiter Metrics',
      {
        period: '5min',
        embedding: {
          queued: embeddingCounts.QUEUED,
          running: embeddingCounts.RUNNING,
          done: embeddingCounts.DONE
        },
        chat: {
          queued: chatCounts.QUEUED,
          running: chatCounts.RUNNING,
          done: chatCounts.DONE
        },
        total: {
          requests: this.metrics.totalRequests,
          rateLimitHits: this.metrics.rateLimitHits,
          queuedRequests: embeddingCounts.QUEUED + chatCounts.QUEUED
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
          
          // Implementar retry manual con exponential backoff para 429
          let lastError;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              return await operation();
            } catch (error) {
              if (error?.status === 429 || error?.response?.status === 429) {
                lastError = error;
                const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
                const rateLimitInfo = this.extractRateLimitInfo(error);
                this.logger.warn(
                  `Rate limit hit on attempt ${attempt + 1}, waiting ${backoff}ms`,
                  { operationId, ...rateLimitInfo }
                );
                await new Promise(resolve => setTimeout(resolve, backoff));
                continue;
              }
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
        { id: operationId || `chat-${Date.now()}` },
        async () => {
          this.logger.debug(`Executing chat operation: ${operationId || 'unnamed'}`);
          return await operation();
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