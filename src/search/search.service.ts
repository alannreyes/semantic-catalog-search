import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import OpenAI from 'openai';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private pool: Pool;
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
    });
    
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
    
    this.logger.log('SearchService initialized');
  }

  /**
   * Normaliza una consulta para mejorar la coincidencia
   */
  private normalizeQuery(query: string): string {
    return query
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');  // Normalizar espacios múltiples
  }

  /**
   * Parsea los resultados JSON anidados en el campo description si es necesario
   */
  private parseProductResults(results: any[]): any[] {
    return results.map(result => {
      try {
        // Verificar si description es un string que contiene JSON
        if (typeof result.description === 'string' && 
            (result.description.startsWith('{') || result.description.includes('"text"'))) {
          // Intentar parsear el campo description que contiene JSON
          const descriptionObj = JSON.parse(result.description);
          
          return {
            id: result.id,
            description: descriptionObj.text || "Sin descripción",
            codigo: descriptionObj.metadata?.codigo || null,
            product_code: descriptionObj.id || null,
            similarity: result.similarity,
            exact_match: result.exact_match || false
          };
        } else {
          // Si description ya es un string simple, usarlo directamente
          return {
            id: result.id,
            description: result.description,
            codigo: result.codigo || null,
            product_code: result.product_code || null,
            similarity: result.similarity,
            exact_match: result.exact_match || false
          };
        }
      } catch (e) {
        this.logger.warn(`Error parsing description for product ${result.id}: ${e.message}`);
        // Si hay error, intentar extraer información básica con expresiones regulares
        try {
          const textMatch = result.description.match(/"text"\s*:\s*"([^"]+)"/);
          const idMatch = result.description.match(/"id"\s*:\s*"([^"]+)"/);
          const codigoMatch = result.description.match(/"codigo"\s*:\s*"([^"]+)"/);
          
          return {
            id: result.id,
            description: textMatch ? textMatch[1] : result.description || "Sin descripción",
            codigo: codigoMatch ? codigoMatch[1] : result.codigo || null,
            product_code: idMatch ? idMatch[1] : result.product_code || null,
            similarity: result.similarity,
            exact_match: result.exact_match || false
          };
        } catch {
          // En caso de fallo total, devolver objeto original
          return {
            id: result.id, 
            description: result.description || "Error al procesar descripción",
            codigo: result.codigo || null,
            product_code: result.product_code || null,
            similarity: result.similarity || 0,
            exact_match: result.exact_match || false
          };
        }
      }
    });
  }

  /**
   * Formatea los resultados en el formato solicitado
   */
  private formatResults(results: any[], query: string): string {
    // Encabezado
    let formattedOutput = `RESULTADOS PARA: "${query}"\n`;
    formattedOutput += "==================================================\n";
    
    // Lista de resultados
    results.forEach((product, index) => {
      // Calcular porcentaje de similitud
      const similarityPercent = (product.similarity * 100).toFixed(1) + "%";
      const codigo = product.codigo || product.product_code || "SIN CÓDIGO";
      
      // Formato de cada línea: número) producto (código) [similitud]
      formattedOutput += `${index + 1}) ${product.description} (${codigo}) [${similarityPercent}]\n`;
    });
    
    return formattedOutput;
  }

  /**
   * Realiza una búsqueda de productos utilizando un enfoque híbrido
   */
  async searchProducts(query: string, limit: number = 5) {
    try {
      const normalizedQuery = this.normalizeQuery(query);
      this.logger.log(`Processing search query: "${normalizedQuery}" with limit: ${limit}`);
      
      // 1. Intentar primero una búsqueda exacta por texto
      const exactMatchResult = await this.pool.query(
        `SELECT 
          id::TEXT,
          text AS description,
          metadata->>'codigo' AS codigo,
          metadata->>'id' AS product_code,
          1.0 AS similarity,
          TRUE AS exact_match
        FROM 
          productos
        WHERE 
          TRIM(LOWER(text)) = TRIM(LOWER($1))
          OR similarity(LOWER(text), LOWER($1)) > 0.95
        LIMIT 1`,
        [normalizedQuery]
      );
      
      // Si encontramos una coincidencia exacta
      if (exactMatchResult.rows.length > 0) {
        this.logger.log(`Found exact text match for query: "${normalizedQuery}"`);
        
        // También buscar productos similares (excluyendo el exacto)
        const embeddingResponse = await this.openai.embeddings.create({
          model: "text-embedding-3-large",
          input: normalizedQuery,
        });
        
        let embedding = embeddingResponse.data[0].embedding;
        if (!Array.isArray(embedding)) {
          this.logger.warn('El embedding no es un array, intentando convertir...');
          try {
            if (typeof embedding === 'object') {
              embedding = Object.values(embedding);
            } else if (typeof embedding === 'string') {
              embedding = JSON.parse(embedding);
            }
          } catch (error) {
            this.logger.error(`Error al convertir embedding: ${error.message}`);
            throw new Error('Formato de embedding inválido');
          }
        }
        
        const vectorString = `[${embedding.join(',')}]`;
        
        // Buscar productos similares, excluyendo la coincidencia exacta
        const similarResults = await this.pool.query(
          `SELECT 
            id::TEXT,
            text AS description,
            metadata->>'codigo' AS codigo,
            metadata->>'id' AS product_code,
            POWER(1 - (embedding <=> $1::vector), 1.5) AS similarity,
            FALSE AS exact_match
          FROM 
            productos
          WHERE 
            LOWER(text) != LOWER($2)
          ORDER BY 
            embedding <=> $1::vector
          LIMIT $3`,
          [vectorString, normalizedQuery, limit - 1]
        );
        
        // Combinar la coincidencia exacta con las similares
        const combinedResults = [
          ...exactMatchResult.rows,
          ...similarResults.rows
        ];
        
        // Parsear los resultados para manejar JSON anidado
        const parsedResults = this.parseProductResults(combinedResults);
        
        // Formatear resultados para una presentación limpia
        const formattedOutput = this.formatResults(parsedResults, query);
        
        return {
          formatted_output: formattedOutput,
          query: normalizedQuery,
          total: parsedResults.length,
          exact_match_found: true
        };
      }
      
      // 2. Si no hay coincidencia exacta, hacer búsqueda vectorial
      const embeddingResponse = await this.openai.embeddings.create({
        model: "text-embedding-3-large",
        input: normalizedQuery,
      });
      
      let embedding = embeddingResponse.data[0].embedding;
      this.logger.log(`Embedding obtenido: tipo=${typeof embedding}, es array=${Array.isArray(embedding)}`);
      
      if (!Array.isArray(embedding)) {
        this.logger.warn('El embedding no es un array, intentando convertir...');
        try {
          if (typeof embedding === 'object') {
            embedding = Object.values(embedding);
          } else if (typeof embedding === 'string') {
            embedding = JSON.parse(embedding);
          }
        } catch (error) {
          this.logger.error(`Error al convertir embedding: ${error.message}`);
          throw new Error('Formato de embedding inválido');
        }
      }
      
      this.logger.log(`Embedding procesado (${embedding.length} dimensiones)`);
      const vectorString = `[${embedding.join(',')}]`;
      
      // Usar una fórmula mejorada para calcular y escalar la similitud
      const result = await this.pool.query(
        `SELECT 
          id::TEXT,
          text AS description,
          metadata->>'codigo' AS codigo,
          metadata->>'id' AS product_code,
          CASE
            WHEN TRIM(LOWER(text)) = TRIM(LOWER($3)) THEN 1.0  -- Coincidencia exacta
            WHEN similarity(LOWER(text), LOWER($3)) > 0.95 THEN 0.99  -- Casi exacta
            ELSE POWER(1 - (embedding <=> $1::vector), 1.5)  -- Escalar similitud
          END AS similarity,
          CASE
            WHEN TRIM(LOWER(text)) = TRIM(LOWER($3)) THEN TRUE
            WHEN similarity(LOWER(text), LOWER($3)) > 0.95 THEN TRUE
            ELSE FALSE
          END AS exact_match
        FROM 
          productos
        ORDER BY 
          embedding <=> $1::vector
        LIMIT $2`,
        [vectorString, limit, normalizedQuery]
      );
      
      this.logger.log(`Found ${result.rows.length} products with similar embeddings`);
      
      // Parsear los resultados para manejar JSON anidado
      const parsedResults = this.parseProductResults(result.rows);
      
      // Formatear resultados para una presentación limpia
      const formattedOutput = this.formatResults(parsedResults, query);
      
      return {
        formatted_output: formattedOutput,
        query: normalizedQuery,
        total: parsedResults.length,
        exact_match_found: parsedResults.some(p => p.exact_match)
      };
    } catch (error) {
      this.logger.error(`Error in search: ${error.message}`, error.stack);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }
}