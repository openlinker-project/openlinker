/**
 * COD collect amount helper (#3294)
 *
 * The amount is the order's gross total as a two-decimal string, and it is
 * ABSENT - never `'0.00'` - whenever there is no honest figure to state, so a
 * label can never pre-fill money nobody asserted.
 *
 * @module libs/core/src/orders/domain/types
 */
import { toCodToCollect } from './cod-to-collect.types';

describe('toCodToCollect', () => {
  it.each([
    [510.94, 'PLN', { amount: '510.94', currency: 'PLN' }],
    [10, 'EUR', { amount: '10.00', currency: 'EUR' }],
    [0.1 + 0.2, 'PLN', { amount: '0.30', currency: 'PLN' }],
    [99.999, 'PLN', { amount: '100.00', currency: 'PLN' }],
    [25, '  CZK ', { amount: '25.00', currency: 'CZK' }],
    // Formatted to the currency's own minor unit, not a fixed two decimals.
    [1500, 'JPY', { amount: '1500', currency: 'JPY' }],
    [12.3456, 'KWD', { amount: '12.346', currency: 'KWD' }],
  ])('should state %s %s as a decimal string', (total, currency, expected) => {
    expect(toCodToCollect(total, currency)).toEqual(expected);
  });

  it.each([
    ['zero', 0, 'PLN'],
    ['negative', -5, 'PLN'],
    ['NaN', Number.NaN, 'PLN'],
    ['infinite', Number.POSITIVE_INFINITY, 'PLN'],
    ['blank currency', 10, ''],
    ['whitespace currency', 10, '   '],
  ])('should state nothing for %s rather than an invented amount', (_label, total, currency) => {
    expect(toCodToCollect(total, currency)).toBeUndefined();
  });
});
