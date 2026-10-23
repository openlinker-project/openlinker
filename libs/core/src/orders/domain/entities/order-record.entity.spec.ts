/**
 * OrderRecord entity unit tests — payment-status getter (#928/#938).
 *
 * The getter is the typed contract cross-context consumers (the #938 shipping
 * dispatch gate) bind to instead of reaching into the loose snapshot JSON.
 */

import { OrderRecord } from './order-record.entity';
import { PAYMENT_STATUS } from '../types/payment-status.types';

function makeRecord(snapshot: Record<string, unknown>): OrderRecord {
  return new OrderRecord(
    'ol_order_1',
    'ol_customer_1',
    'conn-1',
    null,
    snapshot,
    [],
    'ready',
    new Date(),
    new Date(),
  );
}

describe('OrderRecord.paymentStatus', () => {
  it.each([PAYMENT_STATUS.Paid, PAYMENT_STATUS.Cod, PAYMENT_STATUS.Awaiting, PAYMENT_STATUS.Refunded])(
    'returns the recognised payment status %s from the snapshot',
    (status) => {
      expect(makeRecord({ paymentStatus: status }).paymentStatus).toBe(status);
    },
  );

  it('returns undefined when the snapshot has no paymentStatus key', () => {
    expect(makeRecord({}).paymentStatus).toBeUndefined();
  });

  it('returns undefined when paymentStatus is an unrecognised string', () => {
    expect(makeRecord({ paymentStatus: 'partially-refunded' }).paymentStatus).toBeUndefined();
  });

  it('returns undefined when paymentStatus is a non-string value', () => {
    expect(makeRecord({ paymentStatus: 42 }).paymentStatus).toBeUndefined();
    expect(makeRecord({ paymentStatus: null }).paymentStatus).toBeUndefined();
  });
});

describe('OrderRecord.codToCollect (#1435)', () => {
  it('returns the sourced amount when the snapshot carries a well-formed pair', () => {
    expect(makeRecord({ codToCollect: { amount: '510.94', currency: 'PLN' } }).codToCollect).toEqual({
      amount: '510.94',
      currency: 'PLN',
    });
  });

  it('returns undefined when the snapshot has no codToCollect key', () => {
    expect(makeRecord({}).codToCollect).toBeUndefined();
  });

  it('returns undefined when the value is not an object', () => {
    expect(makeRecord({ codToCollect: '510.94' }).codToCollect).toBeUndefined();
    expect(makeRecord({ codToCollect: null }).codToCollect).toBeUndefined();
  });

  it('returns undefined when amount or currency is missing / non-string', () => {
    expect(makeRecord({ codToCollect: { amount: '510.94' } }).codToCollect).toBeUndefined();
    expect(makeRecord({ codToCollect: { amount: 510.94, currency: 'PLN' } }).codToCollect).toBeUndefined();
  });
});

describe('OrderRecord.sourceDeliveryMethodId (#1791)', () => {
  it('returns the methodId from a well-formed shipping snapshot', () => {
    expect(
      makeRecord({ shipping: { methodId: 'courier-standard', methodName: 'Standard' } })
        .sourceDeliveryMethodId,
    ).toBe('courier-standard');
  });

  it('returns null when the snapshot has no shipping key', () => {
    expect(makeRecord({}).sourceDeliveryMethodId).toBeNull();
  });

  it('returns null when shipping is not an object', () => {
    expect(makeRecord({ shipping: 'courier-standard' }).sourceDeliveryMethodId).toBeNull();
    expect(makeRecord({ shipping: null }).sourceDeliveryMethodId).toBeNull();
  });

  it('returns null when methodId is missing or non-string', () => {
    expect(makeRecord({ shipping: {} }).sourceDeliveryMethodId).toBeNull();
    expect(makeRecord({ shipping: { methodId: 42 } }).sourceDeliveryMethodId).toBeNull();
  });
});

describe('OrderRecord.sourceDeliveryMethodName (#1792)', () => {
  it('returns the methodName from a well-formed shipping snapshot', () => {
    expect(
      makeRecord({ shipping: { methodId: 'ai-1', methodName: 'Allegro Paczkomat InPost' } })
        .sourceDeliveryMethodName,
    ).toBe('Allegro Paczkomat InPost');
  });

  it('returns null when the snapshot has no shipping key', () => {
    expect(makeRecord({}).sourceDeliveryMethodName).toBeNull();
  });

  it('returns null when shipping is not an object', () => {
    expect(makeRecord({ shipping: 'x' }).sourceDeliveryMethodName).toBeNull();
    expect(makeRecord({ shipping: null }).sourceDeliveryMethodName).toBeNull();
  });

  it('returns null when methodName is missing or non-string (id present, no label)', () => {
    expect(makeRecord({ shipping: { methodId: 'ai-1' } }).sourceDeliveryMethodName).toBeNull();
    expect(makeRecord({ shipping: { methodName: 7 } }).sourceDeliveryMethodName).toBeNull();
  });
});

