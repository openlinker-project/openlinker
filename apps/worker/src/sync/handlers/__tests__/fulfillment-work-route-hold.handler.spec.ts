/**
 * `FulfillmentWorkRouteHandler` — persisting the order's hold state (#3485).
 *
 * The reroute sweep re-drives this handler for orders held because routing
 * could not place them. After every attempt the handler writes the block and the
 * UF-L entry through `deriveRoutingHoldOutcome`, the same rule the ingestion
 * intercept uses. The order projection is stubbed: building a readable snapshot
 * is `orderFromReadySnapshot`'s concern, not this spec's.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { IRoutingCommitService, RoutingCommitOutcome } from '@openlinker/core/fulfillment';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { JobEnqueuePort, SyncJob, SyncLockPort } from '@openlinker/core/sync';

import { FulfillmentWorkRouteHandler } from '../fulfillment-work-route.handler';

const ORDER_ID = 'ol_order_1';

const projection = {
  lines: [{ orderLineId: 'l1', productVariantId: 'ol_variant_1', quantity: 1 }],
  shipTo: { kind: 'full' },
  requestedDeliveryMethod: null,
};

describe('FulfillmentWorkRouteHandler — persisting the hold state (#3485)', () => {
  let handler: FulfillmentWorkRouteHandler;
  let routingCommit: { route: jest.Mock };
  let orderRecords: { markFulfillmentBlock: jest.Mock; markOmsAttention: jest.Mock };
  let projectOrder: jest.SpyInstance;

  const job = {
    id: 'job-1',
    jobType: 'fulfillment.work.route',
    connectionId: 'conn-oms',
    payload: { schemaVersion: 1, orderId: ORDER_ID },
  } as unknown as SyncJob;

  const routeTo = (outcome: RoutingCommitOutcome): jest.Mock =>
    routingCommit.route.mockResolvedValue(outcome);

  beforeEach(() => {
    routingCommit = { route: jest.fn() };
    orderRecords = {
      markFulfillmentBlock: jest.fn().mockResolvedValue(undefined),
      markOmsAttention: jest.fn().mockResolvedValue(undefined),
    };

    handler = new FulfillmentWorkRouteHandler(
      routingCommit as unknown as IRoutingCommitService,
      {
        list: jest.fn().mockResolvedValue([
          {
            id: 'conn-oms',
            status: 'active',
            enabledCapabilities: [],
            config: { sourcingAuthority: { enabled: true } },
          },
        ]),
      } as unknown as ConnectionPort,
      orderRecords as unknown as IOrderRecordService,
      {} as SyncLockPort,
      { resolve: jest.fn().mockResolvedValue({ route: jest.fn() }) },
      {
        enqueueJob: jest.fn().mockResolvedValue({ id: 'x', isExisting: false }),
      } as unknown as JobEnqueuePort
    );

    projectOrder = jest
      .spyOn(handler as unknown as { projectOrder: () => Promise<unknown> }, 'projectOrder')
      .mockResolvedValue(projection);
  });

  // The re-route the sweep exists for: stock arrived, the order routes, and the
  // hold and the UF-L entry are cleared.
  it('should clear the block and the line attention when the re-route succeeds', async () => {
    routeTo({
      status: 'routed',
      decisionId: 'dec-2',
      works: [{ workId: 'w-1', assignedConnectionId: 'conn-oms' }],
    });

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });

    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith(ORDER_ID, null);
    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(ORDER_ID, 'routing', {
      kind: 'none',
    });
  });

  it('should keep the order held when it is refused again, still out of stock', async () => {
    routeTo({ status: 'refused', decisionId: 'dec-3', reason: 'plan-carries-unfulfillable' });

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'business_failure' });

    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith(ORDER_ID, {
      reason: 'routing-refused',
      detail: 'plan-carries-unfulfillable',
    });
    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(ORDER_ID, 'routing', {
      kind: 'blocked',
      reason: 'line-unfulfillable',
    });
  });

  it('should hold an order with no shipping address instead of retrying it', async () => {
    projectOrder.mockResolvedValue(null);

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });

    expect(routingCommit.route).not.toHaveBeenCalled();
    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith(ORDER_ID, {
      reason: 'routing-no-shipping-address',
      detail: null,
    });
  });

  // In doubt: the block records it, and the lines are left alone because the
  // plan is not known yet. The job still throws so the retry resumes the decision.
  it('should record in-doubt without touching the line attention', async () => {
    routeTo({ status: 'in-doubt', decisionId: 'dec-4', cause: 'timeout' });

    await expect(handler.execute(job)).rejects.toThrow('in doubt');

    expect(orderRecords.markFulfillmentBlock).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ reason: 'routing-in-doubt' })
    );
    expect(orderRecords.markOmsAttention).not.toHaveBeenCalled();
  });

  // The routing outcome is already durable; a lost write must not fail the job.
  it('should not change the job outcome when persisting the hold state throws', async () => {
    routeTo({
      status: 'routed',
      decisionId: 'dec-5',
      works: [{ workId: 'w-1', assignedConnectionId: 'conn-oms' }],
    });
    orderRecords.markFulfillmentBlock.mockRejectedValue(new Error('order_records unreachable'));
    orderRecords.markOmsAttention.mockRejectedValue(new Error('order_records unreachable'));

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });
  });
});
