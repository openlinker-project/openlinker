/**
 * Neutral Tax Rate Tests (#2054, ADR-052)
 *
 * The two distinctions the whole gate rests on: `0` is an answer and not an
 * absence, and *never checked* is not *the shop has no rate*.
 *
 * @module libs/core/src/products/domain/types
 */
import { effectiveTaxRate, isResolvedTaxRate, taxRateState } from './tax-rate.types';
import type { StoredTaxRate } from './tax-rate.types';

const READ_AT = new Date('2026-08-21T10:00:00Z');

function stored(code: string | null, readAt: Date | null = READ_AT): StoredTaxRate {
  return { code, countryIso2: 'PL', readAt };
}

describe('taxRateState', () => {
  it('should report not-checked when the master has never been asked', () => {
    expect(taxRateState({ code: null, countryIso2: null, readAt: null })).toBe('not-checked');
  });

  it('should report not-checked when there is no row at all', () => {
    expect(taxRateState(null)).toBe('not-checked');
    expect(taxRateState(undefined)).toBe('not-checked');
  });

  it('should report no-rate when the master was asked and named none', () => {
    // The distinction a single nullable column cannot carry: same null code,
    // different meaning, because the timestamp says the question was put.
    expect(taxRateState(stored(null))).toBe('no-rate');
  });

  it('should report known when a rate was read', () => {
    expect(taxRateState(stored('23'))).toBe('known');
  });

  it('should report a zero rate as known, not as an absence', () => {
    // Export, intra-EU and exempt goods are all legitimately zero. Treating
    // this as a gap would hold documents for a correctly configured catalogue.
    expect(taxRateState(stored('0'))).toBe('known');
  });

  it('should report an exemption code as known', () => {
    expect(taxRateState(stored('zw'))).toBe('known');
    expect(taxRateState(stored('np'))).toBe('known');
  });

  it('should report a blank code as no-rate rather than as a rate', () => {
    expect(taxRateState(stored('   '))).toBe('no-rate');
  });
});

describe('effectiveTaxRate', () => {
  it('should use the product rate when the variant carries no override', () => {
    expect(effectiveTaxRate(stored('23'), null).code).toBe('23');
  });

  it('should let a variant override win over its product', () => {
    // Not a conflict to arbitrate: the variant value is the more specific
    // statement of the same fact, and the shop had to be edited for the two
    // to differ (#2054, the question the epic left open).
    expect(effectiveTaxRate(stored('23'), stored('5')).code).toBe('5');
  });

  it('should let a zero variant override win over a non-zero product', () => {
    expect(effectiveTaxRate(stored('23'), stored('0')).code).toBe('0');
  });

  it('should fall back to the product when the variant was never checked', () => {
    expect(effectiveTaxRate(stored('23'), stored(null, null)).code).toBe('23');
  });

  it('should fall back to the product when the variant was checked and has no rate', () => {
    // PrestaShop keys tax on the product, so every variant there reads no-rate.
    // Masking the product's rate would blank a correctly configured catalogue.
    expect(effectiveTaxRate(stored('23'), stored(null)).code).toBe('23');
  });

  it('should report never-checked when neither level has been read', () => {
    const result = effectiveTaxRate(null, null);
    expect(taxRateState(result)).toBe('not-checked');
  });
});

describe('isResolvedTaxRate', () => {
  it('should narrow the resolved arm', () => {
    expect(isResolvedTaxRate({ kind: 'resolved', code: '23', countryIso2: 'PL' })).toBe(true);
    expect(isResolvedTaxRate({ kind: 'unknown', reason: 'not-configured' })).toBe(false);
    expect(isResolvedTaxRate({ kind: 'inherited' })).toBe(false);
  });
});
