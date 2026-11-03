/**
 * Routed parcel profile tests (#3652)
 *
 * @module apps/web/src/features/orders/lib
 */
import { describe, expect, it } from 'vitest';
import type { RoutingRule } from '../../mappings';
import { mergeParcelWithRoutedPrefill, parcelPrefillForMethod } from './routed-parcel-profile';

const RULE: RoutingRule = {
  id: 'r1',
  sourceConnectionId: 'c1',
  sourceDeliveryMethodId: 'm1',
  processorKind: 'ol_managed_carrier',
  processorConnectionId: 'p1',
  parcelTemplate: 'large',
  lengthMm: 300,
  widthMm: 200,
  heightMm: 100,
  defaultWeightGrams: 500,
};

describe('parcelPrefillForMethod', () => {
  it('should return the matched rule profile in mm and g', () => {
    expect(parcelPrefillForMethod([RULE], 'm1')).toEqual({
      template: 'large',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      weightGrams: 500,
    });
  });

  it('should return null without a rule, without a profile, or without a method', () => {
    expect(parcelPrefillForMethod([RULE], 'other')).toBeNull();
    expect(parcelPrefillForMethod([{ ...RULE, parcelTemplate: null, lengthMm: null, widthMm: null, heightMm: null, defaultWeightGrams: null }], 'm1')).toBeNull();
    expect(parcelPrefillForMethod([{ ...RULE, parcelTemplate: undefined, lengthMm: undefined, widthMm: undefined, heightMm: undefined, defaultWeightGrams: undefined }], 'm1')).toBeNull();
    expect(parcelPrefillForMethod([RULE], undefined)).toBeNull();
    expect(parcelPrefillForMethod(undefined, 'm1')).toBeNull();
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
