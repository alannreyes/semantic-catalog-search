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
          user: process.env.DB_USER,
          host: process.env.DB_HOST,
          database: process.env.DB_NAME,
          password: process.env.DB_PASSWORD,
          port: parseInt(process.env.DB_PORT || '5432'),
          // Configuración SSL para producción
          ssl: process.env.NODE_ENV === 'production' ? {
            rejectUnauthorized: true,
            ca: process.env.DB_CA_CERT,
            cert: process.env.DB_CLIENT_CERT,
            key: process.env.DB_CLIENT_KEY
          } : false,
        });
      },
    },
  ],
  exports: [MigrationService, DatabaseService],
})
export class MigrationModule {} 