import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap'); // Instancia un logger para el contexto 'Bootstrap'
  const app = await NestFactory.create(AppModule);  // Crea la instancia de la aplicación NestJS
  
  // Habilitar CORS
  app.enableCors(); // Habilita las políticas de CORS
  
  await app.listen(3000);
  logger.log(`SemanticCatalogSearch API running on port 3000`);
}
bootstrap(); // Llama a la función de inicialización
