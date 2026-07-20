import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { IngestRepository } from './ingest.repository';
import { RetentionService } from './retention.service';

/**
 * S5 receiving side: the endpoint, the buffer, and the retention sweep.
 *
 * PublisherWorker is deliberately not provided yet — it needs an EventPublisher, and the broker
 * binding is W6. Registering it now would mean either a null publisher that silently drops
 * events or a worker that crashes the pod on boot; both are worse than the drain simply not
 * running until there is somewhere to drain to. The buffer keeps everything meanwhile, which is
 * what it is for.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [IngestController],
  providers: [IngestService, IngestRepository, RetentionService],
  exports: [IngestRepository],
})
export class IngestModule {}
