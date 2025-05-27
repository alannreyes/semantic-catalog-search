import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import OpenAI from 'openai';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private pool: Pool;
  private openai: OpenAI;

  private readonly probes: number;
  private readonly embeddingModel: string;
  private readonly productTable: string;

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
    });

    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    this.probes = parseInt(this.configService.get<string>('PGVECTOR_PROBES') || '1', 10);
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL') || 'text-embedding-3-small';
    this.productTable = this.configService.get<string>('PRODUCT_TABLE') || 'productos_small';

    this.logger.log(`SearchService initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}`);
  }

  async searchProducts(query: string, limit: number = 5) {
    try {
      this.logger.log(`Buscando productos con query original: "${query}"`);

      const initialResult = await this.performSemanticSearch(query, limit);

      if (["EXACTO", "EQUIVALENTE"].includes(initialResult.similitud)) {
        this.logger.log(`Similitud alta detectada (${initialResult.similitud}), no se requiere búsqueda web`);
        return { ...initialResult, normalizado: null };
      }

      this.logger.log(`Similitud baja (${initialResult.similitud}), activando búsqueda web para normalización`);
      const normalizedQuery = await this.normalizeQueryWithWebSearch(query);
      const resultAfterNormalization = await this.performSemanticSearch(normalizedQuery, limit, query);

      return {
        ...resultAfterNormalization,
        normalizado: normalizedQuery
      };

    } catch (error) {
      this.logger.error(`Error en búsqueda general: ${error.message}`, error.stack);
      throw new Error(`Error en búsqueda semántica: ${error.message}`);
    }
  }

  private async performSemanticSearch(inputText: string, limit: number = 5, originalQueryOverride?: string) {
    const embeddingResponse = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: inputText,
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

    await this.pool.query(`SET ivfflat.probes = ${this.probes}`);

    const result = await this.pool.query(
      `SELECT 
         id::TEXT,
         text AS description,
         1 - (embedding <=> $1::vector) AS similarity
       FROM 
         ${this.productTable}
       ORDER BY 
         embedding <=> $1::vector
       LIMIT $2`,
      [vectorString, limit]
    );

    this.logger.log(`Productos similares encontrados: ${result.rows.length}`);

    if (result.rows.length === 0) {
      return {
        codigo: null,
        descripcion: null,
        similitud: "DISTINTO"
      };
    }

    const best = await this.selectBestProductWithGPT(
      originalQueryOverride || inputText,
      result.rows,
      inputText
    );

    return best;
  }

  private async selectBestProductWithGPT(originalQuery: string, products: any[], normalizedQuery: string) {
    try {
      this.logger.log(`Seleccionando mejor producto con GPT para: "${originalQuery}"`);

      const productsForGPT = products.map((product, index) => {
        let cleanText = '';
        let productCode = '';

        try {
          const parsed = JSON.parse(product.description);
          cleanText = parsed.text || '';
          if (parsed.metadata?.codigo && parsed.metadata.codigo.length < 20) {
            productCode = parsed.metadata.codigo;
          } else if (parsed.id && parsed.id.length < 20) {
            productCode = parsed.id;
          }
        } catch {
          cleanText = product.description || '';
        }

        if (!productCode && product.id && product.id.length < 20) {
          productCode = product.id;
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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      let gptResponse;
      try {
        gptResponse = await this.openai.chat.completions.create({
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
        }, {
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const gptContent = gptResponse.choices[0].message.content?.trim();
      this.logger.log(`GPT response: ${gptContent}`);

      if (!gptContent) {
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
        throw new Error(`Índice de producto seleccionado inválido: ${gptDecision.selectedIndex}`);
      }

      let description = selectedProduct.text;
      let codigo = selectedProduct.codigo;

      try {
        const parsed = JSON.parse(description);
        if (parsed.text) {
          description = parsed.text;
        }
        if (!codigo && parsed.metadata?.codigo) {
          codigo = parsed.metadata.codigo;
        }
      } catch {}

      return {
        codigo: codigo,
        descripcion: description,
        similitud: gptDecision.similitud,
        razon: gptDecision.razon
      };

    } catch (error) {
      this.logger.error(`Error en selección GPT: ${error.message}`, error.stack);

      const firstProduct = products[0];
      let cleanText = '';
      let productCode = '';

      try {
        const parsed = JSON.parse(firstProduct.description);
        cleanText = parsed.text || '';
        productCode = parsed.metadata?.codigo || parsed.id || '';
      } catch {
        cleanText = firstProduct.description || '';
        productCode = firstProduct.id || '';
      }

      return {
        codigo: productCode,
        descripcion: cleanText,
        similitud: "ALTERNATIVO",
        razon: "Error al procesar selección GPT, se usó el primer resultado por defecto"
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

      const normalized = response.output_text?.trim().replace(/^"|"$/g, '');
      this.logger.log(`Query normalizada: "${normalized}"`);
      return normalized || query;
    } catch (error) {
      this.logger.error(`Error en normalización con búsqueda web: ${error.message}`);
      return query;
    }
  }
}
