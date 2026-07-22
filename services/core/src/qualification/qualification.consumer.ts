import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QualificationService } from './qualification.service';
import type { AmqpChannel, AmqpConnect, AmqpConnection, AmqpMessage } from '../attribution/attribution.consumer';

export const LEAD_CREATED_QUEUE = 'growth.lead-created';
export const LEAD_QUALIFICATION_QUEUE = 'growth.lead-qualification';

const LEADS_EXCHANGE = 'leads.events';
const LEAD_CREATED_KEY = 'growth.lead.created_from_registration.v1';
const LEAD_QUALIFICATION_KEY = 'growth.lead.qualification_recorded.v1';

const PREFETCH = 20;

const defaultConnect: AmqpConnect = async (url) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const amqp = require('amqplib') as { connect(url: string): Promise<AmqpConnection> };
  return amqp.connect(url);
};

/**
 * Consumes the lead and the judgement (C-006 §3).
 *
 * `growth.lead-created` was declared and bound during S5 and had no consumer until this slice —
 * the queue was holding leads that nothing read. Both queues are declared **and bound** here
 * rather than by hand: a topic exchange discards a message with no matching binding, so a queue
 * that exists but is not bound looks perfectly healthy and receives nothing.
 *
 * The two queues are independent and nothing orders them, so a judgement can arrive before the
 * lead it is about. That is handled in storage (no foreign key) rather than here — a consumer that
 * rejected an early judgement would nack it into a requeue spin against a row not yet written.
 */
@Injectable()
export class QualificationConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QualificationConsumer.name);
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;

  constructor(
    private readonly qualification: QualificationService,
    private readonly config: ConfigService,
    @Optional() private readonly connect: AmqpConnect = defaultConnect,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.start();
    } catch (err) {
      // A broker down at boot must not crash-loop the pod. The queues are durable, so the events
      // wait rather than disappear, and every other surface of this service keeps working.
      this.logger.error(`could not start the qualification consumer: ${describe(err)}`);
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
    if (!url) throw new Error('[MISSING: RABBITMQ_URL] — cannot consume qualification events');

    this.connection = await this.connect(url);
    const channel = await this.connection.createChannel();
    this.channel = channel;
    await channel.prefetch(PREFETCH);

    await this.bind(channel, LEAD_CREATED_QUEUE, LEAD_CREATED_KEY);
    await this.bind(channel, LEAD_QUALIFICATION_QUEUE, LEAD_QUALIFICATION_KEY);

    await channel.consume(LEAD_CREATED_QUEUE, (msg) =>
      this.handle(channel, msg, (event) => this.qualification.onLeadCreated(event as never)),
    );
    await channel.consume(LEAD_QUALIFICATION_QUEUE, (msg) =>
      this.handle(channel, msg, (event) => this.qualification.onQualificationRecorded(event as never)),
    );

    this.logger.log(`consuming ${LEAD_CREATED_QUEUE} and ${LEAD_QUALIFICATION_QUEUE}`);
  }

  private async bind(channel: AmqpChannel, queue: string, routingKey: string): Promise<void> {
    // Asserting the exchange too: this consumer may boot before leads-microservice has ever
    // published, and binding to an exchange that does not exist yet fails.
    await channel.assertExchange(LEADS_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, LEADS_EXCHANGE, routingKey);
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
        `discarding an unparseable qualification message: ${describe(err)} — raw: ${msg.content
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
      // Requeue: a database or logic failure, and the event is still needed. Both writes are
      // idempotent, so redelivery is safe.
      this.logger.error(`qualification write failed, requeueing: ${describe(err)}`);
      channel.nack(msg, false, true);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
