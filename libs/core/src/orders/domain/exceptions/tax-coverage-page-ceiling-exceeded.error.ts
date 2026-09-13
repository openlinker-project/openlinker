/**
 * Tax Coverage Page Ceiling Exceeded Error
 *
 * Thrown by `TaxCoverageDetectionService.classify()` when the bounded-page
 * loop over `OrderRecordRepositoryPort.findNetExcludedOrderCandidatesPage`
 * (#2834) exceeds a generous page ceiling without the repository reporting a
 * `null` `nextCursor`.
 *
 * Against the SHIPPED repository this cannot happen — the keyset predicate
 * guarantees forward progress and the population is finite — so this is
 * defence-in-depth, not a live defect. But `classify()` is coded against the
 * PORT, not the implementation, and `GET /analytics/coverage` calls it
 * unconditionally: a future or third-party implementer whose cursor fails to
 * advance (or that never returns a null `nextCursor`) would otherwise hang
 * the request forever, holding a pooled connection. Throwing a named,
 * finite-cost error is preferable to a silent `break` that would
 * under-report every category, exactly the truncation ADR-068 exists to
 * prevent one layer up.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class TaxCoveragePageCeilingExceededError extends Error {
  constructor(
    public readonly pagesRead: number,
  ) {
    super(
      `Tax coverage classification aborted after reading ${pagesRead} pages without the ` +
        'repository reporting a null nextCursor — the port implementation may not be ' +
        'terminating correctly.'
    );
    this.name = 'TaxCoveragePageCeilingExceededError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TaxCoveragePageCeilingExceededError);
    }
  }
}
