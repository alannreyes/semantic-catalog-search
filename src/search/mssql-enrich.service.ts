import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

@Injectable()
export class MSSQLEnrichService {
  private readonly logger = new Logger(MSSQLEnrichService.name);
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
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
        connectionTimeout: 30000,
        requestTimeout: 30000,
      };

      this.logger.log('Conectando a MS SQL Server para enriquecimiento...');
      this.mssqlPool = new sql.ConnectionPool(config);
      await this.mssqlPool.connect();
      this.logger.log('Conexión a MS SQL establecida para enriquecimiento');

      this.mssqlPool.on('error', (err) => {
        this.logger.error('Error en conexión MS SQL:', err);
      });

      return this.mssqlPool;
    } catch (error) {
      this.logger.error(`Error al conectar con MS SQL: ${error.message}`);
      throw error;
    }
  }

  async getClientPurchaseHistory(cliente: string, codigos: string[]): Promise<Map<string, number>> {
    try {
      const pool = await this.connectToMsSQL();
      const codigosStr = codigos.map(c => `'${c}'`).join(',');
      
      const query = `
        SELECT 
          PE2_CODART as codigo,
          COUNT(DISTINCT a.pe2_numped) as frecuencia_compra
        FROM pe2000 a WITH(NOLOCK) 
        INNER JOIN pe1000 b WITH(NOLOCK) 
          ON a.pe2_tipdoc = b.pe1_tipdoc 
          AND a.pe2_numped = b.pe1_numped 
        WHERE pe2_fchped >= DATEADD(year,-1,GETDATE()) 
          AND PE2_ESTREG = 'A' 
          AND PE2_CODMOT <> '10' 
          AND b.PE1_FLGANU = '0' 
          AND LEFT(PE2_CODART,2) NOT IN ('jg') 
          AND b.PE1_CODCLI = @cliente 
          AND a.PE2_CODART IN (${codigosStr})
        GROUP BY PE2_CODART
      `;

      const result = await pool.request()
        .input('cliente', sql.VarChar, cliente)
        .query(query);

      const historyMap = new Map<string, number>();
      result.recordset.forEach(row => {
        historyMap.set(row.codigo, row.frecuencia_compra);
      });

      this.logger.log(`Historial de cliente ${cliente}: ${historyMap.size} productos con compras`);
      return historyMap;
    } catch (error) {
      this.logger.error(`Error obteniendo historial de cliente: ${error.message}`);
      return new Map();
    }
  }

  async getProductBrands(codigos: string[]): Promise<Map<string, string>> {
    try {
      const pool = await this.connectToMsSQL();
      const codigosStr = codigos.map(c => `'${c}'`).join(',');
      
      const query = `
        SELECT 
          ART_CODIGO as codigo,
          ART_CODMAR as marca
        FROM Ar0000 WITH(NOLOCK)
        WHERE ART_CODIGO IN (${codigosStr})
      `;

      const result = await pool.request().query(query);

      const brandMap = new Map<string, string>();
      result.recordset.forEach(row => {
        brandMap.set(row.codigo, row.marca);
      });

      this.logger.log(`Marcas obtenidas para ${brandMap.size} productos`);
      return brandMap;
    } catch (error) {
      this.logger.error(`Error obteniendo marcas: ${error.message}`);
      return new Map();
    }
  }

  async disconnect(): Promise<void> {
    if (this.mssqlPool) {
      await this.mssqlPool.close();
      this.mssqlPool = null;
    }
  }
}