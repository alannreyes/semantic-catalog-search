import { Module, Logger } from '@nestjs/common'; 
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { WebhookController } from './webhook.controller';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';
import { AcronimosModule } from '../acronimos/acronimos.module';
import { MSSQLEnrichService } from './mssql-enrich.service';

@Module({
  imports: [AcronimosModule],
  controllers: [SearchController, WebhookController],
  providers: [
    SearchService,
    MSSQLEnrichService,
    OpenAIRateLimiterService,
    Logger
  ],
  exports: [SearchService],
})
export class SearchModule {}
