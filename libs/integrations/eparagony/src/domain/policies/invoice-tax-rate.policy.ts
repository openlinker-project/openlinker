/**
 * Invoice Tax-Rate Policy
 *
 * Resolves the neutral percent-as-string `InvoiceLine.taxRate` onto the closed
 * vocabulary an eparagony.pl INVOICE line takes.
 *
 * WHY THIS IS A SECOND POLICY AND NOT A REUSE OF `tax-rate.policy.ts`. The two
 * vocabularies answer different questions about different documents. A receipt
 * line names the SLOT the seller's fiscal device has a rate programmed into
 * (`A`..`G`, plus a merchant-level letter -> rate table on every document); an
 * invoice line names the RATE, from a closed eleven-value set the vendor defines
 * (`23`, `8`, `5`, `3`, `ZRD`, `ZRICS`, `ZRE`, `EP`, `RCP`, `NS1`, `NS2`). There
 * is no device, no slot table and no `defaultTaxRateCode` on this path, so the
 * letter policy cannot be reused, extended or parameterised into serving both -
 * the answer it returns is the wrong KIND of answer.
 *
 * THREE CONSEQUENCES OF THAT FOLLOW, AND ALL THREE ARE DELIBERATE.
 *
 * 1. **There is no fallback and no default rate.** The receipt path may fall
 *    back to `defaultTaxRateCode` because that setting describes the seller's
 *    own device, which OpenLinker cannot observe. An invoice has no such
 *    setting, and inventing one would be OpenLinker choosing a tax rate for a
 *    document the seller is answerable for - exactly what ADR-063 forbids. An
 *    unresolvable rate therefore BLOCKS, unconditionally, and does not consult
 *    `OL_TAX_RATE_STRICT_ENABLED`: that switch exists so an adapter with its own
 *    regime default keeps issuing while a catalogue's rates are filled in, and
 *    this adapter has no default to fall back to.
 *
 * 2. **A vendor code is accepted VERBATIM.** `ZRICS`, `ZRE` and `NS2` name
 *    distinctions the neutral vocabulary cannot express - intra-community supply
 *    against export against domestic zero-rating, procedure II against procedure
 *    I. Passing a vendor code through is the escape hatch that makes the two
 *    defaults in (3) safe: an operator or a source that needs the distinction can
 *    state it, so choosing a default for the general case never traps the
 *    specific one.
 *
 * 3. **Two neutral codes resolve to the vendor's own stated general case.**
 *    `0` resolves to `ZRD`, because the vendor's own contract says of it: "use as
 *    the default 0% rate". `np` resolves to `NS1`, which the contract describes
 *    as out-of-scope supply generally, excluding the narrow statutory case `NS2`
 *    names. Neither is OpenLinker inferring a rate - the rate arrived on the
 *    line; what is being resolved is which of the regime's codes expresses it,
 *    which is regime translation and therefore this file's job.
 *
 * Pure - no I/O, no framework.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */
import { isFractionalTaxRateNotation } from '@openlinker/core/invoicing';

import {
  EparagonyInvoiceTaxRateValues,
  EparagonyTaxedInvoiceRateValues,
  type EparagonyInvoiceTaxRate,
  type EparagonyTaxedInvoiceRate,
} from '../types/eparagony-api.types';

/**
 * Percent -> vendor code for the four rates that carry tax. Keyed numerically so
 * `23`, `23.0` and `23%` are one rate, the way the receipt policy already
 * compares percentages.
 */
const TAXED_RATE_BY_PERCENT: ReadonlyMap<number, EparagonyTaxedInvoiceRate> = new Map([
  [23, '23'],
  [8, '8'],
  [5, '5'],
  [3, '3'],
]);

/**
 * Neutral exemption markers -> vendor code. `zw` (exempt) and `oo` (reverse
 * charge) are unambiguous; `np` takes the general out-of-scope code per (3)
 * above. Compared upper-cased, so the neutral lower-case spellings and an
 * operator's upper-case one resolve identically.
 */
const CODE_BY_EXEMPTION_MARKER: Readonly<Record<string, EparagonyInvoiceTaxRate>> = {
  ZW: 'EP',
  OO: 'RCP',
  NP: 'NS1',
};

/**
 * Fraction of one for each vendor code - the multiplier a gross-to-net split
 * uses. Every non-percentage code is `0`: a zero-rated, exempt, out-of-scope or
 * reverse-charge group carries net value and no tax.
 */
