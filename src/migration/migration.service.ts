import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from './database.service';
import { AcronimosService } from '../acronimos/acronimos.service';
import { TransactionHelper } from './transaction-helper';
import OpenAI from 'openai';

interface MigrationConfig {
  source: {
    type: string;
    connection: any;
    table: string;
    fields: Record<string, string>;
    where_clause?: string;
  };
  destination: {
    table: string;
    clean_before: boolean;
    create_indexes: boolean;
  };
  processing: {
    batch_size: number;
    embedding_batch_size: number;
    max_concurrent_embeddings: number;
    delay_between_batches_ms: number;
    retry_attempts: number;
    text_cleaning: {
      enabled: boolean;
      acronym_mapping?: Record<string, string>;
    };
  };
  notifications?: {
    progress_interval: number;
    webhook_url?: string;
  };
}

interface MigrationJob {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  source_config: MigrationConfig['source'];
  destination_config: MigrationConfig['destination'];
  processing_config: MigrationConfig['processing'];
  progress: {
    total: number;
    processed: number;
    errors: number;
    percentage: number;
    current_batch?: number;
    records_per_second?: number;
    estimated_remaining_minutes?: number;
  };
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error_log: string[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private readonly openai: OpenAI;
  private readonly embeddingModel: string;
  private readonly vectorDimensions: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly pgPool: Pool,
    private readonly databaseService: DatabaseService,
    private readonly acronimosService: AcronimosService
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL') || 'text-embedding-3-large';
    this.vectorDimensions = this.configService.get<number>('VECTOR_DIMENSIONS') || 1024;
  }

  async createMigrationJob(config: MigrationConfig): Promise<MigrationJob> {
    try {
      // Validar configuración
      await this.validateMigrationConfig(config);

      // Estimar total de registros
      const totalRecords = await this.databaseService.getRecordCount(
        config.source.table,
        config.source.where_clause
      );

      // Crear job en base de datos
      const result = await this.pgPool.query(
        `INSERT INTO migration_jobs (
          status, source_config, destination_config, processing_config, progress
        ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          'pending',
          JSON.stringify(config.source),
          JSON.stringify(config.destination),
          JSON.stringify(config.processing),
          JSON.stringify({
            total: totalRecords,
            processed: 0,
            errors: 0,
            percentage: 0
          })
        ]
      );

      const job = result.rows[0];
      this.logger.log(`Job de migración creado: ${job.id}, Total registros: ${totalRecords}`);

      return {
        id: job.id,
        status: job.status,
        source_config: job.source_config,
        destination_config: job.destination_config,
        processing_config: job.processing_config,
        progress: job.progress,
        created_at: job.created_at,
        error_log: job.error_log || []
      };

    } catch (error) {
      const errorMessage = error?.message || error?.toString() || 'Error desconocido';
      this.logger.error(`Error al crear job de migración: ${errorMessage}`, error.stack);
      throw new Error(`Failed to create migration job: ${errorMessage}`);
    }
  }

  async getJobStatus(jobId: string): Promise<MigrationJob | null> {
    try {
      const result = await this.pgPool.query(
        'SELECT * FROM migration_jobs WHERE id = $1',
        [jobId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const job = result.rows[0];
      return {
        id: job.id,
        status: job.status,
        source_config: job.source_config,
        destination_config: job.destination_config,
        processing_config: job.processing_config,
        progress: job.progress,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        error_log: job.error_log || []
      };

    } catch (error) {
      this.logger.error(`Error al obtener status del job: ${error.message}`);
      throw error;
    }
  }

  async getAllJobs(): Promise<MigrationJob[]> {
    try {
      const result = await this.pgPool.query(
        'SELECT * FROM migration_jobs ORDER BY created_at DESC LIMIT 50'
      );

      return result.rows.map(job => ({
        id: job.id,
        status: job.status,
        source_config: job.source_config,
        destination_config: job.destination_config,
        processing_config: job.processing_config,
        progress: job.progress,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        error_log: job.error_log || []
      }));

    } catch (error) {
      this.logger.error(`Error al obtener jobs: ${error.message}`);
      throw error;
    }
  }

  private async validateMigrationConfig(config: MigrationConfig): Promise<void> {
    // Validar conexión a fuente de datos
    const connectionTest = await this.databaseService.testConnection();
    if (!connectionTest) {
      throw new Error('No se puede conectar a la base de datos de origen');
    }

    // Validar que la tabla existe
    const tableInfo = await this.databaseService.getTableInfo(config.source.table);
    if (!tableInfo || tableInfo.length === 0) {
      throw new Error(`Tabla ${config.source.table} no encontrada`);
    }

    // Validar campos requeridos
    const requiredFields = Object.keys(config.source.fields);
    const tableColumns = tableInfo.map((col: any) => col.COLUMN_NAME);
    
    for (const field of Object.values(config.source.fields)) {
      if (!tableColumns.includes(field)) {
        throw new Error(`Campo ${field} no encontrado en tabla ${config.source.table}`);
      }
    }

    this.logger.log('Configuración de migración validada exitosamente');
  }

  async startMigration(jobId: string): Promise<void> {
    const job = await this.getJobStatus(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} no encontrado`);
    }

    if (job.status !== 'pending') {
      throw new Error(`Job ${jobId} no está en estado 'pending'. Estado actual: ${job.status}`);
    }

    this.logger.log(`Iniciando migración para job: ${jobId}`);
    
    // Ejecutar migración en background (no bloquear respuesta HTTP)
    this.processMigrationJob(job).catch(error => {
      this.logger.error(`Error en migración job ${jobId}: ${error.message}`);
    });
  }

