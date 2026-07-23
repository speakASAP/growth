import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttributionService } from './attribution.service';

export const AUTH_REDIRECT_QUEUE = 'growth.auth-redirects';
export const AUTH_REGISTRATION_QUEUE = 'growth.auth-registrations';
export const TOUCHPOINT_QUEUE = 'growth.touchpoints';

const GROWTH_EXCHANGE = 'growth.events';
const AUTH_EXCHANGE = 'auth.events';
const AUTH_REDIRECT_KEY = 'growth.auth_redirect.initiated.v1';
const TOUCHPOINT_KEY = 'growth.touchpoint.observed.v1';
const USER_REGISTERED_KEY = 'auth.user.registered.v1';

/** Bounded so a backlog stays the broker's problem rather than becoming this pod's memory. */
const PREFETCH = 20;

export type AmqpConnect = (url: string) => Promise<AmqpConnection>;

export interface AmqpConnection {
  createChannel(): Promise<AmqpChannel>;
  close(): Promise<void>;
  on?(event: string, listener: (err?: unknown) => void): void;
}

export interface AmqpMessage {
  content: Buffer;
}

export interface AmqpChannel {
  assertExchange(exchange: string, type: 'topic', options: { durable: true }): Promise<unknown>;
  assertQueue(queue: string, options: { durable: true }): Promise<unknown>;
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<unknown>;
  prefetch(count: number): Promise<unknown> | void;
  consume(queue: string, handler: (msg: AmqpMessage | null) => Promise<void> | void): Promise<unknown>;
  ack(msg: AmqpMessage): void;
  nack(msg: AmqpMessage, allUpTo: boolean, requeue: boolean): void;
  close(): Promise<void>;
  on?(event: string, listener: (err?: unknown) => void): void;
}

const defaultConnect: AmqpConnect = async (url) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const amqp = require('amqplib') as { connect(url: string): Promise<AmqpConnection> };
  return amqp.connect(url);
};

/**
 * Consumes both halves of the registration join (C-005 §2.2).
 *
 * The queues are **declared and bound here**, not by hand. A topic exchange discards a message
 * with no matching binding, so a queue that exists but is not bound looks perfectly healthy and
 * receives nothing — and the events it should have caught are already gone by the time anyone
 * notices. Declaring on boot also makes the binding survive a broker rebuild.
 *
 * Messages are acknowledged **after** the join has been written, never before. Acking first is
 * the same loss the ingest buffer exists to prevent, arriving from the other side.
 */
@Injectable()
export class AttributionConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AttributionConsumer.name);
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;

  constructor(
    private readonly attribution: AttributionService,
    private readonly config: ConfigService,
    @Optional() private readonly connect: AmqpConnect = defaultConnect,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.start();
    } catch (err) {
      // A broker that is down at boot must not crash-loop the pod: the ingestion endpoint and the
      // decision record both keep working without it, and the queues are durable, so the events
      // wait rather than disappear.
      this.logger.error(`could not start the attribution consumer: ${describe(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // Shutting down.
    }
  }

  async start(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) throw new Error('[MISSING: RABBITMQ_URL] — cannot consume attribution events');

    this.connection = await this.connect(url);
    const channel = await this.connection.createChannel();
    this.channel = channel;
    await channel.prefetch(PREFETCH);

    await this.bind(channel, GROWTH_EXCHANGE, AUTH_REDIRECT_QUEUE, AUTH_REDIRECT_KEY);
    await this.bind(channel, AUTH_EXCHANGE, AUTH_REGISTRATION_QUEUE, USER_REGISTERED_KEY);
    await this.bind(channel, GROWTH_EXCHANGE, TOUCHPOINT_QUEUE, TOUCHPOINT_KEY);

    await channel.consume(AUTH_REDIRECT_QUEUE, (msg) =>
      this.handle(channel, msg, (event) => this.attribution.onAuthRedirect(event as never)),
    );
    await channel.consume(AUTH_REGISTRATION_QUEUE, (msg) =>
      this.handle(channel, msg, (event) => this.attribution.onUserRegistered(event as never)),
    );
    await channel.consume(TOUCHPOINT_QUEUE, (msg) =>
      this.handle(channel, msg, (event) => this.attribution.onTouchpoint(event as never)),
    );

    this.logger.log(
      `consuming ${AUTH_REDIRECT_QUEUE}, ${AUTH_REGISTRATION_QUEUE} and ${TOUCHPOINT_QUEUE}`,
    );
  }

  private async bind(
    channel: AmqpChannel,
    exchange: string,
    queue: string,
    routingKey: string,
  ): Promise<void> {
    // Asserting the exchange too: the consumer may well boot before the producer has ever
    // published, and binding to an exchange that does not exist yet fails.
    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, routingKey);
  }

  private async handle(
    channel: AmqpChannel,
    msg: AmqpMessage | null,
    apply: (event: unknown) => Promise<void>,
  ): Promise<void> {
    // A null delivery is how the broker reports a cancelled consumer, not a message.
    if (!msg) return;

    let event: unknown;
    try {
      event = JSON.parse(msg.content.toString());
    } catch (err) {
      // Unparseable now means unparseable forever. Requeueing would spin the consumer and block
      // every valid message behind it, so it is dropped loudly instead.
      this.logger.error(
        `discarding an unparseable attribution message: ${describe(err)} — raw: ${msg.content
          .toString()
          .slice(0, 500)}`,
      );
      channel.nack(msg, false, false);
      return;
    }

    try {
      await apply(event);
      channel.ack(msg);
    } catch (err) {
      // Requeue: this is a database or logic failure, and the event is still needed. The join is
      // idempotent, so redelivery is safe.
      this.logger.error(`attribution join failed, requeueing: ${describe(err)}`);
      channel.nack(msg, false, true);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