const FRACTION_BY_CODE: Readonly<Record<EparagonyInvoiceTaxRate, number>> = {
  '23': 0.23,
  '8': 0.08,
  '5': 0.05,
  '3': 0.03,
  ZRD: 0,
  ZRICS: 0,
  ZRE: 0,
  EP: 0,
  RCP: 0,
  NS1: 0,
  NS2: 0,
};

/**
 * Resolve a neutral rate onto the vendor's invoice vocabulary.
 *
 * `null` means the rate is not expressible as an invoice rate and the document
 * must be blocked. The three arms, in order:
 *
 *   1. A vendor code, verbatim (case-insensitive) - the escape hatch of (2).
 *   2. A percentage, matched numerically. `0` takes the vendor's stated default
 *      zero-rate code.
 *   3. A neutral exemption marker.
 *
 * Fractional notation (`0.23`) is refused rather than reinterpreted, which is
 * the neutral contract's own rule (#2247): read as a percentage it means 0.23%,
 * and nothing in the value says which the writer meant. It is detected with the
 * non-throwing `isFractionalTaxRateNotation` so the refusal surfaces as this
 * function's `null` - and therefore as a pre-call block with nothing sent -
 * rather than as a `FractionalTaxRateNotationError` carrying no failure mode,
 * which core would have to classify as in-doubt.
 */
export function resolveInvoiceTaxRateCode(neutralRate: string): EparagonyInvoiceTaxRate | null {
  const raw = neutralRate.trim();
  if (raw.length === 0) {
    // No rate at all. There is nothing to fall back to - see (1) above.
    return null;
  }

  const upper = raw.toUpperCase();
  if (isInvoiceTaxRateCode(upper)) {
    return upper;
  }

  if (isFractionalTaxRateNotation(raw)) {
    return null;
  }

  // `Number('')` is `0`, so a value that is nothing but a percent sign would
  // otherwise resolve to a zero rate. Strip first, then require something left.
  const stripped = normalizeDecimalSeparator(upper.replace('%', '').trim());
  const percent = Number(stripped);
  if (stripped.length > 0 && Number.isFinite(percent)) {
    if (percent === 0) {
      // The vendor's contract names ZRD the default 0%; a caller that means
      // intra-community supply or export says `ZRICS` / `ZRE` instead.
      return 'ZRD';
    }
    return TAXED_RATE_BY_PERCENT.get(percent) ?? null;
  }

  return CODE_BY_EXEMPTION_MARKER[upper] ?? null;
}

/** The rate as a fraction of one, for the gross-to-net split. */
export function invoiceTaxRateFraction(code: EparagonyInvoiceTaxRate): number {
  return FRACTION_BY_CODE[code];
}

/**
 * Whether this code may key `metadata.taxValueByTaxRate`. See
 * {@link EparagonyTaxedInvoiceRateValues} for why the two maps differ.
 */
export function isTaxedInvoiceRate(
  code: EparagonyInvoiceTaxRate,
): code is EparagonyTaxedInvoiceRate {
  return (EparagonyTaxedInvoiceRateValues as readonly string[]).includes(code);
}

export function isInvoiceTaxRateCode(value: string): value is EparagonyInvoiceTaxRate {
  return (EparagonyInvoiceTaxRateValues as readonly string[]).includes(value);
}

/**
 * Read a single comma as a decimal point, so `23,00` resolves rather than
 * blocking the whole invoice.
 *
 * `Number('23,00')` is `NaN`, which fell through to the exemption lookup and
 * then to a hard refusal, while core's own `parseTaxRatePercent` uses
 * `parseFloat` and reads the same value as 23. No shipped `ProductMaster` is
 * known to write comma decimals, so this closes a divergence rather than a
 * reported defect - and it is deliberately NOT `parseFloat`, which reads `23,5`
 * as 23 and would silently turn a 23.5% rate into a 23% one.
 *
 * Narrow on purpose: digits, one comma, and one or two digits to the end. A
 * thousands separator (`1,000`) does not match and is left to fail the rate
 * lookup as it should, rather than being read as `1.000`.
 */
const COMMA_DECIMAL_PATTERN = /^(\d+),(\d{1,2})$/;

function normalizeDecimalSeparator(value: string): string {
  return value.replace(COMMA_DECIMAL_PATTERN, '$1.$2');
}
