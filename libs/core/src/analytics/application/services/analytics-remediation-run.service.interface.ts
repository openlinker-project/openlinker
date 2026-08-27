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
}
