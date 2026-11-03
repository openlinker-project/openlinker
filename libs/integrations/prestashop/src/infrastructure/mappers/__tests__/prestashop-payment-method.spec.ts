/**
 * PrestaShop payment-method derivation (#3294)
 *
 * Only the two payment modules PrestaShop ships name a method. Everything else
 * - a cheque module, a third-party gateway, a missing or non-string column - is
 * `unknown`, however obvious the module name looks.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import {
  derivePrestashopPaymentMethod,
  withCashOnDeliveryPaymentStatus,
} from '../prestashop-payment-method';

describe('derivePrestashopPaymentMethod', () => {
  it.each([
    ['ps_cashondelivery', 'cash_on_delivery'],
    ['ps_wirepayment', 'bank_transfer'],
    ['PS_CashOnDelivery', 'cash_on_delivery'],
    ['  ps_wirepayment  ', 'bank_transfer'],
  ])('should map the core module %j to %s', (module, expected) => {
    expect(derivePrestashopPaymentMethod({ module })).toBe(expected);
  });

  it.each([
    ['ps_checkpayment'],
    ['paypal'],
    ['payu'],
    ['przelewy24'],
    ['ps_cashondelivery_plus'],
    [''],
  ])('should report unknown for the module %j', (module) => {
    expect(derivePrestashopPaymentMethod({ module })).toBe('unknown');
  });

  it.each([[undefined], [null], [42], [{}]])(
    'should report unknown for a missing or non-string module column (%p)',
    (module) => {
      expect(derivePrestashopPaymentMethod({ module })).toBe('unknown');
    },
  );

  it('should report unknown for an order with no module at all', () => {
    expect(derivePrestashopPaymentMethod({})).toBe('unknown');
  });

  it('should not read the human-readable payment label', () => {
    expect(
      derivePrestashopPaymentMethod({ module: 'payu', payment: 'Cash on delivery' } as {
        module: string;
      }),
    ).toBe('unknown');
  });
});

describe('withCashOnDeliveryPaymentStatus', () => {
  it.each(['pending', 'processing', 'shipped', 'delivered'] as const)(
    'should fill the state\'s silence with cod for a core COD order in status %s',
    (orderStatus) => {
      expect(withCashOnDeliveryPaymentStatus(undefined, 'cash_on_delivery', orderStatus)).toBe(
        'cod',
      );
    },
  );

  it.each(['cancelled', 'refunded'] as const)(
    'should make no payment claim for a dead COD order in status %s',
    (orderStatus) => {
      expect(
        withCashOnDeliveryPaymentStatus(undefined, 'cash_on_delivery', orderStatus),
      ).toBeUndefined();
    },
  );

  it('should never override what the state already says', () => {
    expect(withCashOnDeliveryPaymentStatus('paid', 'cash_on_delivery', 'processing')).toBe('paid');
  });

  it.each(['bank_transfer', 'online', 'unknown'] as const)(
    'should keep reporting nothing for the non-COD method %s',
    (method) => {
      expect(withCashOnDeliveryPaymentStatus(undefined, method, 'processing')).toBeUndefined();
    },
  );
});
