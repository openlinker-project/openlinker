/**
 * Stock Safety Buffer helper tests (#1844)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  applyStockSafetyBuffer,
  isPresentButInvalidStockSafetyBuffer,
  readStockSafetyBuffer,
  readStockZeroThreshold,
} from '../stock-safety-buffer.types';

describe('stock-safety-buffer', () => {
  describe('readStockSafetyBuffer', () => {
    it('should default to 0 when config is null or undefined', () => {
      expect(readStockSafetyBuffer(null)).toBe(0);
      expect(readStockSafetyBuffer(undefined)).toBe(0);
    });

    it('should default to 0 when the key is absent (backward compatible)', () => {
      expect(readStockSafetyBuffer({})).toBe(0);
      expect(readStockSafetyBuffer({ masterCatalogConnectionId: 'c1' })).toBe(0);
    });

    it('should read a positive numeric reserve', () => {
      expect(readStockSafetyBuffer({ stockSafetyBuffer: 5 })).toBe(5);
    });

    it('should floor a fractional reserve to whole units', () => {
      expect(readStockSafetyBuffer({ stockSafetyBuffer: 2.9 })).toBe(2);
    });

    it('should coerce non-numeric, negative, or non-finite values to 0', () => {
      expect(readStockSafetyBuffer({ stockSafetyBuffer: -3 })).toBe(0);
      expect(readStockSafetyBuffer({ stockSafetyBuffer: 0 })).toBe(0);
      expect(readStockSafetyBuffer({ stockSafetyBuffer: Number.NaN })).toBe(0);
      expect(readStockSafetyBuffer({ stockSafetyBuffer: Infinity })).toBe(0);
      expect(readStockSafetyBuffer({ stockSafetyBuffer: '5' as unknown as number })).toBe(0);
    });
  });

  describe('isPresentButInvalidStockSafetyBuffer', () => {
    it('should be false when config is null/undefined or the key is absent', () => {
      expect(isPresentButInvalidStockSafetyBuffer(null)).toBe(false);
      expect(isPresentButInvalidStockSafetyBuffer(undefined)).toBe(false);
      expect(isPresentButInvalidStockSafetyBuffer({})).toBe(false);
    });

    it('should be false when the key is explicitly null (intentional no-buffer)', () => {
      expect(
        isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: null as unknown as number })
      ).toBe(false);
    });

    it('should be false for a valid positive number', () => {
      expect(isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: 5 })).toBe(false);
      expect(isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: 2.9 })).toBe(false);
    });

    it('should be true when present but coercing to 0 (mistyped buffer)', () => {
      expect(isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: 0 })).toBe(true);
      expect(isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: -3 })).toBe(true);
      expect(isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: Number.NaN })).toBe(true);
      expect(isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: Infinity })).toBe(true);
      expect(
        isPresentButInvalidStockSafetyBuffer({ stockSafetyBuffer: '5' as unknown as number })
      ).toBe(true);
    });
  });

  describe('applyStockSafetyBuffer', () => {
    it('should pass master stock through unchanged when the reserve is 0', () => {
      expect(applyStockSafetyBuffer(10, 0)).toBe(10);
      expect(applyStockSafetyBuffer(0, 0)).toBe(0);
    });

    it('should subtract the reserve from the master stock', () => {
      expect(applyStockSafetyBuffer(10, 3)).toBe(7);
    });

    it('should floor the result at 0 when the reserve exceeds master stock', () => {
      expect(applyStockSafetyBuffer(2, 5)).toBe(0);
      expect(applyStockSafetyBuffer(0, 5)).toBe(0);
    });
  });
  describe('readStockZeroThreshold (#2610)', () => {
    it('should default to 0 when the key is absent, null or invalid', () => {
      expect(readStockZeroThreshold(null)).toBe(0);
      expect(readStockZeroThreshold({})).toBe(0);
      expect(readStockZeroThreshold({ stockZeroThreshold: '3' })).toBe(0);
      expect(readStockZeroThreshold({ stockZeroThreshold: -3 })).toBe(0);
      expect(readStockZeroThreshold({ stockZeroThreshold: 0 })).toBe(0);
    });

    it('should floor a fractional threshold', () => {
      expect(readStockZeroThreshold({ stockZeroThreshold: 3.7 })).toBe(3);
    });
  });

  describe('applyStockSafetyBuffer zero threshold (#2610)', () => {
    it('should leave the quantity unchanged when the threshold is 0 (off)', () => {
      expect(applyStockSafetyBuffer(3, 0, 0)).toBe(3);
      expect(applyStockSafetyBuffer(3, 0)).toBe(3);
    });

    it('should publish 0 when the buffered quantity is below the threshold', () => {
      expect(applyStockSafetyBuffer(3, 0, 4)).toBe(0);
      expect(applyStockSafetyBuffer(10, 8, 4)).toBe(0);
    });

    it('should publish the buffered quantity at or above the threshold', () => {
      expect(applyStockSafetyBuffer(4, 0, 4)).toBe(4);
      expect(applyStockSafetyBuffer(10, 2, 4)).toBe(8);
    });
  });
});
