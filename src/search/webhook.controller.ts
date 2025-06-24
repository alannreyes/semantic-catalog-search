import { Controller, Get, Query, Param, Logger } from '@nestjs/common';
import { SearchService } from './search.service';
import { WebhookSearchDto, WebhookParamsDto } from './dto/search.dto';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  
  constructor(private readonly searchService: SearchService) {}
  
  @Get(':id')
  async webhookSearch(
    @Param() params: WebhookParamsDto,
    @Query() queryDto: WebhookSearchDto
  ) {
    this.logger.log(`Received webhook search request for: "${queryDto.query}" with segment: ${queryDto.segment || 'none'}`);
    
    const result = await this.searchService.searchProducts(
      queryDto.query,
      queryDto.limit || 5,
      queryDto.segment
    );
    
    return result;
  }
}