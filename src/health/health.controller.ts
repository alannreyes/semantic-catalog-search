import { Controller, Get, Logger } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth() {
    this.logger.log('Health check requested');
    const health = await this.healthService.checkHealth();
    
    // Log if any service is down
    const failedServices = Object.entries(health.services)
      .filter(([_, status]) => (status as any).status === 'down')
      .map(([service, _]) => service);
    
    if (failedServices.length > 0) {
      this.logger.warn(`Health check failed for services: ${failedServices.join(', ')}`);
    }
    
    return health;
  }

  @Get('ready')
  async getReadiness() {
    this.logger.log('Readiness check requested');
    const readiness = await this.healthService.checkReadiness();
    
    if (!readiness.ready) {
      this.logger.error('Application not ready for traffic');
    }
    
    return readiness;
  }

  @Get('live')
  async getLiveness() {
    this.logger.log('Liveness check requested');
    return this.healthService.checkLiveness();
  }
}