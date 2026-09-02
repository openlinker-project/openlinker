/**
 * Worklist paging vocabulary — specs (#2406, `W3a-19`)
 *
 * Both clamps exist so the value the page REPORTS and the value the repository
 * APPLIES are one function with two callers. These pin the coercions that make
 * that safe against an untrusted caller.
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import {
  clampWorklistLimit,
  clampWorklistOffset,
  FULFILLMENT_WORKLIST_DEFAULT_LIMIT,
  FULFILLMENT_WORKLIST_MAX_LIMIT,
} from './fulfillment-worklist-page.types';

describe('clampWorklistLimit', () => {
  it('should cap at the domain ceiling', () => {
    expect(clampWorklistLimit(9999)).toBe(FULFILLMENT_WORKLIST_MAX_LIMIT);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -5])(
    'should take the DEFAULT, not the maximum, for the unusable value %p',
    (value) => {
      // The safe reading of a caller mistake is the small page — taking the
      // maximum would let a typo ask for the largest read the API allows.
      expect(clampWorklistLimit(value)).toBe(
        FULFILLMENT_WORKLIST_DEFAULT_LIMIT
      );
    }
  );

  it('should pass a usable limit through, truncated', () => {
    expect(clampWorklistLimit(25.9)).toBe(25);
  });
});

describe('clampWorklistOffset', () => {
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, -0.5])(
    'should take the first page for the unusable value %p',
    (value) => {
      expect(clampWorklistOffset(value)).toBe(0);
    }
  );

  it('should pass a usable offset through, truncated', () => {
    expect(clampWorklistOffset(50.9)).toBe(50);
  });

  it('should not silently become a limit', () => {
    // No ceiling here on purpose: a deep page is legitimate, and capping the
    // offset would silently re-serve page 1 to someone paging past the cap.
    expect(clampWorklistOffset(100_000)).toBe(100_000);
  });
});
