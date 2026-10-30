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
  let changes: { openOrReuse: jest.Mock; findOpenByOrder: jest.Mock; abandon: jest.Mock };
  let invoices: { getLatestIssuedInvoiceForOrder: jest.Mock };
  let moduleRef: { get: jest.Mock };
  let voider: { voidLabelsForOrder: jest.Mock };
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
      findOpenByOrder: jest.fn().mockResolvedValue([]),
      abandon: jest.fn().mockResolvedValue(true),
    };
    invoices = { getLatestIssuedInvoiceForOrder: jest.fn().mockResolvedValue(null) };
    voider = { voidLabelsForOrder: jest.fn().mockResolvedValue([]) };
    moduleRef = { get: jest.fn().mockReturnValue(voider) };
    service = new OrderCancellationEffectsService(
      fulfillment as never,
      holds as never,
      changes as never,
      invoices as never,
      moduleRef as never
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

  describe('open discount proposals (B-31)', () => {
    it('should abandon open discount refund and correction proposals and leave other kinds', async () => {
      changes.findOpenByOrder.mockResolvedValue([
        { id: 'refund-1', kind: 'order.discount_refund' },
        { id: 'corr-1', kind: 'order.discount_correction' },
        { id: 'cancel-1', kind: 'order.cancel_request' },
      ]);

      await service.applyEffects(input);

      expect(changes.findOpenByOrder).toHaveBeenCalledWith(ORDER_ID);
      expect(changes.abandon).toHaveBeenCalledTimes(2);
      expect(changes.abandon).toHaveBeenCalledWith('refund-1', 'order-cancelled');
      expect(changes.abandon).toHaveBeenCalledWith('corr-1', 'order-cancelled');
    });

    it('should keep abandoning and still propose the credit when one abandon throws', async () => {
      changes.findOpenByOrder.mockResolvedValue([
        { id: 'refund-1', kind: 'order.discount_refund' },
        { id: 'corr-1', kind: 'order.discount_correction' },
      ]);
      changes.abandon.mockRejectedValueOnce(new Error('db'));
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(invoice());

      const result = await service.applyEffects(input);

      expect(changes.abandon).toHaveBeenCalledWith('corr-1', 'order-cancelled');
      expect(result.correctionProposal?.changeId).toBe('change-2');
    });

    it('should carry on when listing open proposals fails', async () => {
      changes.findOpenByOrder.mockRejectedValue(new Error('db'));

      const result = await service.applyEffects(input);

      expect(changes.abandon).not.toHaveBeenCalled();
      expect(result.cancelledWorkIds).toEqual(['w1']);
    });
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

    it('should release a person-placed hold as the system with the cancel note when no operator is known (4b)', async () => {
      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: null });

      const result = await service.applyEffects({ ...input, actorUserId: null });

      expect(holds.release).toHaveBeenCalledWith({
        holdId: 'hold-1',
        note: 'order cancelled',
        releasedBy: { kind: 'system', cause: 'order-cancelled' },
      });
      expect(result.releasedHoldIds).toEqual(['hold-1']);
    });

    it('should keep releasing a service-placed hold as that service when no operator is known (4b)', async () => {
      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: 'fraud-check' });

      await service.applyEffects({ ...input, actorUserId: null });

      expect(holds.release).toHaveBeenCalledWith(
        expect.objectContaining({ releasedBy: { kind: 'service', service: 'fraud-check' } })
      );
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

  describe('labels (4a)', () => {
    it('should void the bought labels and report each outcome when the channel cancelled (4a)', async () => {
      voider.voidLabelsForOrder.mockResolvedValue([{ shipmentId: 's1', outcome: 'voided' }]);

      const result = await service.applyEffects({ ...input, actorUserId: null });

      expect(voider.voidLabelsForOrder).toHaveBeenCalledWith(ORDER_ID);
      expect(result.labelVoids).toEqual([{ shipmentId: 's1', outcome: 'voided' }]);
    });

    it('should not abort the other effects when voiding a label fails (4a)', async () => {
      voider.voidLabelsForOrder.mockRejectedValue(new Error('carrier down'));
      holds.getOpenHold.mockResolvedValue({ id: 'hold-1', placedByService: null });

      const result = await service.applyEffects({ ...input, actorUserId: null });

      expect(result.labelVoids).toEqual([]);
      expect(result.cancelledWorkIds).toEqual(['w1']);
      expect(result.releasedHoldIds).toEqual(['hold-1']);
    });

    it('should carry on without voiding when shipping is not wired into the process (4a)', async () => {
      moduleRef.get.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await service.applyEffects({ ...input, actorUserId: null });

      expect(result.labelVoids).toEqual([]);
      expect(result.cancelledWorkIds).toEqual(['w1']);
    });

    it('should not void again when the operator path already voided the labels (4a)', async () => {
      const result = await service.applyEffects({ ...input, voidLabels: false });

      expect(voider.voidLabelsForOrder).not.toHaveBeenCalled();
      expect(result.labelVoids).toEqual([]);
    });
  });
});
