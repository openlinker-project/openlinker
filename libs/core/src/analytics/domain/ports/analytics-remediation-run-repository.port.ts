/**
 * Analytics Remediation Run Repository Port
 *
 * Persistence contract for the `analytics_remediation_runs` audit ledger
 * (#2468). Implemented by `AnalyticsRemediationRunRepository`; consumed by
 * `AnalyticsRemediationRunService`.
 *
 * The write surface is deliberately narrow and append-then-terminalise: a run
 * is created, then moved once to a terminal value. There is no general
 * `save(run)` and no `delete` — a run row is evidence that a restatement of an
 * ADR-040 stamp happened (see the entity's doc comment), and evidence that can
 * be freely rewritten is not evidence.
 *
 * @module libs/core/src/analytics/domain/ports
 */
import type { CoverageResolutionStatus } from '@openlinker/core/orders';
import type { AnalyticsRemediationRun } from '../entities/analytics-remediation-run.entity';
import type { AnalyticsRemediationRunInput } from '../types/analytics-remediation-run.types';

export interface AnalyticsRemediationRunRepositoryPort {
  /**
   * Insert one run in the given starting status.
   *
   * Throws `OpenRemediationRunExistsError` when the category already holds an
   * `open`/`in-progress` run — the partial unique index is the authority, not
   * a read-then-write check in the service, so two concurrent requests cannot
   * both observe "no open run" and both start a repair.
   */
  createRun(
    input: AnalyticsRemediationRunInput,
    status: CoverageResolutionStatus
  ): Promise<AnalyticsRemediationRun>;

  findById(id: string): Promise<AnalyticsRemediationRun | null>;

  /** The category's single `open`/`in-progress` run, or `null`. */
  findOpenByCategory(category: string): Promise<AnalyticsRemediationRun | null>;

  /**
   * Move a run to `status`, but only while it is still `open`/`in-progress`.
   *
   * Returns `false` when nothing was updated — a run that another worker
   * already terminalised. Conditional rather than unconditional so a
   * re-delivered driver job cannot reopen or re-decide a finished run; this is
   * the same claim-by-conditional-UPDATE shape
   * `OrderRecordRepository.stampFxIfAbsent` uses.
   */
  transitionIfOpen(
    id: string,
    status: CoverageResolutionStatus,
    detail: string | null
  ): Promise<boolean>;
}
