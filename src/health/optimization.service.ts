import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PgVectorOptimizer } from '../common/utils/pgvector-optimizer';

@Injectable()
export class OptimizationService {
  private readonly logger = new Logger(OptimizationService.name);

  constructor(private readonly configService: ConfigService) {}

  async analyzePgVectorConfig(tableName?: string) {
    const table = tableName || this.configService.get<string>('PRODUCT_TABLE') || 'productos_1024';
    const currentProbes = parseInt(this.configService.get<string>('PGVECTOR_PROBES') || '1');
    
    const pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: this.configService.get<string>('DB_CA_CERT'),
        cert: this.configService.get<string>('DB_CLIENT_CERT'),
        key: this.configService.get<string>('DB_CLIENT_KEY')
      } : false,
    });

    try {
      const analysis = await PgVectorOptimizer.analyzeAndOptimize(pool, table, currentProbes);
      
      // Añadir contexto adicional
      return {
        ...analysis,
        environment: process.env.NODE_ENV || 'development',
        analysisTime: new Date().toISOString(),
        recommendations: {
          ...analysis.recommendations,
          summary: this.generateRecommendationSummary(analysis.recommendations),
          priority: this.calculatePriority(analysis.currentConfig, analysis.recommendations)
        }
      };

    } finally {
      await pool.end();
    }
  }

  async applyPgVectorOptimizations(
    tableName?: string, 
    options: { dryRun?: boolean; force?: boolean } = {}
  ) {
    const { dryRun = true, force = false } = options;
    const table = tableName || this.configService.get<string>('PRODUCT_TABLE') || 'productos_1024';
    
    if (!dryRun && !force) {
      throw new Error('Para aplicar cambios reales, debe especificar force: true');
    }

    const pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: this.configService.get<string>('DB_CA_CERT'),
        cert: this.configService.get<string>('DB_CLIENT_CERT'),
        key: this.configService.get<string>('DB_CLIENT_KEY')
      } : false,
    });

    try {
      const currentProbes = parseInt(this.configService.get<string>('PGVECTOR_PROBES') || '1');
      const analysis = await PgVectorOptimizer.analyzeAndOptimize(pool, table, currentProbes);
      
      const result = await PgVectorOptimizer.applyOptimizations(
        pool, 
        analysis.queries, 
        { dryRun, timeout: 600000 } // 10 minutos timeout
      );

      return {
        operation: dryRun ? 'dry_run' : 'apply',
        tableName: table,
        timestamp: new Date().toISOString(),
        ...result,
        analysis: analysis.recommendations
      };

    } finally {
      await pool.end();
    }
  }

  async getDatabaseStats() {
    const pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: this.configService.get<string>('DB_CA_CERT'),
        cert: this.configService.get<string>('DB_CLIENT_CERT'),
        key: this.configService.get<string>('DB_CLIENT_KEY')
      } : false,
    });

    try {
      const client = await pool.connect();
      
      // Estadísticas generales de la base de datos
      const dbStats = await client.query(`
        SELECT 
          pg_database.datname,
          pg_size_pretty(pg_database_size(pg_database.datname)) as size,
          numbackends as connections,
          xact_commit as commits,
          xact_rollback as rollbacks,
          blks_read,
          blks_hit,
          temp_files,
          temp_bytes
        FROM pg_database 
        JOIN pg_stat_database ON pg_database.datname = pg_stat_database.datname
        WHERE pg_database.datname = current_database()
      `);

      // Top tablas por tamaño
      const tableStats = await client.query(`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_stat_user_tables.n_live_tup as rows,
          pg_stat_user_tables.n_dead_tup as dead_rows
        FROM pg_tables 
        LEFT JOIN pg_stat_user_tables ON pg_tables.tablename = pg_stat_user_tables.relname
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 10
      `);

      // Índices más grandes
      const indexStats = await client.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as size
        FROM pg_indexes 
        WHERE schemaname = 'public'
        ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC
        LIMIT 10
      `);

      client.release();

      return {
        database: dbStats.rows[0] || {},
        tables: tableStats.rows,
        indexes: indexStats.rows,
        analysis: {
          cacheHitRatio: this.calculateCacheHitRatio(dbStats.rows[0]),
          recommendations: this.generateDbRecommendations(dbStats.rows[0], tableStats.rows)
        },
        timestamp: new Date().toISOString()
      };

    } finally {
      await pool.end();
    }
  }

  async runDatabaseMaintenance(
    tasks: string[], 
    options: { dryRun?: boolean } = {}
  ) {
    const { dryRun = true } = options;
    const table = this.configService.get<string>('PRODUCT_TABLE') || 'productos_1024';

    const pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: this.configService.get<string>('DB_CA_CERT'),
        cert: this.configService.get<string>('DB_CLIENT_CERT'),
        key: this.configService.get<string>('DB_CLIENT_KEY')
      } : false,
    });

    try {
      const queries: string[] = [];
      
      if (tasks.includes('analyze')) {
        queries.push(`ANALYZE ${table};`);
      }
      
      if (tasks.includes('vacuum')) {
        queries.push(`VACUUM ANALYZE ${table};`);
      }
      
      if (tasks.includes('reindex')) {
        queries.push(`REINDEX TABLE ${table};`);
      }

      if (queries.length === 0) {
        return { error: 'No maintenance tasks specified' };
      }

      const result = await PgVectorOptimizer.applyOptimizations(
        pool, 
        queries, 
        { dryRun, timeout: 1800000 } // 30 minutos timeout para mantenimiento
      );

      return {
        operation: dryRun ? 'dry_run' : 'maintenance',
        tasks,
        tableName: table,
        timestamp: new Date().toISOString(),
        ...result
      };

    } finally {
      await pool.end();
    }
  }

  private generateRecommendationSummary(recommendations: any): string[] {
    const summary: string[] = [];

    if (recommendations.probes.impact === 'increase_for_accuracy') {
      summary.push(`Incrementar probes de ${recommendations.probes.current} a ${recommendations.probes.recommended} para mejor precisión`);
    } else if (recommendations.probes.impact === 'decrease_for_speed') {
      summary.push(`Reducir probes de ${recommendations.probes.current} a ${recommendations.probes.recommended} para mejor velocidad`);
    }

    if (recommendations.lists.needsReindex) {
      summary.push(`Reindexar con ${recommendations.lists.recommended} listas para dataset actual`);
    }

    if (recommendations.maintenance.needsVacuum) {
      summary.push('Ejecutar VACUUM para limpiar datos obsoletos');
    }

    if (recommendations.maintenance.needsAnalyze) {
      summary.push('Ejecutar ANALYZE para actualizar estadísticas del planificador');
    }

    return summary;
  }

  private calculatePriority(currentConfig: any, recommendations: any): 'low' | 'medium' | 'high' {
    let score = 0;

    // Incrementar score basado en problemas encontrados
    if (recommendations.maintenance.needsVacuum) score += 2;
    if (recommendations.maintenance.needsAnalyze) score += 1;
    if (recommendations.maintenance.needsReindex) score += 3;
    if (recommendations.probes.impact !== 'optimal') score += 1;

    // Considerar tamaño del dataset
    if (currentConfig.totalRows > 100000) score += 1;

    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  private calculateCacheHitRatio(dbStats: any): number {
    if (!dbStats.blks_hit || !dbStats.blks_read) return 0;
    const total = parseInt(dbStats.blks_hit) + parseInt(dbStats.blks_read);
    return total > 0 ? (parseInt(dbStats.blks_hit) / total) * 100 : 0;
  }

  private generateDbRecommendations(dbStats: any, tableStats: any[]): string[] {
    const recommendations: string[] = [];

    const cacheHitRatio = this.calculateCacheHitRatio(dbStats);
    if (cacheHitRatio < 95) {
      recommendations.push('Cache hit ratio bajo - considerar aumentar shared_buffers');
    }

    const largeDeadTuples = tableStats.filter(table => 
      parseInt(table.dead_rows || '0') > parseInt(table.rows || '0') * 0.1
    );

    if (largeDeadTuples.length > 0) {
      recommendations.push(`Tablas con muchas tuplas muertas: ${largeDeadTuples.map(t => t.tablename).join(', ')}`);
    }

    return recommendations;
  }
}