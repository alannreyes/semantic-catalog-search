import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { SearchV2Service } from './searchv2.service';
import { SearchV2Dto } from './dto/searchv2.dto';
import { LoggerService } from '../logs/logger.service';

@Controller()
export class SearchV2Controller {
  private readonly logger = new Logger(SearchV2Controller.name);
  
  constructor(
    private readonly searchV2Service: SearchV2Service,
    private readonly loggerService: LoggerService
  ) {}

  @Post('searchv2')
  async search(@Body() searchDto: SearchV2Dto) {
    this.logger.log(
      `SearchV2: Received search request for: "${searchDto.query}" with segment: ${searchDto.segment || 'none'}, cliente: ${searchDto.cliente || 'none'}, marca: ${searchDto.marca || 'none'}`,
      SearchV2Controller.name
    );
    const result = await this.searchV2Service.searchProducts(
      searchDto.query,
      searchDto.limit || 5,
      searchDto.segment,
      searchDto.cliente,
      searchDto.marca,
      searchDto.codigo_fabrica
    );
    this.logger.log(
      `SearchV2: Search completed with ${result.alternatives.length + 1} products found, similarity: ${result.query_info.similitud}`,
      SearchV2Controller.name
    );
    await this.loggerService.logQuery('searchv2', searchDto, result);
    return result;
  }

  @Get('searchv2/debug/config')
  async getConfig() {
    return {
      service: 'SearchV2Service',
      method: 'cosine_similarity_only',
      features: {
        gpt_selection: false,
        gpt_normalization: false,
        boost_system: true,
        acronym_expansion: true
      },
      description: 'Simplified search using only cosine similarity with boost system'
    };
  }
}