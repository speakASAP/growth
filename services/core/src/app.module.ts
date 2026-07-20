import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './db/database.module';
import { GovernanceModule } from './governance/governance.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, GovernanceModule],
  controllers: [HealthController],
})
export class AppModule {}
