import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { IngestModule } from '../ingest/ingest.module';
import { SpendController } from './spend.controller';
import { SpendRepository } from './spend.repository';
import { SpendService } from './spend.service';

/**
 * S6 — manual spend intake (C-006 §2).
 *
 * Imports `IngestModule` for its buffer rather than talking to the broker directly. The event this
 * service produces gets exactly the durability the edge already provides: a broker outage delays
 * the observation and the drain retries it, instead of a second publishing path with its own
 * subtly different failure modes.
 */
@Module({
  imports: [DatabaseModule, IngestModule],
  controllers: [SpendController],
  providers: [SpendRepository, SpendService],
  // SpendService is exported for the report screen's entry form (C-006 §6.7), which records
  // through the same service as POST /spend/observations rather than duplicating intake.
  exports: [SpendRepository, SpendService],
})
export class SpendModule {}
