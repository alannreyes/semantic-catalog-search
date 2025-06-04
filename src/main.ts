import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  const port = process.env.PORT || 4000;
  const host = process.env.HOST || '0.0.0.0'; 
  const frontendPort = process.env.PORTF || 4001;
  
  // Habilitar CORS
  app.enableCors({
    origin: [
      `http://localhost:${frontendPort}`,
      // Si necesitas permitir otros orígenes, agrégalos desde variables de entorno
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
    ],
    credentials: true,
  });
  
  await app.listen(port, host); // MODIFICADO - añadido host
  logger.log(`Backend running on: http://${host}:${port}`); // MODIFICADO
  logger.log(`CORS enabled for frontend on: http://localhost:${frontendPort}`);
}
bootstrap();