/**
 * Rate Arithmetic Tests
 *
 * @module libs/integrations/fx/infrastructure/adapters/__tests__
 */
import { directRate, invertedRate, pivotRate, toRateString } from '../rate-arithmetic';

describe('rate arithmetic', () => {
  describe('toRateString', () => {
    it('should render at exactly 8 decimal places', () => {
      expect(toRateString(4.25)).toBe('4.25000000');
      expect(toRateString(171.35)).toBe('171.35000000');
    });

    it('should round at the 8th decimal place', () => {
      expect(toRateString(1.089743589743)).toBe('1.08974359');
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'should refuse the non-positive or non-finite value %p',
      (value) => {
        // A zero rate would persist as a plausible-looking 0.00000000 and
        // silently zero every figure derived from it.
        expect(() => toRateString(value)).toThrow(RangeError);
      }
    );
  });

  describe('directRate', () => {
    it('should return the published mid unchanged', () => {
      expect(directRate(4.2712)).toBe('4.27120000');
    });
  });

  describe('invertedRate', () => {
    it('should return the reciprocal', () => {
      expect(invertedRate(4)).toBe('0.25000000');
      expect(invertedRate(4.25)).toBe('0.23529412');
    });

    it('should round-trip within the 8-decimal bound', () => {
      const forward = Number(directRate(4.25));
      const back = Number(invertedRate(4.25));
      expect(forward * back).toBeCloseTo(1, 7);
    });

    it('should refuse a non-positive mid', () => {
      expect(() => invertedRate(0)).toThrow(RangeError);
    });
  });

  describe('pivotRate', () => {
    it('should produce the documented worked example', () => {
      // EUR mid 4.2500, USD mid 3.9000, reporting in USD, order in EUR.
      // Sanity: EUR is worth more than USD, so the result must exceed 1 - a
      // flipped divide gives 0.917..., which is the tell.
      expect(pivotRate(4.25, 3.9)).toBe('1.08974359');
      expect(Number(pivotRate(4.25, 3.9))).toBeGreaterThan(1);
    });

    it('should be the reciprocal of the flipped pair', () => {
      const forward = Number(pivotRate(4.25, 3.9));
      const reverse = Number(pivotRate(3.9, 4.25));
      expect(forward * reverse).toBeCloseTo(1, 7);
    });

    it('should refuse a non-positive denominator', () => {
      expect(() => pivotRate(4.25, 0)).toThrow(RangeError);
    });
  });
});
