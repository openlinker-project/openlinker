/**
 * `FulfillmentWorkRouteHandler` — the sale-decrement producer branch (#3453).
 *
 * Drives only the private producer, like its dispatch sibling spec: the
 * surrounding `execute` chain is not this spec's subject.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { IRoutingCommitService, RoutingCommitOutcome } from '@openlinker/core/fulfillment';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { JobEnqueuePort, SyncLockPort } from '@openlinker/core/sync';

import { FulfillmentWorkRouteHandler } from '../fulfillment-work-route.handler';

describe('FulfillmentWorkRouteHandler — lowering product-master stock (#3453)', () => {
  let handler: FulfillmentWorkRouteHandler;
  let jobEnqueue: jest.Mocked<Pick<JobEnqueuePort, 'enqueueJob'>>;
  let orderRecords: { getOrderRecord: jest.Mock };

  const enqueueSaleDecrements = async (outcome: RoutingCommitOutcome): Promise<void> => {
    await (
      handler as unknown as {
        enqueueRoutedSaleDecrementJobs: (
          orderId: string,
          outcome: RoutingCommitOutcome
        ) => Promise<void>;
      }
    ).enqueueRoutedSaleDecrementJobs('ol_order_1', outcome);
  };

  const routed: RoutingCommitOutcome = {
    status: 'routed',
    decisionId: 'dec-1',
    works: [
      { workId: 'w-1', assignedConnectionId: 'holder-oms' },
      { workId: 'w-2', assignedConnectionId: null },
    ],
  };

  beforeEach(() => {
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ id: 'x', isExisting: false }) };
    orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue({ sourceConnectionId: 'conn-allegro' }),
    };

    handler = new FulfillmentWorkRouteHandler(
      { route: jest.fn() } as unknown as IRoutingCommitService,
      { list: jest.fn() } as unknown as ConnectionPort,
      orderRecords as unknown as IOrderRecordService,
      {} as SyncLockPort,
      { resolve: jest.fn() },
      jobEnqueue as unknown as JobEnqueuePort
    );
  });

  it('should enqueue one sale decrement per routed work, scoped to the order source', async () => {
    await enqueueSaleDecrements(routed);

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    expect(jobEnqueue.enqueueJob).toHaveBeenNthCalledWith(1, {
      jobType: 'inventory.saleDecrement',
      // The ORDER's source — not the router's `job.connectionId`, not the holder.
      connectionId: 'conn-allegro',
      payload: { schemaVersion: 1, workId: 'w-1', orderId: 'ol_order_1' },
      idempotencyKey: 'inventory:sale-decrement:w-1',
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: 'inventory:sale-decrement:w-2' })
    );
  });

  it('should enqueue nothing when the order was not routed', async () => {
    await enqueueSaleDecrements({ status: 'contended' });

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(orderRecords.getOrderRecord).not.toHaveBeenCalled();
  });

  it('should enqueue nothing and not throw when the order record cannot be read', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(null);

    await expect(enqueueSaleDecrements(routed)).resolves.toBeUndefined();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should keep enqueueing the remaining works when one enqueue fails', async () => {
    jobEnqueue.enqueueJob
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ id: 'x', isExisting: false } as never);

    await expect(enqueueSaleDecrements(routed)).resolves.toBeUndefined();
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
  });
});
