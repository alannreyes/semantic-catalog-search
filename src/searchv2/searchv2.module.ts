import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchV2Controller } from './searchv2.controller';
import { SearchV2Service } from './searchv2.service';
import { AcronimosModule } from '../acronimos/acronimos.module';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogEntity } from '../logs/log.entity';
import { LoggerService } from '../logs/logger.service';

@Module({
  imports: [
    ConfigModule,
    AcronimosModule,
    TypeOrmModule.forFeature([LogEntity])
  ],
  controllers: [SearchV2Controller],
  providers: [
    SearchV2Service,
    OpenAIRateLimiterService,
    {
      provide: Logger,
      useValue: new Logger('SearchV2Module'),
    },
    LoggerService
  ],
  exports: [SearchV2Service],
})
export class SearchV2Module {}