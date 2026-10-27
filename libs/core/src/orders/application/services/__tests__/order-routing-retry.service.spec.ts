/**
 * OrderRoutingRetryService tests (#3558)
 *
 * The cases are the ones the issue names (an operator retry, a stock change that
 * re-drives routing) plus the ones that keep it safe: a fresh key per click, a
 * per-hour key for the stock trigger, and "never throws" for the trigger that
 * runs inside the inventory propagation path.
 */
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import {
  OrderRoutingRetryService,
  STOCK_REROUTE_PAGE_LIMIT,
  buildRetryRerouteJobKey,
  buildStockRerouteJobKey,
} from '../order-routing-retry.service';

const ROUTER = 'router-connection';

/** A connection that claims A2 (`sourcingAuthority`), which is what selects it as the router. */
const routerConnection = (id: string = ROUTER): Connection =>
  ({
    id,
    status: 'active',
    enabledCapabilities: [],
    config: { sourcingAuthority: { enabled: true } },
  }) as unknown as Connection;

const plainConnection = (id: string): Connection =>
  ({ id, status: 'active', enabledCapabilities: [], config: {} }) as unknown as Connection;

const heldOrder = (reason: string): OrderRecord =>
  ({ fulfillmentBlock: { reason, detail: null } }) as unknown as OrderRecord;

describe('OrderRoutingRetryService', () => {
  let orderRecords: { getOrderRecord: jest.Mock; listOrderIdsHeldForVariant: jest.Mock };
  let connections: { list: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let service: OrderRoutingRetryService;

  beforeEach(() => {
    orderRecords = { getOrderRecord: jest.fn(), listOrderIdsHeldForVariant: jest.fn() };
    connections = { list: jest.fn().mockResolvedValue([routerConnection()]) };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };
    service = new OrderRoutingRetryService(
      orderRecords as unknown as IOrderRecordService,
      connections as unknown as ConnectionPort,
      jobEnqueue as unknown as JobEnqueuePort
    );
  });

  describe('retryRouting', () => {
    it.each(['routing-refused', 'routing-failed'])(
      'should enqueue a route job under the router connection for an order held as %s',
      async (reason) => {
        orderRecords.getOrderRecord.mockResolvedValue(heldOrder(reason));

        const result = await service.retryRouting('ol_order_1');

        expect(result).toEqual({ status: 'enqueued', jobId: 'job-1' });
        expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobType: 'fulfillment.work.route',
            connectionId: ROUTER,
            payload: { schemaVersion: 1, orderId: 'ol_order_1' },
          })
        );
      }
    );

    it('should mint a fresh idempotency key for every click', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(heldOrder('routing-refused'));
      jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);

      await service.retryRouting('ol_order_1');
      await service.retryRouting('ol_order_1');

      const keys = jobEnqueue.enqueueJob.mock.calls.map(
        (call: unknown[]) => (call[0] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys).toEqual([
        buildRetryRerouteJobKey('ol_order_1', 1000),
        buildRetryRerouteJobKey('ol_order_1', 2000),
      ]);
      expect(keys[0]).not.toBe(keys[1]);
      jest.restoreAllMocks();
    });

    it('should report an unknown order', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(null);

      expect(await service.retryRouting('ol_order_1')).toEqual({ status: 'order-not-found' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should refuse an order that is not held', async () => {
      orderRecords.getOrderRecord.mockResolvedValue({ fulfillmentBlock: null } as unknown as OrderRecord);

      expect(await service.retryRouting('ol_order_1')).toEqual({
        status: 'refused',
        reason: 'not-held',
      });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it.each(['routing-no-shipping-address', 'routing-in-doubt', 'routing-contended'])(
      'should refuse an order held as %s, which a retry cannot change',
      async (reason) => {
        orderRecords.getOrderRecord.mockResolvedValue(heldOrder(reason));

        expect(await service.retryRouting('ol_order_1')).toEqual({
          status: 'refused',
          reason: 'not-retryable',
        });
        expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      }
    );

    it('should refuse when no single router is selected', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(heldOrder('routing-refused'));
      connections.list.mockResolvedValue([plainConnection('a')]);

      expect(await service.retryRouting('ol_order_1')).toEqual({
        status: 'refused',
        reason: 'no-router',
      });
    });

    it('should report a failed enqueue as a code, not the error message', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(heldOrder('routing-refused'));
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis://user:secret@host down'));

      const result = await service.retryRouting('ol_order_1');

      expect(result).toEqual({ status: 'enqueue-failed' });
      expect(JSON.stringify(result)).not.toContain('secret');
    });
  });

  describe('rerouteHeldOrdersForVariant', () => {
    it('should enqueue one route job per held order, keyed to the UTC hour', async () => {
      orderRecords.listOrderIdsHeldForVariant.mockResolvedValue(['ol_order_1', 'ol_order_2']);

      const result = await service.rerouteHeldOrdersForVariant({ variantId: 'variant-1' });

      expect(result).toEqual({ candidates: 2, enqueued: 2 });
      expect(orderRecords.listOrderIdsHeldForVariant).toHaveBeenCalledWith(
        ['routing-refused', 'routing-failed'],
        'variant-1',
        STOCK_REROUTE_PAGE_LIMIT
      );
      const keys = jobEnqueue.enqueueJob.mock.calls.map(
        (call: unknown[]) => (call[0] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys[0]).toMatch(/^fulfillment:work:route:stock:ol_order_1:\d{4}-\d{2}-\d{2}T\d{2}$/);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobType: 'fulfillment.work.route', connectionId: ROUTER })
      );
    });

    it('should use the same key for the same order within one hour', () => {
      const a = buildStockRerouteJobKey('ol_order_1', new Date('2026-10-27T10:05:00Z'));
      const b = buildStockRerouteJobKey('ol_order_1', new Date('2026-10-27T10:55:00Z'));
      const next = buildStockRerouteJobKey('ol_order_1', new Date('2026-10-27T11:00:00Z'));

      expect(a).toBe(b);
      expect(next).not.toBe(a);
    });

    it('should do nothing when no held order waits on the variant', async () => {
      orderRecords.listOrderIdsHeldForVariant.mockResolvedValue([]);

      expect(await service.rerouteHeldOrdersForVariant({ variantId: 'variant-1' })).toEqual({
        candidates: 0,
        enqueued: 0,
      });
      expect(connections.list).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should leave held orders held when no router is selected', async () => {
      orderRecords.listOrderIdsHeldForVariant.mockResolvedValue(['ol_order_1']);
      connections.list.mockResolvedValue([]);

      expect(await service.rerouteHeldOrdersForVariant({ variantId: 'variant-1' })).toEqual({
        candidates: 1,
        enqueued: 0,
      });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should keep going when one enqueue fails', async () => {
      orderRecords.listOrderIdsHeldForVariant.mockResolvedValue(['ol_order_1', 'ol_order_2']);
      jobEnqueue.enqueueJob
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ jobId: 'job-2', isExisting: false });

      expect(await service.rerouteHeldOrdersForVariant({ variantId: 'variant-1' })).toEqual({
        candidates: 2,
        enqueued: 1,
      });
    });

    it('should never throw, even when the read fails', async () => {
      orderRecords.listOrderIdsHeldForVariant.mockRejectedValue(new Error('db down'));

      await expect(
        service.rerouteHeldOrdersForVariant({ variantId: 'variant-1' })
      ).resolves.toEqual({ candidates: 0, enqueued: 0 });
    });
  });
});
