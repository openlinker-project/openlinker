/**
 * Routed parcel profile tests (#3652)
 *
 * @module apps/web/src/features/orders/lib
 */
import { describe, expect, it } from 'vitest';
import { mergeParcelWithRoutedPrefill, parcelPrefillFromFields } from './routed-parcel-profile';

// The shape `deliveryResolution.parcelProfile` carries (#3958).
const PROFILE = {
  parcelTemplate: 'large',
  lengthMm: 300,
  widthMm: 200,
  heightMm: 100,
  defaultWeightGrams: 500,
};

describe('parcelPrefillFromFields', () => {
  it('should return the profile in mm and g', () => {
    expect(parcelPrefillFromFields(PROFILE)).toEqual({
      template: 'large',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      weightGrams: 500,
    });
  });

  it('should return null without a profile or with an empty one', () => {
    expect(parcelPrefillFromFields(null)).toBeNull();
    expect(parcelPrefillFromFields(undefined)).toBeNull();
    expect(parcelPrefillFromFields({ parcelTemplate: null, lengthMm: null, widthMm: null, heightMm: null, defaultWeightGrams: null })).toBeNull();
    expect(parcelPrefillFromFields({ parcelTemplate: undefined, lengthMm: undefined, widthMm: undefined, heightMm: undefined, defaultWeightGrams: undefined })).toBeNull();
  });
});

describe('mergeParcelWithRoutedPrefill', () => {
  const routed = { lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 500 };

  it('should fill blanks from the routed profile', () => {
    expect(
      mergeParcelWithRoutedPrefill({ length: '', width: '', height: '', weightGrams: '' }, routed),
    ).toEqual({ length: '300', width: '200', height: '100', weightGrams: '500' });
  });

  it('should keep what the operator typed in the dialog-wide default box', () => {
    expect(
      mergeParcelWithRoutedPrefill({ length: '10', width: '', height: '', weightGrams: '99' }, routed),
    ).toEqual({ length: '10', width: '200', height: '100', weightGrams: '99' });
  });

  it('should return the base unchanged without a routed profile', () => {
    const base = { length: '', width: '', height: '', weightGrams: '' };
    expect(mergeParcelWithRoutedPrefill(base, null)).toBe(base);
  });
});
