/**
 * Payment facts consistency (#3294)
 *
 * One case per rule, each proven able to fail: a rule that never reports
 * anything is indistinguishable from one that was never written.
 *
 * @module libs/core/src/orders/domain/types
 */
import {
  PaymentFactsViolationValues,
  checkPaymentFactsConsistency,
  type PaymentFacts,
} from './payment-facts-consistency.types';

const COD_AMOUNT = { amount: '10.00', currency: 'PLN' };

describe('checkPaymentFactsConsistency', () => {
  it.each<[string, PaymentFacts]>([
    ['nothing reported', {}],
    ['method only', { paymentMethod: 'online' }],
    ['status only', { paymentStatus: 'paid' }],
    ['cod, unpaid, with amount', { paymentMethod: 'cash_on_delivery', paymentStatus: 'cod', codToCollect: COD_AMOUNT }],
    ['cod method, status not reported', { paymentMethod: 'cash_on_delivery' }],
    ['prepaid online', { paymentMethod: 'online', paymentStatus: 'paid' }],
    ['bank transfer awaiting', { paymentMethod: 'bank_transfer', paymentStatus: 'awaiting' }],
    ['unknown method, any status', { paymentMethod: 'unknown', paymentStatus: 'cod' }],
    ['cod status, method not reported', { paymentStatus: 'cod', codToCollect: COD_AMOUNT }],
  ])('should report nothing for a consistent set: %s', (_label, facts) => {
    expect(checkPaymentFactsConsistency(facts)).toEqual([]);
  });

  it('should accept cash on delivery that has since been collected and so reads paid', () => {
    expect(
      checkPaymentFactsConsistency({ paymentMethod: 'cash_on_delivery', paymentStatus: 'paid' })
    ).toEqual([]);
  });

  it.each(['online', 'bank_transfer'] as const)(
    'should flag a COD status beside the non-COD method %s',
    (paymentMethod) => {
      expect(checkPaymentFactsConsistency({ paymentMethod, paymentStatus: 'cod' })).toEqual([
        'cod-status-with-non-cod-method',
      ]);
    }
  );

  it.each(['online', 'bank_transfer', 'unknown'] as const)(
    'should flag a collect amount beside the non-COD method %s',
    (paymentMethod) => {
      expect(checkPaymentFactsConsistency({ paymentMethod, codToCollect: COD_AMOUNT })).toEqual([
        'cod-amount-without-cod-method',
      ]);
    }
  );

  it('should report every contradiction at once', () => {
    expect(
      checkPaymentFactsConsistency({
        paymentMethod: 'online',
        paymentStatus: 'cod',
        codToCollect: COD_AMOUNT,
      })
    ).toEqual(['cod-status-with-non-cod-method', 'cod-amount-without-cod-method']);
  });

  it('should be able to produce every declared violation', () => {
    const produced = new Set([
      ...checkPaymentFactsConsistency({
        paymentMethod: 'online',
        paymentStatus: 'cod',
        codToCollect: COD_AMOUNT,
      }),
    ]);

    expect([...produced].sort()).toEqual([...PaymentFactsViolationValues].sort());
  });
});
