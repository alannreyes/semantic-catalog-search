const sql = require('mssql');

const config = {
  server: '192.168.40.251',
  database: 'Desarrollo',
  user: 'BIP',
  password: 'Thrg6587$%',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  connectionTimeout: 30000,
  requestTimeout: 30000
};

async function testQuery() {
  try {
    console.log('🔄 Conectando a MS SQL Server...');
    const pool = await sql.connect(config);
    console.log('✅ Conexión exitosa\n');
    
    // Ejecutar la consulta específica
    console.log('📋 Ejecutando consulta:');
    console.log("SELECT ART_CODART, ART_DESART FROM ar0000 WHERE ART_CODART='42010853'\n");
    
    const result = await pool.request().query(`
      SELECT ART_CODART, ART_DESART
      FROM ar0000
      WHERE ART_CODART='42010853'
    `);
    
    if (result.recordset.length > 0) {
      console.log('✅ Resultado encontrado:');
      result.recordset.forEach(row => {
        console.log(`  - Código: ${row.ART_CODART}`);
        console.log(`  - Descripción: ${row.ART_DESART}`);
      });
    } else {
      console.log('⚠️ No se encontraron resultados para el código 42010853');
    }
    
    // Verificar si la tabla ar0000 existe y tiene datos
    console.log('\n📊 Información adicional de la tabla ar0000:');
    
    // Contar total de registros
    const countResult = await pool.request().query('SELECT COUNT(*) as total FROM ar0000');
    console.log(`  - Total de registros: ${countResult.recordset[0].total}`);
    
    // Ver algunos registros de ejemplo
    console.log('\n🔍 Primeros 5 artículos en ar0000:');
    const sampleResult = await pool.request().query(`
      SELECT TOP 5 ART_CODART, ART_DESART 
      FROM ar0000
      ORDER BY ART_CODART
    `);
    
    sampleResult.recordset.forEach(row => {
      console.log(`  - ${row.ART_CODART}: ${row.ART_DESART}`);
    });
    
    // Ver columnas disponibles
    console.log('\n📋 Columnas disponibles en ar0000:');
    const columnsResult = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'ar0000'
      ORDER BY ORDINAL_POSITION
    `);
    
    columnsResult.recordset.slice(0, 10).forEach(col => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
    });
    console.log(`  ... y ${columnsResult.recordset.length - 10} columnas más`);
    
    await pool.close();
    console.log('\n✅ Conexión cerrada');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.originalError) {
      console.error('Detalles:', err.originalError.message);
    }
  }
}

testQuery();