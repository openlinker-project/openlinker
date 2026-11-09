/**
 * PaymentWritebackService specs (#3963)
 *
 * The planning half (what ingestion records and enqueues) and the send half
 * (what one job attempt records for each relay outcome), with every port
 * mocked.
 */
import type { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { Order } from '../../../domain/types/order.types';
import type { PaymentWriteback } from '../../../domain/types/payment-writeback.types';
import type { OrderSyncResult } from '../../interfaces/order-sync.service.interface';
import { PaymentWritebackService } from '../payment-writeback.service';

const ORDER_ID = 'ol_order_1';
const SOURCE = 'src-allegro';
const PS = 'dest-ps';
const AT = '2026-11-04T14:00:00.000Z';

function makeRecord(overrides: Partial<Record<string, unknown>> = {}): OrderRecord {
  return {
    internalOrderId: ORDER_ID,
    sourceConnectionId: SOURCE,
    syncStatus: [{ destinationConnectionId: PS, status: 'synced' }],
    paymentStatus: 'paid',
    paymentMethod: 'online',
    isCancelled: false,
    paymentWriteback: { [PS]: { state: 'awaiting', at: AT, attempts: 0 } } as PaymentWriteback,
    nativeTotals: { amount: 389, currency: 'PLN' },
    ...overrides,
  } as unknown as OrderRecord;
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    status: 'processing',
    items: [],
    totals: { subtotal: 389, tax: 0, shipping: 0, total: 389, currency: 'PLN' },
    paymentStatus: 'paid',
    paymentMethod: 'online',
    ...overrides,
  } as Order;
}

