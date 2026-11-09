/**
 * Order Source Amendment Effects Service Tests (#3961)
 *
 * The decision table itself is covered by `source-amendment-plan.types.spec.ts`;
 * this suite pins what each plan DOES: which collaborators it calls, in which
 * order, and what it reports.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderSourceAmendmentEffectsService } from '../order-source-amendment-effects.service';

const ORDER_ID = 'ol_order_1';

interface RecordShape {
  cancelledAt: Date | null;
  recordStatus: string;
  orderItems: Array<{ id: string; quantity: number }>;
  packedAt: Date | null;
  fulfillmentState: string | null;
  lastAmendmentChanges: unknown[] | null;
  omsAttention: Array<{ producer: string; reason: string; detail?: string }>;
}

function record(overrides: Partial<RecordShape> = {}): RecordShape {
  return {
    cancelledAt: null,
    recordStatus: 'ready',
    orderItems: [
      { id: 'li_1', quantity: 1 },
      { id: 'li_2', quantity: 1 },
    ],
    packedAt: null,
    fulfillmentState: 'not-shipped',
    lastAmendmentChanges: [{ kind: 'line-quantity-changed', lineId: 'li_1', fromQuantity: 2, toQuantity: 1 }],
    omsAttention: [],
    ...overrides,
  };
}

function assessment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unrouted: false,
    anyParcelClosed: false,
    handedOff: [],
    underway: false,
    fulfilledByLine: {},
    requiredByLine: { li_1: 2, li_2: 1 },
    verifiedByLine: {},
    ...overrides,
  };
}

describe('OrderSourceAmendmentEffectsService (#3961)', () => {
  let calls: string[];
  let orderRecords: { getOrderRecord: jest.Mock; markOmsAttention: jest.Mock };
  let fulfillmentEdit: {
    assessForEdit: jest.Mock;
    lowerLineQuantity: jest.Mock;
    holdForSourceChange: jest.Mock;
    releaseSourceChangeHolds: jest.Mock;
  };
  let reservations: { narrowForOrder: jest.Mock };
  let saleReversal: { reverseLineToTarget: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };
  let connections: { get: jest.Mock };
  let integrations: { resolveAdapterMetadata: jest.Mock };
  let changes: { openOrReuse: jest.Mock; confirm: jest.Mock; findLatestByTarget: jest.Mock };
  let service: OrderSourceAmendmentEffectsService;

  beforeEach(() => {
    calls = [];
    orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue(record()),
      markOmsAttention: jest.fn().mockImplementation((_id: string, _producer: string, outcome: { kind: string }) => {
        calls.push(`attention:${outcome.kind}`);
        return Promise.resolve();
      }),
    };
    fulfillmentEdit = {
      assessForEdit: jest.fn().mockResolvedValue(assessment()),
      lowerLineQuantity: jest.fn().mockImplementation(() => {
        calls.push('work');
        return Promise.resolve({ outcome: 'applied', cancelledUnits: 1, workIds: ['w1'], closedParcels: [] });
      }),
      holdForSourceChange: jest.fn().mockImplementation(() => {
        calls.push('hold');
        return Promise.resolve({ heldWorkIds: ['w1'] });
      }),
      releaseSourceChangeHolds: jest.fn().mockImplementation(() => {
        calls.push('release');
        return Promise.resolve({ releasedHoldIds: ['h1'] });
      }),
    };
    reservations = {
      narrowForOrder: jest.fn().mockImplementation(() => {
        calls.push('reservation');
        return Promise.resolve({ narrowed: 1, released: 0, untouched: 0, failed: 0 });
      }),
    };
    saleReversal = {
      reverseLineToTarget: jest.fn().mockImplementation(() => {
        calls.push('stock');
        return Promise.resolve({ status: 'restored', units: 1, detail: null });
      }),
    };
    lock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn().mockResolvedValue(undefined) };
    connections = { get: jest.fn().mockResolvedValue({ id: 'oms', platformType: 'openlinker', adapterKey: null }) };
    integrations = { resolveAdapterMetadata: jest.fn().mockResolvedValue({ requiresCredentials: false }) };
    changes = {
      openOrReuse: jest.fn().mockResolvedValue({ change: { id: 'chg-1' }, open: true }),
      confirm: jest.fn().mockResolvedValue(true),
      findLatestByTarget: jest.fn().mockResolvedValue(null),
    };
    service = new OrderSourceAmendmentEffectsService(
      orderRecords as never,
      fulfillmentEdit as never,
      reservations as never,
      saleReversal as never,
      lock as never,
      connections as never,
      integrations as never,
      changes as never
    );
  });

  describe('reconcile', () => {
    it('should narrow the work, then the reservation, then give back stock to the new target', async () => {
      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result).toEqual({
        outcome: 'applied',
        lines: [{ orderLineId: 'li_1', from: 2, to: 1 }],
        cause: null,
        closedParcels: [],
      });
      expect(calls).toEqual(['work', 'reservation', 'stock']);
      expect(fulfillmentEdit.lowerLineQuantity).toHaveBeenCalledWith({
        orderId: ORDER_ID,
        orderLineId: 'li_1',
        newQuantity: 1,
      });
      expect(saleReversal.reverseLineToTarget).toHaveBeenCalledWith({
        internalOrderId: ORDER_ID,
        orderLineId: 'li_1',
        targetUnits: 1,
      });
      expect(lock.acquire).toHaveBeenCalledWith(`order:edit:${ORDER_ID}`, expect.any(Number));
      expect(lock.release).toHaveBeenCalled();
    });

    it('should report the parcels the lowered quantity closed, so the host can relay them', async () => {
      const closedAt = new Date('2026-11-09T10:00:00Z');
      fulfillmentEdit.lowerLineQuantity.mockResolvedValueOnce({
        outcome: 'applied',
        cancelledUnits: 1,
        workIds: ['w1'],
        closedParcels: [{ workId: 'w1', closedAt }],
      });

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.closedParcels).toEqual([{ workId: 'w1', closedAt }]);
    });

    it('should clear its own attention entry and holds once the change is applied', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        record({ omsAttention: [{ producer: 'source-amendment', reason: 'source-change-unapplied', detail: 'box-holds-more' }] })
      );

      await service.reconcile({ internalOrderId: ORDER_ID });

      expect(calls).toEqual(['work', 'reservation', 'stock', 'release', 'attention:none']);
    });

    it('should report a failed reservation step as not finished, like a failed stock step', async () => {
      reservations.narrowForOrder.mockRejectedValue(new Error('db down'));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('failed');
      expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(ORDER_ID, 'source-amendment', {
        kind: 'blocked',
        reason: 'source-change-unapplied',
        detail: 'apply-failed',
      });
    });

    it('should finish an earlier unfinished apply even though the work already matches', async () => {
      const unfinished = record({
        omsAttention: [{ producer: 'source-amendment', reason: 'source-change-unapplied', detail: 'apply-failed' }],
      });
      orderRecords.getOrderRecord.mockResolvedValue(unfinished);
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ requiredByLine: { li_1: 1, li_2: 1 } }));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('applied');
      expect(reservations.narrowForOrder).toHaveBeenCalledWith({
        orderRecordId: ORDER_ID,
        lines: [
          { orderLineId: 'li_1', quantity: 1 },
          { orderLineId: 'li_2', quantity: 1 },
        ],
      });
      expect(saleReversal.reverseLineToTarget).toHaveBeenCalledWith({
        internalOrderId: ORDER_ID,
        orderLineId: 'li_1',
        targetUnits: 1,
      });
      expect(fulfillmentEdit.lowerLineQuantity).not.toHaveBeenCalled();
      expect(calls.slice(-2)).toEqual(['release', 'attention:none']);
    });

    it('should keep the flag when finishing the earlier apply fails again', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        record({
          omsAttention: [{ producer: 'source-amendment', reason: 'source-change-unapplied', detail: 'apply-failed' }],
        })
      );
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ requiredByLine: { li_1: 1, li_2: 1 } }));
      saleReversal.reverseLineToTarget.mockResolvedValue({ status: 'failed', units: 0, detail: 'master down' });

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('failed');
      expect(fulfillmentEdit.releaseSourceChangeHolds).not.toHaveBeenCalled();
    });

    it('should hold without writing an English note onto the hold', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ verifiedByLine: { li_1: 2 } }));

      await service.reconcile({ internalOrderId: ORDER_ID });

      expect(fulfillmentEdit.holdForSourceChange).toHaveBeenCalledWith({ orderId: ORDER_ID });
    });

    it('should still answer when releasing the lock fails', async () => {
      lock.release.mockRejectedValue(new Error('redis down'));

      await expect(service.reconcile({ internalOrderId: ORDER_ID })).resolves.toMatchObject({
        outcome: 'applied',
      });
    });

    it('should write nothing when the order already agrees with its work', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ requiredByLine: { li_1: 1, li_2: 1 } }));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('nothing-to-do');
      expect(calls).toEqual([]);
    });

    it('should hold the box and raise attention when it already holds more units', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ verifiedByLine: { li_1: 2 } }));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result).toMatchObject({ outcome: 'held', cause: 'box-holds-more' });
      expect(calls).toEqual(['hold', 'attention:blocked']);
      expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(ORDER_ID, 'source-amendment', {
        kind: 'blocked',
        reason: 'source-change-unapplied',
        detail: 'box-holds-more',
      });
      expect(fulfillmentEdit.lowerLineQuantity).not.toHaveBeenCalled();
      expect(saleReversal.reverseLineToTarget).not.toHaveBeenCalled();
    });

    it('should hold when an outside holder has the work', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(
        assessment({
          handedOff: [{ workId: 'w1', assignedConnectionId: '3pl', status: 'open', requestStatus: 'accepted' }],
        })
      );
      integrations.resolveAdapterMetadata.mockResolvedValue({});

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result).toMatchObject({ outcome: 'held', cause: 'packed-elsewhere' });
    });

    it('should treat an unresolvable holder as outside rather than narrow under it', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(
        assessment({
          handedOff: [{ workId: 'w1', assignedConnectionId: 'gone', status: 'open', requestStatus: 'accepted' }],
        })
      );
      connections.get.mockRejectedValue(new Error('not found'));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result).toMatchObject({ outcome: 'held', cause: 'packed-elsewhere' });
    });

    it('should only report a change after shipping, with no hold', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(record({ fulfillmentState: 'dispatched' }));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('shipped');
      expect(calls).toEqual(['attention:blocked']);
      expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(
        ORDER_ID,
        'source-amendment',
        expect.objectContaining({ detail: 'shipped' })
      );
    });

    it('should release a held box when the operator already accepted exactly this change', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ verifiedByLine: { li_1: 2 } }));
      orderRecords.getOrderRecord.mockResolvedValue(
        record({ omsAttention: [{ producer: 'source-amendment', reason: 'source-change-unapplied' }] })
      );
      changes.findLatestByTarget.mockResolvedValue({ id: 'chg-1', status: 'confirmed' });

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('accepted');
      expect(changes.findLatestByTarget).toHaveBeenCalledWith(
        ORDER_ID,
        'source-change:li_1:2>1',
        'order.source_change_accept'
      );
      expect(calls).toEqual(['release', 'attention:none']);
    });

    it('should report failed and keep the order flagged when stock could not be given back', async () => {
      saleReversal.reverseLineToTarget.mockResolvedValue({ status: 'failed', units: 0, detail: 'master down' });

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('failed');
      expect(orderRecords.markOmsAttention).toHaveBeenCalledWith(ORDER_ID, 'source-amendment', {
        kind: 'blocked',
        reason: 'source-change-unapplied',
        detail: 'apply-failed',
      });
    });

    it('should skip, never narrow, when another writer holds the order lock', async () => {
      lock.acquire.mockResolvedValue(null);

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('contended');
      expect(fulfillmentEdit.assessForEdit).not.toHaveBeenCalled();
    });

    it('should never read an unreadable snapshot as every line lowered to zero', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(record({ orderItems: [] }));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('nothing-to-do');
      expect(fulfillmentEdit.lowerLineQuantity).not.toHaveBeenCalled();
    });

    it('should leave a cancelled order to the cancellation path', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(record({ cancelledAt: new Date() }));

      const result = await service.reconcile({ internalOrderId: ORDER_ID });

      expect(result.outcome).toBe('nothing-to-do');
      expect(fulfillmentEdit.assessForEdit).not.toHaveBeenCalled();
    });

    it('should report failed instead of throwing when a collaborator throws', async () => {
      fulfillmentEdit.assessForEdit.mockRejectedValue(new Error('db down'));

      await expect(service.reconcile({ internalOrderId: ORDER_ID })).resolves.toMatchObject({
        outcome: 'failed',
      });
      expect(lock.release).toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('should record a confirmed acceptance keyed by the mismatch and release the box', async () => {
      fulfillmentEdit.assessForEdit.mockResolvedValue(assessment({ anyParcelClosed: true }));

      const result = await service.accept({ internalOrderId: ORDER_ID, actorUserId: 'user-1' });

      expect(result.outcome).toBe('accepted');
      expect(changes.openOrReuse).toHaveBeenCalledWith(
        expect.objectContaining({
          internalOrderId: ORDER_ID,
          kind: 'order.source_change_accept',
          targetRef: 'source-change:li_1:2>1',
          requestedBy: 'user-1',
        })
      );
      expect(changes.confirm).toHaveBeenCalledWith('chg-1', 'user-1');
      expect(calls).toEqual(['release', 'attention:none']);
    });

    it('should apply instead of accepting when nothing blocks the change any more', async () => {
      const result = await service.accept({ internalOrderId: ORDER_ID, actorUserId: 'user-1' });

      expect(result.outcome).toBe('applied');
      expect(changes.openOrReuse).not.toHaveBeenCalled();
    });
  });
});
