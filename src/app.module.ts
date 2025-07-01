import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { VisionController } from './vision.controller';
import { VisionService } from './vision.service';
import { OpenAIRateLimiterService } from './openai-rate-limiter.service';
import { Logger } from '@nestjs/common';
import * as Joi from 'joi';
import { SegmentsModule } from './segments/segments.module';
import { AcronimosModule } from './acronimos/acronimos.module';
import { MigrationModule } from './migration/migration.module';
import { HealthModule } from './health/health.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        OPENAI_API_KEY: Joi.string().required(),
        PGVECTOR_PROBES: Joi.number().integer().min(1).default(1),
        OPENAI_MODEL: Joi.string().default('text-embedding-3-large'),
        PRODUCT_TABLE: Joi.string().default('productos_bip'),
        VECTOR_DIMENSIONS: Joi.number().integer().default(1024),
        FRONTEND_URL: Joi.string().default('http://localhost:3001'),
        DB_USER: Joi.string().optional(),
        DB_HOST: Joi.string().optional(),
        DB_NAME: Joi.string().optional(),
        DB_PASSWORD: Joi.string().optional(),
        DB_PORT: Joi.string().default('5432'),
        // MS SQL Migration Configuration (optional for basic deployment)
        MSSQL_HOST: Joi.string().optional(),
        MSSQL_PORT: Joi.number().integer().default(1433),
        MSSQL_DATABASE: Joi.string().optional(),
        MSSQL_USER: Joi.string().optional(),
        MSSQL_PASSWORD: Joi.string().optional(),
        MSSQL_SOURCE_TABLE: Joi.string().default('Ar0000'),
        MSSQL_WHERE_CLAUSE: Joi.string().default("ART_CODFAM <= '47' AND ART_ESTREG = 'A'"),
        POSTGRES_MIGRATION_TABLE: Joi.string().default('productos_bip'),
      }),
    }),
    ScheduleModule.forRoot(),
    SegmentsModule,
    AcronimosModule,
    MigrationModule,
    HealthModule,
    SyncModule,
  ],
  controllers: [SearchController, VisionController],
  providers: [
    SearchService,
    VisionService,
    OpenAIRateLimiterService,
    {
      provide: Logger,
      useValue: new Logger('SearchModule'),
    },
  ],
})
export class AppModule {}
