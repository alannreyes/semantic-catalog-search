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
  private readonly vectorDimensions: number; // Nueva propiedad

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
    
    // Nueva configuración para dimensiones del vector
    this.vectorDimensions = parseInt(
      this.configService.get<string>('VECTOR_DIMENSIONS') || '1024', 
      10
    );

    this.logger.log(
      `SearchService initialized with model=${this.embeddingModel}, probes=${this.probes}, table=${this.productTable}, dimensions=${this.vectorDimensions}`,
      SearchService.name
    );

    // Validar que las dimensiones sean un número válido
    if (this.vectorDimensions <= 0 || !Number.isInteger(this.vectorDimensions)) {
      this.logger.error(
        `Invalid vector dimensions: ${this.vectorDimensions}. Must be a positive integer.`,
        null,
        SearchService.name
      );
      throw new Error(`Invalid VECTOR_DIMENSIONS configuration: ${this.vectorDimensions}`);
    }
  }

  async searchProducts(query: string, limit: number = 5, segmentoPrecio?: 'PREMIUM' | 'ESTANDAR' | 'ECONOMICO') {
    const startTime = process.hrtime.bigint();
    let client: PoolClient;

    this.logger.log(
      `Iniciando búsqueda de productos.`,
      SearchService.name,
      { query_text: query, segmento_precio_deseado: segmentoPrecio }
    );

    try {
      this.logger.log(
        `Buscando productos con query original: "${query}"`,
        SearchService.name
      );

      // --- LOGGING DE CONEXIÓN A DB ---
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
        const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        this.logger.log(`Búsqueda completada (sin normalización).`, SearchService.name, { duration_ms: totalTime });
        return { ...initialResult, normalizado: null };
      }

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
        { duration_ms: totalTime }
      );

      return {
        ...resultAfterNormalization,
        normalizado: normalizedQuery
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

  private async performSemanticSearch(
    inputText: string,
    limit: number = 5,
    client: PoolClient,
    segmentoPrecioDeseado?: 'PREMIUM' | 'ESTANDAR' | 'ECONOMICO', 
    originalQueryOverride?: string
  ) {
    const stepStartTime = process.hrtime.bigint();
    try {
      this.logger.log(
        `Iniciando performSemanticSearch para: "${inputText}" con segmento de precio deseado: ${segmentoPrecioDeseado || 'cualquiera'}`,
        SearchService.name
      );

      // --- LOGGING DE CREACIÓN DE EMBEDDING ---
      const embeddingStart = process.hrtime.bigint();
      
      // Configurar parámetros para el embedding
      const embeddingParams: any = { 
        model: this.embeddingModel, 
        input: inputText 
      };

      // Para text-embedding-3-large y text-embedding-3-small, podemos especificar dimensiones
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

      // Validar dimensiones del embedding
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
        return { codigo: null, descripcion: null, similitud: "DISTINTO" };
      }

      // --- SELECCIÓN GPT ---
      const gptSelectionStart = process.hrtime.bigint();
      const best = await this.selectBestProductWithGPT(
        originalQueryOverride || inputText,
        result.rows,
        inputText,
        segmentoPrecioDeseado,
        limit 
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
        { duration_ms: totalStepTime }
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
    segmentoPrecioDeseado?: 'PREMIUM' | 'ESTANDAR' | 'ECONOMICO',
    limit?: number
  ) {
    const stepStartTime = process.hrtime.bigint();
    
    // Validación temprana de productos
    if (!products || products.length === 0) {
      this.logger.warn('No hay productos para procesar con GPT', SearchService.name);
      return { codigo: null, descripcion: null, similitud: "DISTINTO" };
    }

    try {
      this.logger.log(
        `Iniciando selectBestProductWithGPT para: "${originalQuery}" con segmento de precio deseado: ${segmentoPrecioDeseado || 'cualquiera'}`,
        SearchService.name,
        { productos_disponibles: products.length }
      );

      const productsForGPT = products.map((product, index) => {
        // Validaciones defensivas
        const cleanText = (product.descripcion || '').trim();
        const productCode = (product.codigo || '').trim();
        const productMarca = (product.marca || 'N/A').trim();
        const productSegmentoPrecio = (product.segmento_precio || 'ESTANDAR').trim();
        const productCodFabrica = (product.codfabrica || '').trim();

        return {
          index: index + 1,
          codigo: productCode,
          text: cleanText,
          marca: productMarca,
          segmento_precio: productSegmentoPrecio,
          codfabrica: productCodFabrica,
          vectorSimilarity: Number(product.similarity || 0).toFixed(4)
        };
      });

      // Preparar candidatos
      const candidatos = {};
      const maxCandidatos = limit || 5;
      
      for (let i = 0; i < Math.min(products.length, maxCandidatos); i++) {
        const candidateIndex = i + 1;
        candidatos[`CA${candidateIndex}`] = products[i].codigo || '';
        candidatos[`DA${candidateIndex}`] = products[i].descripcion || '';
      }

      let instructionsForPriceSegment = '';
      if (segmentoPrecioDeseado) {
        instructionsForPriceSegment = `
IMPORTANTE - PREFERENCIA DE SEGMENTO DE PRECIO:
El usuario prefiere productos del segmento '${segmentoPrecioDeseado}'. 
Orden de preferencia:
${segmentoPrecioDeseado === 'PREMIUM' ? '1. PREMIUM 2. ESTANDAR 3. ECONOMICO' : 
  segmentoPrecioDeseado === 'ESTANDAR' ? '1. ESTANDAR 2. PREMIUM 3. ECONOMICO' : 
  '1. ECONOMICO 2. ESTANDAR 3. PREMIUM'}`;
      }

      // Preparar prompt más robusto con mejor formato
      const productList = productsForGPT.map(p => 
        `${p.index}. CÓDIGO: ${p.codigo} | DESCRIPCIÓN: "${p.text}" | MARCA: ${p.marca} | SEGMENTO: ${p.segmento_precio} | COD_FÁBRICA: ${p.codfabrica} | SIMILITUD: ${p.vectorSimilarity}`
      ).join('\n');

      const prompt = `Analiza los productos y selecciona el mejor match para la búsqueda del usuario.

CONSULTA DEL USUARIO: "${originalQuery}"

PRODUCTOS DISPONIBLES:
${productList}

${instructionsForPriceSegment}

ESCALA DE SIMILITUD:
- EXACTO: Es exactamente lo que busca el usuario
- EQUIVALENTE: Cumple la misma función con especificaciones similares
- COMPATIBLE: Funciona para el mismo propósito
- ALTERNATIVO: Puede servir pero con diferencias
- DISTINTO: No es lo que busca

INSTRUCCIONES:
1. Analiza cada producto considerando: marca, modelo, características, código de fábrica
2. Selecciona SOLO UN producto (el mejor match)
3. Considera la preferencia de segmento de precio si se especificó
4. Responde ÚNICAMENTE con JSON válido:

{
  "selectedIndex": 1,
  "similitud": "EXACTO",
  "razon": "Explicación breve"
}`;

      this.logger.debug(
        `Enviando prompt a GPT`,
        SearchService.name,
        { 
          prompt_length: prompt.length,
          productos_procesados: productsForGPT.length 
        }
      );

      // --- LLAMADA A GPT CON MEJOR MANEJO DE ERRORES ---
      const gptCallStart = process.hrtime.bigint();
      let gptResponse;
      
      try {
        gptResponse = await Promise.race([
          this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: "Eres un experto en análisis de productos industriales. SIEMPRE respondes con JSON válido y nada más."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.1,
            max_tokens: 200,
            response_format: { type: "json_object" } // Forzar respuesta JSON
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

      // Parsear respuesta JSON con mejor manejo de errores
      let gptDecision;
      try {
        gptDecision = JSON.parse(gptContent);
        
        // Validar estructura del JSON
        if (!gptDecision.selectedIndex || !gptDecision.similitud) {
          throw new Error('JSON response missing required fields');
        }
        
        // Validar valores
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
        
        // Fallback con análisis de similitud vectorial
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
          selected_codigo: selectedProduct.codigo
        }
      );

      return {
        codigo: selectedProduct.codigo,
        descripcion: selectedProduct.text,
        similitud: gptDecision.similitud,
        razon: gptDecision.razon || 'Seleccionado por GPT',
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

      // Fallback robusto
      try {
        const firstProduct = products[0];
        const cleanText = (firstProduct.descripcion || '').trim();
        const productCode = (firstProduct.codigo || '').trim();

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
          { fallback_codigo: productCode }
        );

        return {
          codigo: productCode,
          descripcion: cleanText,
          similitud: "ALTERNATIVO",
          razon: `Fallback after GPT error: ${error.message}`,
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
          razon: `Critical error in product selection: ${error.message}`
        };
      }
    }
  }

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