  private async processMigrationJob(job: MigrationJob): Promise<void> {
    let client: any = null;
    
    try {
      // Actualizar status a 'running'
      await this.updateJobStatus(job.id, 'running', { started_at: new Date() });
      
      const startTime = Date.now();
      const batchSize = job.processing_config.batch_size;
      const totalRecords = job.progress.total;
      let processedRecords = 0;
      let errorCount = 0;

      this.logger.log(`Iniciando procesamiento de ${totalRecords} registros en lotes de ${batchSize}`);

      // Limpiar tabla destino si está configurado
      if (job.destination_config.clean_before) {
        await this.cleanDestinationTable(job.destination_config.table);
      }

             // Procesar por lotes
       for (let offset = 0; offset < totalRecords; offset += batchSize) {
         try {
           // Verificar flags de control (pause/cancel)
           const currentJob = await this.getJobStatus(job.id);
           if (currentJob) {
             const config = currentJob.processing_config as any;
             
             if (config.pause_requested) {
               this.logger.log(`Pausa solicitada para job ${job.id}. Pausando procesamiento.`);
               await this.updateJobStatus(job.id, 'paused');
               return;
             }
             
             if (config.cancel_requested) {
               this.logger.log(`Cancelación solicitada para job ${job.id}. Abortando procesamiento.`);
               await this.updateJobStatus(job.id, 'cancelled');
               return;
             }
           }

           const currentBatch = Math.floor(offset / batchSize) + 1;
           const totalBatches = Math.ceil(totalRecords / batchSize);
           
           this.logger.log(`Procesando lote ${currentBatch}/${totalBatches} (registros ${offset + 1}-${Math.min(offset + batchSize, totalRecords)})`);

           // 3.1: Leer datos de MS SQL
           const sourceData = await this.databaseService.getDataBatch(
             job.source_config.table,
             Object.values(job.source_config.fields),
             offset,
             batchSize,
             job.source_config.where_clause
           );

           if (sourceData.length === 0) {
             this.logger.log(`No hay más datos para procesar. Finalizando en offset ${offset}`);
             break;
           }

          // 3.2: Traducir acrónimos y limpiar texto
          const cleanedData = await this.processTextCleaning(sourceData, job.source_config.fields, job.processing_config.text_cleaning);

          // 3.3: Generar embeddings
          const dataWithEmbeddings = await this.generateEmbeddings(cleanedData, job.processing_config);

          // 3.4: Insertar en PostgreSQL con transacciones
          const { insertedCount, errors } = await TransactionHelper.insertBatchWithTransaction(
            this.pgPool,
            job.destination_config.table,
            dataWithEmbeddings,
            job.source_config.fields
          );
          
          if (errors.length > 0) {
            errorCount += errors.length;
            this.logger.warn(`${errors.length} errores en batch ${currentBatch}`);
          }

          processedRecords += insertedCount;

          // Actualizar progreso
          const percentage = Math.round((processedRecords / totalRecords) * 100 * 100) / 100;
          const elapsedMinutes = (Date.now() - startTime) / (1000 * 60);
          const recordsPerSecond = elapsedMinutes > 0 ? Math.round(processedRecords / (elapsedMinutes * 60) * 100) / 100 : 0;
          const estimatedRemainingMinutes = recordsPerSecond > 0 ? Math.round((totalRecords - processedRecords) / (recordsPerSecond * 60)) : null;

          await this.updateJobProgress(job.id, {
            processed: processedRecords,
            errors: errorCount,
            percentage,
            current_batch: currentBatch,
            records_per_second: recordsPerSecond,
            estimated_remaining_minutes: estimatedRemainingMinutes
          });

          // Delay entre lotes para no sobrecargar sistemas
          if (job.processing_config.delay_between_batches_ms > 0) {
            await this.sleep(job.processing_config.delay_between_batches_ms);
          }

        } catch (batchError) {
          errorCount++;
          this.logger.error(`Error en lote ${offset}: ${batchError.message}`);
          
          // Registrar error pero continuar con siguiente lote
          await this.addJobError(job.id, `Lote ${offset}: ${batchError.message}`);
          
          // Si hay demasiados errores consecutivos, fallar job
          if (errorCount > job.processing_config.retry_attempts) {
            throw new Error(`Demasiados errores en lotes (${errorCount}). Abortando migración.`);
          }
        }
      }

      // Crear índices si está configurado
      if (job.destination_config.create_indexes) {
        await this.createDestinationIndexes(job.destination_config.table);
      }

      // Marcar como completado
      await this.updateJobStatus(job.id, 'completed', { 
        completed_at: new Date(),
        final_stats: {
          total_processed: processedRecords,
          total_errors: errorCount,
          duration_minutes: Math.round((Date.now() - startTime) / (1000 * 60))
        }
      });

      this.logger.log(`Migración completada. Procesados: ${processedRecords}/${totalRecords}, Errores: ${errorCount}`);

    } catch (error) {
      this.logger.error(`Error crítico en migración: ${error.message}`);
      await this.updateJobStatus(job.id, 'failed', { 
        error_message: error.message,
        failed_at: new Date()
      });
             throw error;
     }
   }

