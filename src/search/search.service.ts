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
      
      const embedding = embeddingResponse.data[0].embedding;
      this.logger.log(`Embedding generated successfully (${embedding.length} dimensions)`);
      
      // 2. Buscar en pgvector por similitud
      const result = await this.pool.query(
        `SELECT 
          id::TEXT,
          text->>'id' AS product_code,
          text->>'text' AS description,
          text->'metadata'->>'codigo' AS codigo,
          1 - (embedding <=> $1) AS similarity
        FROM 
          productos
        ORDER BY 
          embedding <=> $1
        LIMIT $2`,
        [embedding, limit]
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
