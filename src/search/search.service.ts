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
import { AcronimosService } from '../acronimos/acronimos.service';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';

@Injectable()
export class SearchService implements OnModuleDestroy {
  private pool: Pool;
  private openai: OpenAI;

  private readonly probes: number;
  private readonly embeddingModel: string;
  private readonly productTable: string;
  private readonly vectorDimensions: number;
  
  // Configuración de pesos para boost system
  private readonly boostWeights: {
    segmentPreferred: number;
    segmentCompatible: number;
    stock: number;
    costAgreement: number;
    brandExact: number;
    modelExact: number;
    sizeExact: number;
  };
  
  // Configuración de thresholds para clasificación de similitud
  private readonly similarityThresholds: {
    exacto: number;
    equivalente: number;
    compatible: number;
    alternativo: number;
  };

  constructor(
    private configService: ConfigService,
    private readonly logger: Logger,
    private readonly acronimosService: AcronimosService,
    private readonly rateLimiter: OpenAIRateLimiterService,
  ) {
    // Configuración optimizada del pool de conexiones
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      max: 20, // Máximo 20 conexiones
      idleTimeoutMillis: 30000, // 30 segundos
      connectionTimeoutMillis: 10000, // 10 segundos timeout para conexión
      statement_timeout: 30000, // 30 segundos timeout para queries
      query_timeout: 30000, // 30 segundos timeout para queries
      // Configuración SSL para producción
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true, // Validar certificados SSL
        ca: this.configService.get<string>('DB_CA_CERT'), // Certificado CA
        cert: this.configService.get<string>('DB_CLIENT_CERT'), // Certificado cliente
        key: this.configService.get<string>('DB_CLIENT_KEY') // Clave privada cliente
      } : false,
    });

    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      timeout: 45000, // 45 segundos timeout para OpenAI
      maxRetries: 2, // Máximo 2 reintentos
    });

    this.probes = parseInt(this.configService.get<string>('PGVECTOR_PROBES') || '1', 10);
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL') || 'text-embedding-3-large';
    this.productTable = this.configService.get<string>('PRODUCT_TABLE') || 'productos_bip';
    
    this.vectorDimensions = parseInt(
      this.configService.get<string>('VECTOR_DIMENSIONS') || '1024', 
      10
    );

    // Configurar pesos de boost desde variables de entorno
    this.boostWeights = {
      segmentPreferred: parseFloat(this.configService.get<string>('BOOST_SEGMENT_PREFERRED') || '1.30'),
      segmentCompatible: parseFloat(this.configService.get<string>('BOOST_SEGMENT_COMPATIBLE') || '1.20'),
      stock: parseFloat(this.configService.get<string>('BOOST_STOCK') || '1.25'),
      costAgreement: parseFloat(this.configService.get<string>('BOOST_COST_AGREEMENT') || '1.15'),
      brandExact: parseFloat(this.configService.get<string>('BOOST_BRAND_EXACT') || '1.20'),
      modelExact: parseFloat(this.configService.get<string>('BOOST_MODEL_EXACT') || '1.15'),
      sizeExact: parseFloat(this.configService.get<string>('BOOST_SIZE_EXACT') || '1.10')
    };

    // Configurar thresholds de similitud desde variables de entorno
    this.similarityThresholds = {
      exacto: parseFloat(this.configService.get<string>('SIMILARITY_EXACTO_THRESHOLD') || '0.98'),
      equivalente: parseFloat(this.configService.get<string>('SIMILARITY_EQUIVALENTE_THRESHOLD') || '0.94'),
      compatible: parseFloat(this.configService.get<string>('SIMILARITY_COMPATIBLE_THRESHOLD') || '0.88'),
      alternativo: parseFloat(this.configService.get<string>('SIMILARITY_ALTERNATIVO_THRESHOLD') || '0.82')
    };

    this.logger.log(
      `SearchService initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}, dimensions=${this.vectorDimensions}`,
      SearchService.name
    );
    
    this.logger.log(
      `Boost weights: Segment preferred=${this.boostWeights.segmentPreferred}, compatible=${this.boostWeights.segmentCompatible}, stock=${this.boostWeights.stock}, cost=${this.boostWeights.costAgreement}, brand=${this.boostWeights.brandExact}, model=${this.boostWeights.modelExact}`,
      SearchService.name
    );
    
    this.logger.log(
      `Similarity thresholds: Exacto>=${this.similarityThresholds.exacto}, Equivalente>=${this.similarityThresholds.equivalente}, Compatible>=${this.similarityThresholds.compatible}, Alternativo>=${this.similarityThresholds.alternativo}`,
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

      // --- EXPANSIÓN CONTEXTUAL DE ACRÓNIMOS ---
      // Expande acrónimos en la query del usuario para mejorar la búsqueda
      const expandedQuery = await this.acronimosService.translateText(query);
      if (expandedQuery !== query) {
        this.logger.log(
          `Query expandida con acrónimos: "${query}" → "${expandedQuery}"`,
          SearchService.name
        );
      }

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
      const initialResult = await this.performSemanticSearch(expandedQuery, limit, client, segment, query);
      const initialSearchEnd = process.hrtime.bigint();
      this.logger.log(
        `Búsqueda semántica inicial completada. Similitud: ${initialResult.query_info.similitud}`,
        SearchService.name,
        {
          duration_ms: Number(initialSearchEnd - initialSearchStart) / 1_000_000,
          query_text: query, 
          similitud_resultado: initialResult.query_info.similitud,
          segment_used: segment 
        }
      );

      // --- EVALUACIÓN DE SIMILITUD INICIAL ---
      // Si la similitud es alta (EXACTO/EQUIVALENTE), proceder sin normalización
      if (["EXACTO", "EQUIVALENTE"].includes(initialResult.query_info.similitud)) {
        this.logger.log(`Similitud alta detectada (${initialResult.query_info.similitud}), procediendo a validación final.`, SearchService.name);
        
        // Preparar resultado para validación final
        const resultToValidate = {
          ...initialResult,
          normalizado: null
        };
        
        // Ir directamente a validación GPT final
        return await this.performFinalGPTValidation(query, resultToValidate, startTime);
      }

      // --- NORMALIZACIÓN CON GPT-4o ---
      // Si la similitud es baja, normaliza el query para mejorar la búsqueda
      this.logger.log(`Similitud baja (${initialResult.query_info.similitud}), activando normalización de query con GPT-4o.`, SearchService.name);

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

      // Expandir query normalizada también
      const expandedNormalizedQuery = await this.acronimosService.translateText(normalizedQuery);
      if (expandedNormalizedQuery !== normalizedQuery) {
        this.logger.log(
          `Query normalizada expandida: "${normalizedQuery}" → "${expandedNormalizedQuery}"`,
          SearchService.name
        );
      }

      const resultAfterNormalizationStart = process.hrtime.bigint();
      const resultAfterNormalization = await this.performSemanticSearch(
        expandedNormalizedQuery,
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
          similitud_resultado: resultAfterNormalization.query_info.similitud,
          segment_used_final: segment
        }
      );

      // --- EVALUACIÓN DESPUÉS DE NORMALIZACIÓN ---
      // Preparar resultado con normalización para validación final
      const resultToValidate = {
        ...resultAfterNormalization,
        normalizado: normalizedQuery,
        timings: {
          ...(resultAfterNormalization.timings || {}),
          normalization_time_ms: Number(normalizeEnd - normalizeStart) / 1_000_000
        }
      };
      
      // SIEMPRE ir a validación GPT final, sin importar el threshold
      return await this.performFinalGPTValidation(query, resultToValidate, startTime);

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

      const embeddingResponse = await this.rateLimiter.executeEmbedding(
        () => this.openai.embeddings.create(embeddingParams),
        `search-embedding-${Date.now()}`
      );
      
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
             p.codigo_fabrica, 
             p.articulo_stock,
             p.lista_costos,
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
          query_info: {
            similitud: "DISTINTO",
            total_candidates: 0,
            search_time_ms: Math.round((embeddingTime + vectorSearchTime))
          },
          selected_product: {
            codigo: null,
            descripcion: null,
            marca: null,
            segment: 'standard',
            has_stock: false,
            has_cost_agreement: false,
            boost_total_percent: 0,
            boost_reasons: []
          },
          alternatives: [],
          boost_summary: {
            products_with_stock: [],
            products_with_pricing: [],
            segment_matches: [],
            boost_weights_used: this.boostWeights
          },
          timings: {
            embedding_time_ms: embeddingTime,
            vector_search_time_ms: vectorSearchTime,
            gpt_selection_time_ms: 0
          }
        };
      }

      // --- SELECCIÓN HÍBRIDA INTELIGENTE ---
      // Usa boost system + desempate automático + GPT solo cuando es necesario
      const gptSelectionStart = process.hrtime.bigint();
      const best = await this.selectBestProductHybrid(
        originalQueryOverride || inputText,
        result.rows,
        inputText,
        segment,
        limit 
      );
      const gptSelectionEnd = process.hrtime.bigint();
      gptSelectionTime = Number(gptSelectionEnd - gptSelectionStart) / 1_000_000;
      this.logger.log(
        `Selección híbrida completada.`,
        SearchService.name,
        {
          duration_ms: Number(gptSelectionEnd - gptSelectionStart) / 1_000_000,
          similitud_seleccionada: best.query_info.similitud,
          segment_considered: segment,
          selection_method: best.selection_method || 'hybrid'
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

  // Clasifica la similitud basada en thresholds configurables
  // Método profesional y escalable para 1M+ productos/mes
  private classifySimilarityByThreshold(adjustedSimilarity: number): string {
    if (adjustedSimilarity >= this.similarityThresholds.exacto) {
      return "EXACTO";
    }
    if (adjustedSimilarity >= this.similarityThresholds.equivalente) {
      return "EQUIVALENTE";
    }
    if (adjustedSimilarity >= this.similarityThresholds.compatible) {
      return "COMPATIBLE";
    }
    if (adjustedSimilarity >= this.similarityThresholds.alternativo) {
      return "ALTERNATIVO";
    }
    return "DISTINTO";
  }

  // Helper para crear boost summary vacío
  private createEmptyBoostSummary() {
    return {
      segment_boosted: [],
      stock_boosted: [],
      cost_agreement_boosted: [],
      total_candidates: 0,
      boost_weights_used: {
        segment_preferred: this.boostWeights.segmentPreferred,
        segment_compatible: this.boostWeights.segmentCompatible,
        stock: this.boostWeights.stock,
        cost_agreement: this.boostWeights.costAgreement
      }
    };
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
      return {
        query_info: {
          similitud: "DISTINTO",
          total_candidates: 0,
          search_time_ms: 0
        },
        selected_product: {
          codigo: null,
          descripcion: null,
          marca: null,
          segment: 'standard',
          has_stock: false,
          has_cost_agreement: false,
          boost_total_percent: 0,
          boost_reasons: []
        },
        alternatives: [],
        boost_summary: {
          products_with_stock: [],
          products_with_pricing: [],
          segment_matches: [],
          boost_weights_used: this.boostWeights
        },
        timings: {
          embedding_time_ms: 0,
          vector_search_time_ms: 0,
          gpt_selection_time_ms: 0
        }
      };
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
        const productCodFabrica = (product.codigo_fabrica || '').trim();
        const hasStock = Boolean(product.articulo_stock);
        const hasCostAgreement = Boolean(product.lista_costos);

        return {
          index: index + 1,
          codigo: productCode,
          text: cleanText,
          marca: productMarca,
          segment: productSegment,
          codigo_fabrica: productCodFabrica,
          articulo_stock: hasStock,
          lista_costos: hasCostAgreement,
          vectorSimilarity: Number(product.similarity || 0).toFixed(4),
          adjustedSimilarity: undefined as string | undefined,
          boostInfo: {
            segment: { applied: false, percentage: 0 },
            stock: { applied: false, percentage: 0 },
            cost_agreement: { applied: false, percentage: 0 },
            brand_exact: { applied: false, percentage: 0 },
            model_exact: { applied: false, percentage: 0 },
            size_exact: { applied: false, percentage: 0 },
            total_boost: 0
          }
        };
      });

      // --- SISTEMA DE BOOST INTEGRAL ---
      // Aplica multiplicadores de similaridad por segmento, stock y acuerdos de costos
      this.logger.log(`APLICANDO BOOST INTEGRAL - Segmento: ${segment || 'none'}`, SearchService.name);
      
      productsForGPT.forEach(product => {
        let totalMultiplier = 1.0;
        
        // 1. BOOST POR SEGMENTO
        let segmentMultiplier = 1.0;
        if (segment) {
          if (product.segment === segment) {
            segmentMultiplier = this.boostWeights.segmentPreferred;
            product.boostInfo.segment.applied = true;
            product.boostInfo.segment.percentage = Math.round((segmentMultiplier - 1.0) * 100);
          } else if (
            (segment === 'premium' && product.segment === 'standard') ||
            (segment === 'economy' && product.segment === 'standard') ||
            (segment === 'standard' && (product.segment === 'premium' || product.segment === 'economy'))
          ) {
            segmentMultiplier = this.boostWeights.segmentCompatible;
            product.boostInfo.segment.applied = true;
            product.boostInfo.segment.percentage = Math.round((segmentMultiplier - 1.0) * 100);
          }
        }
        
        // 2. BOOST POR STOCK (productos de alta rotación)
        let stockMultiplier = 1.0;
        if (product.articulo_stock) {
          stockMultiplier = this.boostWeights.stock;
          product.boostInfo.stock.applied = true;
          product.boostInfo.stock.percentage = Math.round((stockMultiplier - 1.0) * 100);
        }
        
        // 3. BOOST POR ACUERDOS DE COSTOS (proveedores preferenciales)
        let costMultiplier = 1.0;
        if (product.lista_costos) {
          costMultiplier = this.boostWeights.costAgreement;
          product.boostInfo.cost_agreement.applied = true;
          product.boostInfo.cost_agreement.percentage = Math.round((costMultiplier - 1.0) * 100);
        }
        
        // 4. BOOST POR MARCA EXACTA (cuando se menciona marca específica)
        let brandMultiplier = 1.0;
        if (product.marca && this.queryMentionsBrand(originalQuery, product.marca)) {
          brandMultiplier = this.boostWeights.brandExact;
          product.boostInfo.brand_exact.applied = true;
          product.boostInfo.brand_exact.percentage = Math.round((brandMultiplier - 1.0) * 100);
        }
        
        // 5. BOOST POR MODELO EXACTO (cuando se menciona código de fábrica específico)
        let modelMultiplier = 1.0;
        if (product.codigo_fabrica && this.queryMentionsModel(originalQuery, product.codigo_fabrica)) {
          modelMultiplier = this.boostWeights.modelExact;
          product.boostInfo.model_exact.applied = true;
          product.boostInfo.model_exact.percentage = Math.round((modelMultiplier - 1.0) * 100);
        }
        
        // Calcular multiplicador total y aplicar
        totalMultiplier = segmentMultiplier * stockMultiplier * costMultiplier * brandMultiplier * modelMultiplier;
        product.boostInfo.total_boost = Math.round((totalMultiplier - 1.0) * 100);
        
        const originalSimilarity = parseFloat(product.vectorSimilarity);
        const boostedSimilarity = Math.min(1.0, originalSimilarity * totalMultiplier);
        product.adjustedSimilarity = boostedSimilarity.toFixed(4);
        
        // Log solo si hay boost aplicado
        if (totalMultiplier > 1.0) {
          const boostDetails = [];
          if (product.boostInfo.segment.applied) boostDetails.push(`Segmento: +${product.boostInfo.segment.percentage}%`);
          if (product.boostInfo.stock.applied) boostDetails.push(`Stock: +${product.boostInfo.stock.percentage}%`);
          if (product.boostInfo.cost_agreement.applied) boostDetails.push(`Costos: +${product.boostInfo.cost_agreement.percentage}%`);
          if (product.boostInfo.brand_exact.applied) boostDetails.push(`Marca: +${product.boostInfo.brand_exact.percentage}%`);
          if (product.boostInfo.model_exact.applied) boostDetails.push(`Modelo: +${product.boostInfo.model_exact.percentage}%`);
          
          this.logger.log(
            `BOOST ${product.codigo}: ${originalSimilarity} -> ${boostedSimilarity} (${boostDetails.join(', ')}) Total: +${product.boostInfo.total_boost}%`,
            SearchService.name
          );
        }
      });

      // Reordenar productos por similaridad ajustada
      productsForGPT.sort((a, b) => {
        const aScore = parseFloat(a.adjustedSimilarity || a.vectorSimilarity);
        const bScore = parseFloat(b.adjustedSimilarity || b.vectorSimilarity);
        return bScore - aScore;
      });

      // Recopilar información de boost por tipo para todos los candidatos
      const boostSummary = {
        segment_boosted: productsForGPT.filter(p => p.boostInfo.segment.applied).map(p => p.codigo),
        stock_boosted: productsForGPT.filter(p => p.boostInfo.stock.applied).map(p => p.codigo),
        cost_agreement_boosted: productsForGPT.filter(p => p.boostInfo.cost_agreement.applied).map(p => p.codigo),
        total_candidates: productsForGPT.length,
        boost_weights_used: {
          segment_preferred: this.boostWeights.segmentPreferred,
          segment_compatible: this.boostWeights.segmentCompatible,
          stock: this.boostWeights.stock,
          cost_agreement: this.boostWeights.costAgreement
        }
      };

      // Preparar candidatos
      const candidatos = {};
      const maxCandidatos = limit || 5;
      
      for (let i = 0; i < Math.min(products.length, maxCandidatos); i++) {
        const candidateIndex = i + 1;
        candidatos[`CA${candidateIndex}`] = products[i].codigo || '';
        candidatos[`DA${candidateIndex}`] = products[i].descripcion || '';
      }

      let boostInstructions = '';
      if (segment || productsForGPT.some(p => p.boostInfo.total_boost > 0)) {
        const segmentPreferredPct = Math.round((this.boostWeights.segmentPreferred - 1.0) * 100);
        const segmentCompatiblePct = Math.round((this.boostWeights.segmentCompatible - 1.0) * 100);
        const stockPct = Math.round((this.boostWeights.stock - 1.0) * 100);
        const costPct = Math.round((this.boostWeights.costAgreement - 1.0) * 100);
        
        boostInstructions = `
SISTEMA DE BOOST APLICADO:
- Segmento preferido: +${segmentPreferredPct}% | Segmento compatible: +${segmentCompatiblePct}%
- Productos en stock (alta rotación): +${stockPct}%
- Acuerdos con proveedores: +${costPct}%
- Los boosts se multiplican entre sí

${segment ? `PREFERENCIA DE SEGMENTO SOLICITADA: '${segment}'` : ''}
IMPORTANTE: Considera las puntuaciones ADJUSTED - ya incluyen todos los boosts aplicados.`;
      }

      const productList = productsForGPT.map(p => {
        // Construir información de boost
        const boostDetails = [];
        if (p.boostInfo.segment.applied) boostDetails.push(`SEG:+${p.boostInfo.segment.percentage}%`);
        if (p.boostInfo.stock.applied) boostDetails.push(`STOCK:+${p.boostInfo.stock.percentage}%`);
        if (p.boostInfo.cost_agreement.applied) boostDetails.push(`COST:+${p.boostInfo.cost_agreement.percentage}%`);
        if (p.boostInfo.brand_exact.applied) boostDetails.push(`BRAND:+${p.boostInfo.brand_exact.percentage}%`);
        if (p.boostInfo.model_exact.applied) boostDetails.push(`MODEL:+${p.boostInfo.model_exact.percentage}%`);
        
        const similarityDisplay = p.adjustedSimilarity 
          ? `SIMILARITY: ${p.vectorSimilarity} | ADJUSTED: ${p.adjustedSimilarity}${boostDetails.length > 0 ? ` (${boostDetails.join(',')})` : ''}`
          : `SIMILARITY: ${p.vectorSimilarity}`;
        
        const stockIndicator = p.articulo_stock ? '[STOCK]' : '';
        const costIndicator = p.lista_costos ? '[ACUERDO]' : '';
        
        return `${p.index}. CODE: ${p.codigo} | DESCRIPTION: "${p.text}" | BRAND: ${p.marca} | SEGMENT: ${p.segment} | FACTORY_CODE: ${p.codigo_fabrica} ${stockIndicator}${costIndicator} | ${similarityDisplay}`;
      }).join('\n');

      const prompt = `Analiza los productos y selecciona el mejor match para la búsqueda del usuario.

CONSULTA DEL USUARIO: "${originalQuery}"

PRODUCTOS DISPONIBLES:
${productList}

${boostInstructions}

ESCALA DE SIMILITUD:
- EXACTO: Es exactamente lo que busca el usuario incluyendo misma marca y modelo
- EQUIVALENTE: Cumple exactamente la misma función principal, aunque tenga diferente nombre, marca o especificaciones (ej: "lapicero"="bolígrafo"="pluma", "taladro"="drill", "pintura"="pintura latex")
- COMPATIBLE: Funciona para el mismo propósito con diferencias menores de especificación
- ALTERNATIVO: Puede servir pero con diferencias significativas en función o especificación
- DISTINTO: No cumple la función que busca el usuario

INSTRUCCIONES:
1. PRIORIZA LA FUNCIÓN sobre el nombre exacto: "lapicero azul" incluye bolígrafos, plumas, marcadores de escritura azules
2. Analiza cada producto considerando: función principal, marca, modelo, características, código de fábrica
3. Selecciona SOLO UN producto (el mejor match)
4. PRIORIZA las puntuaciones ADJUSTED - ya incluyen todos los boosts (segmento, stock, acuerdos)
5. Si se especificó marca o modelo específico, PRIORIZALO
6. Productos [STOCK] tienen alta rotación, productos [ACUERDO] tienen condiciones preferenciales
7. Responde ÚNICAMENTE con JSON válido:

{
  "selectedIndex": 1,
  "similitud": "EXACTO",
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
        gptResponse = await this.rateLimiter.executeChat(
          () => this.openai.chat.completions.create({
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
          `gpt-selection-${Date.now()}`
        );
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

      // Construir lista de alternativas en formato plano
      const alternatives = productsForGPT.map((product, index) => {
        const boostTags = [];
        if (product.boostInfo.stock.applied) boostTags.push('stock');
        if (product.boostInfo.cost_agreement.applied) boostTags.push('cost');
        if (product.boostInfo.segment.applied) boostTags.push('segment');
        if (product.boostInfo.brand_exact.applied) boostTags.push('brand');
        if (product.boostInfo.model_exact.applied) boostTags.push('model');
        
        return {
          codigo: product.codigo,
          descripcion: product.text,
          marca: product.marca,
          rank: index + 1,
          has_stock: product.articulo_stock,
          has_cost_agreement: product.lista_costos,
          segment: product.segment,
          boost_percent: product.boostInfo.total_boost,
          boost_tags: boostTags
        };
      });

      // Construir boost summary con nombres más claros
      const enhancedBoostSummary = {
        products_with_stock: boostSummary.stock_boosted,
        products_with_pricing: boostSummary.cost_agreement_boosted,
        segment_matches: boostSummary.segment_boosted,
        boost_weights_used: boostSummary.boost_weights_used
      };

      // Construir respuesta en formato plano y consumible
      return {
        query_info: {
          similitud: gptDecision.similitud,
          total_candidates: productsForGPT.length,
          search_time_ms: Math.round(Number(process.hrtime.bigint() - stepStartTime) / 1_000_000)
        },
        selected_product: {
          codigo: selectedProduct.codigo,
          descripcion: selectedProduct.text,
          marca: selectedProduct.marca,
          segment: selectedProduct.segment,
          has_stock: selectedProduct.articulo_stock,
          has_cost_agreement: selectedProduct.lista_costos,
          boost_total_percent: selectedProduct.boostInfo.total_boost,
          boost_reasons: alternatives[0].boost_tags
        },
        alternatives: alternatives,
        boost_summary: enhancedBoostSummary,
        // Mantener compatibilidad con versión anterior
        timings: {
          embedding_time_ms: 0,
          vector_search_time_ms: 0,
          gpt_selection_time_ms: Number(process.hrtime.bigint() - stepStartTime) / 1_000_000
        }
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

        // Construir alternativas de fallback
        const fallbackAlternatives = products.slice(0, Math.min(products.length, limit || 5)).map((product, index) => ({
          codigo: product.codigo || '',
          descripcion: product.descripcion || '',
          marca: product.marca || 'N/A',
          rank: index + 1,
          has_stock: Boolean(product.articulo_stock),
          has_cost_agreement: Boolean(product.lista_costos),
          segment: product.segment || 'standard',
          boost_percent: 0,
          boost_tags: []
        }));

        return {
          query_info: {
            similitud: "ALTERNATIVO",
            total_candidates: products.length,
            search_time_ms: Math.round(totalStepTime)
          },
          selected_product: {
            codigo: productCode,
            descripcion: cleanText,
            marca: productMarca,
            segment: productSegment,
            has_stock: Boolean(products[0].articulo_stock),
            has_cost_agreement: Boolean(products[0].lista_costos),
            boost_total_percent: 0,
            boost_reasons: []
          },
          alternatives: fallbackAlternatives,
          boost_summary: {
            products_with_stock: [],
            products_with_pricing: [],
            segment_matches: [],
            boost_weights_used: this.boostWeights
          },
          timings: {
            embedding_time_ms: 0,
            vector_search_time_ms: 0,
            gpt_selection_time_ms: totalStepTime
          }
        };
      } catch (fallbackError) {
        this.logger.error(
          `Error crítico en fallback`,
          fallbackError.stack,
          SearchService.name
        );
        
        return {
          query_info: {
            similitud: "DISTINTO",
            total_candidates: 0,
            search_time_ms: Math.round(totalStepTime)
          },
          selected_product: {
            codigo: null,
            descripcion: null,
            marca: null,
            segment: 'standard',
            has_stock: false,
            has_cost_agreement: false,
            boost_total_percent: 0,
            boost_reasons: []
          },
          alternatives: [],
          boost_summary: {
            products_with_stock: [],
            products_with_pricing: [],
            segment_matches: [],
            boost_weights_used: this.boostWeights
          },
          timings: {
            embedding_time_ms: 0,
            vector_search_time_ms: 0,
            gpt_selection_time_ms: totalStepTime
          }
        };
      }
    }
  }

  // Selección híbrida: boost system + desempate automático + GPT solo para empates finales
  // Implementa la lógica de priorización: similaridad ajustada > stock > acuerdo > segmento > GPT semántico
  private async selectBestProductHybrid(
    originalQuery: string,
    products: any[],
    normalizedQuery: string,
    segment?: 'premium' | 'standard' | 'economy',
    limit?: number
  ) {
    const stepStartTime = process.hrtime.bigint();
    
    if (!products || products.length === 0) {
      this.logger.warn('No hay productos para procesar en híbrido', SearchService.name);
      return {
        query_info: {
          similitud: "DISTINTO",
          total_candidates: 0,
          search_time_ms: 0
        },
        selected_product: {
          codigo: null,
          descripcion: null,
          marca: null,
          segment: 'standard',
          has_stock: false,
          has_cost_agreement: false,
          boost_total_percent: 0,
          boost_reasons: []
        },
        alternatives: [],
        boost_summary: this.createEmptyBoostSummary(),
        selection_method: 'empty'
      };
    }

    try {
      this.logger.log(
        `Iniciando selección híbrida para: "${originalQuery}" con ${products.length} productos`,
        SearchService.name,
        { segment_preference: segment }
      );

      // --- PREPARAR PRODUCTOS CON BOOST ---
      // Calcular boost y similaridad ajustada para todos los productos
      const productsWithBoost = products.map((product, index) => {
        const cleanText = (product.descripcion || '').trim();
        const productCode = (product.codigo || '').trim();
        const productMarca = (product.marca || 'N/A').trim();
        const productSegment = (product.segment || 'standard').trim();
        const hasStock = Boolean(product.articulo_stock);
        const hasCostAgreement = Boolean(product.lista_costos);
        const originalSimilarity = Number(product.similarity || 0);

        // Calcular boost multiplicadores
        let segmentMultiplier = 1.0;
        if (segment) {
          if (productSegment === segment) {
            segmentMultiplier = this.boostWeights.segmentPreferred;
          } else if (
            (segment === 'premium' && productSegment === 'standard') ||
            (segment === 'economy' && productSegment === 'standard') ||
            (segment === 'standard' && (productSegment === 'premium' || productSegment === 'economy'))
          ) {
            segmentMultiplier = this.boostWeights.segmentCompatible;
          }
        } else {
          segmentMultiplier = this.boostWeights.segmentPreferred; // Boost neutral
        }

        const stockMultiplier = hasStock ? this.boostWeights.stock : 1.0;
        const costMultiplier = hasCostAgreement ? this.boostWeights.costAgreement : 1.0;
        const totalMultiplier = segmentMultiplier * stockMultiplier * costMultiplier;
        const adjustedSimilarity = Math.min(1.0, originalSimilarity * totalMultiplier);

        return {
          index: index + 1,
          codigo: productCode,
          text: cleanText,
          marca: productMarca,
          segment: productSegment,
          articulo_stock: hasStock,
          lista_costos: hasCostAgreement,
          originalSimilarity,
          adjustedSimilarity,
          totalMultiplier,
          boostInfo: {
            segment: { applied: segmentMultiplier > 1.0, percentage: Math.round((segmentMultiplier - 1.0) * 100) },
            stock: { applied: hasStock, percentage: Math.round((stockMultiplier - 1.0) * 100) },
            cost_agreement: { applied: hasCostAgreement, percentage: Math.round((costMultiplier - 1.0) * 100) },
            brand_exact: { applied: false, percentage: 0 },
            model_exact: { applied: false, percentage: 0 },
            size_exact: { applied: false, percentage: 0 },
            total_boost: Math.round((totalMultiplier - 1.0) * 100)
          }
        };
      });

      // --- ORDENAR POR SIMILARIDAD AJUSTADA ---
      productsWithBoost.sort((a, b) => b.adjustedSimilarity - a.adjustedSimilarity);

      // --- DETECTAR EMPATES EN EL PRIMER PUESTO ---
      const topSimilarity = productsWithBoost[0].adjustedSimilarity;
      const tiedProducts = productsWithBoost.filter(p => 
        Math.abs(p.adjustedSimilarity - topSimilarity) < 0.0001 // Tolerancia para float precision
      );

      this.logger.log(
        `Productos empatados en primer lugar: ${tiedProducts.length}`,
        SearchService.name,
        { 
          top_similarity: topSimilarity,
          tied_codes: tiedProducts.map(p => p.codigo)
        }
      );

      let selectedProduct;
      let selectionMethod;

      if (tiedProducts.length === 1) {
        // --- SIN EMPATE: USAR GANADOR DIRECTO ---
        selectedProduct = tiedProducts[0];
        selectionMethod = 'boost_ranking';
        
        this.logger.log(
          `Ganador único por boost: ${selectedProduct.codigo}`,
          SearchService.name,
          { 
            adjusted_similarity: selectedProduct.adjustedSimilarity,
            boost_percent: selectedProduct.boostInfo.total_boost
          }
        );
      } else {
        // --- HAY EMPATE: APLICAR DESEMPATE AUTOMÁTICO ---
        this.logger.log(
          `Aplicando desempate automático: Stock > Acuerdo > Segmento`,
          SearchService.name
        );

        // Ordenar empatados por prioridades de negocio
        tiedProducts.sort((a, b) => {
          // 1. STOCK (prioridad máxima)
          if (a.articulo_stock !== b.articulo_stock) {
            return b.articulo_stock ? 1 : -1; // true gana sobre false
          }

          // 2. ACUERDO DE COSTOS
          if (a.lista_costos !== b.lista_costos) {
            return b.lista_costos ? 1 : -1;
          }

          // 3. SEGMENTO (premium > standard > economy)
          const segmentOrder = { premium: 3, standard: 2, economy: 1 };
          const aSegmentValue = segmentOrder[a.segment] || 0;
          const bSegmentValue = segmentOrder[b.segment] || 0;
          if (aSegmentValue !== bSegmentValue) {
            return bSegmentValue - aSegmentValue;
          }

          // 4. Si aún hay empate, usar similaridad original como último criterio
          return b.originalSimilarity - a.originalSimilarity;
        });

        // Verificar si el desempate automático resolvió el empate
        const afterTiebreak = tiedProducts.filter(p => 
          p.articulo_stock === tiedProducts[0].articulo_stock &&
          p.lista_costos === tiedProducts[0].lista_costos &&
          p.segment === tiedProducts[0].segment
        );

        if (afterTiebreak.length === 1) {
          // --- DESEMPATE AUTOMÁTICO EXITOSO ---
          selectedProduct = tiedProducts[0];
          selectionMethod = 'automatic_tiebreaker';
          
          this.logger.log(
            `Desempate automático exitoso: ${selectedProduct.codigo}`,
            SearchService.name,
            {
              reason: `Stock:${selectedProduct.articulo_stock}, Acuerdo:${selectedProduct.lista_costos}, Segmento:${selectedProduct.segment}`
            }
          );
        } else {
          // --- EMPATE PERSISTE: USAR GPT PARA DECIDIR ---
          this.logger.log(
            `Empate persiste después de desempate automático, usando GPT`,
            SearchService.name,
            { remaining_tied: afterTiebreak.length }
          );

          const gptResult = await this.selectBestProductWithGPT(
            originalQuery,
            afterTiebreak.map(p => ({
              codigo: p.codigo,
              descripcion: p.text,
              marca: p.marca,
              segment: p.segment,
              codigo_fabrica: '',
              articulo_stock: p.articulo_stock,
              lista_costos: p.lista_costos,
              similarity: p.originalSimilarity
            })),
            normalizedQuery,
            segment,
            afterTiebreak.length
          );

          // Encontrar el producto seleccionado por GPT en nuestra lista
          selectedProduct = tiedProducts.find(p => p.codigo === gptResult.selected_product.codigo) || tiedProducts[0];
          selectionMethod = 'gpt_tiebreaker';
          
          this.logger.log(
            `GPT resolvió empate final: ${selectedProduct.codigo}`,
            SearchService.name,
            { gpt_similarity: gptResult.query_info.similitud }
          );
        }
      }

      // --- CONSTRUIR RESPUESTA FINAL ---
      const alternatives = productsWithBoost.slice(0, Math.min(productsWithBoost.length, limit || 10)).map((product, index) => ({
        codigo: product.codigo,
        descripcion: product.text,
        marca: product.marca,
        rank: index + 1,
        has_stock: product.articulo_stock,
        has_cost_agreement: product.lista_costos,
        segment: product.segment,
        boost_percent: product.boostInfo.total_boost,
        boost_tags: [
          ...(product.boostInfo.segment.applied ? ['segment'] : []),
          ...(product.boostInfo.stock.applied ? ['stock'] : []),
          ...(product.boostInfo.cost_agreement.applied ? ['cost'] : [])
        ]
      }));

      // Boost summary
      const boostSummary = {
        products_with_stock: productsWithBoost.filter(p => p.articulo_stock).map(p => p.codigo),
        products_with_pricing: productsWithBoost.filter(p => p.lista_costos).map(p => p.codigo),
        segment_matches: productsWithBoost.filter(p => p.boostInfo.segment.applied).map(p => p.codigo),
        boost_weights_used: this.boostWeights
      };

      // Determinar similitud final usando thresholds configurables
      const finalSimilitud = this.classifySimilarityByThreshold(selectedProduct.adjustedSimilarity);
      
      this.logger.log(
        `Clasificación por threshold: similaridad=${selectedProduct.adjustedSimilarity.toFixed(4)} → ${finalSimilitud}`,
        SearchService.name,
        { 
          product_code: selectedProduct.codigo,
          adjusted_similarity: selectedProduct.adjustedSimilarity,
          classification: finalSimilitud,
          selection_method: selectionMethod
        }
      );

      const totalTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;

      return {
        query_info: {
          similitud: finalSimilitud,
          total_candidates: products.length,
          search_time_ms: Math.round(totalTime)
        },
        selected_product: {
          codigo: selectedProduct.codigo,
          descripcion: selectedProduct.text,
          marca: selectedProduct.marca,
          segment: selectedProduct.segment,
          has_stock: selectedProduct.articulo_stock,
          has_cost_agreement: selectedProduct.lista_costos,
          boost_total_percent: selectedProduct.boostInfo.total_boost,
          boost_reasons: alternatives.find(a => a.codigo === selectedProduct.codigo)?.boost_tags || []
        },
        alternatives: alternatives,
        boost_summary: boostSummary,
        selection_method: selectionMethod,
        timings: {
          embedding_time_ms: 0,
          vector_search_time_ms: 0,
          gpt_selection_time_ms: totalTime
        }
      };

    } catch (error) {
      const totalTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      
      this.logger.error(
        `Error en selección híbrida`,
        error.stack,
        SearchService.name,
        { duration_ms: totalTime, error_message: error.message }
      );

      // Fallback: usar el primer producto
      const fallbackProduct = products[0];
      return {
        query_info: {
          similitud: "ALTERNATIVO",
          total_candidates: products.length,
          search_time_ms: Math.round(totalTime)
        },
        selected_product: {
          codigo: fallbackProduct.codigo || '',
          descripcion: fallbackProduct.descripcion || '',
          marca: fallbackProduct.marca || 'N/A',
          segment: fallbackProduct.segment || 'standard',
          has_stock: Boolean(fallbackProduct.articulo_stock),
          has_cost_agreement: Boolean(fallbackProduct.lista_costos),
          boost_total_percent: 0,
          boost_reasons: []
        },
        alternatives: [],
        boost_summary: this.createEmptyBoostSummary(),
        selection_method: 'fallback_error',
        timings: {
          embedding_time_ms: 0,
          vector_search_time_ms: 0,
          gpt_selection_time_ms: totalTime
        }
      };
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
      const response = await this.rateLimiter.executeChat(
        () => this.openai.chat.completions.create({
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
        `gpt-normalization-${Date.now()}`
      );
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

  // Verifica si la query menciona una marca específica
  private queryMentionsBrand(query: string, brand: string): boolean {
    if (!brand || brand.trim() === '') return false;
    
    const normalizedQuery = query.toLowerCase().trim();
    const normalizedBrand = brand.toLowerCase().trim();
    
    // Buscar marca exacta como palabra completa
    const brandRegex = new RegExp(`\\b${normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return brandRegex.test(normalizedQuery);
  }
  
  // Verifica si la query menciona un modelo/código de fábrica específico
  private queryMentionsModel(query: string, model: string): boolean {
    if (!model || model.trim() === '') return false;
    
    const normalizedQuery = query.toLowerCase().trim();
    const normalizedModel = model.toLowerCase().trim();
    
    // Buscar modelo exacto como palabra completa o substring (códigos pueden ser alfanuméricos)
    return normalizedQuery.includes(normalizedModel);
  }

  // VALIDACIÓN GPT FINAL: Juicio final sobre el producto recomendado
  private async performFinalGPTValidation(
    query: string, 
    result: any, 
    startTime: bigint
  ): Promise<any> {
    const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    
    // Si hay producto recomendado (EXACTO/EQUIVALENTE), validarlo
    if (result.selected_product && ["EXACTO", "EQUIVALENTE"].includes(result.query_info.similitud)) {
      this.logger.log(`🔍 VALIDACIÓN GPT FINAL: Verificando producto recomendado`, SearchService.name);
      
      const isValid = await this.validateRecommendationWithGPT(query, result.selected_product);
      
      if (isValid) {
        // Producto validado, retornar tal como está
        this.logger.log(`✅ PRODUCTO VALIDADO POR GPT: ${result.selected_product.codigo}`, SearchService.name);
        return {
          ...result,
          timings: {
            ...result.timings,
            total_time_ms: totalTime
          }
        };
      } else {
        // Producto rechazado, buscar en alternativas
        this.logger.warn(`❌ PRODUCTO RECHAZADO POR GPT: ${result.selected_product.codigo}`, SearchService.name);
      }
    }
    
    // No hay producto válido o fue rechazado, buscar en alternativas
    this.logger.log(`🔍 BUSCANDO EN ALTERNATIVAS: ${result.alternatives?.length || 0} opciones`, SearchService.name);
    
    const validAlternative = await this.findValidAlternativeWithGPT(query, result.alternatives || []);
    
    if (validAlternative) {
      // Promover alternativa a recomendado
      const updatedAlternatives = result.alternatives.filter(alt => alt.codigo !== validAlternative.codigo);
      this.logger.log(`✅ ALTERNATIVA VALIDADA POR GPT: ${validAlternative.codigo}`, SearchService.name);
      
      return {
        ...result,
        selected_product: validAlternative,
        alternatives: updatedAlternatives,
        timings: {
          ...result.timings,
          total_time_ms: totalTime
        }
      };
    }
    
    // No hay producto válido en absoluto
    this.logger.warn(
      `⚠️ JUICIO FINAL: NO HAY PRODUCTO VÁLIDO`,
      SearchService.name,
      {
        query: query,
        normalized_query: result.normalizado,
        alternatives_evaluated: result.alternatives?.length || 0,
        reason: 'GPT_VALIDATION_REJECTED_ALL'
      }
    );
    
    return {
      ...result,
      selected_product: null,
      timings: {
        ...result.timings,
        total_time_ms: totalTime
      }
    };
  }

  // VALIDACIÓN GPT #1: Verifica si el producto recomendado es realmente lo que busca el usuario
  private async validateRecommendationWithGPT(query: string, product: any): Promise<boolean> {
    const stepStartTime = process.hrtime.bigint();
    try {
      this.logger.log(
        `Validando recomendado con GPT-4o. Query: "${query}", Producto: "${product?.descripcion}"`,
        SearchService.name
      );

      const response = await this.rateLimiter.executeChat(
        () => this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Eres un experto en productos industriales. Tu trabajo es proteger al usuario de recibir cotizaciones incorrectas.

Responde ÚNICAMENTE "SI" o "NO".

REGLAS ABSOLUTAS PARA RESPONDER "SI":
1. MISMA CATEGORÍA: PROHIBIDO cambiar de categoría (filtro aceite ≠ filtro aire, pintura ≠ solvente)
2. MISMO TAMAÑO/CANTIDAD: Deben ser equivalentes exactos (5 gal = 5 galones = 18.9L, pero 5L ≠ 55GL)
3. CÓDIGOS EXACTOS: Si el usuario da un código, DEBE coincidir o tener equivalencia confirmada del fabricante
4. PRODUCTO EQUIVALENTE: Debe ser el mismo producto o equivalente directo certificado
5. APLICACIÓN IDÉNTICA: Mismo uso, misma función, 100% intercambiable

RESPONDE "NO" AUTOMÁTICAMENTE SI:
- CAMBIO DE CATEGORÍA: filtro aceite → filtro aire, thinner → pintura, hidráulico → motor
- TAMAÑO INCORRECTO: 5L cuando pide 55GL, 1 gal cuando pide 5 gal
- CÓDIGO NO COINCIDE: Usuario da código específico y producto tiene otro
- PRODUCTO DIFERENTE: Aunque sea "similar" o "parecido"
- CUALQUIER DUDA sobre equivalencia

VALIDACIÓN DE CATEGORÍAS:
- Filtro aceite ≠ Filtro aire ≠ Filtro combustible ≠ Filtro hidráulico
- Aceite motor ≠ Aceite hidráulico ≠ Aceite transmisión
- Pintura ≠ Primer ≠ Thinner ≠ Solvente
- Cable eléctrico ≠ Cable datos ≠ Cable control

EJEMPLOS CRÍTICOS DE "NO":
- "FILTRO ACEITE 21192875" → "FILTRO DE AIRE 21693755" = NO (cambio categoría)
- "FILTRO AIRE MTU 0180945802" → "FILTRO DE ACEITE MTU" = NO (cambio categoría)
- "THINNER 55GL" → "THINER 5 LTR" = NO (55GL ≠ 5L)
- "Pintura epóxica" → "Primer epóxico" = NO (pintura ≠ primer)
- "Aceite SAE 40" → "Aceite hidráulico ISO 68" = NO (motor ≠ hidráulico)

EJEMPLOS DE "SI":
- "pintura blanca 5 gal" → "pintura blanca 5 galones" = SI (mismo producto y cantidad)
- "FILTRO ACEITE WIX 51348" → "FILTRO ACEITE WIX 51348" = SI (exacto)
- "cable 12 AWG THHN" → "cable 12 AWG THHN 600V" = SI (misma especificación)

DECISIÓN FINAL: En caso de CUALQUIER duda sobre categoría, tamaño o equivalencia, responde "NO".`
            },
            {
              role: "user",
              content: `CONSULTA DEL USUARIO: "${query}"
PRODUCTO RECOMENDADO: "${product?.descripcion || 'N/A'}"
Marca: ${product?.marca || 'N/A'}
Código: ${product?.codigo || 'N/A'}

ANALIZA CUIDADOSAMENTE:
1. ¿Es el mismo TIPO de producto?
2. ¿Los códigos/referencias coinciden o son equivalentes?
3. ¿Las cantidades son correctas?
4. ¿La función es idéntica?`
            }
          ],
          temperature: 0.1,
          max_tokens: 10
        }),
        `validate-recommendation-${Date.now()}`
      );

      const gptResponse = response.choices[0]?.message?.content?.trim().toUpperCase();
      const isValid = gptResponse === 'SI';
      
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `Validación GPT completada: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'}`,
        SearchService.name,
        {
          duration_ms: totalStepTime,
          gpt_response: gptResponse,
          query: query,
          product_code: product?.codigo,
          product_description: product?.descripcion,
          validation_result: isValid ? 'ACCEPTED' : 'REJECTED'
        }
      );

      return isValid;

    } catch (error) {
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.error(
        `Error en validación GPT del recomendado.`,
        error.stack,
        SearchService.name,
        { duration_ms: totalStepTime, error_message: error.message }
      );
      // En caso de error, ser conservador y considerar inválido
      return false;
    }
  }

  // VALIDACIÓN GPT #2: Busca en alternativas cuál es realmente lo que busca el usuario
  private async findValidAlternativeWithGPT(query: string, alternatives: any[]): Promise<any | null> {
    const stepStartTime = process.hrtime.bigint();
    try {
      if (!alternatives || alternatives.length === 0) {
        this.logger.log(`No hay alternativas para evaluar con GPT.`, SearchService.name);
        return null;
      }

      this.logger.log(
        `Buscando alternativa válida con GPT-4o. Query: "${query}", Alternativas: ${alternatives.length}`,
        SearchService.name
      );

      // Preparar lista de alternativas para GPT con más información
      const alternativesList = alternatives.slice(0, 10).map((alt, index) => 
        `${index + 1}. ${alt.descripcion} - Marca: ${alt.marca || 'N/A'} - Código: ${alt.codigo || 'N/A'}`
      ).join('\n');

      const response = await this.rateLimiter.executeChat(
        () => this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Eres un experto en productos industriales. Tu trabajo es proteger al usuario de recibir cotizaciones incorrectas.

Responde ÚNICAMENTE con el NÚMERO de la alternativa correcta, o "NINGUNO" si NO HAY ninguna que sea EXACTAMENTE lo que busca.

REGLAS ABSOLUTAS (TODAS deben cumplirse):
1. MISMA CATEGORÍA: PROHIBIDO cambiar de categoría de producto
2. MISMO TAMAÑO: Cantidad/volumen/medida debe ser equivalente exacto
3. CÓDIGOS EXACTOS: Si hay código, DEBE coincidir o ser equivalente certificado
4. PRODUCTO EQUIVALENTE: Mismo producto o sustituto directo confirmado
5. APLICACIÓN IDÉNTICA: 100% intercambiable para el mismo uso

RECHAZA AUTOMÁTICAMENTE SI:
- CAMBIO DE CATEGORÍA: filtro aceite → filtro aire, pintura → solvente
- TAMAÑO DIFERENTE: 5L vs 55GL, 1 gal vs 5 gal
- CÓDIGO NO COINCIDE: Códigos diferentes sin equivalencia confirmada
- PRODUCTO DIFERENTE: Aunque sea "parecido" o "similar"

CATEGORÍAS QUE NO PUEDES MEZCLAR:
- Filtros: aceite ≠ aire ≠ combustible ≠ hidráulico ≠ cabina
- Aceites: motor ≠ hidráulico ≠ transmisión ≠ diferencial
- Pinturas: pintura ≠ primer ≠ sellador ≠ barniz
- Solventes: thinner ≠ acetona ≠ alcohol ≠ varsol
- Cables: eléctrico ≠ datos ≠ control ≠ coaxial

VALIDACIÓN DE TAMAÑOS:
- 1 galón = 3.785L (NO es 5L)
- 5 galones = 18.9L (NO es 20L)
- 55 galones = 208L (NO es 200L ni 5L)
- Verificar SIEMPRE unidades: L ≠ GL, kg ≠ lb

EJEMPLOS CRÍTICOS "NINGUNO":
- "FILTRO ACEITE 21192875" → Alternativas con "FILTRO AIRE" = NINGUNO
- "THINNER 55GL" → Alternativas con "5L" o "20L" = NINGUNO
- "Aceite 15W40" → Alternativas con "Aceite hidráulico" = NINGUNO
- "Pintura epóxica" → Alternativas con "Primer epóxico" = NINGUNO

DECISIÓN: Si dudas aunque sea 1% sobre categoría, tamaño o equivalencia = "NINGUNO".`
            },
            {
              role: "user",
              content: `CONSULTA DEL USUARIO: "${query}"

ALTERNATIVAS:
${alternativesList}

Responde solo el número o "NINGUNO".`
            }
          ],
          temperature: 0.1,
          max_tokens: 20
        }),
        `find-alternative-${Date.now()}`
      );

      const gptResponse = response.choices[0]?.message?.content?.trim().toUpperCase();
      
      let selectedAlternative = null;
      if (gptResponse !== 'NINGUNO' && gptResponse !== 'NINGUNA') {
        const selectedIndex = parseInt(gptResponse) - 1;
        if (selectedIndex >= 0 && selectedIndex < alternatives.length) {
          selectedAlternative = alternatives[selectedIndex];
        }
      }
      
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.log(
        `Búsqueda de alternativa GPT completada: ${selectedAlternative ? 'ENCONTRADA' : 'NO ENCONTRADA'}`,
        SearchService.name,
        {
          duration_ms: totalStepTime,
          gpt_response: gptResponse,
          selected_product: selectedAlternative?.codigo || null,
          selected_description: selectedAlternative?.descripcion || null,
          query: query,
          alternatives_evaluated: alternatives.length,
          result: selectedAlternative ? 'ALTERNATIVE_FOUND' : 'NO_VALID_ALTERNATIVE'
        }
      );

      return selectedAlternative;

    } catch (error) {
      const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
      this.logger.error(
        `Error en búsqueda de alternativa con GPT.`,
        error.stack,
        SearchService.name,
        { duration_ms: totalStepTime, error_message: error.message }
      );
      return null;
    }
  }

  async getDebugConfig() {
    return {
      productTable: this.productTable,
      embeddingModel: this.embeddingModel,
      vectorDimensions: this.vectorDimensions,
      probes: this.probes,
      databaseUrl: this.configService.get<string>('DATABASE_URL')?.replace(/:[^:]*@/, ':***@'), // Hide password
      nodeEnv: process.env.NODE_ENV,
      openaiKeyPrefix: this.configService.get<string>('OPENAI_API_KEY')?.substring(0, 10) + '...'
    };
  }

  async onModuleDestroy() {
    this.logger.log(`Cerrando pool de conexiones de PostgreSQL en SearchService.`, SearchService.name);
    await this.pool.end();
  }
}
