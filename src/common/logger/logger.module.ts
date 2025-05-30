import { Module, Global } from '@nestjs/common';
import { WinstonLoggerService } from './winston-logger.service';

@Global() // Hace que el Logger esté disponible globalmente
@Module({
  providers: [
    {
      provide: 'Logger', // Token para inyección
      useClass: WinstonLoggerService,
    },
    WinstonLoggerService, // También como clase directa
  ],
  exports: ['Logger', WinstonLoggerService], // Exporta ambos para flexibilidad
})
export class LoggerModule {}