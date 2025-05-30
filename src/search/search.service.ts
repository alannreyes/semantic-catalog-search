import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import OpenAI from 'openai';

@Injectable()
export class SearchService implements OnModuleDestroy {
  private pool: Pool;
  private openai: OpenAI;

  private readonly probes: number;
  private readonly embeddingModel: string;
  private readonly productTable: string;

  constructor(
    private configService: ConfigService,
    private readonly logger: Logger,
  ) {
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
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL') || 'text-embedding-3-large';
    this.productTable = this.configService.get<string>('PRODUCT_TABLE') || 'productos_1024';

    this.logger.log(
      `SearchService initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}`,
      SearchService.name
    );
  }

async searchProducts(query: string, limit: number = 5, segmentoPrecio?: 'PREMIUM' | 'ESTANDAR' | 'ECONOMICO') {
  const startTime = process.hrtime.bigint();
  let client: PoolClient;

  this.logger.log(
    `Iniciando búsqueda de productos.`,
    SearchService.name,
    { query_text: query, segmento_precio_deseado: segmentoPrecio } // Añade metadatos
  );

    try {
      this.logger.log(
        `Buscando productos con query original: "${query}"`,
        SearchService.name // <--- AÑADE EL CONTEXTO
      );

      // --- LOGGING DE CONEXIÓN A DB ---
      const clientConnectStart = process.hrtime.bigint(); // Inicio de medición
      client = await Promise.race([
        this.pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 10000))
      ]) as any;
      const clientConnectEnd = process.hrtime.bigint(); // Fin de medición
      this.logger.debug( // <--- Usa 'debug' para logs detallados de rendimiento
        `Conexión a DB obtenida.`,
        SearchService.name,
        { duration_ms: Number(clientConnectEnd - clientConnectStart) / 1_000_000 } // <--- Calcula y envía la duración
      );

      const initialSearchStart = process.hrtime.bigint();
      const initialResult = await this.performSemanticSearch(query, limit, client, segmentoPrecio);
      const initialSearchEnd = process.hrtime.bigint();
      this.logger.log(
        `Búsqueda semántica inicial completada. Similitud: ${initialResult.similitud}`,
        SearchService.name,
        {
          duration_ms: Number(initialSearchEnd - initialSearchStart) / 1_000_000,
          query_text: query, 
          similitud_resultado: initialResult.similitud,
		  segmento_precio_usado_inicial: segmentoPrecio 

        }
      );

      if (["EXACTO", "EQUIVALENTE"].includes(initialResult.similitud)) {
        this.logger.log(`Similitud alta detectada (${initialResult.similitud}), no se requiere normalización.`, SearchService.name);
        // Calcula el tiempo total incluso si no se normaliza
        const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        this.logger.log(`Búsqueda completada (sin normalización).`, SearchService.name, { duration_ms: totalTime });
        return { ...initialResult, normalizado: null };
      }

      this.logger.log(`Similitud baja (${initialResult.similitud}), activando normalización de query con GPT-4.1.`, SearchService.name);

      const normalizeStart = process.hrtime.bigint();
      const normalizedQuery = await Promise.race([
        this.normalizeQueryWithGPT(query), // <--- CAMBIO AQUÍ: Llamar al nuevo método
        new Promise<string>((resolve) => setTimeout(() => {
          this.logger.warn('GPT query normalization timeout, using original query.', SearchService.name);
          resolve(query);
        }, 30000)) // 30 segundos max para normalización con GPT
      ]);
      const normalizeEnd = process.hrtime.bigint();
      this.logger.log(
        `Normalización de query completada.`,
        SearchService.name,
        {
          duration_ms: Number(normalizeEnd - normalizeStart) / 1_000_000,
          original_query: query,
          normalized_query: normalizedQuery
        }
      );

