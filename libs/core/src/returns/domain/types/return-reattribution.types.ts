/**
 * Return Re-attribution Types
 *
 * The candidate projection and result shape of the orphan re-attribution reconcile
 * (`returns.orphan.reconcile`, #2332) — the returns counterpart of the scan-offset
 * sweeps, and the pass that makes an orphan return SELF-HEALING once the order it
 * refers to is finally ingested.
 *
 * Domain-only: no framework dependencies.
 *
 * @module domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */

/**
 * The minimum the pass needs to re-check one orphan: its OL id (to claim by, and to log
 * with) and the source order reference to resolve from.
 *
 * `externalOrderId` is **non-nullable here** even though the column is nullable — the
 * candidate query excludes NULL, because a return the source never attached to an order
 * has nothing to resolve BY and would sit in the candidate set forever, costing a lookup
 * per tick to learn nothing. Such a return is resolved by an operator, not by this pass.
 */
export interface ReturnReattributionCandidate {
  id: string;
  externalOrderId: string;
}

/** One page of the reconcile, plus the total its scan offset wraps against. */
export interface ReturnReattributionPage {
  items: ReturnReattributionCandidate[];
  total: number;
}

/**
 * What one run of the pass did.
 *
 * **Four outcome counters, not three, and the fourth is the point.** A candidate whose
 * claim loses a race — a concurrent `upsertFromSource` filled `internalOrderId` between
 * this run's read and its write — is `alreadyAttributed`, never `unresolved` and never
 * `failed`. `unresolved` means "OL still cannot name the order", so counting a lost race
 * there states the one thing that is false: an operator reading `unresolved: 5` must be
 * able to believe five returns are still orphaned. And it is not a failure either — the
 * desired end state was reached, just by somebody else.
 */
export interface ReturnReattributionResult {
  /** Candidates read this page. */
  scanned: number;
  /** Orphans this run attributed. */
  reattributed: number;
  /** Orphans a concurrent writer attributed first — a success, not a fault. */
  alreadyAttributed: number;
  /** Orphans whose order OL still has not ingested. The ordinary outcome. */
  unresolved: number;
  /** Candidates whose per-row write threw. Logged with the return id, loop continues. */
  failed: number;
  /** Scan offset for the next run, wrapped to 0 at `total`. */
  nextOffset: number;
  /** Rows matching the candidate filter, for cursor wrap. */
  total: number;
}

/** Page bounds for one run. */
export interface ReturnReattributionOptions {
  limit: number;
  offset: number;
}
