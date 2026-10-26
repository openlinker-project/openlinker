/**
 * Order Edit Service Tests (#3542)
 *
 * Every refusal is a code an operator reads, so each one is asserted by code. The
 * orchestration is asserted by ORDER: gates, change row, overlay write, only then
 * the follow-ups, and never any call that could tell a channel.
 *
 * @module apps/api/src/orders/application/services
 */
import {
  OrderChange,
  OrderRecord,
  RefundCeilingExceededException,
  type IOrderChangeService,
  type IOrderRecordService,
  type IOrderRefundService,
} from '@openlinker/core/orders';
import type { IFiscalRegistrationService } from '@openlinker/core/fiscalization';
import type { IFulfillmentOrderEditService, OrderWorkEditAssessment } from '@openlinker/core/fulfillment';
import type { IInventorySaleReversalService, IReservationService } from '@openlinker/core/inventory';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { IShipmentQueryService } from '@openlinker/core/shipping';
import type { SyncLockPort } from '@openlinker/core/sync';

import type { IConnectionService } from '../../../integrations/application/interfaces/connection.service.interface';
import { OrderEditInvalidError, OrderEditNotFoundError, OrderEditRefusedError } from '../errors/order-edit.errors';
import { OrderEditService } from './order-edit.service';

const ORDER_ID = 'ol_order_1';

const channelSnapshot = (): Record<string, unknown> => ({
  id: ORDER_ID,
  items: [
    { id: 'l1', productId: 'p1', quantity: 3, price: 10 },
    { id: 'l2', productId: 'p2', quantity: 1, price: 20 },
  ],
  totals: { subtotal: 50, tax: 0, shipping: 0, total: 50, currency: 'PLN' },
  shippingAddress: { address1: 'Old 1', city: 'Warsaw', postalCode: '00-001', country: 'PL', taxId: '123' },
  shipping: { methodId: 'courier', methodName: 'Courier' },
});

function record(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date();
  const base = new OrderRecord(ORDER_ID, null, 'src-conn', null, channelSnapshot(), [], 'ready', now, now);
  return Object.assign(Object.create(OrderRecord.prototype) as OrderRecord, base, overrides);
}

function recordWithSnapshot(snapshot: Record<string, unknown>, overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date();
  const base = new OrderRecord(ORDER_ID, null, 'src-conn', null, snapshot, [], 'ready', now, now);
  return Object.assign(Object.create(OrderRecord.prototype) as OrderRecord, base, overrides);
}

const assessment = (overrides: Partial<OrderWorkEditAssessment> = {}): OrderWorkEditAssessment => ({
  unrouted: true,
  anyParcelClosed: false,
  handedOff: [],
  underway: false,
  fulfilledByLine: {},
  ...overrides,
});

const change = new OrderChange(
  'chg-1', ORDER_ID, 'order.address_change', 'edit:address:ol_order_1', 'requested', null,
  'user-1', new Date(), null, null, null, null, new Date(), new Date()
);

function issuedInvoice(
  options: {
    status?: string;
    unitPrices?: number[];
    withLineIds?: boolean;
    productIds?: string[];
    snapshot?: boolean;
  } = {}
): unknown {
  const prices = options.unitPrices ?? [10, 20];
  const withIds = options.withLineIds ?? true;
  const products = options.productIds ?? ['p1', 'p2'];
  return {
    id: 'inv-1',
    status: options.status ?? 'issued',
    blocksIssuanceElsewhere: true,
    providerInvoiceId: 'prov-1',
    providerInvoiceNumber: 'FV/1',
    issuedAt: new Date('2026-10-01T00:00:00.000Z'),
    issuedLineSnapshot:
      options.snapshot === false
        ? null
        : {
            currency: 'PLN',
            buyer: {},
            lines: [
              { name: 'A', quantity: 3, unitPriceGross: prices[0], taxRate: '23', productId: products[0], ...(withIds && { orderLineId: 'l1' }) },
              { name: 'B', quantity: 1, unitPriceGross: prices[1], taxRate: '23', productId: products[1], ...(withIds && { orderLineId: 'l2' }) },
            ],
          },
  };
}