      const resultAfterNormalizationStart = process.hrtime.bigint();
      const resultAfterNormalization = await this.performSemanticSearch(
        normalizedQuery,
        limit,
        client,
		segmentoPrecio,
        query
      );
      const resultAfterNormalizationEnd = process.hrtime.bigint();
      this.logger.log(
        `Búsqueda después de normalización completada.`,
        SearchService.name,
        {
          duration_ms: Number(resultAfterNormalizationEnd - resultAfterNormalizationStart) / 1_000_000,
          query_text: normalizedQuery,
          similitud_resultado: resultAfterNormalization.similitud,
		  segmento_precio_usado_final: segmentoPrecio
        }
      );

      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this.logger.log(
        `Búsqueda de productos finalizada.`,
        SearchService.name,
        { duration_ms: totalTime } // <--- Envía la duración total
      );

      return {
        ...resultAfterNormalization,
        normalizado: normalizedQuery
      };

    } catch (error) {
      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this.logger.error(
        `Error en búsqueda general.`,
        error.stack, // <--- El stack trace es el segundo argumento para error
        SearchService.name,
        { duration_ms: totalTime, error_message: error.message } // <--- Envía metadatos detallados
      );
      throw new Error(`Error en búsqueda semántica: ${error.message}`);
    } finally {
      if (client) {
        client.release();
        this.logger.debug(`Conexión a DB liberada.`, SearchService.name); // <--- LOG de liberación
      }
    }
  }

  private async performSemanticSearch(
    inputText: string,
    limit: number = 5,
    client: PoolClient,
	segmentoPrecioDeseado?: 'PREMIUM' | 'ESTANDAR' | 'ECONOMICO', 
    originalQueryOverride?: string
  ) {
    const stepStartTime = process.hrtime.bigint(); // <--- INICIO DE MEDICIÓN PARA ESTE MÉTODO
    try {
     this.logger.log(
      `Iniciando performSemanticSearch para: "${inputText}" con segmento de precio deseado: ${segmentoPrecioDeseado || 'cualquiera'}`,
      SearchService.name
      );

      // --- LOGGING DE CREACIÓN DE EMBEDDING ---
      const embeddingStart = process.hrtime.bigint();
      const embeddingResponse = await Promise.race([
        this.openai.embeddings.create({ model: this.embeddingModel, input: inputText, dimensions: 1024 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OpenAI embedding timeout')), 30000))
      ]) as any;
      const embeddingEnd = process.hrtime.bigint();
      this.logger.debug(
        `Embedding creado.`,
        SearchService.name,
        {
          duration_ms: Number(embeddingEnd - embeddingStart) / 1_000_000,
          model: this.embeddingModel
        }
      );

      let embedding = embeddingResponse.data[0].embedding;

      if (!Array.isArray(embedding)) {
        this.logger.warn(
          'El embedding no es un array, intentando convertir...',
          SearchService.name
        );
        try {
          if (typeof embedding === 'object') {
            embedding = Object.values(embedding);
          } else if (typeof embedding === 'string') {
            embedding = JSON.parse(embedding);
          }
        } catch (error) {
          this.logger.error(
            `Error al convertir embedding: ${error.message}`,
            error.stack,
            SearchService.name
          );
          throw new Error('Formato de embedding inválido');
        }
      }

      const vectorString = `[${embedding.join(',')}]`;

      // --- LOGGING DE CONFIGURACIÓN DE PROBES ---
      const setProbesStart = process.hrtime.bigint();
      await Promise.race([
        client.query(`SET ivfflat.probes = ${this.probes}`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Set probes timeout')), 5000))
      ]);
      const setProbesEnd = process.hrtime.bigint();
      this.logger.debug(
        `Probes configuradas.`,
        SearchService.name,
        {
          duration_ms: Number(setProbesEnd - setProbesStart) / 1_000_000,
          probes: this.probes
        }
      );

      // --- BÚSQUEDA VECTORIAL ---
      const vectorSearchStart = process.hrtime.bigint();
      const result = await Promise.race([
        client.query(
          `SELECT codigo, descripcion, marca, segmento_precio, codfabrica, 1 - (embedding <=> $1::vector) AS similarity FROM ${this.productTable} ORDER BY embedding <=> $1::vector LIMIT $2`,
          [vectorString, limit]
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Vector search timeout')), 25000))
      ]) as any;
      const vectorSearchEnd = process.hrtime.bigint();
      this.logger.log(
        `Búsqueda vectorial completada.`,
        SearchService.name,
        {
          duration_ms: Number(vectorSearchEnd - vectorSearchStart) / 1_000_000,
          products_found: result.rows.length
        }
      );

      this.logger.log(
        `Productos similares encontrados: ${result.rows.length}`,
        SearchService.name
      );

      if (result.rows.length === 0) {
  return {
    codigo: null,
    marca: null,
    segmento_precio: null,
    codfabrica: null,
    descripcion: null,
    similitud: "DISTINTO",
    razon: "No se encontraron productos similares en la base de datos"
  };
}

      // --- SELECCIÓN GPT ---
      const gptSelectionStart = process.hrtime.bigint();
      const best = await this.selectBestProductWithGPT(
        originalQueryOverride || inputText,
        result.rows,
        inputText,
		segmentoPrecioDeseado
      );
      const gptSelectionEnd = process.hrtime.bigint();
      this.logger.log(
        `Selección GPT completada.`,
        SearchService.name,
        {
          duration_ms: Number(gptSelectionEnd - gptSelectionStart) / 1_000_000,
          similitud_seleccionada: best.similitud,
		  segmento_precio_considerado_gpt: segmentoPrecioDeseado
        }
      );

      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `performSemanticSearch finalizado.`,
        SearchService.name,
        { duration_ms: totalStepTime } // <--- DURACIÓN TOTAL DEL MÉTODO
      );
      return best;

    } catch (error) {
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.error(
        `Error en búsqueda semántica.`,
        error.stack,
        SearchService.name,
        { duration_ms: totalStepTime, error_message: error.message }
      );
      throw error;
    }
  }

  private async selectBestProductWithGPT(
  originalQuery: string,
  products: any[],
  normalizedQuery: string,
  segmentoPrecioDeseado?: 'PREMIUM' | 'ESTANDAR' | 'ECONOMICO' 
) {
    const stepStartTime = process.hrtime.bigint(); // <--- INICIO DE MEDICIÓN
    try {
    this.logger.log(
      `Iniciando selectBestProductWithGPT para: "${originalQuery}" con segmento de precio deseado: ${segmentoPrecioDeseado || 'cualquiera'}`,
      SearchService.name
    );

      const productsForGPT = products.map((product, index) => {
        const cleanText = product.descripcion || '';
        const productCode = product.codigo || '';
        const productMarca = product.marca || 'N/A';
        const productSegmentoPrecio = product.segmento_precio || 'ESTANDAR';
        const productCodFabrica = product.codfabrica || ''; // Handle NULL for codfabrica

        return {
          index: index + 1,
          codigo: productCode,
          text: cleanText,
          marca: productMarca,
          segmento_precio: productSegmentoPrecio,
          codfabrica: productCodFabrica, // Include codfabrica
          vectorSimilarity: product.similarity
        };
      });

    let instructionsForPriceSegment = '';
    if (segmentoPrecioDeseado) {
      instructionsForPriceSegment = `
Si el usuario indicó un segmento de precio, prioriza los productos de ese segmento. Si no hay un match exacto en el segmento, busca el más cercano según esta preferencia:
- Si es '${segmentoPrecioDeseado}':
  - Si es PREMIUM, busca PREMIUM, luego ESTANDAR, luego ECONOMICO.
  - Si es ESTANDAR, busca ESTANDAR, luego PREMIUM, luego ECONOMICO.
  - Si es ECONOMICO, busca ECONOMICO, luego ESTANDAR, luego PREMIUM.
`;
    }

      const prompt = `Eres un experto en productos y debes seleccionar el mejor producto que coincida con la búsqueda del usuario.

QUERY ORIGINAL: "${originalQuery}"

PRODUCTOS CANDIDATOS:
${productsForGPT.map(p => `${p.index}. CODIGO: ${p.codigo} | TEXTO: "${p.text}" | MARCA: ${p.marca} | SEGMENTO PRECIO: ${p.segmento_precio} | CODIGO FABRICA: ${p.codfabrica} | Similitud vectorial: ${p.vectorSimilarity}`).join('\n')}

ESCALA DE SIMILITUD:
- EXACTO: Es exactamente el producto buscado, es lo mismo que se busca
- EQUIVALENTE: Cumple la misma función, mismas especificaciones
- COMPATIBLE: Funciona para el mismo propósito, especificaciones similares
- ALTERNATIVO: Puede servir pero con diferencias notables
- DISTINTO: No es lo que se busca

INSTRUCCIONES:
1. Analiza cada producto considerando marca, modelo, tamaño, características técnicas, y código de fábrica.
2. Selecciona SOLO UNO que sea el mejor match para el query original.
${instructionsForPriceSegment}
3. Asigna un nivel de similitud según la escala.
4. Responde SOLO con un JSON válido en este formato exacto:

{
  "selectedIndex": [número del producto seleccionado 1-5],
  "similitud": "[EXACTO|EQUIVALENTE|COMPATIBLE|ALTERNATIVO|DISTINTO]",
  "razon": "[explicación breve de por qué es el mejor match]"
}`;

      // --- LLAMADA A GPT ---
      const gptCallStart = process.hrtime.bigint();
      const gptResponse = await Promise.race([
        this.openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [
            {
              role: "system",
              content: "Eres un experto en análisis de productos industriales y suministros. Respondes solo con JSON válido."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 300
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GPT selection timeout')), 15000))
      ]) as any;
      const gptCallEnd = process.hrtime.bigint();
      this.logger.debug(
        `Llamada a GPT completada.`,
        SearchService.name,
        {
          duration_ms: Number(gptCallEnd - gptCallStart) / 1_000_000,
          model: "gpt-4.1",
          tokens_used: gptResponse.usage?.total_tokens
        }
      );

      const gptContent = gptResponse.choices[0].message.content?.trim();
this.logger.log(
    `Contenido CRUDO de GPT para selectBestProduct: -----\n${gptContent}\n-----`, 
    SearchService.name
);
this.logger.log(
    `GPT response recibido (para selectBestProduct).`, 
    SearchService.name, 
    { content_length: gptContent?.length || 0 } // Log actual
);

if (!gptContent) {
  this.logger.error('GPT (selectBestProduct) no devolvió contenido (null o vacío).', SearchService.name);
  throw new Error('GPT no devolvió contenido válido para selectBestProduct');
}

let gptDecision;
try {
  gptDecision = JSON.parse(gptContent);
} catch (error) {
  this.logger.error(
    `Error al parsear JSON de GPT (selectBestProduct): <span class="math-inline">\{error\.message\}\. Contenido crudo que intentó parsear\: \>\>\></span>{gptContent}<<<`, 
    error.stack, 
    SearchService.name

        );
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

      const description = selectedProduct.text;
      const codigo = selectedProduct.codigo;

      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `selectBestProductWithGPT finalizado.`,
        SearchService.name,
        {
          duration_ms: totalStepTime,
          selected_similitud: gptDecision.similitud,
          selected_index: gptDecision.selectedIndex
        }
      );
      return {
        codigo: codigo,
		marca: selectedProduct.marca,
		segmento_precio: selectedProduct.segmento_precio,
		codfabrica: selectedProduct.codfabrica, 
        descripcion: description,
        similitud: gptDecision.similitud,
        razon: gptDecision.razon
      };

    } catch (error) {
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.error(
        `Error en selección GPT.`,
        error.stack,
        SearchService.name,
        { duration_ms: totalStepTime, error_message: error.message }
      );

      const firstProduct = products[0];
      const cleanText = firstProduct.descripcion || '';
      const productCode = firstProduct.codigo || '';

      return {
        codigo: productCode,
		marca: firstProduct.marca || null,
		segmento_precio: firstProduct.segmento_precio || null,
		codfabrica: firstProduct.codfabrica || null,
        descripcion: cleanText,
        similitud: "ALTERNATIVO",
        razon: "Error al procesar selección GPT, se usó el primer resultado por defecto"
      };
    }
  }

  // REEMPLAZO DE normalizeQueryWithWebSearch
  private async normalizeQueryWithGPT(query: string): Promise<string> {
    const stepStartTime = process.hrtime.bigint(); // <--- INICIO DE MEDICIÓN
    try {
      this.logger.log(
        `Iniciando normalización de query con GPT-4.1 para: "${query}"`,
        SearchService.name
      );

      // --- LLAMADA A GPT PARA NORMALIZACIÓN ---
      const gptNormalizationCallStart = process.hrtime.bigint();
      const response = await Promise.race([
        this.openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [
            {
              role: "system",
              content: `Tu tarea es encontrar el nombre técnico más preciso a partir del query del usuario. Debes devolver SÓLO el nombre técnico, sin explicaciones ni texto adicional. Incluye marca, tipo, modelo, color, tamaño, o presentación si son relevantes y están implícitos en el query. Corrige posibles errores ortográficos, contracciones o modismos. Asegúrate de que la respuesta sea en minúsculas y sin comillas al inicio o al final.

              Ejemplos:
              "pintura blanca 5 gal sherwin" => pintura sherwin-williams blanca 5 galones
              "guantes de corte nivel 5 m" => guantes anticorte nivel 5 talla m
              "silicona teka transparente 280ml" => silicona neutra transparente teka 280ml
              "brocha tumi 2" => brocha de nylon tumi 2 pulgadas
              "tubo pvc 1/2 agua fria" => tubo pvc presión 1/2 pulgada agua fría
              "martillo stanley uña" => martillo de uña stanley
              "llave francesa 10" => llave ajustable 10 pulgadas`
            },
            {
              role: "user",
              content: `Normaliza este query: "${query}"`
            }
          ],
          temperature: 0.2, // Un poco más de creatividad para correcciones, pero aún enfocada
          max_tokens: 100 // Suficiente para un nombre técnico
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GPT normalization timeout')), 25000))
      ]) as any;
      const gptNormalizationCallEnd = process.hrtime.bigint();
      this.logger.debug(
        `Llamada a GPT para normalización completada.`,
        SearchService.name,
        {
          duration_ms: Number(gptNormalizationCallEnd - gptNormalizationCallStart) / 1_000_000,
          model: "gpt-4.1",
          tokens_used: response.usage?.total_tokens
        }
      );

      let normalized = response.choices[0].message.content?.trim();

      // Clean leading/trailing quotes just in case GPT adds them
      if (normalized && (normalized.startsWith('"') && normalized.endsWith('"'))) {
        normalized = normalized.slice(1, -1);
      }
      // Ensure it's lowercase
      normalized = normalized?.toLowerCase() || query.toLowerCase();


      this.logger.log(
        `Query normalizada: "${normalized}"`,
        SearchService.name,
        { original_query: query, normalized_query: normalized }
      );

      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `normalizeQueryWithGPT finalizado.`,
        SearchService.name,
        {
          duration_ms: totalStepTime,
          final_query: normalized
        }
      );
      return normalized;

    } catch (error) {
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.error(
        `Error en normalización con GPT.`,
        error.stack,
        SearchService.name,
        { duration_ms: totalStepTime, error_message: error.message }
      );
      this.logger.warn(`Falló la normalización GPT, usando query original: "${query}"`, SearchService.name);
      return query; // Fallback to original query on error
    }
  }

  // Método para limpiar conexiones al cerrar la aplicación
  async onModuleDestroy() {
    this.logger.log(`Cerrando pool de conexiones de PostgreSQL en SearchService.`, SearchService.name); // <--- LOG al cerrar
    await this.pool.end();
  }
}