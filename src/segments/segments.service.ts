import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class SegmentsService {
  private readonly logger = new Logger(SegmentsService.name);
  private readonly tableName = 'marcas';

  constructor(private readonly pool: Pool) {}

  async findAll() {
    try {
      const result = await this.pool.query(
        `SELECT DISTINCT marca, segment 
         FROM ${this.tableName} 
         WHERE segment IS NOT NULL 
         ORDER BY marca`
      );
      return result.rows;
    } catch (error) {
      this.logger.error(`Error al obtener segmentos: ${error.message}`);
      throw error;
    }
  }

  async findByMarca(marca: string) {
    try {
      const result = await this.pool.query(
        `SELECT marca, segment 
         FROM ${this.tableName} 
         WHERE UPPER(TRIM(marca)) = UPPER(TRIM($1))`,
        [marca]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error(`Error al buscar segmento por marca: ${error.message}`);
      throw error;
    }
  }

  async create(marca: string, segment: 'premium' | 'standard' | 'economy') {
    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.tableName} (marca, segment) 
         VALUES ($1, $2) 
         ON CONFLICT (marca) 
         DO UPDATE SET segment = $2 
         RETURNING marca, segment`,
        [marca, segment]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error(`Error al crear/actualizar segmento: ${error.message}`);
      throw error;
    }
  }

  async update(marca: string, segment: 'premium' | 'standard' | 'economy') {
    try {
      const result = await this.pool.query(
        `UPDATE ${this.tableName} 
         SET segment = $2 
         WHERE UPPER(TRIM(marca)) = UPPER(TRIM($1)) 
         RETURNING marca, segment`,
        [marca, segment]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error(`Error al actualizar segmento: ${error.message}`);
      throw error;
    }
  }

  async delete(marca: string) {
    try {
      const result = await this.pool.query(
        `UPDATE ${this.tableName} 
         SET segment = NULL 
         WHERE UPPER(TRIM(marca)) = UPPER(TRIM($1)) 
         RETURNING marca, segment`,
        [marca]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error(`Error al eliminar segmento: ${error.message}`);
      throw error;
    }
  }
} 