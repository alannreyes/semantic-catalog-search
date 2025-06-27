import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { MigrationModule } from '../migration/migration.module';
import { Pool } from 'pg';

@Module({
  imports: [MigrationModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    {
      provide: Pool,
      useFactory: () => {
        return new Pool({
          connectionString: process.env.DATABASE_URL,
        });
      },
    },
  ],
  exports: [SyncService],
})
export class SyncModule {}