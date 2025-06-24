const axios = require('axios');

/**
 * 🎛️ Script de Prueba de Controles Avanzados
 * 
 * Prueba funcionalidades de pause, resume, cancel y delete 
 * del sistema de migración.
 * 
 * Uso: node test-advanced-controls.js
 */
class AdvancedControlsTester {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async runAdvancedTest() {
    console.log('🎛️  INICIANDO PRUEBA DE CONTROLES AVANZADOS\n');
    console.log('═══════════════════════════════════════════════\n');

    let jobId = null;

    try {
      // Paso 1: Crear job de prueba
      jobId = await this.createTestJob();
      
      // Paso 2: Iniciar migración
      await this.startMigration(jobId);
      
      // Paso 3: Dejar correr un poco y pausar
      await this.testPauseResume(jobId);
      
      // Paso 4: Test de cancelación
      await this.testCancel(jobId);
      
      // Paso 5: Test de eliminación
      await this.testDelete(jobId);
      
      // Paso 6: Test de múltiples jobs
      await this.testMultipleJobs();

      console.log('\n🎉 TODAS LAS PRUEBAS DE CONTROLES COMPLETADAS!\n');

    } catch (error) {
      console.error(`\n❌ ERROR EN PRUEBA: ${error.message}\n`);
      
      // Cleanup en caso de error
      if (jobId) {
        try {
          await this.forceCancel(jobId);
        } catch (cleanupError) {
          console.log('   ⚠️  No se pudo hacer cleanup del job');
        }
      }
    }
  }

  async createTestJob() {
    console.log('1️⃣  CREANDO JOB DE PRUEBA...');
    console.log('─'.repeat(50));

    const config = {
      source: {
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
        clean_before: false,
        create_indexes: false // Más rápido para pruebas
      },
      processing: {
        batch_size: 25,           // Lotes muy pequeños
        embedding_batch_size: 5,  // Para poder pausar rápido
        delay_between_batches_ms: 5000, // 5 segundos para dar tiempo
        retry_attempts: 1,
        text_cleaning: { enabled: true }
      }
    };

    const response = await this.axios.post('/migration/bulk-load', config);
    const jobId = response.data.job_id;
    
    console.log(`   ✅ Job de prueba creado: ${jobId}\n`);
    return jobId;
  }

  async startMigration(jobId) {
    console.log('2️⃣  INICIANDO MIGRACIÓN...');
    console.log('─'.repeat(50));

    await this.axios.post(`/migration/jobs/${jobId}/start`);
    console.log(`   ✅ Migración iniciada para job ${jobId}\n`);
  }

  async testPauseResume(jobId) {
    console.log('3️⃣  PROBANDO PAUSE/RESUME...');
    console.log('─'.repeat(50));

    // Esperar un poco para que inicie el procesamiento
    console.log('   ⏳ Esperando 10 segundos para que inicie procesamiento...');
    await this.sleep(10000);

    // Verificar que está corriendo
    let status = await this.getJobStatus(jobId);
    console.log(`   📊 Status actual: ${status.status} (${status.progress.percentage}%)`);

    if (status.status !== 'running') {
      console.log('   ⚠️  Job no está en ejecución, saltando prueba pause/resume');
      return;
    }

    // Pausar
    console.log('   ⏸️  Pausando migración...');
    await this.axios.post(`/migration/jobs/${jobId}/pause`);
    await this.sleep(2000);

    status = await this.getJobStatus(jobId);
    console.log(`   ✅ Pausado: ${status.status}`);

    // Intentar pausar nuevamente (debe fallar)
    try {
      await this.axios.post(`/migration/jobs/${jobId}/pause`);
      console.log('   ❌ Error: Se pudo pausar un job ya pausado');
    } catch (error) {
      console.log('   ✅ Correcto: No se puede pausar un job ya pausado');
    }

    // Reanudar
    console.log('   ▶️  Reanudando migración...');
    await this.axios.post(`/migration/jobs/${jobId}/resume`);
    await this.sleep(2000);

    status = await this.getJobStatus(jobId);
    console.log(`   ✅ Reanudado: ${status.status}\n`);
  }

