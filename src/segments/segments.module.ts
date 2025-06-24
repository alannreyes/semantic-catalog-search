import { Module } from '@nestjs/common';
import { SegmentsService } from './segments.service';
import { SegmentsController } from './segments.controller';
import { Pool } from 'pg';

@Module({
  controllers: [SegmentsController],
  providers: [
    SegmentsService,
    {
      provide: Pool,
      useFactory: () => {
        return new Pool({
          user: process.env.DB_USER,
          host: process.env.DB_HOST,
          database: process.env.DB_NAME,
          password: process.env.DB_PASSWORD,
          port: parseInt(process.env.DB_PORT || '5432'),
        });
      },
    },
  ],
  exports: [SegmentsService],
})
export class SegmentsModule {} 