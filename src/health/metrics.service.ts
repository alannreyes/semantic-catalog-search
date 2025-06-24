import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as os from 'os';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private searchCount = 0;
  private migrationCount = 0;

  constructor(private readonly configService: ConfigService) {}

  incrementRequestCount() {
    this.requestCount++;
  }

  incrementErrorCount() {
    this.errorCount++;
  }

  incrementSearchCount() {
    this.searchCount++;
  }

  incrementMigrationCount() {
    this.migrationCount++;
  }

  async getApplicationMetrics() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memoryUsage = process.memoryUsage();

    return {
      application: {
        name: 'semantic-catalog-search',
        version: process.env.npm_package_version || '0.0.1',
        environment: process.env.NODE_ENV || 'development',
        uptime,
        startTime: new Date(this.startTime).toISOString()
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        loadAverage: os.loadavg(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuCount: os.cpus().length
      },
      process: {
        pid: process.pid,
        memory: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers
        },
        cpu: process.cpuUsage()
      },
      counters: {
        totalRequests: this.requestCount,
        totalErrors: this.errorCount,
        totalSearches: this.searchCount,
        totalMigrations: this.migrationCount,
        errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0
      },
      database: await this.getDatabaseMetrics(),
      timestamp: new Date().toISOString()
    };
  }

  async getPerformanceMetrics() {
    const metrics = await this.getApplicationMetrics();
    
    return {
      uptime: metrics.application.uptime,
      memoryUsage: {
        heapUsed: metrics.process.memory.heapUsed,
        heapTotal: metrics.process.memory.heapTotal,
        rss: metrics.process.memory.rss,
        heapUtilization: (metrics.process.memory.heapUsed / metrics.process.memory.heapTotal) * 100
      },
      systemLoad: {
        loadAverage: metrics.system.loadAverage,
        freeMemory: metrics.system.freeMemory,
        totalMemory: metrics.system.totalMemory,
        memoryUtilization: ((metrics.system.totalMemory - metrics.system.freeMemory) / metrics.system.totalMemory) * 100
      },
      requests: {
        total: metrics.counters.totalRequests,
        errors: metrics.counters.totalErrors,
        errorRate: metrics.counters.errorRate,
        requestsPerSecond: metrics.application.uptime > 0 ? metrics.counters.totalRequests / metrics.application.uptime : 0
      },
      features: {
        searches: metrics.counters.totalSearches,
        migrations: metrics.counters.totalMigrations,
        searchesPerSecond: metrics.application.uptime > 0 ? metrics.counters.totalSearches / metrics.application.uptime : 0
      }
    };
  }

  async getPrometheusFormat() {
    const metrics = await this.getApplicationMetrics();
    
    const prometheusMetrics = [
      `# HELP app_uptime_seconds Application uptime in seconds`,
      `# TYPE app_uptime_seconds gauge`,
      `app_uptime_seconds ${metrics.application.uptime}`,
      '',
      `# HELP app_requests_total Total number of requests`,
      `# TYPE app_requests_total counter`,
      `app_requests_total ${metrics.counters.totalRequests}`,
      '',
      `# HELP app_errors_total Total number of errors`,
      `# TYPE app_errors_total counter`,
      `app_errors_total ${metrics.counters.totalErrors}`,
      '',
      `# HELP app_searches_total Total number of searches`,
      `# TYPE app_searches_total counter`,
      `app_searches_total ${metrics.counters.totalSearches}`,
      '',
      `# HELP app_memory_heap_used_bytes Memory heap used in bytes`,
      `# TYPE app_memory_heap_used_bytes gauge`,
      `app_memory_heap_used_bytes ${metrics.process.memory.heapUsed}`,
      '',
      `# HELP app_memory_heap_total_bytes Memory heap total in bytes`,
      `# TYPE app_memory_heap_total_bytes gauge`,
      `app_memory_heap_total_bytes ${metrics.process.memory.heapTotal}`,
      '',
      `# HELP system_load_average System load average`,
      `# TYPE system_load_average gauge`,
      `system_load_average{period="1m"} ${metrics.system.loadAverage[0]}`,
      `system_load_average{period="5m"} ${metrics.system.loadAverage[1]}`,
      `system_load_average{period="15m"} ${metrics.system.loadAverage[2]}`,
      '',
      `# HELP database_connections_active Active database connections`,
      `# TYPE database_connections_active gauge`,
      `database_connections_active ${metrics.database.activeConnections}`,
      '',
      `# HELP database_status Database status (1=up, 0=down)`,
      `# TYPE database_status gauge`,
      `database_status ${metrics.database.status === 'up' ? 1 : 0}`,
      ''
    ].join('\n');

    return prometheusMetrics;
  }

  private async getDatabaseMetrics() {
    try {
      const pool = new Pool({
        connectionString: this.configService.get<string>('DATABASE_URL'),
        ssl: process.env.NODE_ENV === 'production' ? {
          rejectUnauthorized: true,
          ca: this.configService.get<string>('DB_CA_CERT'),
          cert: this.configService.get<string>('DB_CLIENT_CERT'),
          key: this.configService.get<string>('DB_CLIENT_KEY')
        } : false,
      });

      const client = await pool.connect();
      
      // Obtener estadísticas de conexión
      const connectionStats = await client.query(`
        SELECT 
          state,
          COUNT(*) as count
        FROM pg_stat_activity 
        WHERE datname = current_database()
        GROUP BY state
      `);

      // Obtener información de la base de datos
      const dbInfo = await client.query(`
        SELECT 
          pg_database_size(current_database()) as database_size,
          (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as total_connections
      `);

      client.release();
      await pool.end();

      const connectionsByState = {};
      connectionStats.rows.forEach(row => {
        connectionsByState[row.state || 'unknown'] = parseInt(row.count);
      });

      return {
        status: 'up',
        totalConnections: parseInt(dbInfo.rows[0].total_connections),
        activeConnections: connectionsByState['active'] || 0,
        idleConnections: connectionsByState['idle'] || 0,
        databaseSize: parseInt(dbInfo.rows[0].database_size),
        connectionsByState
      };

    } catch (error) {
      this.logger.error(`Error getting database metrics: ${error.message}`);
      return {
        status: 'down',
        error: error.message,
        activeConnections: 0,
        totalConnections: 0,
        databaseSize: 0
      };
    }
  }
}