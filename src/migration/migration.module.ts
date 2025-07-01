import { Module } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';
import { ResumeMigrationService } from './resume-migration.service';
import { ResumeMigrationController } from './resume-migration.controller';
import { DatabaseService } from './database.service';
import { OpenAIRateLimiterService } from '../openai-rate-limiter.service';
import { AcronimosModule } from '../acronimos/acronimos.module';
import { Pool } from 'pg';

@Module({
  imports: [AcronimosModule],
  controllers: [MigrationController, ResumeMigrationController],
  providers: [
    MigrationService,
    ResumeMigrationService,
    DatabaseService,
    OpenAIRateLimiterService,
    {
      provide: Pool,
      useFactory: () => {
        return new Pool({
          connectionString: process.env.DATABASE_URL,
        });
      },
    },
  ],
  exports: [MigrationService, DatabaseService],
})
export class MigrationModule {} 