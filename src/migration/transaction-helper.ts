import { Pool, PoolClient } from 'pg';
import { Logger } from '@nestjs/common';

export class TransactionHelper {
  private static readonly logger = new Logger(TransactionHelper.name);

  static async insertBatchWithTransaction(
    pool: Pool,
    tableName: string,
    records: any[],
    fieldMapping: Record<string, string>
  ): Promise<{ insertedCount: number; errors: string[] }> {
    if (records.length === 0) return { insertedCount: 0, errors: [] };

    this.logger.log(`Insertando ${records.length} registros en ${tableName} con transacción`);
    
    const client = await pool.connect();
    let insertedCount = 0;
    const errors: string[] = [];
    
    try {
      // Iniciar transacción
      await client.query('BEGIN');
      
      const destinationFields = Object.keys(fieldMapping);
      destinationFields.push('embedding');
      
      const placeholders = destinationFields.map((_, index) => `$${index + 1}`).join(', ');
      const query = `
        INSERT INTO ${tableName} (${destinationFields.join(', ')}) 
        VALUES (${placeholders})
        ON CONFLICT (codigo) DO UPDATE SET
        ${destinationFields.filter(f => f !== 'codigo').map(f => `${f} = EXCLUDED.${f}`).join(', ')}
      `;
      
      for (const record of records) {
        try {
          const values = [];
          
          // Mapear campos según fieldMapping
          for (const [destField, sourceField] of Object.entries(fieldMapping)) {
            let value = record[sourceField];
            
            // Convertir valores según tipo de campo
            if (destField === 'articulo_stock' || destField === 'lista_costos') {
              value = value === '1' || value === true || value === 1;
            }
            
            values.push(value);
          }
          
          // Agregar embedding
          const embedding = record._embedding;
          if (embedding && Array.isArray(embedding)) {
            values.push(`[${embedding.join(',')}]`);
          } else {
            values.push(null);
          }

          await client.query(query, values);
          insertedCount++;
          
        } catch (recordError) {
          const errorMsg = `Error en registro ${record.codigo || record.ART_CODART || 'unknown'}: ${recordError.message}`;
          this.logger.error(`🔥 Error específico: ${errorMsg}`, recordError.stack);
          errors.push(errorMsg);
        }
      }
      
      // Evaluar si confirmar o hacer rollback
      const successRate = insertedCount / records.length;
      
      if (successRate >= 0.7) { // 70% de éxito mínimo
        await client.query('COMMIT');
        this.logger.log(`✅ Transacción confirmada: ${insertedCount}/${records.length} registros (${Math.round(successRate * 100)}% éxito)`);
      } else {
        await client.query('ROLLBACK');
        throw new Error(`❌ Batch falló: solo ${Math.round(successRate * 100)}% exitoso - rollback aplicado`);
      }
      
      return { insertedCount, errors };

    } catch (error) {
      // Rollback automático en caso de error crítico
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(`Error en rollback: ${rollbackError.message}`);
      }
      
      this.logger.error(`💥 Error crítico en inserción batch: ${error.message}`);
      throw error;
    } finally {
      // Siempre liberar la conexión
      client.release();
    }
  }

  static async executeInTransaction<T>(
    pool: Pool,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}