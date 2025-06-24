import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import OpenAI from 'openai';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(private readonly configService: ConfigService) {}

  async checkHealth() {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const services = await Promise.allSettled([
      this.checkDatabase(),
      this.checkOpenAI(),
      this.checkEnvironment()
    ]);

    const [database, openai, environment] = services.map(result => 
      result.status === 'fulfilled' ? result.value : { status: 'down', error: result.reason.message }
    );

    const overall = database.status === 'up' && openai.status === 'up' && environment.status === 'up' 
      ? 'healthy' : 'unhealthy';

    return {
      status: overall,
      timestamp,
      uptime,
      version: process.env.npm_package_version || '0.0.1',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database,
        openai,
        environment
      }
    };
  }

  async checkReadiness() {
    const health = await this.checkHealth();
    const ready = health.status === 'healthy';

    return {
      ready,
      timestamp: new Date().toISOString(),
      checks: {
        database: health.services.database.status === 'up',
        openai: health.services.openai.status === 'up',
        environment: health.services.environment.status === 'up'
      }
    };
  }

  async checkLiveness() {
    // Liveness check básico - solo verifica que la aplicación responda
    return {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: process.memoryUsage(),
      pid: process.pid
    };
  }

  private async checkDatabase(): Promise<{ status: string; responseTime?: number; error?: string }> {
    const start = Date.now();
    
    try {
      const pool = new Pool({
        connectionString: this.configService.get<string>('DATABASE_URL'),
        connectionTimeoutMillis: 5000, // 5 segundos timeout para health check
        ssl: process.env.NODE_ENV === 'production' ? {
          rejectUnauthorized: true,
          ca: this.configService.get<string>('DB_CA_CERT'),
          cert: this.configService.get<string>('DB_CLIENT_CERT'),
          key: this.configService.get<string>('DB_CLIENT_KEY')
        } : false,
      });

      const client = await pool.connect();
      
      // Query simple para verificar conexión
      await client.query('SELECT 1');
      
      client.release();
      await pool.end();
      
      const responseTime = Date.now() - start;
      
      return {
        status: 'up',
        responseTime
      };
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return {
        status: 'down',
        error: error.message
      };
    }
  }

  private async checkOpenAI(): Promise<{ status: string; responseTime?: number; error?: string }> {
    const start = Date.now();
    
    try {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      
      if (!apiKey) {
        return {
          status: 'down',
          error: 'OpenAI API key not configured'
        };
      }

      const openai = new OpenAI({
        apiKey,
        timeout: 5000, // 5 segundos timeout para health check
      });

      // Test simple de API - listar modelos es ligero
      await openai.models.list();
      
      const responseTime = Date.now() - start;
      
      return {
        status: 'up',
        responseTime
      };
    } catch (error) {
      this.logger.error(`OpenAI health check failed: ${error.message}`);
      return {
        status: 'down',
        error: error.message
      };
    }
  }

  private async checkEnvironment(): Promise<{ status: string; missing?: string[] }> {
    const requiredEnvVars = [
      'DATABASE_URL',
      'OPENAI_API_KEY',
      'PRODUCT_TABLE',
      'VECTOR_DIMENSIONS'
    ];

    const missing = requiredEnvVars.filter(envVar => 
      !this.configService.get<string>(envVar)
    );

    if (missing.length > 0) {
      this.logger.error(`Missing required environment variables: ${missing.join(', ')}`);
      return {
        status: 'down',
        missing
      };
    }

    return {
      status: 'up'
    };
  }
}