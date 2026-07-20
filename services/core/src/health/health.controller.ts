import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Always 200 while the process is up — K8s liveness must not restart the pod because
   * Postgres blipped. Database reachability is reported in the body, where readiness
   * tooling and humans can see it, rather than by killing the container.
   */
  @Get()
  async health() {
    return {
      status: 'ok',
      service: process.env.SERVICE_NAME ?? 'growth-core',
      database: (await this.db.ping()) ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }
}
