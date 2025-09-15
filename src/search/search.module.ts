import { Module, Logger } from '@nestjs/common'; 
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { WebhookController } from './webhook.controller';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';
import { AcronimosModule } from '../acronimos/acronimos.module';
import { MSSQLEnrichService } from './mssql-enrich.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogEntity } from '../logs/log.entity';
import { LoggerService } from '../logs/logger.service';

@Module({
  imports: [AcronimosModule, TypeOrmModule.forFeature([LogEntity])],
  controllers: [SearchController, WebhookController],
  providers: [
    SearchService,
    MSSQLEnrichService,
    OpenAIRateLimiterService,
    Logger,
    LoggerService
  ],
  exports: [SearchService],
})
export class SearchModule {}
