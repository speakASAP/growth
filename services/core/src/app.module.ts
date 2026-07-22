import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './db/database.module';
import { GovernanceModule } from './governance/governance.module';
import { IngestModule } from './ingest/ingest.module';
import { AttributionModule } from './attribution/attribution.module';
import { QualificationModule } from './qualification/qualification.module';
import { SpendModule } from './spend/spend.module';
import { ReportModule } from './report/report.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    GovernanceModule,
    IngestModule,
    AttributionModule,
    QualificationModule,
    SpendModule,
    ReportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