describe('PaymentWritebackService', () => {
  let records: {
    findById: jest.Mock;
    findByIds: jest.Mock;
    recordPaymentWriteback: jest.Mock;
    claimPaymentWriteback: jest.Mock;
    markPaymentWritebackHandled: jest.Mock;
  };
  let refunds: { findByOrderId: jest.Mock };
  let relay: { relay: jest.Mock };
  let integrations: { getAdapter: jest.Mock };
  let jobQueue: { enqueue: jest.Mock };
  let service: PaymentWritebackService;

  beforeEach(() => {
    records = {
      findById: jest.fn().mockResolvedValue(makeRecord()),
      findByIds: jest.fn().mockResolvedValue([]),
      recordPaymentWriteback: jest.fn().mockResolvedValue(undefined),
      claimPaymentWriteback: jest.fn().mockResolvedValue(true),
      markPaymentWritebackHandled: jest.fn().mockResolvedValue(1),
    };
    refunds = { findByOrderId: jest.fn().mockResolvedValue([]) };
    relay = { relay: jest.fn().mockResolvedValue({ targets: [{ connectionId: PS, outcome: 'applied' }] }) };
    integrations = {
      getAdapter: jest.fn().mockResolvedValue({ connection: { name: 'Allegro', config: {} } }),
    };
    jobQueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    service = new PaymentWritebackService(
      records as never,
      refunds as never,
      relay as never,
      integrations as never,
      jobQueue as never
    );
  });

  describe('planAfterSync', () => {
    const existingDestination: OrderSyncResult = {
      destinationConnectionId: PS,
      status: 'success',
      orderRef: { orderId: '1027' },
      created: false,
    };

    it('should enqueue one job for a shop waiting for a payment that has now arrived', async () => {
      await service.planAfterSync({
        order: makeOrder(),
        existing: makeRecord({ paymentStatus: 'awaiting' }),
        sourceConnectionId: SOURCE,
        results: [existingDestination],
      });

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'order.paymentWriteback.push',
        connectionId: PS,
        payload: { schemaVersion: 1, internalOrderId: ORDER_ID, sourceConnectionId: SOURCE },
        options: { dedupeKey: `payment:${ORDER_ID}:${PS}` },
      });
    });

    it('should record awaiting when a shop gets an unpaid order in this run', async () => {
      await service.planAfterSync({
        order: makeOrder({ paymentStatus: 'awaiting' }),
        existing: null,
        sourceConnectionId: SOURCE,
        results: [{ ...existingDestination, created: true }],
      });

      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'awaiting', attempts: 0 })
      );
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should record created-paid and enqueue nothing when the order was paid before the shop got it', async () => {
      await service.planAfterSync({
        order: makeOrder(),
        existing: null,
        sourceConnectionId: SOURCE,
        results: [{ ...existingDestination, created: true }],
      });

      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'created-paid' })
      );
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should record cod and enqueue nothing for a cash-on-delivery order the source now reports paid', async () => {
      await service.planAfterSync({
        order: makeOrder({ paymentMethod: 'cash_on_delivery' }),
        existing: makeRecord({ paymentStatus: 'cod', paymentMethod: 'cash_on_delivery' }),
        sourceConnectionId: SOURCE,
        results: [existingDestination],
      });

      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(ORDER_ID, PS, expect.objectContaining({ state: 'cod' }));
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should record skipped-by-setting when the shop connection leaves payment to the operator', async () => {
      integrations.getAdapter.mockResolvedValue({
        connection: { name: 'PS', config: { paymentWriteback: { mode: 'leave' } } },
      });

      await service.planAfterSync({
        order: makeOrder(),
        existing: makeRecord({ paymentStatus: 'awaiting' }),
        sourceConnectionId: SOURCE,
        results: [existingDestination],
      });

      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'skipped-by-setting' })
      );
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should stamp awaiting before enqueueing for a shop provisioned before the feature', async () => {
      await service.planAfterSync({
        order: makeOrder(),
        existing: makeRecord({ paymentStatus: 'awaiting', paymentWriteback: {} }),
        sourceConnectionId: SOURCE,
        results: [existingDestination],
      });

      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'awaiting' })
      );
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('should never throw, even when the queue does', async () => {
      jobQueue.enqueue.mockRejectedValue(new Error('redis down'));

      await expect(
        service.planAfterSync({
          order: makeOrder(),
          existing: makeRecord({ paymentStatus: 'awaiting' }),
          sourceConnectionId: SOURCE,
          results: [existingDestination],
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('push', () => {
    const input = { internalOrderId: ORDER_ID, destinationConnectionId: PS, sourceConnectionId: SOURCE, isLastAttempt: false };

    it('should relay paid to only this shop and record paid-in-shop on success', async () => {
      await expect(service.push(input)).resolves.toBe('done');

      expect(relay.relay).toHaveBeenCalledWith({
        internalOrderId: ORDER_ID,
        originConnectionId: SOURCE,
        onlyConnectionIds: [PS],
        event: { type: 'paid', amount: 389, currency: 'PLN', paidOn: 'Allegro' },
      });
      expect(records.recordPaymentWriteback).toHaveBeenLastCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'paid-in-shop', attempts: 1 })
      );
    });

    it('should send nothing when another worker holds the claim', async () => {
      records.claimPaymentWriteback.mockResolvedValue(false);

      await expect(service.push(input)).resolves.toBe('skipped');
      expect(relay.relay).not.toHaveBeenCalled();
    });

    it('should record not-sent cancelled and send nothing when the order was cancelled after planning', async () => {
      records.findById.mockResolvedValue(makeRecord({ isCancelled: true }));

      await expect(service.push(input)).resolves.toBe('done');
      expect(relay.relay).not.toHaveBeenCalled();
      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'not-sent', reason: 'cancelled' })
      );
    });

    it('should record not-sent no-total and send nothing when the order total is unknown', async () => {
      records.findById.mockResolvedValue(makeRecord({ nativeTotals: undefined }));

      await expect(service.push(input)).resolves.toBe('done');
      expect(relay.relay).not.toHaveBeenCalled();
      expect(records.claimPaymentWriteback).not.toHaveBeenCalled();
      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'not-sent', reason: 'no-total' })
      );
    });

    it('should not send a zero amount as paid', async () => {
      records.findById.mockResolvedValue(makeRecord({ nativeTotals: { amount: 0, currency: 'PLN' } }));

      await expect(service.push(input)).resolves.toBe('done');
      expect(relay.relay).not.toHaveBeenCalled();
    });

    it('should report retrying for a transient failure before the last attempt', async () => {
      relay.relay.mockResolvedValue({
        targets: [{ connectionId: PS, outcome: 'rejected', adapterThrew: true, detail: '503' }],
      });

      await expect(service.push(input)).resolves.toBe('retrying');
      expect(records.recordPaymentWriteback).toHaveBeenLastCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'retrying', detail: '503' })
      );
    });

    it('should record not-sent retries-exhausted for a transient failure on the last attempt', async () => {
      relay.relay.mockResolvedValue({
        targets: [{ connectionId: PS, outcome: 'rejected', adapterThrew: true }],
      });

      await expect(service.push({ ...input, isLastAttempt: true })).resolves.toBe('done');
      expect(records.recordPaymentWriteback).toHaveBeenLastCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'not-sent', reason: 'retries-exhausted' })
      );
    });

    it('should record not-sent rejected when the shop refuses for good', async () => {
      relay.relay.mockResolvedValue({
        targets: [{ connectionId: PS, outcome: 'rejected', detail: 'order already shipped in the shop' }],
      });

      await expect(service.push(input)).resolves.toBe('done');
      expect(records.recordPaymentWriteback).toHaveBeenLastCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'not-sent', reason: 'rejected' })
      );
    });

    it('should record not-tracked when the shop has no payment status', async () => {
      relay.relay.mockResolvedValue({
        targets: [{ connectionId: PS, outcome: 'unsupported', unsupportedReason: 'no-capability' }],
      });

      await expect(service.push(input)).resolves.toBe('done');
      expect(records.recordPaymentWriteback).toHaveBeenLastCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'not-tracked' })
      );
    });

    it('should leave a settled entry alone', async () => {
      records.findById.mockResolvedValue(
        makeRecord({ paymentWriteback: { [PS]: { state: 'paid-in-shop', at: AT, attempts: 1 } } })
      );

      await expect(service.push(input)).resolves.toBe('skipped');
      expect(records.claimPaymentWriteback).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('should re-open a problem entry and enqueue a fresh send under a manual key', async () => {
      records.findByIds.mockResolvedValue([
        makeRecord({
          paymentWriteback: { [PS]: { state: 'not-sent', reason: 'retries-exhausted', at: AT, attempts: 8 } },
        }),
      ]);

      await expect(service.retry([ORDER_ID])).resolves.toBe(1);
      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(
        ORDER_ID,
        PS,
        expect.objectContaining({ state: 'retrying', attempts: 8 })
      );
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { dedupeKey: expect.stringMatching(new RegExp(`^payment:${ORDER_ID}:${PS}:manual:`)) },
        })
      );
    });

    it('should put the previous entry back and carry on when one enqueue fails', async () => {
      const stopped = { state: 'not-sent', reason: 'retries-exhausted', at: AT, attempts: 8 };
      records.findByIds.mockResolvedValue([
        makeRecord({ paymentWriteback: { [PS]: stopped } }),
        makeRecord({ internalOrderId: 'ol_order_2', paymentWriteback: { [PS]: stopped } }),
      ]);
      jobQueue.enqueue.mockRejectedValueOnce(new Error('queue down')).mockResolvedValueOnce('job-2');

      await expect(service.retry([ORDER_ID, 'ol_order_2'])).resolves.toBe(1);
      expect(records.recordPaymentWriteback).toHaveBeenCalledWith(ORDER_ID, PS, stopped);
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(records.recordPaymentWriteback).toHaveBeenLastCalledWith(
        'ol_order_2',
        PS,
        expect.objectContaining({ state: 'retrying' })
      );
    });

    it('should not touch a cancelled entry', async () => {
      records.findByIds.mockResolvedValue([
        makeRecord({ paymentWriteback: { [PS]: { state: 'not-sent', reason: 'cancelled', at: AT, attempts: 0 } } }),
      ]);

      await expect(service.retry([ORDER_ID])).resolves.toBe(0);
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
