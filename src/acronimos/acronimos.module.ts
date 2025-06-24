import { Module } from '@nestjs/common';
import { AcronimosService } from './acronimos.service';
import { AcronimosController } from './acronimos.controller';
import { Pool } from 'pg';

@Module({
  controllers: [AcronimosController],
  providers: [
    AcronimosService,
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
  exports: [AcronimosService],
})
export class AcronimosModule {} 