describe('OrderRecord.dispatchByEstimated (#1776)', () => {
  it('returns true when the dispatch window is marked estimated', () => {
    expect(
      makeRecord({ dispatchTime: { from: '2026-06-16T00:00:00Z', to: '2026-06-22T00:00:00Z', estimated: true } })
        .dispatchByEstimated,
    ).toBe(true);
  });

  it('returns false for an authoritative window (estimated absent or false)', () => {
    expect(makeRecord({ dispatchTime: { to: '2026-06-22T00:00:00Z' } }).dispatchByEstimated).toBe(false);
    expect(
      makeRecord({ dispatchTime: { to: '2026-06-22T00:00:00Z', estimated: false } }).dispatchByEstimated,
    ).toBe(false);
  });

  it('returns false when the snapshot has no dispatchTime key', () => {
    expect(makeRecord({}).dispatchByEstimated).toBe(false);
  });

  it('fails safe to false when dispatchTime is a malformed (non-object) value', () => {
    expect(makeRecord({ dispatchTime: 'soon' }).dispatchByEstimated).toBe(false);
    expect(makeRecord({ dispatchTime: 42 }).dispatchByEstimated).toBe(false);
    expect(makeRecord({ dispatchTime: null }).dispatchByEstimated).toBe(false);
  });

  it('returns false when estimated is a truthy non-boolean (strict === true)', () => {
    expect(makeRecord({ dispatchTime: { estimated: 'true' } }).dispatchByEstimated).toBe(false);
    expect(makeRecord({ dispatchTime: { estimated: 1 } }).dispatchByEstimated).toBe(false);
  });
});

describe('OrderRecord.orderItems (#3171)', () => {
  const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'oi_1',
    productId: 'ol_product_1',
    quantity: 2,
    price: 189,
    sku: 'EARB-01',
    ...over,
  });

  it('returns the snapshot lines in the document order a correction addresses', () => {
    const record = makeRecord({
      items: [item({ id: 'oi_1' }), item({ id: 'oi_2', price: 179 })],
    });

    expect(record.orderItems.map((line) => line.id)).toEqual(['oi_1', 'oi_2']);
  });

  it('returns an empty array when the snapshot carries no items', () => {
    expect(makeRecord({}).orderItems).toEqual([]);
  });

  it('returns an empty array when items is not an array', () => {
    expect(makeRecord({ items: { id: 'oi_1' } }).orderItems).toEqual([]);
  });

  it.each([
    ['a missing id', item({ id: undefined })],
    ['a blank id', item({ id: '' })],
    ['a missing productId', item({ productId: undefined })],
    ['a non-numeric quantity', item({ quantity: '2' })],
    ['a null price', item({ price: null })],
    ['a non-finite price', item({ price: Number.NaN })],
    ['a non-object entry', 'oi_1'],
  ])('drops a line with %s rather than coercing it', (_label, malformed) => {
    // A partial line is worse than a missing one: consumers join on `id` and do
    // arithmetic on `quantity` / `price`, so `undefined` in either would resolve
    // or compute wrong rather than not at all.
    const record = makeRecord({ items: [item({ id: 'oi_ok' }), malformed] });

    expect(record.orderItems.map((line) => line.id)).toEqual(['oi_ok']);
  });
});

describe('OrderRecord.isCancelled (#1984)', () => {
  function makeRecordWithCancelledAt(cancelledAt: Date | null): OrderRecord {
    return new OrderRecord(
      'ol_order_1',
      'ol_customer_1',
      'conn-1',
      null,
      {},
      [],
      'ready',
      new Date(),
      new Date(),
      [],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      cancelledAt,
    );
  }

  it('returns false when cancelledAt is null', () => {
    expect(makeRecordWithCancelledAt(null).isCancelled).toBe(false);
  });

  it('returns true when cancelledAt is set', () => {
    expect(makeRecordWithCancelledAt(new Date('2026-08-01T00:00:00Z')).isCancelled).toBe(true);
  });
});
