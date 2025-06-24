import { Controller, Get, Post, Put, Delete, Body, Param, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { SegmentsService } from './segments.service';

@Controller('segments')
export class SegmentsController {
  private readonly logger = new Logger(SegmentsController.name);

  constructor(private readonly segmentsService: SegmentsService) {}

  @Get()
  async findAll() {
    try {
      return await this.segmentsService.findAll();
    } catch (error) {
      this.logger.error(`Error al obtener segmentos: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al obtener segmentos',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':marca')
  async findByMarca(@Param('marca') marca: string) {
    try {
      const segment = await this.segmentsService.findByMarca(marca);
      if (!segment) {
        throw new HttpException('Marca no encontrada', HttpStatus.NOT_FOUND);
      }
      return segment;
    } catch (error) {
      this.logger.error(`Error al buscar segmento por marca: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al buscar segmento',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post()
  async create(
    @Body() body: { marca: string; segment: 'premium' | 'standard' | 'economy' }
  ) {
    try {
      if (!body.marca || !body.segment) {
        throw new HttpException(
          'Marca y segmento son requeridos',
          HttpStatus.BAD_REQUEST
        );
      }
      return await this.segmentsService.create(body.marca, body.segment);
    } catch (error) {
      this.logger.error(`Error al crear segmento: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al crear segmento',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Put(':marca')
  async update(
    @Param('marca') marca: string,
    @Body() body: { segment: 'premium' | 'standard' | 'economy' }
  ) {
    try {
      if (!body.segment) {
        throw new HttpException('Segmento es requerido', HttpStatus.BAD_REQUEST);
      }
      const result = await this.segmentsService.update(marca, body.segment);
      if (!result) {
        throw new HttpException('Marca no encontrada', HttpStatus.NOT_FOUND);
      }
      return result;
    } catch (error) {
      this.logger.error(`Error al actualizar segmento: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al actualizar segmento',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete(':marca')
  async delete(@Param('marca') marca: string) {
    try {
      const result = await this.segmentsService.delete(marca);
      if (!result) {
        throw new HttpException('Marca no encontrada', HttpStatus.NOT_FOUND);
      }
      return result;
    } catch (error) {
      this.logger.error(`Error al eliminar segmento: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al eliminar segmento',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
} 