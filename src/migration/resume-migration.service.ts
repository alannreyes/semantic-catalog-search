import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseService } from './database.service';
import { MigrationService } from './migration.service';

@Injectable()
export class ResumeMigrationService {
  private readonly logger = new Logger(ResumeMigrationService.name);

  constructor(
    private readonly pgPool: Pool,
    private readonly databaseService: DatabaseService,
    private readonly migrationService: MigrationService,
  ) {}

  // Verificar cuántos productos ya fueron migrados
  async checkMigrationProgress(tableName: string = 'productos_bip'): Promise<{
    totalMigrated: number;
    lastMigratedCode: string | null;
    hasEmbeddings: number;
    withArticuloStock: number;
    withListaCostos: number;
  }> {
    try {
      this.logger.log(`📊 Verificando progreso de migración en tabla ${tableName}`);

      // Obtener estadísticas generales
      const statsQuery = `
        SELECT 
          COUNT(*) as total_migrated,
          MAX(codigo) as last_code,
          COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as has_embeddings,
          COUNT(CASE WHEN articulo_stock = true THEN 1 END) as with_articulo_stock,
          COUNT(CASE WHEN lista_costos = true THEN 1 END) as with_lista_costos
        FROM ${tableName}
        WHERE codigo NOT LIKE 'TP%'
      `;

      const result = await this.pgPool.query(statsQuery);
      const stats = result.rows[0];

      return {
        totalMigrated: parseInt(stats.total_migrated) || 0,
        lastMigratedCode: stats.last_code,
        hasEmbeddings: parseInt(stats.has_embeddings) || 0,
        withArticuloStock: parseInt(stats.with_articulo_stock) || 0,
        withListaCostos: parseInt(stats.with_lista_costos) || 0,
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando progreso: ${error.message}`);
      throw error;
    }
  }

  // Obtener productos pendientes de migrar
  async getPendingProducts(lastCode: string | null, limit: number = 10000): Promise<{
    pendingCount: number;
    nextBatch: any[];
  }> {
    try {
      const connection = await this.databaseService.connectToMsSQL();
      
      // Construir WHERE clause con punto de reanudación
      let whereClause = `ART_CODFAM <= '47' AND ART_ESTREG = 'A' AND ART_CODART NOT LIKE 'TP%'`;
      if (lastCode) {
        whereClause += ` AND ART_CODART > '${lastCode}'`;
      }

      // Contar productos pendientes
      const countQuery = `
        SELECT COUNT(*) as pending 
        FROM Ar0000 
        WHERE ${whereClause}
      `;
      
      const countResult = await connection.request().query(countQuery);
      const pendingCount = countResult.recordset[0].pending;

      // Obtener siguiente lote
      const batchQuery = `
        SELECT TOP ${limit}
          ART_CODART as codigo,
          ART_DESCRI as descripcion,
          ART_DESABR as marca,
          ART_CODEAN as codigo_fabrica,
          ART_CODFAM as categoria,
          CASE WHEN ART_ESTREG = 'A' THEN 1 ELSE 0 END as articulo_stock,
          CASE WHEN EXISTS (
            SELECT 1 FROM Ar0001 
            WHERE LIS_CODART = ART_CODART 
            AND LIS_CODALM = '02'
          ) THEN 1 ELSE 0 END as lista_costos
        FROM Ar0000
        WHERE ${whereClause}
        ORDER BY ART_CODART
      `;

      const batchResult = await connection.request().query(batchQuery);

      return {
        pendingCount,
        nextBatch: batchResult.recordset,
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo productos pendientes: ${error.message}`);
      throw error;
    }
  }

