/**
 * Order Cancellation Service Tests (#3540)
 *
 * @module apps/api/src/orders/application/services
 */
import {
  DuplicateRefundRecordException,
  OPERATOR_ORDER_ORIGIN_ID,
  orderStockRestoreDedupeKey,
  RefundCeilingExceededException,
} from '@openlinker/core/orders';
import { OrderCancellationService } from './order-cancellation.service';
import {
  CancelCorrectionFailedError,
  OrderCancellationInvalidReasonError,
  OrderCancellationNoteRequiredError,
  OrderCancellationNotFoundError,
  OrderCancellationRefusedError,
  type OrderCancellationRefusalCode,
} from '../errors/order-cancellation.errors';

const ORDER_ID = 'ol_order_1';
const SOURCE = 'conn-source';
const SHOP = 'conn-shop';
const ACTOR = 'user-1';

type Mocked<T> = { [K in keyof T]: jest.Mock };

function order(overrides: Record<string, unknown> = {}): unknown {
  return {
    internalOrderId: ORDER_ID,
    sourceConnectionId: SOURCE,
    cancelledAt: null,
    fulfillmentState: 'not-shipped',
    ...overrides,
  };
}

function shipment(id: string, status: string, shippingMethod = 'inpost'): unknown {
  return { id, status, shippingMethod };
}

function change(id: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    id,
    internalOrderId: ORDER_ID,
    kind: 'order.cancel_request',
    status: 'requested',
    payload: null,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'inv-1',
    orderId: ORDER_ID,
    connectionId: 'conn-invoicing',
    status: 'issued',
    blocksIssuanceElsewhere: true,
    providerInvoiceId: 'prov-1',
    providerInvoiceNumber: 'FV/1',
    issuedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    documentType: 'invoice',
    clearanceReference: null,
    isLeaseLive: () => false,
    issuedLineSnapshot: {
      currency: 'PLN',
      buyer: { name: 'B', taxId: null, address: {}, type: 'consumer' },
      lines: [
        { name: 'Shirt', quantity: 2, unitPriceGross: 10, taxRate: '23' },
        { name: 'Shipping', quantity: 1, unitPriceGross: 5, taxRate: '23' },
      ],
    },
    ...overrides,
  };
}

