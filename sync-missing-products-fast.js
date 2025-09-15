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

// Función para esperar (rate limiting optimizado)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncMissingProductsFast(startFrom = 1051, limit = null) {
  let mssqlConnection;
  
  try {
    console.log('🚀 Iniciando sincronización RÁPIDA de productos faltantes...\n');
    
    // Leer productos faltantes del archivo
    let missingProducts = [];
    if (fs.existsSync('productos-faltantes.txt')) {
      missingProducts = fs.readFileSync('productos-faltantes.txt', 'utf8')
        .split('\n')
        .filter(code => code.trim() !== '')
        .slice(startFrom - 1, limit ? startFrom - 1 + limit : undefined);
    } else {
      console.error('❌ No se encontró el archivo productos-faltantes.txt');
      return;
    }
    
    console.log(`📋 Procesando ${missingProducts.length} productos desde posición ${startFrom}...\n`);
    
    // Conectar a MS SQL
    mssqlConnection = await sql.connect(mssqlConfig);
    console.log('✅ Conectado a MS SQL Server\n');
    
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();
    
    for (let i = 0; i < missingProducts.length; i++) {
      const codigo = missingProducts[i].trim();
      const currentIndex = startFrom + i;
      
      if (!codigo) {
        console.log(`⏭️  Saltando producto vacío`);
        continue;
      }
      
      console.log(`\n[${currentIndex}/${2857}] Procesando: ${codigo}`);
      
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
        console.log(`   📦 ${product.descripcion.substring(0, 60)}...`);
        
        // 2. Crear texto para embedding
        const textForEmbedding = `${product.codigo} ${product.descripcion} ${product.marca || ''}`.trim();
        
        // 3. Obtener embedding de OpenAI
        console.log(`   🤖 Obteniendo embedding...`);
        const embedding = await getEmbedding(textForEmbedding);
        console.log(`   ✅ Embedding obtenido (${embedding.length}D)`);
        
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
        
        console.log(`   ✅ Sincronizado`);
        successCount++;
        
        // Rate limiting optimizado para OpenAI (50ms = 20 req/seg vs 350ms = 2.86 req/seg)
        await sleep(50);
        
        // Mostrar progreso cada 50 productos
        if (currentIndex % 50 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = successCount / elapsed * 60; // productos por minuto
          const remaining = 2857 - currentIndex;
          const eta = remaining / rate; // minutos restantes
          
          console.log(`\n📊 PROGRESO: ${currentIndex}/2857 (${((currentIndex/2857)*100).toFixed(1)}%)`);
          console.log(`⚡ Velocidad: ${rate.toFixed(1)} productos/min`);
          console.log(`⏰ ETA: ${eta.toFixed(1)} minutos\n`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error procesando ${codigo}: ${error.message}`);
        errorCount++;
        
        // Si es error de rate limit, esperar más
        if (error.response?.status === 429) {
          console.log('   ⏰ Rate limit alcanzado, esperando 10 segundos...');
          await sleep(10000);
        }
      }
    }
    
    // Resumen final
    const totalTime = (Date.now() - startTime) / 1000 / 60; // minutos
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMEN DE SINCRONIZACIÓN RÁPIDA:');
    console.log('='.repeat(50));
    console.log(`✅ Productos sincronizados: ${successCount}`);
    console.log(`❌ Productos con error: ${errorCount}`);
    console.log(`📈 Tasa de éxito: ${(successCount / missingProducts.length * 100).toFixed(2)}%`);
    console.log(`⏰ Tiempo total: ${totalTime.toFixed(1)} minutos`);
    console.log(`⚡ Velocidad promedio: ${(successCount / totalTime).toFixed(1)} productos/min`);
    
  } catch (err) {
    console.error('❌ Error general:', err.message);
  } finally {
    if (mssqlConnection) await mssqlConnection.close();
    await pgPool.end();
  }
}

// Ejecutar sincronización rápida
const startFrom = process.argv[2] ? parseInt(process.argv[2]) : 1051;
const limit = process.argv[3] ? parseInt(process.argv[3]) : null;

console.log(`\n🚀 Sincronización RÁPIDA desde posición ${startFrom}${limit ? ` (${limit} productos)` : ' (hasta el final)'}...\n`);
syncMissingProductsFast(startFrom, limit);