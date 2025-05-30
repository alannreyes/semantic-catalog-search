import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SearchService {
  private pool: Pool;

  constructor(private configService: ConfigService) {
    // Usar directamente DATABASE_URL en lugar de variables individuales
    const databaseUrl = this.configService.get('DATABASE_URL');
    this.pool = new Pool({
      connectionString: databaseUrl
    });
  }

  // Extraer código interno de metadata o texto
  private extractCodigoInterno(product: any): string {
    // Primero intentar extraer de metadata.codigo si existe
    if (product.metadata && product.metadata.codigo) {
      return product.metadata.codigo;
    }
    
    // Si no está en metadata, intentar extraerlo del texto
    if (product.text) {
      // Buscar patrones de código como TP998638 o 04010967
      const tpMatch = product.text.match(/(?:TP|tp|Tp)([0-9]+)/i);
      const numericMatch = product.text.match(/(?<!\w)0\d{6,7}(?!\w)/); // Coincide con números que empiezan con 0 y tienen 7-8 dígitos
      
      if (tpMatch && tpMatch[0]) {
        return tpMatch[0];
      } else if (numericMatch && numericMatch[0]) {
        return numericMatch[0];
      }
    }
    
    // Si no se encuentra en texto, verificar si hay un "id" en metadata que podría ser el código
    if (product.metadata && product.metadata.id) {
      return product.metadata.id;
    }
    
    return '[empty]';  // Valor por defecto si no se encuentra el código
  }

  async searchProducts(query: string, limit: number = 5): Promise<any[]> {
    try {
      // Búsqueda usando pg_trgm con el campo text
      const searchQuery = `
        SELECT 
          id,
          text,
          metadata,
          similarity(text, $1) AS similarity_score
        FROM 
          productos
        WHERE 
          text % $1
        ORDER BY 
          similarity(text, $1) DESC
        LIMIT $2;
      `;

      const result = await this.pool.query(searchQuery, [query, limit]);
      
      // Formatear los resultados para la salida incluyendo código interno
      const formattedResults = result.rows.map(product => {
        const similarityPercentage = Math.round(product.similarity_score * 100);
        
        // Extraer el código interno
        const codigoInterno = this.extractCodigoInterno(product);

        return {
          id: product.id,
          articulo_buscado: query,
          articulo_encontrado: product.text,
          codigo_interno: codigoInterno,
          distancia_coseno: `${similarityPercentage}%`,
          metadata: product.metadata
        };
      });

      return formattedResults;
    } catch (error) {
      console.error('Error en searchProducts:', error.message);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }

  // Método que usa pgvector para búsqueda vectorial con distancia de coseno
  async searchProductsWithVector(query: string, limit: number = 5): Promise<any[]> {
    try {
      // Búsqueda vectorial con distancia de coseno (<=>)
      const searchQuery = `
        WITH query_embedding AS (
          SELECT openai_embedding($1) AS embedding
        )
        SELECT 
          id,
          text,
          metadata,
          1 - (embedding <=> q.embedding) AS cosine_similarity,
          embedding <=> q.embedding AS cosine_distance
        FROM 
          productos p, 
          query_embedding q
        ORDER BY 
          cosine_distance ASC
        LIMIT $2;
      `;

      const result = await this.pool.query(searchQuery, [query, limit]);
      
      const formattedResults = result.rows.map(product => {
        // Convertir la distancia coseno a un porcentaje de similitud (0-100%)
        const similarityPercentage = Math.round(product.cosine_similarity * 100);
        
        // Extraer el código interno
        const codigoInterno = this.extractCodigoInterno(product);

        return {
          id: product.id,
          articulo_buscado: query,
          articulo_encontrado: product.text,
          codigo_interno: codigoInterno,
          distancia_coseno: `${similarityPercentage}%`,
          metadata: product.metadata
        };
      });

      return formattedResults;
    } catch (error) {
      console.error('Error en searchProductsWithVector:', error.message);
      throw new Error(`Error performing vector search: ${error.message}`);
    }
  }

  // Método seguro que intenta diferentes métodos de búsqueda
  async safeSearch(query: string, limit: number = 5): Promise<any[]> {
    try {
      // Primero intenta con búsqueda vectorial para mejores resultados semánticos
      return await this.searchProductsWithVector(query, limit);
    } catch (error) {
      console.log('Vector search failed, trying trigram search:', error.message);
      
      try {
        // Si falla, intenta con búsqueda de trigram
        return await this.searchProducts(query, limit);
      } catch (secondError) {
        console.error('All search methods failed:', secondError.message);
        throw new Error(`Error performing semantic search: ${secondError.message}`);
      }
    }
  }
}