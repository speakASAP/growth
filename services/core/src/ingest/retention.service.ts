import { Injectable, Logger } from '@nestjs/common';
import { IngestRepository } from './ingest.repository';

/** C-005 §6 — published rows are swept after 30 days. `dead` rows are never swept. */
export const PUBLISHED_RETENTION_DAYS = 30;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly repository: IngestRepository) {}

  /**
   * Daily sweep of the buffer.
   *
   * Logs the count on every run, including zero. A retention job that has silently stopped
   * working looks exactly like one with nothing to do, and the difference only becomes visible
   * if the quiet case is noisy on purpose (C-005 §6).
   */
  async sweep(): Promise<{ deleted: number; remaining: Record<string, number> }> {
    const deleted = await this.repository.deletePublishedOlderThan(PUBLISHED_RETENTION_DAYS);
    const remaining = await this.repository.countByStatus();

    this.logger.log(
      `retention sweep: ${deleted} published rows older than ${PUBLISHED_RETENTION_DAYS}d deleted; ` +
        `buffer now ${JSON.stringify(remaining)}`,
    );

    // `dead` rows accumulating is not a retention problem to be swept away — it is an alert.
    if (remaining.dead > 0) {
      this.logger.warn(
        `${remaining.dead} dead events in the buffer — never auto-deleted, needs inspection`,
      );
    }

    return { deleted, remaining };
  }
}
