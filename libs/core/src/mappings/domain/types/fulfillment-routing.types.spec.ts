/**
 * Fulfillment routing parcel-profile normalisation tests (#3651).
 *
 * @module libs/core/src/mappings/domain/types
 */
import { normalizeParcelProfile } from './fulfillment-routing.types';

describe('normalizeParcelProfile', () => {
  it('should collapse absent and all-empty profiles to null', () => {
    expect(normalizeParcelProfile(undefined)).toBeNull();
    expect(normalizeParcelProfile(null)).toBeNull();
    expect(normalizeParcelProfile({ parcelTemplate: '  ', lengthMm: null })).toBeNull();
  });

  it('should keep a template-only profile with the other fields null', () => {
    expect(normalizeParcelProfile({ parcelTemplate: ' large ' })).toEqual({
      parcelTemplate: 'large',
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      defaultWeightGrams: null,
    });
  });

  it('should report a partial box as incomplete', () => {
    expect(normalizeParcelProfile({ lengthMm: 10, widthMm: 10 })).toBe('incomplete-dimensions');
  });

  it('should accept a complete box', () => {
    expect(normalizeParcelProfile({ lengthMm: 1, widthMm: 2, heightMm: 3 })).toMatchObject({
      lengthMm: 1,
      widthMm: 2,
      heightMm: 3,
    });
  });
});
