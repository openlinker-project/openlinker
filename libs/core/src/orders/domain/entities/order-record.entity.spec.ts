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
