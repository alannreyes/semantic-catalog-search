import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

// Interfaces para tipado de la respuesta de OpenAI
interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAIChoice {
  message: OpenAIMessage;
  index: number;
  finish_reason: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class SearchService {
  private pool: Pool;
  private openaiApiKey: string;

  constructor(private configService: ConfigService) {
    // Usar directamente DATABASE_URL en lugar de variables individuales
    const databaseUrl = this.configService.get('DATABASE_URL');
    this.pool = new Pool({
      connectionString: databaseUrl
    });
    
    // Obtener la clave API de OpenAI de las variables de entorno
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not defined');
}
this.openaiApiKey = apiKey;
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

  // Método para procesar los resultados con GPT-4.1 mini
  async processResultsWithGPT(results: any[], query: string): Promise<string> {
    try {
      // Preparar el texto para enviar a GPT
      let resultadosTexto = `Resultados de búsqueda para: "${query}"\n\n`;
      
      results.forEach((item, index) => {
        resultadosTexto += `${index+1}) ${item.articulo_encontrado} (${item.codigo_interno}) [${item.distancia_coseno}]\n`;
      });
      
      // Configurar la solicitud a la API de OpenAI
      const openaiResponse = await axios.post<OpenAIResponse>(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content: 'Transforma la siguiente información en una lista ordenada por similitud de 5-6 líneas de texto plano. Muestra el producto más parecido en primer lugar, seguido de alternativas. Si el primer producto es muy similar o idéntico, indica "COINCIDENCIA EXACTA" junto a él. No uses formato JSON, markdown ni HTML, solo texto plano con saltos de línea.'
            },
            {
              role: 'user',
              content: resultadosTexto
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Extraer la respuesta del modelo
      const gptResponse = openaiResponse.data.choices[0].message.content;
      return gptResponse;
      
    } catch (error) {
      console.error('Error al procesar con GPT:', error.message);
      
      // Si falla la llamada a GPT, devolvemos los resultados formateados manualmente
      let resultadosTexto = `RESULTADOS PARA: "${query}"\n\n`;
      
      results.forEach((item, index) => {
        resultadosTexto += `${index+1}) ${item.articulo_encontrado} (${item.codigo_interno}) [${item.distancia_coseno}]\n`;
      });
      
      return resultadosTexto;
    }
  }

  // Método para buscar y procesar con GPT en un solo paso
  async searchAndProcess(query: string, limit: number = 5): Promise<string> {
    try {
      // Intentar con búsqueda vectorial primero
      const searchResults = await this.searchProductsWithVector(query, limit);
      
      // Procesar los resultados con GPT
      const processedResults = await this.processResultsWithGPT(searchResults, query);
      
      return processedResults; // Devuelve directamente el texto sin envolver en JSON
      
    } catch (error) {
      console.log('Vector search failed, trying trigram search:', error.message);
      
      try {
        // Si falla, intentar con búsqueda de trigram
        const searchResults = await this.searchProducts(query, limit);
        
        // Procesar los resultados con GPT
        const processedResults = await this.processResultsWithGPT(searchResults, query);
        
        return processedResults; // Devuelve directamente el texto sin envolver en JSON
        
      } catch (secondError) {
        console.error('All search methods failed:', secondError.message);
        throw new Error(`Error performing semantic search: ${secondError.message}`);
      }
    }
  }

  // El método safeSearch ahora es un alias de searchAndProcess para compatibilidad
  async safeSearch(query: string, limit: number = 5): Promise<string> {
    return this.searchAndProcess(query, limit);
  }
}