   // 🔧 Métodos auxiliares para el procesamiento

   private async updateJobStatus(jobId: string, status: string, additionalFields: any = {}): Promise<void> {
     try {
       const updateFields = ['status = $2'];
       const values = [jobId, status];
       let valueIndex = 3;

       for (const [key, value] of Object.entries(additionalFields)) {
         updateFields.push(`${key} = $${valueIndex}`);
         values.push(value as string);
         valueIndex++;
       }

       const query = `UPDATE migration_jobs SET ${updateFields.join(', ')} WHERE id = $1`;
       await this.pgPool.query(query, values);
       
       this.logger.log(`Job ${jobId} actualizado a status: ${status}`);
     } catch (error) {
       this.logger.error(`Error al actualizar job status: ${error.message}`);
       throw error;
     }
   }

   private async updateJobProgress(jobId: string, progress: any): Promise<void> {
     try {
       await this.pgPool.query(
         'UPDATE migration_jobs SET progress = $2 WHERE id = $1',
         [jobId, JSON.stringify(progress)]
       );
     } catch (error) {
       this.logger.error(`Error al actualizar progreso: ${error.message}`);
     }
   }

   private async addJobError(jobId: string, errorMessage: string): Promise<void> {
     try {
       await this.pgPool.query(
         'UPDATE migration_jobs SET error_log = array_append(COALESCE(error_log, ARRAY[]::text[]), $2) WHERE id = $1',
         [jobId, errorMessage]
       );
     } catch (error) {
       this.logger.error(`Error al agregar error log: ${error.message}`);
     }
   }

