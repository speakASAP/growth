import { ConfigService } from '@nestjs/config';
import {
  AttributionConsumer,
  AUTH_REDIRECT_QUEUE,
  AUTH_REGISTRATION_QUEUE,
  TOUCHPOINT_QUEUE,
} from './attribution.consumer';
import { AttributionService } from './attribution.service';

/**
 * The consumer's job is narrow and its failure modes are all quiet ones: acknowledging a message
 * whose write never happened, binding a queue after the producer already started, or dying on one
 * malformed payload and silently processing nothing afterwards.
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

const serviceStub = () =>
  ({
    onAuthRedirect: jest.fn(async () => undefined),
    onUserRegistered: jest.fn(async () => undefined),
  }) as unknown as AttributionService & { onAuthRedirect: jest.Mock; onUserRegistered: jest.Mock };

const redirectEvent = { workspaceId: 'bazos', correlationId: 'c1', payload: { correlationId: 'c1', initiatedAt: 'now' } };
const registrationEvent = { correlationId: 'c1', payload: { userId: 'u1', registrationMethod: 'password', registeredAt: 'now' } };

describe('AttributionConsumer', () => {
  it('declares durable queues, so a broker restart does not drop pending events', async () => {
    const broker = fakeBroker();
    const consumer = new AttributionConsumer(serviceStub(), defaultConfig(), broker.connect);

    await consumer.start();

    expect(broker.queues.map((q) => q.name).sort()).toEqual(
      [AUTH_REDIRECT_QUEUE, AUTH_REGISTRATION_QUEUE, TOUCHPOINT_QUEUE].sort(),
    );
    expect(broker.queues.every((q) => (q.options as { durable: boolean }).durable)).toBe(true);
  });

  it('binds each queue to the event it consumes', async () => {
    // A topic exchange discards anything unmatched, so a queue that exists but is not bound looks
    // healthy and receives nothing at all.
    const broker = fakeBroker();
    const consumer = new AttributionConsumer(serviceStub(), defaultConfig(), broker.connect);

    await consumer.start();

    expect(broker.bindings).toEqual(
      expect.arrayContaining([
        { queue: AUTH_REDIRECT_QUEUE, exchange: 'growth.events', key: 'growth.auth_redirect.initiated.v1' },
        { queue: AUTH_REGISTRATION_QUEUE, exchange: 'auth.events', key: 'auth.user.registered.v1' },
        // S6d. Bound on boot like the other two: growth-core publishes touchpoints onto this same
        // exchange, and until this binding existed a topic exchange discarded every one of them.
        { queue: TOUCHPOINT_QUEUE, exchange: 'growth.events', key: 'growth.touchpoint.observed.v1' },
      ]),
    );
  });

  it('hands a click to the join and acknowledges it', async () => {
    const broker = fakeBroker();
    const service = serviceStub();
    const consumer = new AttributionConsumer(service, defaultConfig(), broker.connect);
    await consumer.start();

    await broker.deliver(AUTH_REDIRECT_QUEUE, redirectEvent);

    expect(service.onAuthRedirect).toHaveBeenCalledWith(redirectEvent);
    expect(broker.acked).toHaveLength(1);
  });

  it('hands a registration to the join and acknowledges it', async () => {
    const broker = fakeBroker();
    const service = serviceStub();
    const consumer = new AttributionConsumer(service, defaultConfig(), broker.connect);
    await consumer.start();

    await broker.deliver(AUTH_REGISTRATION_QUEUE, registrationEvent);

    expect(service.onUserRegistered).toHaveBeenCalledWith(registrationEvent);
    expect(broker.acked).toHaveLength(1);
  });

  it('does not acknowledge when the write failed', async () => {
    // Acknowledging first would be the same loss the ingest buffer exists to prevent, arriving
    // from the other direction: the message is gone and the join never happened.
    const broker = fakeBroker();
    const service = serviceStub();
    service.onAuthRedirect.mockRejectedValueOnce(new Error('database down'));
    const consumer = new AttributionConsumer(service, defaultConfig(), broker.connect);
    await consumer.start();

    await broker.deliver(AUTH_REDIRECT_QUEUE, redirectEvent);

    expect(broker.acked).toHaveLength(0);
    expect(broker.nacked).toHaveLength(1);
    expect(broker.nacked[0].requeue).toBe(true);
  });

  it('does not requeue a message it can never parse', async () => {
    // Requeueing malformed JSON forever would spin the consumer and block everything behind it.
    const broker = fakeBroker();
    const consumer = new AttributionConsumer(serviceStub(), defaultConfig(), broker.connect);
    await consumer.start();

    await broker.deliverRaw(AUTH_REDIRECT_QUEUE, '{not json');

    expect(broker.nacked).toHaveLength(1);
    expect(broker.nacked[0].requeue).toBe(false);
  });

  it('keeps consuming after one message fails', async () => {
    const broker = fakeBroker();
    const service = serviceStub();
    service.onAuthRedirect.mockRejectedValueOnce(new Error('transient'));
    const consumer = new AttributionConsumer(service, defaultConfig(), broker.connect);
    await consumer.start();

    await broker.deliver(AUTH_REDIRECT_QUEUE, redirectEvent);
    await broker.deliver(AUTH_REDIRECT_QUEUE, redirectEvent);

    expect(service.onAuthRedirect).toHaveBeenCalledTimes(2);
    expect(broker.acked).toHaveLength(1);
  });

  it('ignores a null delivery, which is how a cancelled consumer reports itself', async () => {
    const broker = fakeBroker();
    const consumer = new AttributionConsumer(serviceStub(), defaultConfig(), broker.connect);
    await consumer.start();

    await expect(broker.deliver(AUTH_REDIRECT_QUEUE, null)).resolves.toBeDefined();
  });

  it('refuses to start without a broker URL rather than appearing to consume', async () => {
    const consumer = new AttributionConsumer(serviceStub(), configWith({}), fakeBroker().connect);
    await expect(consumer.start()).rejects.toThrow(/RABBITMQ_URL/);
  });

  it('limits how many messages it takes at once', async () => {
    // Unbounded prefetch turns a backlog into a memory problem the moment the join slows down.
    const broker = fakeBroker();
    const consumer = new AttributionConsumer(serviceStub(), defaultConfig(), broker.connect);

    await consumer.start();

    expect(broker.channel.prefetch).toHaveBeenCalled();
  });
});