describe('OrderCancellationService (#3540)', () => {
  let orderRecords: Mocked<{ getOrderRecord: unknown; markCancelled: unknown }>;
  let changes: Mocked<{
    openOrReuse: unknown;
    confirm: unknown;
    decline: unknown;
    abandon: unknown;
    claimApplied: unknown;
    findById: unknown;
  }>;
  let relay: Mocked<{ relay: unknown }>;
  let shipmentQuery: Mocked<{ getOutboundByOrderId: unknown }>;
  let shipmentCancellation: Mocked<{ cancel: unknown }>;
  let invoices: Mocked<{
    listInvoicesForOrders: unknown;
    getInvoiceById: unknown;
    getLatestInvoiceForOrder: unknown;
    issueCorrection: unknown;
  }>;
  let fiscal: Mocked<{ getByOrderId: unknown }>;
  let fulfillment: Mocked<{ summarizeForOrder: unknown; cancelAllForOrder: unknown }>;
  let jobQueue: Mocked<{ enqueue: unknown }>;
  let lock: Mocked<{ acquire: unknown; release: unknown }>;
  let effects: Mocked<{ applyEffects: unknown }>;
  let refunds: Mocked<{ recordRefund: unknown; getRefundsForOrder: unknown }>;
  let service: OrderCancellationService;

  const input = {
    internalOrderId: ORDER_ID,
    reason: 'fraud' as const,
    note: null,
    acknowledgeAcceptedWork: false,
    actorUserId: ACTOR,
  };

  async function refusal(promise: Promise<unknown>): Promise<OrderCancellationRefusalCode> {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderCancellationRefusedError);
    return (error as OrderCancellationRefusedError).code;
  }

  beforeEach(() => {
    orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue(order()),
      markCancelled: jest.fn().mockResolvedValue(undefined),
    };
    changes = {
      openOrReuse: jest
        .fn()
        .mockResolvedValue({ change: change('change-1'), opened: true, expiredStale: false }),
      confirm: jest.fn().mockResolvedValue(true),
      decline: jest.fn().mockResolvedValue(true),
      abandon: jest.fn().mockResolvedValue(true),
      claimApplied: jest.fn().mockResolvedValue(true),
      findById: jest.fn(),
    };
    relay = {
      relay: jest.fn().mockResolvedValue({
        targets: [{ connectionId: SOURCE, outcome: 'applied' }],
      }),
    };
    shipmentQuery = { getOutboundByOrderId: jest.fn().mockResolvedValue([]) };
    shipmentCancellation = { cancel: jest.fn().mockResolvedValue({}) };
    invoices = {
      listInvoicesForOrders: jest.fn().mockResolvedValue([]),
      getInvoiceById: jest.fn(),
      getLatestInvoiceForOrder: jest.fn().mockResolvedValue(null),
      issueCorrection: jest.fn(),
    };
    fiscal = { getByOrderId: jest.fn().mockResolvedValue([]) };
    fulfillment = {
      summarizeForOrder: jest.fn().mockResolvedValue([]),
      cancelAllForOrder: jest.fn().mockResolvedValue({ cancelledWorkIds: [], skippedWorkIds: [] }),
    };
    jobQueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    lock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn().mockResolvedValue(true) };
    refunds = {
      recordRefund: jest.fn().mockResolvedValue({ id: 'refund-1' }),
      getRefundsForOrder: jest.fn().mockResolvedValue([]),
    };

    effects = {
      applyEffects: jest.fn().mockResolvedValue({
        cancelledWorkIds: [],
        releasedHoldIds: [],
        correctionProposal: null,
        correctionUnavailableReason: null,
      }),
    };
    service = new OrderCancellationService(
      orderRecords as never,
      changes as never,
      relay as never,
      shipmentQuery as never,
      shipmentCancellation as never,
      invoices as never,
      fiscal as never,
      fulfillment as never,
      jobQueue as never,
      lock as never,
      effects as never,
      refunds as never
    );
  });

  describe('gates', () => {
    it('should 404 when the order does not exist', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(null);

      await expect(service.cancelOrder(input)).rejects.toBeInstanceOf(OrderCancellationNotFoundError);
    });

    it('should require a note when the reason is other', async () => {
      await expect(service.cancelOrder({ ...input, reason: 'other', note: '  ' })).rejects.toBeInstanceOf(
        OrderCancellationNoteRequiredError
      );
      expect(lock.acquire).not.toHaveBeenCalled();
    });

    it('should answer a 400-class invalid-reason error for an unknown reason (B-41)', async () => {
      await expect(
        service.cancelOrder({ ...input, reason: 'whim' as never })
      ).rejects.toBeInstanceOf(OrderCancellationInvalidReasonError);
      expect(lock.acquire).not.toHaveBeenCalled();
    });

    it('should refuse an already cancelled order', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(order({ cancelledAt: new Date() }));

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_ALREADY_CANCELLED');
      expect(changes.openOrReuse).not.toHaveBeenCalled();
    });

    it.each(['in-transit', 'delivered'])('should refuse when a shipment is %s', async (status) => {
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([shipment('s1', status)]);

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_ALREADY_SHIPPED');
    });

    it('should refuse when the marketplace reports shipped and there is no label to void', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(order({ fulfillmentState: 'dispatched' }));

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_ALREADY_SHIPPED');
    });

    it('should void the label instead of refusing when the rollup reads dispatched but the label is only generated (C-6)', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(order({ fulfillmentState: 'dispatched' }));
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([shipment('s1', 'generated')]);

      const result = await service.cancelOrder(input);

      expect(shipmentCancellation.cancel).toHaveBeenCalledWith('s1');
      expect(result.voidedShipmentIds).toEqual(['s1']);
    });

    it('should refuse as shipped when an OL label was already dispatched to the marketplace (B-20)', async () => {
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([shipment('s1', 'dispatched')]);

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_ALREADY_SHIPPED');
      expect(shipmentCancellation.cancel).not.toHaveBeenCalled();
      expect(changes.openOrReuse).not.toHaveBeenCalled();
    });

    it.each(['generated', 'dispatched', 'in-transit'])(
      'should refuse as shipped for a marketplace-observed (omp) shipment in %s, never try a void (B-20)',
      async (status) => {
        shipmentQuery.getOutboundByOrderId.mockResolvedValue([shipment('s1', status, 'omp')]);

        expect(await refusal(service.cancelOrder(input))).toBe('ORDER_ALREADY_SHIPPED');
        expect(shipmentCancellation.cancel).not.toHaveBeenCalled();
      }
    );

    it('should ignore a cancelled or failed observed shipment (B-20)', async () => {
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([
        shipment('s1', 'cancelled', 'omp'),
        shipment('s2', 'failed', 'omp'),
      ]);

      expect((await service.cancelOrder(input)).status).toBe('cancelled');
    });

    it('should refuse when a fiscal receipt blocks further registration', async () => {
      fiscal.getByOrderId.mockResolvedValue([{ blocksFurtherRegistration: true }]);

      const error = await service.cancelOrder(input).catch((e: unknown) => e);
      expect((error as OrderCancellationRefusedError).code).toBe('ORDER_HAS_FISCAL_RECEIPT');
      expect((error as Error).message).toContain('returned at the fiscal printer');
      expect((error as Error).message).toContain('cannot be cancelled in OpenLinker');
    });

    it('should refuse an invoice that blocks but is not issued yet', async () => {
      invoices.listInvoicesForOrders.mockResolvedValue([invoice({ status: 'pending' })]);

      expect(await refusal(service.cancelOrder(input))).toBe('INVOICE_NOT_SETTLED');
    });

    it('should not let a newer non-blocking failed record mask the issued document (B-19)', async () => {
      invoices.listInvoicesForOrders.mockResolvedValue([
        invoice({ id: 'inv-failed', status: 'failed', blocksIssuanceElsewhere: false }),
        invoice(),
      ]);

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('cancelled');
    });

    it('should refuse a cancel already in flight', async () => {
      changes.openOrReuse.mockResolvedValue({ change: change('change-0'), opened: false, expiredStale: false });

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_CANCEL_IN_FLIGHT');
      expect(relay.relay).not.toHaveBeenCalled();
    });

    it.each([
      ['in_progress', 'unsubmitted'],
      ['open', 'accepted'],
    ])('should demand acknowledgement for work that is %s / %s', async (status, requestStatus) => {
      fulfillment.summarizeForOrder.mockResolvedValue([{ workId: 'w1', status, requestStatus }]);

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_WORK_ACCEPTED_NEEDS_ACK');
      expect(changes.openOrReuse).not.toHaveBeenCalled();
    });

    it('should proceed over accepted work once acknowledged and cancel it', async () => {
      fulfillment.summarizeForOrder.mockResolvedValue([
        { workId: 'w1', status: 'in_progress', requestStatus: 'accepted' },
      ]);
      effects.applyEffects.mockResolvedValue({
        cancelledWorkIds: ['w1'],
        releasedHoldIds: [],
        correctionProposal: null,
        correctionUnavailableReason: null,
      });

      const result = await service.cancelOrder({ ...input, acknowledgeAcceptedWork: true });

      expect(result.cancelledWorkIds).toEqual(['w1']);
    });

    it('should not demand acknowledgement for work that has already come to rest', async () => {
      fulfillment.summarizeForOrder.mockResolvedValue([
        { workId: 'w1', status: 'closed', requestStatus: 'accepted' },
      ]);

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('cancelled');
    });

    it('should refuse as contended when the per-order lock is held, and release nothing', async () => {
      lock.acquire.mockResolvedValue(null);

      expect(await refusal(service.cancelOrder(input))).toBe('ORDER_CANCEL_CONTENDED');
      expect(lock.release).not.toHaveBeenCalled();
      expect(orderRecords.getOrderRecord).not.toHaveBeenCalled();
    });

    it('should release the lock even when a gate refuses', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(order({ cancelledAt: new Date() }));

      await refusal(service.cancelOrder(input));

      expect(lock.acquire).toHaveBeenCalledWith(`order:cancel:${ORDER_ID}`, expect.any(Number));
      expect(lock.release).toHaveBeenCalledWith(`order:cancel:${ORDER_ID}`, 'token');
    });
  });

  describe('labels', () => {
    it('should void every outstanding label and skip terminal ones', async () => {
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([
        shipment('s1', 'generated'),
        shipment('s2', 'cancelled'),
        shipment('s3', 'failed'),
        shipment('s4', 'draft'),
      ]);

      const result = await service.cancelOrder(input);

      expect(shipmentCancellation.cancel.mock.calls.map((c: unknown[]) => c[0])).toEqual(['s1', 's4']);
      expect(result.voidedShipmentIds).toEqual(['s1', 's4']);
    });

    it('should not double the final period of the carrier message when a label is not voidable (C-6)', async () => {
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([shipment('s1', 'generated')]);
      shipmentCancellation.cancel.mockRejectedValue(new Error('Resource not found.'));

      const error = await service.cancelOrder(input).catch((e: unknown) => e);

      expect((error as Error).message).not.toContain('..');
    });

    it('should abandon the request, not cancel, and tell no channel when a carrier cannot void', async () => {
      shipmentQuery.getOutboundByOrderId.mockResolvedValue([shipment('s1', 'generated')]);
      shipmentCancellation.cancel.mockRejectedValue(new Error('carrier does not support void'));

      const error = await service.cancelOrder(input).catch((e: unknown) => e);

      expect((error as OrderCancellationRefusedError).code).toBe('LABEL_NOT_VOIDABLE');
      expect((error as Error).message).toContain('carrier does not support void');
      expect(changes.abandon).toHaveBeenCalledWith('change-1', 'label-not-voidable');
      expect(relay.relay).not.toHaveBeenCalled();
      expect(orderRecords.markCancelled).not.toHaveBeenCalled();
    });
  });

  describe('channel answer', () => {
    it('should relay to the SOURCE first with the operator sentinel origin and only the reason code', async () => {
      await service.cancelOrder({ ...input, reason: 'other', note: 'private operator note' });

      expect(relay.relay).toHaveBeenNthCalledWith(1, {
        internalOrderId: ORDER_ID,
        originConnectionId: OPERATOR_ORDER_ORIGIN_ID,
        onlyConnectionIds: [SOURCE],
        event: { type: 'cancelled', reason: 'other' },
      });
    });

    it('should then relay to the remaining participants authored by the source', async () => {
      relay.relay
        .mockResolvedValueOnce({ targets: [{ connectionId: SOURCE, outcome: 'applied' }] })
        .mockResolvedValueOnce({ targets: [{ connectionId: SHOP, outcome: 'applied' }] });

      const result = await service.cancelOrder(input);

      expect(relay.relay).toHaveBeenNthCalledWith(2, {
        internalOrderId: ORDER_ID,
        originConnectionId: OPERATOR_ORDER_ORIGIN_ID,
        authoredByConnectionId: SOURCE,
        event: { type: 'cancelled', reason: 'fraud' },
      });
      expect(result.participants.map((p) => [p.connectionId, p.role, p.effect])).toEqual([
        [SOURCE, 'source', 'notified'],
        [SHOP, 'destination', 'notified'],
      ]);
    });

    it('should leave the request open and report pending when the source adapter THREW (B-16)', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [{ connectionId: SOURCE, outcome: 'rejected', detail: 'timeout', adapterThrew: true }],
      });

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('pending');
      expect(result.participants[0].effect).toBe('unreachable');
      expect(changes.decline).not.toHaveBeenCalled();
      expect(changes.confirm).not.toHaveBeenCalled();
      expect(orderRecords.markCancelled).not.toHaveBeenCalled();
      expect(relay.relay).toHaveBeenCalledTimes(1);
    });

    it('should still treat an adapter that RETURNED rejected as a refusal (B-16)', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [{ connectionId: SOURCE, outcome: 'rejected', detail: 'order already sent' }],
      });

      expect(await refusal(service.cancelOrder(input))).toBe('CHANNEL_REFUSED_CANCEL');
      expect(changes.decline).toHaveBeenCalledWith('change-1', 'order already sent');
    });

    it('should not show the transport url or a doubled period in the refusal (C-5)', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [
          {
            connectionId: SOURCE,
            outcome: 'rejected',
            detail: 'Allegro API server error (409): http://g05after-faultproxy:8080/order/x/fulfillment.',
          },
        ],
      });

      const error = await service.cancelOrder(input).catch((e: unknown) => e);

      expect((error as Error).message).not.toContain('http');
      expect((error as Error).message).not.toContain('..');
      expect(changes.decline).toHaveBeenCalledWith('change-1', 'Allegro API server error (409)');
    });

    it('should apply when the source has no writeback capability', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [
          { connectionId: SOURCE, outcome: 'unsupported', unsupportedReason: 'no-capability' },
        ],
      });

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('cancelled');
      expect(result.participants[0].effect).toBe('not-supported');
    });

    it('should report stock-restored-only when the channel only had its stock restored', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [{ connectionId: SOURCE, outcome: 'applied', scope: 'stock-only' }],
      });

      const result = await service.cancelOrder(input);

      expect(result.participants[0].effect).toBe('stock-restored-only');
    });

    it('should decline the request and 409 with the channel message when the source refuses', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [{ connectionId: SOURCE, outcome: 'rejected', detail: 'already shipped' }],
      });

      const error = await service.cancelOrder(input).catch((e: unknown) => e);

      expect((error as OrderCancellationRefusedError).code).toBe('CHANNEL_REFUSED_CANCEL');
      expect((error as Error).message).toContain('already shipped');
      expect(changes.decline).toHaveBeenCalledWith('change-1', 'already shipped');
      expect(orderRecords.markCancelled).not.toHaveBeenCalled();
      expect(relay.relay).toHaveBeenCalledTimes(1);
    });

    it('should leave the request open and report pending when the relay throws', async () => {
      relay.relay.mockRejectedValueOnce(new Error('boom'));

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('pending');
      expect(result.cancelledAt).toBeNull();
      expect(changes.confirm).not.toHaveBeenCalled();
      expect(changes.decline).not.toHaveBeenCalled();
      expect(orderRecords.markCancelled).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should report pending when the source adapter could not be resolved', async () => {
      relay.relay.mockResolvedValueOnce({
        targets: [
          { connectionId: SOURCE, outcome: 'unsupported', unsupportedReason: 'adapter-unresolved' },
        ],
      });

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('pending');
      expect(result.participants[0].effect).toBe('unreachable');
      expect(relay.relay).toHaveBeenCalledTimes(1);
    });

    it('should still cancel and flag it when the destination relay itself fails', async () => {
      relay.relay
        .mockResolvedValueOnce({ targets: [{ connectionId: SOURCE, outcome: 'applied' }] })
        .mockRejectedValueOnce(new Error('destination relay down'));

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('cancelled');
      expect(result.otherParticipantsRelayFailed).toBe(true);
    });
  });

  describe('apply', () => {
    it('should confirm, claim, mark cancelled, restock under the ingestion dedupe key and cancel work', async () => {
      effects.applyEffects.mockResolvedValue({
        cancelledWorkIds: ['w1'],
        releasedHoldIds: ['hold-1'],
        correctionProposal: null,
        correctionUnavailableReason: null,
      });

      const result = await service.cancelOrder(input);

      expect(effects.applyEffects).toHaveBeenCalledWith({
        internalOrderId: ORDER_ID,
        cancelledAt: expect.any(Date),
        reason: 'fraud',
        actorUserId: ACTOR,
        voidLabels: false, // (4a) the operator path voided the labels itself; effects must not void twice
      });
      expect(changes.confirm).toHaveBeenCalledWith('change-1', ACTOR);
      expect(changes.claimApplied).toHaveBeenCalledWith('change-1');
      expect(orderRecords.markCancelled).toHaveBeenCalledWith(ORDER_ID, expect.any(Date));
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'marketplace.offer.stockRestore',
        connectionId: SOURCE,
        payload: { schemaVersion: 1, internalOrderId: ORDER_ID },
        options: { dedupeKey: orderStockRestoreDedupeKey(SOURCE, ORDER_ID) },
      });
      expect(result.stockRestoreEnqueued).toBe(true);
      expect(result.cancelledWorkIds).toEqual(['w1']);
      expect(result.correctionProposal).toBeNull();
    });

    it('should use the SAME dedupe key spelling the ingestion path uses', () => {
      expect(orderStockRestoreDedupeKey('c1', 'o1')).toBe('marketplace:c1:stockRestore:o1');
    });

    it('should report a failed stock-restore enqueue without failing the cancel', async () => {
      jobQueue.enqueue.mockRejectedValue(new Error('queue down'));

      const result = await service.cancelOrder(input);

      expect(result.status).toBe('cancelled');
      expect(result.stockRestoreEnqueued).toBe(false);
    });

    it('should still run the idempotent effects when a peer already confirmed the change', async () => {
      // The source webhook can confirm the open request via ingestion first.
      changes.confirm.mockResolvedValue(false);
      changes.claimApplied.mockResolvedValue(false);

      const result = await service.cancelOrder(input);

      expect(orderRecords.markCancelled).toHaveBeenCalled();
      expect(jobQueue.enqueue).toHaveBeenCalled();
      expect(effects.applyEffects).toHaveBeenCalled();
      expect(result.status).toBe('cancelled');
    });
  });

  describe('invoiced order', () => {
    it('should return the credit proposal the shared cleanup opened, and issue nothing itself', async () => {
      const proposal = {
        changeId: 'change-2',
        invoiceRecordId: 'inv-1',
        documentNumber: 'FV/1',
        currency: 'PLN',
        lines: [{ originalLineNumber: 1, name: 'Shirt', previousQuantity: 2, newQuantity: 0 }],
      };
      effects.applyEffects.mockResolvedValue({
        cancelledWorkIds: [],
        releasedHoldIds: [],
        correctionProposal: proposal,
        correctionUnavailableReason: null,
      });

      const result = await service.cancelOrder(input);

      expect(result.correctionProposal).toEqual(proposal);
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
    });

    it('should not run any cleanup when the cancel stays pending', async () => {
      relay.relay.mockRejectedValueOnce(new Error('boom'));

      const result = await service.cancelOrder(input);

      expect(result.correctionProposal).toBeNull();
      expect(effects.applyEffects).not.toHaveBeenCalled();
    });
  });

  describe('confirmChange', () => {
    const confirmInput = { internalOrderId: ORDER_ID, changeId: 'change-2', actorUserId: ACTOR };
    const payload = {
      invoiceRecordId: 'inv-1',
      documentNumber: 'FV/1',
      currency: 'PLN',
      reason: 'Order cancelled (fraud)',
      lines: [
        { originalLineNumber: 1, name: 'Shirt', previousQuantity: 2, newQuantity: 0 },
        { originalLineNumber: 2, name: 'Shipping', previousQuantity: 1, newQuantity: 0 },
      ],
    };

    function correctionChange(overrides: Record<string, unknown> = {}): unknown {
      return change('change-2', { kind: 'order.cancel_correction', payload, ...overrides });
    }

    beforeEach(() => {
      changes.findById.mockResolvedValue(correctionChange());
      invoices.getInvoiceById.mockResolvedValue(invoice());
      invoices.issueCorrection.mockResolvedValue({
        id: 'inv-2',
        status: 'issued',
        providerInvoiceNumber: 'FK/1',
        isLeaseLive: () => false,
      });
    });

    it('should 404 an unknown change', async () => {
      changes.findById.mockResolvedValue(null);

      await expect(service.confirmChange(confirmInput)).rejects.toBeInstanceOf(
        OrderCancellationNotFoundError
      );
    });

    it('should 404 a change that belongs to another order, before any write', async () => {
      changes.findById.mockResolvedValue(correctionChange({ internalOrderId: 'ol_order_other' }));

      await expect(service.confirmChange(confirmInput)).rejects.toBeInstanceOf(
        OrderCancellationNotFoundError
      );
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
      expect(changes.confirm).not.toHaveBeenCalled();
    });

    it.each([
      'order.cancel_request',
      'return.decline',
      'return.authorize',
      'return.invoice_correction',
      'order.discount_change',
    ])(
      'should refuse to confirm a %s change here',
      async (kind) => {
        changes.findById.mockResolvedValue(correctionChange({ kind }));

        expect(await refusal(service.confirmChange(confirmInput))).toBe('CHANGE_KIND_NOT_CONFIRMABLE');
      }
    );

    it.each([
      ['confirmed', 'CHANGE_ALREADY_CONFIRMED'],
      ['expired', 'CHANGE_EXPIRED'],
      ['declined', 'CHANGE_NOT_OPEN'],
      ['canceled', 'CHANGE_NOT_OPEN'],
    ])('should refuse a %s change with %s', async (status, code) => {
      changes.findById.mockResolvedValue(correctionChange({ status }));

      expect(await refusal(service.confirmChange(confirmInput))).toBe(code);
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
    });

    it('should refuse when the invoice is no longer issued', async () => {
      invoices.getInvoiceById.mockResolvedValue(invoice({ status: 'failed' }));

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CHANGE_NOT_OPEN');
    });

    it('should refuse when the proposal names an invoice of a different order', async () => {
      invoices.getInvoiceById.mockResolvedValue(invoice({ orderId: 'ol_order_other' }));

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CHANGE_NOT_OPEN');
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
    });

    it('should refuse and abandon when the invoice was corrected after the proposal (B-21)', async () => {
      invoices.listInvoicesForOrders.mockResolvedValue([
        invoice({
          id: 'inv-9',
          providerInvoiceNumber: 'FK/9',
          createdAt: new Date('2026-09-05T00:00:00.000Z'),
        }),
        invoice(),
      ]);

      const error = await service.confirmChange(confirmInput).catch((e: unknown) => e);

      expect((error as OrderCancellationRefusedError).code).toBe('CORRECTION_SUPERSEDED');
      expect((error as Error).message).toContain('FK/9');
      expect(changes.abandon).toHaveBeenCalledWith('change-2', 'correction-superseded');
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
    });

    it('should issue the correction under a key derived from the change id, then confirm', async () => {
      const result = await service.confirmChange(confirmInput);

      expect(invoices.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-invoicing',
          orderId: ORDER_ID,
          originalProviderInvoiceId: 'prov-1',
          idempotencyKey: 'cancel-correction:change-2',
          lines: [
            { originalLineNumber: 1, newQuantity: 0 },
            { originalLineNumber: 2, newQuantity: 0 },
          ],
          originalDocument: expect.objectContaining({ currency: 'PLN', documentNumber: 'FV/1' }),
        })
      );
      expect(changes.confirm).toHaveBeenCalledWith('change-2', ACTOR);
      expect(changes.claimApplied).toHaveBeenCalledWith('change-2');
      expect(result).toMatchObject({ changeId: 'change-2', status: 'confirmed', documentNumber: 'FK/1' });
    });

    it('should leave the change open and surface the failure when the provider rejects', async () => {
      invoices.issueCorrection.mockRejectedValue(new Error('provider 500'));

      await expect(service.confirmChange(confirmInput)).rejects.toBeInstanceOf(
        CancelCorrectionFailedError
      );
      expect(changes.confirm).not.toHaveBeenCalled();
    });

    it('should leave the change open when the provider has not settled', async () => {
      invoices.issueCorrection.mockResolvedValue({
        id: 'inv-2',
        status: 'issuing',
        isLeaseLive: () => true,
      });

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CORRECTION_IN_PROGRESS');
      expect(changes.confirm).not.toHaveBeenCalled();
    });

    it('should call an unsettled record with no live lease a reconciliation case', async () => {
      invoices.issueCorrection.mockResolvedValue({
        id: 'inv-2',
        status: 'failed',
        isLeaseLive: () => false,
      });

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CORRECTION_NEEDS_RECONCILIATION');
    });
  });

  describe('confirmChange - discount kinds (#3543)', () => {
    const confirmInput = { internalOrderId: ORDER_ID, changeId: 'change-3', actorUserId: ACTOR };
    const refundChange = (overrides: Record<string, unknown> = {}): unknown =>
      change('change-3', {
        kind: 'order.discount_refund',
        payload: { amount: '12.50', currency: 'PLN', reason: 'other', note: 'Discount granted in OpenLinker' },
        ...overrides,
      });
    const correctionChange = (overrides: Record<string, unknown> = {}): unknown =>
      change('change-3', {
        kind: 'order.discount_correction',
        payload: {
          invoiceRecordId: 'inv-1',
          documentNumber: 'FV/1',
          currency: 'PLN',
          reason: 'Discount granted in OpenLinker',
          lines: [
            { originalLineNumber: 1, name: 'Shirt', previousUnitPriceGross: 10, newUnitPriceGross: 8.75 },
          ],
        },
        ...overrides,
      });

    it('should record the refund out of band under a key derived from the change id, then confirm', async () => {
      changes.findById.mockResolvedValue(refundChange());

      const result = await service.confirmChange(confirmInput);

      expect(refunds.recordRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          internalOrderId: ORDER_ID,
          amount: '12.50',
          currency: 'PLN',
          reason: 'other',
          note: 'Discount granted in OpenLinker',
          idempotencyKey: 'discount-refund:change-3',
          executedBy: 'operator_out_of_band',
          acknowledgeAboveCeiling: false,
        })
      );
      expect(changes.confirm).toHaveBeenCalledWith('change-3', ACTOR);
      expect(changes.claimApplied).toHaveBeenCalledWith('change-3');
      expect(result).toMatchObject({ status: 'confirmed', refundRecordId: 'refund-1', invoiceRecordId: null });
    });

    it('should pass acknowledgeAboveCeiling from the confirm body to the refund write', async () => {
      changes.findById.mockResolvedValue(refundChange());

      await service.confirmChange({ ...confirmInput, acknowledgeAboveCeiling: true });

      expect(refunds.recordRefund).toHaveBeenCalledWith(
        expect.objectContaining({ acknowledgeAboveCeiling: true })
      );
    });

    it('should leave the intent open when the refund ceiling refuses', async () => {
      changes.findById.mockResolvedValue(refundChange());
      refunds.recordRefund.mockRejectedValue(
        new RefundCeilingExceededException(ORDER_ID, '50.00', '45.00', '12.50', 'PLN')
      );

      await expect(service.confirmChange(confirmInput)).rejects.toBeInstanceOf(
        RefundCeilingExceededException
      );
      expect(changes.confirm).not.toHaveBeenCalled();
    });

    it('should treat a duplicate key as an earlier attempt that already wrote the record', async () => {
      changes.findById.mockResolvedValue(refundChange());
      refunds.recordRefund.mockRejectedValue(new DuplicateRefundRecordException(ORDER_ID, 'discount-refund:change-3'));
      refunds.getRefundsForOrder.mockResolvedValue([{ id: 'refund-0', idempotencyKey: 'discount-refund:change-3' }]);

      const result = await service.confirmChange(confirmInput);

      expect(result.refundRecordId).toBe('refund-0');
      expect(changes.confirm).toHaveBeenCalledWith('change-3', ACTOR);
    });

    it.each([
      ['confirmed', 'CHANGE_ALREADY_CONFIRMED'],
      ['expired', 'CHANGE_EXPIRED'],
      ['canceled', 'CHANGE_NOT_OPEN'],
    ])('should refuse a %s refund intent with %s and record nothing', async (status, code) => {
      changes.findById.mockResolvedValue(refundChange({ status }));

      expect(await refusal(service.confirmChange(confirmInput))).toBe(code);
      expect(refunds.recordRefund).not.toHaveBeenCalled();
    });

    it('should answer CHANGE_NOT_OPEN, not CHANGE_EXPIRED, for a proposal OL replaced (E-47)', async () => {
      changes.findById.mockResolvedValue(
        refundChange({ status: 'expired', declinedReason: 'superseded-by-newer-proposal' })
      );

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CHANGE_NOT_OPEN');
      expect(refunds.recordRefund).not.toHaveBeenCalled();
    });

    it('should refuse a discount correction on a cancelled order and retire the proposal (B-31)', async () => {
      changes.findById.mockResolvedValue(correctionChange());
      invoices.getInvoiceById.mockResolvedValue(invoice());
      orderRecords.getOrderRecord.mockResolvedValue(order({ cancelledAt: new Date() }));

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CORRECTION_SUPERSEDED');
      expect(changes.decline).toHaveBeenCalledWith('change-3', 'correction-superseded');
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
    });

    it('should refuse a discount correction when a later correction was already issued (B-31)', async () => {
      changes.findById.mockResolvedValue(correctionChange());
      invoices.getInvoiceById.mockResolvedValue(invoice());
      invoices.getLatestInvoiceForOrder.mockResolvedValue(
        invoice({ id: 'inv-9', createdAt: new Date('2026-09-05T00:00:00.000Z') })
      );

      expect(await refusal(service.confirmChange(confirmInput))).toBe('CORRECTION_SUPERSEDED');
      expect(invoices.issueCorrection).not.toHaveBeenCalled();
    });

    it('should issue the discount correction with price deltas under its own key prefix', async () => {
      changes.findById.mockResolvedValue(correctionChange());
      invoices.getInvoiceById.mockResolvedValue(invoice());
      invoices.issueCorrection.mockResolvedValue({
        id: 'inv-2',
        status: 'issued',
        providerInvoiceNumber: 'FK/2',
        isLeaseLive: () => false,
      });

      const result = await service.confirmChange(confirmInput);

      expect(invoices.issueCorrection).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'discount-correction:change-3',
          lines: [{ originalLineNumber: 1, newUnitPriceGross: 8.75 }],
        })
      );
      expect(changes.confirm).toHaveBeenCalledWith('change-3', ACTOR);
      expect(result).toMatchObject({ documentNumber: 'FK/2', refundRecordId: null });
    });
  });
});
