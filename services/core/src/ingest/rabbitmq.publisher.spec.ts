import { ConfigService } from '@nestjs/config';
import { AmqpConnect, GROWTH_EVENTS_EXCHANGE, RabbitMqEventPublisher } from './rabbitmq.publisher';
import { BufferedEvent } from './envelope.types';

/**
 * The publisher is the far edge of the durability promise. The buffer guarantees an accepted event
 * is not lost before the broker has it; these specs cover the other half — that `publish()`
 * resolving means the broker really took the message, because the drain marks the row `published`
 * on exactly that signal and never looks at it again.
 */

const event = (overrides: Partial<BufferedEvent> = {}): BufferedEvent => ({
  eventId: 'a1b2c3d4-0000-4000-8000-000000000001',
  workspaceId: 'ws-1',
  eventType: 'growth.touchpoint.observed.v1',
  eventVersion: 1,
  payload: {
    eventId: 'a1b2c3d4-0000-4000-8000-000000000001',
    eventType: 'growth.touchpoint.observed.v1',
    eventVersion: 1,
    occurredAt: '2026-07-20T10:00:00.000Z',
    producer: 'growth-web',
    workspaceId: 'ws-1',
    correlationId: 'corr-1',
    dataClass: 'anonymous',
    payload: { gclid: 'abc' },
  },
  status: 'pending',
  attempts: 0,
  ...overrides,
});

interface Published {
  exchange: string;
  routingKey: string;
  content: Buffer;
  options: Record<string, unknown>;
}

/** A broker stand-in recording what it was asked to do. */
function fakeBroker(behaviour: { confirmFails?: Error; publishReturns?: boolean } = {}) {
  const published: Published[] = [];
  const exchanges: Array<{ name: string; type: string; options: unknown }> = [];
  let connects = 0;
  let confirmChannels = 0;
  const handlers: Record<string, Array<(err?: unknown) => void>> = {};

  const channel = {
    assertExchange: jest.fn(async (name: string, type: string, options: unknown) => {
      exchanges.push({ name, type, options });
    }),
    publish: jest.fn((exchange: string, routingKey: string, content: Buffer, options: Record<string, unknown>) => {
      published.push({ exchange, routingKey, content, options });
      return behaviour.publishReturns ?? true;
    }),
    waitForConfirms: jest.fn(async () => {
      if (behaviour.confirmFails) throw behaviour.confirmFails;
    }),
    close: jest.fn(async () => undefined),
    on: (evt: string, fn: (err?: unknown) => void) => {
      (handlers[evt] ??= []).push(fn);
    },
  };

  const connection = {
    createConfirmChannel: jest.fn(async () => {
      confirmChannels += 1;
      return channel;
    }),
    close: jest.fn(async () => undefined),
    on: (evt: string, fn: (err?: unknown) => void) => {
      (handlers[evt] ??= []).push(fn);
    },
  };

  const connect: AmqpConnect = jest.fn(async () => {
    connects += 1;
    return connection as never;
  });

  return {
    connect,
    channel,
    connection,
    published,
    exchanges,
    fire: (evt: string, err?: unknown) => handlers[evt]?.forEach((fn) => fn(err)),
    get connects() {
      return connects;
    },
    get confirmChannels() {
      return confirmChannels;
    },
  };
}

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const defaultConfig = () => configWith({ RABBITMQ_URL: 'amqp://guest:guest@rabbitmq:5672' });

describe('RabbitMqEventPublisher', () => {
  it('publishes to the growth exchange with the event type as the routing key', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await publisher.publish(event());

    expect(broker.published).toHaveLength(1);
    expect(broker.published[0].exchange).toBe(GROWTH_EVENTS_EXCHANGE);
    expect(broker.published[0].routingKey).toBe('growth.touchpoint.observed.v1');
  });

  it('sends the buffered envelope verbatim, not a re-derived one', async () => {
    // The buffer stored exactly what the producer sent; anything reassembled here could differ
    // from what the ingestion endpoint validated against the schema.
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);
    const e = event();

    await publisher.publish(e);

    expect(JSON.parse(broker.published[0].content.toString())).toEqual(e.payload);
  });

  it('declares the exchange durable so a broker restart does not discard it', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await publisher.publish(event());

    expect(broker.exchanges).toEqual([
      { name: GROWTH_EVENTS_EXCHANGE, type: 'topic', options: { durable: true } },
    ]);
  });

  it('marks messages persistent and identifies them by eventId', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await publisher.publish(event());

    expect(broker.published[0].options).toMatchObject({
      persistent: true,
      contentType: 'application/json',
      messageId: 'a1b2c3d4-0000-4000-8000-000000000001',
      type: 'growth.touchpoint.observed.v1',
    });
  });

  it('uses a confirm channel and waits for the broker to acknowledge', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await publisher.publish(event());

    expect(broker.confirmChannels).toBe(1);
    expect(broker.channel.waitForConfirms).toHaveBeenCalled();
  });

  it('fails when the broker refuses to confirm, so the row is retried rather than marked published', async () => {
    // Without this the drain would mark the row published on a message the broker never stored —
    // the buffer's whole promise broken silently at the last step.
    const broker = fakeBroker({ confirmFails: new Error('nack') });
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await expect(publisher.publish(event())).rejects.toThrow('nack');
  });

  it('reuses one connection across publishes', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await publisher.publish(event());
    await publisher.publish(event({ eventId: 'second' }));

    expect(broker.connects).toBe(1);
    expect(broker.published).toHaveLength(2);
  });

  it('reconnects after the connection drops', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(defaultConfig(), broker.connect);

    await publisher.publish(event());
    broker.fire('close');
    await publisher.publish(event({ eventId: 'after-drop' }));

    expect(broker.connects).toBe(2);
  });

  it('refuses to start without a broker URL rather than dropping events silently', async () => {
    const publisher = new RabbitMqEventPublisher(configWith({}), fakeBroker().connect);

    await expect(publisher.publish(event())).rejects.toThrow(/RABBITMQ_URL/);
  });

  it('honours an overridden exchange name', async () => {
    const broker = fakeBroker();
    const publisher = new RabbitMqEventPublisher(
      configWith({ RABBITMQ_URL: 'amqp://x', GROWTH_EVENTS_EXCHANGE: 'growth.events.staging' }),
      broker.connect,
    );

    await publisher.publish(event());

    expect(broker.published[0].exchange).toBe('growth.events.staging');
  });
});
