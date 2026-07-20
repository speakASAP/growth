import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../db/database.service';
import { IngestRepository, MAX_ATTEMPTS } from './ingest.repository';
import { backoffSeconds } from './publisher.worker';
import { GrowthEventEnvelope } from './envelope.types';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 *
 * The retry delay exists twice: `backoffSeconds()` in TypeScript writes the log line, and the
 * `next_attempt_at` expression in `markFailed` decides when the row is actually claimable again.
 * If those drift apart the service reports a schedule it does not keep — the failure mode the
 * whole buffer is meant to rule out, arriving as a reassuring log message.
 *
 * This spec pins them to each other at every attempt count, so a change to one fails until the
 * other follows.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';

const config = { get: (key: string) => (key === 'DATABASE_URL' ? TEST_DATABASE_URL : undefined) };

let db: DatabaseService;
let repo: IngestRepository;

const uuid = (n: number) => `7a1b2c3d-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
});

afterAll(async () => {
  await db.onModuleDestroy();
});

beforeEach(async () => {
  await db.query('TRUNCATE ingest.event_buffer');
});

describe('retry backoff — the logged delay is the enforced delay', () => {
  // Every attempt count the row can reach before it is declared dead.
  const attemptCounts = Array.from({ length: MAX_ATTEMPTS }, (_, i) => i);

  it.each(attemptCounts)(
    'stores the delay backoffSeconds() reports, after failure number %i',
    async (priorAttempts) => {
      await repo.insert(envelope(priorAttempts));
      await db.query('UPDATE ingest.event_buffer SET attempts = $1', [priorAttempts]);
      await db.withTransaction((client) =>
        repo.markFailed(client, uuid(priorAttempts), 'broker down'),
      );

      const { rows } = await db.query<{ seconds: number }>(
        `SELECT EXTRACT(EPOCH FROM (next_attempt_at - now()))::float AS seconds
           FROM ingest.event_buffer WHERE event_id = $1`,
        [uuid(priorAttempts)],
      );

      // The worker logs backoffSeconds(attempts + 1) for the attempt it just recorded.
      const expected = backoffSeconds(priorAttempts + 1);
      // A second of slack for the round trip; the point is the formula, not the clock.
      expect(rows[0].seconds).toBeGreaterThan(expected - 1.5);
      expect(rows[0].seconds).toBeLessThanOrEqual(expected);
    },
  );
});
