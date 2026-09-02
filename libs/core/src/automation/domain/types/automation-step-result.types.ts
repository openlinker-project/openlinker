/**
 * Automation Step Result Vocabulary (#2361, Wave-2 spec §5.6)
 *
 * What ONE action step reports back to the dispatcher. The runner needs a
 * return shape before it can stop on a failure or record which step failed, so
 * the shape lands here with the executors that produce it.
 *
 * **#2385 persists this verbatim into `automation_runs.steps`**, which is typed
 * `readonly unknown[]` precisely so that this slice could define the member
 * without a schema change. #2385 may widen it; it must not fork it — two step
 * shapes is how a firing renders one way in the run log and another in the
 * timeline, which §5.6's "one record, four readings" exists to prevent.
 *
 * **`syncJobId` lives INSIDE the step, deliberately.** §5.6 requires a run row
 * to link to the `sync_jobs` row where a step dispatched a job, and the
 * `AutomationRun` entity's own docblock already states that link belongs in the
 * per-step jsonb rather than in a column of its own — the existing job detail
 * stays the place technical failure detail lives.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */
import type { AutomationActionKind } from './automation-action.types';

/**
 * How one step ended.
 *
 * - `done`          — the delegated operation ran.
 * - `nothing-to-do` — it ran and found the work already done, or the destination
 *                     had nothing to receive it. Not a failure.
 * - `failed`        — it did not run, or ran and was refused. Stops the list.
 * - `skipped`       — an EARLIER step failed, so this one never ran.
 *
 * `skipped` exists on the step and NOT on `AutomationRunOutcome` because it is a
 * statement about one step's relationship to its siblings; a run as a whole is
 * never "skipped". Recording it explicitly is what makes §5.6's *"Skipped: tell
 * the marketplace"* renderable — a silently missing step is indistinguishable
 * from a step that was never configured.
 */
export const AutomationStepStatusValues = [
  'done',
  'nothing-to-do',
  'failed',
  'skipped',
] as const;
export type AutomationStepStatus = (typeof AutomationStepStatusValues)[number];

/** Coerce an untrusted value to the step-status union. No default. */
export function isAutomationStepStatus(value: unknown): value is AutomationStepStatus {
  return (
    typeof value === 'string' && (AutomationStepStatusValues as readonly string[]).includes(value)
  );
}

/**
 * One executed (or skipped) step of a rule's ordered `actions` array.
 *
 * `stepIndex` is the position in that array, so a reader can name the failing
 * step without re-deriving it from the array length.
 */
/** Who said it, and what they said — verbatim. See `AutomationStepResult.report`. */
export interface AutomationStepReport {
  /** The reporter's operator-facing name. `ATTRIBUTION_OPENLINKER` when it is us. */
  readonly attributedTo: string;
  /** The reporter's own words, unmodified. Never wrapped in an OpenLinker sentence. */
  readonly message: string;
}

/** The attribution used when the statement is OpenLinker's own, not a third party's. */
export const ATTRIBUTION_OPENLINKER = 'OpenLinker';

export interface AutomationStepResult {
  readonly stepIndex: number;
  readonly action: AutomationActionKind;
  readonly status: AutomationStepStatus;
  /** Operator-facing detail: what the step produced, or why it did not. */
  readonly detail?: string;
  /**
   * What the underlying operation actually said, and who said it (#2387).
   *
   * **Additive rather than a replacement for `detail`**, and the deviation is
   * deliberate: `detail` is consumed by `buildAutomationTimelineEvents`, by the
   * run-log panel and by the activity table, and it carries operator-facing
   * sentences for `done` / `nothing-to-do` steps that have no external reporter
   * at all. Replacing it would break three shipped renderings to describe two.
   *
   * Set only where something REPORTED. `attributedTo` names the reporter, and
   * `message` is its words **verbatim** — never re-worded, never prefixed. The
   * whole point is that a surface can render *Allegro said: "…"* rather than an
   * OpenLinker paraphrase of a marketplace's refusal.
   *
   * **OpenLinker is a legitimate attribution.** Three cases exist and only the
   * first has an external source: (i) the operation answered; (ii) an
   * OpenLinker-side refusal ("no email sender is configured in this process") —
   * that IS OpenLinker's own statement, not a re-wording of anyone else's;
   * (iii) an unexpected throw, carrying the exception text. Attributing (ii) and
   * (iii) to a marketplace would put words in its mouth.
   *
   * `steps` is `jsonb` and this member is optional, so no migration and no
   * reader change.
   */
  readonly report?: AutomationStepReport;
  /** Set where the delegated operation enqueued a job — §5.6's third run-row link. */
  readonly syncJobId?: string;
  /**
   * Set when this build ships no working executor for the action. Names the
   * blocking gap so an operator reads "not built yet" rather than "it failed",
   * which lead to entirely different investigations.
   */
  readonly unavailableReason?: string;
}
