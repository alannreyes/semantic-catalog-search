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
   * Determina si se debe aplicar validación IA basado en resultados
   */
  private shouldApplyAIValidation(query: string, results: any[]): boolean {
    // Si hay coincidencia exacta, no necesitamos validación
    if (results.some(r => r.similarity > 0.95)) return false;
    
    // Si la diferencia entre top resultados es significativa, confiar en similitud
    if (results.length < 2 || (results[0].similarity - results[1].similarity > 0.15)) 
      return false;
    
    // Aplicar validación para queries con al menos 4 términos (más específicas)
    if (query.split(' ').length >= 4) return true;
    
    // Limitar validaciones para optimizar costos (ajustar según necesidades)
    // Por ejemplo, solo aplicar al 20% de las consultas restantes
    return Math.random() < 0.2;
  }

  /**
   * Valida los resultados usando LLM para determinar la mejor coincidencia
   */
  private async validateWithAI(query: string, candidateProducts: any[]) {
    this.logger.log(`Aplicando validación IA para: "${query}"`);
    
    // Tomar solo los primeros 3 productos para la validación
    const topCandidates = candidateProducts.slice(0, 3);
    
    // Preparar el prompt para el LLM
    const productDescriptions = topCandidates
      .map((p, i) => `Producto ${i+1}: ${p.description} (similarity: ${p.similarity.toFixed(4)})`)
      .join('\n');
      
    const prompt = `
    Consulta del cliente: "${query}"
    
    Candidatos disponibles:
    ${productDescriptions}
    
    Determina cuál de estos productos es la mejor coincidencia para la consulta, considerando:
    1. Coincidencia exacta o cercana de especificaciones (marca, modelo, tamaño, color, etc.)
    2. Equivalencia funcional (si cumple el mismo propósito)
    3. Relevancia general para la necesidad expresada
    
    Responde con:
    1. El número del mejor producto (1, 2, ó 3)
    2. Una breve explicación de por qué este producto es la mejor coincidencia
    3. Una puntuación de confianza de 1-10
    
    Formato de respuesta: { "best_match": 1, "explanation": "...", "confidence": 9 }
    `;
    
    try {
      // Llamada a OpenAI
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Usar el modelo más apropiado según tu caso
        messages: [
          { 
            role: "system", 
            content: "Eres un experto en catálogos de productos que ayuda a identificar la mejor coincidencia entre productos similares para un sistema de cotizaciones." 
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      });
      
      try {
        // Parsear la respuesta JSON
        const validation = JSON.parse(response.choices[0].message.content);
        this.logger.log(`Validación IA completa: mejor producto=${validation.best_match}, confianza=${validation.confidence}`);
        return validation;
      } catch (e) {
        this.logger.error(`Error parsing AI validation response: ${e.message}`);
        // Respuesta fallback en caso de error
        return { best_match: 1, explanation: "No se pudo procesar la validación", confidence: 5 };
      }
    } catch (error) {
      this.logger.error(`Error en validación IA: ${error.message}`);
      return { best_match: 1, explanation: "Error en el servicio de validación", confidence: 5 };
    }
  }

  /**
   * Reordena los resultados basados en la validación IA
   */
  private reorderBasedOnAIValidation(results: any[], aiValidation: any) {
    // Copiar los resultados originales
    const reordered = [...results];
    
    // Si la IA identificó un mejor resultado que no es el primero
    if (aiValidation.best_match > 1 && aiValidation.best_match <= 3 && 
        aiValidation.confidence >= 7) {
      
      // Mover el mejor resultado al principio
      const bestMatchIndex = aiValidation.best_match - 1;
      const bestMatch = {...reordered[bestMatchIndex]};
      
      // Ajustar la similitud para reflejar la validación de IA
      bestMatch.similarity = Math.max(bestMatch.similarity, reordered[0].similarity + 0.05);
      bestMatch.ai_validated = true;
      bestMatch.ai_explanation = aiValidation.explanation;
      bestMatch.ai_confidence = aiValidation.confidence;
      
      // Reordenar
      reordered.splice(bestMatchIndex, 1);
      reordered.unshift(bestMatch);
    } else if (aiValidation.best_match === 1 && aiValidation.confidence >= 8) {
      // Enriquecer el primer resultado con la explicación de IA
      reordered[0].ai_validated = true;
      reordered[0].ai_explanation = aiValidation.explanation;
      reordered[0].ai_confidence = aiValidation.confidence;
    }
    
    return reordered;
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
          LOWER(text) = LOWER($1)
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
        // Verificar y procesar el embedding
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
        
        // Formatear resultados para una mejor presentación
        const formattedResults = combinedResults.map((row, index) => {
          const label = row.exact_match ? "COINCIDENCIA EXACTA" : 
                      row.similarity > 0.8 ? "MUY SIMILAR" : 
                      row.similarity > 0.7 ? "SIMILAR" : "ALTERNATIVA";
          
          return `${index + 1}) [${label}] ${row.description} (${row.codigo || row.product_code}) [${row.similarity.toFixed(4)}]`;
        });
        
        return {
          results: combinedResults,
          formatted_results: formattedResults,
          query: normalizedQuery,
          total: combinedResults.length,
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
      
      // Verificar y asegurar que el embedding sea un array
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
            WHEN LOWER(text) = LOWER($3) THEN 1.0  -- Coincidencia exacta (redundante pero por seguridad)
            ELSE POWER(1 - (embedding <=> $1::vector), 1.5)  -- Escalar similitud para amplificar diferencias
          END AS similarity,
          FALSE AS exact_match
        FROM 
          productos
        ORDER BY 
          embedding <=> $1::vector
        LIMIT $2`,
        [vectorString, limit, normalizedQuery]
      );
      
      this.logger.log(`Found ${result.rows.length} products with similar embeddings`);
      
      // 3. Determinar si se necesita validación IA
      let finalResults = result.rows;
      let aiValidation = null;
      
      if (this.shouldApplyAIValidation(normalizedQuery, result.rows)) {
        aiValidation = await this.validateWithAI(normalizedQuery, result.rows);
        finalResults = this.reorderBasedOnAIValidation(result.rows, aiValidation);
      }
      
      // Añadir etiquetas de confianza a los resultados
      const enhancedResults = finalResults.map(row => ({
        ...row,
        confidence_level: row.similarity > 0.85 ? "alto" : 
                         row.similarity > 0.70 ? "medio" : "bajo"
      }));
      
      // Formatear para una presentación más legible
      const formattedResults = enhancedResults.map((row, index) => {
        let label = row.ai_validated ? `[VALIDADO POR IA: CONFIANZA ${row.ai_confidence}/10]` :
                   row.similarity > 0.85 ? "[ALTA COINCIDENCIA]" : 
                   row.similarity > 0.75 ? "[COINCIDENCIA MEDIA]" : 
                   "[ALTERNATIVA POSIBLE]";
                   
        return `${index + 1}) ${label} ${row.description} (${row.codigo || row.product_code}) [${row.similarity.toFixed(4)}]`;
      });
      
      return {
        results: enhancedResults,
        formatted_results: formattedResults,
        query: normalizedQuery,
        total: enhancedResults.length,
        exact_match_found: false,
        ai_validation: aiValidation ? true : false,
        ai_explanation: aiValidation?.explanation || null
      };
    } catch (error) {
      this.logger.error(`Error in search: ${error.message}`, error.stack);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }
}