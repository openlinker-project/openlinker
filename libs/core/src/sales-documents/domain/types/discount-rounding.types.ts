/**
 * Discount rounding reconciliation (#3543, E-45)
 *
 * Pure arithmetic over figures the source reported; computes no tax (ADR-063).
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { minorUnitExponentFor, quantityScaledReconciliationEpsilon } from './shipping-tax-split.types';

/** The slice of a document line this reconciliation reads and rewrites. */
export interface DiscountRoundingLine {
  quantity: number;
  unitPriceGross: number;
}

/** The slice of the order totals it needs. */
export interface DiscountRoundingTotals {
  total: number;
  currency?: string | null;
  discountTotal?: number;
}

/**
 * Make a discounted order's lines add up to its total EXACTLY (#3543, E-45).
 *
 * A whole-order discount leaves a goods line whose discounted gross total is not
 * divisible by its quantity in minor units, and a document line carries only a
 * per-unit price, so `round(total / qty) * qty` drifts from the buyer-paid total
 * by up to half a minor unit per unit (170.81 over 3 units issued as 3 x 56.94 =
 * 170.82). The drift is inside the reconciliation tolerance, so nothing refused
 * it, but the issued document then stated an amount the buyer never paid.
 *
 * Scoped to orders carrying a `discountTotal`, where the figure is ours to
 * restate; an undiscounted order keeps the source's own per-unit figures.
 * Prefers moving the gap onto a single-unit goods line (no extra document line);
 * otherwise splits the largest multi-unit line into `n-1` units at the rounded
 * price plus one unit carrying the difference. Shipping lines are never touched:
 * the discount is distributed over goods only. A gap beyond the tolerance is
 * left for `assertLinesSumToTotal` to refuse.
 */
export function reconcileDiscountRounding<T extends DiscountRoundingLine>(
  lines: readonly T[],
  goodsLineCount: number,
  totals: DiscountRoundingTotals
): T[] {
  const result = [...lines];
  if (!(totals.discountTotal !== undefined && totals.discountTotal > 0)) return result;
  if (!Number.isFinite(totals.total)) return result;
  const exponent = minorUnitExponentFor(totals.currency);
  const factor = 10 ** exponent;
  const toMinor = (value: number): number => Math.round(value * factor);
  const summedMinor = result.reduce(
    (sum, line) => sum + line.quantity * toMinor(line.unitPriceGross),
    0
  );
  const gapMinor = toMinor(totals.total) - summedMinor;
  if (gapMinor === 0) return result;
  const totalQuantity = result.reduce((sum, line) => sum + line.quantity, 0);
  if (Math.abs(gapMinor) > quantityScaledReconciliationEpsilon(totals.currency, totalQuantity) * factor) {
    return result;
  }
  const goodsIndexes = Array.from({ length: Math.min(goodsLineCount, result.length) }, (_, i) => i);
  const fromMinor = (value: number): number => Number((value / factor).toFixed(exponent));

  const single = goodsIndexes.find(
    (index) => result[index].quantity === 1 && toMinor(result[index].unitPriceGross) + gapMinor > 0
  );
  if (single !== undefined) {
    result[single] = {
      ...result[single],
      unitPriceGross: fromMinor(toMinor(result[single].unitPriceGross) + gapMinor),
    };
    return result;
  }

  const multi = goodsIndexes
    .filter(
      (index) =>
        Number.isInteger(result[index].quantity) &&
        result[index].quantity > 1 &&
        toMinor(result[index].unitPriceGross) + gapMinor > 0
    )
    .sort((a, b) => result[b].quantity - result[a].quantity)[0];
  if (multi === undefined) return result;
  const line = result[multi];
  const adjusted: T = {
    ...line,
    quantity: 1,
    unitPriceGross: fromMinor(toMinor(line.unitPriceGross) + gapMinor),
  };
  result.splice(multi, 1, { ...line, quantity: line.quantity - 1 }, adjusted);
  return result;
}
