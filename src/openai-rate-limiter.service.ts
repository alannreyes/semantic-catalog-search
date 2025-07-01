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
    // Configuración conservadora: ajustada por ambiente
    const embeddingConfig = this.isDevelopment ? {
      // Desarrollo: más permisivo
      minTime: 50,
      maxConcurrent: 15,
      reservoir: 800,
      reservoirRefreshAmount: 800,
      highWater: 150,
    } : {
      // Producción: conservador
      minTime: 100,
      maxConcurrent: 10,
      reservoir: 500,
      reservoirRefreshAmount: 500,
      highWater: 100,
    };

    this.embeddingLimiter = new Bottleneck({
      ...embeddingConfig,
      reservoirRefreshInterval: 60 * 1000, // Refresh cada minuto
      strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
      timeout: 45000, // 45 segundos timeout
    });

    // Configuración para chat completions (GPT-4o)
    // Límites: 10,000 RPM, 30,000 TPM
    const chatConfig = this.isDevelopment ? {
      // Desarrollo: más permisivo
      minTime: 150,
      maxConcurrent: 8,
      reservoir: 300,
      reservoirRefreshAmount: 300,
      highWater: 80,
    } : {
      // Producción: conservador para GPT-4o por límite de tokens
      minTime: 200,
      maxConcurrent: 5,
      reservoir: 200,
      reservoirRefreshAmount: 200,
      highWater: 50,
    };

    this.chatLimiter = new Bottleneck({
      ...chatConfig,
      reservoirRefreshInterval: 60 * 1000,
      strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
      timeout: 60000, // 60 segundos timeout
    });

    this.setupEventListeners();
    this.startMetricsLogging();
  }

  private setupEventListeners(): void {
    // Event listeners para embeddings
    this.embeddingLimiter.on('failed', (error, jobInfo) => {
      this.metrics.rateLimitHits++;
      this.logger.warn(
        `Embedding request failed: ${error.message}`,
        {
          jobId: jobInfo.options.id,
          retryCount: jobInfo.retryCount,
          error: error.name
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
        { id: operationId || `embedding-${Date.now()}` },
        async () => {
          this.logger.debug(`Executing embedding operation: ${operationId || 'unnamed'}`);
          return await operation();
        }
      );
      
      const duration = Date.now() - startTime;
      this.updateAvgWaitTime(duration);
      
      this.logger.debug(
        `Embedding operation completed`,
        { 
          operationId: operationId || 'unnamed',
          duration: `${duration}ms`
        }
      );
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Embedding operation failed`,
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