import { Controller, Post, Body, Logger } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchDto } from './dto/search.dto';

@Controller()
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  
  constructor(private readonly searchService: SearchService) {}

  // API REST moderna - POST /search
  @Post('search')
  async search(@Body() searchDto: SearchDto) {
    this.logger.log(`Received API search request for: "${searchDto.query}" with segment: ${searchDto.segment || 'none'}`);
    
    const result = await this.searchService.searchProducts(
      searchDto.query,
      searchDto.limit || 5,
      searchDto.segment
    );
    
    return result;
  }

}