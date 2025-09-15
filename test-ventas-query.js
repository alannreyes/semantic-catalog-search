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
      SELECT
          A.PE2_CODART as codigo,
          COUNT(*) as ventas_totales,
          COUNT(CASE WHEN B.PE1_FCHPED >= DATEADD(MONTH, -6, GETDATE()) THEN 1 END) as ventas_6_meses,
          COUNT(CASE WHEN B.PE1_FCHPED >= DATEADD(YEAR, -2, GETDATE()) THEN 1 END) as ventas_2_años,
          MAX(B.PE1_FCHPED) as ultima_venta
      FROM PE2000 A WITH(NOLOCK)
      INNER JOIN PE1000 B WITH(NOLOCK) ON B.PE1_NUMPED = A.PE2_NUMPED
      WHERE A.PE2_CODART IN ('05021391','34110542','42060762','36071323','03070286','A0016739','36040548','05020496','07990333','12010367')
        AND B.PE1_TIPDOC = 'PE'
        AND B.PE1_ESTREG = 'A'
        AND A.PE2_ESTREG = 'A'
      GROUP BY A.PE2_CODART
      ORDER BY COUNT(*) DESC
    `;
    
    console.log('📋 Ejecutando consulta de ventas...\n');
    
    const result = await pool.request().query(query);
    
    if (result.recordset.length > 0) {
      console.log('✅ Resultados encontrados:\n');
      console.log('Código      | Ventas Tot | Ventas 6m | Ventas 2a | Última Venta');
      console.log('------------|------------|-----------|-----------|-------------');
      
      result.recordset.forEach(row => {
        const ultimaVenta = row.ultima_venta ? new Date(row.ultima_venta).toLocaleDateString() : 'N/A';
        console.log(
          `${row.codigo.padEnd(11)} | ${String(row.ventas_totales).padEnd(10)} | ${String(row.ventas_6_meses).padEnd(9)} | ${String(row.ventas_2_años).padEnd(9)} | ${ultimaVenta}`
        );
      });
      
      console.log(`\nTotal de productos con ventas: ${result.recordset.length}`);
    } else {
      console.log('⚠️ No se encontraron ventas para estos productos');
    }
    
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