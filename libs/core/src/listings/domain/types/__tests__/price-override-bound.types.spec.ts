/**
 * @module libs/core/src/listings/domain/types/__tests__
 */
import {
  PRICE_OVERRIDE_MAX_FACTOR,
  checkPriceOverrideBound,
} from '../price-override-bound.types';

describe('checkPriceOverrideBound (#3222)', () => {
  it('accepts the rule-computed price itself', () => {
    expect(checkPriceOverrideBound(399, 399)).toEqual({ outcome: 'ok' });
  });

  it('refuses the 100x typo this exists to catch, naming the bound it crossed', () => {
    // 39900 for a 399 item — the review's own example.
    expect(checkPriceOverrideBound(39_900, 399)).toEqual({ outcome: 'too-high', limit: 3990 });
  });

  it('refuses a misplaced decimal in the other direction', () => {
    expect(checkPriceOverrideBound(3.99, 399)).toEqual({ outcome: 'too-low', limit: 39.9 });
  });

  it('accepts a large but plausible correction — a mispriced item can need 3x', () => {
    expect(checkPriceOverrideBound(1197, 399)).toEqual({ outcome: 'ok' });
    expect(checkPriceOverrideBound(133, 399)).toEqual({ outcome: 'ok' });
  });

  it('is inclusive at both bounds, so the limit itself is publishable', () => {
    expect(checkPriceOverrideBound(3990, 399)).toEqual({ outcome: 'ok' });
    expect(checkPriceOverrideBound(39.9, 399)).toEqual({ outcome: 'ok' });
  });

  it('accepts anything when there is no usable baseline — nothing to be disproportionate to', () => {
    // Refusing here would block the operator from correcting precisely the
    // episode whose computed price the system failed to produce.
    for (const baseline of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkPriceOverrideBound(39_900, baseline as number | null)).toEqual({ outcome: 'ok' });
    }
  });

  it("contains the browser's own warn threshold, so the form can never submit what the server refuses", () => {
    // `DEVIATION_WARN_THRESHOLD = 0.3` in edit-price-change-dialog.tsx warns
    // at ±30% and lets the operator publish. A server band NARROWER than that
    // would refuse work the form invited — the #2240 rule. Asserted rather
    // than left to whoever edits one of the two constants next.
    const BROWSER_WARN_THRESHOLD = 0.3;
    const base = 399;
    const widestFormAllows = base * (1 + BROWSER_WARN_THRESHOLD);
    const narrowestFormAllows = base * (1 - BROWSER_WARN_THRESHOLD);

    expect(checkPriceOverrideBound(widestFormAllows, base).outcome).toBe('ok');
    expect(checkPriceOverrideBound(narrowestFormAllows, base).outcome).toBe('ok');
    expect(PRICE_OVERRIDE_MAX_FACTOR).toBeGreaterThan(1 + BROWSER_WARN_THRESHOLD);
  });
});
