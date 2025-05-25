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

  async searchProducts(query: string, limit: number = 5) {
    try {
      this.logger.log(`Processing search query: "${query}" with limit: ${limit}`);
      
      // 1. Obtener embedding desde OpenAI
      const embeddingResponse = await this.openai.embeddings.create({
        model: "text-embedding-3-large",
        input: query,
      });
      
      // Guardar el embedding y hacer log de su tipo
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

      // Formatear para pgvector - asegurar formato correcto
      const vectorString = `[${embedding.join(',')}]`;
      
      // 2. Buscar en pgvector por similitud
      const result = await this.pool.query(
        `SELECT 
          id::TEXT,
          text AS description,
          metadata->>'codigo' AS codigo,
          metadata->>'id' AS product_code,
          1 - (embedding <=> $1::vector) AS similarity
        FROM 
          productos
        ORDER BY 
          embedding <=> $1::vector
        LIMIT $2`,
        [vectorString, limit]
      );
      
      this.logger.log(`Found ${result.rows.length} products with similar embeddings`);
      
      // 3. NUEVO BLOQUE: Juez final con GPT-4o-mini
      if (result.rows.length > 0) {
        const bestProduct = await this.selectBestProductWithGPT(query, result.rows);
        return bestProduct;
      }
      
      return {
        codigo: null,  // CAMBIO: usar codigo en lugar de id
        text: null,
        similitud: "DISTINTO" // Totalmente distinto si no hay resultados
      };
      
    } catch (error) {
      this.logger.error(`Error in search: ${error.message}`, error.stack);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }

  private async selectBestProductWithGPT(originalQuery: string, products: any[]) {
    try {
      this.logger.log(`Selecting best product with GPT for query: "${originalQuery}"`);
      
      // Formatear productos para el prompt - MEJORADO para extraer codigo consistentemente
      const productsForGPT = products.map((product, index) => {
        // Extraer el texto limpio del JSON en description
        let cleanText = '';
        let productCode = '';
        
        try {
          const parsed = JSON.parse(product.description);
          cleanText = parsed.text || '';
          // CAMBIO: priorizar siempre el codigo de metadata
          productCode = parsed.metadata?.codigo || product.codigo || parsed.id || '';
        } catch {
          // Si no es JSON, usar el texto directo
          cleanText = product.description || '';
          // CAMBIO: usar codigo de la query SQL
          productCode = product.codigo || product.id || '';
        }
        
        return {
          index: index + 1,
          codigo: productCode,  // CAMBIO: usar codigo en lugar de id
          text: cleanText,
          vectorSimilarity: product.similarity
        };
      });

      const prompt = `Eres un experto en productos y debes seleccionar el mejor producto que coincida con la búsqueda del usuario.

QUERY ORIGINAL: "${originalQuery}"

PRODUCTOS CANDIDATOS:
${productsForGPT.map(p => `${p.index}. CODIGO: ${p.codigo} | TEXTO: "${p.text}" | Similitud vectorial: ${p.vectorSimilarity}`).join('\n')}

ESCALA DE SIMILITUD:
- EXACTO: Es exactamente el producto buscado
- EQUIVALENTE: Cumple la misma función, mismas especificaciones
- COMPATIBLE: Funciona para el mismo propósito, especificaciones similares
- ALTERNATIVO: Puede servir pero con diferencias notables
- DISTINTO: No es lo que se busca

INSTRUCCIONES:
1. Analiza cada producto considerando marca, modelo, tamaño, características técnicas
2. Selecciona SOLO UNO que sea el mejor match para el query original
3. Asigna un nivel de similitud según la escala
4. Responde SOLO con un JSON válido en este formato exacto:

{
  "selectedIndex": [número del producto seleccionado 1-5],
  "similitud": "[EXACTO|EQUIVALENTE|COMPATIBLE|ALTERNATIVO|DISTINTO]",
  "razon": "[explicación breve de por qué es el mejor match]"
}`;

      const gptResponse = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Eres un experto en análisis de productos. Respondes solo con JSON válido."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      });

      const gptContent = gptResponse.choices[0].message.content?.trim();
      this.logger.log(`GPT response: ${gptContent}`);
      
      // Verificar que tenemos contenido válido
      if (!gptContent) {
        this.logger.error('GPT response content is null or empty');
        throw new Error('GPT no devolvió contenido válido');
      }
      
      // Parsear respuesta de GPT
      let gptDecision;
      try {
        gptDecision = JSON.parse(gptContent);
      } catch (error) {
        this.logger.error(`Error parsing GPT response: ${error.message}`);
        // Fallback: seleccionar el primero
        gptDecision = {
          selectedIndex: 1,
          similitud: "ALTERNATIVO",
          razon: "Error en análisis GPT, seleccionado por similitud vectorial"
        };
      }

      // Obtener el producto seleccionado
      const selectedProduct = productsForGPT[gptDecision.selectedIndex - 1];
      
      if (!selectedProduct) {
        this.logger.error(`Invalid selected index: ${gptDecision.selectedIndex}`);
        throw new Error('Índice de producto seleccionado inválido');
      }

      const finalResult = {
        codigo: selectedProduct.codigo,  // CAMBIO: usar codigo en lugar de id
        text: selectedProduct.text,
        similitud: gptDecision.similitud
      };

      this.logger.log(`Final selected product: ${JSON.stringify(finalResult)}`);
      
      return finalResult;

    } catch (error) {
      this.logger.error(`Error in GPT selection: ${error.message}`, error.stack);
      
      // Fallback: devolver el primer producto con similitud parcial
      const firstProduct = products[0];
      let cleanText = '';
      let productCode = '';
      
      try {
        const parsed = JSON.parse(firstProduct.description);
        cleanText = parsed.text || '';
        // CAMBIO: priorizar codigo de metadata
        productCode = parsed.metadata?.codigo || firstProduct.codigo || parsed.id || '';
      } catch {
        cleanText = firstProduct.description || '';
        // CAMBIO: usar codigo de la query SQL
        productCode = firstProduct.codigo || firstProduct.id || '';
      }
      
      return {
        codigo: productCode,  // CAMBIO: usar codigo en lugar de id
        text: cleanText,
        similitud: "ALTERNATIVO" // Sustituto parcial por error
      };
    }
  }
}