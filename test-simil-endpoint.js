const axios = require('axios');

async function testSimilEndpoint() {
    const baseURL = 'http://192.168.2.6:4000';
    
    console.log('🧪 PROBANDO ENDPOINT SIMIL (SIMILITUD COSENO)\n');
    
    const testCases = [
        {
            name: "Textos idénticos",
            texto1: "PILA DURACELL AA",
            texto2: "PILA DURACELL AA",
            expected: "~1.00"
        },
        {
            name: "Textos muy similares",
            texto1: "PILA DURACELL AA",
            texto2: "BATERIA DURACELL AA",
            expected: ">0.90"
        },
        {
            name: "Mismo producto, orden diferente",
            texto1: "BROCHA NYLON 3\" TUMI",
            texto2: "TUMI BROCHA NYLON 3\"",
            expected: ">0.85"
        },
        {
            name: "Productos relacionados",
            texto1: "BROCHA TUMI 1/2\"",
            texto2: "BROCHA TUMI 3/4\"",
            expected: ">0.70"
        },
        {
            name: "Misma categoría, diferente marca",
            texto1: "PILA DURACELL AA",
            texto2: "PILA ENERGIZER AA",
            expected: ">0.70"
        },
        {
            name: "Productos completamente diferentes",
            texto1: "PILA DURACELL AA",
            texto2: "BROCHA TUMI 3\"",
            expected: "<0.50"
        },
        {
            name: "Variaciones de formato",
            texto1: "CINTA PVC 1.1/2\"",
            texto2: "CINTA PVC 1 1/2\"",
            expected: ">0.95"
        }
    ];
    
    for (const testCase of testCases) {
        try {
            console.log(`📋 ${testCase.name}`);
            console.log(`   Texto 1: "${testCase.texto1}"`);
            console.log(`   Texto 2: "${testCase.texto2}"`);
            
            const response = await axios.post(`${baseURL}/simil`, {
                texto1: testCase.texto1,
                texto2: testCase.texto2
            });
            
            const result = response.data;
            
            console.log(`   Similitud coseno: ${result} (esperado: ${testCase.expected})`);
            console.log('');
            
        } catch (error) {
            console.log(`   ❌ ERROR: ${error.response?.data?.message || error.message}`);
            console.log('');
        }
        
        // Pequeña pausa para no saturar la API de OpenAI
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('🎉 PRUEBAS COMPLETADAS');
}

// Ejecutar directamente
testSimilEndpoint().catch(console.error);