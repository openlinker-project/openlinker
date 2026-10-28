/**
 * FulfillmentRoutingReapSweepHandler — unit spec (#2731)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type {
  ReapStrandedDecisionsResult,
  RoutingDecisionReapIntent,
} from '@openlinker/core/fulfillment';
import type { SyncJob } from '@openlinker/core/sync';

import {
  buildReapRouteJobKey,
  FulfillmentRoutingReapSweepHandler,
  fulfillmentRoutingReapSweepLockKey,
} from '../fulfillment-routing-reap-sweep.handler';

const SYSTEM_SCOPE = '00000000-0000-0000-0000-000000000000';
const ROUTER_HOLDER = 'conn-oms';

/** One active connection claiming routing — the shape `selectPrimaryFulfillmentRouter` elects. */
const routingClaimant = {
  id: ROUTER_HOLDER,
  status: 'active',
  enabledCapabilities: [],
  config: { sourcingAuthority: { enabled: true } },
};

const intent: RoutingDecisionReapIntent = {
  orderId: 'ol_order_1',
  decisionId: 'ol_routingdecision_1',
  routerConnectionId: 'conn-router',
  attention: {
    kind: 'blocked',
    reason: 'routing-stuck',
    detail: 'Routing got no answer within 60 minutes; it will be retried',
  },
  fallbackBlock: { reason: 'routing-failed', detail: 'stranded-past-ttl' },
};

function result(intents: readonly RoutingDecisionReapIntent[] = []): ReapStrandedDecisionsResult {
  return {
    examined: intents.length,
    reaped: intents.length,
    raced: 0,
    busy: 0,
    failed: 0,
    ttlMs: 3_600_000,
    intents,
  };
}

