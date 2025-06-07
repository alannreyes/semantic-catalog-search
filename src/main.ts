import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  const port = process.env.PORT || 4000;
  const host = process.env.HOST || '0.0.0.0'; 
  
  // Obtener todos los orígenes permitidos desde .env
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000']; // valor por defecto
  
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  
  await app.listen(port, host);
  logger.log(`Backend running on: http://${host}:${port}`);
  logger.log(`CORS enabled for: ${allowedOrigins.join(', ')}`);
}
bootstrap();
