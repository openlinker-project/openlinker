/**
 * FA(3) Currency Mapper — Unit Specs
 *
 * Pins the ISO-4217 → `KodWaluty` resolution: allow-listed currencies pass
 * (case/whitespace-normalised), anything outside the allow-list throws
 * `UnsupportedCurrencyException`.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { UnsupportedCurrencyException } from '../../../domain/exceptions/fa3-builder.exception';
import { resolveKodWaluty } from './fa3-currency.mapper';

describe('resolveKodWaluty', () => {
  it('should resolve an allow-listed currency', () => {
    expect(resolveKodWaluty('PLN')).toBe('PLN');
    expect(resolveKodWaluty('EUR')).toBe('EUR');
  });

  it('should normalise case and surrounding whitespace', () => {
    expect(resolveKodWaluty('  eur ')).toBe('EUR');
  });

  it('should throw UnsupportedCurrencyException for a currency outside the allow-list', () => {
    expect(() => resolveKodWaluty('JPY')).toThrow(UnsupportedCurrencyException);
  });

  it('should throw UnsupportedCurrencyException for an empty/garbage value', () => {
    expect(() => resolveKodWaluty('')).toThrow(UnsupportedCurrencyException);
    expect(() => resolveKodWaluty('not-a-currency')).toThrow(UnsupportedCurrencyException);
  });
});
