import { PublisherWorker, backoffSeconds, EventPublisher } from './publisher.worker';
import { MAX_ATTEMPTS } from './ingest.repository';
import { BufferedEvent } from './envelope.types';

const event = (over: Partial<BufferedEvent> = {}): BufferedEvent => ({
  eventId: 'e1',
  workspaceId: 'ws-1',
  eventType: 'growth.auth_redirect.initiated.v1',
  eventVersion: 1,
  payload: {} as BufferedEvent['payload'],
  status: 'pending',
  attempts: 0,
  ...over,
});

/** Runs `work` immediately with a stub client — the worker's transaction boundary is not under test here. */
const fakeDb = () => ({ withTransaction: (work: (c: unknown) => unknown) => work({}) });

function makeWorker(claimed: BufferedEvent[], publisher: EventPublisher) {
  const repository = {
    claimPending: jest.fn().mockResolvedValue(claimed),
    markPublished: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const worker = new PublisherWorker(
    fakeDb() as never,
    repository as never,
    publisher,
  );
  return { worker, repository };
}

describe('backoffSeconds', () => {
  it('doubles per attempt and caps at 300s (C-005 §5)', () => {
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(4)).toBe(16);
    expect(backoffSeconds(8)).toBe(256);
    expect(backoffSeconds(9)).toBe(300);
    expect(backoffSeconds(50)).toBe(300);
  });
});

describe('PublisherWorker.drain', () => {
  it('marks a published event and reports it', async () => {
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const { worker, repository } = makeWorker([event()], publisher);

    await expect(worker.drain()).resolves.toEqual({ published: 1, failed: 0 });
    expect(repository.markPublished).toHaveBeenCalledWith({}, 'e1');
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('records a failure without rethrowing', async () => {
    const publisher = { publish: jest.fn().mockRejectedValue(new Error('broker down')) };
    const { worker, repository } = makeWorker([event()], publisher);

    await expect(worker.drain()).resolves.toEqual({ published: 0, failed: 1 });
    expect(repository.markFailed).toHaveBeenCalledWith({}, 'e1', 'broker down');
  });

  it('keeps draining after a poison event — one bad row must not block the queue', async () => {
    const publisher = {
      publish: jest
        .fn()
        .mockRejectedValueOnce(new Error('poison'))
        .mockResolvedValue(undefined),
    };
    const { worker, repository } = makeWorker(
      [event({ eventId: 'bad' }), event({ eventId: 'good-1' }), event({ eventId: 'good-2' })],
      publisher,
    );

    await expect(worker.drain()).resolves.toEqual({ published: 2, failed: 1 });
    expect(repository.markPublished).toHaveBeenCalledWith({}, 'good-1');
    expect(repository.markPublished).toHaveBeenCalledWith({}, 'good-2');
  });

  it('does nothing when the buffer is empty', async () => {
    const publisher = { publish: jest.fn() };
    const { worker } = makeWorker([], publisher);

    await expect(worker.drain()).resolves.toEqual({ published: 0, failed: 0 });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('still records the attempt that exhausts the retry budget', async () => {
    // The row is about to become `dead` and will never be claimed again, so this write is the
    // only record that the event was lost — dropping it would make the loss invisible.
    const publisher = { publish: jest.fn().mockRejectedValue(new Error('still down')) };
    const { worker, repository } = makeWorker(
      [event({ attempts: MAX_ATTEMPTS - 1 })],
      publisher,
    );

    await expect(worker.drain()).resolves.toEqual({ published: 0, failed: 1 });
    expect(repository.markFailed).toHaveBeenCalledWith({}, 'e1', 'still down');
  });
});
