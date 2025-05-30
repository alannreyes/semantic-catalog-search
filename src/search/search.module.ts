import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { LoggerModule } from '../common/logger/logger.module'; // Ajusta la ruta

@Module({
  imports: [LoggerModule], // Importa el LoggerModule
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
