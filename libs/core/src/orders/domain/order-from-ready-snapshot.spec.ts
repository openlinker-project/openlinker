/**
 * orderFromReadySnapshot unit tests (#1119)
 *
 * A `ready` snapshot round-trips (ISO date strings -> Date), a PII-redacted
 * snapshot throws `OrderSnapshotUnavailableError`, and an `awaiting_mapping`
 * record is rejected.
 *
 * @module libs/core/src/orders/domain
 */
import { orderFromReadySnapshot } from './order-from-ready-snapshot';
import { OrderSnapshotUnavailableError } from './exceptions/order-snapshot-unavailable.error';
import { OrderRecord } from './entities/order-record.entity';
import type { OrderRecordStatus } from './types/order-record.types';

const NOW = new Date('2026-06-23T10:00:00.000Z');

function makeRecord(
  snapshot: Record<string, unknown>,
  recordStatus: OrderRecordStatus = 'ready',
): OrderRecord {
  return new OrderRecord(
    'ol_order_1',
    'cust_1',
    'conn_1',
    null,
    snapshot,
    [],
    recordStatus,
    NOW,
    NOW,
  );
}

const READY_SNAPSHOT: Record<string, unknown> = {
  id: 'ol_order_1',
  orderNumber: 'A-100',
  status: 'processing',
  customerId: 'cust_1',
  items: [
    { id: 'li_1', productId: 'p_1', variantId: 'v_1', quantity: 2, price: 49.99, sku: 'SKU-1', name: 'Widget' },
  ],
  totals: { subtotal: 99.98, tax: 0, shipping: 0, total: 99.98, currency: 'PLN', taxTreatment: 'inclusive' },
  billingAddress: {
    firstName: 'Jan',
    lastName: 'Kowalski',
    address1: 'ul. Testowa 1',
    city: 'Poznań',
    postalCode: '61-001',
    country: 'PL',
  },
  createdAt: '2026-06-20T08:00:00.000Z',
  updatedAt: '2026-06-21T09:30:00.000Z',
};

describe('orderFromReadySnapshot', () => {
  it('is defined', () => {
    expect(orderFromReadySnapshot).toBeInstanceOf(Function);
    expect(OrderSnapshotUnavailableError).toBeInstanceOf(Function);
  });

  it('round-trips a ready snapshot, rehydrating ISO date strings to Date', () => {
    const order = orderFromReadySnapshot(makeRecord(READY_SNAPSHOT));

    expect(order.id).toBe('ol_order_1');
    expect(order.orderNumber).toBe('A-100');
    expect(order.status).toBe('processing');
    expect(order.customerId).toBe('cust_1');
    expect(order.totals).toEqual({
      subtotal: 99.98,
      tax: 0,
      shipping: 0,
      total: 99.98,
      currency: 'PLN',
      taxTreatment: 'inclusive',
    });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toEqual({
      id: 'li_1',
      productId: 'p_1',
      variantId: 'v_1',
      quantity: 2,
      price: 49.99,
      sku: 'SKU-1',
      name: 'Widget',
    });
    expect(order.billingAddress?.lastName).toBe('Kowalski');
    // ISO strings rehydrated to Date.
    expect(order.createdAt).toBeInstanceOf(Date);
    expect(order.createdAt.toISOString()).toBe('2026-06-20T08:00:00.000Z');
    expect(order.updatedAt.toISOString()).toBe('2026-06-21T09:30:00.000Z');
  });

  it('rehydrates placedAt from the snapshot when present (P_6 source, #1525)', () => {
    const order = orderFromReadySnapshot(
      makeRecord({ ...READY_SNAPSHOT, placedAt: '2026-06-19T14:30:00.000Z' }),
    );

    expect(order.placedAt).toBeInstanceOf(Date);
    expect(order.placedAt?.toISOString()).toBe('2026-06-19T14:30:00.000Z');
  });

  it('leaves placedAt undefined when the snapshot has none (no fallback substitution)', () => {
    const order = orderFromReadySnapshot(makeRecord(READY_SNAPSHOT));
    expect(order.placedAt).toBeUndefined();
  });

  it('leaves placedAt undefined when the snapshot value is not a parseable date string', () => {
    const order = orderFromReadySnapshot(
      makeRecord({ ...READY_SNAPSHOT, placedAt: 'not-a-date' }),
    );
    expect(order.placedAt).toBeUndefined();
  });

  it('falls back to shipping address when billing is absent', () => {
    const { billingAddress: _omit, ...rest } = READY_SNAPSHOT;
    void _omit;
    const order = orderFromReadySnapshot(
      makeRecord({
        ...rest,
        shippingAddress: {
          firstName: 'Anna',
          lastName: 'Nowak',
          address1: 'ul. Inna 2',
          city: 'Kraków',
          postalCode: '30-001',
          country: 'PL',
        },
      }),
    );
    expect(order.billingAddress).toBeUndefined();
    expect(order.shippingAddress?.city).toBe('Kraków');
  });

  it('throws OrderSnapshotUnavailableError when the buyer address is [REDACTED]', () => {
    const redacted = makeRecord({
      ...READY_SNAPSHOT,
      billingAddress: {
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'PL',
      },
      shippingAddress: undefined,
    });
    expect(() => orderFromReadySnapshot(redacted)).toThrow(OrderSnapshotUnavailableError);
  });

  it('throws OrderSnapshotUnavailableError when no buyer address is present at all', () => {
    const { billingAddress: _omit, ...rest } = READY_SNAPSHOT;
    void _omit;
    expect(() => orderFromReadySnapshot(makeRecord(rest))).toThrow(OrderSnapshotUnavailableError);
  });

  it('rejects an awaiting_mapping record (snapshot is a raw IncomingOrder, not an Order)', () => {
    expect(() => orderFromReadySnapshot(makeRecord(READY_SNAPSHOT, 'awaiting_mapping'))).toThrow(
      OrderSnapshotUnavailableError,
    );
  });

  it('PII-clean error cites only the order id, never snapshot contents', () => {
    const { billingAddress: _omit, ...rest } = READY_SNAPSHOT;
    void _omit;
    try {
      orderFromReadySnapshot(makeRecord(rest));
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OrderSnapshotUnavailableError);
      const message = (error as OrderSnapshotUnavailableError).message;
      expect(message).toContain('ol_order_1');
      expect(message).not.toContain('Kowalski');
    }
  });
});