  // Reanudar migración desde el último punto
  async resumeMigration(jobId?: string): Promise<{
    jobId: string;
    resumedFrom: string | null;
    totalPending: number;
  }> {
    try {
      this.logger.log('🔄 Iniciando reanudación de migración');

      // 1. Verificar progreso actual
      const progress = await this.checkMigrationProgress();
      this.logger.log(`📊 Productos ya migrados: ${progress.totalMigrated}`);
      this.logger.log(`📊 Último código migrado: ${progress.lastMigratedCode || 'NINGUNO'}`);

      // 2. Obtener productos pendientes
      const pending = await this.getPendingProducts(progress.lastMigratedCode, 1);
      this.logger.log(`📊 Productos pendientes: ${pending.pendingCount}`);

      if (pending.pendingCount === 0) {
        this.logger.log('✅ No hay productos pendientes para migrar');
        return {
          jobId: jobId || 'NO_PENDING',
          resumedFrom: progress.lastMigratedCode,
          totalPending: 0,
        };
      }

      // 3. Crear o buscar job de migración
      let migrationJobId = jobId;
      
      if (!migrationJobId) {
        // Buscar job existente en estado incompleto
        const existingJobQuery = `
          SELECT id 
          FROM migration_jobs 
          WHERE status IN ('running', 'paused', 'pending')
          ORDER BY created_at DESC
          LIMIT 1
        `;
        const existingJob = await this.pgPool.query(existingJobQuery);
        
        if (existingJob.rows.length > 0) {
          migrationJobId = existingJob.rows[0].id;
          this.logger.log(`📋 Reanudando job existente: ${migrationJobId}`);
        } else {
          // Crear nuevo job con configuración para reanudar
          const config = {
            source: {
              type: 'mssql',
              connection: {
                host: process.env.MSSQL_HOST,
                port: parseInt(process.env.MSSQL_PORT || '1433'),
                database: process.env.MSSQL_DATABASE,
                user: process.env.MSSQL_USER,
                password: process.env.MSSQL_PASSWORD,
              },
              table: 'Ar0000',
              fields: {
                codigo: 'ART_CODART',
                descripcion: 'ART_DESCRI',
                marca: 'ART_DESABR',
                codigo_fabrica: 'ART_CODEAN',
                categoria: 'ART_CODFAM',
                articulo_stock: 'articulo_stock',
                lista_costos: 'lista_costos',
              },
              where_clause: `ART_CODFAM <= '47' AND ART_ESTREG = 'A' AND ART_CODART NOT LIKE 'TP%'${
                progress.lastMigratedCode ? ` AND ART_CODART > '${progress.lastMigratedCode}'` : ''
              }`,
            },
            destination: {
              table: 'productos_bip',
              clean_before: false, // IMPORTANTE: No limpiar para reanudar
              create_indexes: false, // Ya deben existir
            },
            processing: {
              batch_size: 100,
              embedding_batch_size: 50,
              max_concurrent_embeddings: 3,
              delay_between_batches_ms: 1000,
              retry_attempts: 3,
              text_cleaning: {
                enabled: true,
              },
            },
          };

          const newJob = await this.migrationService.createMigrationJob(config);
          migrationJobId = newJob.id;
          this.logger.log(`📋 Creado nuevo job de reanudación: ${migrationJobId}`);
        }
      }

      // 4. Actualizar progreso del job
      await this.pgPool.query(
        `UPDATE migration_jobs 
         SET progress = jsonb_set(
           progress, 
           '{resumed_from}', 
           $1::jsonb
         )
         WHERE id = $2`,
        [JSON.stringify(progress.lastMigratedCode || 'START'), migrationJobId]
      );

      // 5. Iniciar el job
      await this.migrationService.startMigration(migrationJobId);

      return {
        jobId: migrationJobId,
        resumedFrom: progress.lastMigratedCode,
        totalPending: pending.pendingCount,
      };

    } catch (error) {
      this.logger.error(`❌ Error reanudando migración: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Método auxiliar para verificar integridad de datos migrados
  async verifyMigrationIntegrity(sampleSize: number = 100): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    try {
      const issues: string[] = [];

      // Verificar productos sin embeddings
      const noEmbeddingQuery = `
        SELECT COUNT(*) as count 
        FROM productos_bip 
        WHERE embedding IS NULL 
        AND codigo NOT LIKE 'TP%'
      `;
      const noEmbedding = await this.pgPool.query(noEmbeddingQuery);
      if (noEmbedding.rows[0].count > 0) {
        issues.push(`${noEmbedding.rows[0].count} productos sin embeddings`);
      }

      // Verificar dimensiones de embeddings
      const wrongDimensionsQuery = `
        SELECT codigo, array_length(embedding::real[], 1) as dim
        FROM productos_bip
        WHERE embedding IS NOT NULL
        AND array_length(embedding::real[], 1) != 1024
        LIMIT 10
      `;
      const wrongDimensions = await this.pgPool.query(wrongDimensionsQuery);
      if (wrongDimensions.rows.length > 0) {
        issues.push(`Productos con dimensiones incorrectas de embedding`);
      }

      // Verificar productos duplicados
      const duplicatesQuery = `
        SELECT codigo, COUNT(*) as count
        FROM productos_bip
        GROUP BY codigo
        HAVING COUNT(*) > 1
      `;
      const duplicates = await this.pgPool.query(duplicatesQuery);
      if (duplicates.rows.length > 0) {
        issues.push(`${duplicates.rows.length} códigos duplicados`);
      }

      return {
        valid: issues.length === 0,
        issues,
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando integridad: ${error.message}`);
      return {
        valid: false,
        issues: [`Error de verificación: ${error.message}`],
      };
    }
  }
}