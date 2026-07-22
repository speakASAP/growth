import { ObservationConflict, ObservationInvalid, SpendService } from './spend.service';

/**
 * The owner types a number off the Google Ads screen and it becomes the denominator of every cost
 * metric in the slice. The things worth pinning are therefore: it validates against the contract
 * before it is stored, it stays a decimal string end to end, and re-submitting the same
 * observation is a no-op rather than a second row.
 */

const payload = {
  observationId: 'obs-1',
  experimentId: 'exp-bazos-cz-1',
  platform: 'google_ads',
  periodStart: '2026-07-21',
  periodEnd: '2026-07-21',
  amount: { value: '15000.00', currency: 'CZK' },
  evidenceReference: 'google-ads-report-2026-07-21',
  enteredBy: 'owner',
  enteredAt: '2026-07-22T08:00:00.000Z',
  isManual: true,
};

function build(options: { existing?: unknown; insertResult?: 'inserted' | 'duplicate' | 'conflict' } = {}) {
  const stored: unknown[] = [];
  const buffered: unknown[] = [];

  const repository = {
    insert: jest.fn(async (record: unknown) => {
      const outcome = options.insertResult ?? 'inserted';
      if (outcome === 'inserted') stored.push(record);
      return outcome;
    }),
    findById: jest.fn(async () => options.existing ?? null),
  };
  const ingest = {
    ingest: jest.fn(async (batch: unknown[]) => {
      buffered.push(...batch);
      return { accepted: batch.length, duplicates: 0, outcomes: ['committed'] };
    }),
  };

  const service = new SpendService(repository as never, ingest as never);
  return { service, repository, ingest, stored, buffered };
}

describe('recording a manual spend observation', () => {
  it('stores the observation and buffers the event', async () => {
    const { service, stored, buffered } = build();

    const result = await service.record(payload, 'bazos');

    expect(result.status).toBe('created');
    expect(stored).toHaveLength(1);
    expect(buffered).toHaveLength(1);
  });

  // growth-core is the producer here, so it mints the envelope. A caller-supplied one could claim
  // to be a different producer entirely.
  it('mints the envelope rather than accepting one', async () => {
    const { service, buffered } = build();

    await service.record(payload, 'bazos');

    const envelope = buffered[0] as Record<string, unknown>;
    expect(envelope.eventType).toBe('growth.spend.observed_manual.v1');
    expect(envelope.producer).toBe('growth-core');
    expect(envelope.dataClass).toBe('operational');
    expect(envelope.workspaceId).toBe('bazos');
    expect(typeof envelope.eventId).toBe('string');
  });

  // The event growth-core produces must be one the ingest edge would also accept. Validating with
  // the same function is what stops the producer and the consumer drifting apart.
  it('validates against the contract schema before storing anything', async () => {
    const { service, stored, buffered } = build();

    await expect(
      service.record({ ...payload, amount: { value: '15000.00', currency: 'czk' } }, 'bazos'),
    ).rejects.toBeInstanceOf(ObservationInvalid);

    expect(stored).toHaveLength(0);
    expect(buffered).toHaveLength(0);
  });

  it('rejects a float amount, which is how cents go missing', async () => {
    const { service } = build();

    await expect(
      service.record({ ...payload, amount: { value: 15000.5 as never, currency: 'CZK' } }, 'bazos'),
    ).rejects.toBeInstanceOf(ObservationInvalid);
  });

  it('rejects isManual false — an owner-typed number is never invoice-reconciled', async () => {
    const { service } = build();

    await expect(service.record({ ...payload, isManual: false as never }, 'bazos')).rejects.toBeInstanceOf(
      ObservationInvalid,
    );
  });

  it('rejects a blank evidenceReference', async () => {
    const { service } = build();

    await expect(service.record({ ...payload, evidenceReference: '' }, 'bazos')).rejects.toBeInstanceOf(
      ObservationInvalid,
    );
  });

  // A negative value is a provider credit or a correction, and is meaningful.
  it('accepts a negative amount', async () => {
    const { service, stored } = build();

    await service.record({ ...payload, amount: { value: '-250.0000', currency: 'CZK' } }, 'bazos');

    expect(stored).toHaveLength(1);
  });
});

describe('re-submitting the same observation', () => {
  it('is idempotent when the body is identical', async () => {
    const { service, buffered } = build({
      insertResult: 'duplicate',
      existing: { observationId: 'obs-1', amount: { value: '15000.00', currency: 'CZK' } },
    });

    const result = await service.record(payload, 'bazos');

    expect(result.status).toBe('duplicate');
    // Already stored and already buffered the first time. Re-buffering would publish the same
    // spend twice, and spend is summed.
    expect(buffered).toHaveLength(0);
  });

  it('conflicts when the same observationId carries a different amount', async () => {
    const { service } = build({ insertResult: 'conflict' });

    await expect(service.record(payload, 'bazos')).rejects.toBeInstanceOf(ObservationConflict);
  });
});

describe('money stays a decimal string', () => {
  it('never converts the amount to a number on the way through', async () => {
    const { service, stored, buffered } = build();

    await service.record({ ...payload, amount: { value: '0.0001', currency: 'CZK' } }, 'bazos');

    const record = stored[0] as { amountValue: unknown };
    expect(typeof record.amountValue).toBe('string');
    expect(record.amountValue).toBe('0.0001');

    const envelope = buffered[0] as { payload: { amount: { value: unknown } } };
    expect(typeof envelope.payload.amount.value).toBe('string');
    expect(envelope.payload.amount.value).toBe('0.0001');
  });
});
