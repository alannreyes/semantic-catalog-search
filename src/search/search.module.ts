import { Module, Logger } from '@nestjs/common'; 
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { WebhookController } from './webhook.controller';  // ← Agregar import

@Module({
  controllers: [SearchController, WebhookController],  // ← Agregar WebhookController
  providers: [
    SearchService,
    Logger
  ],
  exports: [SearchService],
})
export class SearchModule {}
