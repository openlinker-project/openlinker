/**
 * Allegro Tax-Rate Mapper Tests (#2249)
 *
 * The rule under test is that a null stays a null. Allegro reports every field
 * of `lineItems[].tax` as nullable, and reading an absent one as `0` would
 * state a zero-rated sale that never happened.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import { readPermittedTaxRates, toAllegroRate, toNeutralTaxRate } from './allegro-tax-rate.mapper';

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

  describe('readPermittedTaxRates', () => {
    /**
     * Captured VERBATIM from the live sandbox on 21 Aug 2026:
     * `GET /sale/tax-settings?category.id=257366&countryCode=PL`.
     *
     * It is here because the first version of this parsing was a guess about
     * the response shape - it read `taxSettings[].rates[]`, which does not
     * exist - and produced an empty list against the real body, so the
     * category check silently never fired. A guessed shape needs a captured
     * payload, not a hand-written one that repeats the guess.
     */
    const LIVE_BODY = {
      subjects: [
        { label: 'Goods', value: 'GOODS' },
        { label: 'Select', value: null },
      ],
      rates: [
        {
          countryCode: 'PL',
          values: [
            { label: '23%', value: '23.00', exemptionRequired: false },
            { label: 'Select', value: null, exemptionRequired: false },
          ],
        },
      ],
      exemptions: [{ label: 'Select' }],
    };

    it('should read the permitted rates out of the live response shape', () => {
      expect(readPermittedTaxRates(LIVE_BODY.rates, 'PL')).toEqual([23]);
    });

    it('should drop the null "Select" placeholder rather than parsing it', () => {
      expect(readPermittedTaxRates(LIVE_BODY.rates, 'PL')).not.toContain(Number.NaN);
    });

    it('should ignore a block for another country', () => {
      const rates = [
        { countryCode: 'CZ', values: [{ value: '21.00' }] },
        { countryCode: 'PL', values: [{ value: '8.00' }] },
      ];
      expect(readPermittedTaxRates(rates, 'PL')).toEqual([8]);
    });

    it('should treat a block with no country as applying everywhere', () => {
      expect(readPermittedTaxRates([{ values: [{ value: '5.00' }] }], 'PL')).toEqual([5]);
    });

    it('should report an absent or empty body as no permitted rates', () => {
      // The caller reads `[]` as "Allegro answered and named none", which does
      // NOT block - distinct from the `null` it uses for an unreadable listing.
      expect(readPermittedTaxRates(undefined, 'PL')).toEqual([]);
      expect(readPermittedTaxRates([], 'PL')).toEqual([]);
    });
  });
});
