import { IngestService, BatchTooLarge, EnvelopeInvalid, MAX_BATCH_SIZE } from './ingest.service';

const valid = (eventId: string) => ({
  eventId,
  eventType: 'growth.auth_redirect.initiated.v1',
  eventVersion: 1,
  occurredAt: '2026-07-20T10:00:00.000Z',
  producer: 'bazos-service',
  workspaceId: 'ws-1',
  correlationId: 'corr-1',
  dataClass: 'anonymous',
  payload: { correlationId: 'corr-1', initiatedAt: '2026-07-20T10:00:00.000Z' },
});

const uuid = (n: number) => `3f6c9d1e-1b2a-4c3d-8e5f-${String(n).padStart(12, '0')}`;

function makeService(insert = jest.fn().mockResolvedValue('accepted')) {
  const repository = { insert };
  return { service: new IngestService(repository as never), repository };
}

describe('IngestService.ingest', () => {
  it('commits a valid batch', async () => {
    const { service, repository } = makeService();
    const result = await service.ingest([valid(uuid(1)), valid(uuid(2))]);

    expect(result).toEqual({ accepted: 2, duplicates: 0, outcomes: ['accepted', 'accepted'] });
    expect(repository.insert).toHaveBeenCalledTimes(2);
  });

  it('reports duplicates separately from accepted events', async () => {
    const insert = jest
      .fn()
      .mockResolvedValueOnce('accepted')
      .mockResolvedValueOnce('duplicate');
    const { service } = makeService(insert);

    const result = await service.ingest([valid(uuid(1)), valid(uuid(2))]);
    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('rejects a batch over the maximum', async () => {
    const { service, repository } = makeService();
    const batch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => valid(uuid(i)));

    await expect(service.ingest(batch)).rejects.toBeInstanceOf(BatchTooLarge);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('accepts a batch of exactly the maximum', async () => {
    const { service } = makeService();
    const batch = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => valid(uuid(i)));
    await expect(service.ingest(batch)).resolves.toMatchObject({ accepted: MAX_BATCH_SIZE });
  });

  it('writes nothing when any envelope in the batch is invalid', async () => {
    // A partially written batch cannot be retried safely: the client would have to know which
    // half landed. All-or-nothing at the validation step is what keeps the retry idempotent.
    const { service, repository } = makeService();
    const batch = [valid(uuid(1)), { eventType: 'nonsense' }, valid(uuid(2))];

    await expect(service.ingest(batch)).rejects.toBeInstanceOf(EnvelopeInvalid);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('reports which envelope in the batch failed', async () => {
    const { service } = makeService();
    const batch = [valid(uuid(1)), { eventType: 'nonsense' }];

    await expect(service.ingest(batch)).rejects.toMatchObject({
      failures: [{ index: 1 }],
    });
  });

  it('lets a buffer write failure propagate — it must become a 503, not a silent drop', async () => {
    const insert = jest.fn().mockRejectedValue(new Error('connection terminated'));
    const { service } = makeService(insert);

    await expect(service.ingest([valid(uuid(1))])).rejects.toThrow('connection terminated');
  });
});
