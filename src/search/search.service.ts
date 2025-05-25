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

      // ETAPA 1: Normalizar el query usando búsqueda web
      const normalizedQuery = await this.normalizeQueryWithWebSearch(query);

      // ETAPA 2: Obtener embedding desde OpenAI usando la versión normalizada
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

      const vectorString = `[${embedding.join(',')}]`;

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

      if (result.rows.length > 0) {
        const bestProduct = await this.selectBestProductWithGPT(query, result.rows, normalizedQuery);
        return bestProduct;
      }

      return {
        codigo: null,
        text: null,
        similitud: "DISTINTO",
        normalizado: normalizedQuery,
      };

    } catch (error) {
      this.logger.error(`Error in search: ${error.message}`, error.stack);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }

  private async selectBestProductWithGPT(originalQuery: string, products: any[], normalizedQuery: string) {
    try {
      this.logger.log(`Selecting best product with GPT for query: "${originalQuery}"`);

      const productsForGPT = products.map((product, index) => {
        let cleanText = '';
        let productCode = '';

        try {
          const parsed = JSON.parse(product.description);
          cleanText = parsed.text || '';
          productCode = parsed.metadata?.codigo || product.codigo || parsed.id || '';
        } catch {
          cleanText = product.description || '';
          productCode = product.codigo || product.id || '';
        }

        return {
          index: index + 1,
          codigo: productCode,
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

      if (!gptContent) {
        this.logger.error('GPT response content is null or empty');
        throw new Error('GPT no devolvió contenido válido');
      }

      let gptDecision;
      try {
        gptDecision = JSON.parse(gptContent);
      } catch (error) {
        this.logger.error(`Error parsing GPT response: ${error.message}`);
        gptDecision = {
          selectedIndex: 1,
          similitud: "ALTERNATIVO",
          razon: "Error en análisis GPT, seleccionado por similitud vectorial"
        };
      }

      const selectedProduct = productsForGPT[gptDecision.selectedIndex - 1];

      if (!selectedProduct) {
        this.logger.error(`Invalid selected index: ${gptDecision.selectedIndex}`);
        throw new Error('Índice de producto seleccionado inválido');
      }

      return {
        codigo: selectedProduct.codigo,
        text: selectedProduct.text,
        similitud: gptDecision.similitud,
        normalizado: normalizedQuery
      };

    } catch (error) {
      this.logger.error(`Error in GPT selection: ${error.message}`, error.stack);

      const firstProduct = products[0];
      let cleanText = '';
      let productCode = '';

      try {
        const parsed = JSON.parse(firstProduct.description);
        cleanText = parsed.text || '';
        productCode = parsed.metadata?.codigo || firstProduct.codigo || parsed.id || '';
      } catch {
        cleanText = firstProduct.description || '';
        productCode = firstProduct.codigo || firstProduct.id || '';
      }

      return {
        codigo: productCode,
        text: cleanText,
        similitud: "ALTERNATIVO",
        normalizado: normalizedQuery
      };
    }
  }

  private async normalizeQueryWithWebSearch(query: string): Promise<string> {
    try {
      this.logger.log(`Normalizando query con búsqueda web real: "${query}"`);

      const response = await this.openai.responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: `Tu tarea es buscar en internet el producto mencionado y devolver únicamente el nombre técnico más preciso basado en la información encontrada. No expliques nada. Incluye marca, tipo, color, y presentación si están disponibles. Usa siempre minúsculas y sin comillas.

Ejemplos:
"pintura blanca 5 gal sherwin" => pintura blanca sherwin 5 galones
"guantes de corte nivel 5 m" => guantes corte nivel 5 talla m
"silicona teka transparente 280ml" => silicona neutra transparente teka 280ml

Producto a normalizar: ${query}`,
      });

      const normalized = response.output_text?.trim().replace(/^["']|["']$/g, '');
      this.logger.log(`Query normalizada: "${normalized}"`);
      return normalized || query;
    } catch (error) {
      this.logger.error(`Error en normalización con búsqueda web: ${error.message}`);
      return query;
    }
  }
}
