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

/**
 * ## AF-X — "an automation couldn't finish" (#2387)
 *
 * A failed firing is attention-worthy (spec §4.2's AF-X row, §4.3's
 * classification). It is **DERIVED from `automation_runs`, never persisted as a
 * reason column on the subject order**, and that is a rule rather than a local
 * choice — the same one body C landed for A1-U / A2-A / A5-A (`origin: 'derived'`,
 * recomputed per read, no column). A derived state cannot be stale, cannot be
 * reset by a peer writer, and needs nothing to remember to null a field.
 *
 * #2387's issue text asked for the opposite — a ninth level-triggered reason
 * column beside the eight `fulfillment-authority` states — while ALSO requiring
 * one row per failed firing and that a later unrelated success never clear it.
 * Those three are jointly unsatisfiable: level-triggered is *defined* by
 * re-deciding and storing the answer including `null`, which is exactly the
 * clearing behaviour the third requirement forbids, and one column holds one
 * value per order rather than one per firing. The durable record already exists,
 * so AF-X reads it. Persisting it again would be the second of the three
 * independent writes the issue's own S2-6 criterion forbids one line later.
 *
 * ### A derived state is only self-clearing if the derivation can SEE what clears it
 *
 * The first draft of this rule was a pure function of ONE row
 * (`outcome === 'failed' && dismissedAt === null`) on the claim that a successful
 * retry cleared it by writing a new run. It does not:
 * `AutomationDispatchService.record` INSERTs and never touches the original, so
 * the original keeps `failed` / `dismissedAt: null` and stays attention-worthy
 * forever. The clearing fact therefore had to become DATA — `retryOfRunId` on the
 * retry's own row.
 *
 * **Latest-run-wins at the `(subjectId, ruleId)` grain was rejected**, and that
 * is the load-bearing half: it would clear on a later *unrelated* firing of the
 * same rule, which the spec forbids in as many words. The only thing separating
 * "a retry of this firing" from "another firing of this rule" is the link.
 *
 * The predicate is therefore not per-row, and the second read lives in
 * `AutomationRunRepositoryPort` — expressed ONCE and shared by the
 * `attentionOnly` filter and `countAttention`, never re-written per caller (the
 * divergence that class of duplication produces is why this note exists).
 */

/** The single-row half of the AF-X rule; the link is resolved by the caller. */
export interface AutomationRunAttentionInput {
  readonly outcome: AutomationRunOutcome;
  readonly dismissedAt: Date | null;
  /**
   * Whether a run carrying `retryOfRunId = <this run>` ended in anything other
   * than `failed`. Resolved by the repository, because it is a second read.
   */
  readonly supersededBySuccessfulRetry: boolean;
}

/**
 * Does this firing need an operator's attention?
 *
 * Only `failed` qualifies. `nothing-to-do` is the rule finding the work already
 * done, and `blocked` is a configuration collision that #2362 already reports —
 * neither is a failure, and counting them would put a red number on a healthy
 * install (#2100's `trigger-model-manual` lesson).
 */
export function isAutomationRunAttentionWorthy(run: AutomationRunAttentionInput): boolean {
  return (
    run.outcome === 'failed' && run.dismissedAt === null && !run.supersededBySuccessfulRetry
  );
}

/**
 * Why `Try again` is not offered for a firing.
 *
 * Closed, because each value renders a DIFFERENT operator sentence and a raw
 * string here would be a second copy of the vocabulary in the frontend.
 */
export const RetryRefusalReasonValues = [
  /** `done` / `nothing-to-do` / `blocked` — there is no failure to re-run. */
  'not-failed',
  /**
   * The rule this firing ran no longer exists. **Not a failure**: a rule the
   * operator deliberately deleted is a retry with no definition left to run.
   * The run row is untouched — the record of what fired stays true and outlives
   * its rule (#2358's no-FK + frozen `ruleName` design exists for this).
   */
  'rule-deleted',
  /**
   * `subjectKind: 'return'`. `buildOrderAutomationFacts` is order-shaped, so
   * there is nothing to re-dispatch against. Named as the cause rather than as
   * "unsupported", which reads as a gap someone files a bug against.
   */
  'subject-unsupported',
] as const;
export type RetryRefusalReason = (typeof RetryRefusalReasonValues)[number];

/** Whether a firing can be re-run, and why not when it cannot. */
export type RetryEligibility =
  | { readonly retryable: true }
  | { readonly retryable: false; readonly reason: RetryRefusalReason };

export interface RetryEligibilityInput {
  readonly outcome: AutomationRunOutcome;
  readonly subjectKind: AutomationRunSubjectKind;
  /** Whether the rule named by `ruleId` still exists. Resolved by the caller. */
  readonly ruleExists: boolean;
}

/**
 * The ONE rule behind both halves of the refusal contract (#2387).
 *
 * A refused retry is a DISABLED CONTROL WITH A REASON, never a 400 nobody sees —
 * an action rendered enabled that the backend will refuse is the same defect as
 * a filter the backend cannot serve: the operator learns the truth by wasting a
 * click. So the run projection carries the verdict, the button reads it, **and
 * the endpoint enforces it independently** — the projection is a rendering fact,
 * the endpoint is the guard. If only the endpoint knows, the UI lies; if only
 * the UI knows, a direct call bypasses it. Both call this function, so they
 * cannot drift.
 */
export function resolveRetryEligibility(input: RetryEligibilityInput): RetryEligibility {
  if (input.outcome !== 'failed') return { retryable: false, reason: 'not-failed' };
  if (input.subjectKind !== 'order') return { retryable: false, reason: 'subject-unsupported' };
  if (!input.ruleExists) return { retryable: false, reason: 'rule-deleted' };
  return { retryable: true };
}
