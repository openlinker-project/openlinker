/**
 * WooCommerce Physical Data Spec
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 */
import { buildWooCommercePhysicalData } from './woocommerce-physical-data';

const kgCm = { weightUnit: 'kg', dimensionUnit: 'cm' };

describe('buildWooCommercePhysicalData', () => {
  it('should convert a variation own weight and dimensions to grams and millimetres', () => {
    const data = buildWooCommercePhysicalData(
      {},
      { weight: '0.7', dimensions: { length: '30', width: '20', height: '10' } },
      kgCm
    );

    expect(data).toEqual({ weightGrams: 700, lengthMm: 300, widthMm: 200, heightMm: 100 });
  });

  it('should fall back to the parent product for empty variation values', () => {
    const data = buildWooCommercePhysicalData(
      { weight: '2', dimensions: { length: '40', width: '30', height: '20' } },
      { weight: '', dimensions: { length: '', width: '', height: '' } },
      kgCm
    );

    expect(data).toEqual({ weightGrams: 2000, lengthMm: 400, widthMm: 300, heightMm: 200 });
  });

  it('should let a variation override only the fields it sets', () => {
    const data = buildWooCommercePhysicalData(
      { weight: '2', dimensions: { length: '40', width: '30', height: '20' } },
      { weight: '1', dimensions: { length: '', width: '5', height: '' } },
      kgCm
    );

    expect(data).toEqual({ weightGrams: 1000, lengthMm: 400, widthMm: 50, heightMm: 200 });
  });

  it('should use the product itself for a simple product', () => {
    expect(
      buildWooCommercePhysicalData({ weight: '500' }, undefined, { weightUnit: 'g', dimensionUnit: 'mm' })
    ).toEqual({ weightGrams: 500, lengthMm: null, widthMm: null, heightMm: null });
  });

  it('should convert pounds and inches', () => {
    const data = buildWooCommercePhysicalData(
      { weight: '1', dimensions: { length: '10' } },
      undefined,
      { weightUnit: 'lbs', dimensionUnit: 'in' }
    );

    expect(data.weightGrams).toBe(454);
    expect(data.lengthMm).toBe(254);
  });

  it('should record nothing for an unknown unit', () => {
    const data = buildWooCommercePhysicalData(
      { weight: '1', dimensions: { length: '10' } },
      undefined,
      { weightUnit: 'stone', dimensionUnit: 'furlong' }
    );

    expect(data).toEqual({ weightGrams: null, lengthMm: null, widthMm: null, heightMm: null });
  });

  it.each([['0'], ['abc'], ['-2'], [undefined]])(
    'should record null for a non-positive or unparseable value (%p)',
    (value) => {
      const data = buildWooCommercePhysicalData(
        { weight: value, dimensions: { length: value } },
        undefined,
        kgCm
      );

      expect(data.weightGrams).toBeNull();
      expect(data.lengthMm).toBeNull();
    }
  );

  it('should record nothing when the store units are unavailable', () => {
    expect(buildWooCommercePhysicalData({ weight: '1' }, undefined, null).weightGrams).toBeNull();
  });
});
