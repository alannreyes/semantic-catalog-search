const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.MSSQL_USER || 'BIP',
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_HOST || '192.168.40.251',
  database: process.env.MSSQL_DATABASE || 'Desarrollo',
  port: parseInt(process.env.MSSQL_PORT || '1433'),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  connectionTimeout: 30000,
  requestTimeout: 30000
};

async function testQueries() {
  let pool;
  
  try {
    console.log('🔌 Conectando a MS SQL Server...');
    pool = await sql.connect(config);
    console.log('✅ Conectado exitosamente\n');

    // Test 1: Query original del DBA
    console.log('📊 Test 1: Query original del DBA');
    console.log('----------------------------------------');
    const result1 = await pool.request()
      .input('cliente', sql.VarChar, '001149')
      .input('articulo', sql.VarChar, '42060762')
      .query(`
        SELECT COUNT(DISTINCT a.pe2_numped) as CantidadVeces 
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
          AND a.PE2_CODART = @articulo
      `);
    console.log('Resultado:', result1.recordset[0]);
    console.log('');

    // Test 2: Obtener frecuencia para múltiples códigos
    console.log('📊 Test 2: Frecuencia de compra para múltiples códigos');
    console.log('----------------------------------------');
    const codigos = ['42060762', '42060761', '42060760']; // Códigos de ejemplo
    const codigosStr = codigos.map(c => `'${c}'`).join(',');
    
    const result2 = await pool.request()
      .input('cliente', sql.VarChar, '001149')
      .query(`
        SELECT 
          PE2_CODART as codigo,
          COUNT(DISTINCT a.pe2_numped) as frecuencia_compra,
          SUM(CAST(PE2_CANTID AS FLOAT)) as cantidad_total
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
        ORDER BY frecuencia_compra DESC
      `);
    console.log('Resultados:');
    result2.recordset.forEach(row => {
      console.log(`  ${row.codigo}: ${row.frecuencia_compra} pedidos, ${row.cantidad_total || 0} unidades`);
    });
    console.log('');

    // Test 3: Explorar tabla de artículos para marca
    console.log('📊 Test 3: Buscar información de marca en Ar0000');
    console.log('----------------------------------------');
    const result3 = await pool.request()
      .query(`
        SELECT TOP 5 
          ART_CODIGO,
          ART_NOMBRE,
          ART_CODFAM,
          ART_CODMAR,
          ART_CODLIN,
          ART_CODMOD
        FROM Ar0000 WITH(NOLOCK)
        WHERE ART_CODIGO IN ('42060762', '42060761', '42060760')
      `);
    console.log('Estructura de tabla Ar0000:');
    result3.recordset.forEach(row => {
      console.log(`  ${row.ART_CODIGO}: ${row.ART_NOMBRE}`);
      console.log(`    Familia: ${row.ART_CODFAM}, Marca: ${row.ART_CODMAR}, Línea: ${row.ART_CODLIN}`);
    });
    console.log('');

    // Test 4: Verificar si existe tabla de marcas
    console.log('📊 Test 4: Buscar tabla de marcas');
    console.log('----------------------------------------');
    const result4 = await pool.request()
      .query(`
        SELECT TOP 5 * 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_NAME LIKE '%MAR%' 
          OR TABLE_NAME LIKE '%BRAND%'
          OR TABLE_NAME LIKE '%MARCA%'
      `);
    console.log('Tablas relacionadas con marcas:');
    result4.recordset.forEach(row => {
      console.log(`  ${row.TABLE_NAME} (${row.TABLE_TYPE})`);
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.originalError) {
      console.error('   Detalles:', err.originalError.message);
    }
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n🔌 Conexión cerrada');
    }
  }
}

// Ejecutar tests
testQueries().catch(console.error);