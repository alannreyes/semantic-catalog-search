import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LogEntity } from './log.entity';

@Injectable()
export class LoggerService {
  constructor(
    @InjectRepository(LogEntity)
    private readonly logRepository: Repository<LogEntity>,
  ) {}

  async logQuery(endpoint: string, body: any, resultado: any): Promise<void> {
    const log = this.logRepository.create({
      fecha: new Date(),
      endpoint,
      body,
      resultado,
    });
    await this.logRepository.save(log);
  }
}
