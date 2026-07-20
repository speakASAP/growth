import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { IngestRepository, MAX_ATTEMPTS, MAX_BACKOFF_SECONDS } from './ingest.repository';
import { BufferedEvent } from './envelope.types';

/**
 * Publishes a buffered envelope onward. Left as an interface because the broker binding is W6's
 * work: the drain loop's transitions, retry accounting and dead-lettering are testable now, and
 * wiring them to RabbitMQ later must not require rewriting any of it.
 */
export interface EventPublisher {
  publish(event: BufferedEvent): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * C-005 §5 — backoff is min(2^attempts, 300) seconds.
 *
 * Used for the log line only; the delay that actually governs the next claim is written to
 * `next_attempt_at` by `IngestRepository.markFailed`. The two are kept in step by
 * `backoff-agreement.db-spec.ts` — a log that promised a wait the database did not enforce would
 * be worse than no log at all.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(2 ** attempts, MAX_BACKOFF_SECONDS);
}

@Injectable()
export class PublisherWorker {
  private readonly logger = new Logger(PublisherWorker.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repository: IngestRepository,
    // An interface has no runtime identity for Nest to resolve, so the publisher arrives by token.
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  /**
   * Claims a batch and publishes it, one transaction per drain.
   *
   * A publish failure updates the row and is not rethrown: one unpublishable event must not stop
   * the drain, or a single poison row would block every event behind it until someone noticed.
   */
  async drain(): Promise<{ published: number; failed: number }> {
    return this.db.withTransaction(async (client) => {
      const claimed = await this.repository.claimPending(client);
      let published = 0;
      let failed = 0;

      for (const event of claimed) {
        try {
          await this.publisher.publish(event);
          await this.repository.markPublished(client, event.eventId);
          published += 1;
        } catch (err) {
          const message = (err as Error).message;
          await this.repository.markFailed(client, event.eventId, message);
          failed += 1;

          // The attempt just recorded is the one that exhausted the budget: the row is now
          // `dead` and will never be claimed again. This is the last chance to say so.
          if (event.attempts + 1 >= MAX_ATTEMPTS) {
            this.logger.error(
              `event ${event.eventId} (${event.eventType}) dead after ${MAX_ATTEMPTS} attempts: ${message}`,
            );
          } else {
            this.logger.warn(
              `event ${event.eventId} publish failed, attempt ${event.attempts + 1}, ` +
                `retry in ${backoffSeconds(event.attempts + 1)}s: ${message}`,
            );
          }
        }
      }

      if (published > 0 || failed > 0) {
        this.logger.log(`drain: ${published} published, ${failed} failed`);
      }
      return { published, failed };
    });
  }
}
