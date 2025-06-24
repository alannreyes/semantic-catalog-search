import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { VisionController } from './vision.controller';
import { VisionService } from './vision.service';
import { Logger } from '@nestjs/common';
import * as Joi from 'joi';
import { SegmentsModule } from './segments/segments.module';
import { AcronimosModule } from './acronimos/acronimos.module';
import { MigrationModule } from './migration/migration.module';
import { HealthModule } from './health/health.module';

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
        PRODUCT_TABLE: Joi.string().default('productos_1024'),
        VECTOR_DIMENSIONS: Joi.number().integer().default(1024),
        FRONTEND_URL: Joi.string().default('http://localhost:3001'),
        DB_USER: Joi.string().required(),
        DB_HOST: Joi.string().required(),
        DB_NAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_PORT: Joi.string().default('5432'),
        // MS SQL Migration Configuration
        MSSQL_HOST: Joi.string().required(),
        MSSQL_PORT: Joi.number().integer().default(1433),
        MSSQL_DATABASE: Joi.string().required(),
        MSSQL_USER: Joi.string().required(),
        MSSQL_PASSWORD: Joi.string().required(),
        MSSQL_SOURCE_TABLE: Joi.string().default('Ar0000'),
        MSSQL_WHERE_CLAUSE: Joi.string().default("ART_CODFAM <= '47' AND ART_ESTREG = 'A'"),
        POSTGRES_MIGRATION_TABLE: Joi.string().default('productos_1024'),
      }),
    }),
    SegmentsModule,
    AcronimosModule,
    MigrationModule,
    HealthModule,
  ],
  controllers: [SearchController, VisionController],
  providers: [
    SearchService,
    VisionService,
    {
      provide: Logger,
      useValue: new Logger('SearchModule'),
    },
  ],
})
export class AppModule {}
