import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPublisher } from './publisher.worker';
import { BufferedEvent } from './envelope.types';

/**
 * Ecosystem convention is one durable topic exchange per producing service, named
 * `<service>.events`, with the event type as the routing key — `catalog.events`, `orders.events`,
 * `bpcp.events`. Consumers bind their own queues to the routing keys they care about, so growth
 * publishes without knowing who is listening.
 */
export const GROWTH_EVENTS_EXCHANGE = 'growth.events';

export type AmqpConnect = (url: string) => Promise<AmqpConnection>;

export interface AmqpConnection {
  createConfirmChannel(): Promise<AmqpChannel>;
  close(): Promise<void>;
  on?(event: string, listener: (err?: unknown) => void): void;
}

export interface AmqpChannel {
  assertExchange(exchange: string, type: 'topic', options: { durable: true }): Promise<unknown>;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Record<string, unknown>,
  ): boolean;
  waitForConfirms(): Promise<void>;
  close(): Promise<void>;
  on?(event: string, listener: (err?: unknown) => void): void;
}

/** Loaded lazily so the unit specs never need the native client present. */
const defaultConnect: AmqpConnect = async (url) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const amqp = require('amqplib') as { connect(url: string): Promise<AmqpConnection> };
  return amqp.connect(url);
};

/**
 * Publishes buffered envelopes to RabbitMQ (EP-005 W6).
 *
 * `publish()` resolving is the signal the drain uses to mark a row `published` and stop tracking
 * it, so it must mean the broker has durably accepted the message and nothing weaker. That is why
 * this uses a confirm channel and awaits `waitForConfirms()`: a plain channel's `publish()`
 * returns as soon as the bytes are handed to the socket, which would let the drain retire events
 * a broker crash then loses — the exact failure the buffer exists to prevent, moved one step
 * later where it is harder to see.
 */
@Injectable()
export class RabbitMqEventPublisher implements EventPublisher, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqEventPublisher.name);
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;
  private connecting: Promise<AmqpChannel> | null = null;

  constructor(
    private readonly config: ConfigService,
    // `@Optional()` because this is a seam for the specs, not a provider. Without it Nest reads
    // the emitted `Function` param type and tries to resolve it from the container, which fails
    // at boot — the default value is invisible to dependency injection.
    @Optional() private readonly connect: AmqpConnect = defaultConnect,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  get exchange(): string {
    return this.config.get<string>('GROWTH_EVENTS_EXCHANGE') ?? GROWTH_EVENTS_EXCHANGE;
  }

  async publish(event: BufferedEvent): Promise<void> {
    const channel = await this.channelReady();

    // The stored envelope, byte for byte. Re-deriving it here could emit something the ingestion
    // endpoint never validated against the schema.
    const content = Buffer.from(JSON.stringify(event.payload));

    channel.publish(this.exchange, event.eventType, content, {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      type: event.eventType,
      timestamp: Date.now(),
      headers: {
        workspaceId: event.workspaceId,
        eventVersion: event.eventVersion,
      },
    });

    await channel.waitForConfirms();
  }

  private async channelReady(): Promise<AmqpChannel> {
    if (this.channel) return this.channel;
    // A drain publishes in a loop; without this every event in the first batch would open its own
    // connection while the first was still handshaking.
    this.connecting ??= this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(): Promise<AmqpChannel> {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) {
      // Refusing here means the events stay in the buffer and are retried. Publishing to nowhere
      // would let the drain mark them published and lose them.
      throw new Error('[MISSING: RABBITMQ_URL] — cannot publish growth events');
    }

    const connection = await this.connect(url);
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(this.exchange, 'topic', { durable: true });

    // A dropped connection must not leave a stale channel behind: the next publish would write
    // into a closed socket and fail forever rather than reconnecting.
    connection.on?.('close', () => this.forget());
    connection.on?.('error', (err) => {
      this.logger.warn(`broker connection error: ${describe(err)}`);
      this.forget();
    });
    channel.on?.('close', () => this.forget());
    channel.on?.('error', (err) => {
      this.logger.warn(`broker channel error: ${describe(err)}`);
      this.forget();
    });

    this.connection = connection;
    this.channel = channel;
    this.logger.log(`connected to broker, publishing to exchange ${this.exchange}`);
    return channel;
  }

  private forget(): void {
    this.channel = null;
    this.connection = null;
  }

  private async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (err) {
      this.logger.warn(`error closing broker connection: ${describe(err)}`);
    } finally {
      this.forget();
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
