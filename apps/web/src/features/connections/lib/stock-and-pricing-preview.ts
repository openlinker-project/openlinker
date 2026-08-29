/**
 * Stock and pricing preview (#2610)
 *
 * Hand-maintained frontend mirror of the two pure publish-policy helpers in
 * `@openlinker/core/identifier-mapping`:
 *   - `applyStockSafetyBuffer` (stock-safety-buffer.types.ts, #1844 / #2610)
 *   - `applyPricingRule` + its `applyRounding` / `round2dp` helpers
 *     (pricing-rule.types.ts, #1843)
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so these
 * functions exist twice. The copy is kept identical by
 * `scripts/check-stock-and-pricing-preview-mirror.mjs` under
 * `pnpm check:invariants`, following the `shipping-tax-split` precedent - a
 * preview computed by different arithmetic than the publish path is worse than
 * no preview, because the operator acts on the number it shows.
 *
 * These functions are for the worked example on the connection form only.
 * Nothing on the frontend publishes anything; the backend remains the authority.
 *
 * @module features/connections/lib
 */

/** Mirrors `PriceRoundingMode` (`@openlinker/core/identifier-mapping`). */
export type PriceRoundingMode = 'none' | 'nearestWhole' | 'endingIn99';

/** Mirrors `PricingRule` (`@openlinker/core/identifier-mapping`). */
export interface PricingRule {
  type: 'passthrough' | 'markup' | 'margin';
  percent?: number;
  rounding?: PriceRoundingMode;
}

// MIRROR START applyStockSafetyBuffer
export function applyStockSafetyBuffer(
  masterStock: number,
  reserve: number,
  zeroThreshold = 0
): number {
  const published = Math.max(0, masterStock - reserve);
  if (zeroThreshold > 0 && published < zeroThreshold) {
    return 0;
  }
  return published;
}
// MIRROR END applyStockSafetyBuffer

// MIRROR START applyPricingRule
export function applyPricingRule(basePrice: number, rule: PricingRule | null): number {
  if (!rule) {
    return basePrice;
  }
  const percent = rule.percent ?? 0;
  let resolved = basePrice;
  if (rule.type === 'markup') {
    resolved = basePrice * (1 + percent / 100);
  } else if (rule.type === 'margin') {
    // percent >= 100 makes the denominator <= 0 (undefined margin formula);
    // degrade to the base price rather than producing Infinity/a negative price.
    resolved = percent >= 100 ? basePrice : basePrice / (1 - percent / 100);
  }
  return applyRounding(resolved, rule.rounding ?? 'none');
}
// MIRROR END applyPricingRule

// MIRROR START applyRounding
function applyRounding(value: number, mode: PriceRoundingMode): number {
  switch (mode) {
    case 'nearestWhole':
      return Math.round(value);
    case 'endingIn99': {
      const roundedUp = Math.max(0, Math.ceil(value));
      return round2dp(roundedUp - 0.01);
    }
    case 'none':
    default:
      return round2dp(value);
  }
}
// MIRROR END applyRounding

// MIRROR START round2dp
function round2dp(value: number): number {
  return Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100);
}
// MIRROR END round2dp
