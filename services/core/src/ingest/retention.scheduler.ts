import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { RetentionService } from './retention.service';

/** C-005 §6 — daily at 03:00 Europe/Prague. */
export const RETENTION_HOUR = 3;
export const RETENTION_TIMEZONE = 'Europe/Prague';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds from `now` until the next occurrence of `hour` in `timeZone`.
 *
 * The zone is resolved through `Intl` rather than a fixed offset because Prague is UTC+1 in
 * winter and UTC+2 in summer; a hardcoded offset would run the job an hour off for half the year
 * and nobody would notice, because a retention sweep at 02:00 looks exactly like one at 03:00.
 *
 * Never returns 0: a run landing exactly on the hour would otherwise reschedule itself for the
 * same instant and spin.
 */
export function msUntilNextRun(now: Date, hour: number, timeZone: string): number {
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const part = (type: string) => Number(local.find((p) => p.type === type)?.value ?? 0);
  const msIntoLocalDay =
    (part('hour') % 24) * 60 * 60 * 1000 + part('minute') * 60 * 1000 + part('second') * 1000;

  const target = hour * 60 * 60 * 1000;
  const delta = target - msIntoLocalDay;
  return delta > 0 ? delta : delta + DAY_MS;
}

/**
 * Runs the retention sweep (C-005 §6).
 *
 * `RetentionService.sweep()` existed from S5 but had no caller, so published rows accumulated
 * forever and the `dead`-row warning — the alert that something cannot be published at all —
 * was never emitted. A retention policy nothing invokes is indistinguishable from no policy.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly retention: RetentionService) {}

  onApplicationBootstrap(): void {
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const wait = msUntilNextRun(new Date(), RETENTION_HOUR, RETENTION_TIMEZONE);
    this.logger.log(
      `next retention sweep in ${Math.round(wait / 60000)} minutes ` +
        `(${RETENTION_HOUR}:00 ${RETENTION_TIMEZONE})`,
    );
    this.timer = setTimeout(() => void this.run(), wait);
  }

  private async run(): Promise<void> {
    try {
      await this.retention.sweep();
    } catch (err) {
      // One failed sweep is a bad night, not a reason to stop sweeping for the life of the pod.
      this.logger.error(`retention sweep failed: ${describe(err)}`);
    } finally {
      this.scheduleNext();
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
