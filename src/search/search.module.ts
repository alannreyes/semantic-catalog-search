import { Module, Logger } from '@nestjs/common'; 
import { SearchService } from './search.service';
// Si tienes un SearchController, también debería estar importado y listado en 'controllers'
// import { SearchController } from './search.controller';

@Module({
  // controllers: [SearchController], // Descomenta si tienes un controlador
  providers: [
    SearchService,
    Logger
  ],
  exports: [SearchService],
})
export class SearchModule {}
