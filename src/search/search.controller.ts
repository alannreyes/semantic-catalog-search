import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchDto } from './dto/search.dto';
import { IsMatchDto } from './dto/ismatch.dto';
import { SimilDto } from './dto/simil.dto';
import { DimensionsDto } from './dto/dimensions.dto';

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

  // Debug endpoint para verificar configuración
  @Get('debug/config')
  async getConfig() {
    return await this.searchService.getDebugConfig();
  }

  // Endpoint para comparar si dos productos son el mismo
  @Post('ismatch')
  async isMatch(@Body() isMatchDto: IsMatchDto): Promise<number> {
    this.logger.log(`Received ismatch request: "${isMatchDto.producto1}" vs "${isMatchDto.producto2}"`);
    
    const result = await this.searchService.isMatch(isMatchDto);
    
    this.logger.log(`IsMatch result: ${result}`);
    return result;
  }

  // Endpoint para calcular similitud coseno entre dos textos
  @Post('simil')
  async simil(@Body() similDto: SimilDto): Promise<number> {
    this.logger.log(`Received simil request: "${similDto.texto1}" vs "${similDto.texto2}"`);
    
    const result = await this.searchService.simil(similDto);
    
    this.logger.log(`Simil result: ${result}`);
    return result;
  }

  // Endpoint para calcular dimensiones y pesos de mercadería
  @Post('dimensions')
  async dimensions(@Body() items: any[]) {
    this.logger.log(`Received dimensions request for ${items.length} items`);
    
    const result = await this.searchService.calculateDimensions({ items });
    
    this.logger.log(`Dimensions calculated for ${result.items.length} items`);
    return result;
  }

}