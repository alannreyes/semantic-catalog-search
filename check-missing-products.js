const sql = require('mssql');
const { Pool } = require('pg');

// Configuración MS SQL
const mssqlConfig = {
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

// Configuración PostgreSQL
const pgPool = new Pool({
  connectionString: 'postgres://postgres:5965838aa16d2dab76fe@192.168.2.6:5432/tic?sslmode=disable'
});

async function checkMissingProducts() {
  let mssqlConnection;
  
  try {
    console.log('🔄 Conectando a ambas bases de datos...\n');
    
    // Conectar a MS SQL
    mssqlConnection = await sql.connect(mssqlConfig);
    console.log('✅ Conectado a MS SQL Server');
    
    // 1. Contar productos en MS SQL (familias <= 47, activos)
    const mssqlCountQuery = `
      SELECT COUNT(*) as total
      FROM ar0000
      WHERE LEFT(ART_CODFAM, 2) <= '47'
        AND art_estreg = 'A'
        AND ART_CODART NOT LIKE 'TP%'
    `;
    
    const mssqlCount = await mssqlConnection.request().query(mssqlCountQuery);
    console.log(`📊 MS SQL: ${mssqlCount.recordset[0].total} productos activos (familias <= 47)\n`);
    
    // 2. Contar productos en PostgreSQL
    const pgCountQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as con_embedding,
        COUNT(CASE WHEN embedding IS NULL THEN 1 END) as sin_embedding
      FROM productos_bip
    `;
    
    const pgCount = await pgPool.query(pgCountQuery);
    console.log(`📊 PostgreSQL productos_bip:`);
    console.log(`   - Total: ${pgCount.rows[0].total}`);
    console.log(`   - Con embedding: ${pgCount.rows[0].con_embedding}`);
    console.log(`   - Sin embedding: ${pgCount.rows[0].sin_embedding}\n`);
    
    // 3. Obtener muestra de códigos de MS SQL
    console.log('🔍 Obteniendo códigos de MS SQL...');
    const mssqlCodesQuery = `
      SELECT ART_CODART as codigo
      FROM ar0000
      WHERE LEFT(ART_CODFAM, 2) <= '47'
        AND art_estreg = 'A'
        AND ART_CODART NOT LIKE 'TP%'
      ORDER BY ART_CODART
    `;
    
    const mssqlCodes = await mssqlConnection.request().query(mssqlCodesQuery);
    const mssqlCodeSet = new Set(mssqlCodes.recordset.map(r => r.codigo.trim()));
    console.log(`   - Códigos en MS SQL: ${mssqlCodeSet.size}`);
    
    // 4. Obtener códigos de PostgreSQL
    console.log('🔍 Obteniendo códigos de PostgreSQL...');
    const pgCodesQuery = `SELECT codigo FROM productos_bip`;
    const pgCodes = await pgPool.query(pgCodesQuery);
    const pgCodeSet = new Set(pgCodes.rows.map(r => r.codigo));
    console.log(`   - Códigos en PostgreSQL: ${pgCodeSet.size}\n`);
    
    // 5. Encontrar diferencias
    console.log('📊 ANÁLISIS DE DIFERENCIAS:');
    console.log('=' .repeat(50));
    
    // Productos que faltan en PostgreSQL
    const missingInPG = [];
    for (const code of mssqlCodeSet) {
      if (!pgCodeSet.has(code)) {
        missingInPG.push(code);
      }
    }
    
    console.log(`\n❌ Productos en MS SQL que FALTAN en PostgreSQL: ${missingInPG.length}`);
    if (missingInPG.length > 0) {
      console.log('   Primeros 10 códigos faltantes:');
      missingInPG.slice(0, 10).forEach(code => {
        console.log(`   - ${code}`);
      });
      
      // Obtener detalles de algunos productos faltantes
      if (missingInPG.length > 0) {
        const sampleCodes = missingInPG.slice(0, 5).map(c => `'${c}'`).join(',');
        const detailsQuery = `
          SELECT ART_CODART, ART_DESART, ART_CODFAM
          FROM ar0000
          WHERE ART_CODART IN (${sampleCodes})
        `;
        
        const details = await mssqlConnection.request().query(detailsQuery);
        console.log('\n   Detalles de algunos productos faltantes:');
        details.recordset.forEach(prod => {
          console.log(`   - ${prod.ART_CODART}: ${prod.ART_DESART} (Fam: ${prod.ART_CODFAM})`);
        });
      }
    }
    
    // Productos extras en PostgreSQL (no deberían existir)
    const extraInPG = [];
    for (const code of pgCodeSet) {
      if (!mssqlCodeSet.has(code)) {
        extraInPG.push(code);
      }
    }
    
    if (extraInPG.length > 0) {
      console.log(`\n⚠️  Productos en PostgreSQL que NO ESTÁN en MS SQL: ${extraInPG.length}`);
      console.log('   Primeros 10 códigos:');
      extraInPG.slice(0, 10).forEach(code => {
        console.log(`   - ${code}`);
      });
    }
    
    // Resumen
    console.log('\n📊 RESUMEN FINAL:');
    console.log('=' .repeat(50));
    console.log(`✅ Productos sincronizados correctamente: ${mssqlCodeSet.size - missingInPG.length}`);
    console.log(`❌ Productos por sincronizar: ${missingInPG.length}`);
    console.log(`📈 Porcentaje sincronizado: ${((mssqlCodeSet.size - missingInPG.length) / mssqlCodeSet.size * 100).toFixed(2)}%`);
    
    // Guardar lista de faltantes en archivo
    if (missingInPG.length > 0) {
      const fs = require('fs');
      fs.writeFileSync('productos-faltantes.txt', missingInPG.join('\n'));
      console.log(`\n💾 Lista completa guardada en: productos-faltantes.txt`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.originalError) {
      console.error('Detalles:', err.originalError.message);
    }
  } finally {
    if (mssqlConnection) await mssqlConnection.close();
    await pgPool.end();
  }
}

checkMissingProducts();