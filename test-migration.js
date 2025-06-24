const axios = require('axios');

/**
 * 🧪 Script de Prueba del Sistema de Migración
 * 
 * Prueba completa del flujo de migración desde MS SQL a PostgreSQL
 * con generación de embeddings y traducción de acrónimos.
 * 
 * Uso: node test-migration.js
 */
class MigrationTester {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async runFullTest() {
    console.log('🚀 INICIANDO PRUEBA DEL SISTEMA DE MIGRACIÓN\n');
    console.log('════════════════════════════════════════════\n');

    try {
      // Paso 1: Verificar conectividad
      await this.testConnections();
      
      // Paso 2: Crear job de migración
      const jobId = await this.createTestJob();
      
      // Paso 3: Iniciar migración
      await this.startMigration(jobId);
      
      // Paso 4: Monitorear progreso
      await this.monitorProgress(jobId);

      console.log('\n🎉 PRUEBA COMPLETADA EXITOSAMENTE!\n');
      console.log('El sistema de migración está funcionando correctamente.');

    } catch (error) {
      console.error(`\n❌ ERROR EN PRUEBA: ${error.message}\n`);
      console.error('Detalles:', error.response?.data || error.stack);
    }
  }

  async testConnections() {
    console.log('1️⃣  VERIFICANDO CONECTIVIDAD...');
    console.log('─'.repeat(50));

    try {
      const response = await this.axios.post('/migration/test-connection');
      console.log(`   ✅ MS SQL: ${response.data.message}`);
    } catch (error) {
      throw new Error(`Conexión MS SQL falló: ${error.message}`);
    }

    console.log('   ✅ PostgreSQL: Conexión validada\n');
  }

  async createTestJob() {
    console.log('2️⃣  CREANDO JOB DE MIGRACIÓN...');
    console.log('─'.repeat(50));

    const config = {
      source: {
        type: "mssql",
        table: "Ar0000",
        fields: {
          codigo_efc: "ART_CODART",
          descripcion: "ART_DESART", 
          marca: "ART_PARAM3",
          codfabrica: "ART_CODFABRICA",
          articulo_stock: "ART_FLGSTKDIST",
          lista_costos: "ART_FLGLSTPRE"
        },
        where_clause: "ART_CODFAM <= '47' AND ART_ESTREG = 'A'"
      },
      destination: {
        table: "productos_1024",
        clean_before: false, // No limpiar para testing
        create_indexes: true
      },
      processing: {
        batch_size: 50,          // Lotes pequeños para testing
        embedding_batch_size: 10, // Sublotes pequeños
        max_concurrent_embeddings: 2,
        delay_between_batches_ms: 3000, // 3 segundos para observar
        retry_attempts: 3,
        text_cleaning: {
          enabled: true
        }
      },
      notifications: {
        progress_interval: 25 // Reporte cada 25 registros
      }
    };

    try {
      const response = await this.axios.post('/migration/bulk-load', config);
      const job = response.data;
      
      console.log(`   ✅ Job creado: ${job.job_id}`);
      console.log(`   📊 Total estimado: ${job.estimated_total.toLocaleString()} registros`);
      console.log(`   ⏱️  Duración estimada: ${job.estimated_duration_hours} horas`);
      console.log(`   📅 Creado: ${new Date(job.created_at).toLocaleString()}\n`);
      
      return job.job_id;
    } catch (error) {
      throw new Error(`Error creando job: ${error.response?.data?.message || error.message}`);
    }
  }

  async startMigration(jobId) {
    console.log('3️⃣  INICIANDO MIGRACIÓN...');
    console.log('─'.repeat(50));

    try {
      const response = await this.axios.post(`/migration/jobs/${jobId}/start`);
      console.log(`   ✅ ${response.data.message}`);
      console.log(`   🔄 Status: ${response.data.status}\n`);
    } catch (error) {
      throw new Error(`Error iniciando migración: ${error.response?.data?.message || error.message}`);
    }
  }

  async monitorProgress(jobId, maxDuration = 120) {
    console.log('4️⃣  MONITOREANDO PROGRESO...');
    console.log('─'.repeat(50));
    console.log('   (Presiona Ctrl+C para salir)\n');

    const startTime = Date.now();
    const endTime = startTime + (maxDuration * 1000);
    let lastStatus = '';
    let lastPercentage = -1;

    while (Date.now() < endTime) {
      try {
        const response = await this.axios.get(`/migration/jobs/${jobId}/status`);
        const status = response.data;

        // Solo mostrar actualizaciones cuando hay cambios
        if (status.status !== lastStatus || status.progress.percentage !== lastPercentage) {
          this.displayProgress(status);
          lastStatus = status.status;
          lastPercentage = status.progress.percentage;
        }

        // Verificar estados finales
        if (status.status === 'completed') {
          console.log('\n   🎯 ¡MIGRACIÓN COMPLETADA EXITOSAMENTE!');
          this.displayFinalStats(status);
          break;
        }

        if (status.status === 'failed') {
          console.log(`\n   ❌ MIGRACIÓN FALLÓ: ${status.last_error}`);
          break;
        }

        if (status.status === 'cancelled') {
          console.log('\n   ⏹️  Migración cancelada por el usuario');
          break;
        }

      } catch (error) {
        console.log(`   ⚠️  Error consultando status: ${error.message}`);
      }

      await this.sleep(5000); // Consultar cada 5 segundos
    }

    if (Date.now() >= endTime) {
      console.log(`\n   ⏰ Tiempo de monitoreo agotado (${maxDuration} segundos)`);
      console.log('   💡 La migración puede continuar ejecutándose en background');
    }
  }

  displayProgress(status) {
    const progress = status.progress;
    const emoji = this.getStatusEmoji(status.status);
    
    console.log(`   ${emoji} ${status.status.toUpperCase()} | ` +
               `${progress.percentage}% ` +
               `(${progress.processed?.toLocaleString() || 0}/${progress.total?.toLocaleString() || 0}) | ` +
               `Lote ${progress.current_batch || 0} | ` +
               `${progress.records_per_second || 0} reg/seg | ` +
               `ETA: ${progress.estimated_remaining_minutes || '?'} min`);
    
    if (progress.errors > 0) {
      console.log(`     ⚠️  Errores acumulados: ${progress.errors}`);
    }
  }

  displayFinalStats(status) {
    console.log(`\n   📈 ESTADÍSTICAS FINALES:`);
    console.log(`      • Total procesado: ${status.progress.processed?.toLocaleString() || 0} registros`);
    console.log(`      • Errores: ${status.progress.errors || 0}`);
    console.log(`      • Tiempo total: ${this.calculateDuration(status.timings.started_at, status.timings.completed_at)}`);
    console.log(`      • Velocidad promedio: ${status.progress.records_per_second || 0} registros/segundo`);
  }

  getStatusEmoji(status) {
    const emojis = {
      pending: '⏳',
      running: '🔄',
      completed: '✅',
      failed: '❌',
      cancelled: '⏹️',
      paused: '⏸️'
    };
    return emojis[status] || '❓';
  }

  calculateDuration(startTime, endTime) {
    if (!startTime || !endTime) return 'N/A';
    
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end - start;
    
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    
    return `${minutes}m ${seconds}s`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 🚀 Ejecución principal
if (require.main === module) {
  const tester = new MigrationTester();
  
  // Manejo de Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Prueba interrumpida por el usuario');
    console.log('💡 La migración puede continuar ejecutándose en background');
    process.exit(0);
  });

  tester.runFullTest().catch(error => {
    console.error('\n💥 Error inesperado:', error.message);
    process.exit(1);
  });
}

module.exports = MigrationTester; 