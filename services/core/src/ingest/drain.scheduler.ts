import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublisherWorker } from './publisher.worker';

/** Fast enough that a landing event reaches consumers while the visit is still interesting. */
export const DEFAULT_DRAIN_INTERVAL_MS = 5_000;

/**
 * Runs the buffer drain (EP-005 W6).
 *
 * A plain interval rather than `@nestjs/schedule`: the drain wants "every few seconds", not a
 * calendar expression, and `@Cron` decorators depend on `reflect-metadata` emitting design-time
 * types — which the ecosystem has already been bitten by on Node 22+. One `setInterval` has no
 * such failure mode and one less dependency.
 */
@Injectable()
export class DrainScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DrainScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly worker: PublisherWorker,
    private readonly config: ConfigService,
  ) {}

  get intervalMs(): number {
    const configured = Number(this.config.get<string>('GROWTH_DRAIN_INTERVAL_MS'));
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DRAIN_INTERVAL_MS;
  }

  onApplicationBootstrap(): void {
    const interval = this.intervalMs;
    this.timer = setInterval(() => void this.tick(), interval);
    this.logger.log(`draining the event buffer every ${interval}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    // A drain slower than the interval must not stack: each claims its own batch in its own
    // transaction, so overlapping runs only multiply open transactions.
    if (this.running) return;
    this.running = true;
    try {
      await this.worker.drain();
    } catch (err) {
      // Swallowed on purpose. The buffer's promise is "published late, never lost"; letting a
      // transient database error kill the interval would turn a blip into permanent silence,
      // with every subsequent event accepted and never published.
      this.logger.error(`drain failed, retrying next tick: ${describe(err)}`);
    } finally {
      this.running = false;
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
