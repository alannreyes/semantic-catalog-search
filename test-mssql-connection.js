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

async function testConnection() {
  try {
    console.log('🔄 Conectando a MS SQL Server...');
    console.log('Server:', config.server);
    console.log('Database:', config.database);
    console.log('User:', config.user);
    
    const pool = await sql.connect(config);
    console.log('✅ Conexión exitosa a MS SQL Server');
    
    // Listar todas las tablas
    console.log('\n📋 Listando tablas disponibles:');
    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    
    console.log(`\nTotal de tablas encontradas: ${tablesResult.recordset.length}`);
    
    // Buscar tablas que podrían contener artículos
    const articleTables = tablesResult.recordset.filter(t => 
      t.TABLE_NAME.toLowerCase().includes('ar') || 
      t.TABLE_NAME.toLowerCase().includes('articulo') ||
      t.TABLE_NAME.toLowerCase().includes('producto') ||
      t.TABLE_NAME.toLowerCase().includes('item')
    );
    
    console.log('\n🔍 Tablas que podrían contener artículos:');
    articleTables.forEach(table => {
      console.log(`  - ${table.TABLE_NAME}`);
    });
    
    // Buscar específicamente Ar0001
    const ar0001Exists = tablesResult.recordset.find(t => t.TABLE_NAME === 'Ar0001');
    if (ar0001Exists) {
      console.log('\n✅ Tabla Ar0001 encontrada');
      
      // Ver estructura de Ar0001
      const columnsResult = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'Ar0001'
        ORDER BY ORDINAL_POSITION
      `);
      
      console.log('\n📊 Estructura de Ar0001:');
      columnsResult.recordset.forEach(col => {
        console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE}${col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : ''}`);
      });
      
      // Contar registros
      const countResult = await pool.request().query('SELECT COUNT(*) as total FROM Ar0001');
      console.log(`\n📈 Total de registros en Ar0001: ${countResult.recordset[0].total}`);
      
    } else {
      console.log('\n❌ Tabla Ar0001 NO encontrada');
      
      // Mostrar las primeras 20 tablas como referencia
      console.log('\n📋 Primeras 20 tablas en la base de datos:');
      tablesResult.recordset.slice(0, 20).forEach(table => {
        console.log(`  - ${table.TABLE_NAME}`);
      });
    }
    
    await pool.close();
    console.log('\n✅ Conexión cerrada correctamente');
    
  } catch (err) {
    console.error('❌ Error conectando a MS SQL:', err.message);
    if (err.code) {
      console.error('Código de error:', err.code);
    }
  }
}

testConnection();