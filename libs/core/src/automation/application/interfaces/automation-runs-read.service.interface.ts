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
import type { RetryEligibility } from '../../domain/types/automation-run.types';
import type { AutomationRunSubjectKind } from '../../domain/types/automation-run.types';
import type { AutomationRunFilters } from '../../domain/ports/automation-run-repository.port';

/** §5.6's fired-log page size. A cap, not a promise that fewer means fewer exist. */
export const AUTOMATION_RUN_LOG_PAGE_SIZE = 50;

/**
 * A run plus the two facts a single row cannot answer about itself (#2387).
 *
 * Both are DERIVED server-side and projected, so the frontend holds no copy of
 * either rule. `needsAttention` needs to know whether a *different* row retried
 * this one; `retry` needs to know whether the rule still exists. Deriving them
 * in the browser would mean shipping both rules twice and letting them drift.
 */
export interface AutomationRunView extends AutomationRun {
  /** AF-X: this firing failed, nobody dismissed it, no retry has since succeeded. */
  readonly needsAttention: boolean;
  /** Whether `Try again` is offered, and the operator-facing reason when it is not. */
  readonly retry: RetryEligibility;
  /**
   * Whether a newer attempt already points at this run (#2666).
   *
   * Surfaced because it changes what an unbadged `failed` row MEANS: before
   * #2666 that could only be "a retry succeeded", and it now also covers "a
   * later retry exists and may itself have failed". The row renders a muted
   * note from this, so the operator is never shown a failed row that is silent
   * about why it carries no badge.
   */
  readonly supersededByRetry: boolean;
}

export interface AutomationRunLogPage {
  readonly runs: readonly AutomationRunView[];
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

  /**
   * Recent runs against one subject — the order timeline's source (#2385).
   *
   * Same rows the per-rule log and the activity list read, filtered. That is the
   * point: "one record, four readings" is visibly true when the surfaces are one
   * read with a filter rather than two contracts over the same table.
   */
  listRecentBySubject(
    subjectKind: AutomationRunSubjectKind,
    subjectId: string,
    limit?: number,
  ): Promise<AutomationRunLogPage>;

  /**
   * Recent runs across every rule, newest first — the activity list
   * (#2385, filtered by #2386).
   *
   * Every filter is a NARROWING one and every absent field means "do not narrow".
   * A value the caller could not express is dropped before it arrives, so an
   * unrecognised filter widens the result rather than emptying it.
   */
  listRecent(
    filters?: AutomationRunFilters,
    limit?: number,
    offset?: number,
  ): Promise<AutomationRunLogPage>;

  /** One run by id, or `null` (#2385). Projected like every listing (#2387). */
  getRunById(id: string): Promise<AutomationRunView | null>;

  /**
   * How many firings need an operator's attention right now (#2387).
   *
   * Shares one SQL predicate with the `attentionOnly` filter, so the count can
   * never disagree with the rows it claims to count.
   */
  countAttention(): Promise<number>;

  /**
   * Record that an operator handled a failed firing themselves (#2387).
   *
   * The run stays `failed` — this says a HUMAN dealt with it, never that the
   * operation succeeded. `null` when no such run exists; re-dismissing is a
   * no-op that returns the row unchanged.
   */
  dismiss(id: string, userId: string, now: Date): Promise<AutomationRunView | null>;
}
