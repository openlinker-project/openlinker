/**
 * Automation Runs Read Service Interface (#2363, Wave-2 spec §5.6)
 *
 * The per-rule fired log — §5.6's "one record, four readings" seen through the
 * rule. Read-only; #2385 owns the write path.
 *
 * ## Why this service exists rather than exposing the repository port
 *
 * `AutomationRunRepositoryPort` is an intra-context contract, and the #2363 HTTP
 * layer lives in `apps/api` — a scope `scripts/check-cross-context-imports.mjs`
 * walks and where `*RepositoryPort` is a deny shape. Every existing `apps/api`
 * repository-port import sits in that script's allow-list as debt tracked by
 * #722; this slice does not add to it.
 *
 * ## `isRecordingPersisted` is the honest half
 *
 * Until #2385 lands, the bound recorder logs and returns
 * (`LoggingAutomationRunRecorder`), so `automation_runs` is always empty. An
 * empty list would then mean "nothing fired" and "the write path does not exist
 * yet" identically — and an operator resolving that ambiguity concludes their
 * rule is broken. Reporting the fact separately is what makes the empty list
 * readable.
 *
 * @module libs/core/src/automation/application/interfaces
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */
import type { AutomationRun } from '../../domain/entities/automation-run.entity';

/** §5.6's fired-log page size. A cap, not a promise that fewer means fewer exist. */
export const AUTOMATION_RUN_LOG_PAGE_SIZE = 50;

export interface AutomationRunLogPage {
  readonly runs: readonly AutomationRun[];
  /** The cap that was applied, so a consumer can tell a short page from a full one. */
  readonly limit: number;
  /** `true` when the page is full and older runs may exist. */
  readonly hasMore: boolean;
  /**
   * Whether firings are persisted at all in this build. `false` means an empty
   * `runs` says nothing about whether the rule fired — see the interface docblock.
   */
  readonly recordingAvailable: boolean;
}

export interface IAutomationRunsReadService {
  /** This rule's most recent runs, newest first, capped at `AUTOMATION_RUN_LOG_PAGE_SIZE`. */
  listRecentByRule(ruleId: string, limit?: number): Promise<AutomationRunLogPage>;

  /** Whether the bound recorder persists a firing, or only logs it. */
  isRecordingPersisted(): boolean;
}
