/**
 * Order Tax-Rate Gate (#2248, ADR-052 § 6)
 *
 * The one predicate that answers "can a document state what tax was charged on
 * this order?". A line with no rate means no, and the document is held rather
 * than issued with a rate some adapter guessed.
 *
 * Pure and dependency-free - it takes the minimal line shape rather than an
 * `Order`, so it can be called from the gate, from the write path, and from a
 * bulk eligibility pass without any of them dragging the orders context in.
 *
 * @module libs/core/src/invoicing/domain/types
 */

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

/**
 * PII-free block detail. Ids and counts only - it reaches an operator screen
 * verbatim and is logged beside a PII-safe envelope.
 */
export function describeMissingTaxRate(finding: MissingTaxRateFinding): string {
  const scope = `${String(finding.lineCount)} of ${String(finding.totalLines)} lines carry no tax rate`;
  return finding.firstLineRef ? `${scope}; first: ${finding.firstLineRef}` : scope;
}
