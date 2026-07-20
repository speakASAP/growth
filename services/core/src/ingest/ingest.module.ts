import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { IngestRepository } from './ingest.repository';
import { RetentionService } from './retention.service';
import { EVENT_PUBLISHER, PublisherWorker } from './publisher.worker';
import { RabbitMqEventPublisher } from './rabbitmq.publisher';
import { DrainScheduler } from './drain.scheduler';
import { RetentionScheduler } from './retention.scheduler';

/**
 * S5: the endpoint, the buffer, the drain to RabbitMQ (W6), and the retention sweep.
 *
 * There is deliberately no "publishing enabled" flag. The failure it would guard against —
 * a broker that is down — is already handled correctly: `publish()` rejects, the row stays
 * unpublished, and the backoff retries it. A flag would add the one failure the buffer cannot
 * survive, which is looking healthy while quietly going nowhere.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [IngestController],
  providers: [
    IngestService,
    IngestRepository,
    RetentionService,
    RabbitMqEventPublisher,
    { provide: EVENT_PUBLISHER, useExisting: RabbitMqEventPublisher },
    PublisherWorker,
    DrainScheduler,
    RetentionScheduler,
  ],
  exports: [IngestRepository],
})
export class IngestModule {}
