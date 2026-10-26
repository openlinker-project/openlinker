/**
 * Price Change Block Reason tests (#3143, ADR-072 decision 4)
 *
 * @module libs/core/src/listings/domain/types/__tests__
 */
import { readConnectionCurrency, resolvePriceChangeBlockReason } from '../price-change-block.types';

describe('resolvePriceChangeBlockReason', () => {
  it('returns destination-currency-unknown (never null) when the destination has no configured currency', () => {
    // #3159 review: an unknown currency must never collapse into "known to
    // match" — it blocks the automatic bypass while the episode still opens
    // for manual review.
    expect(resolvePriceChangeBlockReason('PLN', null)).toBe('destination-currency-unknown');
  });

  it('returns null when both currencies match', () => {
    expect(resolvePriceChangeBlockReason('PLN', 'PLN')).toBeNull();
  });

  it('returns currency-mismatch when the currencies differ', () => {
    expect(resolvePriceChangeBlockReason('PLN', 'EUR')).toBe('currency-mismatch');
  });

  it('normalises case and surrounding whitespace before comparing (#3159 review, SUGGESTION)', () => {
    // `readConnectionCurrency` reads `config.currency` verbatim — including
    // a value typed by hand through the raw JSON editor, curl, or MCP, none
    // of which normalise. A destination hand-set to 'pln' must still match
    // a 'PLN' source rather than reading as currency-mismatch.
    expect(resolvePriceChangeBlockReason('PLN', 'pln')).toBeNull();
    expect(resolvePriceChangeBlockReason(' PLN ', 'PLN')).toBeNull();
    expect(resolvePriceChangeBlockReason('PLN', ' Pln ')).toBeNull();
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
