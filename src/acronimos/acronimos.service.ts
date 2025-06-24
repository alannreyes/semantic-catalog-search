import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class AcronimosService {
  private readonly logger = new Logger(AcronimosService.name);

  constructor(private readonly pool: Pool) {}

  async findAll() {
    try {
      const result = await this.pool.query(
        'SELECT id, acronimo, descripcion, activo, created_at, updated_at FROM acronimos ORDER BY acronimo'
      );
      return result.rows;
    } catch (error) {
      this.logger.error(`Error al obtener acrónimos: ${error.message}`);
      throw error;
    }
  }

  async findAllActive() {
    try {
      const result = await this.pool.query(
        'SELECT acronimo, descripcion FROM acronimos WHERE activo = true ORDER BY acronimo'
      );
      return result.rows;
    } catch (error) {
      this.logger.error(`Error al obtener acrónimos activos: ${error.message}`);
      throw error;
    }
  }

  async findById(id: number) {
    try {
      const result = await this.pool.query(
        'SELECT id, acronimo, descripcion, activo, created_at, updated_at FROM acronimos WHERE id = $1',
        [id]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error(`Error al buscar acrónimo por ID: ${error.message}`);
      throw error;
    }
  }

  async create(acronimo: string, descripcion: string) {
    try {
      const result = await this.pool.query(
        `INSERT INTO acronimos (acronimo, descripcion) 
         VALUES ($1, $2) 
         RETURNING id, acronimo, descripcion, activo, created_at, updated_at`,
        [acronimo.toUpperCase(), descripcion]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error(`El acrónimo '${acronimo}' ya existe`);
      }
      this.logger.error(`Error al crear acrónimo: ${error.message}`);
      throw error;
    }
  }

  async update(id: number, acronimo: string, descripcion: string, activo: boolean = true) {
    try {
      const result = await this.pool.query(
        `UPDATE acronimos 
         SET acronimo = $2, descripcion = $3, activo = $4 
         WHERE id = $1 
         RETURNING id, acronimo, descripcion, activo, created_at, updated_at`,
        [id, acronimo.toUpperCase(), descripcion, activo]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error(`El acrónimo '${acronimo}' ya existe`);
      }
      this.logger.error(`Error al actualizar acrónimo: ${error.message}`);
      throw error;
    }
  }

  async delete(id: number) {
    try {
      const result = await this.pool.query(
        'DELETE FROM acronimos WHERE id = $1 RETURNING id, acronimo',
        [id]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error(`Error al eliminar acrónimo: ${error.message}`);
      throw error;
    }
  }

  // Método para traducir texto usando los acrónimos activos
  async translateText(text: string): Promise<string> {
    try {
      const acronimos = await this.findAllActive();
      let translatedText = text;

      for (const { acronimo, descripcion } of acronimos) {
        // Reemplazar acrónimo manteniendo mayúsculas/minúsculas del contexto
        const regex = new RegExp(`\\b${acronimo}\\b`, 'gi');
        translatedText = translatedText.replace(regex, descripcion);
      }

      return translatedText;
    } catch (error) {
      this.logger.error(`Error al traducir texto: ${error.message}`);
      return text; // Retorna texto original en caso de error
    }
  }
} 