/**
 * Stock Safety Buffer helper tests (#1844)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  applyStockSafetyBuffer,
  readStockSafetyBuffer,
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
});
