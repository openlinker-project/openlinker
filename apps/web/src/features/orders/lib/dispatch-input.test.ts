/**
 * dispatch-input tests (#1109)
 *
 * Covers the risk-bearing pure logic: the bulk eligibility classifier, the
 * shared payload builder, and the per-source cap / grouping helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDispatchItem,
  capSelectionPerSource,
  classifyDispatchEligibility,
  groupBy,
  resolveShippingMethod,
  sourcesAtCap,
} from './dispatch-input';
import { parseOrderSnapshot } from '../api/order-snapshot.schema';
import type { OrderRecord } from '../api/orders.types';

function order(overrides: Partial<OrderRecord> & { snapshot?: Record<string, unknown> }): OrderRecord {
  const { snapshot, ...rest } = overrides;
  return {
    internalOrderId: 'ol_order_1',
    customerId: null,
    sourceConnectionId: 'conn_a',
    sourceEventId: null,
    orderSnapshot: snapshot ?? {},
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as OrderRecord;
}

/** A snapshot complete enough for a courier dispatch (email + phone + address). */
const COURIER_SNAPSHOT = {
  customerEmail: 'buyer@example.com',
  shipping: { methodId: 'dpd-courier', methodName: 'DPD Kurier' },
  shippingAddress: {
    firstName: 'Anna',
    lastName: 'Nowak',
    address1: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
    phone: '+48500600700',
  },
};

/** A locker snapshot with a resolved buyer pickup point. Carries a full buyer
 * address too (locker orders still include it) — phone lives in the address
 * sub-tree, which only survives parsing when the address is complete. */
const PACZKOMAT_SNAPSHOT = {
  customerEmail: 'buyer@example.com',
  shipping: { methodId: 'inpost-locker', methodName: 'InPost Paczkomat' },
  shippingAddress: {
    firstName: 'Jan',
    lastName: 'Kowalski',
    address1: 'ul. Locker 2',
    city: 'Poznań',
    postalCode: '60-001',
    country: 'PL',
    phone: '+48500600700',
  },
  pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A' },
};

describe('resolveShippingMethod', () => {
  it('resolves paczkomat when a pickup point is present', () => {
    expect(resolveShippingMethod(parseOrderSnapshot(PACZKOMAT_SNAPSHOT))).toBe('paczkomat');
  });
  it('resolves kurier for a courier method', () => {
    expect(resolveShippingMethod(parseOrderSnapshot(COURIER_SNAPSHOT))).toBe('kurier');
  });
});