describe('OrderEditService (#3542)', () => {
  let orderRecords: jest.Mocked<Pick<IOrderRecordService, 'getOrderRecord' | 'applyOrderEdit'>>;
  let changes: jest.Mocked<IOrderChangeService>;
  let shipments: jest.Mocked<Pick<IShipmentQueryService, 'getOutboundByOrderId'>>;
  let invoices: jest.Mocked<Pick<IInvoiceService, 'getLatestInvoiceForOrder'>>;
  let fiscal: jest.Mocked<Pick<IFiscalRegistrationService, 'getByOrderId'>>;
  let fulfillment: jest.Mocked<IFulfillmentOrderEditService>;
  let reservations: jest.Mocked<Pick<IReservationService, 'narrowForOrder'>>;
  let reversal: jest.Mocked<Pick<IInventorySaleReversalService, 'reverseLineQuantity'>>;
  let connections: { get: jest.Mock };
  let integrations: { resolveAdapterMetadata: jest.Mock };
  let lock: jest.Mocked<Pick<SyncLockPort, 'acquire' | 'release'>>;
  let refunds: { getRefundSummariesForOrders: jest.Mock };
  let service: OrderEditService;
  const calls: string[] = [];

  const newAddress = { address1: 'New 9', city: 'Krakow', postalCode: '30-001', country: 'PL' };

  beforeEach(() => {
    calls.length = 0;
    process.env.OL_STORE_PII = 'true';
    orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue(record()),
      applyOrderEdit: jest.fn().mockImplementation(() => {
        calls.push('overlay');
        return Promise.resolve(
          record({ orderEdits: { v: 1, rev: 1, lines: { l1: { changeId: 'chg-1', editedAt: new Date().toISOString(), editedBy: null, quantity: 1 } } } })
        );
      }),
    };
    changes = {
      openOrReuse: jest.fn().mockImplementation(() => {
        calls.push('open');
        return Promise.resolve({ change, opened: true });
      }),
      confirm: jest.fn().mockImplementation(() => {
        calls.push('confirm');
        return Promise.resolve(true);
      }),
      claimApplied: jest.fn().mockResolvedValue(true),
      abandon: jest.fn().mockResolvedValue(true),
      findOpenByOrder: jest.fn().mockResolvedValue([]),
      findByOrderAndKinds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IOrderChangeService>;
    shipments = { getOutboundByOrderId: jest.fn().mockResolvedValue([]) };
    invoices = { getLatestInvoiceForOrder: jest.fn().mockResolvedValue(null) };
    fiscal = { getByOrderId: jest.fn().mockResolvedValue([]) };
    fulfillment = {
      assessForEdit: jest.fn().mockResolvedValue(assessment()),
      lowerLineQuantity: jest.fn().mockImplementation(() => {
        calls.push('work');
        return Promise.resolve({ outcome: 'applied', cancelledUnits: 2, workIds: ['w1'] });
      }),
    };
    reservations = {
      narrowForOrder: jest.fn().mockImplementation(() => {
        calls.push('reservation');
        return Promise.resolve({ narrowed: 1, released: 0, untouched: 0, failed: 0 });
      }),
    };
    reversal = {
      reverseLineQuantity: jest.fn().mockImplementation(() => {
        calls.push('stock');
        return Promise.resolve({ status: 'restored', units: 2, detail: null });
      }),
    };
    connections = { get: jest.fn().mockResolvedValue({ id: 'holder', platformType: 'acme', adapterKey: null }) };
    integrations = { resolveAdapterMetadata: jest.fn().mockResolvedValue({ adapterKey: 'acme.3pl.v1' }) };
    lock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn().mockResolvedValue(undefined) };
    refunds = { getRefundSummariesForOrders: jest.fn().mockResolvedValue(new Map()) };

    service = new OrderEditService(
      orderRecords as unknown as IOrderRecordService,
      changes,
      shipments as unknown as IShipmentQueryService,
      invoices as unknown as IInvoiceService,
      fiscal as unknown as IFiscalRegistrationService,
      fulfillment,
      reservations as unknown as IReservationService,
      reversal as unknown as IInventorySaleReversalService,
      connections as unknown as IConnectionService,
      integrations as unknown as IIntegrationsService,
      lock as unknown as SyncLockPort,
      refunds as unknown as IOrderRefundService
    );
  });

  const base = { internalOrderId: ORDER_ID, actorUserId: 'user-1', dryRun: false };
  const refusal = (promise: Promise<unknown>): Promise<string> =>
    promise.then(
      () => 'no refusal',
      (error: unknown) => (error instanceof OrderEditRefusedError ? error.code : `other: ${String(error)}`)
    );

  describe('gates shared by every edit', () => {
    it.each([
      ['ORDER_ALREADY_CANCELLED', () => record({ cancelledAt: new Date() })],
      ['ORDER_NOT_READY', () => record({ recordStatus: 'awaiting_mapping' })],
      ['ORDER_ALREADY_SHIPPED', () => record({ fulfillmentState: 'dispatched' })],
      ['ORDER_PACKED', () => record({ packedAt: new Date() })],
      ['ORDER_AMENDMENT_IN_FLIGHT', () => record({ activeHoldReason: 'awaiting-amendment' })],
    ] as const)('should refuse with %s and write nothing', async (code, makeRecord) => {
      orderRecords.getOrderRecord.mockResolvedValue(makeRecord());

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe(code);
      expect(changes.openOrReuse).not.toHaveBeenCalled();
      expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
    });

    it('should refuse an order with a closed parcel as packed', async () => {
      fulfillment.assessForEdit.mockResolvedValue(assessment({ anyParcelClosed: true }));

      expect(await refusal(service.editDeliveryMethod({ ...base, methodId: 'x', methodName: null, pickupPoint: null }))).toBe('ORDER_PACKED');
    });

    it('should refuse while a cancellation request waits for the channel', async () => {
      changes.findOpenByOrder.mockResolvedValue([
        Object.assign(Object.create(OrderChange.prototype) as OrderChange, { kind: 'order.cancel_request' }),
      ]);

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('ORDER_AMENDMENT_IN_FLIGHT');
    });

    it('should 404 an unknown order', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(null);

      await expect(service.editAddress({ ...base, address: newAddress })).rejects.toBeInstanceOf(OrderEditNotFoundError);
    });

    it('should refuse when another edit holds the lock', async () => {
      lock.acquire.mockResolvedValue(null);

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('ORDER_EDIT_CONTENDED');
    });
  });

  describe('address', () => {
    it('should write the overlay, restamp the hash, and keep the address out of the change row', async () => {
      await service.editAddress({ ...base, address: newAddress });

      expect(changes.openOrReuse).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'order.address_change',
          targetRef: `edit:address:${ORDER_ID}`,
          payload: { fields: ['address1', 'city', 'postalCode'] },
        })
      );
      const input = orderRecords.applyOrderEdit.mock.calls[0][0];
      expect(input.expectedRev).toBe(0);
      expect(input.address?.changeId).toBe('chg-1');
      expect(input.address?.shipping).toMatchObject({ address1: 'New 9', taxId: '123' });
      expect(JSON.stringify(changes.openOrReuse.mock.calls[0][0].payload)).not.toContain('New 9');
    });

    it('should open, write the overlay and only then confirm the change', async () => {
      await service.editAddress({ ...base, address: newAddress });

      expect(calls).toEqual(['open', 'overlay', 'confirm']);
      expect(changes.claimApplied).toHaveBeenCalledWith('chg-1');
    });

    it('should refuse once a label is bought', async () => {
      shipments.getOutboundByOrderId.mockResolvedValue([{ status: 'generated' }] as never);

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('LABEL_ALREADY_BOUGHT');
    });

    it('should refuse when buyer addresses are not stored', async () => {
      process.env.OL_STORE_PII = 'false';

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('ADDRESS_EDIT_NEEDS_PII_STORAGE');
    });

    it('should refuse an address that is already the current one', async () => {
      const same = { address1: 'Old 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' };

      expect(await refusal(service.editAddress({ ...base, address: same }))).toBe('NOTHING_CHANGED');
    });

    it('should refuse an order already sent to an outside warehouse, but not to its own executor', async () => {
      fulfillment.assessForEdit.mockResolvedValue(
        assessment({ unrouted: false, handedOff: [{ workId: 'w1', assignedConnectionId: 'holder', status: 'open', requestStatus: 'accepted' }] })
      );
      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('EDIT_AFTER_HANDOFF');

      integrations.resolveAdapterMetadata.mockResolvedValue({ adapterKey: 'openlinker.oms.v1' });
      await expect(service.editAddress({ ...base, address: newAddress })).resolves.toMatchObject({ dryRun: false });
    });

    it('should treat a holder it cannot resolve as an outside one', async () => {
      fulfillment.assessForEdit.mockResolvedValue(
        assessment({ unrouted: false, handedOff: [{ workId: 'w1', assignedConnectionId: 'gone', status: 'open', requestStatus: 'accepted' }] })
      );
      connections.get.mockRejectedValue(new Error('not found'));

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('EDIT_AFTER_HANDOFF');
    });

    it('should abandon the change and report contention when the overlay write loses the race', async () => {
      orderRecords.applyOrderEdit.mockResolvedValue(null);

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('ORDER_EDIT_CONTENDED');
      expect(changes.abandon).toHaveBeenCalledWith('chg-1');
      expect(changes.confirm).not.toHaveBeenCalled();
    });

    it('should answer ORDER_NOT_READY, not contention, when a re-ingestion unmapped the order mid-edit (B-39)', async () => {
      orderRecords.applyOrderEdit.mockResolvedValue(null);
      orderRecords.getOrderRecord
        .mockResolvedValueOnce(record())
        .mockResolvedValue(record({ recordStatus: 'awaiting_mapping' }));

      expect(await refusal(service.editAddress({ ...base, address: newAddress }))).toBe('ORDER_NOT_READY');
      expect(changes.abandon).toHaveBeenCalledWith('chg-1');
    });
  });

  describe('dry run', () => {
    it('should check every gate and return the figures without writing anything', async () => {
      const result = await service.editLines({
        ...base,
        dryRun: true,
        lines: [{ orderLineId: 'l1', quantity: 1 }],
        acknowledgeAcceptedWork: false,
      });

      expect(result.dryRun).toBe(true);
      expect(result.changeId).toBeNull();
      expect(result.view.totals).toMatchObject({ channelTotal: 50, total: 30, difference: 20, taxRestated: false });
      expect(lock.acquire).not.toHaveBeenCalled();
      expect(changes.openOrReuse).not.toHaveBeenCalled();
      expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
      expect(fulfillment.lowerLineQuantity).not.toHaveBeenCalled();
    });

    it('should still refuse, so the review step never promises what the save would refuse', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(record({ packedAt: new Date() }));

      expect(
        await refusal(service.editLines({ ...base, dryRun: true, lines: [{ orderLineId: 'l1', quantity: 1 }], acknowledgeAcceptedWork: false }))
      ).toBe('ORDER_PACKED');
    });
  });

  describe('lines', () => {
    const lowerL1 = { ...base, lines: [{ orderLineId: 'l1', quantity: 1 }], acknowledgeAcceptedWork: false };

    it('should narrow the work, lower the reservation and give the stock back, after the overlay and in that order', async () => {
      const result = await service.editLines(lowerL1);

      expect(calls).toEqual(['open', 'overlay', 'work', 'reservation', 'stock', 'confirm']);
      expect(fulfillment.lowerLineQuantity).toHaveBeenCalledWith({ orderId: ORDER_ID, orderLineId: 'l1', newQuantity: 1 });
      expect(reservations.narrowForOrder).toHaveBeenCalledWith({
        orderRecordId: ORDER_ID,
        lines: [{ orderLineId: 'l1', quantity: 1 }],
      });
      expect(reversal.reverseLineQuantity).toHaveBeenCalledWith({
        internalOrderId: ORDER_ID,
        orderLineId: 'l1',
        units: 2,
        changeId: 'chg-1',
      });
      expect(result.stock).toEqual([{ orderLineId: 'l1', stockRestored: true, detail: null }]);
    });

    it('should report not-applicable when nothing was ever decremented', async () => {
      reversal.reverseLineQuantity.mockResolvedValue({ status: 'not-applicable', units: 0, detail: null });

      expect((await service.editLines(lowerL1)).stock[0].stockRestored).toBe('not-applicable');
    });

    it('should report stockRestored false with the reason when the master refuses, and still save the edit', async () => {
      reversal.reverseLineQuantity.mockResolvedValue({ status: 'failed', units: 0, detail: 'master down' });

      const result = await service.editLines(lowerL1);

      expect(result.stock[0]).toEqual({ orderLineId: 'l1', stockRestored: false, detail: 'master down' });
      expect(changes.confirm).toHaveBeenCalled();
    });

    it('should never offer a channel anything: no relay, no cancel, no refund is reachable from here', () => {
      const members = Object.getOwnPropertyNames(OrderEditService.prototype);
      expect(members.filter((name) => /relay|refund|cancelOrder|writeback/i.test(name))).toEqual([]);
    });

    it('should refuse a quantity edit of a net-priced line with no reported gross price (B-38)', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        recordWithSnapshot({
          ...channelSnapshot(),
          items: [
            { id: 'l1', productId: 'p1', quantity: 3, price: 10 },
            { id: 'l2', productId: 'p2', quantity: 1, price: 20 },
          ],
          totals: { subtotal: 50, tax: 11.5, shipping: 0, total: 61.5, currency: 'PLN', taxTreatment: 'exclusive', totalTaxTreatment: 'inclusive' },
        })
      );

      expect(await refusal(service.editLines(lowerL1))).toBe('LINE_PRICE_NOT_RESOLVABLE');
      expect(changes.openOrReuse).not.toHaveBeenCalled();
      expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
    });

    it('should accept a net-priced line when the channel reported its gross price (B-38)', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        recordWithSnapshot({
          ...channelSnapshot(),
          items: [
            { id: 'l1', productId: 'p1', quantity: 3, price: 10, unitPriceGross: 12.3 },
            { id: 'l2', productId: 'p2', quantity: 1, price: 20, unitPriceGross: 24.6 },
          ],
          totals: { subtotal: 50, tax: 11.5, shipping: 0, total: 61.5, currency: 'PLN', taxTreatment: 'exclusive', totalTaxTreatment: 'inclusive' },
        })
      );

      await service.editLines(lowerL1);

      expect(orderRecords.applyOrderEdit).toHaveBeenCalled();
    });

    it('should finish the follow-ups and confirm when a crash left the overlay written but the change open (B-30)', async () => {
      const crashed = new OrderChange(
        'chg-9', ORDER_ID, 'order.line_quantity_change', `edit:lines:${ORDER_ID}`, 'requested',
        { lines: [{ orderLineId: 'l1', to: 1, removed: 2 }] },
        'user-1', new Date(), null, null, null, null, new Date(), new Date()
      );
      orderRecords.getOrderRecord.mockResolvedValue(
        record({ orderEdits: { v: 1, rev: 1, lines: { l1: { changeId: 'chg-9', editedAt: new Date().toISOString(), editedBy: null, quantity: 1 } } } })
      );
      changes.findByOrderAndKinds.mockResolvedValue([crashed]);

      const result = await service.editLines(lowerL1);

      expect(result.changeId).toBe('chg-9');
      expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
      expect(changes.openOrReuse).not.toHaveBeenCalled();
      expect(fulfillment.lowerLineQuantity).toHaveBeenCalledWith(expect.objectContaining({ orderLineId: 'l1', newQuantity: 1 }));
      expect(reservations.narrowForOrder).toHaveBeenCalled();
      expect(reversal.reverseLineQuantity).toHaveBeenCalledWith(expect.objectContaining({ changeId: 'chg-9', units: 2 }));
      expect(changes.confirm).toHaveBeenCalledWith('chg-9', expect.any(String));
    });

    it('should still answer NOTHING_CHANGED when the quantity is already lowered and no change is open (B-30)', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        record({ orderEdits: { v: 1, rev: 1, lines: { l1: { changeId: 'chg-9', editedAt: new Date().toISOString(), editedBy: null, quantity: 1 } } } })
      );

      expect(await refusal(service.editLines(lowerL1))).toBe('NOTHING_CHANGED');
    });

    it('should refuse to raise a line', async () => {
      expect(
        await refusal(service.editLines({ ...base, lines: [{ orderLineId: 'l1', quantity: 4 }], acknowledgeAcceptedWork: false }))
      ).toBe('QUANTITY_ONLY_DECREASES');
    });

    it('should build a second edit on the first: a line already at 2 cannot be set to 3', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        record({ orderEdits: { v: 1, rev: 1, lines: { l1: { changeId: 'c0', editedAt: new Date().toISOString(), editedBy: null, quantity: 2 } } } })
      );

      expect(
        await refusal(service.editLines({ ...base, lines: [{ orderLineId: 'l1', quantity: 3 }], acknowledgeAcceptedWork: false }))
      ).toBe('QUANTITY_ONLY_DECREASES');
      await service.editLines(lowerL1);
      expect(orderRecords.applyOrderEdit.mock.calls[0][0].expectedRev).toBe(1);
    });

    it('should refuse to remove every line', async () => {
      expect(
        await refusal(
          service.editLines({
            ...base,
            lines: [{ orderLineId: 'l1', quantity: 0 }, { orderLineId: 'l2', quantity: 0 }],
            acknowledgeAcceptedWork: false,
          })
        )
      ).toBe('ORDER_WOULD_BE_EMPTY');
    });

    it('should refuse once a sales document is issued', async () => {
      invoices.getLatestInvoiceForOrder.mockResolvedValue({ blocksIssuanceElsewhere: true } as never);
      expect(await refusal(service.editLines(lowerL1))).toBe('SALES_DOCUMENT_ISSUED');

      invoices.getLatestInvoiceForOrder.mockResolvedValue(null);
      fiscal.getByOrderId.mockResolvedValue([{ blocksFurtherRegistration: true }] as never);
      expect(await refusal(service.editLines(lowerL1))).toBe('SALES_DOCUMENT_ISSUED');
    });

    it('should refuse to go below what is already picked', async () => {
      fulfillment.assessForEdit.mockResolvedValue(assessment({ fulfilledByLine: { l1: 2 } }));

      expect(await refusal(service.editLines(lowerL1))).toBe('QUANTITY_BELOW_FULFILLED');
    });

    it('should need an acknowledgement when picking has started, and accept it', async () => {
      fulfillment.assessForEdit.mockResolvedValue(
        assessment({ unrouted: false, handedOff: [{ workId: 'w1', assignedConnectionId: null, status: 'in_progress', requestStatus: 'accepted' }] })
      );
      expect(await refusal(service.editLines(lowerL1))).toBe('ORDER_WORK_ACCEPTED_NEEDS_ACK');

      await expect(service.editLines({ ...lowerL1, acknowledgeAcceptedWork: true })).resolves.toMatchObject({ dryRun: false });
    });

    it('should NOT need an acknowledgement for work OpenLinker\'s own executor auto-accepted', async () => {
      integrations.resolveAdapterMetadata.mockResolvedValue({ adapterKey: 'openlinker.oms.v1' });
      fulfillment.assessForEdit.mockResolvedValue(
        assessment({ unrouted: false, handedOff: [{ workId: 'w1', assignedConnectionId: 'oms', status: 'open', requestStatus: 'accepted' }] })
      );

      await expect(service.editLines(lowerL1)).resolves.toMatchObject({ dryRun: false });
    });

    it('should 404 an unknown line and 400 a repeated one', async () => {
      await expect(
        service.editLines({ ...base, lines: [{ orderLineId: 'nope', quantity: 0 }], acknowledgeAcceptedWork: false })
      ).rejects.toBeInstanceOf(OrderEditNotFoundError);
      await expect(
        service.editLines({
          ...base,
          lines: [{ orderLineId: 'l1', quantity: 1 }, { orderLineId: 'l1', quantity: 0 }],
          acknowledgeAcceptedWork: false,
        })
      ).rejects.toBeInstanceOf(OrderEditInvalidError);
    });

    it('should refuse a request that lowers nothing', async () => {
      expect(
        await refusal(service.editLines({ ...base, lines: [{ orderLineId: 'l1', quantity: 3 }], acknowledgeAcceptedWork: false }))
      ).toBe('NOTHING_CHANGED');
    });
  });

  describe('delivery method', () => {
    it('should refuse once a label is bought and accept a real change', async () => {
      shipments.getOutboundByOrderId.mockResolvedValue([{ status: 'dispatched' }] as never);
      const input = { ...base, methodId: 'locker', methodName: 'Locker', pickupPoint: { id: 'KRA01' } };
      expect(await refusal(service.editDeliveryMethod(input))).toBe('LABEL_ALREADY_BOUGHT');

      shipments.getOutboundByOrderId.mockResolvedValue([]);
      await service.editDeliveryMethod(input);
      expect(changes.openOrReuse).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'order.delivery_method_change', targetRef: `edit:delivery:${ORDER_ID}` })
      );
    });

    it('should refuse the method the order already has', async () => {
      expect(
        await refusal(service.editDeliveryMethod({ ...base, methodId: 'courier', methodName: null, pickupPoint: null }))
      ).toBe('NOTHING_CHANGED');
    });
  });

  describe('delivery method names', () => {
    it('should save a change of the method name alone (B-34)', async () => {
      await service.editDeliveryMethod({ ...base, methodId: 'courier', methodName: 'Courier Express', pickupPoint: null });

      expect(changes.openOrReuse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'order.delivery_method_change' }));
    });

    it('should save a change of the pickup point name alone (B-34)', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        recordWithSnapshot({ ...channelSnapshot(), pickupPoint: { id: 'LOCKER1', name: 'Old name' } })
      );

      await service.editDeliveryMethod({
        ...base,
        methodId: 'courier',
        methodName: null,
        pickupPoint: { id: 'LOCKER1', name: 'New name' },
      });

      expect(changes.openOrReuse).toHaveBeenCalled();
    });
  });

  describe('getEditsView', () => {
    it('should list only confirmed edits in the history (B-27)', async () => {
      const mk = (id: string, status: 'confirmed' | 'expired'): OrderChange =>
        new OrderChange(id, ORDER_ID, 'order.address_change', `edit:address:${ORDER_ID}`, status, null, 'user-1', new Date(), null, null, null, null, new Date(), new Date());
      changes.findByOrderAndKinds.mockResolvedValue([mk('ok', 'confirmed'), mk('abandoned', 'expired')]);

      const view = await service.getEditsView(
        record({ orderEdits: { v: 1, rev: 1, lines: { l1: { changeId: 'ok', editedAt: new Date().toISOString(), editedBy: null, quantity: 1 } } } })
      );

      expect(view?.history.map((entry) => entry.changeId)).toEqual(['ok']);
    });

    it('should report an edit whose line id the channel renamed, without throwing or restating it (line ids change)', async () => {
      const view = await service.getEditsView(
        record({ orderEdits: { v: 1, rev: 1, lines: { gone: { changeId: 'c', editedAt: '2026-10-26T10:00:00.000Z', editedBy: null, quantity: 1 } } } })
      );

      expect(view?.unmatchedLineEdits).toEqual([
        { orderLineId: 'gone', editedQuantity: 1, editedAt: '2026-10-26T10:00:00.000Z' },
      ]);
      expect(view?.lines).toEqual([]);
      expect(view?.totals?.difference).toBe(0);
    });

    it('should cost no query for an order nobody edited', async () => {
      expect(await service.getEditsView(record())).toBeNull();
      expect(changes.findByOrderAndKinds).not.toHaveBeenCalled();
    });
  });

  describe('discount (#3543)', () => {
    const discountBase = { ...base, amount: null, percent: null, acknowledgeAboveCeiling: false };
    let current: OrderRecord;

    function discountOrder(
      payment: string | null,
      overrides: Partial<OrderRecord> = {},
      snapshot: Record<string, unknown> = {}
    ): OrderRecord {
      return record({
        orderSnapshot: {
          ...channelSnapshot(),
          ...(payment !== null && { paymentStatus: payment }),
          ...snapshot,
        },
        totalAmount: 50,
        currency: 'PLN',
        ...overrides,
      });
    }

    const stored = (amount: string, changeId = 'old'): OrderRecord['orderEdits'] => ({
      v: 1,
      rev: 1,
      discount: {
        changeId,
        editedAt: '2026-10-01T00:00:00.000Z',
        editedBy: null,
        amount,
        currency: 'PLN',
        perLine: [],
      },
    });

    beforeEach(() => {
      current = discountOrder('paid');
      orderRecords.getOrderRecord.mockImplementation(() => Promise.resolve(current));
      orderRecords.applyOrderEdit.mockImplementation((input) => {
        calls.push('overlay');
        return Promise.resolve(
          Object.assign(Object.create(OrderRecord.prototype) as OrderRecord, current, {
            orderEdits: { v: 1, rev: (current.orderEdits?.rev ?? 0) + 1, discount: input.discount },
          })
        );
      });
    });

    const written = (): NonNullable<Parameters<IOrderRecordService['applyOrderEdit']>[0]['discount']> =>
      orderRecords.applyOrderEdit.mock.calls[0][0].discount as never;

    describe('split and rounding', () => {
      it('should cut the amount in proportion to each line and stamp the change id', async () => {
        await service.editDiscount({ ...discountBase, amount: '10' });

        expect(written()).toMatchObject({
          changeId: 'chg-1',
          amount: '10.00',
          currency: 'PLN',
          perLine: [
            { orderItemId: 'l1', amount: '6.00' },
            { orderItemId: 'l2', amount: '4.00' },
          ],
        });
      });

      it('should put the rounding remainder on the largest line', async () => {
        await service.editDiscount({ ...discountBase, amount: '0.01' });

        expect(written().perLine).toEqual([{ orderItemId: 'l1', amount: '0.01' }]);
      });

      it('should split exactly at a zero-decimal currency (JPY)', async () => {
        current = discountOrder('paid', { currency: 'JPY' }, {
          totals: { subtotal: 50, tax: 0, shipping: 0, total: 50, currency: 'JPY' },
        });

        await service.editDiscount({ ...discountBase, amount: '5' });

        expect(written()).toMatchObject({
          amount: '5',
          currency: 'JPY',
          perLine: [
            { orderItemId: 'l1', amount: '3' },
            { orderItemId: 'l2', amount: '2' },
          ],
        });
        await expect(service.editDiscount({ ...discountBase, amount: '5.5' })).rejects.toBeInstanceOf(
          OrderEditInvalidError
        );
      });

      it('should split exactly at a three-decimal currency (KWD)', async () => {
        current = discountOrder('paid', { currency: 'KWD' }, {
          totals: { subtotal: 50, tax: 0, shipping: 0, total: 50, currency: 'KWD' },
        });

        await service.editDiscount({ ...discountBase, amount: '0.001' });

        expect(written()).toMatchObject({
          amount: '0.001',
          perLine: [{ orderItemId: 'l1', amount: '0.001' }],
        });
        await expect(service.editDiscount({ ...discountBase, amount: '1.2345' })).rejects.toBeInstanceOf(
          OrderEditInvalidError
        );
      });

      it('should resolve a percent of the goods value to an amount at the minor unit', async () => {
        await service.editDiscount({ ...discountBase, percent: 10 });

        expect(written().amount).toBe('5.00');
      });

      it('should refuse both, neither and out-of-range inputs as invalid', async () => {
        await expect(
          service.editDiscount({ ...discountBase, amount: '1', percent: 1 })
        ).rejects.toBeInstanceOf(OrderEditInvalidError);
        await expect(service.editDiscount(discountBase)).rejects.toBeInstanceOf(OrderEditInvalidError);
        await expect(service.editDiscount({ ...discountBase, percent: 101 })).rejects.toBeInstanceOf(
          OrderEditInvalidError
        );
        await expect(service.editDiscount({ ...discountBase, amount: '-3' })).rejects.toBeInstanceOf(
          OrderEditInvalidError
        );
      });

      it('should refuse a discount that is the whole total or more', async () => {
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '50' }))).toBe(
          'DISCOUNT_EXCEEDS_TOTAL'
        );
        expect(await refusal(service.editDiscount({ ...discountBase, percent: 100 }))).toBe(
          'DISCOUNT_EXCEEDS_TOTAL'
        );
        expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
      });
    });

    describe('one discount per order', () => {
      it('should REPLACE the current discount rather than stack on it', async () => {
        current = discountOrder('awaiting', { orderEdits: stored('5.00') });

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.view.totals).toMatchObject({ channelTotal: 50, total: 40, difference: 10 });
        expect(result.discount?.discount?.amount).toBe('10.00');
        expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
      });

      it('should remove the discount when the amount is 0 and read the channel total again', async () => {
        current = discountOrder('awaiting', { orderEdits: stored('5.00') });

        const result = await service.editDiscount({ ...discountBase, amount: '0' });

        expect(written().amount).toBe('0.00');
        expect(result.discount?.discount).toBeNull();
        expect(result.view.totals).toMatchObject({ channelTotal: 50, total: 50 });
      });

      it('should answer NOTHING_CHANGED for the same amount when no proposal is missing, and for removing none', async () => {
        current = discountOrder('awaiting', { orderEdits: stored('5.00') });
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '5' }))).toBe('NOTHING_CHANGED');

        current = discountOrder('awaiting');
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '0' }))).toBe('NOTHING_CHANGED');
      });

      it('should refuse lowering a quantity that would leave the discount larger than the goods', async () => {
        current = discountOrder('awaiting', { orderEdits: stored('40.00') });

        expect(
          await refusal(
            service.editLines({
              ...base,
              lines: [{ orderLineId: 'l1', quantity: 0 }],
              acknowledgeAcceptedWork: false,
            })
          )
        ).toBe('DISCOUNT_EXCEEDS_TOTAL');
      });
    });

    describe('gates', () => {
      it.each([
        ['ORDER_ALREADY_CANCELLED', () => discountOrder('paid', { cancelledAt: new Date() })],
        ['ORDER_PACKED', () => discountOrder('paid', { packedAt: new Date() })],
        ['ORDER_NOT_READY', () => discountOrder('paid', { recordStatus: 'awaiting_mapping' })],
        ['ORDER_AMENDMENT_IN_FLIGHT', () => discountOrder('paid', { activeHoldReason: 'awaiting-amendment' })],
      ] as const)('should refuse with %s and write nothing', async (code, make) => {
        current = make();

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '5' }))).toBe(code);
        expect(changes.openOrReuse).not.toHaveBeenCalled();
      });

      it('should refuse when another edit holds the lock', async () => {
        lock.acquire.mockResolvedValue(null);

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '5' }))).toBe('ORDER_EDIT_CONTENDED');
      });

      it('should allow a discount after a document is issued instead of refusing it', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(issuedInvoice() as never);

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(result.discount?.correctionProposal).not.toBeNull();
      });
    });

    describe('after shipping and refund floor', () => {
      it('should open a refund intent for a shipped paid order instead of refusing it (discount after shipping)', async () => {
        current = discountOrder('paid', { fulfillmentState: 'dispatched', packedAt: new Date() });

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(result.discount?.paymentBranch).toBe('paid');
        expect(result.discount?.refundIntent).toMatchObject({ amount: '10.00' });
      });

      it('should refuse a discount on a shipped unpaid COD order (label carries the old amount)', async () => {
        current = discountOrder('cod', { fulfillmentState: 'dispatched' }, {
          codToCollect: { amount: '50.00', currency: 'PLN' },
        });

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe('LABEL_ALREADY_BOUGHT');
      });

      it('should not treat a refunded cash-on-delivery order as COD (B-32)', async () => {
        current = discountOrder('refunded', { paymentMethod: 'cash_on_delivery' });

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.discount?.paymentBranch).toBe('unknown');
        expect(result.discount?.refundIntent).toBeNull();
      });

      it('should refuse lowering a discount below a confirmed refund (B-33)', async () => {
        current = discountOrder('paid', { orderEdits: stored('20.00') });
        changes.findByOrderAndKinds.mockResolvedValue([
          { kind: 'order.discount_refund', status: 'confirmed', payload: { amount: '20.00' } },
        ] as never);

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe('DISCOUNT_BELOW_REFUNDED');
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '0' }))).toBe('DISCOUNT_BELOW_REFUNDED');
      });

      it('should still allow lowering a discount whose refund is not confirmed (B-33)', async () => {
        current = discountOrder('paid', { orderEdits: stored('20.00') });
        changes.findByOrderAndKinds.mockResolvedValue([
          { kind: 'order.discount_refund', status: 'requested', payload: { amount: '20.00' } },
        ] as never);

        await expect(service.editDiscount({ ...discountBase, amount: '10', dryRun: true })).resolves.toBeDefined();
      });
    });

    describe('unpaid and cash on delivery', () => {
      it('should lower the amount to collect and open no refund intent when awaiting payment', async () => {
        current = discountOrder('awaiting');

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(result.discount).toMatchObject({
          paymentBranch: 'unpaid',
          amountToCollect: { amount: '40.00', currency: 'PLN' },
          refundIntent: null,
        });
        expect(changes.openOrReuse).toHaveBeenCalledTimes(1);
      });

      it('should restate the COD amount and refuse once a label with the old amount is bought', async () => {
        current = discountOrder('cod', {}, { codToCollect: { amount: '50.00', currency: 'PLN' } });

        const result = await service.editDiscount({ ...discountBase, amount: '10' });
        expect(result.discount).toMatchObject({
          paymentBranch: 'cod',
          amountToCollect: { amount: '40.00', currency: 'PLN' },
          refundIntent: null,
        });

        shipments.getOutboundByOrderId.mockResolvedValue([{ status: 'generated' }] as never);
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '11' }))).toBe('LABEL_ALREADY_BOUGHT');
      });

      it('should read a cash-on-delivery payment method on an unpaid order as COD', async () => {
        current = discountOrder('awaiting', { paymentMethod: 'cash_on_delivery' });

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.discount?.paymentBranch).toBe('cod');
      });

      it('should never open a refund intent when payment is unknown', async () => {
        current = discountOrder(null);

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(result.discount).toMatchObject({ paymentBranch: 'unknown', amountToCollect: null, refundIntent: null });
        expect(changes.openOrReuse).toHaveBeenCalledTimes(1);
      });
    });

    describe('paid order: refund intent', () => {
      it('should open the intent AFTER the overlay, keyed on the discount change, with the intent payload', async () => {
        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(calls).toEqual(['open', 'overlay', 'open', 'confirm']);
        expect(changes.openOrReuse).toHaveBeenLastCalledWith(
          expect.objectContaining({
            kind: 'order.discount_refund',
            targetRef: `refund:discount:${ORDER_ID}:chg-1`,
            payload: {
              amount: '10.00',
              currency: 'PLN',
              reason: 'other',
              note: 'Discount granted in OpenLinker',
            },
          })
        );
        expect(result.discount?.refundIntent).toMatchObject({
          changeId: 'chg-1',
          amount: '10.00',
          ceiling: { status: 'within', ceiling: '50.00', alreadyRefunded: '0.00', requested: '10.00' },
        });
        expect(result.discount?.amountToCollect).toBeNull();
      });

      it('should refuse above the refund ceiling and write nothing', async () => {
        refunds.getRefundSummariesForOrders.mockResolvedValue(
          new Map([[ORDER_ID, { count: 1, totalAmount: '45.00', currency: 'PLN' }]])
        );

        await expect(service.editDiscount({ ...discountBase, amount: '10' })).rejects.toBeInstanceOf(
          RefundCeilingExceededException
        );
        expect(changes.openOrReuse).not.toHaveBeenCalled();
        expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
      });

      it('should let an acknowledged excess through and report the verdict as exceeded', async () => {
        refunds.getRefundSummariesForOrders.mockResolvedValue(
          new Map([[ORDER_ID, { count: 1, totalAmount: '45.00', currency: 'PLN' }]])
        );

        const result = await service.editDiscount({
          ...discountBase,
          amount: '10',
          acknowledgeAboveCeiling: true,
        });

        expect(result.discount?.refundIntent?.ceiling.status).toBe('exceeded');
      });

      it('should proceed on an unknown ceiling and say so', async () => {
        current = discountOrder('paid', { totalAmount: null });

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(result.discount?.refundIntent?.ceiling).toEqual({ status: 'unknown', reason: 'order-total-unknown' });
      });

      it('should refund only the part not already refunded by a confirmed intent', async () => {
        current = discountOrder('paid', { orderEdits: stored('5.00') });
        changes.findByOrderAndKinds.mockImplementation((_id, kinds) =>
          Promise.resolve(
            kinds[0] === 'order.discount_refund'
              ? [
                  Object.assign(Object.create(OrderChange.prototype) as OrderChange, {
                    kind: 'order.discount_refund',
                    status: 'confirmed',
                    payload: { amount: '5.00' },
                  }),
                ]
              : []
          )
        );

        const result = await service.editDiscount({ ...discountBase, amount: '8' });

        expect(result.discount?.refundIntent?.amount).toBe('3.00');
      });

      it('should open no intent when the discount is lowered or removed', async () => {
        current = discountOrder('paid', { orderEdits: stored('5.00') });

        const result = await service.editDiscount({ ...discountBase, amount: '0' });

        expect(result.discount?.refundIntent).toBeNull();
        expect(changes.openOrReuse).toHaveBeenCalledTimes(1);
      });

      it('should retire the open proposals of the discount it replaces before opening new ones', async () => {
        current = discountOrder('paid', { orderEdits: stored('5.00') });
        changes.findOpenByOrder.mockResolvedValue([
          Object.assign(Object.create(OrderChange.prototype) as OrderChange, {
            id: 'old-intent',
            kind: 'order.discount_refund',
          }),
        ]);

        await service.editDiscount({ ...discountBase, amount: '8' });

        expect(changes.abandon).toHaveBeenCalledWith('old-intent');
      });

      it('should keep the discount and report the failure when the intent cannot be opened', async () => {
        changes.openOrReuse
          .mockResolvedValueOnce({ change, opened: true, expiredStale: false })
          .mockRejectedValueOnce(new Error('db down'));

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(result.discount).toMatchObject({ refundIntentFailed: true, refundIntent: null });
        expect(changes.confirm).toHaveBeenCalledWith('chg-1', 'operator:user-1');
      });

      it('should re-open a lost refund intent on a same-amount resubmit without touching the overlay', async () => {
        current = discountOrder('paid', { orderEdits: stored('10.00', 'd1') });

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
        expect(changes.confirm).not.toHaveBeenCalled();
        expect(changes.abandon).not.toHaveBeenCalled();
        expect(changes.openOrReuse).toHaveBeenCalledTimes(1);
        expect(changes.openOrReuse).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'order.discount_refund',
            targetRef: `refund:discount:${ORDER_ID}:d1`,
            payload: expect.objectContaining({ amount: '10.00' }),
          })
        );
        expect(result.discount?.refundIntent).toMatchObject({ amount: '10.00' });
      });

      it('should answer NOTHING_CHANGED for the same amount when the intent is already open', async () => {
        current = discountOrder('paid', { orderEdits: stored('10.00', 'd1') });
        changes.findOpenByOrder.mockResolvedValue([
          Object.assign(Object.create(OrderChange.prototype) as OrderChange, {
            id: 'intent',
            kind: 'order.discount_refund',
          }),
        ]);

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe('NOTHING_CHANGED');
        expect(changes.openOrReuse).not.toHaveBeenCalled();
      });

      it('should answer NOTHING_CHANGED once a confirmed intent covers the whole discount', async () => {
        current = discountOrder('paid', { orderEdits: stored('10.00', 'd1') });
        changes.findByOrderAndKinds.mockImplementation((_id, kinds) =>
          Promise.resolve(
            kinds[0] === 'order.discount_refund'
              ? [
                  Object.assign(Object.create(OrderChange.prototype) as OrderChange, {
                    kind: 'order.discount_refund',
                    status: 'confirmed',
                    payload: { amount: '10.00' },
                  }),
                ]
              : []
          )
        );

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe('NOTHING_CHANGED');
      });

      it('should return the intent without saving anything on a dry run', async () => {
        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.changeId).toBeNull();
        expect(result.discount?.refundIntent).toMatchObject({ changeId: null, amount: '10.00' });
        expect(changes.openOrReuse).not.toHaveBeenCalled();
      });
    });

    describe('issued documents', () => {
      it('should propose price corrections from the channel lines under a per-invoice key', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(issuedInvoice() as never);

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(changes.openOrReuse).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'order.discount_correction',
            targetRef: `correction:discount:${ORDER_ID}:inv-1`,
          })
        );
        expect(result.discount?.correctionProposal).toMatchObject({
          invoiceRecordId: 'inv-1',
          lines: [
            { originalLineNumber: 1, previousUnitPriceGross: 10, newUnitPriceGross: 8 },
            { originalLineNumber: 2, previousUnitPriceGross: 20, newUnitPriceGross: 16 },
          ],
        });
      });

      it('should restore the channel price on a removed discount, whatever the document says now', async () => {
        current = discountOrder('awaiting', { orderEdits: stored('10.00') });
        invoices.getLatestInvoiceForOrder.mockResolvedValue(
          issuedInvoice({ unitPrices: [8, 16] }) as never
        );

        const result = await service.editDiscount({ ...discountBase, amount: '0' });

        expect(result.discount?.correctionProposal?.lines).toEqual([
          expect.objectContaining({ originalLineNumber: 1, newUnitPriceGross: 10 }),
          expect.objectContaining({ originalLineNumber: 2, newUnitPriceGross: 20 }),
        ]);
      });

      it('should re-open a lost correction proposal on a same-amount resubmit, and not when one is open', async () => {
        current = discountOrder('awaiting', { orderEdits: stored('10.00', 'd1') });
        invoices.getLatestInvoiceForOrder.mockResolvedValue(issuedInvoice() as never);

        const result = await service.editDiscount({ ...discountBase, amount: '10' });

        expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
        expect(changes.openOrReuse).toHaveBeenCalledTimes(1);
        expect(changes.openOrReuse).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'order.discount_correction' })
        );
        expect(result.discount?.correctionProposal).not.toBeNull();

        changes.openOrReuse.mockClear();
        changes.findOpenByOrder.mockResolvedValue([
          Object.assign(Object.create(OrderChange.prototype) as OrderChange, {
            id: 'corr',
            kind: 'order.discount_correction',
            payload: { invoiceRecordId: 'inv-1' },
          }),
        ]);
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe('NOTHING_CHANGED');
      });

      it('should skip a document line whose price already equals the target', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(
          issuedInvoice({ unitPrices: [8, 20] }) as never
        );

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.discount?.correctionProposal?.lines).toHaveLength(1);
      });

      it('should match a document issued before lines carried their id by position and product', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(issuedInvoice({ withLineIds: false }) as never);

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.discount?.correctionProposal?.lines).toHaveLength(2);
      });

      it('should report unmatched-lines instead of guessing which document line is which', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(
          issuedInvoice({ withLineIds: false, productIds: ['x', 'y'] }) as never
        );

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.discount).toMatchObject({
          correctionProposal: null,
          correctionUnavailableReason: 'unmatched-lines',
        });
      });

      it('should refuse while the invoice has not finished issuing', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(issuedInvoice({ status: 'pending' }) as never);

        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe('INVOICE_NOT_SETTLED');
      });

      it('should report a pre-snapshot document as unavailable', async () => {
        invoices.getLatestInvoiceForOrder.mockResolvedValue(issuedInvoice({ snapshot: false }) as never);

        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });

        expect(result.discount?.correctionUnavailableReason).toBe('no-line-snapshot');
      });

      it('should refuse a paid order that has a fiscal receipt and allow an unpaid one without a proposal', async () => {
        fiscal.getByOrderId.mockResolvedValue([{ blocksFurtherRegistration: true }] as never);
        expect(await refusal(service.editDiscount({ ...discountBase, amount: '10' }))).toBe(
          'ORDER_HAS_FISCAL_RECEIPT'
        );

        current = discountOrder('awaiting');
        const result = await service.editDiscount({ ...discountBase, amount: '10', dryRun: true });
        expect(result.discount).toMatchObject({
          correctionProposal: null,
          correctionUnavailableReason: 'fiscal-receipt',
        });
      });
    });
  });
});
