/**
 * Routing Decision TTL — the pure rules (#2731, ADR-054 R1)
 *
 * How long a routing decision may sit `live` before the reaper closes it.
 *
 * ## Why a decision can sit `live` at all
 *
 * `RoutingCommitService.leaveInDoubt` keeps a decision `live` when `route()`
 * times out or throws: the router may still be committing, and abandoning would
 * free `UNIQUE (orderId) WHERE state = 'live'`, so the next attempt would mint a
 * new idempotency key a vendor cannot dedup (#2395). The decision is resumed
 * only when something routes the order again. Nothing else does, so without a
 * reaper the order waits for ever with no badge and no retry.
 *
 * ## The floor is a margin, the routing lock is the guarantee
 *
 * A reap frees the slot. If it fired while a `route()` call was still inside
 * its budget, a late answer and a fresh decision could both exist. The TTL is
 * measured from `createdAt`, and a RESUME calls the router again without
 * writing the row, so the age of a decision says nothing about whether a call
 * is in flight right now. What does is the per-order routing lock: every
 * `route()` call runs while holding `fulfillment:route:{orderId}`, and its
 * budget is strictly shorter than that lock's TTL. The reaper therefore takes
 * the same lock before reaping and skips the decision while it is held (see
 * `RoutingDecisionReaperService`).
 *
 * The floor stays above the longest budget any configuration allows (half of
 * `FULFILLMENT_ROUTE_LOCK_TTL_MAX_MS`) so that a decision is never reaped within
 * the window its own first call could still be running, even before the lock
 * is consulted. A spec asserts that relationship.
 *
 * For the in-process OL router a late answer cannot commit anyway: a timed-out
 * `route()` result is discarded and the commit happens only in
 * `RoutingCommitService`. The floor matters for an out-of-tree router that
 * commits on its own side, which the port gives OL no way to ask about (D4).
 *
 * ## The `*.types.ts` pure-rule exception applies
 *
 * Pure, no I/O, no clock of their own, and they are the rule for the TTL beside
 * them — the `fulfillment-dispatch-timeout.types.ts` shape (#2712).
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { RoutingDecision } from '../entities/routing-decision.entity';

/** Default: an hour is many times any real router answer, and short enough for a same-day pilot. */
export const ROUTING_DECISION_TTL_DEFAULT_MS = 60 * 60 * 1000;

/**
 * Above the longest `route()` budget any configuration allows (half of the
 * 10-minute maximum lock TTL), with margin.
 */
export const ROUTING_DECISION_TTL_MIN_MS = 15 * 60 * 1000;

export const ROUTING_DECISION_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * **The single resolution path** for the TTL.
 *
 * Its output feeds the cutoff the reaper selects on, the detail stamped on the
 * order and the value the read endpoint reports, so the number an operator reads
 * is the number that reaped the decision (#2229).
 *
 * A non-finite or non-positive value falls back to the default rather than
 * throwing, the `resolveFulfillmentDispatchTimeoutMs` idiom: a malformed env var
 * must not wedge the sweep.
 */
export function resolveRoutingDecisionTtlMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return ROUTING_DECISION_TTL_DEFAULT_MS;
  }
  return Math.min(Math.max(parsed, ROUTING_DECISION_TTL_MIN_MS), ROUTING_DECISION_TTL_MAX_MS);
}

/**
 * The operator-facing sentence, built from the SAME number the cutoff uses.
 *
 * Says "will be retried", never "was restarted": the worker re-routes at once
 * when a router is available and otherwise leaves the order to the reroute
 * sweep, so only the retry is a promise both paths keep.
 *
 * PII-free (`AuthorityAttentionEntry.detail` takes ids and counts only).
 */
export function describeRoutingDecisionTtl(ttlMs: number): string {
  const minutes = Math.round(ttlMs / 60_000);
  if (minutes < 120) {
    return `Routing got no answer within ${String(minutes)} minutes; it will be retried`;
  }
  const hours = Math.round(ttlMs / 3_600_000);
  return `Routing got no answer within ${String(hours)} hours; it will be retried`;
}

/** The instant before which a `live` decision counts as stranded. */
export function routingDecisionStrandedBefore(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() - ttlMs);
}

/**
 * Is this decision stranded?
 *
 * Measured from `createdAt`, not `updatedAt`. Resuming re-derives the same key
 * and calls the router again WITHOUT writing the row, so `updatedAt` does not
 * move on a resume; restarting the clock would need a second writer on a
 * one-writer table. A resume that genuinely answers terminalises the row, which
 * takes it out of the candidate set on its own.
 */
export function isRoutingDecisionStranded(
  decision: Pick<RoutingDecision, 'state' | 'createdAt'>,
  now: Date,
  ttlMs: number
): boolean {
  return (
    decision.state === 'live' &&
    decision.createdAt.getTime() < routingDecisionStrandedBefore(now, ttlMs).getTime()
  );
}
