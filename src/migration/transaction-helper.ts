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

    this.logger.log(`Insertando ${records.length} registros en ${tableName} usando pgvector best practices`);
    
    let insertedCount = 0;
    const errors: string[] = [];
    
    // Simplified approach - individual inserts with proper error handling
    for (const record of records) {
      try {
        // Simple INSERT following pgvector best practices
        const query = `
          INSERT INTO ${tableName} (
            codigo,
            descripcion,
            marca,
            codigo_fabrica,
            categoria,
            articulo_stock,
            lista_costos,
            embedding
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (codigo) DO UPDATE SET
            descripcion = EXCLUDED.descripcion,
            marca = EXCLUDED.marca,
            codigo_fabrica = EXCLUDED.codigo_fabrica,
            categoria = EXCLUDED.categoria,
            articulo_stock = EXCLUDED.articulo_stock,
            lista_costos = EXCLUDED.lista_costos,
            embedding = EXCLUDED.embedding
        `;

        const values = [
          record[fieldMapping.codigo] || null,
          record[fieldMapping.descripcion] || null,
          record[fieldMapping.marca] || null,
          record[fieldMapping.codigo_fabrica] || null,
          record[fieldMapping.categoria] || null,
          record[fieldMapping.articulo_stock] === '1' || record[fieldMapping.articulo_stock] === true,
          record[fieldMapping.lista_costos] === '1' || record[fieldMapping.lista_costos] === true,
          record._embedding ? `[${record._embedding.join(',')}]` : null
        ];

        await pool.query(query, values);
        insertedCount++;

      } catch (recordError) {
        const codigo = record[fieldMapping.codigo] || 'unknown';
        const errorMsg = `${codigo}: ${recordError.message}`;
        this.logger.error(`🔥 pgvector insert error: ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    const successRate = insertedCount / records.length;
    this.logger.log(`✅ Batch completed: ${insertedCount}/${records.length} successful (${Math.round(successRate * 100)}%)`);

    if (successRate < 0.7) {
      throw new Error(`❌ Batch falló: solo ${Math.round(successRate * 100)}% exitoso`);
    }

    return { insertedCount, errors };
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