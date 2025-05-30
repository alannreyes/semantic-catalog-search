import { Module, Logger } from '@nestjs/common'; 
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  controllers: [SearchController], 
  providers: [
    SearchService,
    Logger
  ],
  exports: [SearchService],
})
export class SearchModule {}
