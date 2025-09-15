import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogEntity } from './log.entity';
import { LoggerService } from './logger.service';
import { LogsController } from './logs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LogEntity])],
  providers: [LoggerService],
  controllers: [LogsController],
  exports: [LoggerService],
})
export class LogsModule {}
