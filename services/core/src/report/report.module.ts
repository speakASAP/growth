import { Module } from '@nestjs/common';
import { QualificationModule } from '../qualification/qualification.module';
import { SpendModule } from '../spend/spend.module';
import { ExperimentReportController } from './experiment-report.controller';
import { ExperimentReportService } from './experiment-report.service';

/**
 * C-006 §6 — the experiment report.
 *
 * Imports the two modules that own the data and derives from their repositories. It owns no table
 * and adds no migration: every number here is computed at read time, which is what keeps `pending`
 * (the absence of a judgement) from ever being stored and drifting out of agreement with the
 * judgements themselves.
 */
@Module({
  imports: [QualificationModule, SpendModule],
  controllers: [ExperimentReportController],
  providers: [ExperimentReportService],
})
export class ReportModule {}
