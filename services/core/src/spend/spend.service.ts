import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SpendRepository } from './spend.repository';
import { IngestService } from '../ingest/ingest.service';
import { validateEnvelope, ValidationFailure } from '../ingest/envelope.validator';

/**
 * v2 since S6d. The bump carries `campaignId`, which v1 cannot: its `eventType` and `eventVersion`
 * are `const`, so a v1 envelope with the extra field is invalid by construction — which is the
 * property that makes a consumer's "I accept everything v1 permits" test worth writing (C-006 §2.5).
 */
export const MANUAL_SPEND_EVENT = 'growth.spend.observed_manual.v2';
export const MANUAL_SPEND_EVENT_VERSION = 2;

export class ObservationInvalid extends Error {
  constructor(readonly failures: ValidationFailure[]) {
    super('the observation does not match the contract schema');
  }
}

export class ObservationConflict extends Error {
  constructor(readonly observationId: string) {
    super(`observation ${observationId} already exists with a different body`);
  }
}

export interface ManualSpendPayload {
  observationId: string;
  experimentId: string;
  /**
   * Absent means the owner did not split the figure — NOT that the spend belongs to no campaign.
   * Unassigned spend keeps its own line in the report and stays in the experiment's total: the
   * money left the account either way (C-006 §2.5).
   */
  campaignId?: string;
  platform: string;
  periodStart: string;
  periodEnd: string;
  amount: { value: string; currency: string };
  evidenceReference: string;
  enteredBy: string;
  enteredAt: string;
  isManual: boolean;
}

export type SpendResult = { status: 'created' | 'duplicate'; observationId: string };

/**
 * C-006 §2 — the owner types the day's ad spend off the Google Ads screen.
 *
 * No connector exists at MS-002, so this number is the denominator of every cost metric in the
 * slice and it arrives by hand. Two consequences shape this service:
 *
 * - It is **validated against the contract schema before it is stored**, using the same
 *   `validateEnvelope` the ingest edge applies. growth-core producing an event it would itself
 *   reject on ingest is exactly the drift a shared validator exists to prevent.
 * - It is **published through the ingest buffer** rather than straight to the broker, so a broker
 *   outage delays the observation instead of losing it. The durability is already built; reusing
 *   it beats a second, worse copy.
 */
@Injectable()
export class SpendService {
  private readonly logger = new Logger(SpendService.name);

  constructor(
    private readonly repository: SpendRepository,
    private readonly ingest: IngestService,
  ) {}

  async record(payload: ManualSpendPayload, workspaceId: string): Promise<SpendResult> {
    const envelope = {
      eventId: randomUUID(),
      eventType: MANUAL_SPEND_EVENT,
      eventVersion: MANUAL_SPEND_EVENT_VERSION,
      occurredAt: new Date().toISOString(),
      // growth-core is the producer. The caller sends the payload only — an accepted envelope
      // would let it claim to be a different service.
      producer: 'growth-core',
      workspaceId,
      correlationId: payload.observationId,
      dataClass: 'operational',
      payload,
    };

    const failures = validateEnvelope(envelope);
    if (failures.length > 0) throw new ObservationInvalid(failures);

    const outcome = await this.repository.insert({
      observationId: payload.observationId,
      experimentId: payload.experimentId,
      campaignId: payload.campaignId ?? null,
      workspaceId,
      platform: payload.platform,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      // Still a string. It goes to Postgres as text and is cast to NUMERIC there — parsing it
      // into a JS number anywhere on this path is how cents disappear.
      amountValue: payload.amount.value,
      amountCurrency: payload.amount.currency,
      evidenceReference: payload.evidenceReference,
      enteredBy: payload.enteredBy,
      enteredAt: payload.enteredAt,
    });

    if (outcome === 'conflict') throw new ObservationConflict(payload.observationId);

    if (outcome === 'duplicate') {
      // Stored and published the first time. Re-buffering would publish the same spend twice, and
      // spend is summed — the duplicate would not look like an error, it would look like a worse
      // campaign.
      return { status: 'duplicate', observationId: payload.observationId };
    }

    await this.ingest.ingest([envelope]);

    this.logger.log(
      `manual spend observation ${payload.observationId} recorded for experiment ` +
        `${payload.experimentId} (${payload.periodStart}..${payload.periodEnd})`,
    );

    return { status: 'created', observationId: payload.observationId };
  }
}
