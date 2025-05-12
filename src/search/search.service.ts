import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SearchService {
  private pool: Pool;

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      host: this.configService.get('DB_HOST'),
      port: this.configService.get('DB_PORT'),
      user: this.configService.get('DB_USER'),
      password: this.configService.get('DB_PASSWORD'),
      database: this.configService.get('DB_NAME'),
    });
  }

  async searchProducts(query: string, limit: number = 5): Promise<any[]> {
    try {
      // Usar el operador coseno (<=>) en lugar de la función similarity
      // El operador coseno es más estable y maneja mejor los casos límite
      const searchQuery = `
        SELECT 
          p.id,
          p.name,
          p.description,
          p.reference,
          p.price,
          word_similarity($1, p.name) AS similarity_score
        FROM 
          products p
        WHERE 
          word_similarity($1, p.name) > 0.1
        ORDER BY 
          word_similarity($1, p.name) DESC
        LIMIT $2;
      `;

      const result = await this.pool.query(searchQuery, [query, limit]);
      
      // Formatear los resultados para la salida
      const formattedResults = result.rows.map(product => {
        const similarityPercentage = Math.round(product.similarity_score * 100);
        return {
          id: product.id,
          name: product.name,
          description: product.description,
          reference: product.reference,
          price: product.price,
          similarity: `${similarityPercentage}%`
        };
      });

      return formattedResults;
    } catch (error) {
      // Mejorar el manejo de errores para facilitar la depuración
      console.error('Error in searchProducts:', error.message);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }

  // Función para búsquedas usando vectores si estás usando pgvector
  async searchProductsWithVectors(query: string, limit: number = 5): Promise<any[]> {
    try {
      // Esta consulta usa el operador <=> (coseno) para comparación vectorial
      // que es más estable que otras funciones de similitud
      const searchQuery = `
        WITH query_embedding AS (
          SELECT embedding_function($1) AS embedding
        )
        SELECT 
          p.id,
          p.name,
          p.description,
          p.reference,
          p.price,
          1 - (p.embedding <=> q.embedding) AS similarity_score
        FROM 
          products p, 
          query_embedding q
        ORDER BY 
          p.embedding <=> q.embedding
        LIMIT $2;
      `;

      const result = await this.pool.query(searchQuery, [query, limit]);
      
      // Formatear los resultados para la salida
      // Asegurándonos de que similarity_score está en un rango válido
      const formattedResults = result.rows.map(product => {
        // Asegurar que la puntuación está en el rango [0,1]
        const score = Math.max(0, Math.min(1, product.similarity_score));
        const similarityPercentage = Math.round(score * 100);
        
        return {
          id: product.id,
          name: product.name,
          description: product.description,
          reference: product.reference,
          price: product.price,
          similarity: `${similarityPercentage}%`
        };
      });

      return formattedResults;
    } catch (error) {
      console.error('Error in searchProductsWithVectors:', error.message);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }

  // Método alternativo que usa pg_trgm para búsqueda de texto
  async searchProductsWithTrgm(query: string, limit: number = 5): Promise<any[]> {
    try {
      const searchQuery = `
        SELECT 
          p.id,
          p.name,
          p.description,
          p.reference,
          p.price,
          similarity(p.name, $1) AS similarity_score
        FROM 
          products p
        WHERE 
          p.name % $1
        ORDER BY 
          similarity(p.name, $1) DESC
        LIMIT $2;
      `;

      const result = await this.pool.query(searchQuery, [query, limit]);
      
      const formattedResults = result.rows.map(product => {
        const similarityPercentage = Math.round(product.similarity_score * 100);
        return {
          id: product.id,
          name: product.name,
          description: product.description,
          reference: product.reference,
          price: product.price,
          similarity: `${similarityPercentage}%`
        };
      });

      return formattedResults;
    } catch (error) {
      console.error('Error in searchProductsWithTrgm:', error.message);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }

  // Método seguro para búsqueda que intenta diferentes estrategias
  async safeSearch(query: string, limit: number = 5): Promise<any[]> {
    try {
      // Intenta primero con la búsqueda de trigram
      return await this.searchProductsWithTrgm(query, limit);
    } catch (error) {
      console.log('Trigram search failed, trying alternative method:', error.message);
      
      try {
        // Si falla, intenta con la búsqueda básica
        return await this.searchProducts(query, limit);
      } catch (secondError) {
        console.error('All search methods failed:', secondError.message);
        throw new Error(`Error performing semantic search: ${secondError.message}`);
      }
    }
  }
}