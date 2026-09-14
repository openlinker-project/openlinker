/**
 * Fulfilment Dispatch Timeout — the pure rules (#2712, ADR-054)
 *
 * ADR-054 names a **timeout-as-rejection sweep**: a `FulfillmentWork` offered to
 * a holder that never answers must not sit in `submitted` for ever. #2399
 * shipped the handshake and stopped there, deliberately — its own docblock
 * records the gap. This file holds the four pure rules that pass needs; the
 * orchestration is `FulfillmentDispatchTimeoutService` and the write is the
 * UNCHANGED `FulfillmentWorkRepositoryPort.recordRejection`.
 *
 * ## The `*.types.ts` pure-rule exception applies
 *
 * `engineering-standards.md § The pure-rule exception to "types only"` permits
 * runtime functions in a `*.types.ts` when they are pure, they ARE the rule for
 * the type beside them, and both halves change together. All four qualify: no
 * I/O, no injected dependency, no clock of their own, no argument mutation.
 * The shipped precedents are `applyPricingRule`, `applyStockSafetyBuffer`,
 * `resolveOfferLifecycle` and `readValidationProblems`.
 *
 * ## Why the timeout is NOT declared by the executor
 *
 * `fulfillment-executor.port.ts` states in terms that *"per-method error unions
 * and wall-clock budgets are Wave-4 hardening (`W4-1`, `W4-2`)"*, and both
 * contract suites (`fulfillment-executor-contract.suite.ts`,
 * `fulfillment-router-contract.suite.ts`) drop a declared-timeout rule for
 * exactly that reason. Adding a wall-clock sub-capability here would pre-empt a
 * deferral the port itself records — and a sweep scanning every connection
 * could not resolve one anyway, since this leaf may not inject
 * `IIntegrationsService` (ADR-053).
 *
 * ## Why it is not a fraction of something else either
 *
 * `routing-commit-lock.ts` derives `FULFILLMENT_ROUTE_TIMEOUT_MS` as
 * `floor(FULFILLMENT_ROUTE_LOCK_TTL_MS * 0.5)`, and that is right THERE because
 * both numbers bound one in-process call. A holder's response deadline is a
 * property of a third party's turnaround, with no lock to be a fraction of, so
 * it takes its own env var. The CLAMP shape is copied from that file; the
 * derivation is deliberately not.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { AuthorityAttentionOutcome } from '@openlinker/core/fulfillment-authority';

import { isTerminalFulfillmentWorkStatus } from './fulfillment-supported-actions.types';
import type { FulfillmentWork } from './fulfillment-work.types';

/**
 * The `reason` a timeout rejection records, NAMESPACED.
 *
 * `FulfillmentWorkRejection.reason` is documented as *"the rejecter's own
 * vocabulary. Opaque — never parsed or validated here"*, so a bare `'timeout'`
 * would be indistinguishable from a holder that happens to use that word. OL is
 * the rejecter on this path — by INFERENCE, not by a holder's declaration — and
 * the namespace is what keeps that legible after the fact.
 */
export const FULFILLMENT_DISPATCH_TIMEOUT_REASON = 'openlinker:dispatch-timeout';

/**
 * A timeout rejection is **never `blocking`**, and this is the load-bearing
 * decision of the whole slice.
 *
 * `blocking` excludes the rejecter from re-sourcing
 * (`fulfillment-execution.types.ts` property (a)). Three reasons, in order of
 * weight:
 *
 * 1. **It is a fact the rejecter ASSERTS, and a silence is not an assertion.**
 *    The standing repo rule (#2243) is that a destination's own declaration is
 *    a fact and blocks, while OUR inference only warns. A timeout is purely
 *    OL's inference about a holder that said nothing.
 * 2. **Exclusions accumulate as rows and are never cleared.** On the only
 *    shipped topology there is exactly ONE executor (`openlinker.oms.v1`,
 *    #2409), so a blocking timeout would exclude the only possible holder
 *    permanently — an unrecoverable dead end reached by a transient outage,
 *    with no in-product remedy.
 * 3. **The loop it would terminate cannot occur yet.** Nothing re-sources
 *    (#2395 owns that), so a non-blocking timeout cannot loop today.
 *
 * **Forward constraint on #2395**: because a timeout deliberately does not
 * exclude, the re-source loop must bound its own attempts rather than rely on
 * exclusion to terminate.
 */
export const FULFILLMENT_DISPATCH_TIMEOUT_IS_BLOCKING = false;

