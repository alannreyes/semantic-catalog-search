// --- PREPARACIÓN DE DATOS PARA ANÁLISIS ---
      // Estructura los productos en formato optimizado para el análisis de GPT      // --- VALIDACIÓN Y CONVERSIÓN DEL EMBEDDING ---
      // Asegura que el embedding esté en formato correcto y tenga las dimensiones esperadas      // --- BÚSQUEDA CON QUERY NORMALIZADO ---
      // Segunda búsqueda usando el query mejorado por GPT-4o      // --- BÚSQUEDA SEMÁNTICA INICIAL ---
      // Primera búsqueda con el query original para evaluar si necesita normalización//
// SearchService - Servicio de busqueda semantica con inteligencia artificial
// 
// Implementa busqueda vectorial usando OpenAI embeddings y PostgreSQL con pgvector,
// incluye sistema de boost por segmento de marca y seleccion inteligente con GPT-4o.
// 
// Autor: Alann Reyes (asistido por Claude Sonnet 4)
// Fecha: 2 de Junio, 2025
//

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
  private readonly vectorDimensions: number;

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
    
    this.vectorDimensions = parseInt(
      this.configService.get<string>('VECTOR_DIMENSIONS') || '1024', 
      10
    );

    this.logger.log(
      `SearchService initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}, dimensions=${this.vectorDimensions}`,
      SearchService.name
    );

    if (this.vectorDimensions <= 0 || !Number.isInteger(this.vectorDimensions)) {
      this.logger.error(
        `Invalid vector dimensions: ${this.vectorDimensions}. Must be a positive integer.`,
        null,
        SearchService.name
      );
      throw new Error(`Invalid VECTOR_DIMENSIONS configuration: ${this.vectorDimensions}`);
    }
  }

  // Metodo principal de busqueda semantica de productos
  // Coordina todo el proceso: embedding del query, busqueda vectorial, boost por segmento,
  // seleccion con GPT-4o y normalizacion automatica si la similaridad es baja.
  async searchProducts(query: string, limit: number = 5, segment?: 'premium' | 'standard' | 'economy') {
    const startTime = process.hrtime.bigint();
    let client: PoolClient;

    this.logger.log(
      `Iniciando búsqueda de productos.`,
      SearchService.name,
      { query_text: query, segment_filter: segment, segment_received: !!segment, segment_value: segment || 'NONE' }
    );

    try {
      this.logger.log(
        `Buscando productos con query original: "${query}"`,
        SearchService.name
      );

      // --- CONEXIÓN A BASE DE DATOS ---
      // Obtiene una conexión del pool con timeout de seguridad
      const clientConnectStart = process.hrtime.bigint();
      client = await Promise.race([
        this.pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 10000))
      ]) as any;
      const clientConnectEnd = process.hrtime.bigint();
      this.logger.debug(
        `Conexión a DB obtenida.`,
        SearchService.name,
        { duration_ms: Number(clientConnectEnd - clientConnectStart) / 1_000_000 }
      );

      const initialSearchStart = process.hrtime.bigint();
      const initialResult = await this.performSemanticSearch(query, limit, client, segment);
      const initialSearchEnd = process.hrtime.bigint();
      this.logger.log(
        `Búsqueda semántica inicial completada. Similitud: ${initialResult.similitud}`,
        SearchService.name,
        {
          duration_ms: Number(initialSearchEnd - initialSearchStart) / 1_000_000,
          query_text: query, 
          similitud_resultado: initialResult.similitud,
          segment_used: segment 
        }
      );

      // --- EVALUACIÓN DE SIMILITUD ---
      // Si la similitud es alta (EXACTO/EQUIVALENTE), retorna sin normalización
      if (["EXACTO", "EQUIVALENTE"].includes(initialResult.similitud)) {
        this.logger.log(`Similitud alta detectada (${initialResult.similitud}), no se requiere normalización.`, SearchService.name);
        const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        this.logger.log(`Búsqueda completada (sin normalización).`, SearchService.name, { duration_ms: totalTime });
        return { 
          ...initialResult, 
          normalizado: null,
          timings: {
            ...(initialResult.timings || {}),
            total_time_ms: totalTime
          }
        };
      }

      // --- NORMALIZACIÓN CON GPT-4o ---
      // Si la similitud es baja, normaliza el query para mejorar la búsqueda
      this.logger.log(`Similitud baja (${initialResult.similitud}), activando normalización de query con GPT-4o.`, SearchService.name);

      const normalizeStart = process.hrtime.bigint();
      const normalizedQuery = await Promise.race([
        this.normalizeQueryWithGPT(query),
        new Promise<string>((resolve) => setTimeout(() => {
          this.logger.warn('GPT query normalization timeout, using original query.', SearchService.name);
          resolve(query);
        }, 30000))
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
        segment,
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
          segment_used_final: segment
        }
      );

      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this.logger.log(
        `Búsqueda de productos finalizada.`,
        SearchService.name,
        { duration_ms: totalTime }
      );

      return {
        ...resultAfterNormalization,
        normalizado: normalizedQuery,
        timings: {
          ...(resultAfterNormalization.timings || {}),
          normalization_time_ms: Number(normalizeEnd - normalizeStart) / 1_000_000,
          total_time_ms: totalTime
        }
      };

    } catch (error) {
      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this.logger.error(
        `Error en búsqueda general.`,
        error.stack,
        SearchService.name,
        { duration_ms: totalTime, error_message: error.message }
      );
      throw new Error(`Error en búsqueda semántica: ${error.message}`);
    } finally {
      if (client) {
        client.release();
        this.logger.debug(`Conexión a DB liberada.`, SearchService.name);
      }
    }
  }

  // Ejecuta la busqueda semantica vectorial y seleccion inteligente
  // Convierte texto a embedding, busca vectores similares en PostgreSQL,
  // aplica boost por segmento de marca y usa GPT-4o para seleccionar el mejor resultado.
  private async performSemanticSearch(
    inputText: string,
    limit: number = 5,
    client: PoolClient,
    segment?: 'premium' | 'standard' | 'economy', 
    originalQueryOverride?: string
  ) {
    const stepStartTime = process.hrtime.bigint();
    
    // Variables para timings
    let embeddingTime = 0;
    let vectorSearchTime = 0;
    let gptSelectionTime = 0;
    
    try {
      this.logger.log(
        `Iniciando performSemanticSearch para: "${inputText}" con segment: ${segment || 'any'}`,
        SearchService.name,
        { segment_param: segment, segment_defined: !!segment }
      );

      // --- GENERACIÓN DE EMBEDDING ---
      // Convierte el texto de búsqueda en vector numérico usando OpenAI
      const embeddingStart = process.hrtime.bigint();
      
      const embeddingParams: any = { 
        model: this.embeddingModel, 
        input: inputText 
      };

      if (this.embeddingModel.includes('text-embedding-3')) {
        embeddingParams.dimensions = this.vectorDimensions;
        this.logger.debug(
          `Configurando embedding con dimensiones específicas: ${this.vectorDimensions}`,
          SearchService.name
        );
      }

      const embeddingResponse = await Promise.race([
        this.openai.embeddings.create(embeddingParams),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OpenAI embedding timeout')), 30000))
      ]) as any;
      
      const embeddingEnd = process.hrtime.bigint();
      embeddingTime = Number(embeddingEnd - embeddingStart) / 1_000_000;
      this.logger.debug(
        `Embedding creado.`,
        SearchService.name,
        {
          duration_ms: Number(embeddingEnd - embeddingStart) / 1_000_000,
          model: this.embeddingModel,
          dimensions_requested: this.vectorDimensions
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

      if (embedding.length !== this.vectorDimensions) {
        this.logger.error(
          `Dimensiones del embedding no coinciden. Esperado: ${this.vectorDimensions}, Recibido: ${embedding.length}`,
          null,
          SearchService.name,
          {
            expected_dimensions: this.vectorDimensions,
            received_dimensions: embedding.length,
            model: this.embeddingModel
          }
        );
        throw new Error(`Vector dimension mismatch: expected ${this.vectorDimensions}, got ${embedding.length}`);
      }

      this.logger.debug(
        `Embedding validado correctamente con ${embedding.length} dimensiones`,
        SearchService.name
      );

      const vectorString = `[${embedding.join(',')}]`;

      // --- CONFIGURACIÓN DE BÚSQUEDA VECTORIAL ---
      // Configura parámetros de pgvector para optimizar velocidad vs precisión
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

      // --- BÚSQUEDA VECTORIAL CON SEGMENTACIÓN POR MARCA ---
      // Busca productos similares y resuelve segmento usando tabla de marcas
      const vectorSearchStart = process.hrtime.bigint();
      const result = await Promise.race([
        client.query(
          `SELECT 
             p.codigo, 
             p.descripcion, 
             p.marca, 
             COALESCE(m.segment, 'standard') as segment,
             p.codfabrica, 
             1 - (p.embedding <=> $1::vector) AS similarity 
           FROM ${this.productTable} p
           LEFT JOIN marcas m ON UPPER(TRIM(p.marca)) = UPPER(TRIM(m.marca))
           ORDER BY p.embedding <=> $1::vector 
           LIMIT $2`,
          [vectorString, limit]
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Vector search timeout')), 25000))
      ]) as any;
      const vectorSearchEnd = process.hrtime.bigint();
      vectorSearchTime = Number(vectorSearchEnd - vectorSearchStart) / 1_000_000;
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
          descripcion: null, 
          similitud: "DISTINTO",
          timings: {
            embedding_time_ms: embeddingTime,
            vector_search_time_ms: vectorSearchTime,
            gpt_selection_time_ms: 0
          }
        };
      }

      // --- SELECCIÓN INTELIGENTE CON GPT-4o ---
      // Usa inteligencia artificial para seleccionar el mejor producto considerando contexto y preferencias
      const gptSelectionStart = process.hrtime.bigint();
      const best = await this.selectBestProductWithGPT(
        originalQueryOverride || inputText,
        result.rows,
        inputText,
        segment,
        limit 
      );
      const gptSelectionEnd = process.hrtime.bigint();
      gptSelectionTime = Number(gptSelectionEnd - gptSelectionStart) / 1_000_000;
      this.logger.log(
        `Selección GPT completada.`,
        SearchService.name,
        {
          duration_ms: Number(gptSelectionEnd - gptSelectionStart) / 1_000_000,
          similitud_seleccionada: best.similitud,
          segment_considered: segment
        }
      );

      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `performSemanticSearch finalizado.`,
        SearchService.name,
        { duration_ms: totalStepTime }
      );
      
      // Agregar timings al resultado
      return {
        ...best,
        timings: {
          embedding_time_ms: embeddingTime,
          vector_search_time_ms: vectorSearchTime,
          gpt_selection_time_ms: gptSelectionTime
        }
      };

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

  // Aplica inteligencia artificial para seleccionar el mejor producto
  // Analiza productos candidatos, aplica boost por segmento de marca,
  // y usa GPT-4o para tomar la decision final considerando contexto y preferencias del usuario.
  private async selectBestProductWithGPT(
    originalQuery: string,
    products: any[],
    normalizedQuery: string,
    segment?: 'premium' | 'standard' | 'economy',
    limit?: number
  ) {
    const stepStartTime = process.hrtime.bigint();
    
    if (!products || products.length === 0) {
      this.logger.warn('No hay productos para procesar con GPT', SearchService.name);
      return { codigo: null, descripcion: null, similitud: "DISTINTO" };
    }

    try {
      this.logger.log(
        `Iniciando selectBestProductWithGPT para: "${originalQuery}" con segment preference: ${segment || 'any'}`,
        SearchService.name,
        { productos_disponibles: products.length, segment_param_received: segment, segment_type: typeof segment }
      );

      const productsForGPT = products.map((product, index) => {
        const cleanText = (product.descripcion || '').trim();
        const productCode = (product.codigo || '').trim();
        const productMarca = (product.marca || 'N/A').trim();
        const productSegment = (product.segment || 'standard').trim();
        const productCodFabrica = (product.codfabrica || '').trim();

        return {
          index: index + 1,
          codigo: productCode,
          text: cleanText,
          marca: productMarca,
          segment: productSegment,
          codfabrica: productCodFabrica,
          vectorSimilarity: Number(product.similarity || 0).toFixed(4),
          adjustedSimilarity: undefined as string | undefined,
          segmentBoost: undefined as string | undefined
        };
      });

      // --- SISTEMA DE BOOST POR SEGMENTO ---
      // Aplica multiplicadores de similaridad según preferencia de segmento (premium, standard, economy)
      if (segment) {
        this.logger.log(`APLICANDO BOOST PARA SEGMENTO: ${segment}`, SearchService.name);
        
        productsForGPT.forEach(product => {
          let segmentMultiplier = 1.0;
          if (product.segment === segment) {
            segmentMultiplier = 2.0; // Boost multiplicativo del 100% para segmento preferido
          } else if (
            (segment === 'premium' && product.segment === 'standard') ||
            (segment === 'economy' && product.segment === 'standard') ||
            (segment === 'standard' && (product.segment === 'premium' || product.segment === 'economy'))
          ) {
            segmentMultiplier = 1.2; // Boost del 20% para segmentos compatibles
          }
          
          const originalSimilarity = parseFloat(product.vectorSimilarity);
          const boostedSimilarity = Math.min(1.0, originalSimilarity * segmentMultiplier);
          product.adjustedSimilarity = boostedSimilarity.toFixed(4);
          product.segmentBoost = ((segmentMultiplier - 1.0) * 100).toFixed(1) + '%';
          
          this.logger.log(
            `BOOST APLICADO: ${product.marca} (${product.segment}) - Original: ${originalSimilarity} -> Boosted: ${boostedSimilarity} (x${segmentMultiplier})`,
            SearchService.name
          );
        });

        // Reordenar productos por similaridad ajustada
        productsForGPT.sort((a, b) => {
          const aScore = parseFloat(a.adjustedSimilarity || a.vectorSimilarity);
          const bScore = parseFloat(b.adjustedSimilarity || b.vectorSimilarity);
          return bScore - aScore;
        });
      }

      // Preparar candidatos
      const candidatos = {};
      const maxCandidatos = limit || 5;
      
      for (let i = 0; i < Math.min(products.length, maxCandidatos); i++) {
        const candidateIndex = i + 1;
        candidatos[`CA${candidateIndex}`] = products[i].codigo || '';
        candidatos[`DA${candidateIndex}`] = products[i].descripcion || '';
      }

      let segmentInstructions = '';
      if (segment) {
        segmentInstructions = `
IMPORTANTE - PREFERENCIA DE SEGMENTO:
El usuario solicitó específicamente productos del segmento '${segment}'. 
Orden de preferencia:
${segment === 'premium' ? '1. premium (+100% boost) 2. standard (+20% boost) 3. economy (sin boost)' : 
  segment === 'standard' ? '1. standard (+100% boost) 2. premium/economy (+20% boost)' : 
  '1. economy (+100% boost) 2. standard (+20% boost) 3. premium (sin boost)'}

IMPORTANTE: Considera las puntuaciones ADJUSTED_SIMILARITY - ya incluyen la preferencia de segmento.`;
      }

      const productList = productsForGPT.map(p => {
        const similarityDisplay = segment && p.adjustedSimilarity 
          ? `SIMILARITY: ${p.vectorSimilarity} | ADJUSTED_SIMILARITY: ${p.adjustedSimilarity} (boost: +${p.segmentBoost || '0.000'})`
          : `SIMILARITY: ${p.vectorSimilarity}`;
        
        return `${p.index}. CODE: ${p.codigo} | DESCRIPTION: "${p.text}" | BRAND: ${p.marca} | SEGMENT: ${p.segment} | FACTORY_CODE: ${p.codfabrica} | ${similarityDisplay}`;
      }).join('\n');

      const prompt = `Analiza los productos y selecciona el mejor match para la búsqueda del usuario.

CONSULTA DEL USUARIO: "${originalQuery}"

PRODUCTOS DISPONIBLES:
${productList}

${segmentInstructions}

ESCALA DE SIMILITUD:
- EXACTO: Es exactamente lo que busca el usuario
- EQUIVALENTE: Cumple la misma función con especificaciones similares
- COMPATIBLE: Funciona para el mismo propósito
- ALTERNATIVO: Puede servir pero con diferencias
- DISTINTO: No es lo que busca

INSTRUCCIONES:
1. Analiza cada producto considerando: marca, modelo, características, código de fábrica
2. Selecciona SOLO UN producto (el mejor match)
3. Si se especificó preferencia de segmento, PRIORIZA las puntuaciones ADJUSTED_SIMILARITY
4. Las puntuaciones ajustadas ya incluyen la preferencia de segmento
5. Responde ÚNICAMENTE con JSON válido:

{
  "selectedIndex": 1,
  "similitud": "EXACTO",
  "razon": "Explicación breve en español"
}`;

      this.logger.debug(
        `Enviando prompt a GPT`,
        SearchService.name,
        { 
          prompt_length: prompt.length,
          productos_procesados: productsForGPT.length,
          segment_preference: segment 
        }
      );

      // --- LLAMADA A GPT-4o PARA DECISIÓN FINAL ---
      // Envía productos y contexto a GPT-4o para selección inteligente con razonamiento en español
      const gptCallStart = process.hrtime.bigint();
      let gptResponse;
      
      try {
        gptResponse = await Promise.race([
          this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: "Eres un experto en análisis de productos industriales. SIEMPRE respondes con JSON válido y nada más. Tus explicaciones deben ser en español."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.1,
            max_tokens: 200,
            response_format: { type: "json_object" }
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('GPT selection timeout after 15s')), 15000)
          )
        ]) as any;
      } catch (openaiError) {
        this.logger.error(
          `Error en llamada a OpenAI API`,
          openaiError.stack,
          SearchService.name,
          { 
            error_type: openaiError.constructor.name,
            error_code: openaiError.code,
            error_status: openaiError.status 
          }
        );
        throw new Error(`OpenAI API Error: ${openaiError.message}`);
      }

      const gptCallEnd = process.hrtime.bigint();
      this.logger.debug(
        `Llamada a GPT completada exitosamente.`,
        SearchService.name,
        {
          duration_ms: Number(gptCallEnd - gptCallStart) / 1_000_000,
          model: "gpt-4o",
          tokens_used: gptResponse.usage?.total_tokens || 0
        }
      );

      const gptContent = gptResponse.choices[0]?.message?.content?.trim();
      this.logger.debug(
        `Respuesta GPT recibida`,
        SearchService.name,
        { 
          content_length: gptContent?.length || 0,
          raw_content: gptContent?.substring(0, 200) + (gptContent?.length > 200 ? '...' : '')
        }
      );

      if (!gptContent) {
        throw new Error('GPT devolvió contenido vacío');
      }

      // --- PROCESAMIENTO DE RESPUESTA GPT ---
      // Valida y procesa la respuesta JSON de GPT-4o con manejo robusto de errores
      let gptDecision;
      try {
        gptDecision = JSON.parse(gptContent);
        
        if (!gptDecision.selectedIndex || !gptDecision.similitud) {
          throw new Error('JSON response missing required fields');
        }
        
        const index = parseInt(gptDecision.selectedIndex);
        if (isNaN(index) || index < 1 || index > productsForGPT.length) {
          throw new Error(`Invalid selectedIndex: ${gptDecision.selectedIndex}`);
        }
        
        const validSimilitudes = ['EXACTO', 'EQUIVALENTE', 'COMPATIBLE', 'ALTERNATIVO', 'DISTINTO'];
        if (!validSimilitudes.includes(gptDecision.similitud)) {
          this.logger.warn(`Invalid similitud value: ${gptDecision.similitud}, using ALTERNATIVO`, SearchService.name);
          gptDecision.similitud = 'ALTERNATIVO';
        }
        
      } catch (parseError) {
        this.logger.error(
          `Error parsing GPT JSON response`,
          parseError.stack,
          SearchService.name,
          { 
            raw_response: gptContent,
            parse_error: parseError.message 
          }
        );
        
        gptDecision = {
          selectedIndex: 1,
          similitud: "ALTERNATIVO",
          razon: `Error parsing GPT response, using highest similarity product. Parse error: ${parseError.message}`
        };
      }

      const selectedProduct = productsForGPT[gptDecision.selectedIndex - 1];

      if (!selectedProduct) {
        throw new Error(`Selected product not found at index ${gptDecision.selectedIndex}`);
      }

      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `selectBestProductWithGPT completado exitosamente.`,
        SearchService.name,
        {
          duration_ms: totalStepTime,
          selected_similitud: gptDecision.similitud,
          selected_index: gptDecision.selectedIndex,
          selected_codigo: selectedProduct.codigo,
          selected_brand: selectedProduct.marca,
          selected_segment: selectedProduct.segment
        }
      );

      return {
        codigo: selectedProduct.codigo,
        descripcion: selectedProduct.text,
        similitud: gptDecision.similitud,
        razon: gptDecision.razon || 'Selected by GPT',
        marca: selectedProduct.marca,
        segment: selectedProduct.segment,
        ...candidatos
      };

    } catch (error) {
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      
      this.logger.error(
        `Error crítico en selectBestProductWithGPT`,
        error.stack,
        SearchService.name,
        { 
          duration_ms: totalStepTime, 
          error_message: error.message,
          error_type: error.constructor.name,
          original_query: originalQuery,
          products_count: products.length
        }
      );

      // --- SISTEMA DE FALLBACK ROBUSTO ---
      // En caso de error, selecciona el producto con mayor similaridad como respaldo
      try {
        const firstProduct = products[0];
        const cleanText = (firstProduct.descripcion || '').trim();
        const productCode = (firstProduct.codigo || '').trim();
        const productMarca = (firstProduct.marca || 'N/A').trim();
        const productSegment = (firstProduct.segment || 'standard').trim();

        const candidatos = {};
        const maxCandidatos = limit || 5;
        
        for (let i = 0; i < Math.min(products.length, maxCandidatos); i++) {
          const candidateIndex = i + 1;
          candidatos[`CA${candidateIndex}`] = products[i].codigo || '';
          candidatos[`DA${candidateIndex}`] = products[i].descripcion || '';
        }

        this.logger.log(
          `Usando fallback: primer producto disponible`,
          SearchService.name,
          { 
            fallback_codigo: productCode,
            fallback_marca: productMarca,
            fallback_segment: productSegment 
          }
        );

        return {
          codigo: productCode,
          descripcion: cleanText,
          similitud: "ALTERNATIVO",
          razon: `Fallback after GPT error: ${error.message}`,
          marca: productMarca,
          segment: productSegment,
          ...candidatos
        };
      } catch (fallbackError) {
        this.logger.error(
          `Error crítico en fallback`,
          fallbackError.stack,
          SearchService.name
        );
        
        return {
          codigo: null,
          descripcion: null,
          similitud: "DISTINTO",
          razon: `Critical error in product selection: ${error.message}`,
          marca: null,
          segment: 'standard'
        };
      }
    }
  }

  // Normaliza queries de usuario usando GPT-4o para mejorar busquedas
  // Corrige errores ortograficos, expande abreviaciones y mejora la especificidad
  // del texto de busqueda para obtener mejores resultados vectoriales.
  private async normalizeQueryWithGPT(query: string): Promise<string> {
    const stepStartTime = process.hrtime.bigint();
    try {
      this.logger.log(
        `Iniciando normalización de query con GPT-4o para: "${query}"`,
        SearchService.name
      );

      const gptNormalizationCallStart = process.hrtime.bigint();
      const response = await Promise.race([
        this.openai.chat.completions.create({
          model: "gpt-4o",
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
          temperature: 0.2,
          max_tokens: 100
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GPT normalization timeout')), 25000))
      ]) as any;
      const gptNormalizationCallEnd = process.hrtime.bigint();
      this.logger.debug(
        `Llamada a GPT para normalización completada.`,
        SearchService.name,
        {
          duration_ms: Number(gptNormalizationCallEnd - gptNormalizationCallStart) / 1_000_000,
          model: "gpt-4o",
          tokens_used: response.usage?.total_tokens
        }
      );

      let normalized = response.choices[0].message.content?.trim();

      if (normalized && (normalized.startsWith('"') && normalized.endsWith('"'))) {
        normalized = normalized.slice(1, -1);
      }
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
      return query;
    }
  }

  async onModuleDestroy() {
    this.logger.log(`Cerrando pool de conexiones de PostgreSQL en SearchService.`, SearchService.name);
    await this.pool.end();
  }
}