import { ConfigService } from '@nestjs/config';
import { DEFAULT_DRAIN_INTERVAL_MS, DrainScheduler } from './drain.scheduler';
import { PublisherWorker } from './publisher.worker';

/**
 * Until this existed, `PublisherWorker.drain()` was never called in a running service: events
 * were accepted, committed to the buffer, and stayed there. The endpoint answered 202, the health
 * check was green, and nothing downstream ever received an event.
 */
const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const workerReturning = (impl: () => Promise<{ published: number; failed: number }>) =>
  ({ drain: jest.fn(impl) }) as unknown as PublisherWorker & { drain: jest.Mock };

const idle = () => Promise.resolve({ published: 0, failed: 0 });

describe('DrainScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('drains repeatedly on the configured interval', async () => {
    const worker = workerReturning(idle);
    const scheduler = new DrainScheduler(worker, configWith({ GROWTH_DRAIN_INTERVAL_MS: '1000' }));

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3000);
    scheduler.onModuleDestroy();

    expect(worker.drain).toHaveBeenCalledTimes(3);
  });

  it('falls back to the default interval when none is configured', async () => {
    const worker = workerReturning(idle);
    const scheduler = new DrainScheduler(worker, configWith({}));

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(DEFAULT_DRAIN_INTERVAL_MS);
    scheduler.onModuleDestroy();

    expect(worker.drain).toHaveBeenCalledTimes(1);
  });

  it('does not start a drain while the previous one is still running', async () => {
    // A slow broker must not accumulate overlapping drains: each claims its own batch inside its
    // own transaction, so piling them up multiplies open transactions against one connection pool
    // for no extra throughput.
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = workerReturning(async () => {
      await inFlight;
      return { published: 0, failed: 0 };
    });
    const scheduler = new DrainScheduler(worker, configWith({ GROWTH_DRAIN_INTERVAL_MS: '1000' }));

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);

    expect(worker.drain).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    scheduler.onModuleDestroy();
  });

  it('keeps draining after a drain throws', async () => {
    // The buffer's promise is "published late, never lost". A scheduler that dies on the first
    // database blip converts a transient fault into permanent silence.
    const worker = workerReturning(idle);
    worker.drain.mockRejectedValueOnce(new Error('connection terminated'));
    const scheduler = new DrainScheduler(worker, configWith({ GROWTH_DRAIN_INTERVAL_MS: '1000' }));

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3000);
    scheduler.onModuleDestroy();

    expect(worker.drain).toHaveBeenCalledTimes(3);
  });

  it('stops draining once the module is destroyed', async () => {
    const worker = workerReturning(idle);
    const scheduler = new DrainScheduler(worker, configWith({ GROWTH_DRAIN_INTERVAL_MS: '1000' }));

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2000);
    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);

    expect(worker.drain).toHaveBeenCalledTimes(2);
  });
});
