import { msUntilNextRun, RETENTION_HOUR, RETENTION_TIMEZONE, RetentionScheduler } from './retention.scheduler';
import { RetentionService } from './retention.service';

/**
 * C-005 §6 puts the sweep at 03:00 Europe/Prague, daily. `RetentionService.sweep()` was written
 * for S5 but nothing ever called it, so the retention rule existed only on paper.
 */
const serviceReturning = (impl: () => Promise<unknown>) =>
  ({ sweep: jest.fn(impl) }) as unknown as RetentionService & { sweep: jest.Mock };

const quiet = () => Promise.resolve({ deleted: 0, remaining: {} });

const HOUR = 60 * 60 * 1000;

describe('msUntilNextRun', () => {
  it('waits until 03:00 Prague when called earlier the same day', () => {
    // 2026-07-20T00:30 Prague is 22:30 UTC on the 19th (CEST, UTC+2).
    const now = new Date('2026-07-19T22:30:00Z');
    expect(msUntilNextRun(now, RETENTION_HOUR, RETENTION_TIMEZONE)).toBe(2.5 * HOUR);
  });

  it('waits until tomorrow when 03:00 has already passed today', () => {
    // 2026-07-20T04:00 Prague.
    const now = new Date('2026-07-20T02:00:00Z');
    expect(msUntilNextRun(now, RETENTION_HOUR, RETENTION_TIMEZONE)).toBe(23 * HOUR);
  });

  it('tracks Prague local time in winter, not a fixed UTC offset', () => {
    // 2026-01-15T01:00 Prague is 00:00 UTC (CET, UTC+1). Handling this with a hardcoded offset
    // would silently drift the job by an hour for half the year.
    const now = new Date('2026-01-15T00:00:00Z');
    expect(msUntilNextRun(now, RETENTION_HOUR, RETENTION_TIMEZONE)).toBe(2 * HOUR);
  });

  it('never returns zero, so a run cannot immediately reschedule itself into a loop', () => {
    const now = new Date('2026-07-20T01:00:00Z'); // exactly 03:00 Prague
    expect(msUntilNextRun(now, RETENTION_HOUR, RETENTION_TIMEZONE)).toBe(24 * HOUR);
  });
});

describe('RetentionScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sweeps at the next 03:00 and again each day after', async () => {
    jest.setSystemTime(new Date('2026-07-19T22:30:00Z')); // 00:30 Prague
    const service = serviceReturning(quiet);
    const scheduler = new RetentionScheduler(service);

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2.5 * HOUR);
    expect(service.sweep).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(24 * HOUR);
    expect(service.sweep).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('reschedules after a failing sweep instead of stopping for good', async () => {
    jest.setSystemTime(new Date('2026-07-19T22:30:00Z'));
    const service = serviceReturning(quiet);
    service.sweep.mockRejectedValueOnce(new Error('database down'));
    const scheduler = new RetentionScheduler(service);

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2.5 * HOUR);
    await jest.advanceTimersByTimeAsync(24 * HOUR);

    expect(service.sweep).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
  });

  it('stops once the module is destroyed', async () => {
    jest.setSystemTime(new Date('2026-07-19T22:30:00Z'));
    const service = serviceReturning(quiet);
    const scheduler = new RetentionScheduler(service);

    scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(48 * HOUR);

    expect(service.sweep).not.toHaveBeenCalled();
  });
});
