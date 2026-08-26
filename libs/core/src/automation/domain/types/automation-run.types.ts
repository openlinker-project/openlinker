/**
 * Automation Run Vocabulary (#2358, Wave-2 spec §5.6)
 *
 * The closed vocabulary an `automation_runs` row speaks. One row per firing —
 * including firings whose action dispatched a `sync_jobs` job, so the history is
 * complete rather than complete-for-some-actions.
 *
 * **The per-STEP outcome shape is #2385's and is deliberately absent here.** The
 * `steps` column is `jsonb` and this slice does not narrow it: #2385 owns the
 * write path and therefore owns what a step looks like.
 *
 * **Where the `sync_jobs` link lives, so #2385 does not have to re-derive it:**
 * §5.6 requires a run row to link to the `sync_jobs` row where a step dispatched
 * a job. That link belongs INSIDE the per-step `steps` jsonb and needs no
 * column of its own — the existing job detail stays the place technical failure
 * detail lives, rather than being re-rendered on the run.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */

/**
 * What a run acted on. T6/T7 fire on returns; the other six on orders, and
 * §5.6's run-log column is literally `Order / Return`.
 *
 * A `(subjectKind, subjectId)` pair rather than a nullable `orderId` +
 * nullable `returnId`: a nullable pair admits rows with both set or neither,
 * and a third subject kind later would mean a third column.
 */
export const AutomationRunSubjectKindValues = ['order', 'return'] as const;
export type AutomationRunSubjectKind = (typeof AutomationRunSubjectKindValues)[number];

/** Coerce an untrusted value to the subject-kind union. No default. */
export function isAutomationRunSubjectKind(value: unknown): value is AutomationRunSubjectKind {
  return (
    typeof value === 'string' &&
    (AutomationRunSubjectKindValues as readonly string[]).includes(value)
  );
}

/**
 * The closed, honest outcome vocabulary (spec §5.6).
 *
 * - `done`           — every step ran.
 * - `failed`         — a step failed; later steps did not run. **Attention-worthy** (AF-X).
 * - `nothing-to-do`  — the rule fired and found the work already done (the label was
 *                      already bought). Not a failure, not attention-worthy.
 * - `blocked`        — the #2047 two-money-rules case (spec §5.5 divergence 3): NOTHING
 *                      ran, and the row names which rules collided via
 *                      `blockedByRuleIds`. Not a failure, not attention-worthy.
 */
export const AutomationRunOutcomeValues = [
  'done',
  'failed',
  'nothing-to-do',
  'blocked',
] as const;
export type AutomationRunOutcome = (typeof AutomationRunOutcomeValues)[number];

/** Coerce an untrusted value to the outcome union. No default. */
export function isAutomationRunOutcome(value: unknown): value is AutomationRunOutcome {
  return (
    typeof value === 'string' && (AutomationRunOutcomeValues as readonly string[]).includes(value)
  );
}
