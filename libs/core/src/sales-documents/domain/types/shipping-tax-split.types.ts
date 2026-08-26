/**
 * Shipping Tax Split (#2248 / #2252, ADR-063 § 5)
 *
 * A basket can carry several tax rates. The shipping the buyer paid is one
 * amount, and a document has to state which rate applies to it - so on a
 * mixed-rate basket it is split across the rates present, in proportion to
 * what was actually bought at each.
 *
 * **This is division, not tax computation.** Core groups an amount it was given
 * and cuts it into parts that sum back to it; it never derives a tax figure and
 * never rounds a tax value. The rounding rule for a rate stays in the provider
 * adapter, which is what ADR-063 § 5 reserves to it. The rounding that happens
 * here is on the *split*, and its only obligation is that the parts add up
 * exactly to the amount paid.
 *
 * Pure and dependency-free: no I/O, no framework, no regime knowledge.
 *
 * Lives in `sales-documents` rather than in `invoicing` because BOTH document
 * contexts need it and a fiscal receipt is not an invoice (ADR-041). This
 * concern is the shared, dependency-free leaf that exists for exactly that
 * case - the module imports nothing, so `invoicing` and `fiscalization` can
 * both value-import it with no risk of a module-load cycle.
 *
 * @module libs/core/src/sales-documents/domain/types
 */

/** One product line's contribution to the basket, as the split sees it. */
export interface ShippingSplitLine {
  /** The neutral rate code this line carries, or `null` when it has none. */
  taxRate: string | null;
  /** The line's gross total (unit price times quantity). */
  gross: number;
}

/** One shipping part: an amount charged at one rate. */
export interface ShippingSplitPart {
  taxRate: string;
  amount: number;
}

/** Two decimal places, which is what most ISO-4217 currencies carry. */
const DEFAULT_MINOR_UNIT_EXPONENT = 2;

/** ISO-4217 codes with no minor unit at all. */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** ISO-4217 codes whose minor unit is a thousandth. */
const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD',
  'IQD',
  'JOD',
  'KWD',
  'LYD',
  'OMR',
  'TND',
]);

/** Unit-of-account codes with four digits. Listed for completeness. */
const FOUR_DECIMAL_CURRENCIES = new Set(['CLF', 'UYW']);

/**
 * Split `shipping` across the rates present in `lines`.
 *
 * `minorUnitExponent` is how many decimal places the currency actually has, so
 * the parts sum exactly in the units the buyer paid in. It is a parameter and
 * not a constant because the only property this function promises - the parts
 * add back up to the amount - is false at two decimals for a zero-decimal
 * currency (JPY) and for a three-decimal one (KWD). Resolve it with
 * {@link minorUnitExponentFor} from the order's own currency; the default of 2
 * is a convenience for a caller that has already done so.
 *
 * Returns `null` when the split is **uncomputable**, which is a different thing
 * from an empty result:
 *
 * - any line carries no rate - the basket's rate mix is unknown, so no
 *   proportion can be stated, and the whole document waits;
 * - `lines` is empty, or every line's gross is zero or unusable - there is
 *   nothing to be proportional to.
 *
 * Returns `[]` when there is simply nothing to bill (non-positive or non-finite
 * shipping). That is a successful answer: no phantom shipping line.
 *
 * One rate in the basket gives one part at that rate - the ordinary case, and
 * it never touches the proportional arithmetic.
 *
 * **The remainder goes to the largest part.** Rounding each share to the
 * currency's minor unit leaves up to a few units unaccounted for; parking them
 * on the biggest share keeps the parts summing exactly to what the buyer paid,
 * which is the only property a document reader can check. Ordering is
 * deterministic (descending gross, then rate code) so the same basket always
 * produces the same split.
 */
export function splitShippingAcrossRates(
  shipping: number,
  lines: readonly ShippingSplitLine[],
  minorUnitExponent: number = DEFAULT_MINOR_UNIT_EXPONENT
): ShippingSplitPart[] | null {
  if (!Number.isFinite(shipping) || shipping <= 0) return [];
  if (lines.length === 0) return null;
  // A single unknown rate makes the mix unknowable. Splitting across the rates
  // we happen to know would silently attribute the unknown line's share to
  // somebody else's rate.
  if (lines.some((line) => line.taxRate === null || line.taxRate.trim() === '')) return null;

  const grossByRate = new Map<string, number>();
  for (const line of lines) {
    const rate = (line.taxRate as string).trim();
    const gross = Number.isFinite(line.gross) && line.gross > 0 ? line.gross : 0;
    grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross);
  }

  const totalGross = [...grossByRate.values()].reduce((sum, gross) => sum + gross, 0);
  if (totalGross <= 0) return null;

  const rates = [...grossByRate.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );

  const round = (value: number): number => roundToMinorUnits(value, minorUnitExponent);

  if (rates.length === 1) {
    return [{ taxRate: rates[0][0], amount: round(shipping) }];
  }

  const parts: ShippingSplitPart[] = rates.map(([taxRate, gross]) => ({
    taxRate,
    amount: round((shipping * gross) / totalGross),
  }));

  const allocated = round(parts.reduce((sum, part) => sum + part.amount, 0));
  const remainder = round(round(shipping) - allocated);
  if (remainder !== 0) {
    // `rates` is sorted by descending gross, so index 0 is the largest part.
    // The remainder is bounded by rounding error (at most half a minor unit
    // per part, so under one minor unit total for any realistic rate count),
    // and the largest part's own amount is proportional to the largest gross
    // share of a positive `shipping` - in every reachable case that dwarfs a
    // sub-minor-unit remainder, so this cannot drive it negative. It could in
    // principle if `shipping` were near-zero and split across many distinct
    // rates each carrying a near-equal, tiny gross share (#1985 review) -
    // unreached today because callers gate this function on a real charge.
    parts[0].amount = round(parts[0].amount + remainder);
  }

  // A part that rounds to zero would be a document line stating that zero was
  // charged at a rate, which is noise rather than information.
  return parts.filter((part) => part.amount !== 0);
}

/**
 * Round to a currency's minor unit.
 *
 * The exponent is passed in rather than assumed: a split whose parts do not sum
 * to the amount paid is the one failure this whole function exists to avoid,
 * and hardcoding two decimals produces exactly that in every zero-decimal and
 * three-decimal currency.
 */
function roundToMinorUnits(value: number, minorUnitExponent: number): number {
  const factor = Math.pow(10, minorUnitExponent);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * How many decimal places an ISO-4217 currency has.
 *
 * Only the exceptions are listed; everything else, including an unknown or
 * absent code, is two decimals. Falling back to 2 on an unrecognised code is
 * deliberate - it is what the amount was already being treated as everywhere
 * else in the order, so a new currency degrades to today's behaviour rather
 * than to a split that silently loses the fractional part.
 */
export function minorUnitExponentFor(currency: string | null | undefined): number {
  if (typeof currency !== 'string') return DEFAULT_MINOR_UNIT_EXPONENT;
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  if (FOUR_DECIMAL_CURRENCIES.has(code)) return 4;
  return DEFAULT_MINOR_UNIT_EXPONENT;
}
