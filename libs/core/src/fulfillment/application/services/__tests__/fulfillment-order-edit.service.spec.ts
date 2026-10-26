/**
 * Fulfillment Order Edit Service Tests (#3542, D-C)
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import { FulfillmentOrderEditService } from '../fulfillment-order-edit.service';

interface LineSeed {
  orderLineId: string;
  total: number;
  fulfilled?: number;
  cancelled?: number;
}

function work(id: string, lines: LineSeed[], overrides: Record<string, unknown> = {}): unknown {
  return {
    id,
    orderId: 'o1',
    status: 'open',
    requestStatus: 'unsubmitted',
    assignedConnectionId: 'holder',
    parcelClosedAt: null,
    lines: lines.map((line) => ({
      id: `${id}-${line.orderLineId}`,
      orderLineId: line.orderLineId,
      productVariantId: 'v1',
      totalQuantity: line.total,
      fulfilledQuantity: line.fulfilled ?? 0,
      cancelledQuantity: line.cancelled ?? 0,
    })),
    ...overrides,
  };
}

describe('FulfillmentOrderEditService (#3542)', () => {
  let works: jest.Mocked<Pick<FulfillmentWorkRepositoryPort, 'findByOrderId' | 'recordLineProgress'>>;
  let service: FulfillmentOrderEditService;

  beforeEach(() => {
    works = { findByOrderId: jest.fn(), recordLineProgress: jest.fn().mockResolvedValue(true) };
    service = new FulfillmentOrderEditService(works as unknown as FulfillmentWorkRepositoryPort);
  });

  describe('lowerLineQuantity', () => {
    it('should cancel the difference on the work line and never touch totalQuantity', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 5 }])] as never);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 2 });

      expect(works.recordLineProgress).toHaveBeenCalledTimes(1);
      expect(works.recordLineProgress).toHaveBeenCalledWith({
        workId: 'w1',
        orderLineId: 'l1',
        fulfilledDelta: 0,
        cancelledDelta: 3,
      });
      expect(result).toEqual({ outcome: 'applied', cancelledUnits: 3, workIds: ['w1'] });
    });

    it('should produce no relay or re-route intent: the result carries only counters and ids', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 2 }])] as never);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(Object.keys(result).sort()).toEqual(['cancelledUnits', 'outcome', 'workIds']);
    });

    it('should be a no-op when replayed: computed from current counters, not from a delta', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 5, cancelled: 3 }]),
      ] as never);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 2 });

      expect(works.recordLineProgress).not.toHaveBeenCalled();
      expect(result.outcome).toBe('unchanged');
    });

    it('should narrow the work where most of the line sits and spill into the next only when it must', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 2 }]),
        work('w2', [{ orderLineId: 'l1', total: 4 }]),
      ] as never);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      // 6 required, 1 kept: 5 to cut. w2 gives 4, w1 gives the last 1.
      expect(works.recordLineProgress).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ workId: 'w2', cancelledDelta: 4 })
      );
      expect(works.recordLineProgress).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ workId: 'w1', cancelledDelta: 1 })
      );
      expect(result.cancelledUnits).toBe(5);
    });

    it('should refuse to go below what is already fulfilled', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 5, fulfilled: 3 }]),
      ] as never);

      await expect(
        service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 2 })
      ).rejects.toThrow(RangeError);
      expect(works.recordLineProgress).not.toHaveBeenCalled();
    });

    it('should report an unrouted order without writing', async () => {
      works.findByOrderId.mockResolvedValue([]);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(result.outcome).toBe('unrouted');
    });

    it('should ignore a work that has already come to rest', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 5 }], { status: 'cancelled' }),
      ] as never);

      expect((await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 })).outcome).toBe(
        'unrouted'
      );
    });
  });

  describe('assessForEdit', () => {
    it('should report a closed parcel, work underway and units already fulfilled per line', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 3, fulfilled: 2 }], {
          parcelClosedAt: new Date(),
          status: 'in_progress',
          requestStatus: 'accepted',
        }),
      ] as never);

      const assessment = await service.assessForEdit('o1');

      expect(assessment.anyParcelClosed).toBe(true);
      expect(assessment.underway).toBe(true);
      expect(assessment.fulfilledByLine).toEqual({ l1: 2 });
      expect(assessment.handedOff).toHaveLength(1);
      expect(assessment.unrouted).toBe(false);
    });

    it('should call an order with no work unrouted', async () => {
      works.findByOrderId.mockResolvedValue([]);

      expect((await service.assessForEdit('o1')).unrouted).toBe(true);
    });
  });
});