  async testCancel(jobId) {
    console.log('4️⃣  PROBANDO CANCELACIÓN...');
    console.log('─'.repeat(50));

    // Esperar un poco más
    await this.sleep(5000);

    // Cancelar
    console.log('   🛑 Cancelando migración...');
    await this.axios.post(`/migration/jobs/${jobId}/cancel`);
    await this.sleep(2000);

    const status = await this.getJobStatus(jobId);
    console.log(`   ✅ Cancelado: ${status.status}`);

    // Intentar cancelar nuevamente (debe fallar)
    try {
      await this.axios.post(`/migration/jobs/${jobId}/cancel`);
      console.log('   ❌ Error: Se pudo cancelar un job ya cancelado');
    } catch (error) {
      console.log('   ✅ Correcto: No se puede cancelar un job ya cancelado');
    }

    console.log('');
  }

  async testDelete(jobId) {
    console.log('5️⃣  PROBANDO ELIMINACIÓN...');
    console.log('─'.repeat(50));

    // Eliminar job cancelado
    console.log('   🗑️  Eliminando job cancelado...');
    await this.axios.delete(`/migration/jobs/${jobId}`);
    console.log('   ✅ Job eliminado exitosamente');

    // Verificar que ya no existe
    try {
      await this.getJobStatus(jobId);
      console.log('   ❌ Error: Job eliminado aún existe');
    } catch (error) {
      console.log('   ✅ Correcto: Job eliminado no existe más');
    }

    console.log('');
  }

  async testMultipleJobs() {
    console.log('6️⃣  PROBANDO MÚLTIPLES JOBS...');
    console.log('─'.repeat(50));

    // Crear varios jobs
    const jobs = [];
    for (let i = 1; i <= 3; i++) {
      const jobId = await this.createQuickJob(`Test Job ${i}`);
      jobs.push(jobId);
      console.log(`   ✅ Job ${i} creado: ${jobId.substring(0, 8)}...`);
    }

    // Listar todos los jobs
    const allJobs = await this.axios.get('/migration/jobs');
    console.log(`   📋 Total de jobs encontrados: ${allJobs.data.length}`);

    // Limpiar jobs de prueba
    for (const jobId of jobs) {
      try {
        await this.axios.delete(`/migration/jobs/${jobId}`);
        console.log(`   🗑️  Job ${jobId.substring(0, 8)}... eliminado`);
      } catch (error) {
        console.log(`   ⚠️  No se pudo eliminar job ${jobId.substring(0, 8)}...`);
      }
    }

    console.log('');
  }

  async createQuickJob(name = 'Quick Test') {
    const config = {
      source: {
        table: "Ar0000",
        fields: { codigo_efc: "ART_CODART", descripcion: "ART_DESART" },
        where_clause: "ART_CODFAM = '01'"
      },
      destination: {
        table: "productos_1024",
        clean_before: false,
        create_indexes: false
      },
      processing: {
        batch_size: 10,
        embedding_batch_size: 2,
        delay_between_batches_ms: 1000,
        retry_attempts: 1,
        text_cleaning: { enabled: false }
      }
    };

    const response = await this.axios.post('/migration/bulk-load', config);
    return response.data.job_id;
  }

  async getJobStatus(jobId) {
    const response = await this.axios.get(`/migration/jobs/${jobId}/status`);
    return response.data;
  }

  async forceCancel(jobId) {
    try {
      await this.axios.post(`/migration/jobs/${jobId}/cancel`);
    } catch (error) {
      // Ignorar errores de cleanup
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 🚀 Ejecución principal
if (require.main === module) {
  const tester = new AdvancedControlsTester();
  
  // Manejo de Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n⏹️  Prueba interrumpida por el usuario');
    process.exit(0);
  });

  tester.runAdvancedTest().catch(error => {
    console.error('\n💥 Error inesperado:', error.message);
    process.exit(1);
  });
}

module.exports = AdvancedControlsTester; 