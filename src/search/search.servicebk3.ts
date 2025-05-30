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
        // Asegurarse de que articulo_encontrado es un string
        let nombreProducto = "";
        if (typeof item.articulo_encontrado === "string") {
          nombreProducto = item.articulo_encontrado;
        } else if (item.text) {
          nombreProducto = item.text;
        }
        
        resultadosTexto += `${index+1}) ${nombreProducto} (${item.codigo_interno}) [${item.distancia_coseno}]\n`;
      });
      
      // Configurar la solicitud a la API de OpenAI
      const openaiResponse = await axios.post<OpenAIResponse>(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo', // Modelo más común y disponible
          messages: [
            {
              role: 'system',
              content: 'Analiza estos resultados de búsqueda y reorganízalos en 5 líneas por orden de similitud real. Ignora cualquier formato JSON y extrae solo los nombres de productos, códigos y porcentajes. Si el primer producto es muy similar al buscado (>50%), añade "- COINCIDENCIA EXACTA" al final de esa línea. Responde SOLO con 5 líneas en este formato exacto: "1) NOMBRE DEL PRODUCTO (CÓDIGO) [PORCENTAJE] - COINCIDENCIA EXACTA si aplica"'
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
      
      // Formatear la respuesta final con 6 líneas (1 de consulta + 5 de resultados)
      return `${query}\n${gptResponse}`;
      
    } catch (error) {
      console.error('Error al procesar con GPT:', error.message);
      
      // Si falla la llamada a GPT, procesamos manualmente
      let primeraLinea = query;
      let lineasResultado = "";
      
      // Ordenar resultados por porcentaje de similitud
      const resultadosOrdenados = [...results].sort((a, b) => {
        const porcA = parseInt((a.distancia_coseno || "0%").replace("%", ""));
        const porcB = parseInt((b.distancia_coseno || "0%").replace("%", ""));
        return porcB - porcA;
      });
      
      // Generar 5 líneas formateadas
      resultadosOrdenados.slice(0, 5).forEach((item, index) => {
        // Extraer nombre limpio del producto
        let nombreProducto = "";
        if (typeof item.articulo_encontrado === "string") {
          nombreProducto = item.articulo_encontrado;
        } else if (item.text) {
          nombreProducto = item.text;
        }
        
        // Extraer código y porcentaje
        const codigo = item.codigo_interno || "[sin código]";
        const similitud = item.distancia_coseno || "0%";
        const porcentaje = parseInt(similitud.replace("%", "")) || 0;
        
        // Formar línea
        let linea = `${index+1}) ${nombreProducto} (${codigo}) [${similitud}]`;
        
        // Añadir indicador de coincidencia exacta al primer resultado si tiene alta similitud
        if (index === 0 && porcentaje >= 50) {
          linea += " - COINCIDENCIA EXACTA";
        }
        
        lineasResultado += linea + "\n";
      });
      
      // Devolver 6 líneas: la consulta + 5 resultados
      return `${primeraLinea}\n${lineasResultado.trim()}`;
    }
  }

  // Método para buscar y procesar con GPT en un solo paso
  async searchAndProcess(query: string, limit: number = 5): Promise<string> {
    try {
      // Intentar con búsqueda vectorial primero
      const searchResults = await this.searchProductsWithVector(query, limit);
      
      // Procesar los resultados con GPT para obtener texto formateado
      const processedResults = await this.processResultsWithGPT(searchResults, query);
      
      return processedResults; // Devuelve directamente las 6 líneas de texto
      
    } catch (error) {
      console.log('Vector search failed, trying trigram search:', error.message);
      
      try {
        // Si falla, intentar con búsqueda de trigram
        const searchResults = await this.searchProducts(query, limit);
        
        // Procesar los resultados con GPT
        const processedResults = await this.processResultsWithGPT(searchResults, query);
        
        return processedResults; // Devuelve directamente las 6 líneas de texto
        
      } catch (secondError) {
        console.error('All search methods failed:', secondError.message);
        // Incluso en caso de error, devolver un formato consistente
        return `${query}\nNo se encontraron resultados: ${secondError.message}`;
      }
    }
  }

  // El método safeSearch ahora es un alias de searchAndProcess para compatibilidad
  async safeSearch(query: string, limit: number = 5): Promise<string> {
    return this.searchAndProcess(query, limit);
  }
}