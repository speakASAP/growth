import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../db/database.service';
import { IngestRepository, MAX_ATTEMPTS } from './ingest.repository';
import { IngestService } from './ingest.service';
import { RetentionService, PUBLISHED_RETENTION_DAYS } from './retention.service';
import { GrowthEventEnvelope } from './envelope.types';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 * These cover the C-005 §5–§6 behaviour that only real storage can demonstrate: primary-key
 * idempotency under concurrency, FOR UPDATE SKIP LOCKED across two sessions, the transition to
 * `dead`, and a retention sweep that spares `dead` rows.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';

const config = { get: (key: string) => (key === 'DATABASE_URL' ? TEST_DATABASE_URL : undefined) };

let db: DatabaseService;
let repo: IngestRepository;
let service: IngestService;
let retention: RetentionService;

const uuid = (n: number) => `3f6c9d1e-1b2a-4c3d-8e5f-${String(n).padStart(12, '0')}`;

const envelope = (n: number): GrowthEventEnvelope => ({
  eventId: uuid(n),
  eventType: 'growth.auth_redirect.initiated.v1',
  eventVersion: 1,
  occurredAt: '2026-07-20T10:00:00.000Z',
  producer: 'bazos-service',
  workspaceId: 'ws-1',
  correlationId: `corr-${n}`,
  dataClass: 'anonymous',
  payload: { correlationId: `corr-${n}`, initiatedAt: '2026-07-20T10:00:00.000Z' },
});

beforeAll(async () => {
  db = new DatabaseService(config as unknown as ConfigService);
  db.onModuleInit();
  repo = new IngestRepository(db);
  service = new IngestService(repo);
  retention = new RetentionService(repo);
});

afterAll(async () => {
  await db.onModuleDestroy();
});

beforeEach(async () => {
  await db.query('TRUNCATE ingest.event_buffer');
});

describe('buffer idempotency', () => {
  it('stores one row and reports the second as duplicate', async () => {
    await expect(repo.insert(envelope(1))).resolves.toBe('accepted');
    await expect(repo.insert(envelope(1))).resolves.toBe('duplicate');

    const { rows } = await db.query('SELECT count(*)::int AS c FROM ingest.event_buffer');
    expect(rows[0].c).toBe(1);
  });

  it('survives concurrent retries of the same eventId', async () => {
    // Two in-flight retries of the same browser event. A read-then-write check would let both
    // through; the primary key is what actually decides.
    const results = await Promise.all([
      repo.insert(envelope(2)),
      repo.insert(envelope(2)),
      repo.insert(envelope(2)),
    ]);

    expect(results.filter((r) => r === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(2);
  });

  it('stores the envelope verbatim', async () => {
    await service.ingest([envelope(3)]);
    const { rows } = await db.query<{ payload: GrowthEventEnvelope }>(
      'SELECT payload FROM ingest.event_buffer WHERE event_id = $1',
      [uuid(3)],
    );
    expect(rows[0].payload).toEqual(envelope(3));
  });
});

describe('claimPending — FOR UPDATE SKIP LOCKED', () => {
  it('does not hand the same row to two concurrent workers', async () => {
    await repo.insert(envelope(10));
    await repo.insert(envelope(11));

    // Hold the first worker's transaction open while the second claims, so the two overlap for
    // real rather than running back to back.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    let firstClaim: string[] = [];
    const firstWorker = db.withTransaction(async (client) => {
      firstClaim = (await repo.claimPending(client)).map((e) => e.eventId);
      await held;
    });

    // Give the first transaction time to take its locks before the second one looks.
    await new Promise((r) => setTimeout(r, 100));

    const secondClaim = await db.withTransaction(async (client) =>
      (await repo.claimPending(client)).map((e) => e.eventId),
    );

    release();
    await firstWorker;

    expect(firstClaim.sort()).toEqual([uuid(10), uuid(11)].sort());
    expect(secondClaim).toEqual([]); // stepped over, not blocked
  });

  it('skips rows that have exhausted their attempts', async () => {
    await repo.insert(envelope(12));
    await db.query('UPDATE ingest.event_buffer SET attempts = $1, status = $2', [
      MAX_ATTEMPTS,
      'failed',
    ]);

    const claimed = await db.withTransaction((client) => repo.claimPending(client));
    expect(claimed).toEqual([]);
  });

  it('does not claim already published rows', async () => {
    await repo.insert(envelope(13));
    await db.withTransaction((client) => repo.markPublished(client, uuid(13)));

    const claimed = await db.withTransaction((client) => repo.claimPending(client));
    expect(claimed).toEqual([]);
  });
});

describe('failure accounting', () => {
  it('moves a row to failed and increments attempts', async () => {
    await repo.insert(envelope(20));
    await db.withTransaction((client) => repo.markFailed(client, uuid(20), 'broker down'));

    const { rows } = await db.query('SELECT status, attempts, last_error FROM ingest.event_buffer');
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1, last_error: 'broker down' });
  });

  it('moves a row to dead on the attempt that reaches the limit', async () => {
    await repo.insert(envelope(21));
    await db.query('UPDATE ingest.event_buffer SET attempts = $1', [MAX_ATTEMPTS - 1]);
    await db.withTransaction((client) => repo.markFailed(client, uuid(21), 'still down'));

    const { rows } = await db.query('SELECT status, attempts FROM ingest.event_buffer');
    expect(rows[0]).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS });
  });
});

describe('retention (C-005 §6)', () => {
  it('deletes published rows past the window and keeps recent ones', async () => {
    await repo.insert(envelope(30));
    await repo.insert(envelope(31));
    await db.query(
      `UPDATE ingest.event_buffer
          SET status = 'published', published_at = now() - ($1 || ' days')::interval
        WHERE event_id = $2`,
      [String(PUBLISHED_RETENTION_DAYS + 1), uuid(30)],
    );
    await db.query(
      "UPDATE ingest.event_buffer SET status = 'published', published_at = now() WHERE event_id = $1",
      [uuid(31)],
    );

    const { deleted } = await retention.sweep();
    expect(deleted).toBe(1);

    const { rows } = await db.query('SELECT event_id FROM ingest.event_buffer');
    expect(rows.map((r) => r.event_id)).toEqual([uuid(31)]);
  });

  it('never deletes dead rows, however old', async () => {
    // A row that could not be published stays visible for inspection. Sweeping it would turn a
    // loud failure into a silent loss, which is the one outcome the buffer exists to prevent.
    await repo.insert(envelope(32));
    await db.query(
      `UPDATE ingest.event_buffer
          SET status = 'dead', published_at = now() - interval '999 days'`,
    );

    const { deleted } = await retention.sweep();
    expect(deleted).toBe(0);

    const { rows } = await db.query('SELECT count(*)::int AS c FROM ingest.event_buffer');
    expect(rows[0].c).toBe(1);
  });

  it('reports counts per status, including when it deletes nothing', async () => {
    await repo.insert(envelope(33));
    const { deleted, remaining } = await retention.sweep();

    expect(deleted).toBe(0);
    expect(remaining).toEqual({ pending: 1 });
  });
});
