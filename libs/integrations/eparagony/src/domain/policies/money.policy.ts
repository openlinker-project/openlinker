/**
 * Money Policy
 *
 * The neutral command carries decimal MAJOR units (`unitPriceGross: 49.01`); the
 * vendor takes integer MINOR units (`unitPrice: 4901`). One conversion, in one
 * place, so no adapter file open-codes a `* 100`.
 *
 * The conversion rounds half-away-from-zero at the minor unit. That is not a
 * pricing decision: the amount is already the buyer-paid gross the source
 * reported, and a binary float carrying `49.01` is `49.009999...`, so truncation
 * would understate the sale by a grosz. Rounding is how the same number is
 * transmitted, not how it is computed.
 *
 * Pure - no I/O, no framework.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */

/** Minor units per major unit. Fixed at 2 - every currency a fiscal device in this regime books is. */
const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Convert a decimal major-unit amount to integer minor units.
 *
 * Returns `null` for anything not finite, so a caller decides how to react
 * rather than silently transmitting a `NaN`.
 */
export function toMinorUnits(amount: number): number | null {
  if (!Number.isFinite(amount)) {
    return null;
  }
  // Scaling first re-introduces the binary artefact it is meant to remove:
  // `1.005 * 100` is `100.49999999999999`, which rounds DOWN. Collapsing the
  // artefact at a precision well beyond any real amount, before rounding,
  // makes the conversion agree with the decimal the source actually reported.
  const scaled = Number((Math.abs(amount) * MINOR_UNITS_PER_MAJOR).toFixed(4));
  // `Math.round` breaks ties towards +Infinity, which is asymmetric for negative
  // amounts (a rebate line). Round the magnitude and restore the sign.
  const rounded = Math.sign(amount) * Math.round(scaled);
  // `-0` would serialize as `-0` in JSON; normalize it away.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Format a quantity for the vendor's `quantity` field: a decimal string matching
 * `^([0-9]{1,22}[.]?[0-9]{1,8})$`. Returns `null` for a non-positive or
 * non-finite quantity, which is not registrable.
 */
export function toQuantityString(quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  // Fixed to the vendor's maximum fractional precision, then trimmed so an
  // integral quantity reads `1` rather than `1.00000000`.
  const fixed = quantity.toFixed(8);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.length === 0 ? null : trimmed;
}
