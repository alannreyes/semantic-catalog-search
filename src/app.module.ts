import { Module, Logger, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SearchModule } from './search/search.module';
import { WinstonLoggerService } from './common/logger/winston-logger.service';
import * as Joi from 'joi';

// Crea un módulo global para el Logger
@Global()
@Module({
  providers: [
    WinstonLoggerService,
    {
      provide: Logger,
      useClass: WinstonLoggerService,
    },
  ],
  exports: [Logger, WinstonLoggerService],
})
class GlobalLoggerModule {}

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
      }),
    }),
    GlobalLoggerModule, // Importa el módulo global del Logger
    SearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}