   private async cleanDestinationTable(tableName: string): Promise<void> {
     try {
       this.logger.log(`Limpiando tabla destino: ${tableName}`);
       await this.pgPool.query(`TRUNCATE TABLE ${tableName}`);
       this.logger.log(`Tabla ${tableName} limpiada exitosamente`);
     } catch (error) {
       this.logger.error(`Error al limpiar tabla: ${error.message}`);
       throw error;
     }
   }

   // 3.2: Traducción de acrónimos y limpieza de texto
   private async processTextCleaning(
     sourceData: any[], 
     fieldMapping: Record<string, string>, 
     cleaningConfig: any
   ): Promise<any[]> {
     if (!cleaningConfig.enabled) {
       return sourceData;
     }

     this.logger.log(`Procesando limpieza de texto para ${sourceData.length} registros`);
     
     const cleanedData = [];
     for (const record of sourceData) {
       const cleanedRecord = { ...record };
       
               // Limpiar campo descripción si existe
        const descripcionField = fieldMapping.descripcion;
        const codigoField = fieldMapping.codigo;
        
        if (descripcionField && record[descripcionField]) {
          const originalText = String(record[descripcionField]);
          const codigo = codigoField ? String(record[codigoField]) : null;
          
          // Verificar si la expansión está bloqueada para este producto
          let translatedText = originalText;
          let expansionBloqueada = false;
          
          if (codigo) {
            const blockCheck = await this.pgPool.query(
              'SELECT expansion_bloqueada FROM productos_1024 WHERE codigo = $1',
              [codigo]
            );
            expansionBloqueada = blockCheck.rows[0]?.expansion_bloqueada || false;
          }
          
          // Solo expandir si no está bloqueada
          if (!expansionBloqueada) {
            translatedText = await this.acronimosService.translateText(originalText);
          }
          
          // Guardar texto original para la base de datos y texto traducido para embedding
          cleanedRecord[descripcionField] = originalText; // Original para DB
          cleanedRecord._translated_descripcion = translatedText; // Traducido para embedding
          cleanedRecord._expansion_info = {
            aplicada: originalText !== translatedText,
            bloqueada: expansionBloqueada
          };
          
          if (originalText !== translatedText) {
            this.logger.debug(`Texto traducido: "${originalText}" -> "${translatedText}"`);
          } else if (expansionBloqueada) {
            this.logger.debug(`Expansión bloqueada para código: ${codigo}`);
          }
        }
       
       cleanedData.push(cleanedRecord);
     }

     return cleanedData;
   }

   // 3.3: Generación de embeddings
   private async generateEmbeddings(cleanedData: any[], processingConfig: any): Promise<any[]> {
     this.logger.log(`Generando embeddings para ${cleanedData.length} registros`);
     
     const dataWithEmbeddings = [];
     const embeddingBatchSize = processingConfig.embedding_batch_size;
     
     // Procesar en sublotes para respetar rate limits de OpenAI
     for (let i = 0; i < cleanedData.length; i += embeddingBatchSize) {
       const batch = cleanedData.slice(i, i + embeddingBatchSize);
       const batchNumber = Math.floor(i / embeddingBatchSize) + 1;
       const totalBatches = Math.ceil(cleanedData.length / embeddingBatchSize);
       
       this.logger.log(`Generando embeddings - sublote ${batchNumber}/${totalBatches}`);
       
       try {
                   // Preparar textos para embedding (usar texto traducido)
          const textsForEmbedding = batch.map(record => {
            const translated = record._translated_descripcion;
            if (translated) return String(translated);
            
            const firstTextValue = Object.values(record)[1];
            return firstTextValue ? String(firstTextValue) : '';
          });

         // Generar embeddings en paralelo pero limitado
         const embeddingPromises = textsForEmbedding.map(async (text, index) => {
           if (!text.trim()) return null;
           
           try {
             const embeddingParams: any = { 
               model: this.embeddingModel, 
               input: text.trim()
             };

             if (this.embeddingModel.includes('text-embedding-3')) {
               embeddingParams.dimensions = this.vectorDimensions;
             }

             const response = await this.openai.embeddings.create(embeddingParams);
             return response.data[0].embedding;
           } catch (error) {
             this.logger.error(`Error generando embedding para texto "${text.substring(0, 50)}...": ${error.message}`);
             return null;
           }
         });

         const embeddings = await Promise.all(embeddingPromises);

         // Combinar datos con embeddings
         for (let j = 0; j < batch.length; j++) {
           const record = { ...batch[j] };
           record._embedding = embeddings[j];
           dataWithEmbeddings.push(record);
         }

         // Delay entre sublotes para respetar rate limits
         if (i + embeddingBatchSize < cleanedData.length) {
           await this.sleep(1000); // 1 segundo entre sublotes
         }

       } catch (error) {
         this.logger.error(`Error en sublote de embeddings: ${error.message}`);
         // Continuar con null embeddings para no perder el lote completo
         for (const record of batch) {
           const recordWithNullEmbedding = { ...record };
           recordWithNullEmbedding._embedding = null;
           dataWithEmbeddings.push(recordWithNullEmbedding);
         }
       }
     }

     return dataWithEmbeddings;
   }

