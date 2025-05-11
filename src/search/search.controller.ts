import { Controller, Post, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  
  constructor(private readonly searchService: SearchService) {}

  @Post()
  async search(@Body() body: { query: string; limit?: number }) {
    try {
      if (!body.query) {
        throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
      }
      
      this.logger.log(`Received search request for: "${body.query}"`);
      
      const result = await this.searchService.searchProducts(
        body.query,
        body.limit || 5
      );
      
      return result;
    } catch (error) {
      this.logger.error(`Search error: ${error.message}`);
      throw new HttpException(
        error.message || 'An error occurred during search',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
