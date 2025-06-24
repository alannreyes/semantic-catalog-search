import { Controller, Get, Post, Put, Delete, Body, Param, HttpException, HttpStatus, Logger, Query } from '@nestjs/common';
import { AcronimosService } from './acronimos.service';
import { RevertExpansionDto, BulkRevertExpansionDto, FindExpandedProductsDto } from './dto/manage-expansion.dto';

@Controller('acronimos')
export class AcronimosController {
  private readonly logger = new Logger(AcronimosController.name);

  constructor(private readonly acronimosService: AcronimosService) {}

  @Get()
  async findAll() {
    try {
      return await this.acronimosService.findAll();
    } catch (error) {
      this.logger.error(`Error al obtener acrónimos: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al obtener acrónimos',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('active')
  async findAllActive() {
    try {
      return await this.acronimosService.findAllActive();
    } catch (error) {
      this.logger.error(`Error al obtener acrónimos activos: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al obtener acrónimos activos',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    try {
      const acronimo = await this.acronimosService.findById(parseInt(id));
      if (!acronimo) {
        throw new HttpException('Acrónimo no encontrado', HttpStatus.NOT_FOUND);
      }
      return acronimo;
    } catch (error) {
      this.logger.error(`Error al buscar acrónimo por ID: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al buscar acrónimo',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post()
  async create(
    @Body() body: { acronimo: string; descripcion: string }
  ) {
    try {
      if (!body.acronimo || !body.descripcion) {
        throw new HttpException(
          'Acrónimo y descripción son requeridos',
          HttpStatus.BAD_REQUEST
        );
      }

      if (body.acronimo.length > 10) {
        throw new HttpException(
          'El acrónimo no puede tener más de 10 caracteres',
          HttpStatus.BAD_REQUEST
        );
      }

      return await this.acronimosService.create(body.acronimo, body.descripcion);
    } catch (error) {
      this.logger.error(`Error al crear acrónimo: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al crear acrónimo',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { acronimo: string; descripcion: string; activo?: boolean }
  ) {
    try {
      if (!body.acronimo || !body.descripcion) {
        throw new HttpException(
          'Acrónimo y descripción son requeridos',
          HttpStatus.BAD_REQUEST
        );
      }

      if (body.acronimo.length > 10) {
        throw new HttpException(
          'El acrónimo no puede tener más de 10 caracteres',
          HttpStatus.BAD_REQUEST
        );
      }

      const result = await this.acronimosService.update(
        parseInt(id), 
        body.acronimo, 
        body.descripcion,
        body.activo !== undefined ? body.activo : true
      );
      
      if (!result) {
        throw new HttpException('Acrónimo no encontrado', HttpStatus.NOT_FOUND);
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Error al actualizar acrónimo: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al actualizar acrónimo',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const result = await this.acronimosService.delete(parseInt(id));
      if (!result) {
        throw new HttpException('Acrónimo no encontrado', HttpStatus.NOT_FOUND);
      }
      return { message: `Acrónimo '${result.acronimo}' eliminado exitosamente` };
    } catch (error) {
      this.logger.error(`Error al eliminar acrónimo: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al eliminar acrónimo',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('translate')
  async translateText(@Body() body: { text: string }) {
    try {
      if (!body.text) {
        throw new HttpException('Texto es requerido', HttpStatus.BAD_REQUEST);
      }

      const translatedText = await this.acronimosService.translateText(body.text);
      return {
        original: body.text,
        translated: translatedText,
        changed: body.text !== translatedText
      };
    } catch (error) {
      this.logger.error(`Error al traducir texto: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al traducir texto',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // === ENDPOINTS PARA GESTIÓN DE EXPANSIONES ===

  @Get('expansions')
  async getExpandedProducts(@Query() dto: FindExpandedProductsDto) {
    try {
      return await this.acronimosService.findExpandedProducts(dto);
    } catch (error) {
      this.logger.error(`Error al obtener productos expandidos: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al obtener productos expandidos',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('expansions/stats')
  async getExpansionStats() {
    try {
      return await this.acronimosService.getExpansionStats();
    } catch (error) {
      this.logger.error(`Error al obtener estadísticas: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al obtener estadísticas',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('expansions/:codigo')
  async getExpansionDetails(@Param('codigo') codigo: string) {
    try {
      const details = await this.acronimosService.getExpansionDetails(codigo);
      if (!details) {
        throw new HttpException('Producto no encontrado', HttpStatus.NOT_FOUND);
      }
      return details;
    } catch (error) {
      this.logger.error(`Error al obtener detalles de expansión: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al obtener detalles',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('expansions/revert')
  async revertExpansion(@Body() dto: RevertExpansionDto) {
    try {
      const result = await this.acronimosService.revertExpansion(dto.codigo, dto.bloquearFuturas);
      if (!result) {
        throw new HttpException(
          'No se pudo revertir la expansión. El producto puede no tener expansión aplicada.',
          HttpStatus.BAD_REQUEST
        );
      }
      return { 
        success: true, 
        message: `Expansión revertida para producto ${dto.codigo}`,
        bloqueada: dto.bloquearFuturas
      };
    } catch (error) {
      this.logger.error(`Error al revertir expansión: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al revertir expansión',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('expansions/revert-bulk')
  async revertBulkExpansions(@Body() dto: BulkRevertExpansionDto) {
    try {
      const results = await this.acronimosService.revertBulkExpansions(dto.codigos, dto.bloquearFuturas);
      return {
        total: dto.codigos.length,
        revertidos: results.filter(r => r.success).length,
        errores: results.filter(r => !r.success).length,
        detalles: results
      };
    } catch (error) {
      this.logger.error(`Error al revertir expansiones masivas: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al revertir expansiones',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
} 