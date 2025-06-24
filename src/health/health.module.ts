import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { OptimizationController } from './optimization.controller';
import { OptimizationService } from './optimization.service';

@Module({
  controllers: [HealthController, MetricsController, OptimizationController],
  providers: [HealthService, MetricsService, OptimizationService],
  exports: [HealthService, MetricsService, OptimizationService],
})
export class HealthModule {}