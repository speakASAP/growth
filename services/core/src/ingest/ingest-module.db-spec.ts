import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IngestModule } from './ingest.module';
import { DrainScheduler } from './drain.scheduler';
import { RetentionScheduler } from './retention.scheduler';
import { PublisherWorker } from './publisher.worker';
import { RabbitMqEventPublisher } from './rabbitmq.publisher';
import { EVENT_PUBLISHER } from './publisher.worker';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 *
 * Everything else in this slice is tested against classes constructed by hand, which proves the
 * logic but not the wiring. A missing provider or an interface Nest cannot resolve by token
 * surfaces only when the container is built — that is, as a pod that crash-loops on boot, after
 * a deploy, in production. This spec builds the real container instead.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';

let app: INestApplication;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  // A URL, not a live broker: nothing here publishes. The publisher connects lazily on the first
  // drain, so the container builds without one.
  process.env.RABBITMQ_URL = 'amqp://guest:guest@127.0.0.1:5672';
  // Long enough that no drain fires during the spec.
  process.env.GROWTH_DRAIN_INTERVAL_MS = '3600000';

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), IngestModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('IngestModule wiring', () => {
  it('builds the container with the drain path fully resolved', () => {
    expect(app.get(PublisherWorker)).toBeInstanceOf(PublisherWorker);
    expect(app.get(DrainScheduler)).toBeInstanceOf(DrainScheduler);
    expect(app.get(RetentionScheduler)).toBeInstanceOf(RetentionScheduler);
  });

  it('resolves the EventPublisher token to the RabbitMQ implementation', () => {
    // The worker depends on the interface; if this token pointed at nothing, or at a second
    // instance, events would be published by an object nobody else can observe or shut down.
    expect(app.get(EVENT_PUBLISHER)).toBe(app.get(RabbitMqEventPublisher));
  });

  it('starts the drain timer once the application has bootstrapped', async () => {
    // app.init() runs onApplicationBootstrap. If the scheduler were registered but never started,
    // every test above would still pass and no event would ever be published.
    const scheduler = app.get(DrainScheduler);
    expect(scheduler.intervalMs).toBe(3_600_000);
    await expect(app.get(PublisherWorker).drain()).resolves.toEqual({ published: 0, failed: 0 });
  });
});
