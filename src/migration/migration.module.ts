import { Module } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';
import { DatabaseService } from './database.service';
import { AcronimosModule } from '../acronimos/acronimos.module';
import { Pool } from 'pg';

@Module({
  imports: [AcronimosModule],
  controllers: [MigrationController],
  providers: [
    MigrationService,
    DatabaseService,
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