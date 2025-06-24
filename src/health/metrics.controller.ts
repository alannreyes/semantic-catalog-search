import { Controller, Get, Logger } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics() {
    this.logger.log('Metrics requested');
    return this.metricsService.getApplicationMetrics();
  }

  @Get('prometheus')
  async getPrometheusMetrics() {
    this.logger.log('Prometheus metrics requested');
    const metrics = await this.metricsService.getPrometheusFormat();
    return metrics;
  }

  @Get('performance')
  async getPerformanceMetrics() {
    this.logger.log('Performance metrics requested');
    return this.metricsService.getPerformanceMetrics();
  }
}