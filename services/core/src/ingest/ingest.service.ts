import { Injectable, Logger } from '@nestjs/common';
import { IngestRepository } from './ingest.repository';
import { validateEnvelope, ValidationFailure } from './envelope.validator';
import { GrowthEventEnvelope, IngestOutcome } from './envelope.types';

/** C-005 §3 — batch and body limits. */
export const MAX_BATCH_SIZE = 50;

export class BatchTooLarge extends Error {
  constructor(readonly size: number) {
    super(`batch of ${size} exceeds the maximum of ${MAX_BATCH_SIZE}`);
  }
}

export class EnvelopeInvalid extends Error {
  constructor(readonly failures: { index: number; errors: ValidationFailure[] }[]) {
    super('one or more envelopes failed schema validation');
  }
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  outcomes: IngestOutcome[];
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly repository: IngestRepository) {}

  /**
   * Validates a batch, then commits it. Validation runs over the whole batch first: a partially
   * written batch would leave the client unable to retry safely, since a retry of the whole batch
   * is only harmless once every envelope in it is known to be storable.
   */
  async ingest(batch: unknown[]): Promise<IngestResult> {
    if (batch.length > MAX_BATCH_SIZE) throw new BatchTooLarge(batch.length);

    const failures = batch
      .map((envelope, index) => ({ index, errors: validateEnvelope(envelope) }))
      .filter((f) => f.errors.length > 0);

    if (failures.length > 0) throw new EnvelopeInvalid(failures);

    const outcomes: IngestOutcome[] = [];
    for (const envelope of batch as GrowthEventEnvelope[]) {
      outcomes.push(await this.repository.insert(envelope));
    }

    const duplicates = outcomes.filter((o) => o === 'duplicate').length;
    if (duplicates > 0) {
      this.logger.debug(`ingest: ${outcomes.length - duplicates} accepted, ${duplicates} duplicate`);
    }

    return {
      accepted: outcomes.length - duplicates,
      duplicates,
      outcomes,
    };
  }
}
