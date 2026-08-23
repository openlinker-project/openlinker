/**
 * Order Tax-Rate Gate (#2248, ADR-052 § 6)
 *
 * The one predicate that answers "can a document state what tax was charged on
 * this order?". A line with no rate means no, and the document is held rather
 * than issued with a rate some adapter guessed.
 *
 * Pure - it takes the minimal line shape rather than an `Order`, so it can be
 * called from the gate, from the write path, and from a bulk eligibility pass
 * without any of them dragging the orders context in. Its one import is the
 * dependency-free shipping split, for the reason {@link findOrderTaxRateGap}
 * gives.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import { splitShippingAcrossRates } from '@openlinker/core/sales-documents';

/** The two fields the gate reads off an order line. */
export interface TaxRateGateLine {
  /** Internal product id - an OL identifier, never buyer data. */
  productId: string;
  /** The settled rate code, or absent when none was ever established. */
  taxRate?: string;
}

/** What is missing, in terms an operator screen can render verbatim. */
export interface MissingTaxRateFinding {
  /** How many lines have no rate. */
  lineCount: number;
  /** Total lines on the order, so "3 of 4" is expressible. */
  totalLines: number;
  /**
   * How the first rate-less line is referred to, so the remedy can name one
   * thing to fix.
   *
   * WHICH reference depends on the caller, and the field is named for that
   * rather than pretending otherwise. The auto-issue gate reads order items and
   * passes an internal product id. The write-path guard reads an
   * `IssueInvoiceCommand`, whose lines carry only a name, so it passes the line
   * label - which is shop-authored free text and therefore never used as a key,
   * only rendered.
   *
   * It was called `firstProductId` until a curl pass showed it returning
   * "Printed apron" on the write path. A field name that is true on one caller
   * and false on the other is worse than a vaguer one.
   */
  firstLineRef: string | null;
  /**
   * Which half of the document could not state a rate (#2245 review).
   *
   * `'lines'` (the default when absent) means a product line has no rate.
   * `'shipping'` means every product line HAS one but the shipping the buyer
   * paid cannot be attributed to any of them - see
   * {@link findOrderTaxRateGap}. The two need different operator copy: the
   * first names a product to fix, the second does not, because there is no
   * rate-less product to point at.
   */
  scope?: 'lines' | 'shipping';
}

/**
 * Report the lines with no tax rate, or `null` when every line has one.
 *
 * A blank string counts as missing: that is what the mapper emitted before
 * #2248 and what a source with no rate still produces. `'0'` does NOT count -
 * a zero rate is an answer (export, intra-EU, exempt goods), and treating it
 * as a gap would hold documents for a correctly configured catalogue.
 *
 * An order with no lines at all reports `null`. There is nothing to state a
 * rate for, and refusing it here would substitute a tax complaint for whatever
 * the real problem with an empty order is.
 */
export function findMissingTaxRate(
  lines: readonly TaxRateGateLine[]
): MissingTaxRateFinding | null {
  if (lines.length === 0) return null;
  const missing = lines.filter((line) => (line.taxRate ?? '').trim() === '');
  if (missing.length === 0) return null;
  return {
    lineCount: missing.length,
    totalLines: lines.length,
    firstLineRef: missing[0]?.productId ?? null,
  };
}

/** One product line as the order-level gate sees it: its rate and its gross. */
export interface TaxRateGateBasketLine extends TaxRateGateLine {
  /**
   * The line's gross total (unit price times quantity). Read only to decide
   * whether the shipping charge can be attributed to a rate - never to compute
   * a tax figure.
   */
  gross: number;
}

/**
 * The ORDER-level gate: can a document state what tax was charged, for every
 * line it will actually compose?
 *
 * This exists because {@link findMissingTaxRate} on the order's items is not the
 * same question as the write path's guard on the composed command (#2245
 * review). The command carries a shipping line the order does not, and
 * `splitShippingAcrossRates` refuses in two cases the item scan cannot see: no
 * lines at all, and every line's gross zero or unusable - a basket discounted to
 * 0 that still charges delivery. In both, the item scan passed, the job was
 * enqueued, the mapper composed a blank-rate shipping line, and the write path
 * threw on every attempt while the order carried no reason, no badge and no
 * count. That is the silent decline ADR-041 §54 forbids, so the gate now asks
 * the same question the composer will.
 *
 * It does NOT re-derive the split's arithmetic; it calls the same function the
 * mapper does and reads only whether an answer exists.
 */
export function findOrderTaxRateGap(
  lines: readonly TaxRateGateBasketLine[],
  shipping: number
): MissingTaxRateFinding | null {
  const missing = findMissingTaxRate(lines);
  if (missing) return missing;

  const parts = splitShippingAcrossRates(
    shipping,
    lines.map((line) => ({ taxRate: line.taxRate?.trim() ?? null, gross: line.gross }))
  );
  if (parts !== null) return null;

  // Every product line named a rate (the check above passed), so the shipping
  // charge is the one thing with nowhere to sit. `totalLines` counts the
  // shipping line the command will carry, because that is the line set the
  // refusal is about.
  return {
    lineCount: 1,
    totalLines: lines.length + 1,
    firstLineRef: null,
    scope: 'shipping',
  };
}

/**
 * PII-free block detail. Ids and counts only - it reaches an operator screen
 * verbatim and is logged beside a PII-safe envelope.
 */
export function describeMissingTaxRate(finding: MissingTaxRateFinding): string {
  if (finding.scope === 'shipping') {
    // No product to name: every product line has a rate. What is missing is a
    // rate the shipping charge could be attributed to, which happens when the
    // basket has no lines or nothing was actually charged for the goods.
    return (
      `the shipping charge cannot be attributed to a tax rate ` +
      `(${String(finding.totalLines - 1)} product line(s), none with a usable amount)`
    );
  }
  const scope = `${String(finding.lineCount)} of ${String(finding.totalLines)} lines carry no tax rate`;
  return finding.firstLineRef ? `${scope}; first: ${finding.firstLineRef}` : scope;
}
