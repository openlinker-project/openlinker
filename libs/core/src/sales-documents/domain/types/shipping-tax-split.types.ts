/**
 * Shipping Tax Split (#2248 / #2252, ADR-052 § 5)
 *
 * A basket can carry several tax rates. The shipping the buyer paid is one
 * amount, and a document has to state which rate applies to it - so on a
 * mixed-rate basket it is split across the rates present, in proportion to
 * what was actually bought at each.
 *
 * **This is division, not tax computation.** Core groups an amount it was given
 * and cuts it into parts that sum back to it; it never derives a tax figure and
 * never rounds a tax value. The rounding rule for a rate stays in the provider
 * adapter, which is what ADR-052 § 5 reserves to it. The rounding that happens
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

/**
 * Split `shipping` across the rates present in `lines`.
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
  lines: readonly ShippingSplitLine[]
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

  if (rates.length === 1) {
    return [{ taxRate: rates[0][0], amount: round2(shipping) }];
  }

  const parts: ShippingSplitPart[] = rates.map(([taxRate, gross]) => ({
    taxRate,
    amount: round2((shipping * gross) / totalGross),
  }));

  const allocated = round2(parts.reduce((sum, part) => sum + part.amount, 0));
  const remainder = round2(round2(shipping) - allocated);
  if (remainder !== 0) {
    // `rates` is sorted by descending gross, so index 0 is the largest part.
    parts[0].amount = round2(parts[0].amount + remainder);
  }

  // A part that rounds to zero would be a document line stating that zero was
  // charged at a rate, which is noise rather than information.
  return parts.filter((part) => part.amount !== 0);
}

/** Two decimal places - the minor unit of every ISO-4217 currency used here. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
