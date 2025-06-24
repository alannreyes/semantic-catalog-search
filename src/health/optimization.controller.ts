import { Controller, Get, Post, Query, Body, Logger } from '@nestjs/common';
import { OptimizationService } from './optimization.service';

@Controller('optimization')
export class OptimizationController {
  private readonly logger = new Logger(OptimizationController.name);

  constructor(private readonly optimizationService: OptimizationService) {}

  @Get('pgvector/analyze')
  async analyzePgVector(@Query('table') tableName?: string) {
    this.logger.log(`Analyzing pgvector configuration for table: ${tableName || 'default'}`);
    return this.optimizationService.analyzePgVectorConfig(tableName);
  }

  @Post('pgvector/apply')
  async applyPgVectorOptimizations(
    @Body() body: { 
      tableName?: string; 
      dryRun?: boolean; 
      force?: boolean;
    }
  ) {
    const { tableName, dryRun = true, force = false } = body;
    
    this.logger.log(`Applying pgvector optimizations - table: ${tableName || 'default'}, dryRun: ${dryRun}, force: ${force}`);
    
    return this.optimizationService.applyPgVectorOptimizations(tableName, { dryRun, force });
  }

  @Get('database/stats')
  async getDatabaseStats() {
    this.logger.log('Getting database optimization stats');
    return this.optimizationService.getDatabaseStats();
  }

  @Post('database/maintenance')
  async runDatabaseMaintenance(
    @Body() body: { 
      tasks?: string[]; 
      dryRun?: boolean;
    }
  ) {
    const { tasks = ['analyze', 'vacuum'], dryRun = true } = body;
    
    this.logger.log(`Running database maintenance - tasks: ${tasks.join(',')}, dryRun: ${dryRun}`);
    
    return this.optimizationService.runDatabaseMaintenance(tasks, { dryRun });
  }
}