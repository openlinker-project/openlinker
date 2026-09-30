/**
 * Parcel profile helpers tests (#3652)
 *
 * @module apps/web/src/features/mappings/lib
 */
import { describe, expect, it } from 'vitest';
import {
  cmToMm,
  draftFromFields,
  draftToFields,
  gramsToKg,
  kgToGrams,
  mmToCm,
  summarizeParcelProfile,
  validateDraft,
  EMPTY_PARCEL_DRAFT,
} from './parcel-profile';

describe('parcel profile unit conversion', () => {
  it('should convert cm to mm and kg to g on the way out', () => {
    expect(cmToMm('30')).toBe(300);
    expect(cmToMm('12,5')).toBe(125);
    expect(kgToGrams('0.5')).toBe(500);
    expect(kgToGrams('1,25')).toBe(1250);
    expect(cmToMm('')).toBeNull();
  });

  it('should convert mm to cm and g to kg on the way in', () => {
    expect(mmToCm(300)).toBe('30');
    expect(mmToCm(125)).toBe('12.5');
    expect(gramsToKg(500)).toBe('0.5');
    expect(mmToCm(null)).toBe('');
  });

  it('should round-trip a stored profile through the draft unchanged', () => {
    const stored = {
      parcelTemplate: 'medium',
      lengthMm: 305,
      widthMm: 200,
      heightMm: 100,
      defaultWeightGrams: 1250,
    };
    expect(draftToFields(draftFromFields(stored))).toEqual(stored);
  });

  it('should produce all-null fields for an empty draft so a clear is explicit', () => {
    expect(draftToFields(EMPTY_PARCEL_DRAFT)).toEqual({
      parcelTemplate: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      defaultWeightGrams: null,
    });
  });
});

describe('validateDraft', () => {
  it('should accept an empty draft and a full box', () => {
    expect(validateDraft(EMPTY_PARCEL_DRAFT)).toBeNull();
    expect(
      validateDraft({ ...EMPTY_PARCEL_DRAFT, lengthCm: '30', widthCm: '20', heightCm: '10' }),
    ).toBeNull();
  });

  it('should refuse a partial box and non-positive values', () => {
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, lengthCm: '30' })).toMatch(/together/);
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, weightKg: '0' })).toMatch(/greater than zero/);
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, weightKg: '-1' })).toMatch(/greater than zero/);
  });
});

describe('summarizeParcelProfile', () => {
  it('should render box and weight on one line', () => {
    expect(
      summarizeParcelProfile({ lengthMm: 300, widthMm: 200, heightMm: 100, defaultWeightGrams: 500 }),
    ).toBe('Box 30 x 20 x 10 cm, 0.5 kg');
  });

  it('should include the size template and return null when nothing is set', () => {
    expect(summarizeParcelProfile({ parcelTemplate: 'large' })).toBe('Size large');
    expect(summarizeParcelProfile({})).toBeNull();
    expect(summarizeParcelProfile(null)).toBeNull();
  });
});
