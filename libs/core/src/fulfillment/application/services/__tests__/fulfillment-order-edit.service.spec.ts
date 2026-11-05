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
  let works: jest.Mocked<
    Pick<
      FulfillmentWorkRepositoryPort,
      | 'findByOrderId'
      | 'recordLineProgress'
      | 'countParcelVerifications'
      | 'listActiveHoldsForWorks'
      | 'placeHold'
      | 'releaseHold'
      | 'runInTransaction'
      | 'lockWorkForVerification'
      | 'findLatestActiveVerification'
      | 'claimParcelClose'
    >
  >;
  let service: FulfillmentOrderEditService;

  beforeEach(() => {
    works = {
      findByOrderId: jest.fn(),
      recordLineProgress: jest.fn().mockResolvedValue(true),
      countParcelVerifications: jest.fn().mockResolvedValue([]),
      listActiveHoldsForWorks: jest.fn().mockResolvedValue(new Map()),
      placeHold: jest.fn().mockResolvedValue({}),
      releaseHold: jest.fn().mockResolvedValue({}),
      runInTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn('tx')) as never,
      lockWorkForVerification: jest.fn().mockResolvedValue(null),
      findLatestActiveVerification: jest.fn().mockResolvedValue(null),
      claimParcelClose: jest.fn().mockResolvedValue(true),
    };
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

  describe('lowerLineQuantity - closing a box the change left full (#3961)', () => {
    const narrowed = (): unknown =>
      work('w1', [{ orderLineId: 'l1', total: 3, cancelled: 2 }]);

    beforeEach(() => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 3 }])] as never);
      works.lockWorkForVerification.mockResolvedValue(narrowed() as never);
      works.findLatestActiveVerification.mockResolvedValue({
        id: 'v1',
        workLineId: 'w1-l1',
        verifiedByUserId: 'packer-1',
      });
    });

    it('should close the box as its last scanner when it already holds the new quantity', async () => {
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 1 }]);

      await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(works.claimParcelClose).toHaveBeenCalledWith(
        expect.objectContaining({ workId: 'w1', packedByUserId: 'packer-1' }),
        'tx'
      );
    });

    it('should leave the box open when it still holds fewer units than the new quantity', async () => {
      works.countParcelVerifications.mockResolvedValue([]);

      await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(works.claimParcelClose).not.toHaveBeenCalled();
    });

    it('should not close a box nobody scanned anything into', async () => {
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 1 }]);
      works.findLatestActiveVerification.mockResolvedValue(null);

      await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(works.claimParcelClose).not.toHaveBeenCalled();
    });

    it('should still report the lowered quantity when closing the box fails', async () => {
      works.lockWorkForVerification.mockRejectedValue(new Error('db down'));

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(result).toEqual({ outcome: 'applied', cancelledUnits: 2, workIds: ['w1'] });
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

  describe('assessForEdit - source change facts (#3961)', () => {
    it('should sum required units per line across non-terminal works, net of cancelled', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 3, cancelled: 1 }]),
        work('w2', [{ orderLineId: 'l1', total: 2 }]),
        work('w3', [{ orderLineId: 'l1', total: 9 }], { status: 'cancelled' }),
      ] as never);

      const assessment = await service.assessForEdit('o1');

      expect(assessment.requiredByLine).toEqual({ l1: 4 });
    });

    it('should map verified units from work lines back to order lines', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [
          { orderLineId: 'l1', total: 2 },
          { orderLineId: 'l2', total: 1 },
        ]),
      ] as never);
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 2 }]);

      const assessment = await service.assessForEdit('o1');

      expect(assessment.verifiedByLine).toEqual({ l1: 2 });
    });
  });

  describe('holdForSourceChange (#3961)', () => {
    it('should hold every non-terminal work as the source-change actor', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 2 }]),
        work('w2', [{ orderLineId: 'l1', total: 1 }], { status: 'closed' }),
      ] as never);

      const result = await service.holdForSourceChange({ orderId: 'o1', note: 'changed' });

      expect(result).toEqual({ heldWorkIds: ['w1'] });
      expect(works.placeHold).toHaveBeenCalledWith(
        expect.objectContaining({
          workId: 'w1',
          reason: 'awaiting-amendment',
          note: 'changed',
          placedByUserId: null,
          placedByService: 'source-amendment',
        })
      );
    });

    it('should not hold a work twice when it already carries the source-change hold', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 2 }])] as never);
      works.listActiveHoldsForWorks.mockResolvedValue(
        new Map([['w1', [{ id: 'h1', fulfillmentWorkId: 'w1', placedByService: 'source-amendment' }]]]) as never
      );

      const result = await service.holdForSourceChange({ orderId: 'o1', note: 'changed' });

      expect(result).toEqual({ heldWorkIds: [] });
      expect(works.placeHold).not.toHaveBeenCalled();
    });
  });

  describe('releaseSourceChangeHolds (#3961)', () => {
    it("should release only its own holds and leave an operator's hold in place", async () => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 2 }])] as never);
      works.listActiveHoldsForWorks.mockResolvedValue(
        new Map([
          [
            'w1',
            [
              { id: 'h-own', fulfillmentWorkId: 'w1', placedByService: 'source-amendment' },
              { id: 'h-operator', fulfillmentWorkId: 'w1', placedByService: null },
            ],
          ],
        ]) as never
      );

      const result = await service.releaseSourceChangeHolds('o1');

      expect(result).toEqual({ releasedHoldIds: ['h-own'] });
      expect(works.releaseHold).toHaveBeenCalledTimes(1);
      expect(works.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ holdId: 'h-own', workId: 'w1' }));
    });
  });
});
