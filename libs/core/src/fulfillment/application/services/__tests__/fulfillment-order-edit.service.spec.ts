/**
 * Fulfillment Order Edit Service Tests (#3542, D-C)
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { IFulfillmentProgressService } from '../../interfaces/fulfillment-progress.service.interface';
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
      | 'addLine'
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
  let progress: { record: jest.Mock };
  let service: FulfillmentOrderEditService;

  beforeEach(() => {
    works = {
      findByOrderId: jest.fn(),
      recordLineProgress: jest.fn().mockResolvedValue(true),
      addLine: jest.fn().mockResolvedValue(true),
      countParcelVerifications: jest.fn().mockResolvedValue([]),
      listActiveHoldsForWorks: jest.fn().mockResolvedValue(new Map()),
      placeHold: jest.fn().mockResolvedValue({}),
      releaseHold: jest.fn().mockResolvedValue({}),
      runInTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn('tx')) as never,
      lockWorkForVerification: jest.fn().mockResolvedValue(null),
      findLatestActiveVerification: jest.fn().mockResolvedValue(null),
      claimParcelClose: jest.fn().mockResolvedValue(true),
    };
    progress = { record: jest.fn().mockResolvedValue({ status: 'recorded', intents: [] }) };
    service = new FulfillmentOrderEditService(
      works as unknown as FulfillmentWorkRepositoryPort,
      progress as unknown as IFulfillmentProgressService
    );
  });

  describe('addLineToOpenWork (#3940)', () => {
    const input = {
      orderId: 'o1',
      orderLineId: 'op-gift:c1',
      productVariantId: 'v-gift',
      quantity: 2,
      acceptsHolder: jest.fn().mockResolvedValue(true),
    };

    beforeEach(() => input.acceptsHolder.mockResolvedValue(true));

    it('should add the gift as a new line of the open work an accepted holder packs', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 1 }])] as never);

      const result = await service.addLineToOpenWork(input);

      expect(works.addLine).toHaveBeenCalledWith('w1', {
        orderLineId: 'op-gift:c1',
        productVariantId: 'v-gift',
        totalQuantity: 2,
      });
      expect(result).toEqual({ outcome: 'added', workId: 'w1' });
    });

    it('should leave a work held by an outside executor alone', async () => {
      input.acceptsHolder.mockResolvedValue(false);
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 1 }])] as never);

      const result = await service.addLineToOpenWork(input);

      expect(works.addLine).not.toHaveBeenCalled();
      expect(result.outcome).toBe('no-eligible-work');
    });

    it('should skip a work whose parcel is closed or that is already finished', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [], { parcelClosedAt: new Date() }),
        work('w2', [], { status: 'closed' }),
      ] as never);

      expect((await service.addLineToOpenWork(input)).outcome).toBe('no-eligible-work');
      expect(works.addLine).not.toHaveBeenCalled();
    });

    it('should report an unrouted order and a repeat without writing', async () => {
      works.findByOrderId.mockResolvedValue([] as never);
      expect((await service.addLineToOpenWork(input)).outcome).toBe('unrouted');

      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'op-gift:c1', total: 2 }])] as never);
      expect((await service.addLineToOpenWork(input)).outcome).toBe('unchanged');
      expect(works.addLine).not.toHaveBeenCalled();
    });

    it('should fall through to the next work when the first refuses the insert', async () => {
      works.addLine.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      works.findByOrderId.mockResolvedValue([work('w1', []), work('w2', [])] as never);

      expect(await service.addLineToOpenWork(input)).toEqual({ outcome: 'added', workId: 'w2' });
    });
  });

  describe('lowerLineQuantity', () => {
    it('should lower every component of a bundle line to newQuantity * perUnit (#3607)', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [
          { orderLineId: 'l1~c:va', total: 6 },
          { orderLineId: 'l1~c:vb', total: 3 },
        ]),
      ] as never);

      const result = await service.lowerLineQuantity({
        orderId: 'o1',
        orderLineId: 'l1',
        newQuantity: 1,
        components: [
          { componentLineId: 'l1~c:va', perUnit: 3 },
          { componentLineId: 'l1~c:vb', perUnit: 1 },
        ],
      });

      expect(works.recordLineProgress).toHaveBeenCalledWith(
        expect.objectContaining({ orderLineId: 'l1~c:va', cancelledDelta: 3 })
      );
      expect(works.recordLineProgress).toHaveBeenCalledWith(
        expect.objectContaining({ orderLineId: 'l1~c:vb', cancelledDelta: 2 })
      );
      expect(result.outcome).toBe('applied');
      expect(result.cancelledUnits).toBe(5);
    });

    it('should refuse the whole bundle edit before writing when one component already shipped (#3607)', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [
          { orderLineId: 'l1~c:va', total: 6 },
          { orderLineId: 'l1~c:vb', total: 3, fulfilled: 3 },
        ]),
      ] as never);

      await expect(
        service.lowerLineQuantity({
          orderId: 'o1',
          orderLineId: 'l1',
          newQuantity: 1,
          components: [
            { componentLineId: 'l1~c:va', perUnit: 3 },
            { componentLineId: 'l1~c:vb', perUnit: 1 },
          ],
        })
      ).rejects.toThrow(RangeError);
      expect(works.recordLineProgress).not.toHaveBeenCalled();
    });

    it('should report the units the line cannot be lowered below, in agreement with the write guard (#3520)', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [
          { orderLineId: 'l1~c:va', total: 6, fulfilled: 4 },
          { orderLineId: 'l1~c:vb', total: 3, fulfilled: 3 },
        ]),
      ] as never);
      const components = [
        { componentLineId: 'l1~c:va', perUnit: 3 },
        { componentLineId: 'l1~c:vb', perUnit: 1 },
      ];

      const assessment = await service.assessForEdit('o1', { l1: components });
      const floor = assessment.fulfilledByLine.l1;

      // Lowering to the assessed floor passes the write guard; one below is refused.
      await expect(service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: floor, components })).resolves.toBeDefined();
      await expect(
        service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: floor - 1, components })
      ).rejects.toThrow(RangeError);
    });

    it('should report a bundle line fulfilled in whole bundles in assessForEdit (#3607)', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [
          { orderLineId: 'l1~c:va', total: 6, fulfilled: 4 },
          { orderLineId: 'l1~c:vb', total: 3, fulfilled: 3 },
        ]),
      ] as never);

      const assessment = await service.assessForEdit('o1', {
        l1: [
          { componentLineId: 'l1~c:va', perUnit: 3 },
          { componentLineId: 'l1~c:vb', perUnit: 1 },
        ],
      });

      // Conservative: component vb has 3 units out, so no fewer than 3 bundles remain.
      expect(assessment.fulfilledByLine).toEqual({ l1: 3 });
    });

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
      expect(result).toEqual({ outcome: 'applied', cancelledUnits: 3, workIds: ['w1'], closedParcels: [] });
    });

    // #3961 adds `closedParcels`: a report of a box this call closed, not a
    // relay or re-route intent. The host decides whether to relay it.
    it('should produce no relay or re-route intent: the result carries counters, ids and closed parcels', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', [{ orderLineId: 'l1', total: 2 }])] as never);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(Object.keys(result).sort()).toEqual(['cancelledUnits', 'closedParcels', 'outcome', 'workIds']);
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

    it('should record the close as shipped and report it, so the channel is told it left', async () => {
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 1 }]);

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(result.closedParcels).toEqual([{ workId: 'w1', closedAt: expect.any(Date) as Date }]);
      const closedAt = result.closedParcels[0].closedAt;
      expect(progress.record).toHaveBeenCalledWith({
        kind: 'shipped',
        workId: 'w1',
        connectionId: 'holder',
        idempotencyKey: `parcel-closed:w1:${String(closedAt.getTime())}`,
        occurredAt: closedAt,
      });
    });

    it('should leave a box open that is on hold for another reason, and record nothing', async () => {
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 1 }]);
      works.listActiveHoldsForWorks.mockResolvedValue(
        new Map([['w1', [{ id: 'h1', placedByService: null, reason: 'fraud-review' }]]]) as never
      );

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(works.claimParcelClose).not.toHaveBeenCalled();
      expect(progress.record).not.toHaveBeenCalled();
      expect(result.closedParcels).toEqual([]);
    });

    it('should still close a box held only by the shop change itself', async () => {
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 1 }]);
      works.listActiveHoldsForWorks.mockResolvedValue(
        new Map([['w1', [{ id: 'h1', placedByService: 'source-amendment', reason: 'awaiting-amendment' }]]]) as never
      );

      await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(works.claimParcelClose).toHaveBeenCalled();
    });

    it('should keep the close when recording it as shipped fails', async () => {
      works.countParcelVerifications.mockResolvedValue([{ workLineId: 'w1-l1', verifiedQuantity: 1 }]);
      progress.record.mockRejectedValue(new Error('db down'));

      const result = await service.lowerLineQuantity({ orderId: 'o1', orderLineId: 'l1', newQuantity: 1 });

      expect(result.closedParcels).toHaveLength(1);
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

      expect(result).toEqual({ outcome: 'applied', cancelledUnits: 2, workIds: ['w1'], closedParcels: [] });
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

  describe('assessForEdit - bundle lines fold to commercial grain (#3961, #3607)', () => {
    it('should report required and verified units in whole bundles', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [
          { orderLineId: 'l1~c:va', total: 6 },
          { orderLineId: 'l1~c:vb', total: 2 },
        ]),
      ] as never);
      works.countParcelVerifications.mockResolvedValue([
        { workLineId: 'w1-l1~c:va', verifiedQuantity: 5 },
        { workLineId: 'w1-l1~c:vb', verifiedQuantity: 2 },
      ]);

      const assessment = await service.assessForEdit('o1', {
        l1: [
          { componentLineId: 'l1~c:va', perUnit: 3 },
          { componentLineId: 'l1~c:vb', perUnit: 1 },
        ],
      });

      expect(assessment.requiredByLine).toEqual({ l1: 2 });
      // va has 5 of 3-per-bundle = 1 whole bundle; the box has verified one set.
      expect(assessment.verifiedByLine).toEqual({ l1: 1 });
    });
  });

  describe('holdForSourceChange (#3961)', () => {
    it('should hold every non-terminal work as the source-change actor', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', [{ orderLineId: 'l1', total: 2 }]),
        work('w2', [{ orderLineId: 'l1', total: 1 }], { status: 'closed' }),
      ] as never);

      const result = await service.holdForSourceChange({ orderId: 'o1' });

      expect(result).toEqual({ heldWorkIds: ['w1'] });
      expect(works.placeHold).toHaveBeenCalledWith(
        expect.objectContaining({
          workId: 'w1',
          reason: 'awaiting-amendment',
          note: null,
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

      const result = await service.holdForSourceChange({ orderId: 'o1' });

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
