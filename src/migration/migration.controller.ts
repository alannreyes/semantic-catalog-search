import { Controller, Get, Post, Delete, Body, Param, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { ConfigService } from '@nestjs/config';

@Controller('migration')
export class MigrationController {
  private readonly logger = new Logger(MigrationController.name);

  constructor(
    private readonly migrationService: MigrationService,
    private readonly configService: ConfigService
  ) {}

  @Post('bulk-load')
  async createBulkLoadJob(@Body() config: any) {
    try {
      // Validar estructura básica
      if (!config.source || !config.destination || !config.processing) {
        throw new HttpException(
          'Configuración incompleta: se requieren source, destination y processing',
          HttpStatus.BAD_REQUEST
        );
      }

      // Aplicar valores por defecto desde variables de entorno
      const migrationConfig = {
        source: {
          type: config.source.type || 'mssql',
          connection: config.source.connection || {
            host: this.configService.get('MSSQL_HOST'),
            port: this.configService.get('MSSQL_PORT'),
            database: this.configService.get('MSSQL_DATABASE'),
            user: this.configService.get('MSSQL_USER'),
            password: this.configService.get('MSSQL_PASSWORD'),
          },
          table: config.source.table || this.configService.get('MSSQL_SOURCE_TABLE'),
          fields: config.source.fields || {
            codigo_efc: 'ART_CODART',
            descripcion: 'ART_DESART',
            marca: 'ART_PARAM3',
            codfabrica: 'ART_CODFABRICA',
            articulo_stock: 'ART_FLGSTKDIST',
            lista_costos: 'ART_FLGLSTPRE'
          },
          where_clause: config.source.where_clause || this.configService.get('MSSQL_WHERE_CLAUSE')
        },
        destination: {
          table: config.destination.table || this.configService.get('POSTGRES_MIGRATION_TABLE'),
          clean_before: config.destination.clean_before !== undefined ? config.destination.clean_before : false,
          create_indexes: config.destination.create_indexes !== undefined ? config.destination.create_indexes : true
        },
        processing: {
          batch_size: config.processing.batch_size || 500,
          embedding_batch_size: config.processing.embedding_batch_size || 50,
          max_concurrent_embeddings: config.processing.max_concurrent_embeddings || 3,
          delay_between_batches_ms: config.processing.delay_between_batches_ms || 1000,
          retry_attempts: config.processing.retry_attempts || 3,
          text_cleaning: {
            enabled: config.processing.text_cleaning?.enabled !== undefined ? config.processing.text_cleaning.enabled : true,
            acronym_mapping: config.processing.text_cleaning?.acronym_mapping || {}
          }
        },
        notifications: config.notifications || {
          progress_interval: 1000
        }
      };

      this.logger.log('Creando job de migración bulk-load');
      const job = await this.migrationService.createMigrationJob(migrationConfig);

      // Calcular estimación de tiempo
      const estimatedDurationHours = this.calculateEstimatedDuration(job.progress.total);

      return {
        job_id: job.id,
        status: job.status,
        estimated_total: job.progress.total,
        estimated_duration_hours: estimatedDurationHours,
        created_at: job.created_at
      };

    } catch (error) {
      this.logger.error(`Error al crear job bulk-load: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al crear job de migración',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('jobs/:jobId/status')
  async getJobStatus(@Param('jobId') jobId: string) {
    try {
      const job = await this.migrationService.getJobStatus(jobId);
      
      if (!job) {
        throw new HttpException('Job no encontrado', HttpStatus.NOT_FOUND);
      }

      // Calcular métricas adicionales
      const response = {
        job_id: job.id,
        status: job.status,
        progress: {
          ...job.progress,
          percentage: job.progress.total > 0 ? 
            Math.round((job.progress.processed / job.progress.total) * 100 * 100) / 100 : 0
        },
        timings: {
          created_at: job.created_at,
          started_at: job.started_at,
          completed_at: job.completed_at,
          estimated_completion: this.calculateEstimatedCompletion(job)
        },
        last_error: job.error_log.length > 0 ? job.error_log[job.error_log.length - 1] : null
      };

      return response;

    } catch (error) {
      this.logger.error(`Error al obtener status del job: ${error.message}`);
      if (error.status) throw error;
      throw new HttpException(
        error.message || 'Error al obtener status del job',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('jobs')
  async getAllJobs() {
    try {
      const jobs = await this.migrationService.getAllJobs();
      
      return jobs.map(job => ({
        job_id: job.id,
        status: job.status,
        progress: {
          total: job.progress.total,
          processed: job.progress.processed,
          percentage: job.progress.total > 0 ? 
            Math.round((job.progress.processed / job.progress.total) * 100 * 100) / 100 : 0
        },
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at
      }));

    } catch (error) {
      this.logger.error(`Error al obtener jobs: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al obtener jobs',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('jobs/:jobId/start')
  async startJob(@Param('jobId') jobId: string) {
    try {
      await this.migrationService.startMigration(jobId);
      
      return {
        message: `Migración iniciada para job ${jobId}`,
        status: 'running',
        job_id: jobId
      };

    } catch (error) {
      this.logger.error(`Error al iniciar job: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al iniciar job',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('jobs/:jobId/pause')
  async pauseJob(@Param('jobId') jobId: string) {
    try {
      await this.migrationService.pauseMigration(jobId);
      
      return {
        message: `Migración pausada para job ${jobId}`,
        status: 'paused',
        job_id: jobId
      };

    } catch (error) {
      this.logger.error(`Error al pausar job: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al pausar job',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('jobs/:jobId/resume')
  async resumeJob(@Param('jobId') jobId: string) {
    try {
      await this.migrationService.resumeMigration(jobId);
      
      return {
        message: `Migración reanudada para job ${jobId}`,
        status: 'running',
        job_id: jobId
      };

    } catch (error) {
      this.logger.error(`Error al reanudar job: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al reanudar job',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('jobs/:jobId/cancel')
  async cancelJob(@Param('jobId') jobId: string) {
    try {
      await this.migrationService.cancelMigration(jobId);
      
      return {
        message: `Migración cancelada para job ${jobId}`,
        status: 'cancelled',
        job_id: jobId
      };

    } catch (error) {
      this.logger.error(`Error al cancelar job: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al cancelar job',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete('jobs/:jobId')
  async deleteJob(@Param('jobId') jobId: string) {
    try {
      await this.migrationService.deleteJob(jobId);
      
      return {
        message: `Job ${jobId} eliminado exitosamente`,
        job_id: jobId
      };

    } catch (error) {
      this.logger.error(`Error al eliminar job: ${error.message}`);
      throw new HttpException(
        error.message || 'Error al eliminar job',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('test-connection')
  async testConnection() {
    try {
      const isConnected = await this.migrationService.testMsSqlConnection();
      return {
        mssql: isConnected,
        message: isConnected ? 'Conexión MS SQL exitosa' : 'Conexión MS SQL falló'
      };

    } catch (error) {
      this.logger.error(`Error en test de conexión: ${error.message}`);
      throw new HttpException(
        error.message || 'Error en test de conexión',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private calculateEstimatedDuration(totalRecords: number): number {
    // Estimación basada en: ~100 registros/minuto (incluyendo embeddings)
    const recordsPerMinute = 100;
    const estimatedMinutes = totalRecords / recordsPerMinute;
    return Math.round((estimatedMinutes / 60) * 100) / 100; // Horas con 2 decimales
  }

  private calculateEstimatedCompletion(job: any): string | null {
    if (!job.started_at || job.progress.processed === 0) {
      return null;
    }

    const now = new Date();
    const startTime = new Date(job.started_at);
    const elapsedMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
    const recordsPerMinute = job.progress.processed / elapsedMinutes;
    
    if (recordsPerMinute <= 0) return null;

    const remainingRecords = job.progress.total - job.progress.processed;
    const remainingMinutes = remainingRecords / recordsPerMinute;
    
    const estimatedCompletion = new Date(now.getTime() + (remainingMinutes * 60 * 1000));
    return estimatedCompletion.toISOString();
  }
} 