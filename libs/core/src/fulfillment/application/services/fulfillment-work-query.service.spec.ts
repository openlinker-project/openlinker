/**
 * `FulfillmentWorkQueryService` (#2402)
 *
 * The three outcomes are asserted separately because collapsing any two of them
 * is the defect this service exists to prevent: `ambiguous` reported as `none`
 * would leave a shipment silently unlinked, and `ambiguous` resolved to a
 * guessed work would attribute a parcel to something that may not have shipped it.
 */
import type { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentWork } from '../../domain/types/fulfillment-work.types';
import { FulfillmentWorkQueryService } from './fulfillment-work-query.service';

function makeWork(id: string, orderId = 'ol_order_1'): FulfillmentWork {
  return { id, orderId } as FulfillmentWork;
}

describe('FulfillmentWorkQueryService', () => {
  let works: jest.Mocked<Pick<
      FulfillmentWorkRepositoryPort,
      'findByOrderId' | 'findById' | 'findProgressByOrderIds'
    >
  >;
  let service: FulfillmentWorkQueryService;

  beforeEach(() => {
    works = {
      findByOrderId: jest.fn(),
      findById: jest.fn(),
      findProgressByOrderIds: jest.fn(),
    };
    service = new FulfillmentWorkQueryService(works as unknown as FulfillmentWorkRepositoryPort);
  });

  describe('findWorkById (#3453)', () => {
    it('should return the work when it exists', async () => {
      const work = makeWork('ol_fulfillmentwork_1');
      works.findById.mockResolvedValue(work);

      await expect(service.findWorkById('ol_fulfillmentwork_1')).resolves.toBe(work);
      expect(works.findById).toHaveBeenCalledWith('ol_fulfillmentwork_1');
    });

    it('should return null when no such work exists', async () => {
      works.findById.mockResolvedValue(null);

      await expect(service.findWorkById('ol_fulfillmentwork_missing')).resolves.toBeNull();
    });
  });

  describe('summarizeWorkForOrders (#3482)', () => {
    it('should read the whole page in one batched call', async () => {
      works.findProgressByOrderIds.mockResolvedValue([]);

      await service.summarizeWorkForOrders(['ol_order_1', 'ol_order_2']);

      expect(works.findProgressByOrderIds).toHaveBeenCalledTimes(1);
      expect(works.findProgressByOrderIds).toHaveBeenCalledWith(['ol_order_1', 'ol_order_2']);
      expect(works.findByOrderId).not.toHaveBeenCalled();
    });

    it('should omit an order that has no live work', async () => {
      works.findProgressByOrderIds.mockResolvedValue([
        { orderId: 'ol_order_1', status: 'cancelled', parcelClosedAt: null },
      ]);

      const summaries = await service.summarizeWorkForOrders(['ol_order_1', 'ol_order_2']);

      expect(summaries.size).toBe(0);
    });

    it('should report the earliest stage for a split order and one entry per order', async () => {
      works.findProgressByOrderIds.mockResolvedValue([
        { orderId: 'ol_order_1', status: 'closed', parcelClosedAt: null },
        { orderId: 'ol_order_1', status: 'open', parcelClosedAt: null },
        { orderId: 'ol_order_2', status: 'in_progress', parcelClosedAt: null },
      ]);

      const summaries = await service.summarizeWorkForOrders(['ol_order_1', 'ol_order_2']);

      expect(summaries.get('ol_order_1')).toEqual({ stage: 'to-pack', workCount: 2 });
      expect(summaries.get('ol_order_2')).toEqual({ stage: 'packing', workCount: 1 });
    });

    it('should report packed for a bench-closed parcel whose status was never moved', async () => {
      // The real shape the pack bench leaves behind: `status` stays `open`.
      works.findProgressByOrderIds.mockResolvedValue([
        { orderId: 'ol_order_1', status: 'open', parcelClosedAt: new Date('2026-10-23T12:48:12Z') },
      ]);

      const summaries = await service.summarizeWorkForOrders(['ol_order_1']);

      expect(summaries.get('ol_order_1')).toEqual({ stage: 'packed', workCount: 1 });
    });
  });

  describe('resolveLinkForOrder', () => {
    it('should report none when the order was never routed', async () => {
      works.findByOrderId.mockResolvedValue([]);

      await expect(service.resolveLinkForOrder('ol_order_1')).resolves.toEqual({ kind: 'none' });
    });

    it('should report the work id when exactly one work covers the order', async () => {
      works.findByOrderId.mockResolvedValue([makeWork('ol_fulfillmentwork_1')]);

      await expect(service.resolveLinkForOrder('ol_order_1')).resolves.toEqual({
        kind: 'unique',
        workId: 'ol_fulfillmentwork_1',
      });
    });

    it('should report ambiguous — never a guessed work — when a split order has several works', async () => {
      works.findByOrderId.mockResolvedValue([
        makeWork('ol_fulfillmentwork_1'),
        makeWork('ol_fulfillmentwork_2'),
      ]);

      const result = await service.resolveLinkForOrder('ol_order_1');

      // Asserted as the whole object: a `kind === 'ambiguous'` check alone would
      // still pass if the service had ALSO picked one, which is the failure this
      // outcome exists to make impossible.
      expect(result).toEqual({
        kind: 'ambiguous',
        workIds: ['ol_fulfillmentwork_1', 'ol_fulfillmentwork_2'],
      });
    });

    it('should query by order alone — never by connection (the executor/source axis mismatch)', async () => {
      works.findByOrderId.mockResolvedValue([]);

      await service.resolveLinkForOrder('ol_order_1');

      // `findByOrderId` takes exactly one argument. A connection-filtered lookup
      // would silently match nothing on a routed `ol_managed_carrier` topology,
      // where the caller's source connection and the work's `assignedConnectionId`
      // are different connections.
      expect(works.findByOrderId).toHaveBeenCalledWith('ol_order_1');
      expect(works.findByOrderId).toHaveBeenCalledTimes(1);
    });
  });
});
