/**
 * Pickup-point query normalization unit tests (#849).
 */
import {
  pickupPointFrequencyMember,
  parsePickupPointFrequencyMember,
  pickupPointSearchCacheKey,
} from './pickup-point-query';

describe('pickup-point-query', () => {
  describe('pickupPointFrequencyMember', () => {
    it('excludes limit so page size does not fragment the key', () => {
      expect(pickupPointFrequencyMember({ city: 'Poznań', limit: 5 })).toBe(
        pickupPointFrequencyMember({ city: 'Poznań', limit: 50 }),
      );
    });

    it('trims, collapses whitespace, and lowercases', () => {
      expect(pickupPointFrequencyMember({ city: '  PoZNAŃ  ' })).toBe(
        pickupPointFrequencyMember({ city: 'poznań' }),
      );
      expect(pickupPointFrequencyMember({ searchText: 'al.   Solidarności' })).toBe(
        pickupPointFrequencyMember({ searchText: 'al. solidarności' }),
      );
    });

    it('omits empty/whitespace-only fields', () => {
      expect(pickupPointFrequencyMember({ city: '   ', postalCode: '60-001' })).toBe(
        pickupPointFrequencyMember({ postalCode: '60-001' }),
      );
    });

    it('produces a stable key regardless of input field order', () => {
      const a = pickupPointFrequencyMember({ city: 'poznań', postalCode: '60-001' });
      const b = pickupPointFrequencyMember({ postalCode: '60-001', city: 'poznań' });
      expect(a).toBe(b);
    });
  });

  describe('parsePickupPointFrequencyMember', () => {
    it('round-trips a member back into a query', () => {
      const member = pickupPointFrequencyMember({ city: 'Poznań', postalCode: '60-001' });
      expect(parsePickupPointFrequencyMember(member)).toEqual({
        city: 'poznań',
        postalCode: '60-001',
        searchText: undefined,
      });
    });

    it('degrades to an empty query on a corrupt member', () => {
      expect(parsePickupPointFrequencyMember('not-json')).toEqual({});
    });
  });

  describe('pickupPointSearchCacheKey', () => {
    it('includes limit so a narrower entry cannot satisfy a wider request', () => {
      expect(pickupPointSearchCacheKey({ city: 'poznań', limit: 5 })).not.toBe(
        pickupPointSearchCacheKey({ city: 'poznań', limit: 50 }),
      );
    });

    it('treats absent/zero limit as the same "none" bucket', () => {
      expect(pickupPointSearchCacheKey({ city: 'poznań' })).toBe(
        pickupPointSearchCacheKey({ city: 'poznań', limit: 0 }),
      );
    });
  });
});
