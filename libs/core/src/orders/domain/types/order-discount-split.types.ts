/**
 * Distributing an order-level discount across its lines.
 *
 * A marketplace that reduces the ORDER total without touching any line price -
 * Allegro's coupons are the shipped case - leaves every destination with lines
 * that sum to more than the buyer paid. The invoicing mapper refuses such an
 * order outright, which is right for a fiscal document. A commercial order
 * document is different: it should record the sale, and record it at the amount
 * that changed hands.
 *
 * So this is pure division, never tax computation: an amount is cut into parts
 * that sum back to it exactly, and the rounding remainder lands on the largest
 * part rather than being lost. That is the `splitShippingAcrossRates` rule,
 * applied to a different amount.
 *
 * @module libs/core/src/orders/domain/types
 */

/** One line's share of the discount, keyed by its position in the input. */
export interface DiscountedLineAmount {
  /** The line as listed, before the order-level discount. */
  readonly grossTotal: number;
  /** What the buyer actually paid for it. Never negative. */
  readonly grossTotalAfterDiscount: number;
}

/**
 * Cut `discountTotal` across `grossTotals` in proportion to each line's share,
 * so the results sum to `Σ grossTotals − discountTotal` EXACTLY.
 *
 * Returns `null` when there is nothing to do or nothing sound to do:
 *
 *   - a non-positive or non-finite discount (nothing to distribute);
 *   - a non-positive line sum (no basis to distribute across);
 *   - a discount at least as large as the line sum, which is not a discount
 *     this function can express - it would drive a line to zero or below, and a
 *     caller must refuse rather than record a free sale.
 *
 * `null` therefore means "bill the lines as listed", which is the behaviour
 * every caller had before this existed.
 *
 * `minorUnitExponent` is the currency's, so the parts are exact in ITS smallest
 * unit rather than assuming two decimals - false for JPY and for KWD.
 */
export function distributeOrderDiscount(
  grossTotals: readonly number[],
  discountTotal: number,
  minorUnitExponent: number,
): DiscountedLineAmount[] | null {
  if (!Number.isFinite(discountTotal) || discountTotal <= 0) return null;
  if (grossTotals.length === 0) return null;
  if (!grossTotals.every((value) => Number.isFinite(value) && value >= 0)) return null;

  const factor = 10 ** minorUnitExponent;
  const minorTotals = grossTotals.map((value) => Math.round(value * factor));
  const minorSum = minorTotals.reduce((sum, value) => sum + value, 0);
  const minorDiscount = Math.round(discountTotal * factor);
  if (minorSum <= 0 || minorDiscount >= minorSum) return null;

  // Proportional share, floored, so the parts never over-subtract; the shortfall
  // is then placed on the largest line, which is where a one-unit difference is
  // least visible and where it cannot push a small line negative.
  const shares = minorTotals.map((value) => Math.floor((value * minorDiscount) / minorSum));
  const placed = shares.reduce((sum, value) => sum + value, 0);
  let remainder = minorDiscount - placed;
  if (remainder > 0) {
    let largest = 0;
    for (let i = 1; i < minorTotals.length; i += 1) {
      if (minorTotals[i] > minorTotals[largest]) largest = i;
    }
    shares[largest] = shares[largest] + remainder;
    remainder = 0;
  }

  return minorTotals.map((value, index) => ({
    grossTotal: value / factor,
    grossTotalAfterDiscount: Math.max(0, value - shares[index]) / factor,
  }));
}
