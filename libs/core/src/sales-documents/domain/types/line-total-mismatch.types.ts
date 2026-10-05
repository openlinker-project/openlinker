/**
 * Line-vs-Total Mismatch Diagnosis
 *
 * When an order's lines do not sum to the total it reports, BOTH document
 * contexts refuse - an invoice may not state an amount its own lines
 * contradict, and a fiscal registration may not transmit lines that contradict
 * their own total. A fiscal receipt is not an invoice, so neither context could
 * own this sentence for the other; it lives here for the same reason
 * `splitShippingAcrossRates` and `isTaxRateEnforced` do.
 *
 * It DIAGNOSES; it never decides. The refusal itself stays with each mapper,
 * because each throws its own error type and each states its own consequence.
 *
 * @module libs/core/src/sales-documents/domain/types
 */

/**
 * Name the whole-order discount as the cause of a line-vs-total gap, when it
 * is one.
 *
 * Three outcomes, and the middle one is why the function exists:
 *
 *   - the source reported no usable discount, so nothing is added. Saying
 *     "possibly a discount" on no evidence would send an operator looking for
 *     something that may not be there.
 *   - the discount is EXACTLY the gap, within the currency's own rounding
 *     tolerance. This is the common shape - a marketplace coupon applied to the
 *     order and to none of its lines - and naming it turns an arithmetic
 *     complaint into an instruction.
 *   - a discount exists but does not account for the gap. Reported as such,
 *     rather than claimed to be the cause: a partial explanation offered as a
 *     whole one is worse than none, because it stops the search early.
 *
 * Returns a fragment that appends to a refusal message, or `''`.
 */
export function describeDiscountCause(
  discountTotal: number | undefined,
  gap: number,
  epsilon: number,
): string {
  if (typeof discountTotal !== 'number' || !Number.isFinite(discountTotal) || discountTotal <= 0) {
    return '';
  }
  if (Math.abs(gap - discountTotal) <= epsilon) {
    return (
      `. The source reports a whole-order discount of ${discountTotal.toFixed(2)}, which is ` +
      `exactly the difference: it was applied to the order but to none of its lines, so there ` +
      `is no line for it to be invoiced against`
    );
  }
  return (
    `. The source also reports a whole-order discount of ${discountTotal.toFixed(2)}, which ` +
    `does not by itself account for the difference`
  );
}
