import { Controller, Body, Post, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { LogEntity } from './log.entity';

interface LogsQueryDto {
  fechaInicio: string;
  fechaFin?: string;
  endpoint?: string;
}

@Controller('logs')
export class LogsController {
  constructor(
    @InjectRepository(LogEntity)
    private readonly logRepository: Repository<LogEntity>,
  ) {}

  @Post()
  async getLogs(@Body() body: LogsQueryDto) {
    const { fechaInicio, fechaFin, endpoint } = body;
    if (!fechaInicio) {
      throw new BadRequestException('fechaInicio es obligatorio');
    }
    const start = new Date(fechaInicio);
    const end = fechaFin ? new Date(fechaFin) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Formato de fecha inválido');
    }
    const where: any = {
      fecha: Between(start, end),
    };
    if (endpoint) {
      where.endpoint = endpoint;
    }
    const logs = await this.logRepository.find({
      where,
      order: { fecha: 'ASC' },
    });
    return logs;
  }
}
