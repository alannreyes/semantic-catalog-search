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
    
    const query = `
      SELECT COUNT(*) as total_registros
      FROM ar0000
      WHERE (LEFT(ART_CODFAM, 2) <= '47')
        AND art_estreg = 'A'
    `;
    
    console.log('📋 Ejecutando consulta de conteo...\n');
    
    const result = await pool.request().query(query);
    
    console.log('✅ Resultado:');
    console.log(`   Total de registros activos (familias <= 47): ${result.recordset[0].total_registros}`);
    
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