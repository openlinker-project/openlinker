/**
 * PrestaShop Physical Data Spec
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import {
  buildPrestashopPhysicalData,
  convertPrestashopDimensionToMm,
  convertPrestashopWeightToGrams,
} from './prestashop-physical-data';

describe('convertPrestashopWeightToGrams', () => {
  it('should convert a kg product weight to grams', () => {
    expect(convertPrestashopWeightToGrams('0.5', undefined, 'kg')).toBe(500);
  });

  it('should keep a gram product weight as grams', () => {
    expect(convertPrestashopWeightToGrams('500', undefined, 'g')).toBe(500);
  });

  it('should add the combination impact to the product weight', () => {
    expect(convertPrestashopWeightToGrams('0.5', '0.2', 'kg')).toBe(700);
  });

  it('should apply a negative impact', () => {
    expect(convertPrestashopWeightToGrams('0.5', '-0.1', 'kg')).toBe(400);
  });

  it('should return null for an unknown unit', () => {
    expect(convertPrestashopWeightToGrams('1', undefined, 'stone')).toBeNull();
  });

  it('should return null when no unit is configured', () => {
    expect(convertPrestashopWeightToGrams('1', undefined, null)).toBeNull();
  });

  it.each([['0'], [''], ['abc'], [undefined], [-3]])(
    'should return null for a non-positive or unparseable weight (%p)',
    (value) => {
      expect(convertPrestashopWeightToGrams(value, undefined, 'kg')).toBeNull();
    }
  );

  it('should return null when the impact cancels the product weight', () => {
    expect(convertPrestashopWeightToGrams('0.5', '-0.5', 'kg')).toBeNull();
  });

  it('should match the unit case-insensitively', () => {
    expect(convertPrestashopWeightToGrams('2', undefined, ' KG ')).toBe(2000);
  });
});

describe('convertPrestashopDimensionToMm', () => {
  it.each([
    ['30', 'cm', 300],
    ['1.5', 'm', 1500],
    ['250', 'mm', 250],
  ])('should convert %s %s to %d mm', (value, unit, expected) => {
    expect(convertPrestashopDimensionToMm(value, unit)).toBe(expected);
  });

  it('should return null for an unknown unit, zero or garbage', () => {
    expect(convertPrestashopDimensionToMm('10', 'furlong')).toBeNull();
    expect(convertPrestashopDimensionToMm('0', 'cm')).toBeNull();
    expect(convertPrestashopDimensionToMm('x', 'cm')).toBeNull();
  });
});

describe('buildPrestashopPhysicalData', () => {
  const units = { weightUnit: 'kg', dimensionUnit: 'cm' };

  it('should map depth to length and inherit product dimensions for a combination', () => {
    const data = buildPrestashopPhysicalData(
      { weight: '0.5', width: '20', height: '10', depth: '30' },
      '0.2',
      units
    );

    expect(data).toEqual({ weightGrams: 700, lengthMm: 300, widthMm: 200, heightMm: 100 });
  });

  it('should record nothing when the shop units are unknown', () => {
    expect(buildPrestashopPhysicalData({ weight: '1', width: '1' }, undefined, null)).toEqual({
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
    });
  });
});
