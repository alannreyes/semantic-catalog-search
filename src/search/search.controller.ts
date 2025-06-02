import { Controller, Post, Get, Body, Query, Param, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller()
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  
  constructor(private readonly searchService: SearchService) {}

  // API REST moderna - POST /search
  @Post('search')
  async search(@Body() body: { query: string; limit?: number; segment?: 'premium' | 'standard' | 'economy' }) {
    try {
      if (!body.query) {
        throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
      }
      
      this.logger.log(`Received API search request for: "${body.query}" with segment: ${body.segment || 'none'}`);
      
      const result = await this.searchService.searchProducts(
        body.query,
        body.limit || 5,
        body.segment
      );
      
      return result;
    } catch (error) {
      this.logger.error(`API search error: ${error.message}`);
      throw new HttpException(
        error.message || 'An error occurred during search',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Webhook para n8n y aplicaciones legacy - GET /webhook/:id
  @Get('webhook/:id')
  async webhookSearch(
    @Param('id') id: string,
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @Query('segment') segment?: 'premium' | 'standard' | 'economy'
  ) {
	  
	this.logger.log(`Raw query params: query=${query}, limit=${limit}, segment=${segment}, segment_type=${typeof segment}`);
	  
    try {
      if (!query) {
        throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
      }
      
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