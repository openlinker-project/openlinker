/**
 * Allegro Tax-Rate Mapper Tests (#2249)
 *
 * The rule under test is that a null stays a null. Allegro reports every field
 * of `lineItems[].tax` as nullable, and reading an absent one as `0` would
 * state a zero-rated sale that never happened.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { toAllegroRate, toNeutralTaxRate } from './allegro-tax-rate.mapper';

describe('Allegro tax-rate mapping', () => {
  describe('toNeutralTaxRate', () => {
    it('should normalise a percent string to the bare neutral code', () => {
      // Allegro reports "23.00"; the FA(3) map and the Erli enum are both keyed
      // on the bare form (#2247).
      expect(toNeutralTaxRate({ rate: '23.00' })).toBe('23');
      expect(toNeutralTaxRate({ rate: '8.0' })).toBe('8');
    });

    it('should keep a genuine zero rate as a rate', () => {
      expect(toNeutralTaxRate({ rate: '0.00' })).toBe('0');
    });

    it('should report an absent tax object as null, never as zero', () => {
      expect(toNeutralTaxRate(null)).toBeNull();
      expect(toNeutralTaxRate(undefined)).toBeNull();
      expect(toNeutralTaxRate({})).toBeNull();
      expect(toNeutralTaxRate({ rate: null })).toBeNull();
    });

    it('should read an exemption when no rate is given', () => {
      expect(toNeutralTaxRate({ rate: null, exemption: 'ZW' })).toBe('zw');
      expect(toNeutralTaxRate({ exemption: 'np' })).toBe('np');
    });

    it('should report an unrecognised exemption as null rather than guessing', () => {
      expect(toNeutralTaxRate({ exemption: 'SOMETHING_ELSE' })).toBeNull();
    });
  });

  describe('toAllegroRate', () => {
    it('should express a numeric code as a number', () => {
      expect(toAllegroRate('23')).toBe(23);
      expect(toAllegroRate('0')).toBe(0);
    });

    it('should refuse an exemption code, which has no place in a numeric rates array', () => {
      expect(toAllegroRate('zw')).toBeNull();
      expect(toAllegroRate('np')).toBeNull();
      expect(toAllegroRate('oo')).toBeNull();
    });

    it('should refuse an absent code', () => {
      expect(toAllegroRate(undefined)).toBeNull();
      expect(toAllegroRate('')).toBeNull();
    });
  });
});
