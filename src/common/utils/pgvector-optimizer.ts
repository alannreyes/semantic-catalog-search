import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

export class PgVectorOptimizer {
  private static readonly logger = new Logger(PgVectorOptimizer.name);

  /**
   * Calcula el número óptimo de probes basado en el tamaño del dataset
   * @param datasetSize Número total de vectores en la tabla
   * @returns Número óptimo de probes
   */
  static calculateOptimalProbes(datasetSize: number): number {
    if (datasetSize < 1000) return 1;
    if (datasetSize < 10000) return Math.max(Math.floor(datasetSize / 1000), 3);
    if (datasetSize < 100000) return Math.max(Math.floor(datasetSize / 5000), 10);
    
    // Para datasets grandes, usar una fórmula logarítmica
    return Math.min(Math.max(Math.floor(Math.log10(datasetSize) * 5), 15), 50);
  }

  /**
   * Calcula el número óptimo de listas para el índice IVFFlat
   * @param datasetSize Número total de vectores en la tabla
   * @returns Número óptimo de listas
   */
  static calculateOptimalLists(datasetSize: number): number {
    if (datasetSize < 1000) return 10;
    if (datasetSize < 10000) return Math.max(Math.floor(Math.sqrt(datasetSize)), 20);
    
    // Regla general: sqrt(dataset_size) pero con límites prácticos
    const optimalLists = Math.floor(Math.sqrt(datasetSize));
    return Math.min(Math.max(optimalLists, 50), 1000);
  }

  /**
   * Obtiene estadísticas de la tabla de vectores
   */
  static async getTableStats(pool: Pool, tableName: string): Promise<{
    totalRows: number;
    indexSize: string;
    tableSize: string;
    lastVacuum: Date | null;
    lastAnalyze: Date | null;
  }> {
    const client = await pool.connect();
    
    try {
      // Estadísticas básicas de la tabla
      const statsQuery = `
        SELECT 
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_tuples,
          n_dead_tup as dead_tuples,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables 
        WHERE relname = $1
      `;
      
      const statsResult = await client.query(statsQuery, [tableName]);
      
      // Tamaño de tabla e índices
      const sizeQuery = `
        SELECT 
          pg_size_pretty(pg_total_relation_size($1)) as total_size,
          pg_size_pretty(pg_relation_size($1)) as table_size,
          pg_size_pretty(pg_total_relation_size($1) - pg_relation_size($1)) as index_size
      `;
      
      const sizeResult = await client.query(sizeQuery, [tableName]);
      
      const stats = statsResult.rows[0] || {};
      const sizes = sizeResult.rows[0] || {};
      
      return {
        totalRows: parseInt(stats.live_tuples || '0'),
        indexSize: sizes.index_size || '0 bytes',
        tableSize: sizes.table_size || '0 bytes',
        lastVacuum: stats.last_vacuum || stats.last_autovacuum || null,
        lastAnalyze: stats.last_analyze || stats.last_autoanalyze || null
      };
      
    } finally {
      client.release();
    }
  }

  /**
   * Analiza y optimiza la configuración de pgvector
   */
  static async analyzeAndOptimize(
    pool: Pool, 
    tableName: string,
    currentProbes: number
  ): Promise<{
    currentConfig: any;
    recommendations: any;
    queries: string[];
  }> {
    this.logger.log(`Analizando configuración de pgvector para tabla ${tableName}`);
    
    const stats = await this.getTableStats(pool, tableName);
    const optimalProbes = this.calculateOptimalProbes(stats.totalRows);
    const optimalLists = this.calculateOptimalLists(stats.totalRows);
    
    const recommendations = {
      probes: {
        current: currentProbes,
        recommended: optimalProbes,
        impact: this.getProbesImpact(currentProbes, optimalProbes)
      },
      lists: {
        recommended: optimalLists,
        needsReindex: stats.totalRows > 10000
      },
      maintenance: {
        needsVacuum: !stats.lastVacuum || this.isOlderThan(stats.lastVacuum, 7), // 7 días
        needsAnalyze: !stats.lastAnalyze || this.isOlderThan(stats.lastAnalyze, 1), // 1 día
        needsReindex: stats.totalRows > 50000 && this.isOlderThan(stats.lastVacuum, 30) // 30 días
      }
    };

    const queries = this.generateOptimizationQueries(tableName, recommendations);

    return {
      currentConfig: {
        tableName,
        totalRows: stats.totalRows,
        tableSize: stats.tableSize,
        indexSize: stats.indexSize,
        currentProbes,
        lastMaintenance: {
          vacuum: stats.lastVacuum,
          analyze: stats.lastAnalyze
        }
      },
      recommendations,
      queries
    };
  }

  private static getProbesImpact(current: number, recommended: number): string {
    if (current === recommended) return 'optimal';
    if (current < recommended) return 'increase_for_accuracy';
    return 'decrease_for_speed';
  }

  private static isOlderThan(date: Date, days: number): boolean {
    if (!date) return true;
    const diffTime = Date.now() - date.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return diffDays > days;
  }

  private static generateOptimizationQueries(tableName: string, recommendations: any): string[] {
    const queries: string[] = [];

    // Queries de mantenimiento
    if (recommendations.maintenance.needsAnalyze) {
      queries.push(`ANALYZE ${tableName};`);
    }

    if (recommendations.maintenance.needsVacuum) {
      queries.push(`VACUUM ANALYZE ${tableName};`);
    }

    // Reindexación si es necesario
    if (recommendations.lists.needsReindex) {
      queries.push(`-- Recrear índice con configuración optimizada`);
      queries.push(`DROP INDEX IF EXISTS idx_${tableName}_embedding;`);
      queries.push(`
        CREATE INDEX idx_${tableName}_embedding 
        ON ${tableName} USING ivfflat (embedding vector_cosine_ops) 
        WITH (lists = ${recommendations.lists.recommended});
      `);
    }

    // Configuración de probes (se aplica por sesión)
    queries.push(`-- Configuración recomendada de probes por sesión:`);
    queries.push(`SET ivfflat.probes = ${recommendations.probes.recommended};`);

    return queries;
  }

  /**
   * Aplica las optimizaciones recomendadas
   */
  static async applyOptimizations(
    pool: Pool,
    queries: string[],
    options: { dryRun?: boolean; timeout?: number } = {}
  ): Promise<{ success: boolean; results: string[]; errors: string[] }> {
    const { dryRun = false, timeout = 300000 } = options; // 5 minutos por defecto
    const results: string[] = [];
    const errors: string[] = [];

    if (dryRun) {
      this.logger.log('🔍 DRY RUN - Queries que se ejecutarían:');
      queries.forEach((query, index) => {
        this.logger.log(`${index + 1}. ${query}`);
      });
      return { success: true, results: ['Dry run completed'], errors: [] };
    }

    const client = await pool.connect();
    
    try {
      // Configurar timeout
      await client.query(`SET statement_timeout = ${timeout}`);
      
      for (const query of queries) {
        if (query.startsWith('--')) {
          results.push(`Comentario: ${query}`);
          continue;
        }

        try {
          const startTime = Date.now();
          await client.query(query);
          const duration = Date.now() - startTime;
          
          const result = `✅ Ejecutado en ${duration}ms: ${query.substring(0, 60)}...`;
          results.push(result);
          this.logger.log(result);
          
        } catch (error) {
          const errorMsg = `❌ Error en query: ${error.message}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      return {
        success: errors.length === 0,
        results,
        errors
      };

    } finally {
      client.release();
    }
  }
}