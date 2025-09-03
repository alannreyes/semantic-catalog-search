import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchV2Controller } from './searchv2.controller';
import { SearchV2Service } from './searchv2.service';
import { AcronimosModule } from '../acronimos/acronimos.module';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';

@Module({
  imports: [
    ConfigModule,
    AcronimosModule
  ],
  controllers: [SearchV2Controller],
  providers: [
    SearchV2Service,
    OpenAIRateLimiterService,
    {
      provide: Logger,
      useValue: new Logger('SearchV2Module'),
    },
  ],
  exports: [SearchV2Service],
})
export class SearchV2Module {}