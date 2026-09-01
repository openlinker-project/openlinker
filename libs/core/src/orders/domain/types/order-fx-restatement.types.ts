/**
 * Order FX Restatement Types
 *
 * Vocabulary for the operator-triggered currency restatement (#2468, epic
 * #2452 Phase 5) — the bulk repair behind the Data Coverage panel's
 * "Recalculate all N now" action.
 *
 * ADR-040 DECLARES THE FX STAMP IMMUTABLE, and this is the documented
 * exception. Everything in this file exists to make that exception narrow and
 * auditable rather than a general-purpose re-stamp facility:
 *
 *  - the restatement only ever runs inside an `analytics_remediation_runs`
 *    row (`@openlinker/core/analytics`), which records who asked, when, and
 *    over how many orders — the ledger is what makes a moved financial figure
 *    explainable after the fact;
 *  - the scope is the SAME `SalesAnalyticsFilters` the coverage detector
 *    reported the count for, so the operator can never authorise a repair
 *    wider than the number they were shown;
 *  - the clear is guarded and idempotent, so a re-delivered driver job cannot
 *    turn one restatement into two.
 *
 * ADR-040 files general FX restatement as #2096; this is deliberately NOT
 * that. #2096 is "re-express history after a reporting-currency change",
 * which needs an era model. This is "an order carries a stamp in a currency
 * the deployment no longer reports in, so it is invisible to every KPI" —
 * a coverage gap with a bounded, operator-initiated fix.
 *
 * @module libs/core/src/orders/domain/types
 * @see docs/architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md
 */

/**
 * Bounds one page of the restatement's enumeration.
 *
 * KEYSET, NOT OFFSET, and that is a correctness requirement rather than a
 * performance one. The mismatch predicate matches `reportingCurrency IS NULL`
 * *or* a stale value, so a row this page just cleared STILL matches it — an
 * offset walk over a shrinking-then-not-shrinking set re-reads the same rows
 * forever. Walking `internalOrderId` strictly upward can only ever move
 * forward.
 */
export interface FxRestatementPageInput {
  /** The run this page belongs to. */
  runId: string;
  /** Exclusive lower bound on `internalOrderId`, or `null` to start. */
  afterOrderId: string | null;
  /** Max orders to clear + stamp in this page. */
  limit: number;
}

/**
 * One order the restatement page will repair. The source connection rides
 * along with the id because `OrderFxStampService.sweep`/child retry paths key
 * on it — kept here so the enumeration's own read stays the single source and
 * a per-order re-read isn't paid for a value already in hand.
 */
export interface FxRestatementOrderRef {
  internalOrderId: string;
  sourceConnectionId: string;
}

/**
 * What one restatement page did.
 *
 * `stamped` / `terminal` / `deferred` mirror `OrderFxSweepResult` exactly —
 * this page now stamps in-process instead of enqueueing a child job, so it
 * reports the same three outcomes the sweep does rather than an `enqueued`
 * count for work that either already happened or did not.
 */
export interface FxRestatementPageResult {
  /** Orders the page read. */
  scanned: number;
  /** Orders whose stamp columns this page actually cleared (a never-stamped row is not counted). */
  cleared: number;
  /** Orders this page stamped (excludes rows already stamped by a concurrent attempt). */
  stamped: number;
  /** Orders that reached a terminal FX answer this page. */
  terminal: number;
  /** Orders whose stamp attempt this page deferred to the retry pipeline. */
  deferred: number;
  /**
   * Resume point for the next page — the last scanned id, or `null` when the
   * page came back short and the scope's frontier is exhausted.
   */
  nextCursor: string | null;
}

/**
 * The remaining mismatched population, partitioned by whether the FX pipeline
 * has already given the order a TERMINAL answer.
 *
 * The partition exists because `order_records` carries no column holding an FX
 * terminal REASON — `fxStampedAt IS NOT NULL AND reportingCurrency IS NULL` is
 * the only durable evidence that a stamp attempt concluded it could not
 * proceed, and the reason itself (`FX_STAMP_TERMINAL_REASONS`) is logged by
 * `marketplace.order.fxStamp`, not persisted. A failed run's `detail`
 * therefore reports these two counts and names that job as where the per-order
 * reason lives, rather than inventing a specific reason it cannot prove.
 */
export interface FxRestatementRemainingSummary {
  /** Orders still outside the current reporting currency. */
  total: number;
  /** Of those, orders carrying a terminal marker (a stamp attempt concluded, without a figure). */
  terminalMarked: number;
  /** Of those, orders with no marker at all — still in flight, or never attempted. */
  pending: number;
}