describe('FulfillmentRoutingReapSweepHandler (#2731)', () => {
  let reaper: { reapStranded: jest.Mock; getStatusForOrder: jest.Mock };
  let orderRecords: { markOmsAttention: jest.Mock; markFulfillmentBlock: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let connections: { list: jest.Mock };
  let routerResolver: { resolve: jest.Mock };
  let configService: { get: jest.Mock };
  let handler: FulfillmentRoutingReapSweepHandler;

  const job = (payload: Record<string, unknown> | null = { schemaVersion: 1 }): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.routing.reapSweep' as unknown as SyncJob['jobType'],
      connectionId: SYSTEM_SCOPE,
      payload,
    }) as unknown as SyncJob;

  beforeEach(() => {
    reaper = {
      reapStranded: jest.fn().mockResolvedValue(result()),
      getStatusForOrder: jest.fn(),
    };
    orderRecords = {
      markOmsAttention: jest.fn().mockResolvedValue(undefined),
      markFulfillmentBlock: jest.fn().mockResolvedValue(undefined),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }) };
    syncLock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn() };
    connections = { list: jest.fn().mockResolvedValue([routingClaimant]) };
    routerResolver = { resolve: jest.fn().mockResolvedValue({ route: jest.fn() }) };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    handler = new FulfillmentRoutingReapSweepHandler(
      reaper as never,
      orderRecords as never,
      jobEnqueue as never,
      syncLock as never,
      connections as never,
      routerResolver as never,
      configService as never
    );
  });

  it('should skip the run and touch nothing when the lock is held', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(syncLock.acquire).toHaveBeenCalledWith(
      fulfillmentRoutingReapSweepLockKey(SYSTEM_SCOPE),
      expect.any(Number)
    );
    expect(reaper.reapStranded).not.toHaveBeenCalled();
  });

  it('should hand the reaper the same lock the route job takes', async () => {
    await handler.execute(job());

    // The reaper reaps only while holding the order's routing lock, so a reap
    // can never overlap a resumed route() call.
    expect(reaper.reapStranded).toHaveBeenCalledWith(expect.objectContaining({ lock: syncLock }));
  });

  it('should not resolve a router when nothing was reaped', async () => {
    await handler.execute(job());

    expect(connections.list).not.toHaveBeenCalled();
    expect(routerResolver.resolve).not.toHaveBeenCalled();
  });

  it('should pass the default one-hour TTL when the env var is unset', async () => {
    await handler.execute(job());

    expect(reaper.reapStranded).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: 3_600_000, limit: 50 })
    );
  });

  it('should resolve the TTL from OL_ROUTING_DECISION_TTL_MS through the clamping rule', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'OL_ROUTING_DECISION_TTL_MS' ? '60000' : undefined
    );

    await handler.execute(job());

    // 1 minute is below the 15-minute floor, so it is clamped up.
    expect(reaper.reapStranded).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: 15 * 60 * 1000 })
    );
  });

  it('should record routing-stuck under the routing producer for each reaped order', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));

    await handler.execute(job());

    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(
      'ol_order_1',
      'routing',
      intent.attention
    );
  });

  it('should re-route the order under the connection the route job will select and a per-decision key', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));

    await handler.execute(job());

    expect(routerResolver.resolve).toHaveBeenCalledWith(ROUTER_HOLDER);
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'fulfillment.work.route',
      connectionId: ROUTER_HOLDER,
      payload: { schemaVersion: 1, orderId: 'ol_order_1' },
      idempotencyKey: buildReapRouteJobKey('ol_routingdecision_1'),
    });
  });

  it('should not write a block when the re-route was enqueued', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));

    await handler.execute(job());

    // The route job writes the order's real hold state itself; a block written
    // here would race it.
    expect(orderRecords.markFulfillmentBlock).not.toHaveBeenCalled();
  });

  it('should fall back to the routing-failed block when the re-route cannot be enqueued', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis down'));

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith('ol_order_1', {
      reason: 'routing-failed',
      detail: 'stranded-past-ttl',
    });
  });

  it('should write the routing-failed block instead of enqueueing when no connection claims routing', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));
    connections.list.mockResolvedValue([]);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    // The route job would return without writing anything, leaving a
    // routing-in-doubt block for a decision that no longer exists.
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith('ol_order_1', {
      reason: 'routing-failed',
      detail: 'stranded-past-ttl',
    });
    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(
      'ol_order_1',
      'routing',
      intent.attention
    );
  });

  it('should write the routing-failed block instead of enqueueing when no router resolves', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));
    routerResolver.resolve.mockResolvedValue(null);

    await handler.execute(job());

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith('ol_order_1', {
      reason: 'routing-failed',
      detail: 'stranded-past-ttl',
    });
  });

  it('should write the routing-failed block when resolving the router throws', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));
    routerResolver.resolve.mockRejectedValue(new Error('registry down'));

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledTimes(1);
  });

  it('should resolve the router once per run, not once per reaped order', async () => {
    reaper.reapStranded.mockResolvedValue(
      result([intent, { ...intent, orderId: 'ol_order_2', decisionId: 'ol_routingdecision_2' }])
    );

    await handler.execute(job());

    expect(routerResolver.resolve).toHaveBeenCalledTimes(1);
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('should still re-route when the attention write fails', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));
    orderRecords.markOmsAttention.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it('should not fail the job when both the re-route and the fallback block fail', async () => {
    reaper.reapStranded.mockResolvedValue(result([intent]));
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis down'));
    orderRecords.markFulfillmentBlock.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
  });

  it('should fail the job retryably when the frontier read fails, and release the lock', async () => {
    reaper.reapStranded.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).rejects.toThrow(/fulfillment.routing.reapSweep failed/);
    expect(syncLock.release).toHaveBeenCalledWith(
      fulfillmentRoutingReapSweepLockKey(SYSTEM_SCOPE),
      'token'
    );
  });

  it('should honour a pageLimit carried on the payload', async () => {
    await handler.execute(job({ schemaVersion: 1, pageLimit: 10 }));

    expect(reaper.reapStranded).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });
});
