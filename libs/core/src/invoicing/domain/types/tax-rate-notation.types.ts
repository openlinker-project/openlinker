/**
 * Neutral Tax-Rate Notation (#2247)
 *
 * One canonical reading of `InvoiceLine.taxRate` shared by core and by every
 * provider adapter. The code is **percent-as-string**: `'23'` is twenty-three
 * percent. It is never a fraction, so `'0.23'` is not another way of writing
 * the same thing - read as a percentage it means 0.23%, and on a 123 PLN
 * invoice the two readings diverge by 22.72 PLN.
 *
 * Before this module each reader guessed. Core divided by 100 unconditionally;
 * the inFakt adapter switched on `n > 1`, so `'23'` and `'0.23'` both resolved
 * to 23% while a genuine 1% rate resolved to 100%. A guess is the wrong shape
 * for this field: the writer knows which notation it used, so an ambiguous
 * value is a defect upstream and must surface rather than be reinterpreted.
 *
 * Pure and dependency-free: no I/O, no framework, no regime knowledge. The
 * mapping from a code to a national tax symbol stays in the provider adapter
 * (ADR-026); this module only settles how the digits are read.
 *
 * @module libs/core/src/invoicing/domain/types
 * @see {@link InvoiceLine.taxRate}
 *
 * COUPLED NOTATION RULE (#1985 review): `orders`'s
 * `net-sales-tax-rate.types.ts#resolveNetSalesTaxRate` deliberately mirrors
 * this file's vocabulary rather than importing it (see that file's own
 * docblock for why), but the fractional-notation bound - a numeric value
 * strictly between 0 and 1 rejected as unresolvable - is the one piece that
 * MUST move together across both files. If this file ever starts accepting
 * fractional notation (e.g. `'0.23'`), the net-sales resolver must be updated
 * in the same commit, or orders using that notation would silently and
 * permanently drop out of every net-sales figure with no error anywhere.
 */

/**
 * Raised when a tax-rate code is written in fractional notation (a numeric
 * value strictly between 0 and 1, e.g. `'0.23'`). Rejected rather than
 * normalised: `'0.23'` is indistinguishable from a genuine 0.23% rate, so
 * silently multiplying by 100 would invent a value the writer never stated.
 */
export class FractionalTaxRateNotationError extends Error {
  constructor(public readonly taxRate: string) {
    super(
      `Tax rate "${taxRate}" is written as a fraction. The neutral contract is ` +
        `percent-as-string, so twenty-three percent is "23", not "0.23".`
    );
    this.name = 'FractionalTaxRateNotationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * True when the code is written as a fraction - numeric and strictly between
 * 0 and 1. `'0'` is excluded because a zero rate is a legitimate answer
 * (export, intra-EU, exempt goods) and carries no notation ambiguity.
 */
export function isFractionalTaxRateNotation(taxRate: string): boolean {
  const parsed = Number.parseFloat(taxRate.trim());
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1;
}

/**
 * Read a numeric tax-rate code as a **percentage**.
 *
 * Returns `null` for anything that is not a number - an empty string, or an
 * exemption code such as `zw` / `np` / `oo`, which carry no percentage at all.
 * A caller that needs a number for those must decide what they mean; this
 * function refuses to guess.
 *
 * @throws {FractionalTaxRateNotationError} on fractional notation.
 */
export function parseTaxRatePercent(taxRate: string): number | null {
  const trimmed = taxRate.trim();
  if (trimmed === '') return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (parsed > 0 && parsed < 1) throw new FractionalTaxRateNotationError(taxRate);
  return parsed;
}

/**
 * Read a numeric tax-rate code as a **fraction of one** (`'23'` -> `0.23`),
 * the form an arithmetic caller wants. Non-numeric codes return `null`, for
 * the same reason `parseTaxRatePercent` does.
 *
 * @throws {FractionalTaxRateNotationError} on fractional notation.
 */
export function taxRatePercentToFraction(taxRate: string): number | null {
  const percent = parseTaxRatePercent(taxRate);
  return percent === null ? null : percent / 100;
}

/**
 * Throw if the code uses fractional notation; otherwise return it trimmed.
 * For writers that pass a code straight through to a provider without doing
 * arithmetic on it, where the notation is still part of the contract.
 *
 * @throws {FractionalTaxRateNotationError} on fractional notation.
 */
export function assertPercentTaxRateNotation(taxRate: string): string {
  const trimmed = taxRate.trim();
  if (isFractionalTaxRateNotation(trimmed)) throw new FractionalTaxRateNotationError(taxRate);
  return trimmed;
}
