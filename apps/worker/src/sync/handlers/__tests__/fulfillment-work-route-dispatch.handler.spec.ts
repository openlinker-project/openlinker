/**
 * `FulfillmentWorkRouteHandler` — the dispatch-producer branch (#2955).
 *
 * Scoped deliberately to the enqueue this issue adds. The handler had no spec
 * at all before #2955; building the whole thing out is a separate concern, and
 * the branch that must not be dead code is this one.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { IRoutingCommitService, RoutingCommitOutcome } from '@openlinker/core/fulfillment';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { JobEnqueuePort, SyncJob, SyncLockPort } from '@openlinker/core/sync';

import { FulfillmentWorkRouteHandler } from '../fulfillment-work-route.handler';

type Enqueue = jest.Mocked<Pick<JobEnqueuePort, 'enqueueJob'>>;

describe('FulfillmentWorkRouteHandler — dispatching routed work (#2955)', () => {
  let handler: FulfillmentWorkRouteHandler;
  let jobEnqueue: Enqueue;

  let routingCommit: jest.Mocked<Pick<IRoutingCommitService, 'route'>>;
  let connections: jest.Mocked<Pick<ConnectionPort, 'list'>>;
  let routerResolver: { resolve: jest.Mock };

  /** Drive only the private producer — the surrounding `execute` chain is not this spec's subject. */
  const dispatch = async (outcome: RoutingCommitOutcome): Promise<void> => {
    await (
      handler as unknown as {
        enqueueRoutedDispatchJobs: (orderId: string, outcome: RoutingCommitOutcome) => Promise<void>;
      }
    ).enqueueRoutedDispatchJobs('ol_order_1', outcome);
  };

  beforeEach(() => {
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ id: 'x', isExisting: false }) };
    routingCommit = { route: jest.fn() };
    connections = { list: jest.fn().mockResolvedValue([]) };
    routerResolver = { resolve: jest.fn().mockResolvedValue(null) };

    handler = new FulfillmentWorkRouteHandler(
      routingCommit as unknown as IRoutingCommitService,
      connections as unknown as ConnectionPort,
      {} as IOrderRecordService,
      {} as SyncLockPort,
      routerResolver,
      jobEnqueue as unknown as JobEnqueuePort
    );
  });

  it('should enqueue one dispatch job per assigned work when the order is routed', async () => {
    await dispatch({
      status: 'routed',
      decisionId: 'dec-1',
      works: [
        { workId: 'w-1', assignedConnectionId: 'holder-1' },
        { workId: 'w-2', assignedConnectionId: 'holder-2' },
      ],
    });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    expect(jobEnqueue.enqueueJob).toHaveBeenNthCalledWith(1, {
      jobType: 'fulfillment.work.dispatch',
      // The work's OWN holder — never a synthetic id (#2609).
      connectionId: 'holder-1',
      payload: { workId: 'w-1', orderId: 'ol_order_1', expectedAssignmentAttempt: null },
      // Its own namespace, never the handshake's `work:{id}:{attempt}` (#2399).
      idempotencyKey: 'fulfillment:dispatch:w-1',
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ connectionId: 'holder-2', idempotencyKey: 'fulfillment:dispatch:w-2' })
    );
  });

  it('should skip the work when it carries no holder', async () => {
    await dispatch({
      status: 'routed',
      decisionId: 'dec-1',
      works: [{ workId: 'w-1', assignedConnectionId: null }],
    });

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not throw when the enqueue fails', async () => {
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis is down'));

    await expect(
      dispatch({
        status: 'routed',
        decisionId: 'dec-1',
        works: [{ workId: 'w-1', assignedConnectionId: 'holder-1' }],
      })
    ).resolves.toBeUndefined();
  });

  it('should still offer the remaining work when one enqueue fails', async () => {
    jobEnqueue.enqueueJob
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ id: 'x', isExisting: false } as never);

    await dispatch({
      status: 'routed',
      decisionId: 'dec-1',
      works: [
        { workId: 'w-1', assignedConnectionId: 'holder-1' },
        { workId: 'w-2', assignedConnectionId: 'holder-2' },
      ],
    });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it.each<RoutingCommitOutcome>([
    { status: 'contended' },
    { status: 'skipped', reason: 'already-routed' },
    { status: 'refused', decisionId: 'dec-1', reason: 'plan-carries-holds' },
    { status: 'in-doubt', decisionId: 'dec-1', cause: 'timeout' },
  ])('should enqueue nothing when the outcome is $status', async (outcome) => {
    await dispatch(outcome);

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  // Without this, deleting `await this.enqueueRoutedDispatchJobs(...)` from
  // `execute` leaves every case above green — the producer would be built,
  // tested and never called.
  it('should reach the producer from execute when routing commits work', async () => {
    connections.list.mockResolvedValue([
      {
        id: 'holder-1',
        status: 'active',
        enabledCapabilities: [],
        // A2 is `config-only`: this claim is what makes `holder-1` the router.
        config: { sourcingAuthority: { enabled: true } },
      },
    ] as never);
    routerResolver.resolve.mockResolvedValue({} as never);
    routingCommit.route.mockResolvedValue({
      status: 'routed',
      decisionId: 'dec-1',
      works: [{ workId: 'w-1', assignedConnectionId: 'holder-1' }],
    });
    // The order projection is not this spec's subject; only the call it feeds is.
    (
      handler as unknown as { projectOrder: () => Promise<unknown> }
    ).projectOrder = jest
      .fn()
      .mockResolvedValue({ lines: [], shipTo: {}, requestedDeliveryMethod: null });

    const result = await handler.execute({
      id: 'job-1',
      jobType: 'fulfillment.work.route',
      connectionId: 'conn-1',
      payload: { schemaVersion: 1, orderId: 'ol_order_1' },
    } as unknown as SyncJob);

    expect(result).toEqual({ outcome: 'ok' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'fulfillment.work.dispatch',
        idempotencyKey: 'fulfillment:dispatch:w-1',
        payload: { workId: 'w-1', orderId: 'ol_order_1', expectedAssignmentAttempt: null },
      })
    );
  });
});
