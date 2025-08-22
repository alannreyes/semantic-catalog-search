const axios = require('axios');

const API_URL = 'http://localhost:4000';

async function testSearchEndpoint() {
  console.log('🧪 Probando endpoint /search con diferentes configuraciones\n');
  
  const tests = [
    {
      name: 'Test 1: Búsqueda básica (sin cambios)',
      data: {
        query: 'martillo',
        limit: 3
      }
    },
    {
      name: 'Test 2: Con segmento (funcionalidad existente)',
      data: {
        query: 'martillo',
        limit: 3,
        segment: 'premium'
      }
    },
    {
      name: 'Test 3: Con cliente (nueva funcionalidad)',
      data: {
        query: 'martillo',
        limit: 3,
        cliente: '001149'
      }
    },
    {
      name: 'Test 4: Con marca (nueva funcionalidad)',
      data: {
        query: 'martillo',
        limit: 3,
        marca: 'stanley'
      }
    },
    {
      name: 'Test 5: Con todos los parámetros',
      data: {
        query: 'martillo',
        limit: 3,
        segment: 'premium',
        cliente: '001149',
        marca: 'stanley'
      }
    }
  ];

  for (const test of tests) {
    console.log(`📌 ${test.name}`);
    console.log(`   Parámetros:`, JSON.stringify(test.data));
    
    try {
      const response = await axios.post(`${API_URL}/search`, test.data);
      
      if (response.data && response.data.productos) {
        console.log(`   ✅ Respuesta OK - ${response.data.productos.length} productos encontrados`);
        if (response.data.productos[0]) {
          console.log(`   Primer resultado: ${response.data.productos[0].codigo} - ${response.data.productos[0].nombre}`);
        }
      } else {
        console.log(`   ⚠️ Respuesta sin productos`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      if (error.response && error.response.data) {
        console.log(`   Detalles:`, error.response.data);
      }
    }
    console.log('');
  }
}

testSearchEndpoint().catch(console.error);