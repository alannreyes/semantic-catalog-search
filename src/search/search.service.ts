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
import { MSSQLEnrichService } from './mssql-enrich.service';
import { IsMatchDto } from './dto/ismatch.dto';
import { SimilDto } from './dto/simil.dto';
import { DimensionsDto } from './dto/dimensions.dto';

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
    clientHistory: number;
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
    private readonly mssqlEnrichService: MSSQLEnrichService,
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
      sizeExact: parseFloat(this.configService.get<string>('BOOST_SIZE_EXACT') || '1.10'),
      clientHistory: parseFloat(this.configService.get<string>('BOOST_CLIENT_HISTORY') || '1.20')
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
  async searchProducts(
    query: string, 
    limit: number = 5, 
    segment?: 'premium' | 'standard' | 'economy',
    cliente?: string,
    marca?: string
  ) {
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
      const initialResult = await this.performSemanticSearch(expandedQuery, limit, client, segment, query, cliente, marca);
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
        query,
        cliente,
        marca
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
    originalQueryOverride?: string,
    cliente?: string,
    marca?: string
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
        limit,
        cliente,
        marca
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
    limit?: number,
    cliente?: string,
    marca?: string
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

      let productsForGPT = products.map((product, index) => {
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
            client: { applied: false, percentage: 0, frequency: 0 },
            total_boost: 0
          },
          marca_mssql: undefined as string | undefined
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

      // --- ENRIQUECIMIENTO CON MS SQL ---
      // Aplicar boost de cliente y reordenamiento por marca si están especificados
      if (cliente || marca) {
        try {
          const codigosParaEnriquecer = productsForGPT.slice(0, 20).map(p => p.codigo);
          
          // BOOST POR HISTORIAL DE CLIENTE
          if (cliente) {
            this.logger.log(`Aplicando boost de historial para cliente: ${cliente}`, SearchService.name);
            const clientHistory = await this.mssqlEnrichService.getClientPurchaseHistory(cliente, codigosParaEnriquecer);
            
            productsForGPT.forEach(product => {
              const frecuencia = clientHistory.get(product.codigo) || 0;
              if (frecuencia > 0) {
                // Aplicar boost basado en frecuencia de compra
                const clientMultiplier = Math.min(this.boostWeights.clientHistory, 1 + (frecuencia * 0.1));
                const originalSimilarity = parseFloat(product.adjustedSimilarity || product.vectorSimilarity);
                const newSimilarity = Math.min(1.0, originalSimilarity * clientMultiplier);
                product.adjustedSimilarity = newSimilarity.toFixed(4);
                
                // Agregar info de boost de cliente
                product.boostInfo.client.applied = true;
                product.boostInfo.client.percentage = Math.round((clientMultiplier - 1.0) * 100);
                product.boostInfo.client.frequency = frecuencia;
                
                this.logger.log(
                  `BOOST CLIENTE ${product.codigo}: ${originalSimilarity} -> ${newSimilarity} (Compras: ${frecuencia}, +${product.boostInfo.client.percentage}%)`,
                  SearchService.name
                );
              }
            });
          }
          
          // OBTENER MARCAS PARA REORDENAMIENTO
          if (marca) {
            this.logger.log(`Obteniendo marcas para reordenamiento: ${marca}`, SearchService.name);
            const brandMap = await this.mssqlEnrichService.getProductBrands(codigosParaEnriquecer);
            
            productsForGPT.forEach(product => {
              const productBrand = brandMap.get(product.codigo);
              if (productBrand) {
                product.marca_mssql = productBrand;
              }
            });
          }
        } catch (error) {
          this.logger.error(`Error en enriquecimiento MS SQL: ${error.message}`, SearchService.name);
          // Continuar sin enriquecimiento si hay error
        }
      }

      // Reordenar productos por similaridad ajustada
      productsForGPT.sort((a, b) => {
        const aScore = parseFloat(a.adjustedSimilarity || a.vectorSimilarity);
        const bScore = parseFloat(b.adjustedSimilarity || b.vectorSimilarity);
        return bScore - aScore;
      });
      
      // REORDENAMIENTO POR MARCA (si se especificó)
      if (marca) {
        this.logger.log(`Reordenando por marca: ${marca}`, SearchService.name);
        
        // Separar productos por marca
        const productosMarcaTarget = [];
        const productosOtrasMarcas = [];
        
        productsForGPT.forEach(product => {
          const productMarca = (product.marca_mssql || product.marca || '').toLowerCase();
          const targetMarca = marca.toLowerCase();
          
          if (productMarca === targetMarca || productMarca.includes(targetMarca)) {
            productosMarcaTarget.push(product);
          } else {
            productosOtrasMarcas.push(product);
          }
        });
        
        // Reconstruir array con marca objetivo primero
        productsForGPT = [...productosMarcaTarget, ...productosOtrasMarcas];
        
        this.logger.log(
          `Reordenamiento por marca completado: ${productosMarcaTarget.length} productos de ${marca} al inicio`,
          SearchService.name
        );
      }

      // Recopilar información de boost por tipo para todos los candidatos
      const boostSummary = {
        segment_boosted: productsForGPT.filter(p => p.boostInfo.segment.applied).map(p => p.codigo),
        stock_boosted: productsForGPT.filter(p => p.boostInfo.stock.applied).map(p => p.codigo),
        cost_agreement_boosted: productsForGPT.filter(p => p.boostInfo.cost_agreement.applied).map(p => p.codigo),
        client_history_boosted: productsForGPT.filter(p => p.boostInfo.client?.applied).map(p => ({
          codigo: p.codigo,
          frequency: p.boostInfo.client.frequency
        })),
        brand_reordered: marca ? productsForGPT.filter(p => {
          const productMarca = (p.marca_mssql || p.marca || '').toLowerCase();
          return productMarca === marca.toLowerCase() || productMarca.includes(marca.toLowerCase());
        }).map(p => p.codigo) : [],
        total_candidates: productsForGPT.length,
        boost_weights_used: {
          segment_preferred: this.boostWeights.segmentPreferred,
          segment_compatible: this.boostWeights.segmentCompatible,
          stock: this.boostWeights.stock,
          cost_agreement: this.boostWeights.costAgreement,
          client_history: cliente ? this.boostWeights.clientHistory : undefined
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

WAREHOUSE MATCHING RULES:
1. **BRAND**: Must match when specified (no tolerance)
2. **PRODUCT TEST**: Would warehouse staff consider these the same SKU?
   - Same physical product? → ACCEPT
   - Same specifications? → ACCEPT
   - Minor text variations? → ACCEPT
   - Different item entirely? → REJECT
3. **IGNORE DIFFERENCES IN**:
   - Word sequence (PVC 3" = 3" PVC)
   - Typos that don't change meaning
   - Extra descriptive words
   - Format notation (1.1/2" = 1 1/2")
4. **CORE PRINCIPLE**: Match products, not strings
6. Analyze each product considering: main function, brand, model, characteristics, factory code
7. Select ONLY ONE product (the best match)
8. PRIORITIZE ADJUSTED scores - they include all boosts (segment, stock, agreements)
9. Products [STOCK] have high rotation, products [ACUERDO] have preferential conditions
10. Respond ONLY with valid JSON:

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
    limit?: number,
    cliente?: string,
    marca?: string
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

      // --- SELECCIÓN INICIAL POR BOOST ---
      if (tiedProducts.length === 1) {
        selectedProduct = tiedProducts[0];
        selectionMethod = 'boost_ranking';
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

        selectedProduct = tiedProducts[0];
        selectionMethod = 'automatic_tiebreaker';
      }

      // --- JUICIO FINAL CON GPT: SIEMPRE SE EJECUTA ---
      this.logger.log(
        `Ejecutando JUICIO FINAL con GPT-4o (ULTRA-RESTRICTIVE PROTOCOL)`,
        SearchService.name,
        { 
          pre_selected: selectedProduct.codigo,
          total_candidates: productsWithBoost.length 
        }
      );

      // Enviar TOP 10 productos a GPT para juicio final
      const candidatesForGPT = productsWithBoost.slice(0, 10);
      
      const gptResult = await this.selectBestProductWithGPT(
        originalQuery,
        candidatesForGPT.map((p, idx) => ({
          codigo: p.codigo,
          descripcion: p.text,
          marca: p.marca,
          segment: p.segment,
          codigo_fabrica: '',  // No disponible en este contexto
          articulo_stock: p.articulo_stock,
          lista_costos: p.lista_costos,
          similarity: p.originalSimilarity,
          adjustedSimilarity: p.adjustedSimilarity,
          boost_total: p.boostInfo.total_boost,
          index: idx + 1
        })),
        normalizedQuery,
        segment,
        candidatesForGPT.length,
        cliente,
        marca
      );

      // Procesar resultado de GPT JUICIO FINAL
      if (gptResult.query_info.similitud === 'DISTINTO') {
        // GPT rechazó todos los productos según protocolo ultra-restrictivo
        this.logger.warn(
          `GPT JUICIO FINAL: Ningún producto cumple criterios ultra-restrictivos`,
          SearchService.name,
          { original_query: originalQuery }
        );
        
        const totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1_000_000;
        
        // Retornar resultado vacío según protocolo
        return {
          query_info: {
            similitud: "DISTINTO",
            total_candidates: products.length,  // Usar products.length en lugar de result.rows.length
            search_time_ms: Math.round(totalStepTime),  // Usar tiempo del paso actual
            selection_method: 'gpt_ultra_restrictive_rejection'
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
            total_products_evaluated: products.length,  // Usar products.length
            products_with_boosts: productsWithBoost.filter(p => p.boostInfo.total_boost > 0).length,
            average_boost_percent: 0,
            max_boost_percent: 0
          }
        };
      }

      // GPT seleccionó un producto válido
      const gptSelectedProduct = candidatesForGPT.find(p => p.codigo === gptResult.selected_product.codigo);
      
      if (gptSelectedProduct) {
        if (gptSelectedProduct.codigo !== selectedProduct.codigo) {
          this.logger.log(
            `GPT JUICIO FINAL cambió selección de ${selectedProduct.codigo} a ${gptSelectedProduct.codigo}`,
            SearchService.name,
            { 
              gpt_similarity: gptResult.query_info.similitud,
              reason: 'GPT override based on ultra-restrictive protocol'
            }
          );
        } else {
          this.logger.log(
            `GPT JUICIO FINAL confirmó selección: ${selectedProduct.codigo}`,
            SearchService.name,
            { gpt_similarity: gptResult.query_info.similitud }
          );
        }
        
        selectedProduct = gptSelectedProduct;
        selectionMethod = 'gpt_final_judgment';
      } else {
        // Fallback si GPT responde con índice inválido
        this.logger.warn(
          `GPT JUICIO FINAL dio índice inválido, usando selección por boost`,
          SearchService.name
        );
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
          ...(product.boostInfo.cost_agreement.applied ? ['cost'] : []),
          ...(product.boostInfo.client?.applied ? ['client'] : [])
        ],
        client_history: product.boostInfo.client?.applied ? {
          purchase_frequency: product.boostInfo.client.frequency,
          boost_applied: product.boostInfo.client.percentage
        } : undefined
      }));

      // Boost summary
      const boostSummary = {
        products_with_stock: productsWithBoost.filter(p => p.articulo_stock).map(p => p.codigo),
        products_with_pricing: productsWithBoost.filter(p => p.lista_costos).map(p => p.codigo),
        segment_matches: productsWithBoost.filter(p => p.boostInfo.segment.applied).map(p => p.codigo),
        client_purchase_history: productsWithBoost
          .filter(p => p.boostInfo.client?.applied)
          .map(p => ({
            codigo: p.codigo,
            purchase_frequency: p.boostInfo.client.frequency,
            boost_percentage: p.boostInfo.client.percentage
          })),
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
          boost_reasons: alternatives.find(a => a.codigo === selectedProduct.codigo)?.boost_tags || [],
          client_history: selectedProduct.boostInfo.client?.applied ? {
            purchase_frequency: selectedProduct.boostInfo.client.frequency,
            boost_applied: selectedProduct.boostInfo.client.percentage
          } : undefined
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
              content: `Industrial product expert. Answer ONLY "YES" or "NO".

WAREHOUSE MATCHING VALIDATION: Use practical warehouse logic.

YES if:
- EXACT brand match (when brand specified)
- Same physical product with same specifications
- Minor text variations acceptable (word order, typos, extra descriptors)
- Warehouse staff would consider these the same SKU

NO if:
- Different brand (when brand specified)
- Different product type or function
- Different key specifications (size, material, capacity)
- Completely different items

PRINCIPLE: Match like warehouse professionals - focus on product identity, not text strings.`
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
              content: `Industrial product expert. Answer with alternative NUMBER or "NONE".

WAREHOUSE MATCHING VALIDATION: Apply practical warehouse logic.

Select alternative if:
- EXACT brand match when brand specified
- Same physical product with same specifications
- Minor text variations acceptable (word order, typos, extra descriptors)
- Warehouse staff would consider these the same SKU

Answer "NONE" if:
- Different brand than requested
- Different product type or function
- Different key specifications (size, material, capacity)

PRINCIPLE: Match like warehouse professionals - focus on product identity, not text strings.`
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

  // Determina si dos productos son el mismo usando GPT-4o con criterios de almacén
  async isMatch(dto: IsMatchDto): Promise<number> {
    try {
      const systemPrompt = "Eres un experto en análisis de productos industriales. SIEMPRE respondes con JSON válido y nada más. Tus explicaciones deben ser en español.";

      const userPrompt = `Analiza si estos dos productos son el mismo producto.

PRODUCTO 1: "${dto.producto1}"
PRODUCTO 2: "${dto.producto2}"

WAREHOUSE MATCHING RULES:
1. **BRAND**: Must match when specified (no tolerance)
2. **PRODUCT TEST**: Would warehouse staff consider these the same SKU?
   - Same physical product? → ACCEPT
   - Same specifications? → ACCEPT
   - Minor text variations? → ACCEPT
   - Different item entirely? → REJECT
3. **IGNORE DIFFERENCES IN**:
   - Word sequence (PVC 3" = 3" PVC)
   - Typos that don't change meaning
   - Extra descriptive words
   - Format notation (1.1/2" = 1 1/2")
4. **CORE PRINCIPLE**: Match products, not strings

Analyze each product considering: main function, brand, model, characteristics, factory code

Respond ONLY with valid JSON:
{
  "match": 1
}

INSTRUCCIONES:
- Si son el mismo producto físico → match = 1
- Si son productos diferentes → match = 0`;

      const gptResponse = await this.rateLimiter.executeChat(
        () => this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 50,
          response_format: { type: "json_object" }
        }),
        `ismatch-${Date.now()}`
      );

      const response = JSON.parse(gptResponse.choices[0]?.message?.content?.trim());
      const result = response.match === 1 ? 1 : 0;
      
      this.logger.log(
        `IsMatch: "${dto.producto1}" vs "${dto.producto2}" = ${result}`,
        SearchService.name
      );
      
      return result;
      
    } catch (error) {
      this.logger.error('Error in isMatch:', error);
      return 0;
    }
  }

  // Método para calcular similitud coseno pura entre dos textos
  async simil(dto: SimilDto): Promise<number> {
    try {
      // Obtener embeddings para ambos textos
      const embeddingParams: any = { 
        model: this.embeddingModel
      };

      if (this.embeddingModel.includes('text-embedding-3')) {
        embeddingParams.dimensions = this.vectorDimensions;
      }

      const [embeddingResponse1, embeddingResponse2] = await Promise.all([
        this.rateLimiter.executeEmbedding(
          () => this.openai.embeddings.create({
            ...embeddingParams,
            input: dto.texto1
          }),
          `simil-embedding1-${Date.now()}`
        ),
        this.rateLimiter.executeEmbedding(
          () => this.openai.embeddings.create({
            ...embeddingParams,
            input: dto.texto2
          }),
          `simil-embedding2-${Date.now()}`
        )
      ]);

      const embedding1 = embeddingResponse1.data[0].embedding;
      const embedding2 = embeddingResponse2.data[0].embedding;

      // Calcular similitud coseno
      const dotProduct = embedding1.reduce((sum, val, i) => sum + val * embedding2[i], 0);
      const magnitude1 = Math.sqrt(embedding1.reduce((sum, val) => sum + val * val, 0));
      const magnitude2 = Math.sqrt(embedding2.reduce((sum, val) => sum + val * val, 0));
      
      const cosineSimilarity = dotProduct / (magnitude1 * magnitude2);
      
      // Redondear a 2 decimales
      const result = Math.round(cosineSimilarity * 100) / 100;
      
      this.logger.log(
        `Simil: "${dto.texto1}" vs "${dto.texto2}" = ${result}`,
        SearchService.name
      );
      
      return result;
      
    } catch (error) {
      this.logger.error('Error in simil:', error);
      throw new Error(`Error calculating similarity: ${error.message}`);
    }
  }

  // Método para calcular dimensiones y pesos de mercadería usando GPT-4o
  async calculateDimensions(dto: DimensionsDto) {
    try {
      const systemPrompt = `You are an industrial tool measurement specialist. Process the following array of industrial items and calculate their physical dimensions.

For each item, analyze the "descripcion" field to determine:
- Weight in kg (peso_kg)
- Height in cm (alto_cm)
- Width in cm (ancho_cm)  
- Length in cm (largo_cm)

Rules:
1. Base calculations on standard tool specifications from the description
2. Consider manufacturer standards (STANLEY, TRUPER, BOSCH, MAKITA, DEWALT, etc.)
3. For tool sets (JGO), calculate the complete set dimensions including case/box
4. Units: PZA=piece, UND=unit, JGO=set, KG=kilogram, MT=meter, LT=liter
5. Use realistic industrial tool dimensions
6. Consider packaging when calculating dimensions

Return ONLY valid JSON with:
- "items": array with all input fields plus calculated dimensions
- "totales": object with packaged totals considering standard industrial packaging

Example response format:
{
  "items": [
    {
      "cod_articulo": "input_value",
      "unico_articulo": "input_value", 
      "descripcion": "input_value",
      "unidad": "input_value",
      "cantidad": "input_value",
      "peso_kg": 0.72,
      "alto_cm": 32,
      "ancho_cm": 12,
      "largo_cm": 5
    }
  ],
  "totales": {
    "peso_total_kg": 6.6,
    "volumen_total_cm3": 45600,
    "items_procesados": 2,
    "bultos_estimados": 1
  }
}`;

      const userPrompt = `Input data:\n${JSON.stringify(dto.items)}`;

      const gptResponse = await this.rateLimiter.executeChat(
        () => this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 4096,
          response_format: { type: "json_object" }
        }),
        `dimensions-${Date.now()}`
      );

      const response = JSON.parse(gptResponse.choices[0]?.message?.content?.trim());
      
      this.logger.log(
        `Dimensions calculated for ${dto.items.length} items`,
        SearchService.name
      );
      
      return response;
      
    } catch (error) {
      this.logger.error('Error in calculateDimensions:', error);
      throw new Error(`Error calculating dimensions: ${error.message}`);
    }
  }

  async onModuleDestroy() {
    this.logger.log(`Cerrando pool de conexiones de PostgreSQL en SearchService.`, SearchService.name);
    await this.pool.end();
  }
}
