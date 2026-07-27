/**
 * checkRequiredToSell — unit spec
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { checkRequiredToSell } from '../check-required-to-sell';

describe('checkRequiredToSell', () => {
  it('should report no issues when stock, weight, and a dimension are all present', () => {
    const issues = checkRequiredToSell({ stock: 5, weight: 1.2, dimensions: { length: 10 } });

    expect(issues).toEqual([]);
  });

  it('should warn OUT_OF_STOCK when stock is zero', () => {
    const issues = checkRequiredToSell({ stock: 0, weight: 1, dimensions: { length: 1 } });

    expect(issues).toEqual([
      expect.objectContaining({ code: 'OUT_OF_STOCK', severity: 'warn', field: 'stock' }),
    ]);
  });

  it('should warn OUT_OF_STOCK when stock is negative', () => {
    const issues = checkRequiredToSell({ stock: -1, weight: 1, dimensions: { length: 1 } });

    expect(issues.map((i) => i.code)).toEqual(['OUT_OF_STOCK']);
  });

  it('should warn MISSING_WEIGHT when weight is undefined', () => {
    const issues = checkRequiredToSell({ stock: 5, dimensions: { length: 1 } });

    expect(issues).toEqual([
      expect.objectContaining({ code: 'MISSING_WEIGHT', severity: 'warn', field: 'weight' }),
    ]);
  });

  it('should warn MISSING_DIMENSIONS when dimensions are absent entirely', () => {
    const issues = checkRequiredToSell({ stock: 5, weight: 1 });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'MISSING_DIMENSIONS',
        severity: 'warn',
        field: 'commerce.dimensions',
      }),
    ]);
  });

  it('should warn MISSING_DIMENSIONS when dimensions is present but every axis is undefined', () => {
    const issues = checkRequiredToSell({ stock: 5, weight: 1, dimensions: {} });

    expect(issues.map((i) => i.code)).toEqual(['MISSING_DIMENSIONS']);
  });

  it('should treat a single populated axis (width only) as sufficient', () => {
    const issues = checkRequiredToSell({ stock: 5, weight: 1, dimensions: { width: 3 } });

    expect(issues).toEqual([]);
  });

  it('should accumulate every applicable issue', () => {
    const issues = checkRequiredToSell({ stock: 0 });

    expect(issues.map((i) => i.code).sort()).toEqual(
      ['MISSING_DIMENSIONS', 'MISSING_WEIGHT', 'OUT_OF_STOCK'].sort(),
    );
  });
});
