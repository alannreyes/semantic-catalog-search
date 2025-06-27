import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { DatabaseService } from '../migration/database.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly pool: Pool,
    private readonly databaseService: DatabaseService,
  ) {}

  @Cron('0 0 * * *', {
    name: 'sync-commercial-flags',
    timeZone: 'America/Lima', // Zona horaria de Perú
  })
  async syncCommercialFlags() {
    const startTime = Date.now();
    this.logger.log('🔄 Iniciando sincronización diaria de flags comerciales');

    try {
      // Conectar a MSSQL para obtener flags actualizados
      const connection = await this.databaseService.connectToMsSQL();
      
      const query = `
        SELECT 
          ART_CODART as codigo,
          CASE WHEN ART_ESTREG = 'A' THEN 1 ELSE 0 END as articulo_stock,
          CASE WHEN EXISTS (
            SELECT 1 FROM Ar0001 
            WHERE LIS_CODART = ART_CODART 
            AND LIS_CODALM = '02'
          ) THEN 1 ELSE 0 END as lista_costos
        FROM Ar0000 
        WHERE ART_CODFAM <= '47' 
        AND ART_CODART NOT LIKE 'TP%'
      `;

      this.logger.log('📊 Consultando flags actualizados desde MSSQL');
      const result = await connection.request().query(query);
      
      this.logger.log(`📈 Obtenidos ${result.recordset.length} registros para sincronizar`);

      // Actualizar flags en PostgreSQL en lotes
      let updatedCount = 0;
      const batchSize = 500;
      
      for (let i = 0; i < result.recordset.length; i += batchSize) {
        const batch = result.recordset.slice(i, i + batchSize);
        
        for (const record of batch) {
          try {
            const updateQuery = `
              UPDATE productos_bip 
              SET 
                articulo_stock = $1,
                lista_costos = $2
              WHERE codigo = $3
            `;
            
            const updateResult = await this.pool.query(updateQuery, [
              record.articulo_stock === 1,
              record.lista_costos === 1,
              record.codigo
            ]);

            if (updateResult.rowCount > 0) {
              updatedCount++;
            }
          } catch (error) {
            this.logger.warn(`⚠️ Error actualizando ${record.codigo}: ${error.message}`);
          }
        }

        this.logger.debug(`📊 Procesado lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(result.recordset.length / batchSize)}`);
      }

      await this.databaseService.closeMsSQLConnection();

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Sincronización completada: ${updatedCount} productos actualizados en ${duration}ms`);

      // Registrar estadísticas de la sincronización
      await this.recordSyncStats(updatedCount, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Error en sincronización diaria: ${error.message}`, error.stack);
      await this.recordSyncStats(0, duration, error.message);
      throw error;
    }
  }

  private async recordSyncStats(updatedCount: number, duration: number, error?: string) {
    try {
      const insertQuery = `
        INSERT INTO sync_jobs (
          sync_type,
          updated_count,
          duration_ms,
          status,
          error_message,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;

      await this.pool.query(insertQuery, [
        'commercial_flags',
        updatedCount,
        duration,
        error ? 'failed' : 'completed',
        error || null,
        new Date()
      ]);
    } catch (statsError) {
      this.logger.error(`❌ Error registrando estadísticas de sync: ${statsError.message}`);
    }
  }

  // Método manual para ejecutar sync bajo demanda
  async runManualSync(): Promise<{ updatedCount: number; duration: number }> {
    this.logger.log('🔧 Ejecutando sincronización manual de flags comerciales');
    
    const startTime = Date.now();
    let updatedCount = 0;

    try {
      const connection = await this.databaseService.connectToMsSQL();
      
      const query = `
        SELECT 
          ART_CODART as codigo,
          CASE WHEN ART_ESTREG = 'A' THEN 1 ELSE 0 END as articulo_stock,
          CASE WHEN EXISTS (
            SELECT 1 FROM Ar0001 
            WHERE LIS_CODART = ART_CODART 
            AND LIS_CODALM = '02'
          ) THEN 1 ELSE 0 END as lista_costos
        FROM Ar0000 
        WHERE ART_CODFAM <= '47' 
        AND ART_CODART NOT LIKE 'TP%'
      `;

      const result = await connection.request().query(query);
      
      for (const record of result.recordset) {
        try {
          const updateQuery = `
            UPDATE productos_bip 
            SET 
              articulo_stock = $1,
              lista_costos = $2
            WHERE codigo = $3
          `;
          
          const updateResult = await this.pool.query(updateQuery, [
            record.articulo_stock === 1,
            record.lista_costos === 1,
            record.codigo
          ]);

          if (updateResult.rowCount > 0) {
            updatedCount++;
          }
        } catch (error) {
          this.logger.warn(`⚠️ Error actualizando ${record.codigo}: ${error.message}`);
        }
      }

      await this.databaseService.closeMsSQLConnection();
      const duration = Date.now() - startTime;

      await this.recordSyncStats(updatedCount, duration);
      
      return { updatedCount, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.recordSyncStats(0, duration, error.message);
      throw error;
    }
  }

  // Obtener estadísticas de sincronizaciones recientes
  async getSyncStats(limit: number = 10) {
    try {
      const query = `
        SELECT 
          sync_type,
          updated_count,
          duration_ms,
          status,
          error_message,
          created_at
        FROM sync_jobs 
        ORDER BY created_at DESC 
        LIMIT $1
      `;

      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas de sync: ${error.message}`);
      return [];
    }
  }
}