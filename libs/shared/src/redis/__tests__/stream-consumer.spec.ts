/**
 * Redis Stream Consumer Primitives — Unit Tests
 *
 * Covers the parts with real failure modes (#2164): consumer identity must be
 * stable across restarts and free of `process.pid`; a trimmed entry must be
 * classified rather than handed to a handler as a malformed message; and the
 * reclaim idle floor must not be bypassable by a caller.
 *
 * @module libs/shared/src/redis/__tests__
 */
import { hostname } from 'os';

import {
  MIN_RECLAIM_IDLE_MS,
  readOwnPending,
  reclaimOrphans,
  resolveConsumerName,
  toPendingRows,
  WORKER_ID_ENV,
  type StreamConsumerClient,
} from '../stream-consumer';

const STREAM = 'jobs.sync';
const GROUP = 'job-intake';
const CONSUMER = 'job-intake-host-a';

const buildClient = (
  overrides: Partial<jest.Mocked<StreamConsumerClient>> = {}
): jest.Mocked<StreamConsumerClient> =>
  ({
    xPendingRange: jest.fn().mockResolvedValue([]),
    xRange: jest.fn().mockResolvedValue([]),
    xClaim: jest.fn().mockResolvedValue(undefined),
    xAck: jest.fn().mockResolvedValue(1),
    ...overrides,
  }) as unknown as jest.Mocked<StreamConsumerClient>;

describe('resolveConsumerName', () => {
  it('should use OL_WORKER_ID when it is set', () => {
    expect(resolveConsumerName('job-intake', { [WORKER_ID_ENV]: 'worker-3' })).toBe(
      'job-intake-worker-3'
    );
  });

  it('should fall back to hostname when OL_WORKER_ID is unset', () => {
    expect(resolveConsumerName('job-intake', {})).toBe(`job-intake-${hostname()}`);
  });

  it('should fall back to hostname when OL_WORKER_ID is blank', () => {
    expect(resolveConsumerName('job-intake', { [WORKER_ID_ENV]: '   ' })).toBe(
      `job-intake-${hostname()}`
    );
  });

  it('should never derive the name from process.pid', () => {
    // The pre-#2164 bug: in a container PID is typically 1, so replicas collided
    // on one PEL; outside a container it changed on every restart.
    expect(resolveConsumerName('job-intake', {})).not.toContain(String(process.pid));
  });

  it('should return an identical name across calls when the environment is unchanged', () => {
    const env = { [WORKER_ID_ENV]: 'worker-3' };
    expect(resolveConsumerName('webhook-handler', env)).toBe(
      resolveConsumerName('webhook-handler', env)
    );
  });
});

describe('toPendingRows', () => {
  it('should read a well-formed XPENDING reply', () => {
    const reply = [{ id: '1-0', owner: 'c1', millisecondsSinceLastDelivery: 42 }];

    expect(toPendingRows(reply)).toEqual([
      { id: '1-0', owner: 'c1', millisecondsSinceLastDelivery: 42 },
    ]);
  });

  it('should return an empty list when the reply is not an array', () => {
    expect(toPendingRows(null)).toEqual([]);
  });

  it('should skip rows carrying no usable id', () => {
    expect(toPendingRows([{ owner: 'c1' }, null, 'nonsense'])).toEqual([]);
  });

  it('should default a missing owner and idle time rather than dropping the row', () => {
    // Losing a row here would silently strand the message it names.
    expect(toPendingRows([{ id: '1-0' }])).toEqual([
      { id: '1-0', owner: '', millisecondsSinceLastDelivery: 0 },
    ]);
  });
});

