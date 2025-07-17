const axios = require('axios');

async function testDimensionsEndpoint() {
    const baseURL = 'http://192.168.2.6:4000';
    
    console.log('🧪 PROBANDO ENDPOINT DIMENSIONS\n');
    
    const testCases = [
        {
            name: "Herramientas básicas",
            data: [
                {
                    "cod_articulo": "STAN-001",
                    "unico_articulo": "12345",
                    "descripcion": "MARTILLO STANLEY 16 OZ MANGO FIBRA",
                    "unidad": "PZA",
                    "cantidad": 2
                },
                {
                    "cod_articulo": "TRUP-002", 
                    "unico_articulo": "67890",
                    "descripcion": "DESTORNILLADOR TRUPER PLANO 1/4\"",
                    "unidad": "PZA",
                    "cantidad": 5
                }
            ]
        },
        {
            name: "Conjunto de herramientas",
            data: [
                {
                    "cod_articulo": "BOSH-003",
                    "unico_articulo": "11111",
                    "descripcion": "JGO LLAVES ALLEN BOSCH 1.5-10MM 9 PZAS",
                    "unidad": "JGO",
                    "cantidad": 1
                },
                {
                    "cod_articulo": "MAKI-004",
                    "unico_articulo": "22222",
                    "descripcion": "TALADRO MAKITA 12V CON BATERIA Y CARGADOR",
                    "unidad": "PZA",
                    "cantidad": 1
                }
            ]
        },
        {
            name: "Herramientas pesadas",
            data: [
                {
                    "cod_articulo": "DEWA-005",
                    "unico_articulo": "33333",
                    "descripcion": "SIERRA CIRCULAR DEWALT 7-1/4\" 1500W",
                    "unidad": "PZA",
                    "cantidad": 1
                },
                {
                    "cod_articulo": "STAN-006",
                    "unico_articulo": "44444",
                    "descripcion": "CAJA HERRAMIENTAS STANLEY 20\" METALICA",
                    "unidad": "PZA",
                    "cantidad": 3
                }
            ]
        },
        {
            name: "Materiales diversos",
            data: [
                {
                    "cod_articulo": "MATE-007",
                    "unico_articulo": "55555",
                    "descripcion": "TUBO PVC 4\" X 6M PRESION",
                    "unidad": "PZA",
                    "cantidad": 10
                },
                {
                    "cod_articulo": "FIJE-008",
                    "unico_articulo": "66666",
                    "descripcion": "TORNILLO AUTORROSCANTE 3/8\" X 2\" CAJA 100PZS",
                    "unidad": "JGO",
                    "cantidad": 2
                }
            ]
        }
    ];
    
    for (const testCase of testCases) {
        try {
            console.log(`📋 ${testCase.name}`);
            console.log(`   Items: ${testCase.data.length}`);
            
            const response = await axios.post(`${baseURL}/dimensions`, testCase.data);
            
            const result = response.data;
            
            console.log(`   ✅ Items procesados: ${result.items?.length || 0}`);
            console.log(`   📦 Peso total: ${result.totales?.peso_total_kg || 0} kg`);
            console.log(`   📐 Volumen total: ${result.totales?.volumen_total_cm3 || 0} cm³`);
            console.log(`   📦 Bultos estimados: ${result.totales?.bultos_estimados || 0}`);
            
            // Mostrar detalles del primer item
            if (result.items && result.items.length > 0) {
                const firstItem = result.items[0];
                console.log(`   🔧 Ejemplo: ${firstItem.descripcion}`);
                console.log(`      - Peso: ${firstItem.peso_kg}kg`);
                console.log(`      - Dimensiones: ${firstItem.largo_cm}x${firstItem.ancho_cm}x${firstItem.alto_cm}cm`);
            }
            
            console.log('');
            
        } catch (error) {
            console.log(`   ❌ ERROR: ${error.response?.data?.message || error.message}`);
            if (error.response?.data) {
                console.log(`   Detalles:`, error.response.data);
            }
            console.log('');
        }
        
        // Pausa para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('🎉 PRUEBAS COMPLETADAS');
}

// Ejecutar directamente
testDimensionsEndpoint().catch(console.error);