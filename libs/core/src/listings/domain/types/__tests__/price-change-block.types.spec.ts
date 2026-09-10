/**
 * Price Change Block Reason tests (#3143, ADR-072 decision 4)
 *
 * @module libs/core/src/listings/domain/types/__tests__
 */
import { readConnectionCurrency, resolvePriceChangeBlockReason } from '../price-change-block.types';

describe('resolvePriceChangeBlockReason', () => {
  it('returns null when the destination has no configured currency', () => {
    expect(resolvePriceChangeBlockReason('PLN', null)).toBeNull();
  });

  it('returns null when both currencies match', () => {
    expect(resolvePriceChangeBlockReason('PLN', 'PLN')).toBeNull();
  });

  it('returns currency-mismatch when the currencies differ', () => {
    expect(resolvePriceChangeBlockReason('PLN', 'EUR')).toBe('currency-mismatch');
  });
});

describe('readConnectionCurrency', () => {
  it('returns null for a missing/empty config', () => {
    expect(readConnectionCurrency(null)).toBeNull();
    expect(readConnectionCurrency(undefined)).toBeNull();
    expect(readConnectionCurrency({})).toBeNull();
  });

  it('returns null for a non-string value', () => {
    expect(readConnectionCurrency({ currency: 123 as unknown as string })).toBeNull();
  });

  it('returns the configured currency', () => {
    expect(readConnectionCurrency({ currency: 'EUR' })).toBe('EUR');
  });
});
