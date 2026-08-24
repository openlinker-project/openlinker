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

  it('rehydrates placedAt from a Date instance too (same string|Date acceptance as createdAt/updatedAt)', () => {
    const order = orderFromReadySnapshot(
      makeRecord({ ...READY_SNAPSHOT, placedAt: new Date('2026-06-19T14:30:00.000Z') }),
    );

    expect(order.placedAt).toBeInstanceOf(Date);
    expect(order.placedAt?.toISOString()).toBe('2026-06-19T14:30:00.000Z');
  });

  it('rehydrates customerEmail from the snapshot when present (#1797)', () => {
    const order = orderFromReadySnapshot(
      makeRecord({ ...READY_SNAPSHOT, customerEmail: 'buyer@example.com' }),
    );
    expect(order.customerEmail).toBe('buyer@example.com');
  });

  it('leaves customerEmail undefined when the snapshot has none (#1797)', () => {
    const order = orderFromReadySnapshot(makeRecord(READY_SNAPSHOT));
    expect(order.customerEmail).toBeUndefined();
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

  describe('requireBuyer: false (#1908)', () => {
    // The buyer gate is an INVOICING rule. A caller composing a document that
    // names no buyer - a fiscal registration - must still be able to read the
    // sale under `OL_STORE_PII=false`, where every address is `[REDACTED]`.
    const redactedSnapshot = {
      ...READY_SNAPSHOT,
      billingAddress: {
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'PL',
      },
      shippingAddress: undefined,
    };

    it('rehydrates a fully-redacted snapshot instead of refusing it', () => {
      const order = orderFromReadySnapshot(makeRecord(redactedSnapshot), {
        requireBuyer: false,
      });
      expect(order.id).toBe('ol_order_1');
      expect(order.items).toHaveLength(1);
      expect(order.totals.total).toBe(99.98);
    });

    it('rehydrates a snapshot with no address at all', () => {
      const { billingAddress: _omit, ...rest } = READY_SNAPSHOT;
      void _omit;
      expect(() =>
        orderFromReadySnapshot(makeRecord(rest), { requireBuyer: false }),
      ).not.toThrow();
    });

    it('still refuses a record that is not `ready` - the opt-out is only about the BUYER', () => {
      expect(() =>
        orderFromReadySnapshot(makeRecord(READY_SNAPSHOT, 'awaiting_mapping'), {
          requireBuyer: false,
        }),
      ).toThrow(OrderSnapshotUnavailableError);
    });

    it('keeps the gate on by default, so invoicing is untouched', () => {
      expect(() => orderFromReadySnapshot(makeRecord(redactedSnapshot))).toThrow(
        OrderSnapshotUnavailableError,
      );
      expect(() => orderFromReadySnapshot(makeRecord(redactedSnapshot), {})).toThrow(
        OrderSnapshotUnavailableError,
      );
    });
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

  // #2248 regression. `readItems` is an allowlist, so a field it does not name
  // is silently dropped - and every MANUAL issuance path rehydrates through it.
  // Omitting the tax fields made a correctly rated order arrive at the mapper
  // with no rate and be refused by the missing-rate gate, pointing the operator
  // at a product that was already configured. The auto-issue path composes from
  // the live `Order` and never touches this function, which is why nothing else
  // covered it.
  it('carries the per-line tax rate, its source and its read time through (#2248)', () => {
    const record = makeRecord({
      ...READY_SNAPSHOT,
      items: [
        {
          id: 'li_1',
          productId: 'p_1',
          quantity: 1,
          price: 42,
          taxRate: '5',
          taxRateCountry: 'PL',
          taxSource: 'shop',
          taxRateReadAt: '2026-08-19T10:00:00.000Z',
          taxRateChannel: '23',
        },
      ],
    });

    const item = orderFromReadySnapshot(record).items[0];

    expect(item.taxRate).toBe('5');
    expect(item.taxRateCountry).toBe('PL');
    expect(item.taxSource).toBe('shop');
    expect(item.taxRateReadAt).toBe('2026-08-19T10:00:00.000Z');
    expect(item.taxRateChannel).toBe('23');
  });

  it('drops a taxSource outside the union rather than passing it through', () => {
    const record = makeRecord({
      ...READY_SNAPSHOT,
      items: [{ id: 'li_1', productId: 'p_1', quantity: 1, price: 42, taxSource: 'guessed' }],
    });

    expect(orderFromReadySnapshot(record).items[0].taxSource).toBeUndefined();
  });

  it('round-trips the backfill provenance (#2440) — never confused with a live shop/channel read', () => {
    const record = makeRecord({
      ...READY_SNAPSHOT,
      items: [{ id: 'li_1', productId: 'p_1', quantity: 1, price: 42, taxSource: 'backfill' }],
    });

    expect(orderFromReadySnapshot(record).items[0].taxSource).toBe('backfill');
  });
});
