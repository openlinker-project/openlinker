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

describe('OrderRecord.status (#1596)', () => {
  it.each(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'])(
    'returns the recognised order status %s from the snapshot',
    (status) => {
      expect(makeRecord({ status }).status).toBe(status);
    },
  );

  it('returns undefined when the snapshot has no status key', () => {
    expect(makeRecord({}).status).toBeUndefined();
  });

  it('returns undefined when status is an unrecognised string', () => {
    expect(makeRecord({ status: 'archived' }).status).toBeUndefined();
  });

  it('returns undefined when status is a non-string value', () => {
    expect(makeRecord({ status: 42 }).status).toBeUndefined();
    expect(makeRecord({ status: null }).status).toBeUndefined();
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
