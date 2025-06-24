import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { winstonConfig } from './common/logger/winston.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: winstonConfig,
  });
  const logger = new Logger('Bootstrap');
  
  const port = process.env.PORT || 4000;
  const host = process.env.HOST || '0.0.0.0'; 
  const frontendPort = process.env.PORTF || 4001;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Configuración de seguridad crítica
  app.use(helmet({
    contentSecurityPolicy: isProduction ? undefined : false, // Desactivar CSP en desarrollo para facilitar debugging
  }));
  
  // Rate limiting - protección contra ataques DDoS
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: isProduction ? 100 : 1000, // Límite más estricto en producción
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }));
  
  // Trust proxy para aplicaciones detrás de load balancers
  if (isProduction) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  
  // Validación global de entrada
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    disableErrorMessages: isProduction, // No exponer detalles de validación en producción
  }));
  
  // Exception filter global para sanitizar errores
  app.useGlobalFilters(new GlobalExceptionFilter());
  
  // Logging interceptor para request tracking
  app.useGlobalInterceptors(new LoggingInterceptor());
  
  // Configuración de CORS mejorada
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : [`http://localhost:${frontendPort}`];
  
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  
  await app.listen(port, host);
  logger.log(`🚀 Backend running on: http://${host}:${port}`);
  logger.log(`🔒 Security enabled: Helmet + Rate Limiting`);
  logger.log(`✅ CORS enabled for: ${allowedOrigins.join(', ')}`);
  logger.log(`🛡️ Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
}
bootstrap();
