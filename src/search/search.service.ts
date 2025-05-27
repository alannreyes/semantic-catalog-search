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
    // Configuración optimizada del pool de conexiones
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      max: 20, // Máximo 20 conexiones
      idleTimeoutMillis: 30000, // 30 segundos
      connectionTimeoutMillis: 10000, // 10 segundos timeout para conexión
      statement_timeout: 30000, // 30 segundos timeout para queries
      query_timeout: 30000, // 30 segundos timeout para queries
    });

    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      timeout: 45000, // 45 segundos timeout para OpenAI
      maxRetries: 2, // Máximo 2 reintentos
    });

    this.probes = parseInt(this.configService.get<string>('PGVECTOR_PROBES') || '1', 10);
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL') || 'text-embedding-3-small';
    this.productTable = this.configService.get<string>('PRODUCT_TABLE') || 'productos_small';

    this.logger.log(`SearchService initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}`);
  }

  async searchProducts(query: string, limit: number = 5) {
    const startTime = Date.now();
    let client;
    
    try {
      this.logger.log(`Buscando productos con query original: "${query}"`);

      // Obtener cliente del pool con timeout
      client = await Promise.race([
        this.pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database connection timeout')), 10000)
        )
      ]) as any;

      const initialResult = await this.performSemanticSearch(query, limit, client);

      if (["EXACTO", "EQUIVALENTE"].includes(initialResult.similitud)) {
        this.logger.log(`Similitud alta detectada (${initialResult.similitud}), no se requiere búsqueda web`);
        return { ...initialResult, normalizado: null };
      }

      this.logger.log(`Similitud baja (${initialResult.similitud}), activando búsqueda web para normalización`);
      
      // Ejecutar normalización con timeout más corto
      const normalizedQuery = await Promise.race([
        this.normalizeQueryWithWebSearch(query),
        new Promise<string>((resolve) => 
          setTimeout(() => {
            this.logger.warn('Web search timeout, usando query original');
            resolve(query);
          }, 30000) // 30 segundos max para web search
        )
      ]);

      const resultAfterNormalization = await this.performSemanticSearch(
        normalizedQuery, 
        limit, 
        client, 
        query
      );

      const totalTime = Date.now() - startTime;
      this.logger.log(`Búsqueda completada en ${totalTime}ms`);

      return {
        ...resultAfterNormalization,
        normalizado: normalizedQuery
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.logger.error(`Error en búsqueda general después de ${totalTime}ms: ${error.message}`, error.stack);
      throw new Error(`Error en búsqueda semántica: ${error.message}`);
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  private async performSemanticSearch(
    inputText: string, 
    limit: number = 5, 
    client: any, 
    originalQueryOverride?: string
  ) {
    try {
      // Crear embedding con timeout
      const embeddingResponse = await Promise.race([
        this.openai.embeddings.create({
          model: this.embeddingModel,
          input: inputText,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI embedding timeout')), 30000)
        )
      ]) as any;

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

      // Configurar probes con timeout
      await Promise.race([
        client.query(`SET ivfflat.probes = ${this.probes}`),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Set probes timeout')), 5000)
        )
      ]);

      // Ejecutar búsqueda vectorial con timeout
      const result = await Promise.race([
        client.query(
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
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Vector search timeout')), 25000)
        )
      ]) as any;

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

    } catch (error) {
      this.logger.error(`Error en búsqueda semántica: ${error.message}`);
      throw error;
    }
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

      // GPT con timeout más agresivo
      const gptResponse = await Promise.race([
        this.openai.chat.completions.create({
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
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('GPT selection timeout')), 15000)
        )
      ]) as any;

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
        // Parseo profundo del campo text en caso de estar doblemente embebido
        if (typeof description === 'string' && description.includes('{')) {
          const parsed1 = JSON.parse(description);

          if (typeof parsed1.text === 'string' && parsed1.text.includes('{')) {
            const parsed2 = JSON.parse(parsed1.text);
            description = parsed2.text || parsed1.text;
            if (!codigo && parsed2.metadata?.codigo) {
              codigo = parsed2.metadata.codigo;
            }
          } else {
            description = parsed1.text || description;
            if (!codigo && parsed1.metadata?.codigo) {
              codigo = parsed1.metadata.codigo;
            }
          }
        }
      } catch (err) {
        this.logger.warn(`No se pudo parsear 'description': ${err.message}`);
      }

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

      // Web search con timeout más corto
      const response = await Promise.race([
        this.openai.responses.create({
          model: "gpt-4o",
          tools: [{ type: "web_search_preview" }],
          input: `Tu tarea es buscar en internet el producto mencionado y devolver únicamente el nombre técnico más preciso basado en la información encontrada. No expliques nada. Incluye marca, tipo, color, y presentación si están disponibles. Usa siempre minúsculas y sin comillas.

Ejemplos:
"pintura blanca 5 gal sherwin" => pintura blanca 5 galones
"guantes de corte nivel 5 m" => guantes corte nivel 5 talla m
"silicona teka transparente 280ml" => silicona neutra transparente 280ml
"brocha tumi 2" => brocha de nylon tumi de 2 pulgadas

Producto a normalizar: ${query}`,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Web search timeout')), 25000)
        )
      ]) as any;

      const normalized = response.output_text?.trim().replace(/^"|"$/g, '');
      this.logger.log(`Query normalizada: "${normalized}"`);
      return normalized || query;
    } catch (error) {
      this.logger.error(`Error en normalización con búsqueda web: ${error.message}`);
      return query;
    }
  }

  // Método para limpiar conexiones al cerrar la aplicación
  async onModuleDestroy() {
    await this.pool.end();
  }
}