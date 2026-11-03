/**
 * Payment method vocabulary (#3294)
 *
 * The vocabulary is closed and `unknown` is a member, not an absence: an
 * adapter that cannot map its native value with evidence reports it, and no
 * consumer may treat it as COD or as a payment form.
 *
 * @module libs/core/src/orders/domain/types
 */
import { PAYMENT_METHOD, PaymentMethodValues, isPaymentMethod } from './payment-method.types';

describe('payment-method.types', () => {
  it('should declare exactly the four documented members', () => {
    expect([...PaymentMethodValues]).toEqual([
      'online',
      'bank_transfer',
      'cash_on_delivery',
      'unknown',
    ]);
  });

  it('should keep the constants map in step with the array', () => {
    expect(Object.values(PAYMENT_METHOD).sort()).toEqual([...PaymentMethodValues].sort());
  });

  it.each(PaymentMethodValues)('should recognise %s', (value) => {
    expect(isPaymentMethod(value)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['wrong case', 'COD'],
    ['a native value', 'CASH_ON_DELIVERY'],
    ['a plugin slug', 'cod'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['an object', { value: 'online' }],
  ])('should not recognise %s', (_label, value) => {
    expect(isPaymentMethod(value)).toBe(false);
  });
});
