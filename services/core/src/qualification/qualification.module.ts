import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { QualificationRepository } from './qualification.repository';
import { QualificationService } from './qualification.service';
import { QualificationConsumer } from './qualification.consumer';

/**
 * S6 — the lead and the owner's judgement about it (C-006 §1, §3).
 *
 * Separate from AttributionModule even though both consume off queues: attribution decides who a
 * visitor was, qualification records what a human concluded about them afterwards. They share no
 * state and answer to different contracts.
 */
@Module({
  imports: [DatabaseModule],
  providers: [QualificationRepository, QualificationService, QualificationConsumer],
  exports: [QualificationRepository],
})
export class QualificationModule {}
