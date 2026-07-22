import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './db/database.module';
import { GovernanceModule } from './governance/governance.module';
import { IngestModule } from './ingest/ingest.module';
import { AttributionModule } from './attribution/attribution.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    GovernanceModule,
    IngestModule,
    AttributionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
