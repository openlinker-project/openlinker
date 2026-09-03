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

/**
 * A retry chain's link back to the failure it retries (#2666).
 *
 * The two fields are meaningless apart: `runId` without `attempt` restarts the
 * budget on every chain and reopens #2666 with nothing failing, so they travel
 * as ONE value at every application seam. `NewAutomationRun` stays flat because
 * it mirrors columns; the recorder is the single translation point.
 */
export interface AutomationRunRetryLink {
  /** The failed run this one retries. */
  readonly runId: string;
  /** The parent's `retryAttempt` plus one. */
  readonly attempt: number;
}

/** The single-row half of the AF-X rule; the link is resolved by the caller. */
export interface AutomationRunAttentionInput {
  readonly outcome: AutomationRunOutcome;
  readonly dismissedAt: Date | null;
  /**
   * Whether ANY run carries `retryOfRunId = <this run>` — whatever that retry's
   * own outcome. Resolved by the repository, because it is a second read.
   *
   * Outcome-blind since #2666, and that is the rule rather than a relaxation: a
   * retry chain is ONE underlying failure with one live end, so the operator's
   * handle is the newest link. Testing the retry's outcome instead badged every
   * link of a three-deep chain — three red rows, three dismissals, one problem.
   */
  readonly supersededByRetry: boolean;
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
  return run.outcome === 'failed' && run.dismissedAt === null && !run.supersededByRetry;
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
  /**
   * A newer attempt already exists, so THIS row is no longer the chain's live
   * end (#2666). Deliberately distinct from `retry-exhausted`: "act on the newer
   * row" and "stop retrying" are different instructions, and one sentence
   * covering both would send the operator to the wrong place.
   *
   * It is also what closes the FORK. Without it a direct API call could retry an
   * already-superseded parent, minting a second chain head under a fresh budget
   * — the frontend hides that control, but `resolveRetryEligibility`'s own
   * contract forbids relying on that: if only the UI knows, a direct call
   * bypasses it.
   */
  'superseded',
  /**
   * The chain has used its whole budget (`AUTOMATION_MAX_RETRY_ATTEMPTS`).
   *
   * Not a system fault and not the operator's mistake: the automation cannot
   * finish as configured, and the remaining moves are fixing the cause at the
   * source or dismissing the run.
   */
  'retry-exhausted',
] as const;
export type RetryRefusalReason = (typeof RetryRefusalReasonValues)[number];

/**
 * How many times one failure may be retried before OpenLinker stops offering it.
 *
 * A JUDGEMENT, not a measurement — there is no operator data on this yet. The
 * reasoning: the sync runner's ladder is `maxAttempts = 10` with exponential
 * backoff, which is machine-paced and retries a TRANSIENT condition time may
 * fix. This is the opposite — an operator clicking a button, with no backoff,
 * re-running actions against facts `AutomationRetryService` deliberately does
 * not re-evaluate (its property 2). Attempt 4 is byte-identical to attempt 1, so
 * three is where the honest message becomes "this cannot finish as configured".
 */
export const AUTOMATION_MAX_RETRY_ATTEMPTS = 3;

/** Whether a firing can be re-run, and why not when it cannot. */
export type RetryEligibility =
  | { readonly retryable: true }
  | { readonly retryable: false; readonly reason: RetryRefusalReason };

export interface RetryEligibilityInput {
  readonly outcome: AutomationRunOutcome;
  readonly subjectKind: AutomationRunSubjectKind;
  /** Whether the rule named by `ruleId` still exists. Resolved by the caller. */
  readonly ruleExists: boolean;
  /**
   * This run's own position in its chain — `0` for an ordinary firing (#2666).
   *
   * REQUIRED, never optional-with-a-default: a caller that forgot it would
   * silently get an unbounded chain, which is this issue recurring with nothing
   * failing. The compiler asks instead.
   */
  readonly retryAttempt: number;
  /**
   * Whether a newer attempt already points at this run. Resolved by the caller,
   * which has it in hand either way — the projection computes it for every row,
   * and the retry endpoint reads its run through that same projection.
   */
  readonly supersededByRetry: boolean;
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
  // Order matters: the three pre-#2666 reasons keep their precedence, and the two
  // chain reasons are checked last so a run refused for a MORE SPECIFIC cause
  // still reports that cause. `superseded` precedes `retry-exhausted` because
  // pointing at the live row is better advice than "stop" while one exists.
  if (input.outcome !== 'failed') return { retryable: false, reason: 'not-failed' };
  if (input.subjectKind !== 'order') return { retryable: false, reason: 'subject-unsupported' };
  if (!input.ruleExists) return { retryable: false, reason: 'rule-deleted' };
  if (input.supersededByRetry) return { retryable: false, reason: 'superseded' };
  if (input.retryAttempt >= AUTOMATION_MAX_RETRY_ATTEMPTS) {
    return { retryable: false, reason: 'retry-exhausted' };
  }
  return { retryable: true };
}
