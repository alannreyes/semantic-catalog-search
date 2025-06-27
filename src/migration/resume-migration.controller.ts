import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ResumeMigrationService } from './resume-migration.service';

@Controller('migration/resume')
export class ResumeMigrationController {
  constructor(private readonly resumeService: ResumeMigrationService) {}

  @Get('progress')
  async checkProgress() {
    try {
      const progress = await this.resumeService.checkMigrationProgress();
      const pending = await this.resumeService.getPendingProducts(progress.lastMigratedCode, 1);
      
      return {
        success: true,
        progress: {
          ...progress,
          pendingCount: pending.pendingCount,
          completionPercentage: progress.totalMigrated > 0 
            ? Math.round((progress.totalMigrated / (progress.totalMigrated + pending.pendingCount)) * 100)
            : 0
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Post('start')
  async resumeMigration(@Body() body: { jobId?: string }) {
    try {
      const result = await this.resumeService.resumeMigration(body.jobId);
      
      return {
        success: true,
        message: 'Migración reanudada exitosamente',
        ...result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Get('verify')
  async verifyIntegrity() {
    try {
      const result = await this.resumeService.verifyMigrationIntegrity();
      
      return {
        success: true,
        integrity: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Get('pending/:limit?')
  async getPendingPreview(@Param('limit') limit?: string) {
    try {
      const progress = await this.resumeService.checkMigrationProgress();
      const pending = await this.resumeService.getPendingProducts(
        progress.lastMigratedCode, 
        limit ? parseInt(limit) : 10
      );
      
      return {
        success: true,
        lastMigratedCode: progress.lastMigratedCode,
        pendingCount: pending.pendingCount,
        nextBatch: pending.nextBatch
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}