   // 3.4: Inserción en PostgreSQL
   private async insertBatchToPostgreSQL(
     dataWithEmbeddings: any[], 
     destinationTable: string, 
     fieldMapping: Record<string, string>
   ): Promise<number> {
     if (dataWithEmbeddings.length === 0) return 0;

     this.logger.log(`Insertando ${dataWithEmbeddings.length} registros en ${destinationTable}`);
     
     try {
       const destinationFields = Object.keys(fieldMapping);
       const sourceFields = Object.values(fieldMapping);
       
       // Agregar campo embedding
       destinationFields.push('embedding');
       
       const placeholders = destinationFields.map((_, index) => `$${index + 1}`).join(', ');
       const query = `
         INSERT INTO ${destinationTable} (${destinationFields.join(', ')}) 
         VALUES (${placeholders})
         ON CONFLICT (codigo_efc) DO UPDATE SET
         ${destinationFields.filter(f => f !== 'codigo_efc').map(f => `${f} = EXCLUDED.${f}`).join(', ')}
       `;

       let insertedCount = 0;
       
       for (const record of dataWithEmbeddings) {
         try {
           const values = [];
           
           // Mapear campos según fieldMapping
           for (const [destField, sourceField] of Object.entries(fieldMapping)) {
             let value = record[sourceField];
             
             // Convertir valores según tipo de campo
             if (destField === 'articulo_stock' || destField === 'lista_costos') {
               value = value ? 1 : 0;
             }
             
             values.push(value);
           }
           
           // Agregar embedding
           const embedding = record._embedding;
           if (embedding && Array.isArray(embedding)) {
             values.push(`[${embedding.join(',')}]`);
           } else {
             values.push(null);
           }

           await this.pgPool.query(query, values);
           insertedCount++;
           
         } catch (recordError) {
           this.logger.error(`Error insertando registro: ${recordError.message}`);
           // Continuar con siguiente registro
         }
       }

       this.logger.log(`Insertados ${insertedCount}/${dataWithEmbeddings.length} registros exitosamente`);
       return insertedCount;

     } catch (error) {
       this.logger.error(`Error en inserción batch: ${error.message}`);
       throw error;
     }
   }

   private async createDestinationIndexes(tableName: string): Promise<void> {
     try {
       this.logger.log(`Creando índices para tabla ${tableName}`);
       
       // Índice vectorial para embeddings (si no existe)
       await this.pgPool.query(`
         CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding 
         ON ${tableName} USING ivfflat (embedding vector_cosine_ops) 
         WITH (lists = 100)
       `);
       
       // Índice para código EFC
       await this.pgPool.query(`
         CREATE INDEX IF NOT EXISTS idx_${tableName}_codigo_efc 
         ON ${tableName} (codigo_efc)
       `);

       this.logger.log(`Índices creados para ${tableName}`);
     } catch (error) {
       this.logger.error(`Error creando índices: ${error.message}`);
       // No lanzar error, los índices son opcionales
     }
   }

