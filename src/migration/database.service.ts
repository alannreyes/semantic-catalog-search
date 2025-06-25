import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private mssqlPool: sql.ConnectionPool | null = null;

  constructor(private readonly configService: ConfigService) {}

  async connectToMsSQL(): Promise<sql.ConnectionPool> {
    if (this.mssqlPool && this.mssqlPool.connected) {
      return this.mssqlPool;
    }

    try {
      const config: sql.config = {
        server: this.configService.get<string>('MSSQL_HOST'),
        port: this.configService.get<number>('MSSQL_PORT'),
        database: this.configService.get<string>('MSSQL_DATABASE'),
        user: this.configService.get<string>('MSSQL_USER'),
        password: this.configService.get<string>('MSSQL_PASSWORD'),
        options: {
          encrypt: false, // Servidor MSSQL no soporta SSL
          trustServerCertificate: true,
          enableArithAbort: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
        connectionTimeout: 60000,
        requestTimeout: 300000, // 5 minutos para queries largos
      };

      this.logger.log('Conectando a MS SQL Server...');
      this.mssqlPool = new sql.ConnectionPool(config);
      await this.mssqlPool.connect();
      this.logger.log('Conexión a MS SQL establecida exitosamente');

      // Manejar eventos de error
      this.mssqlPool.on('error', (err) => {
        this.logger.error('Error en conexión MS SQL:', err);
      });

      return this.mssqlPool;
    } catch (error) {
      this.logger.error(`Error al conectar con MS SQL: ${error.message}`);
      throw new Error(`Failed to connect to MS SQL: ${error.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const pool = await this.connectToMsSQL();
      const result = await pool.request().query('SELECT 1 as test');
      this.logger.log('Test de conexión MS SQL exitoso');
      return result.recordset[0].test === 1;
    } catch (error) {
      this.logger.error(`Error en test de conexión MS SQL: ${error.message}`);
      return false;
    }
  }

  async getTableInfo(tableName: string): Promise<any> {
    try {
      const pool = await this.connectToMsSQL();
      const result = await pool.request()
        .input('tableName', sql.VarChar, tableName)
        .query(`
          SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            CHARACTER_MAXIMUM_LENGTH
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = @tableName
          ORDER BY ORDINAL_POSITION
        `);
      
      return result.recordset;
    } catch (error) {
      this.logger.error(`Error al obtener info de tabla: ${error.message}`);
      throw error;
    }
  }

  async getRecordCount(tableName: string, whereClause?: string): Promise<number> {
    try {
      const pool = await this.connectToMsSQL();
      const query = `SELECT COUNT(*) as total FROM ${tableName}${whereClause ? ` WHERE ${whereClause}` : ''}`;
      
      const result = await pool.request().query(query);
      return result.recordset[0].total;
    } catch (error) {
      this.logger.error(`Error al contar registros: ${error.message}`);
      throw error;
    }
  }

  async getDataBatch(
    tableName: string, 
    fields: string[], 
    offset: number, 
    batchSize: number, 
    whereClause?: string
  ): Promise<any[]> {
    try {
      const pool = await this.connectToMsSQL();
      const fieldsStr = fields.join(', ');
      const query = `
        SELECT ${fieldsStr}
        FROM ${tableName}
        ${whereClause ? `WHERE ${whereClause}` : ''}
        ORDER BY ${fields[0]}
        OFFSET ${offset} ROWS
        FETCH NEXT ${batchSize} ROWS ONLY
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      this.logger.error(`Error al obtener lote de datos: ${error.message}`);
      throw error;
    }
  }

  async closeMsSQLConnection(): Promise<void> {
    if (this.mssqlPool) {
      try {
        await this.mssqlPool.close();
        this.mssqlPool = null;
        this.logger.log('Conexión MS SQL cerrada');
      } catch (error) {
        this.logger.error(`Error al cerrar conexión MS SQL: ${error.message}`);
      }
    }
  }

  // Cleanup al destruir el servicio
  async onModuleDestroy() {
    await this.closeMsSQLConnection();
  }
} 