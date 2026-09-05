/**
 * Analytics Remediation Run Service Interface
 *
 * Contract for the `analytics_remediation_runs` audit ledger (#2468) — the
 * cross-context seam both `apps/api` (which opens a run) and `apps/worker`
 * (which terminalises it) consume, so neither reaches
 * `AnalyticsRemediationRunRepositoryPort` directly.
 *
 * @module libs/core/src/analytics/application/services
 */
import type { AnalyticsRemediationRunView } from '../../domain/types/analytics-remediation-run.types';

export interface IAnalyticsRemediationRunService {
  /**
   * Open a run for `category` in status `'in-progress'` and return it.
   *
   * `'in-progress'` rather than `'open'` is deliberate: by the time this
   * returns, the caller has committed to enqueuing the driver job, so a row
   * left at `'open'` would describe a state no reader ever observes. `'open'`
   * stays in the lifecycle union as the detector's own "nothing has been
   * asked for yet" value, which is reported live and never stored.
   *
   * Throws `OpenRemediationRunExistsError` when the category already has a run
   * in flight (mapped to HTTP 409 at the boundary).
   */
  openRun(input: {
    category: string;
    affectedCount: number;
    triggeredByUserId: string;
  }): Promise<AnalyticsRemediationRunView>;

  /** Read one run, or `null` when the id is unknown. */
  getRun(runId: string): Promise<AnalyticsRemediationRunView | null>;

  /** The category's run currently in flight, or `null`. */
  getOpenRun(category: string): Promise<AnalyticsRemediationRunView | null>;

  /**
   * Terminalise a run as `'resolved'`. Returns `false` when the run was
   * already terminal — a re-delivered driver job, not an error.
   */
  markResolved(runId: string): Promise<boolean>;

  /**
   * Terminalise a run as `'failed'`, carrying an operator-readable `detail`.
   *
   * `detail` is REQUIRED and rejected when blank: the mini-epic's acceptance
   * criterion is that a failed row always carries one, and "something went
   * wrong" on a financial restatement is worse than useless — it tells the
   * operator to retry without telling them what to fix.
   */
  markFailed(runId: string, detail: string): Promise<boolean>;

  /**
   * Cancel `category`'s open/in-progress run on an operator's explicit
   * request (#2816) - the recovery path for a run stranded at
   * `'in-progress'` because its driver job died before it ever reached
   * `markResolved` / `markFailed` (a malformed payload, exhausted retry
   * attempts, a saturated `bulk` lane). The partial unique index that keeps
   * one run per category otherwise makes every later
   * `POST .../recalculate` throw `OpenRemediationRunExistsError` forever,
   * with no recovery short of a manual database UPDATE.
   *
   * Deliberately explicit and operator-triggered rather than a time-based
   * staleness heuristic: a legitimate run enumerating a very large
   * affected-order population has no fixed time bound (the driver handler
   * reschedules with zero delay per page, so its total duration scales with
   * catalogue size), so any fixed cutoff risks auto-failing a run that is
   * still doing real, correct work. This is a financial-audit ledger (see
   * the repository port's own doc comment) - only a human deciding the row
   * is actually dead should terminalise it.
   *
   * Returns `false` when there is nothing to cancel - no open run for the
   * category, or one that already resolved/failed on its own between the
   * operator noticing the 409 and clicking cancel. Never throws for that
   * case: a stale affordance clicked after the run already finished must
   * degrade harmlessly, not error.
   */
  cancelOpenRun(category: string, reason: string): Promise<boolean>;
}
