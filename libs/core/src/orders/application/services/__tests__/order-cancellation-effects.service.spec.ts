/**
 * Order Cancellation Effects Service Tests (#3540)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderCancellationEffectsService } from '../order-cancellation-effects.service';

const ORDER_ID = 'ol_order_1';
const ACTOR = 'user-1';
const input = {
  internalOrderId: ORDER_ID,
  cancelledAt: new Date('2026-10-01T00:00:00.000Z'),
  reason: 'fraud',
  actorUserId: ACTOR,
};

function invoice(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'inv-1',
    providerInvoiceId: 'prov-1',
    providerInvoiceNumber: 'FV/1',
    issuedAt: new Date('2026-09-01T00:00:00.000Z'),
    issuedLineSnapshot: {
      currency: 'PLN',
      lines: [
        { name: 'Shirt', quantity: 2 },
        { name: 'Shipping', quantity: 1 },
      ],
    },
    ...overrides,
  };
}

describe('OrderCancellationEffectsService (#3540)', () => {
  let fulfillment: { cancelAllForOrder: jest.Mock };
  let holds: { getOpenHold: jest.Mock; release: jest.Mock };
  let changes: { openOrReuse: jest.Mock };
  let invoices: { getLatestIssuedInvoiceForOrder: jest.Mock };
  let service: OrderCancellationEffectsService;

  beforeEach(() => {
    fulfillment = {
      cancelAllForOrder: jest.fn().mockResolvedValue({ cancelledWorkIds: ['w1'], skippedWorkIds: [] }),
    };
    holds = { getOpenHold: jest.fn().mockResolvedValue(null), release: jest.fn() };
    changes = {
      openOrReuse: jest
        .fn()
        .mockResolvedValue({ change: { id: 'change-2' }, opened: true, expiredStale: false }),
    };
    invoices = { getLatestIssuedInvoiceForOrder: jest.fn().mockResolvedValue(null) };
    service = new OrderCancellationEffectsService(
      fulfillment as never,
      holds as never,
      changes as never,
      invoices as never
    );
  });

  it('should cancel the order work with the cancel instant', async () => {
    const result = await service.applyEffects(input);

    expect(fulfillment.cancelAllForOrder).toHaveBeenCalledWith(ORDER_ID, input.cancelledAt);
    expect(result.cancelledWorkIds).toEqual(['w1']);
  });

  it('should keep going and report no work when cancelling it throws', async () => {
    fulfillment.cancelAllForOrder.mockRejectedValue(new Error('db'));

    const result = await service.applyEffects(input);

    expect(result.cancelledWorkIds).toEqual([]);
  });

  describe('holds', () => {
    it('should release a user-placed hold as the operator with the cancel note (hold decision)', async () => {
      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: null });

      const result = await service.applyEffects(input);

      expect(holds.release).toHaveBeenCalledWith({
        holdId: 'hold-1',
        note: 'order cancelled',
        releasedBy: { kind: 'user', userId: ACTOR },
      });
      expect(result.releasedHoldIds).toEqual(['hold-1']);
    });

    it('should release a service-placed hold as that service', async () => {
      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: 'fraud-check' });

      await service.applyEffects(input);

      expect(holds.release).toHaveBeenCalledWith(
        expect.objectContaining({ releasedBy: { kind: 'service', service: 'fraud-check' } })
      );
    });

    it('should leave a user-placed hold alone when there is no operator to attribute it to', async () => {
      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: null });

      const result = await service.applyEffects({ ...input, actorUserId: null });

      expect(holds.release).not.toHaveBeenCalled();
      expect(result.releasedHoldIds).toEqual([]);
    });

    it('should do nothing when no hold is open, and survive a release failure', async () => {
      await service.applyEffects(input);
      expect(holds.release).not.toHaveBeenCalled();

      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: null });
      holds.release.mockRejectedValue(new Error('already released'));
      await expect(service.applyEffects(input)).resolves.toMatchObject({ releasedHoldIds: [] });
    });
  });

  describe('credit proposal', () => {
    it('should read the latest ISSUED invoice, never the newest row (B-19)', async () => {
      await service.applyEffects(input);

      expect(invoices.getLatestIssuedInvoiceForOrder).toHaveBeenCalledWith(ORDER_ID);
    });

    it('should propose zeroing every line of the issued document', async () => {
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(invoice());

      const result = await service.applyEffects(input);

      expect(result.correctionProposal).toEqual({
        changeId: 'change-2',
        invoiceRecordId: 'inv-1',
        documentNumber: 'FV/1',
        currency: 'PLN',
        lines: [
          { originalLineNumber: 1, name: 'Shirt', previousQuantity: 2, newQuantity: 0 },
          { originalLineNumber: 2, name: 'Shipping', previousQuantity: 1, newQuantity: 0 },
        ],
      });
      expect(changes.openOrReuse).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'order.cancel_correction',
          targetRef: `correction:cancel:${ORDER_ID}:inv-1`,
          requestedBy: ACTOR,
        })
      );
    });

    it('should keep original line numbers when dropping an already-credited line', async () => {
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(
        invoice({
          issuedLineSnapshot: {
            currency: 'PLN',
            lines: [
              { name: 'Gone', quantity: 0 },
              { name: 'Shirt', quantity: 1 },
            ],
          },
        })
      );

      const result = await service.applyEffects(input);

      expect(result.correctionProposal?.lines).toEqual([
        { originalLineNumber: 2, name: 'Shirt', previousQuantity: 1, newQuantity: 0 },
      ]);
    });

    it('should name why when the invoice carries no line snapshot', async () => {
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(invoice({ issuedLineSnapshot: null }));

      const result = await service.applyEffects(input);

      expect(result.correctionProposal).toBeNull();
      expect(result.correctionUnavailableReason).toBe('no-line-snapshot');
    });

    it.each([
      ['no provider id', { providerInvoiceId: null }],
      ['no document number', { providerInvoiceNumber: null }],
      ['no issue instant', { issuedAt: null }],
    ])(
      'should name not-fully-issued and open no proposal when the invoice has %s (C-31, E-41)',
      async (_label, overrides) => {
        invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(invoice(overrides));

        const result = await service.applyEffects(input);

        expect(result.correctionProposal).toBeNull();
        expect(result.correctionUnavailableReason).toBe('not-fully-issued');
        expect(changes.openOrReuse).not.toHaveBeenCalled();
      }
    );

    it('should report proposal-failed when opening the proposal throws', async () => {
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(invoice());
      changes.openOrReuse.mockRejectedValue(new Error('db'));

      const result = await service.applyEffects(input);

      expect(result.correctionUnavailableReason).toBe('proposal-failed');
    });

    it('should propose nothing when the order has no issued invoice', async () => {
      const result = await service.applyEffects(input);

      expect(result.correctionProposal).toBeNull();
      expect(result.correctionUnavailableReason).toBeNull();
    });
  });
});
