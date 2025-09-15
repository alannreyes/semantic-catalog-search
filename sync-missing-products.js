const sql = require('mssql');
const { Pool } = require('pg');
const axios = require('axios');
const fs = require('fs');

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

// Configuración OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Función para obtener embedding de OpenAI
async function getEmbedding(text) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: text,
        model: 'text-embedding-3-large',
        dimensions: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    return response.data.data[0].embedding;
  } catch (error) {
    console.error(`❌ Error obteniendo embedding: ${error.message}`);
    throw error;
  }
}

// Función para esperar (rate limiting)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncMissingProducts(limit = 10) {
  let mssqlConnection;
  
  try {
    console.log('🔄 Iniciando sincronización de productos faltantes...\n');
    
    // Leer productos faltantes del archivo
    let missingProducts = [];
    if (fs.existsSync('productos-faltantes.txt')) {
      missingProducts = fs.readFileSync('productos-faltantes.txt', 'utf8')
        .split('\n')
        .filter(code => code.trim() !== '')
        .slice(0, limit); // Tomar solo los primeros N productos
    } else {
      console.error('❌ No se encontró el archivo productos-faltantes.txt');
      return;
    }
    
    console.log(`📋 Procesando ${missingProducts.length} productos...\n`);
    
    // Conectar a MS SQL
    mssqlConnection = await sql.connect(mssqlConfig);
    console.log('✅ Conectado a MS SQL Server\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < missingProducts.length; i++) {
      const codigo = missingProducts[i].trim();
      
      if (!codigo) {
        console.log(`⏭️  Saltando producto vacío`);
        continue;
      }
      
      console.log(`\n[${i + 1}/${missingProducts.length}] Procesando: ${codigo}`);
      
      try {
        // 1. Obtener datos del producto desde MS SQL
        const productQuery = `
          SELECT 
            ART_CODART as codigo,
            ART_DESART as descripcion,
            ART_CODFAM as familia,
            '' as marca,  -- No hay columna de marca en ar0000
            CASE WHEN ART_ESTREG = 'A' THEN 1 ELSE 0 END as articulo_stock,
            0 as lista_costos
          FROM ar0000
          WHERE ART_CODART = '${codigo}'
        `;
        
        const productResult = await mssqlConnection.request().query(productQuery);
        
        if (productResult.recordset.length === 0) {
          console.log(`   ⚠️  Producto no encontrado en MS SQL`);
          errorCount++;
          continue;
        }
        
        const product = productResult.recordset[0];
        console.log(`   📦 ${product.descripcion}`);
        
        // 2. Crear texto para embedding
        const textForEmbedding = `${product.codigo} ${product.descripcion} ${product.marca || ''}`.trim();
        console.log(`   📝 Texto para embedding: "${textForEmbedding.substring(0, 50)}..."`);
        
        // 3. Obtener embedding de OpenAI
        console.log(`   🤖 Obteniendo embedding de OpenAI...`);
        const embedding = await getEmbedding(textForEmbedding);
        console.log(`   ✅ Embedding obtenido (${embedding.length} dimensiones)`);
        
        // 4. Insertar en PostgreSQL
        const insertQuery = `
          INSERT INTO productos_bip (
            codigo,
            descripcion,
            familia,
            marca,
            articulo_stock,
            lista_costos,
            embedding
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (codigo) 
          DO UPDATE SET 
            descripcion = EXCLUDED.descripcion,
            marca = EXCLUDED.marca,
            articulo_stock = EXCLUDED.articulo_stock,
            lista_costos = EXCLUDED.lista_costos,
            embedding = EXCLUDED.embedding
        `;
        
        const embeddingString = `[${embedding.join(',')}]`;
        
        await pgPool.query(insertQuery, [
          product.codigo.trim(),
          product.descripcion,
          product.familia,
          product.marca || '',
          product.articulo_stock === 1,
          product.lista_costos === 1,
          embeddingString
        ]);
        
        console.log(`   ✅ Producto sincronizado exitosamente`);
        successCount++;
        
        // Rate limiting para OpenAI (3 requests per second max)
        await sleep(350);
        
      } catch (error) {
        console.error(`   ❌ Error procesando ${codigo}: ${error.message}`);
        errorCount++;
        
        // Si es error de rate limit, esperar más
        if (error.response?.status === 429) {
          console.log('   ⏰ Rate limit alcanzado, esperando 60 segundos...');
          await sleep(60000);
        }
      }
    }
    
    // Resumen
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMEN DE SINCRONIZACIÓN:');
    console.log('='.repeat(50));
    console.log(`✅ Productos sincronizados: ${successCount}`);
    console.log(`❌ Productos con error: ${errorCount}`);
    console.log(`📈 Tasa de éxito: ${(successCount / missingProducts.length * 100).toFixed(2)}%`);
    
    // Verificar el resultado
    console.log('\n🔍 Verificando sincronización...');
    const verifyQuery = `
      SELECT codigo, 
             CASE WHEN embedding IS NOT NULL THEN 'Sí' ELSE 'No' END as tiene_embedding
      FROM productos_bip
      WHERE codigo IN (${missingProducts.map(c => `'${c}'`).join(',')})
    `;
    
    const verifyResult = await pgPool.query(verifyQuery);
    console.log(`\nProductos verificados en PostgreSQL:`);
    verifyResult.rows.forEach(row => {
      console.log(`  - ${row.codigo}: Embedding = ${row.tiene_embedding}`);
    });
    
  } catch (err) {
    console.error('❌ Error general:', err.message);
  } finally {
    if (mssqlConnection) await mssqlConnection.close();
    await pgPool.end();
  }
}

// Ejecutar sincronización
// Parámetro: número de productos a sincronizar (default: 10)
const limit = process.argv[2] ? parseInt(process.argv[2]) : 10;
console.log(`\n🚀 Sincronizando ${limit} productos faltantes...\n`);
syncMissingProducts(limit);