   private sleep(ms: number): Promise<void> {
     return new Promise(resolve => setTimeout(resolve, ms));
   }

   // 🎛️ Métodos de control avanzado de migraciones

   async pauseMigration(jobId: string): Promise<void> {
     const job = await this.getJobStatus(jobId);
     if (!job) {
       throw new Error(`Job ${jobId} no encontrado`);
     }

     if (job.status !== 'running') {
       throw new Error(`Job ${jobId} no está en ejecución. Estado actual: ${job.status}`);
     }

     try {
       await this.updateJobStatus(jobId, 'paused', { paused_at: new Date() });
       
       // Marcar flag de pausa para el procesamiento
       await this.pgPool.query(
         'UPDATE migration_jobs SET processing_config = processing_config || $2 WHERE id = $1',
         [jobId, JSON.stringify({ pause_requested: true })]
       );

       this.logger.log(`Job ${jobId} marcado para pausa`);
     } catch (error) {
       this.logger.error(`Error pausando job: ${error.message}`);
       throw error;
     }
   }

   async resumeMigration(jobId: string): Promise<void> {
     const job = await this.getJobStatus(jobId);
     if (!job) {
       throw new Error(`Job ${jobId} no encontrado`);
     }

     if (job.status !== 'paused') {
       throw new Error(`Job ${jobId} no está pausado. Estado actual: ${job.status}`);
     }

     try {
       await this.updateJobStatus(jobId, 'running', { resumed_at: new Date() });
       
               // Quitar flag de pausa
        const updatedConfig = { ...job.processing_config } as any;
        delete updatedConfig.pause_requested;
       
       await this.pgPool.query(
         'UPDATE migration_jobs SET processing_config = $2 WHERE id = $1',
         [jobId, JSON.stringify(updatedConfig)]
       );

       // Reanudar procesamiento en background
       this.processMigrationJob(job).catch(error => {
         this.logger.error(`Error reanudando migración job ${jobId}: ${error.message}`);
       });

       this.logger.log(`Job ${jobId} reanudado`);
     } catch (error) {
       this.logger.error(`Error reanudando job: ${error.message}`);
       throw error;
     }
   }

   async cancelMigration(jobId: string): Promise<void> {
     const job = await this.getJobStatus(jobId);
     if (!job) {
       throw new Error(`Job ${jobId} no encontrado`);
     }

     if (!['running', 'paused', 'pending'].includes(job.status)) {
       throw new Error(`Job ${jobId} no puede ser cancelado. Estado actual: ${job.status}`);
     }

     try {
       await this.updateJobStatus(jobId, 'cancelled', { 
         cancelled_at: new Date(),
         cancellation_reason: 'Usuario canceló la migración'
       });

       // Marcar flag de cancelación
       await this.pgPool.query(
         'UPDATE migration_jobs SET processing_config = processing_config || $2 WHERE id = $1',
         [jobId, JSON.stringify({ cancel_requested: true })]
       );

       this.logger.log(`Job ${jobId} cancelado por usuario`);
     } catch (error) {
       this.logger.error(`Error cancelando job: ${error.message}`);
       throw error;
     }
   }

   async deleteJob(jobId: string): Promise<void> {
     const job = await this.getJobStatus(jobId);
     if (!job) {
       throw new Error(`Job ${jobId} no encontrado`);
     }

     if (['running', 'pending'].includes(job.status)) {
       throw new Error(`No se puede eliminar job ${jobId} mientras está en ejecución. Primero cancélelo.`);
     }

     try {
       await this.pgPool.query('DELETE FROM migration_jobs WHERE id = $1', [jobId]);
       this.logger.log(`Job ${jobId} eliminado exitosamente`);
     } catch (error) {
       this.logger.error(`Error eliminando job: ${error.message}`);
       throw error;
     }
   }

   async testMsSqlConnection(): Promise<boolean> {
     try {
       return await this.databaseService.testConnection();
     } catch (error) {
       this.logger.error(`Error en test de conexión MS SQL: ${error.message}`);
       return false;
     }
   }
 } 