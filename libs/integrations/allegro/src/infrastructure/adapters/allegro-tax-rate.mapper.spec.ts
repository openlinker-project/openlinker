/**
 * Allegro Tax-Rate Mapper Tests (#2249)
 *
 * The rule under test is that a null stays a null. Allegro reports every field
 * of `lineItems[].tax` as nullable, and reading an absent one as `0` would
 * state a zero-rated sale that never happened.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import {
  formatAllegroRate,
  readPermittedTaxRates,
  toAllegroRate,
  toNeutralTaxRate,
} from './allegro-tax-rate.mapper';

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
      // Both forms: the number to compare against OL's own code, and the exact
      // string Allegro published, which is what has to go back on the wire.
      expect(readPermittedTaxRates(LIVE_BODY.rates, 'PL')).toEqual([
        { numeric: 23, wire: '23.00' },
      ]);
    });

    it('should drop the null "Select" placeholder rather than parsing it', () => {
      expect(readPermittedTaxRates(LIVE_BODY.rates, 'PL')).toHaveLength(1);
    });

    it('should ignore a block for another country', () => {
      const rates = [
        { countryCode: 'CZ', values: [{ value: '21.00' }] },
        { countryCode: 'PL', values: [{ value: '8.00' }] },
      ];
      expect(readPermittedTaxRates(rates, 'PL')).toEqual([{ numeric: 8, wire: '8.00' }]);
    });

    it('should treat a block with no country as applying everywhere', () => {
      expect(readPermittedTaxRates([{ values: [{ value: '5.00' }] }], 'PL')).toEqual([
        { numeric: 5, wire: '5.00' },
      ]);
    });

    it('should report an absent or empty body as no permitted rates', () => {
      // The caller reads `[]` as "Allegro answered and named none", which does
      // NOT block - distinct from the `null` it uses for an unreadable listing.
      expect(readPermittedTaxRates(undefined, 'PL')).toEqual([]);
      expect(readPermittedTaxRates([], 'PL')).toEqual([]);
    });
  });

  describe('formatAllegroRate', () => {
    /**
     * Allegro matches this value against the seller's configured VAT settings
     * as a STRING, exactly. Verified live on the sandbox (21 Aug 2026): a PATCH
     * carrying the number 23 answers
     *   422 SETTING_NOT_FOUND "No VAT setting found for the rate: 23 of country: PL"
     * while the published "23.00" is accepted. Without this, EVERY publish
     * failed with an error an operator could not act on.
     */
    it('should send back the exact string Allegro published', () => {
      expect(formatAllegroRate(23, [{ numeric: 23, wire: '23.00' }])).toBe('23.00');
    });

    it('should preserve a published form that is not two decimals', () => {
      expect(formatAllegroRate(8, [{ numeric: 8, wire: '8.0' }])).toBe('8.0');
    });

    it('should fall back to two decimals when the listing was unavailable', () => {
      expect(formatAllegroRate(23, [])).toBe('23.00');
      expect(formatAllegroRate(0, [])).toBe('0.00');
    });

    it('should fall back when the listing has no entry for this rate', () => {
      expect(formatAllegroRate(5, [{ numeric: 23, wire: '23.00' }])).toBe('5.00');
    });
  });
});
