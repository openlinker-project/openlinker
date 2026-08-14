/**
 * Rate Arithmetic
 *
 * The three ways a published quote becomes a stored `rate`, plus the single
 * place the 8-decimal string form is produced.
 *
 * `number` accumulation is the repo's universal money convention and there is
 * no decimal library to adopt instead (`decimal.js`, `big.js`, `bignumber.js`,
 * `dinero` and `currency.js` all return zero hits across every `package.json`).
 * The 8-decimal store is what bounds the residual error: an inverted or pivoted
 * figure is rounded once, at the boundary, not repeatedly downstream.
 *
 * DIRECTION: every function here returns `to` units per one `from` unit, so a
 * consumer always multiplies.
 *
 * @module libs/integrations/fx/infrastructure/adapters
 */

/** Decimal places the registry stores a rate at (`numeric(18,8)`). */
export const RATE_SCALE = 8;

/**
 * Render a rate as the 8-decimal string the registry stores.
 *
 * @throws RangeError when the value is not a usable positive finite number -
 *         a zero or negative rate is nonsense for a currency quote and would
 *         otherwise be persisted as a plausible-looking `0.00000000`.
 */
export function toRateString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Refusing to store a non-positive exchange rate: ${value}`);
  }
  return value.toFixed(RATE_SCALE);
}

/**
 * The source publishes this pair as-is.
 */
export function directRate(mid: number): string {
  return toRateString(mid);
}

/**
 * The source publishes the reciprocal pair.
 *
 * e.g. NBP publishes `EUR -> PLN` at 4.2500; `PLN -> EUR` is `1 / 4.2500`.
 */
export function invertedRate(mid: number): string {
  if (!Number.isFinite(mid) || mid <= 0) {
    throw new RangeError(`Cannot invert a non-positive exchange rate: ${mid}`);
  }
  return toRateString(1 / mid);
}

/**
 * Neither side is the source's base, so two published quotes divide through it.
 *
 * Both arguments are quoted the SAME WAY relative to the pivot, which is what
 * makes the direction unambiguous:
 *
 *   NBP (`X -> PLN`):  rate(from -> to) = mid(from -> PLN) / mid(to -> PLN)
 *   ECB (`EUR -> X`):  rate(from -> to) = mid(EUR -> to)   / mid(EUR -> from)
 *
 * Worked, NBP: EUR mid 4.2500, USD mid 3.9000, reporting in USD, order in EUR
 * -> `4.2500 / 3.9000 = 1.08974359`. One EUR is 1.08974359 USD. The sanity
 * check is that EUR is worth more than USD, so the result must exceed 1 - a
 * flipped divide gives 0.917..., which is the tell.
 */
export function pivotRate(numeratorMid: number, denominatorMid: number): string {
  if (!Number.isFinite(denominatorMid) || denominatorMid <= 0) {
    throw new RangeError(`Cannot pivot through a non-positive exchange rate: ${denominatorMid}`);
  }
  return toRateString(numeratorMid / denominatorMid);
}
