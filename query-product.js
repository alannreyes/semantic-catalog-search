const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:5965838aa16d2dab76fe@192.168.2.6:5432/tic?sslmode=disable'
});

async function queryProduct() {
  try {
    const client = await pool.connect();
    console.log('✅ Conectado a PostgreSQL');
    
    // Buscar el producto específico
    const productCode = '36070020';
    console.log(`🔍 Buscando producto: ${productCode}`);
    
    const result = await client.query(`
      SELECT 
        codigo_efc,
        descripcion,
        marca,
        codfabrica,
        articulo_stock,
        lista_costos,
        segment,
        CASE 
          WHEN embedding IS NOT NULL THEN 'SÍ' 
          ELSE 'NO' 
        END as tiene_embedding
      FROM productos_1024 
      WHERE codigo_efc = $1
    `, [productCode]);
    
    if (result.rows.length > 0) {
      const product = result.rows[0];
      console.log('📦 PRODUCTO ENCONTRADO:');
      console.log(`- Código: ${product.codigo_efc}`);
      console.log(`- Descripción: ${product.descripcion}`);
      console.log(`- Marca: ${product.marca}`);
      console.log(`- Código fábrica: ${product.codfabrica}`);
      console.log(`- Stock: ${product.articulo_stock}`);
      console.log(`- Lista costos: ${product.lista_costos}`);
      console.log(`- Segmento: ${product.segment}`);
      console.log(`- Tiene embedding: ${product.tiene_embedding}`);
    } else {
      console.log('❌ Producto NO encontrado');
      
      // Buscar productos similares
      console.log('\n🔍 Buscando productos similares...');
      const similar = await client.query(`
        SELECT codigo_efc, descripcion, marca
        FROM productos_1024 
        WHERE codigo_efc LIKE $1 
           OR codigo_efc LIKE $2
        ORDER BY codigo_efc
        LIMIT 10
      `, [`${productCode}%`, `%${productCode}`]);
      
      if (similar.rows.length > 0) {
        console.log('📋 Productos similares encontrados:');
        similar.rows.forEach(row => {
          console.log(`- ${row.codigo_efc}: ${row.descripcion}`);
        });
      } else {
        console.log('❌ No se encontraron productos similares');
      }
    }
    
    client.release();
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

queryProduct();