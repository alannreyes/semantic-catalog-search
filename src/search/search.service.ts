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
   * Parsea los resultados JSON anidados en el campo description
   */
  private parseProductResults(results: any[]): any[] {
    return results.map(result => {
      try {
        // Intentar parsear el campo description que contiene JSON
        const descriptionObj = JSON.parse(result.description);
        
        return {
          id: result.id,
          description: descriptionObj.text || "Sin descripción",
          codigo: descriptionObj.metadata?.codigo || null,
          product_code: descriptionObj.id || null,
          similarity: result.similarity,
          exact_match: result.exact_match || false,
          ai_validated: result.ai_validated || false,
          ai_explanation: result.ai_explanation || null,
          ai_confidence: result.ai_confidence || null
        };
      } catch (e) {
        this.logger.warn(`Error parsing description for product ${result.id}: ${e.message}`);
        // Si hay error, intentar extraer información básica con expresiones regulares
        try {
          const textMatch = result.description.match(/"text"\s*:\s*"([^"]+)"/);
          const idMatch = result.description.match(/"id"\s*:\s*"([^"]+)"/);
          const codigoMatch = result.description.match(/"codigo"\s*:\s*"([^"]+)"/);
          
          return {
            id: result.id,
            description: textMatch ? textMatch[1] : "Sin descripción",
            codigo: codigoMatch ? codigoMatch[1] : null,
            product_code: idMatch ? idMatch[1] : null,
            similarity: result.similarity,
            exact_match: result.exact_match || false,
            ai_validated: result.ai_validated || false,
            ai_explanation: result.ai_explanation || null,
            ai_confidence: result.ai_confidence || null
          };
        } catch {
          // En caso de fallo total, devolver objeto genérico
          return {
            id: result.id,
            description: "Error al procesar descripción",
            codigo: null,
            product_code: null,
            similarity: result.similarity || 0,
            exact_match: false,
            ai_validated: false
          };
        }
      }
    });
  }

  /**
   * Determina si se debe aplicar validación IA basado en resultados
   */
  private shouldApplyAIValidation(query: string, results: any[]): boolean {
    if (results.length < 2) return false;
    
    // Si hay coincidencia exacta, no necesitamos validación
    if (results.some(r => r.similarity > 0.95 || r.exact_match)) return false;
    
    // Si la diferencia entre top resultados es significativa, confiar en similitud
    if (results[0].similarity - results[1].similarity > 0.15) return false;
    
    // Para consultas largas (más específicas), aplicar validación
    if (query.split(' ').length >= 4) return true;
    
    // Aplicar validación si similitudes son muy cercanas
    if (results[0].similarity - results[1].similarity < 0.03) return true;
    
    // Limitar validaciones para optimizar costos
    return Math.random() < 0.2; // 20% de los casos restantes
  }

  /**
   * Valida los resultados usando LLM para determinar la mejor coincidencia
   */
  private async validateWithAI(query: string, candidateProducts: any[]) {
    this.logger.log(`Aplicando validación IA para consulta: "${query}"`);
    
    // Tomar solo los primeros 3 productos para la validación
    const topCandidates = candidateProducts.slice(0, Math.min(3, candidateProducts.length));
    
    // Preparar el prompt para el LLM
    const productDescriptions = topCandidates
      .map((p, i) => `Producto ${i+1}: ${p.description} (similaridad: ${(p.similarity * 100).toFixed(1)}%)`)
      .join('\n');
      
    const prompt = `
    Consulta del cliente: "${query}"
    
    Candidatos disponibles:
    ${productDescriptions}
    
    Como experto en catálogos de productos, determina cuál de estos productos es la mejor coincidencia para la consulta del cliente.
    
    Considera:
    1. Coincidencia exacta o cercana de especificaciones (marca, modelo, tamaño, color, etc.)
    2. Equivalencia funcional (si cumple el mismo propósito)
    3. Relevancia general para la necesidad expresada
    
    Responde con:
    1. El número del mejor producto (1, 2, ó 3)
    2. Una explicación breve y clara de por qué este producto es la mejor coincidencia
    3. Una puntuación de confianza de 1-10
    
    Formato: { "best_match": NÚMERO, "explanation": "TU EXPLICACIÓN", "confidence": PUNTUACIÓN }
    `;
    
    try {
      // Llamada a OpenAI
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Usar el modelo más apropiado
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
        this.logger.log(`Validación IA completada: mejor producto=${validation.best_match}, confianza=${validation.confidence}`);
        return validation;
      } catch (e) {
        this.logger.error(`Error parsing AI validation response: ${e.message}`);
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
    if (aiValidation.best_match > 1 && 
        aiValidation.best_match <= Math.min(3, reordered.length) && 
        aiValidation.confidence >= 7) {
      
      // Mover el mejor resultado al principio
      const bestMatchIndex = aiValidation.best_match - 1;
      const bestMatch = {...reordered[bestMatchIndex]};
      
      // Enriquecer con data de la IA
      bestMatch.ai_validated = true;
      bestMatch.ai_explanation = aiValidation.explanation;
      bestMatch.ai_confidence = aiValidation.confidence;
      
      // Ajustar la similitud para reflejar la validación de IA
      bestMatch.similarity = Math.max(bestMatch.similarity, reordered[0].similarity + 0.05);
      
      // Reordenar
      reordered.splice(bestMatchIndex, 1);
      reordered.unshift(bestMatch);
    } else if (aiValidation.best_match === 1 && aiValidation.confidence >= 7) {
      // Enriquecer el primer resultado con la explicación de IA
      reordered[0] = {
        ...reordered[0],
        ai_validated: true,
        ai_explanation: aiValidation.explanation,
        ai_confidence: aiValidation.confidence
      };
    }
    
    return reordered;
  }

  /**
   * Formatea los resultados en un formato limpio y legible
   */
  private formatResults(results: any[], query: string, aiValidation: any = null): string {
    // Encabezado
    let formattedOutput = `RESULTADOS PARA: "${query}"\n`;
    formattedOutput += "=".repeat(50) + "\n\n";
    
    // Si hay validación IA, mostrarla
    if (aiValidation) {
      formattedOutput += `ANÁLISIS IA: ${aiValidation.explanation}\n`;
      formattedOutput += "-".repeat(50) + "\n\n";
    }
    
    // Lista de resultados
    results.forEach((product, index) => {
      // Calcular porcentaje de similitud
      const similarityPercent = (product.similarity * 100).toFixed(1) + "%";
      
      // Etiqueta según tipo de coincidencia
      let label = "";
      if (product.exact_match) {
        label = "[COINCIDENCIA EXACTA]";
      } else if (product.ai_validated) {
        label = `[RECOMENDADO POR IA: ${product.ai_confidence}/10]`;
      } else if (product.similarity > 0.85) {
        label = "[ALTA COINCIDENCIA]";
      } else if (product.similarity > 0.75) {
        label = "[COINCIDENCIA MEDIA]";
      } else if (product.similarity > 0.65) {
        label = "[POSIBLE ALTERNATIVA]";
      } else {
        label = "[BAJA COINCIDENCIA]";
      }
      
      // Formato de cada línea
      formattedOutput += `${index + 1}) ${label} ${product.description} (${product.codigo || product.product_code}) [${similarityPercent}]\n`;
      
      // Si tiene explicación de IA, mostrarla
      if (product.ai_explanation && index === 0) {
        formattedOutput += `   → ${product.ai_explanation}\n`;
      }
      
      formattedOutput += "\n";
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
          results: parsedResults,
          formatted_output: formattedOutput,
          simple_list: parsedResults.map((p, i) => 
            `${i + 1}) ${p.description} (${p.codigo || p.product_code}) [${(p.similarity * 100).toFixed(1)}%]`
          ),
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
            WHEN LOWER(text) = LOWER($3) THEN 1.0  -- Coincidencia exacta (por si acaso)
            ELSE POWER(1 - (embedding <=> $1::vector), 1.5)  -- Escalar similitud
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
      
      // Parsear los resultados para manejar JSON anidado
      const parsedResults = this.parseProductResults(result.rows);
      
      // 3. Determinar si se necesita validación IA
      let finalResults = parsedResults;
      let aiValidation = null;
      
      if (this.shouldApplyAIValidation(normalizedQuery, parsedResults)) {
        aiValidation = await this.validateWithAI(normalizedQuery, parsedResults);
        finalResults = this.reorderBasedOnAIValidation(parsedResults, aiValidation);
      }
      
      // Formatear resultados para una presentación limpia
      const formattedOutput = this.formatResults(
        finalResults, 
        query, 
        aiValidation && aiValidation.confidence >= 7 ? aiValidation : null
      );
      
      return {
        results: finalResults,
        formatted_output: formattedOutput,
        simple_list: finalResults.map((p, i) => 
          `${i + 1}) ${p.description} (${p.codigo || p.product_code}) [${(p.similarity * 100).toFixed(1)}%]`
        ),
        query: normalizedQuery,
        total: finalResults.length,
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