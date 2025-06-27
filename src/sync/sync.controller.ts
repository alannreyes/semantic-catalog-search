import { Controller, Post, Get, Query } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('api/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('manual')
  async runManualSync() {
    try {
      const result = await this.syncService.runManualSync();
      return {
        success: true,
        message: 'Sincronización manual completada',
        ...result
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error en sincronización manual',
        error: error.message
      };
    }
  }

  @Get('stats')
  async getSyncStats(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 10;
    const stats = await this.syncService.getSyncStats(limitNum);
    
    return {
      success: true,
      stats
    };
  }

  @Get('status')
  async getSyncStatus() {
    try {
      const recentStats = await this.syncService.getSyncStats(1);
      const lastSync = recentStats[0];
      
      return {
        success: true,
        lastSync: lastSync ? {
          date: lastSync.created_at,
          status: lastSync.status,
          updatedCount: lastSync.updated_count,
          duration: lastSync.duration_ms,
          error: lastSync.error_message
        } : null,
        nextSync: '00:00 (diario)',
        timezone: 'America/Lima'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}