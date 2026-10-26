/**
 * Order Edit Service Tests (#3542)
 *
 * Every refusal is a code an operator reads, so each one is asserted by code. The
 * orchestration is asserted by ORDER: gates, change row, overlay write, only then
 * the follow-ups, and never any call that could tell a channel.
 *
 * @module apps/api/src/orders/application/services
 */
import { OrderChange, OrderRecord, type IOrderChangeService, type IOrderRecordService } from '@openlinker/core/orders';
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
      lock as unknown as SyncLockPort
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

  describe('getEditsView', () => {
    it('should cost no query for an order nobody edited', async () => {
      expect(await service.getEditsView(record())).toBeNull();
      expect(changes.findByOrderAndKinds).not.toHaveBeenCalled();
    });
  });
});
