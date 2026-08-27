/**
 * Analytics Remediation Run Types
 *
 * Value types for the `analytics_remediation_runs` audit ledger (#2468, epic
 * #2452 Phase 5), pinned by the Phase 1 Task 1.2 decision doc
 * (`docs/plans/analytics-coverage-remediation-decision.md` § Decision 2).
 *
 * Two scoping decisions from that doc are load-bearing here rather than
 * incidental:
 *
 *  1. **`category` is an open `string`, not the closed `CoverageCategory`
 *     union.** The column is deliberately unconstrained so a future
 *     genuinely-async category can reuse the table with no migration — but
 *     nothing in this epic other than the `'currency'` category ever writes a
 *     row. The tax side is a query-time settings toggle (ADR-063's amendment
 *     for #2456), so it has no run, no lifecycle and nothing to poll.
 *  2. **`status` reuses `CoverageResolutionStatus` from
 *     `@openlinker/core/orders`** rather than minting a parallel union here.
 *     A published type alias is one of the allowed cross-context shapes
 *     (`docs/architecture-overview.md § Cross-context dependencies in core`),
 *     and a second copy would let the ledger and the detector that reports on
 *     it drift apart — the panel renders both as one row.
 *
 * @module libs/core/src/analytics/domain/types
 */
import type { CoverageResolutionStatus } from '@openlinker/core/orders';

/**
 * Internal-id prefix for a run row (`ol_remrun_{uuid}`), following the
 * `ol_{prefix}_{uuid}` convention documented in
 * `docs/architecture-overview.md § Internal Identifier Format`. Minted by the
 * application service rather than by `IdentifierMappingService`: a run is an
 * OL-native audit row with no external counterpart, so it has nothing to map.
 */
export const ANALYTICS_REMEDIATION_RUN_ID_PREFIX = 'ol_remrun_';

/**
 * The `'currency'` category — the ONLY value this epic ever writes (see the
 * module doc). Exported as a constant so the controller, the worker handler
 * and the repository's partial-unique-index reasoning all name the same
 * string instead of three literals that can drift.
 */
export const CURRENCY_REMEDIATION_CATEGORY = 'currency';

/**
 * The two lifecycle values a run can still move from. A run in either state
 * holds the category's single "open run" slot enforced by the partial unique
 * index (see the migration), which is what makes a double-click on
 * "Recalculate all N now" a no-op rather than two competing repairs.
 */
export const OPEN_REMEDIATION_RUN_STATUSES: readonly CoverageResolutionStatus[] = [
  'open',
  'in-progress',
];

/** What a caller supplies when opening a run. */
export interface AnalyticsRemediationRunInput {
  category: string;
  /**
   * How many orders the detector counted at the moment the operator asked.
   * A point-in-time figure by construction — the population can shift while
   * the run executes, which is why completion is decided by re-reading the
   * population rather than by counting down from this number.
   */
  affectedCount: number;
  /** The user id that asked for the repair. */
  triggeredByUserId: string;
}

/**
 * Read view of one run, as returned by the status poll
 * (`GET /analytics/coverage/currency/status/:runId`).
 */
export interface AnalyticsRemediationRunView {
  id: string;
  category: string;
  status: CoverageResolutionStatus;
  /**
   * Populated whenever `status === 'failed'`, and never empty in that case —
   * an operator reading a failed repair must be told what is still wrong.
   * `null` in every other state.
   */
  detail: string | null;
  affectedCount: number;
  triggeredByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}
