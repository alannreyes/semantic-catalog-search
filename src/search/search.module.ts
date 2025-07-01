import { Module, Logger } from '@nestjs/common'; 
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { WebhookController } from './webhook.controller';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';
import { AcronimosModule } from '../acronimos/acronimos.module';

@Module({
  imports: [AcronimosModule],
  controllers: [SearchController, WebhookController],
  providers: [
    SearchService,
    OpenAIRateLimiterService,
    Logger
  ],
  exports: [SearchService],
})
export class SearchModule {}