/** No holder has answered in this long ⇒ the dispatch is reapable. */
const DISPATCH_TIMEOUT_DEFAULT_MS = 2 * 60 * 60 * 1000;

/**
 * The floor is a safety bound, not a formality: below it the sweep would start
 * reaping dispatches a healthy holder is still answering, and a reap FREES the
 * work to be re-routed.
 */
const DISPATCH_TIMEOUT_MIN_MS = 5 * 60 * 1000;
const DISPATCH_TIMEOUT_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * **The single resolution path** (issue AC3: *"the timeout value is resolved
 * through one path that both reports and enforces it"*).
 *
 * Its output feeds BOTH the cutoff the sweep selects on AND the operator-facing
 * detail stamped on the rejection row and the attention entry — so the number
 * an operator reads is, structurally, the number that reaped the work. #2229 is
 * the standing rule: a ceiling reported to an operator that drifts from the one
 * applied is worse than an invisible ceiling, because the operator acts on a
 * number that is not true.
 *
 * A non-finite or non-positive value falls back to the default rather than
 * throwing — the `resolveSweepLockTtlMs` / `resolveFulfillmentRouteLockTtlMs`
 * idiom. A malformed env var must not wedge a sweep.
 */
export function resolveFulfillmentDispatchTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DISPATCH_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(Math.max(parsed, DISPATCH_TIMEOUT_MIN_MS), DISPATCH_TIMEOUT_MAX_MS);
}

/**
 * The operator-facing sentence, built from the SAME number the cutoff uses.
 *
 * Deliberately minutes-or-hours rather than raw milliseconds: this string is
 * read by a person deciding whether the timeout is set sensibly, and it is
 * PII-free (`AuthorityAttentionEntry.detail` requires that — "ids and counts
 * only").
 */
export function describeFulfillmentDispatchTimeout(timeoutMs: number): string {
  const minutes = Math.round(timeoutMs / 60_000);
  if (minutes < 120) {
    return `No response from the assigned holder within ${String(minutes)} minutes`;
  }
  const hours = Math.round(timeoutMs / 3_600_000);
  return `No response from the assigned holder within ${String(hours)} hours`;
}

/**
 * Does this order still have work nobody has taken?
 *
 * The A3-X (`fulfillment-unaccepted`) state, derived from EVERY work object on
 * the order. Four properties are load-bearing.
 *
 * **(1) It reads the whole order, so it is SPLIT-SAFE.** `omsAttention` is keyed
 * by `(order, producer)`, so on a split order a per-work answer would let work
 * B's acceptance clear the flag work A's timeout raised. Folding every work into
 * one verdict makes that unrepresentable rather than merely unlikely.
 *
 * **(2) It is LEVEL-TRIGGERED, never sticky** (#2100's rule): the same function
 * runs at the reap and after every handshake outcome, so an accepted
 * re-dispatch CLEARS the flag rather than leaving a permanent red mark. A flag
 * nothing can clear is worse than no flag.
 *
 * **(3) It covers a holder's own rejection too, and that is correct rather than
 * scope creep.** A3-X's descriptor reads *"every candidate rejected **or timed
 * out**; the work is unassigned"*, so both causes are the same operator-facing
 * state. Deriving from `requestStatus === 'rejected'` therefore answers the
 * question the vocabulary actually asks; a timeout-only rule would report a
 * holder-rejected work as fine.
 *
 * **(4) A TERMINAL work is ignored.** A cancelled or closed work object is not
 * outstanding, whatever its negotiation axis says — the execution axis is what
 * decides whether there is anything left to do.
 *
 * Returns `none` when nothing is outstanding, which the caller writes as the
 * clear. It never returns `indeterminate`: this function is total over its
 * input, and only a caller that FAILED to read the works may report that.
 */
export function deriveAcceptanceAttention(
  works: readonly FulfillmentWork[]
): AuthorityAttentionOutcome<'acceptance'> {
  const unaccepted = works.filter(
    (work) => !isTerminalFulfillmentWorkStatus(work.status) && work.requestStatus === 'rejected'
  );

  if (unaccepted.length === 0) return { kind: 'none' };

  return {
    kind: 'blocked',
    reason: 'fulfillment-unaccepted',
    detail: `${String(unaccepted.length)} fulfilment work object(s) have no holder`,
    // The work id, so a surface can name WHICH parcel of a split order is
    // stuck. Ids and counts only — never a connection name or an address.
    subjectRef: unaccepted[0]?.id,
  };
}
