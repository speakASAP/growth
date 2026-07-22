import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { AttributionRepository } from './attribution.repository';
import { AttributionService } from './attribution.service';
import { AttributionConsumer } from './attribution.consumer';

/**
 * The consumer half of S5: the click and the registration meeting on `correlationId` (C-005 §2.2).
 *
 * Separate from IngestModule on purpose. Ingest is the edge — it accepts, buffers and republishes
 * without interpreting. This module is the first place growth-core decides what events *mean*, and
 * keeping the two apart stops the edge growing opinions about attribution.
 */
@Module({
  imports: [DatabaseModule],
  providers: [AttributionRepository, AttributionService, AttributionConsumer],
  exports: [AttributionRepository],
})
export class AttributionModule {}
