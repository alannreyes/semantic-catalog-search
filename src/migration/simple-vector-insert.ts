// Simplified vector insertion following pgvector best practices
import { Pool } from 'pg';
import { Logger } from '@nestjs/common';

export class SimpleVectorInsert {
  private static readonly logger = new Logger(SimpleVectorInsert.name);

  /**
   * Insert records with vectors using pgvector best practices
   * - Simple INSERT statements
   * - Proper vector format
   * - No unnecessary complexity
   */
  static async insertRecords(
    pool: Pool,
    tableName: string,
    records: any[]
  ): Promise<{ success: number; errors: string[] }> {
    
    let success = 0;
    const errors: string[] = [];

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
          record.codigo || null,
          record.descripcion || null,
          record.marca || null,
          record.codigo_fabrica || null,
          record.categoria || null,
          record.articulo_stock === '1' || record.articulo_stock === true,
          record.lista_costos === '1' || record.lista_costos === true,
          record._embedding ? `[${record._embedding.join(',')}]` : null
        ];

        await pool.query(query, values);
        success++;

        this.logger.debug(`✅ Inserted: ${record.codigo}`);

      } catch (error) {
        const errorMsg = `${record.codigo}: ${error.message}`;
        this.logger.error(`❌ Insert failed: ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    this.logger.log(`Batch result: ${success}/${records.length} successful`);
    return { success, errors };
  }

  /**
   * Test insert a single record to validate setup
   */
  static async testInsert(pool: Pool, tableName: string): Promise<boolean> {
    try {
      const testRecord = {
        codigo: 'TEST_PGVECTOR',
        descripcion: 'Test record for pgvector validation',
        marca: 'TEST',
        codigo_fabrica: 'TEST001',
        categoria: '99',
        articulo_stock: false,
        lista_costos: false,
        _embedding: Array(1024).fill(0.1) // Simple test embedding
      };

      const result = await this.insertRecords(pool, tableName, [testRecord]);
      
      if (result.success === 1) {
        this.logger.log('✅ pgvector test insert successful');
        return true;
      } else {
        this.logger.error('❌ pgvector test insert failed');
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ pgvector test failed: ${error.message}`);
      return false;
    }
  }
}