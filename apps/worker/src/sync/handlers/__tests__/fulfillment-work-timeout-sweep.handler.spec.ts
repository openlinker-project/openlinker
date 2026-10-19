/**
 * FulfillmentWorkTimeoutSweepHandler — unit spec (#2712)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJob } from '@openlinker/core/sync';

import {
  FulfillmentWorkTimeoutSweepHandler,
  fulfillmentTimeoutSweepLockKey,
} from '../fulfillment-work-timeout-sweep.handler';

const emptyResult = {
  examined: 0,
  reaped: 0,
  raced: 0,
  skippedUnassigned: 0,
  failed: 0,
  timeoutMs: 7_200_000,
  attentionIntents: [],
};

const emptyStalled = { works: [], nextAfterWorkId: null, attentionIntents: [] };

describe('FulfillmentWorkTimeoutSweepHandler (#2712)', () => {
  let timeouts: {
    reapTimedOutDispatches: jest.Mock;
    recomputeAcceptanceAttention: jest.Mock;
    findStalledUnsubmitted: jest.Mock;
  };
  let orderRecords: { markOmsAttention: jest.Mock };
  let connections: { get: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let configService: { get: jest.Mock };
  let handler: FulfillmentWorkTimeoutSweepHandler;

  const job = (payload: Record<string, unknown> | null = { schemaVersion: 1 }): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.work.timeoutSweep' as unknown as SyncJob['jobType'],
      connectionId: '00000000-0000-0000-0000-000000000000',
      payload,
    }) as unknown as SyncJob;

  beforeEach(() => {
    timeouts = {
      reapTimedOutDispatches: jest.fn().mockResolvedValue(emptyResult),
      recomputeAcceptanceAttention: jest.fn(),
      findStalledUnsubmitted: jest.fn().mockResolvedValue(emptyStalled),
    };
    orderRecords = { markOmsAttention: jest.fn().mockResolvedValue(undefined) };
    connections = {
      get: jest.fn().mockResolvedValue({ status: 'active', enabledCapabilities: ['FulfillmentExecutor'] }),
    };
    cursors = {
      getCursor: jest.fn().mockResolvedValue(null),
      advanceCursor: jest.fn().mockResolvedValue(undefined),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }) };
    syncLock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    handler = new FulfillmentWorkTimeoutSweepHandler(
      timeouts as never,
      orderRecords as never,
      connections as never,
      cursors as never,
      jobEnqueue as never,
      syncLock as never,
      configService as never
    );
  });

  // #3476 — works routed to a holder and never offered to it.
  describe('the stalled-unsubmitted pass', () => {
    const stalledWork = {
      workId: 'ol_fwork_1',
      orderId: 'ol_order_1',
      assignedConnectionId: 'conn-oms',
    };

    it('should write the attention intents it reports', async () => {
      timeouts.findStalledUnsubmitted.mockResolvedValue({
        works: [stalledWork],
        nextAfterWorkId: null,
        attentionIntents: [
          { orderId: 'ol_order_1', outcome: { kind: 'blocked', reason: 'fulfillment-unaccepted' } },
        ],
      });

      await handler.execute(job());

      expect(orderRecords.markOmsAttention).toHaveBeenCalledWith('ol_order_1', 'acceptance', {
        kind: 'blocked',
        reason: 'fulfillment-unaccepted',
      });
    });

    it('should re-drive the dispatch under a generation key once the holder can execute', async () => {
      timeouts.findStalledUnsubmitted.mockResolvedValue({
        works: [stalledWork],
        nextAfterWorkId: null,
        attentionIntents: [],
      });

      await handler.execute(job());

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      const [request] = jobEnqueue.enqueueJob.mock.calls[0] as [
        {
          jobType: string;
          connectionId: string;
          payload: Record<string, unknown>;
          idempotencyKey: string;
        },
      ];
      expect(request.jobType).toBe('fulfillment.work.dispatch');
      expect(request.connectionId).toBe('conn-oms');
      expect(request.payload).toEqual({
        workId: 'ol_fwork_1',
        orderId: 'ol_order_1',
        expectedAssignmentAttempt: null,
      });
      // NOT the bare key, which the dead original job already holds.
      expect(request.idempotencyKey).toMatch(/^fulfillment:dispatch:ol_fwork_1:redrive:\d+$/);
    });

    it.each([
      ['FulfillmentExecutor is still not enabled', { status: 'active', enabledCapabilities: [] }],
      ['the connection is disabled', { status: 'disabled', enabledCapabilities: ['FulfillmentExecutor'] }],
    ])('should not re-drive when %s', async (_label, connection) => {
      connections.get.mockResolvedValue(connection);
      timeouts.findStalledUnsubmitted.mockResolvedValue({
        works: [stalledWork],
        nextAfterWorkId: null,
        attentionIntents: [],
      });

      await handler.execute(job());

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should not re-drive when the connection cannot be read', async () => {
      connections.get.mockRejectedValue(new Error('gone'));
      timeouts.findStalledUnsubmitted.mockResolvedValue({
        works: [stalledWork],
        nextAfterWorkId: null,
        attentionIntents: [],
      });

      await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should page from the stored cursor and persist the next one', async () => {
      cursors.getCursor.mockResolvedValue('ol_fwork_0');
      timeouts.findStalledUnsubmitted.mockResolvedValue({
        works: [stalledWork],
        nextAfterWorkId: 'ol_fwork_1',
        attentionIntents: [],
      });

      await handler.execute(job());

      expect(timeouts.findStalledUnsubmitted).toHaveBeenCalledWith(
        expect.objectContaining({ afterWorkId: 'ol_fwork_0' })
      );
      expect(cursors.advanceCursor).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000000',
        'fulfillment.unsubmitted.after',
        'ol_fwork_1'
      );
    });

    it('should wrap the cursor to the start on a short page', async () => {
      cursors.getCursor.mockResolvedValue('ol_fwork_9');

      await handler.execute(job());

      expect(cursors.advanceCursor).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000000',
        'fulfillment.unsubmitted.after',
        ''
      );
    });
  });

  it('should name its OWN lock, never the master sweep namespace', () => {
    // `sweepLockKey` renders `master:{kind}:sweep:{id}` — a false name for a
    // pass with no master.
    const key = fulfillmentTimeoutSweepLockKey('scope-1');
    expect(key).toBe('fulfillment:work:timeout-sweep:scope-1');
    expect(key.startsWith('master:')).toBe(false);
  });

  it('should skip without calling the service when the lock is held', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
    expect(timeouts.reapTimedOutDispatches).not.toHaveBeenCalled();
  });

  it('should resolve the timeout through the ONE path and hand it to the service', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'OL_FULFILLMENT_DISPATCH_TIMEOUT_MS' ? String(6 * 60 * 60 * 1000) : undefined
    );

    await handler.execute(job());

    expect(timeouts.reapTimedOutDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 6 * 60 * 60 * 1000 })
    );
  });

  it('should honour a payload page limit and clamp it', async () => {
    await handler.execute(job({ schemaVersion: 1, pageLimit: 50 }));
    expect(timeouts.reapTimedOutDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );

    timeouts.reapTimedOutDispatches.mockClear();
    await handler.execute(job({ schemaVersion: 1, pageLimit: 100_000 }));
    expect(timeouts.reapTimedOutDispatches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 })
    );
  });

  it('should tolerate an absent payload', async () => {
    await expect(handler.execute(job(null))).resolves.toEqual({ outcome: 'ok' });
  });

  it('should write every reported attention intent', async () => {
    timeouts.reapTimedOutDispatches.mockResolvedValue({
      ...emptyResult,
      reaped: 2,
      attentionIntents: [
        { orderId: 'ol_order_1', outcome: { kind: 'blocked', reason: 'fulfillment-unaccepted' } },
        { orderId: 'ol_order_2', outcome: { kind: 'none' } },
      ],
    });

    await handler.execute(job());

    expect(orderRecords.markOmsAttention).toHaveBeenCalledTimes(2);
    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith('ol_order_1', 'acceptance', {
      kind: 'blocked',
      reason: 'fulfillment-unaccepted',
    });
  });

  it('should NOT fail the job when an attention write fails', async () => {
    // The reap is already durable; a retry would reap nothing and therefore
    // never re-report the attention it was retried for.
    timeouts.reapTimedOutDispatches.mockResolvedValue({
      ...emptyResult,
      reaped: 1,
      attentionIntents: [{ orderId: 'ol_order_1', outcome: { kind: 'none' } }],
    });
    orderRecords.markOmsAttention.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
  });

  it('should keep writing the remaining intents after one fails', async () => {
    timeouts.reapTimedOutDispatches.mockResolvedValue({
      ...emptyResult,
      attentionIntents: [
        { orderId: 'ol_order_1', outcome: { kind: 'none' } },
        { orderId: 'ol_order_2', outcome: { kind: 'none' } },
      ],
    });
    orderRecords.markOmsAttention
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await handler.execute(job());

    expect(orderRecords.markOmsAttention).toHaveBeenCalledTimes(2);
  });

  it('should wrap a service failure as a retryable job failure', async () => {
    timeouts.reapTimedOutDispatches.mockRejectedValue(new Error('db down'));
    await expect(handler.execute(job())).rejects.toThrow(/fulfillment.work.timeoutSweep failed/);
  });

  it('should ALWAYS release the lock, including on the failure path', async () => {
    timeouts.reapTimedOutDispatches.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).rejects.toThrow();
    expect(syncLock.release).toHaveBeenCalledWith(
      'fulfillment:work:timeout-sweep:00000000-0000-0000-0000-000000000000',
      'token'
    );
  });

  it('should not fail the job when releasing the lock fails', async () => {
    syncLock.release.mockRejectedValue(new Error('redis down'));
    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
  });
});
