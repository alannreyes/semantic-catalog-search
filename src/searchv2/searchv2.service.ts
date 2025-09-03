import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import OpenAI from 'openai';
import { AcronimosService } from '../acronimos/acronimos.service';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';

@Injectable()
export class SearchV2Service implements OnModuleDestroy {
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
    brandExplicit: number; // Boost cuando marca es enviada como parámetro
    modelExact: number;
    codeExplicit: number; // Boost cuando codigo_fabrica es enviado como parámetro
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
  ) {
    // Configuración optimizada del pool de conexiones
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 30000,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
        ca: this.configService.get<string>('DB_CA_CERT'),
        cert: this.configService.get<string>('DB_CLIENT_CERT'),
        key: this.configService.get<string>('DB_CLIENT_KEY')
      } : false,
    });

    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      timeout: 45000,
      maxRetries: 2,
    });

    this.probes = parseInt(this.configService.get<string>('PGVECTOR_PROBES') || '1', 10);
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL') || 'text-embedding-3-large';
    this.productTable = this.configService.get<string>('PRODUCT_TABLE') || 'productos_bip';
    this.vectorDimensions = parseInt(this.configService.get<string>('VECTOR_DIMENSIONS') || '1024', 10);

    // Configurar pesos de boost desde variables de entorno
    this.boostWeights = {
      segmentPreferred: parseFloat(this.configService.get<string>('BOOST_SEGMENT_PREFERRED') || '1.30'),
      segmentCompatible: parseFloat(this.configService.get<string>('BOOST_SEGMENT_COMPATIBLE') || '1.20'),
      stock: parseFloat(this.configService.get<string>('BOOST_STOCK') || '1.25'),
      costAgreement: parseFloat(this.configService.get<string>('BOOST_COST_AGREEMENT') || '1.15'),
      brandExact: parseFloat(this.configService.get<string>('BOOST_BRAND_EXACT') || '1.20'),
      brandExplicit: parseFloat(this.configService.get<string>('BOOST_BRAND_EXPLICIT') || '1.50'), // 50% boost cuando se especifica marca
      modelExact: parseFloat(this.configService.get<string>('BOOST_MODEL_EXACT') || '1.15'),
      codeExplicit: parseFloat(this.configService.get<string>('BOOST_CODE_EXPLICIT') || '2.00'), // 100% boost cuando se especifica código
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
      `SearchV2Service initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}, dimensions=${this.vectorDimensions}`,
      SearchV2Service.name
    );
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async searchProducts(
    query: string,
    limit: number = 5,
    segment?: 'premium' | 'standard' | 'economy',
    cliente?: string,
    marca?: string,
    codigo_fabrica?: string
  ) {
    const startTime = process.hrtime.bigint();
    let client: PoolClient;

    this.logger.log(
      `SearchV2: Iniciando búsqueda simple por coseno para: "${query}"`,
      SearchV2Service.name
    );

    try {
      // Expansión de acrónimos
      const expandedQuery = await this.acronimosService.translateText(query);
      if (expandedQuery !== query) {
        this.logger.log(
          `SearchV2: Query expandida: "${query}" → "${expandedQuery}"`,
          SearchV2Service.name
        );
      }

      // Conexión a base de datos
      client = await Promise.race([
        this.pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 10000))
      ]) as any;

      // Generar embedding
      const embeddingStart = process.hrtime.bigint();
      const embedding = await this.generateEmbedding(expandedQuery);
      const embeddingEnd = process.hrtime.bigint();
      const embeddingTime = Number(embeddingEnd - embeddingStart) / 1_000_000;

      // Configurar probes
      await client.query(`SET ivfflat.probes = ${this.probes}`);

      // Búsqueda vectorial
      const vectorString = `[${embedding.join(',')}]`;
      const vectorSearchStart = process.hrtime.bigint();
      
      const result = await client.query(
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
        [vectorString, limit * 3] // Obtenemos más productos para aplicar boosts
      );

      const vectorSearchEnd = process.hrtime.bigint();
      const vectorSearchTime = Number(vectorSearchEnd - vectorSearchStart) / 1_000_000;

      if (result.rows.length === 0) {
        return this.createEmptyResponse(embeddingTime, vectorSearchTime);
      }

      // Aplicar boosts a todos los productos
      const boostedProducts = this.applyBoosts(result.rows, query, segment, cliente, marca, codigo_fabrica);
      
      // Ordenar por similitud ajustada y tomar los mejores
      boostedProducts.sort((a, b) => b.adjusted_similarity - a.adjusted_similarity);
      const topProducts = boostedProducts.slice(0, limit);

      // Clasificar similitud del mejor producto
      const bestProduct = topProducts[0];
      const similitud = this.classifySimilarity(bestProduct.adjusted_similarity);

      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      return {
        query_info: {
          similitud,
          total_candidates: result.rows.length,
          search_time_ms: Math.round(totalTime),
          method: 'cosine_only'
        },
        selected_product: this.formatProduct(bestProduct),
        alternatives: topProducts.slice(1).map(product => this.formatProduct(product)),
        boost_summary: this.createBoostSummary(topProducts),
        timings: {
          embedding_time_ms: Math.round(embeddingTime),
          vector_search_time_ms: Math.round(vectorSearchTime),
          boost_time_ms: Math.round(totalTime - embeddingTime - vectorSearchTime)
        }
      };

    } catch (error) {
      this.logger.error(
        `SearchV2: Error en búsqueda semántica: ${error.message}`,
        error.stack,
        SearchV2Service.name
      );
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    return await this.rateLimiter.executeEmbedding(async () => {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text,
        dimensions: this.vectorDimensions,
      });
      return response.data[0].embedding;
    }, `embedding-${Date.now()}`);
  }

  private applyBoosts(products: any[], query: string, segment?: string, cliente?: string, marca?: string, codigo_fabrica?: string) {
    const queryLower = query.toLowerCase();
    
    return products.map(product => {
      let boostMultiplier = 1.0;
      const boostReasons = [];

      // Boost por segmento
      if (segment) {
        if (product.segment === 'premium' && segment === 'premium') {
          boostMultiplier *= this.boostWeights.segmentPreferred;
          boostReasons.push(`Segmento preferido (${product.segment})`);
        } else if (['standard', 'economy'].includes(product.segment) && ['standard', 'economy'].includes(segment)) {
          boostMultiplier *= this.boostWeights.segmentCompatible;
          boostReasons.push(`Segmento compatible (${product.segment})`);
        }
      }

      // Boost por stock
      if (product.articulo_stock && product.articulo_stock > 0) {
        boostMultiplier *= this.boostWeights.stock;
        boostReasons.push('Disponible en stock');
      }

      // Boost por acuerdo de costos
      if (product.lista_costos) {
        boostMultiplier *= this.boostWeights.costAgreement;
        boostReasons.push('Con acuerdo de costos');
      }

      // Boost por marca cuando está en el query
      if (product.marca && queryLower.includes(product.marca.toLowerCase())) {
        boostMultiplier *= this.boostWeights.brandExact;
        boostReasons.push(`Marca en query (${product.marca})`);
      }
      
      // Boost adicional cuando marca es enviada como parámetro explícito
      if (marca && product.marca && product.marca.toLowerCase().includes(marca.toLowerCase())) {
        boostMultiplier *= this.boostWeights.brandExplicit;
        boostReasons.push(`Marca solicitada (${product.marca})`);
      }

      // Boost por modelo/código cuando está en el query
      if (product.codigo_fabrica && queryLower.includes(product.codigo_fabrica.toLowerCase())) {
        boostMultiplier *= this.boostWeights.modelExact;
        boostReasons.push(`Modelo en query (${product.codigo_fabrica})`);
      }
      
      // Boost máximo cuando codigo_fabrica es enviado como parámetro explícito
      if (codigo_fabrica && product.codigo_fabrica && 
          product.codigo_fabrica.toLowerCase() === codigo_fabrica.toLowerCase()) {
        boostMultiplier *= this.boostWeights.codeExplicit;
        boostReasons.push(`Código exacto (${product.codigo_fabrica})`);
      }

      return {
        ...product,
        boost_multiplier: boostMultiplier,
        boost_reasons: boostReasons,
        adjusted_similarity: product.similarity * boostMultiplier
      };
    });
  }

  private classifySimilarity(adjustedSimilarity: number): string {
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

  private formatProduct(product: any) {
    return {
      codigo: product.codigo,
      descripcion: product.descripcion,
      marca: product.marca,
      segment: product.segment,
      codigo_fabrica: product.codigo_fabrica,
      similarity_raw: Math.round(product.similarity * 10000) / 10000,
      similarity_adjusted: Math.round(product.adjusted_similarity * 10000) / 10000,
      has_stock: product.articulo_stock > 0,
      has_cost_agreement: !!product.lista_costos,
      boost_total_percent: Math.round((product.boost_multiplier - 1) * 100),
      boost_reasons: product.boost_reasons
    };
  }

  private createBoostSummary(products: any[]) {
    return {
      products_with_stock: products.filter(p => p.articulo_stock > 0).map(p => p.codigo),
      products_with_pricing: products.filter(p => p.lista_costos).map(p => p.codigo),
      segment_matches: products.map(p => ({ codigo: p.codigo, segment: p.segment })),
      boost_weights_used: this.boostWeights
    };
  }

  private createEmptyResponse(embeddingTime: number, vectorSearchTime: number) {
    return {
      query_info: {
        similitud: "DISTINTO",
        total_candidates: 0,
        search_time_ms: Math.round(embeddingTime + vectorSearchTime),
        method: 'cosine_only'
      },
      selected_product: {
        codigo: null,
        descripcion: null,
        marca: null,
        segment: 'standard',
        similarity_raw: 0,
        similarity_adjusted: 0,
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
        embedding_time_ms: Math.round(embeddingTime),
        vector_search_time_ms: Math.round(vectorSearchTime),
        boost_time_ms: 0
      }
    };
  }
}