describe('readOwnPending', () => {
  it('should scope the XPENDING scan to this consumer', async () => {
    const client = buildClient();

    await readOwnPending(client, STREAM, GROUP, CONSUMER, 10);

    expect(client.xPendingRange).toHaveBeenCalledWith(STREAM, GROUP, '-', '+', 10, {
      consumer: CONSUMER,
    });
  });

  it('should return a normal entry when the body still exists', async () => {
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([{ id: '1-0', owner: CONSUMER, millisecondsSinceLastDelivery: 1 }]),
      xRange: jest.fn().mockResolvedValue([{ id: '1-0', message: { jobType: 'a' } }]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    expect(await readOwnPending(client, STREAM, GROUP, CONSUMER, 10)).toEqual([
      { kind: 'entry', id: '1-0', fields: { jobType: 'a' } },
    ]);
  });

  it('should classify a pending id as trimmed when its body is gone', async () => {
    // Retention removed the entry while its id stayed in the PEL.
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([{ id: '1-0', owner: CONSUMER, millisecondsSinceLastDelivery: 1 }]),
      xRange: jest.fn().mockResolvedValue([]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    expect(await readOwnPending(client, STREAM, GROUP, CONSUMER, 10)).toEqual([
      { kind: 'trimmed', id: '1-0' },
    ]);
  });

  it('should classify an empty-bodied entry as trimmed', async () => {
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([{ id: '1-0', owner: CONSUMER, millisecondsSinceLastDelivery: 1 }]),
      xRange: jest.fn().mockResolvedValue([{ id: '1-0', message: {} }]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    expect(await readOwnPending(client, STREAM, GROUP, CONSUMER, 10)).toEqual([
      { kind: 'trimmed', id: '1-0' },
    ]);
  });

  it('should return an empty list when nothing is pending', async () => {
    expect(await readOwnPending(buildClient(), STREAM, GROUP, CONSUMER, 10)).toEqual([]);
  });
});

describe('reclaimOrphans', () => {
  it('should floor the idle threshold so a caller cannot configure work-stealing', async () => {
    const client = buildClient();

    await reclaimOrphans(client, STREAM, GROUP, CONSUMER, 1_000);

    expect(client.xPendingRange).toHaveBeenCalledWith(STREAM, GROUP, '-', '+', 10, {
      IDLE: MIN_RECLAIM_IDLE_MS,
    });
  });

  it('should pass a caller threshold through when it exceeds the floor', async () => {
    const client = buildClient();
    const idle = MIN_RECLAIM_IDLE_MS * 3;

    await reclaimOrphans(client, STREAM, GROUP, CONSUMER, idle);

    expect(client.xPendingRange).toHaveBeenCalledWith(STREAM, GROUP, '-', '+', 10, { IDLE: idle });
  });

  it('should not reclaim an entry this consumer already owns', async () => {
    // Its own pending history is the drain's job, not the reclaim's — claiming
    // it here would double-run work that may still be in flight.
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([
          { id: '1-0', owner: CONSUMER, millisecondsSinceLastDelivery: 999_999 },
        ]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    expect(await reclaimOrphans(client, STREAM, GROUP, CONSUMER, MIN_RECLAIM_IDLE_MS)).toEqual([]);
    expect(client.xClaim).not.toHaveBeenCalled();
  });

  it('should claim an entry owned by another consumer', async () => {
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([
          { id: '1-0', owner: 'dead-worker', millisecondsSinceLastDelivery: 9e5 },
        ]),
      xRange: jest.fn().mockResolvedValue([{ id: '1-0', message: { jobType: 'a' } }]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    const entries = await reclaimOrphans(client, STREAM, GROUP, CONSUMER, MIN_RECLAIM_IDLE_MS);

    expect(entries).toEqual([{ kind: 'entry', id: '1-0', fields: { jobType: 'a' } }]);
    expect(client.xClaim).toHaveBeenCalledWith(STREAM, GROUP, CONSUMER, MIN_RECLAIM_IDLE_MS, '1-0');
  });

  it('should re-assert the idle threshold on the claim itself', async () => {
    // XCLAIM only transfers ownership while the entry is still idle, so an owner
    // that woke up between the XPENDING and the claim keeps its message.
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([
          { id: '1-0', owner: 'dead-worker', millisecondsSinceLastDelivery: 9e5 },
        ]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    await reclaimOrphans(client, STREAM, GROUP, CONSUMER, MIN_RECLAIM_IDLE_MS);

    expect(client.xClaim).toHaveBeenCalledWith(STREAM, GROUP, CONSUMER, MIN_RECLAIM_IDLE_MS, '1-0');
  });

  it('should surface a reclaimed-but-trimmed entry so the caller can ACK it', async () => {
    const client = buildClient({
      xPendingRange: jest
        .fn()
        .mockResolvedValue([
          { id: '1-0', owner: 'dead-worker', millisecondsSinceLastDelivery: 9e5 },
        ]),
      xRange: jest.fn().mockResolvedValue([]),
    } as Partial<jest.Mocked<StreamConsumerClient>>);

    expect(await reclaimOrphans(client, STREAM, GROUP, CONSUMER, MIN_RECLAIM_IDLE_MS)).toEqual([
      { kind: 'trimmed', id: '1-0' },
    ]);
  });
});
