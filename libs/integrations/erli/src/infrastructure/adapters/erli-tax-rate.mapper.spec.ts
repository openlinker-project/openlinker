/**
 * Erli Tax-Rate Mapper Tests (#2249)
 *
 * Both directions, because the platform vocabulary and the neutral code have
 * to round-trip for the same sale to be taxed the same way on the offer and on
 * the invoice.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */
import { supportedErliTaxRates, toErliTaxRate, toNeutralTaxRate } from './erli-tax-rate.mapper';

describe('Erli tax-rate mapping', () => {
  describe('toNeutralTaxRate', () => {
    it.each([
      ['TAX_23', '23'],
      ['TAX_8', '8'],
      ['TAX_5', '5'],
      ['TAX_0', '0'],
      ['TAX_7', '7'],
      ['TAX_19', '19'],
      ['NP', 'np'],
      ['ZW', 'zw'],
    ])('should read %s as the neutral code %s', (erli, neutral) => {
      expect(toNeutralTaxRate(erli)).toBe(neutral);
    });

    it('should accept a lower-case or padded value', () => {
      expect(toNeutralTaxRate(' tax_23 ')).toBe('23');
    });

    it('should report an absent value as null rather than as a zero rate', () => {
      // A rate OL cannot read is not a zero-rated sale. Conflating the two is
      // the failure this epic exists to remove.
      expect(toNeutralTaxRate(undefined)).toBeNull();
      expect(toNeutralTaxRate(null)).toBeNull();
      expect(toNeutralTaxRate('')).toBeNull();
    });

    it('should report an unrecognised value as null', () => {
      // Erli's enum is category-dependent and may gain values.
      expect(toNeutralTaxRate('TAX_42')).toBeNull();
    });
  });

  describe('toErliTaxRate', () => {
    it.each([
      ['23', 'TAX_23'],
      ['8', 'TAX_8'],
      ['0', 'TAX_0'],
      ['zw', 'ZW'],
      ['np', 'NP'],
    ])('should express the neutral code %s as %s', (neutral, erli) => {
      expect(toErliTaxRate(neutral)).toBe(erli);
    });

    it('should refuse reverse charge, which Erli cannot express', () => {
      // `oo` has no Erli value. Returning the nearest-looking token would be a
      // real sale taxed wrongly, so the caller has to refuse the publish.
      expect(toErliTaxRate('oo')).toBeNull();
    });

    it('should refuse an absent code', () => {
      expect(toErliTaxRate(undefined)).toBeNull();
      expect(toErliTaxRate('')).toBeNull();
    });
  });

  it('should round-trip every value it claims to support', () => {
    for (const neutral of supportedErliTaxRates()) {
      const erli = toErliTaxRate(neutral);
      expect(erli).not.toBeNull();
      expect(toNeutralTaxRate(erli)).toBe(neutral);
    }
  });
});
