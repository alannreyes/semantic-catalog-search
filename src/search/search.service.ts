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
      
      return {
        results: result.rows,
        query,
        total: result.rows.length
      };
    } catch (error) {
      this.logger.error(`Error in search: ${error.message}`, error.stack);
      throw new Error(`Error performing semantic search: ${error.message}`);
    }
  }
}
