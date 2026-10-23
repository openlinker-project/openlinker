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
  isListedParcelTemplate,
  kgToGrams,
  mmToCm,
  summarizeParcelProfile,
  validateDraft,
  EMPTY_PARCEL_DRAFT,
  PARCEL_PROFILE_LIMITS,
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

  it('should accept values exactly at the server ceilings when they are entered in cm and kg', () => {
    expect(
      validateDraft({
        ...EMPTY_PARCEL_DRAFT,
        lengthCm: String(PARCEL_PROFILE_LIMITS.dimensionCmMax),
        widthCm: '1',
        heightCm: '1',
        weightKg: String(PARCEL_PROFILE_LIMITS.weightKgMax),
      }),
    ).toBeNull();
  });

  it('should refuse a dimension above the ceiling when it is one digit too long', () => {
    expect(
      validateDraft({ ...EMPTY_PARCEL_DRAFT, lengthCm: '30', widthCm: '20', heightCm: '1000' }),
    ).toBe('Length, width and height must each be 500 cm or less.');
    // 500.1 cm rounds to 5001 mm, which the server's @Max(5000) refuses.
    expect(
      validateDraft({ ...EMPTY_PARCEL_DRAFT, lengthCm: '500,1', widthCm: '20', heightCm: '10' }),
    ).toMatch(/500 cm or less/);
  });

  it('should refuse a weight above the ceiling when it exceeds 100 kg', () => {
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, weightKg: '100.001' })).toBe(
      'Weight must be 100 kg or less.',
    );
  });

  it('should refuse a size code longer than the server allows when it is typed', () => {
    const tooLong = 'x'.repeat(PARCEL_PROFILE_LIMITS.templateMaxLength + 1);
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, template: tooLong }, { customTemplate: true })).toBe(
      'The size code must be 32 characters or fewer.',
    );
    const atLimit = 'x'.repeat(PARCEL_PROFILE_LIMITS.templateMaxLength);
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, template: atLimit }, { customTemplate: true })).toBeNull();
  });

  it('should refuse an empty carrier code when the operator chose to type one', () => {
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, template: '  ' }, { customTemplate: true })).toMatch(
      /Enter the carrier size code/,
    );
    expect(validateDraft({ ...EMPTY_PARCEL_DRAFT, template: '  ' })).toBeNull();
  });
});

describe('parcel template codes', () => {
  it('should tell the listed sizes from a free-text carrier code', () => {
    expect(isListedParcelTemplate('medium')).toBe(true);
    expect(isListedParcelTemplate('A')).toBe(false);
  });

  it('should send a typed carrier code trimmed', () => {
    expect(draftToFields({ ...EMPTY_PARCEL_DRAFT, template: ' paczkomat-A ' }).parcelTemplate).toBe(
      'paczkomat-A',
    );
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
