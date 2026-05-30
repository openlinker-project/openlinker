/**
 * Unit tests for largest-remainder allocation.
 *
 * @module money
 */
import { allocateByLargestRemainder } from '../allocate-by-largest-remainder';

describe('allocateByLargestRemainder', () => {
  it('should return an empty array when there are no weights', () => {
    expect(allocateByLargestRemainder(0, [])).toEqual([]);
    expect(allocateByLargestRemainder(100, [])).toEqual([]);
  });

  it('should preserve the total exactly for an even split', () => {
    const parts = allocateByLargestRemainder(100, [1, 1]);
    expect(parts).toEqual([50, 50]);
    expect(sum(parts)).toBe(100);
  });

  it('should hand the leftover unit to the largest fractional remainder', () => {
    // 100 / 3 = 33.33 each → floors [33,33,33], remainder 1 → lowest index wins on the tie
    const parts = allocateByLargestRemainder(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(sum(parts)).toBe(100);
  });

  it('should allocate proportionally to weights and sum exactly', () => {
    // total 1000 across weights 1:2:7 → 100 : 200 : 700
    const parts = allocateByLargestRemainder(1000, [1, 2, 7]);
    expect(parts).toEqual([100, 200, 700]);
    expect(sum(parts)).toBe(1000);
  });

  it('should distribute the residual by largest remainder for uneven proportions', () => {
    // exact shares: 10*1/6=1.666, 10*2/6=3.333, 10*3/6=5.0
    // floors [1,3,5] sum 9, remainder 1 → largest frac is index 0 (0.666)
    const parts = allocateByLargestRemainder(10, [1, 2, 3]);
    expect(parts).toEqual([2, 3, 5]);
    expect(sum(parts)).toBe(10);
  });

  it('should spread evenly when every weight is zero', () => {
    const parts = allocateByLargestRemainder(10, [0, 0, 0]);
    expect(parts).toEqual([4, 3, 3]);
    expect(sum(parts)).toBe(10);
  });

  it('should handle a single part by giving it the whole total', () => {
    expect(allocateByLargestRemainder(999, [5])).toEqual([999]);
  });

  it('should handle a zero total', () => {
    const parts = allocateByLargestRemainder(0, [3, 7]);
    expect(parts).toEqual([0, 0]);
    expect(sum(parts)).toBe(0);
  });

  it('should be deterministic across runs for tied remainders', () => {
    const a = allocateByLargestRemainder(100, [1, 1, 1]);
    const b = allocateByLargestRemainder(100, [1, 1, 1]);
    expect(a).toEqual(b);
  });

  it('should throw when the total is negative', () => {
    expect(() => allocateByLargestRemainder(-1, [1])).toThrow(RangeError);
  });

  it('should throw when the total is not an integer', () => {
    expect(() => allocateByLargestRemainder(1.5, [1])).toThrow(RangeError);
  });

  it('should throw when a weight is negative', () => {
    expect(() => allocateByLargestRemainder(100, [1, -1])).toThrow(RangeError);
  });

  it('should throw when a weight is not an integer', () => {
    expect(() => allocateByLargestRemainder(100, [1, 2.5])).toThrow(RangeError);
  });
});

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
