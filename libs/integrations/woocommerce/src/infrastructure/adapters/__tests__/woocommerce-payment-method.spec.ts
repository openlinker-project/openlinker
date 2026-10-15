/**
 * WooCommerce payment-method derivation (#3294)
 *
 * Only the two gateway ids WooCommerce core ships carry a method. A plugin's
 * own slug is free text and reads as `unknown`, however obvious it looks.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { deriveWooCommercePaymentMethod } from '../woocommerce-payment-method';

describe('deriveWooCommercePaymentMethod', () => {
  it.each([
    ['cod', 'cash_on_delivery'],
    ['bacs', 'bank_transfer'],
    ['COD', 'cash_on_delivery'],
    ['  bacs  ', 'bank_transfer'],
  ])('should map the core gateway id %j to %s', (payment_method, expected) => {
    expect(deriveWooCommercePaymentMethod({ payment_method })).toBe(expected);
  });

  it.each([
    ['paypal'],
    ['stripe'],
    ['przelewy24'],
    ['cheque'],
    ['cod_custom'],
    ['pay-on-delivery'],
    [''],
  ])('should report unknown for the plugin or non-core id %j', (payment_method) => {
    expect(deriveWooCommercePaymentMethod({ payment_method })).toBe('unknown');
  });

  it('should report unknown when the payload carries no gateway id', () => {
    expect(deriveWooCommercePaymentMethod({})).toBe('unknown');
  });
});
