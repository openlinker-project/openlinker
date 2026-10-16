/**
 * Allegro payment-method derivation (#3294)
 *
 * Only the three unambiguous `payment.type` values map; everything else is
 * `unknown`, including types this build has never seen.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { checkPaymentFactsConsistency } from '@openlinker/core/orders';
import { deriveAllegroPaymentMethod } from './allegro-payment-method';
import { deriveAllegroPaymentStatus } from './allegro-payment-status';

describe('deriveAllegroPaymentMethod', () => {
  it.each([
    ['ONLINE', 'online'],
    ['CASH_ON_DELIVERY', 'cash_on_delivery'],
    ['WIRE_TRANSFER', 'bank_transfer'],
  ])('should map %s to %s', (type, expected) => {
    expect(deriveAllegroPaymentMethod({ type })).toBe(expected);
  });

  it.each([
    ['SPLIT_PAYMENT'],
    ['EXTENDED_TERM'],
    ['BANK_TRANSFER'],
    ['SOMETHING_NEW'],
    ['online'],
    [''],
  ])('should report unknown for %j rather than guess', (type) => {
    expect(deriveAllegroPaymentMethod({ type })).toBe('unknown');
  });

  it.each([
    [{ type: 'CASH_ON_DELIVERY', finishedAt: '2026-01-01T00:00:00Z' }],
    [{ type: 'CASH_ON_DELIVERY' }],
    [{ type: 'ONLINE', finishedAt: '2026-01-01T00:00:00Z' }],
    [{ type: 'ONLINE' }],
    [{ type: 'WIRE_TRANSFER' }],
    [{ type: 'SPLIT_PAYMENT', finishedAt: '2026-01-01T00:00:00Z' }],
  ])('should agree with the derived payment status for %j', (payment) => {
    expect(
      checkPaymentFactsConsistency({
        paymentMethod: deriveAllegroPaymentMethod(payment),
        paymentStatus: deriveAllegroPaymentStatus(payment),
      })
    ).toEqual([]);
  });
});