describe('classifyDispatchEligibility', () => {
  it('is eligible for a complete courier order', () => {
    const result = classifyDispatchEligibility(order({ snapshot: COURIER_SNAPSHOT }));
    expect(result.eligible).toBe(true);
    expect(result.shippingMethod).toBe('kurier');
  });

  it('is eligible for a paczkomat order with a resolved pickup point', () => {
    const result = classifyDispatchEligibility(order({ snapshot: PACZKOMAT_SNAPSHOT }));
    expect(result.eligible).toBe(true);
    expect(result.paczkomatId).toBe('POZ08A');
  });

  it('excludes COD orders (need a per-order amount)', () => {
    const result = classifyDispatchEligibility(
      order({ snapshot: { ...COURIER_SNAPSHOT, paymentStatus: 'cod' } }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('cod');
  });

  it('excludes payment-blocked orders (awaiting / refunded)', () => {
    expect(
      classifyDispatchEligibility(order({ snapshot: { ...COURIER_SNAPSHOT, paymentStatus: 'awaiting' } }))
        .reason,
    ).toBe('payment-blocked');
    expect(
      classifyDispatchEligibility(order({ snapshot: { ...COURIER_SNAPSHOT, paymentStatus: 'refunded' } }))
        .reason,
    ).toBe('payment-blocked');
  });

  it('excludes a paczkomat order whose buyer locker is unresolved', () => {
    const snapshot = { ...PACZKOMAT_SNAPSHOT, pickupPoint: undefined };
    const result = classifyDispatchEligibility(order({ snapshot }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('needs-paczkomat');
  });

  it('excludes a courier order missing recipient fields', () => {
    const snapshot = { ...COURIER_SNAPSHOT, shippingAddress: { phone: '+48500600700' } };
    const result = classifyDispatchEligibility(order({ snapshot }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('missing-recipient');
  });

  it('excludes already-shipped orders', () => {
    expect(
      classifyDispatchEligibility(order({ snapshot: COURIER_SNAPSHOT, fulfillmentState: 'dispatched' }))
        .reason,
    ).toBe('already-shipped');
    expect(
      classifyDispatchEligibility(order({ snapshot: COURIER_SNAPSHOT, fulfillmentState: 'delivered' }))
        .reason,
    ).toBe('already-shipped');
  });

  it('excludes orders not yet ready (awaiting mapping)', () => {
    const result = classifyDispatchEligibility(
      order({ snapshot: COURIER_SNAPSHOT, recordStatus: 'awaiting_mapping' }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not-ready');
  });
});

describe('buildDispatchItem', () => {
  it('builds a courier payload with the recipient address', () => {
    const o = order({ snapshot: COURIER_SNAPSHOT });
    const item = buildDispatchItem({
      order: o,
      snapshot: parseOrderSnapshot(COURIER_SNAPSHOT),
      shippingMethod: 'kurier',
      parcel: { length: 300, width: 200, height: 100, weightGrams: 500 },
    });
    expect(item.deliveryIntent).toBe('address');
    expect(item.orderId).toBe('ol_order_1');
    expect(item.recipient.address?.city).toBe('Warszawa');
    expect(item.recipient.address?.countryCode).toBe('PL');
    expect(item.parcel.dimensions).toEqual({ length: 300, width: 200, height: 100 });
  });

  it('builds a paczkomat payload with no address and the pickup-point id', () => {
    const item = buildDispatchItem({
      order: order({ snapshot: PACZKOMAT_SNAPSHOT }),
      snapshot: parseOrderSnapshot(PACZKOMAT_SNAPSHOT),
      shippingMethod: 'paczkomat',
      parcel: { length: 300, width: 200, height: 100, weightGrams: 500 },
      paczkomatId: 'POZ08A',
    });
    expect(item.deliveryIntent).toBe('pickup_point');
    expect(item.paczkomatId).toBe('POZ08A');
    expect(item.recipient.address).toBeUndefined();
  });

  it('normalises a comma decimal in the COD amount', () => {
    const item = buildDispatchItem({
      order: order({ snapshot: COURIER_SNAPSHOT }),
      snapshot: parseOrderSnapshot(COURIER_SNAPSHOT),
      shippingMethod: 'kurier',
      parcel: { length: 1, width: 1, height: 1, weightGrams: 1 },
      cod: { amount: '129,90', currency: 'PLN' },
    });
    expect(item.cod).toEqual({ amount: '129.90', currency: 'PLN' });
  });
});

describe('groupBy', () => {
  it('groups items preserving insertion order', () => {
    const grouped = groupBy(
      [
        { id: 'a', k: 1 },
        { id: 'b', k: 2 },
        { id: 'c', k: 1 },
      ],
      (x) => x.k,
    );
    expect([...grouped.keys()]).toEqual([1, 2]);
    expect(grouped.get(1)?.map((x) => x.id)).toEqual(['a', 'c']);
  });
});

describe('capSelectionPerSource', () => {
  it('caps each source independently, preserving order', () => {
    const orders = [
      { sourceConnectionId: 'a', id: 1 },
      { sourceConnectionId: 'a', id: 2 },
      { sourceConnectionId: 'a', id: 3 },
      { sourceConnectionId: 'b', id: 4 },
      { sourceConnectionId: 'b', id: 5 },
    ];
    const capped = capSelectionPerSource(orders, 2);
    expect(capped.map((o) => o.id)).toEqual([1, 2, 4, 5]);
  });

  it('keeps everything when under the cap', () => {
    const orders = [
      { sourceConnectionId: 'a', id: 1 },
      { sourceConnectionId: 'b', id: 2 },
    ];
    expect(capSelectionPerSource(orders, 25)).toHaveLength(2);
  });
});

describe('sourcesAtCap', () => {
  it('flags only sources that reached the cap', () => {
    const orders = [
      { sourceConnectionId: 'a' },
      { sourceConnectionId: 'a' },
      { sourceConnectionId: 'b' },
    ];
    const atCap = sourcesAtCap(orders, 2);
    expect(atCap.has('a')).toBe(true);
    expect(atCap.has('b')).toBe(false);
  });
});
