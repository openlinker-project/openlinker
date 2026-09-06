/**
 * Manual-route admissibility — the live-decision refusal (#2869 R7, decision M3)
 *
 * *"May a person route this order by hand right now?"* — asked of the order's
 * live routing decision, and answered `no` while one exists.
 *
 * ## What this prevents, and why it is a refusal rather than a wait
 *
 * A `live` routing decision means a router is mid-call, or its outcome is in
 * doubt. `RoutingCommitService.leaveInDoubt` deliberately leaves the row `live`
 * in exactly that case, because terminalising it would free the
 * `UNIQUE (orderId) WHERE state = 'live'` index, so the next decision would mint
 * a NEW id and therefore a NEW idempotency key — one the vendor cannot dedup
 * against the first call. **That is two plans and two shipments**: physical, and
 * unrecoverable once two parcels are with a carrier. There is no compensating
 * write; this refusal is the whole mitigation.
 *
 * So there is no override, no force, and no reason text that unlocks it (M3). A
 * person clicking a button does not change what the router is doing. The
 * stranded-decision sweep #2395 names as a follow-up is the correct remedy for a
 * decision that never resolves — not a manual escape hatch.
 *
 * ## The asymmetry that is easy to get backwards
 *
 * `RoutingCommitService.resumeOrRefuse` **resumes** a live decision belonging to
 * the same router, and that is right: resuming re-derives the identical
 * idempotency key (`deriveRouteIdempotencyKey(decision.id)`), which is precisely
 * what an idempotency key is for — the router recognises the retry and answers
 * with the same decision instead of making a second one.
 *
 * A manual route has **no such key to re-derive**. It is not a retry of anything;
 * resuming would mint a second plan. So where the router may resume, a person may
 * not — and this function is therefore router-AGNOSTIC: it refuses whoever holds
 * the live decision, including a router the operator would call "theirs".
 *
 * ## Why it ships with no caller — the smell, named
 *
 * Nothing calls this today. #2869's manual-route producer does not exist on
 * `main` (no `routeManually`, no `decidedBy` column — `RoutingDecision.routerConnectionId`
 * is still non-null), so this is the ADR-048 decision-1 shape: an interface with
 * no implementer. Recorded rather than hidden, with the two reasons it is
 * accepted anyway:
 *
 * 1. **It is permanent.** No later slice replaces it; #2869 consumes it as-is.
 * 2. **It guards a physical, unrecoverable event.** Spec § 5.2 draws the line
 *    this sits on: R5/R6 were cut because they are *machinery* with no producer,
 *    while *"a refusal is what a slice must never ship without"*.
 *
 * **The obligation on #2869's producer is enforced by a docblock and an issue
 * comment — not by a compiler or a guard script.** A closed union only bites a
 * caller that exists, and nothing in this tree will fail if that producer
 * re-implements the check inline. That enforcement is social, and saying so is
 * the honest version: a future reader should not believe a gate is holding this
 * when none is.
 *
 * ## The contract #2869 must honour
 *
 * `checkManualRouteAdmissible` is the **mandatory entry point** for the manual
 * admission check. Re-deriving it inline would give one question two answers,
 * which is the shape the whole routing model exists to prevent. The return type
 * is a closed union rather than a boolean so that a second refusal reason is a
 * compile error at the call site instead of a silent fall-through.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/specs/product-spec-manual-bench-routing.md § 5.1, § 5.2, decision M3
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { RoutingDecision } from '../entities/routing-decision.entity';

/**
 * Why a manual route was refused.
 *
 * One member today. It is a closed union rather than a string so that #2869's
 * producer must handle every arm, and so a second reason cannot be added without
 * every call site being told.
 */
export const ManualRouteRefusalReasonValues = ['routing-in-flight'] as const;

export type ManualRouteRefusalReason = (typeof ManualRouteRefusalReasonValues)[number];

/**
 * The answer. `decisionId` rides on the refusal because R11 requires a refusal
 * to be a sentence with a remedy — here *"the system is still deciding"* — and
 * naming the decision is what makes that claim checkable in a log rather than a
 * bare assertion.
 */
export type ManualRouteAdmissibility =
  | { readonly status: 'admissible' }
  | {
      readonly status: 'refused';
      readonly reason: ManualRouteRefusalReason;
      readonly decisionId: string;
    };

/**
 * Decide whether a manual route may proceed for an order.
 *
 * Pure: a function of its argument alone — no I/O, no clock, no mutation. The
 * caller supplies the order's live decision (`RoutingDecisionRepositoryPort.findLiveByOrderId`),
 * which the claim path already reads, so this costs nothing extra.
 *
 * @param live the order's `live` routing decision, or `null` when none is
 *   in flight.
 */
export function checkManualRouteAdmissible(
  live: RoutingDecision | null
): ManualRouteAdmissibility {
  if (live === null) {
    return { status: 'admissible' };
  }

  return { status: 'refused', reason: 'routing-in-flight', decisionId: live.id };
}
