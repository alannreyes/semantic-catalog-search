import { Controller, Get, Query, Param, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  
  constructor(private readonly searchService: SearchService) {}

  @Get(':id')
  async webhookSearch(
    @Param('id') id: string,
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @Query('segment') segment?: 'premium' | 'standard' | 'economy'
  ) {
    try {
      if (!query) {
        throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
      }

      this.logger.log(`Raw query params: query=${query}, limit=${limit}, segment=${segment}, segment_type=${typeof segment}`);
      this.logger.log(`Received webhook search request for: "${query}" with segment: ${segment || 'none'}`);
      
      const result = await this.searchService.searchProducts(
        query,
        limit ? parseInt(limit) : 5,
        segment
      );
      
      return result;
    } catch (error) {
      this.logger.error(`Webhook search error: ${error.message}`);
      throw new HttpException(
        error.message || 'An error occurred during search',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}