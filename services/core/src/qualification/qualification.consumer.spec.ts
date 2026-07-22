import { ConfigService } from '@nestjs/config';
import {
  LEAD_CREATED_QUEUE,
  LEAD_QUALIFICATION_QUEUE,
  QualificationConsumer,
} from './qualification.consumer';
import { QualificationService } from './qualification.service';

/**
 * `growth.lead-created` sat bound and unconsumed since S5, which is the failure this consumer's
 * tests are really about: a queue can look completely healthy while nothing reads it, and the same
 * is true of a queue that exists but was never bound. Both are asserted here rather than assumed.
 */
const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const defaultConfig = () => configWith({ RABBITMQ_URL: 'amqp://guest:guest@rabbitmq:5672' });

function fakeBroker() {
  const queues: Array<{ name: string; options: unknown }> = [];
  const bindings: Array<{ queue: string; exchange: string; key: string }> = [];
  const consumers: Record<string, (msg: unknown) => Promise<void> | void> = {};
  const acked: unknown[] = [];
  const nacked: Array<{ msg: unknown; requeue: boolean }> = [];

  const channel = {
    assertExchange: jest.fn(async () => undefined),
    assertQueue: jest.fn(async (name: string, options: unknown) => {
      queues.push({ name, options });
      return { queue: name };
    }),
    bindQueue: jest.fn(async (queue: string, exchange: string, key: string) => {
      bindings.push({ queue, exchange, key });
    }),
    prefetch: jest.fn(async () => undefined),
    consume: jest.fn(async (queue: string, handler: (msg: unknown) => Promise<void> | void) => {
      consumers[queue] = handler;
      return { consumerTag: `tag-${queue}` };
    }),
    ack: jest.fn((msg: unknown) => acked.push(msg)),
    nack: jest.fn((msg: unknown, _all: boolean, requeue: boolean) => nacked.push({ msg, requeue })),
    close: jest.fn(async () => undefined),
    on: jest.fn(),
  };

  const connection = {
    createChannel: jest.fn(async () => channel),
    close: jest.fn(async () => undefined),
    on: jest.fn(),
  };

  return {
    connect: jest.fn(async () => connection as never),
    channel,
    queues,
    bindings,
    acked,
    nacked,
    deliver: async (queue: string, body: unknown) => {
      const msg = { content: Buffer.from(JSON.stringify(body)), fields: {}, properties: {} };
      await consumers[queue](msg);
      return msg;
    },
    deliverRaw: async (queue: string, raw: string) => {
      const msg = { content: Buffer.from(raw), fields: {}, properties: {} };
      await consumers[queue](msg);
      return msg;
    },
  };
}

function build(options: { failWrites?: boolean } = {}) {
  const service = {
    onLeadCreated: jest.fn(async () => {
      if (options.failWrites) throw new Error('database down');
    }),
    onQualificationRecorded: jest.fn(async () => {
      if (options.failWrites) throw new Error('database down');
    }),
  } as unknown as QualificationService;

  const broker = fakeBroker();
  const consumer = new QualificationConsumer(service, defaultConfig(), broker.connect as never);
  return { consumer, service, broker };
}

describe('declaring and binding', () => {
  it('declares both queues durably and binds them to leads.events', async () => {
    const { consumer, broker } = build();

    await consumer.start();

    expect(broker.queues).toEqual([
      { name: LEAD_CREATED_QUEUE, options: { durable: true } },
      { name: LEAD_QUALIFICATION_QUEUE, options: { durable: true } },
    ]);

    // A topic exchange discards a message with no matching binding, so an unbound queue receives
    // nothing while reporting itself perfectly healthy.
    expect(broker.bindings).toEqual([
      {
        queue: LEAD_CREATED_QUEUE,
        exchange: 'leads.events',
        key: 'growth.lead.created_from_registration.v1',
      },
      {
        queue: LEAD_QUALIFICATION_QUEUE,
        exchange: 'leads.events',
        key: 'growth.lead.qualification_recorded.v1',
      },
    ]);
  });

  it('asserts the exchange, since it may boot before leads has ever published', async () => {
    const { consumer, broker } = build();

    await consumer.start();

    expect(broker.channel.assertExchange).toHaveBeenCalledWith('leads.events', 'topic', { durable: true });
  });

  it('consumes both queues', async () => {
    const { consumer, broker } = build();

    await consumer.start();

    const consumed = broker.channel.consume.mock.calls.map((call) => call[0]);
    expect(consumed).toEqual([LEAD_CREATED_QUEUE, LEAD_QUALIFICATION_QUEUE]);
  });
});

describe('acknowledging', () => {
  it('acks a lead only after the write returned', async () => {
    const { consumer, service, broker } = build();
    await consumer.start();

    await broker.deliver(LEAD_CREATED_QUEUE, { payload: { leadId: 'lead-1' } });

    expect(service.onLeadCreated).toHaveBeenCalled();
    expect(broker.acked).toHaveLength(1);
    expect(broker.nacked).toHaveLength(0);
  });

  it('acks a judgement only after the write returned', async () => {
    const { consumer, service, broker } = build();
    await consumer.start();

    await broker.deliver(LEAD_QUALIFICATION_QUEUE, { payload: { qualificationId: 'q-1' } });

    expect(service.onQualificationRecorded).toHaveBeenCalled();
    expect(broker.acked).toHaveLength(1);
  });

  // Acking a message whose write failed loses the owner's judgement permanently and silently.
  it('requeues when the write failed', async () => {
    const { consumer, broker } = build({ failWrites: true });
    await consumer.start();

    await broker.deliver(LEAD_QUALIFICATION_QUEUE, { payload: { qualificationId: 'q-1' } });

    expect(broker.acked).toHaveLength(0);
    expect(broker.nacked).toEqual([{ msg: expect.anything(), requeue: true }]);
  });

  // Unparseable now is unparseable forever: requeueing would spin the consumer and block every
  // valid message behind it.
  it('drops an unparseable message without requeueing it', async () => {
    const { consumer, broker } = build();
    await consumer.start();

    await broker.deliverRaw(LEAD_CREATED_QUEUE, 'not json at all');

    expect(broker.acked).toHaveLength(0);
    expect(broker.nacked).toEqual([{ msg: expect.anything(), requeue: false }]);
  });

  it('ignores a null delivery, which is a cancelled consumer and not a message', async () => {
    const { consumer, service, broker } = build();
    await consumer.start();

    await broker.channel.consume.mock.calls[0][1](null);

    expect(service.onLeadCreated).not.toHaveBeenCalled();
    expect(broker.acked).toHaveLength(0);
  });
});

describe('booting without a broker', () => {
  it('refuses to start with no RABBITMQ_URL rather than pretending to consume', async () => {
    const service = {} as QualificationService;
    const consumer = new QualificationConsumer(service, configWith({}), fakeBroker().connect as never);

    await expect(consumer.start()).rejects.toThrow('[MISSING: RABBITMQ_URL]');
  });

  it('does not crash-loop the pod when the broker is down at boot', async () => {
    const service = {} as QualificationService;
    const connect = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const consumer = new QualificationConsumer(service, defaultConfig(), connect as never);

    // The queues are durable, so events wait rather than disappear, and every other surface of
    // growth-core keeps working while the broker is away.
    await expect(consumer.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
