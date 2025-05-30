// app.module.ts
import { Module, Logger } from '@nestjs/common'; // Asegúrate de importar Logger aquí
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SearchModule } from './search/search.module';
import { WinstonLoggerService } from './common/logger/winston-logger.service';
import * as Joi from 'joi'; // <-- Importa Joi

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'], // <-- Puedes añadir esto explícitamente
      validationSchema: Joi.object({ // <-- ¡Añade este bloque!
        DATABASE_URL: Joi.string().required(),
        OPENAI_API_KEY: Joi.string().required(),
        PGVECTOR_PROBES: Joi.number().integer().min(1).default(1),
        OPENAI_MODEL: Joi.string().default('text-embedding-3-large'),
        PRODUCT_TABLE: Joi.string().default('productos_1024'),
        // Puedes añadir otras variables de entorno si las tienes:
        // PORT: Joi.number().default(3000),
        // NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
      }),
    }),
    SearchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: Logger,
      useClass: WinstonLoggerService,
    },
  ],
})
export class AppModule {}
